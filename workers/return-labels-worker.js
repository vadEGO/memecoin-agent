// workers/return-labels-worker.js - Task 10 Return Labels Calculator
const Database = require('better-sqlite3');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

class ReturnLabelsWorker {
  constructor() {
    this.anchorOffsetMinutes = 30; // Anchor at 30m after first_seen_at
  }

  /**
   * Get tokens that need return labels calculated
   * @returns {Array} Tokens needing return labels
   */
  getTokensForReturnLabels() {
    try {
      const tokens = db.prepare(`
        SELECT 
          t.mint, t.symbol, t.first_seen_at,
          (julianday('now') - julianday(t.first_seen_at)) * 24 * 60 as age_minutes
        FROM tokens t
        WHERE t.lp_exists = 1
          AND t.first_seen_at IS NOT NULL
          AND (julianday('now') - julianday(t.first_seen_at)) * 24 * 60 >= 30
        ORDER BY t.first_seen_at DESC
        LIMIT 200
      `).all();

      return tokens;
    } catch (error) {
      logger.error('return-labels', 'system', 'get_tokens_failed', `Failed to get tokens: ${error.message}`);
      return [];
    }
  }

  /**
   * Check if return labels already calculated for a token
   * @param {string} mint - Token mint
   * @param {string} anchorTimestamp - Anchor timestamp
   * @returns {boolean} True if already calculated
   */
  hasReturnLabels(mint, anchorTimestamp) {
    try {
      const existing = db.prepare(`
        SELECT id FROM return_labels
        WHERE mint = ? AND anchor_timestamp = ?
      `).get(mint, anchorTimestamp);

      return !!existing;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get price at specific time for a token
   * @param {string} mint - Token mint
   * @param {string} targetTime - Target timestamp
   * @returns {object} Price data
   */
  getPriceAtTime(mint, targetTime) {
    try {
      const price = db.prepare(`
        SELECT price_usd, price_sol, liquidity_usd
        FROM price_history
        WHERE mint = ? 
          AND timestamp <= ?
          AND price_usd IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT 1
      `).get(mint, targetTime);

      return price || { price_usd: null, price_sol: null, liquidity_usd: null };
    } catch (error) {
      logger.error('return-labels', mint, 'get_price_failed', `Failed to get price at ${targetTime}: ${error.message}`);
      return { price_usd: null, price_sol: null, liquidity_usd: null };
    }
  }

  /**
   * Calculate return labels for a token
   * @param {object} token - Token data
   */
  async calculateReturnLabels(token) {
    const { mint, symbol, first_seen_at } = token;

    try {
      // Calculate anchor timestamp (30m after first_seen_at)
      const firstSeen = new Date(first_seen_at);
      const anchorTime = new Date(firstSeen.getTime() + this.anchorOffsetMinutes * 60 * 1000);
      const anchorTimestamp = anchorTime.toISOString();

      // Check if already calculated
      if (this.hasReturnLabels(mint, anchorTimestamp)) {
        logger.debug('return-labels', mint, 'skip', `Return labels already calculated for ${symbol}`);
        return;
      }

      // Get prices at different time points
      const price30m = this.getPriceAtTime(mint, anchorTimestamp);
      
      const time6h = new Date(anchorTime.getTime() + 6 * 60 * 60 * 1000);
      const price6h = this.getPriceAtTime(mint, time6h.toISOString());
      
      const time24h = new Date(anchorTime.getTime() + 24 * 60 * 60 * 1000);
      const price24h = this.getPriceAtTime(mint, time24h.toISOString());

      // Calculate returns
      let ret6h = null;
      let ret24h = null;

      if (price30m.price_usd && price6h.price_usd) {
        ret6h = (price6h.price_usd / price30m.price_usd) - 1;
      }

      if (price30m.price_usd && price24h.price_usd) {
        ret24h = (price24h.price_usd / price30m.price_usd) - 1;
      }

      // Calculate binary labels
      const winner50 = ret24h !== null && ret24h >= 0.5 ? 1 : 0;
      const winner100 = ret24h !== null && ret24h >= 1.0 ? 1 : 0;
      const loser50 = ret24h !== null && ret24h <= -0.5 ? 1 : 0;

      // Store return labels
      db.prepare(`
        INSERT OR REPLACE INTO return_labels
        (mint, anchor_timestamp, price_30m, price_6h, price_24h, ret_6h, ret_24h, winner_50, winner_100, loser_50)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mint,
        anchorTimestamp,
        price30m.price_usd,
        price6h.price_usd,
        price24h.price_usd,
        ret6h,
        ret24h,
        winner50,
        winner100,
        loser50
      );

      logger.success('return-labels', mint, 'calculated', `Return labels calculated for ${symbol}`, {
        ret6h: ret6h ? (ret6h * 100).toFixed(1) + '%' : 'N/A',
        ret24h: ret24h ? (ret24h * 100).toFixed(1) + '%' : 'N/A',
        winner50,
        winner100,
        loser50
      });

    } catch (error) {
      logger.error('return-labels', mint, 'calculate_failed', `Failed to calculate return labels for ${symbol}: ${error.message}`);
    }
  }

  /**
   * Main return labels calculation loop
   */
  async processReturnLabels() {
    logger.info('return-labels', 'system', 'start', 'Starting return labels calculation');

    try {
      const tokens = this.getTokensForReturnLabels();
      
      if (tokens.length === 0) {
        logger.warning('return-labels', 'system', 'no_tokens', 'No tokens found for return labels calculation');
        return;
      }

      logger.info('return-labels', 'system', 'processing', `Processing ${tokens.length} tokens`);

      // Process each token
      for (const token of tokens) {
        await this.calculateReturnLabels(token);
      }

      logger.success('return-labels', 'system', 'complete', 'Return labels calculation completed');

    } catch (error) {
      logger.error('return-labels', 'system', 'failed', `Return labels calculation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get return labels for a token
   * @param {string} mint - Token mint
   * @returns {Array} Return labels records
   */
  getReturnLabels(mint) {
    try {
      return db.prepare(`
        SELECT 
          rl.anchor_timestamp,
          rl.price_30m,
          rl.price_6h,
          rl.price_24h,
          rl.ret_6h,
          rl.ret_24h,
          rl.winner_50,
          rl.winner_100,
          rl.loser_50,
          t.symbol
        FROM return_labels rl
        LEFT JOIN tokens t ON rl.mint = t.mint
        WHERE rl.mint = ?
        ORDER BY rl.anchor_timestamp DESC
        LIMIT 10
      `).all(mint);
    } catch (error) {
      logger.error('return-labels', mint, 'get_labels_failed', `Failed to get return labels: ${error.message}`);
      return [];
    }
  }

  /**
   * Get baseline probabilities for backtesting
   * @returns {object} Baseline probabilities
   */
  getBaselineProbabilities() {
    try {
      const stats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(winner_50) as winners_50,
          SUM(winner_100) as winners_100,
          SUM(loser_50) as losers_50
        FROM return_labels
        WHERE ret_24h IS NOT NULL
      `).get();

      const total = stats.total || 0;
      const p50 = total > 0 ? (stats.winners_50 || 0) / total : 0;
      const p100 = total > 0 ? (stats.winners_100 || 0) / total : 0;
      const pLose50 = total > 0 ? (stats.losers_50 || 0) / total : 0;

      return {
        total,
        p50: Math.round(p50 * 1000) / 1000,
        p100: Math.round(p100 * 1000) / 1000,
        pLose50: Math.round(pLose50 * 1000) / 1000
      };
    } catch (error) {
      logger.error('return-labels', 'system', 'get_baseline_failed', `Failed to get baseline: ${error.message}`);
      return { total: 0, p50: 0, p100: 0, pLose50: 0 };
    }
  }
}

// Export for CLI usage
module.exports = {
  ReturnLabelsWorker,
  processReturnLabels: async () => {
    const worker = new ReturnLabelsWorker();
    await worker.processReturnLabels();
  },
  mainLoop: async () => {
    const worker = new ReturnLabelsWorker();
    await worker.processReturnLabels();
    logger.success('return-labels', 'system', 'complete', 'Return Labels Worker completed');
  }
};

// Run if called directly
if (require.main === module) {
  const worker = new ReturnLabelsWorker();
  worker.processReturnLabels().then(() => {
    console.log('✅ Return Labels Worker completed');
    process.exit(0);
  }).catch(error => {
    console.error('❌ Return Labels Worker failed:', error.message);
    process.exit(1);
  });
}
