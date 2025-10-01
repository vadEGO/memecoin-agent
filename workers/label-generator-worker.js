// workers/label-generator-worker.js - Task 13 Label Generation for Training
const Database = require('better-sqlite3');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

class LabelGeneratorWorker {
  constructor() {
    this.isRunning = false;
    this.TRAINING_WINDOW_DAYS = 90; // 60-90 days for training cohort
    this.MIN_HOLDERS = 50;
    this.MIN_LIQUIDITY = 1000; // $1k minimum liquidity
  }

  /**
   * Get tokens eligible for labeling (training cohort)
   */
  getEligibleTokens() {
    try {
      const tokens = db.prepare(`
        SELECT 
          t.mint, t.symbol, t.first_seen_at, t.lp_exists,
          t.holders_count, t.liquidity_usd, t.rug_risk_score,
          ph.price as price_30m,
          hh.holders_count as holders_30m
        FROM tokens t
        LEFT JOIN price_history ph ON t.mint = ph.mint 
          AND ph.snapshot_time = datetime(t.first_seen_at, '+30 minutes')
        LEFT JOIN holders_history hh ON t.mint = hh.mint 
          AND hh.snapshot_time = datetime(t.first_seen_at, '+30 minutes')
        WHERE t.lp_exists = 1
          AND t.first_seen_at IS NOT NULL
          AND datetime(t.first_seen_at) > datetime('now', '-${this.TRAINING_WINDOW_DAYS} days')
          AND datetime(t.first_seen_at) < datetime('now', '-24 hours')
        ORDER BY t.first_seen_at DESC
      `).all();

      return tokens.filter(token => 
        token.holders_30m >= this.MIN_HOLDERS && 
        token.liquidity_usd >= this.MIN_LIQUIDITY &&
        token.price_30m > 0
      );
    } catch (error) {
      logger.error('label-generator', 'system', 'get_eligible_tokens_failed', `Failed to get eligible tokens: ${error.message}`);
      return [];
    }
  }

  /**
   * Get price data for a token over time
   */
  getPriceData(mint, startTime, endTime) {
    try {
      const prices = db.prepare(`
        SELECT price, snapshot_time
        FROM price_history
        WHERE mint = ? 
          AND datetime(snapshot_time) >= datetime(?)
          AND datetime(snapshot_time) <= datetime(?)
        ORDER BY snapshot_time ASC
      `).all(mint, startTime, endTime);

      return prices;
    } catch (error) {
      logger.error('label-generator', mint, 'get_price_data_failed', `Failed to get price data: ${error.message}`);
      return [];
    }
  }

  /**
   * Get liquidity data for a token over time
   */
  getLiquidityData(mint, startTime, endTime) {
    try {
      const liquidity = db.prepare(`
        SELECT liquidity_usd, snapshot_time
        FROM score_history
        WHERE mint = ? 
          AND datetime(snapshot_time) >= datetime(?)
          AND datetime(snapshot_time) <= datetime(?)
        ORDER BY snapshot_time ASC
      `).all(mint, startTime, endTime);

      return liquidity;
    } catch (error) {
      logger.error('label-generator', mint, 'get_liquidity_data_failed', `Failed to get liquidity data: ${error.message}`);
      return [];
    }
  }

  /**
   * Calculate winner_2x_24h label
   */
  calculateWinnerLabel(mint, price30m, startTime) {
    try {
      const endTime = new Date(new Date(startTime).getTime() + 24 * 60 * 60 * 1000).toISOString();
      const prices = this.getPriceData(mint, startTime, endTime);
      
      if (prices.length === 0 || !price30m) {
        return 0;
      }

      const maxPrice = Math.max(...prices.map(p => p.price));
      const winner = maxPrice >= (2 * price30m) ? 1 : 0;
      
      logger.debug('label-generator', mint, 'winner_calculation', 
        `Price30m: ${price30m}, MaxPrice: ${maxPrice}, Winner: ${winner}`);
      
      return winner;
    } catch (error) {
      logger.error('label-generator', mint, 'winner_calculation_failed', `Failed to calculate winner label: ${error.message}`);
      return 0;
    }
  }

  /**
   * Calculate rug_24h label
   */
  calculateRugLabel(mint, startTime, rugRiskScore30m, liquidity30m) {
    try {
      const endTime = new Date(new Date(startTime).getTime() + 24 * 60 * 60 * 1000).toISOString();
      
      // Check rug_risk_score >= 90 at 30m
      if (rugRiskScore30m >= 90) {
        logger.debug('label-generator', mint, 'rug_detected', 'High rug risk score at 30m');
        return 1;
      }

      // Check liquidity drop >= 80% in 6 hours
      const liquidity6h = this.getLiquidityData(mint, startTime, 
        new Date(new Date(startTime).getTime() + 6 * 60 * 60 * 1000).toISOString());
      
      if (liquidity6h.length > 0 && liquidity30m > 0) {
        const minLiquidity6h = Math.min(...liquidity6h.map(l => l.liquidity_usd));
        const liquidityDrop = (liquidity30m - minLiquidity6h) / liquidity30m;
        
        if (liquidityDrop >= 0.8) {
          logger.debug('label-generator', mint, 'rug_detected', 'Liquidity dropped 80% in 6h');
          return 1;
        }
      }

      // Check LP pulled (liquidity drops to near zero)
      const liquidity24h = this.getLiquidityData(mint, startTime, endTime);
      if (liquidity24h.length > 0 && liquidity30m > 0) {
        const minLiquidity24h = Math.min(...liquidity24h.map(l => l.liquidity_usd));
        const liquidityDrop24h = (liquidity30m - minLiquidity24h) / liquidity30m;
        
        if (liquidityDrop24h >= 0.8) {
          logger.debug('label-generator', mint, 'rug_detected', 'Liquidity dropped 80% in 24h');
          return 1;
        }
      }

      // Check price drawdown >= 80%
      const prices = this.getPriceData(mint, startTime, endTime);
      if (prices.length > 0) {
        const maxPrice = Math.max(...prices.map(p => p.price));
        const minPrice = Math.min(...prices.map(p => p.price));
        const priceDrawdown = (maxPrice - minPrice) / maxPrice;
        
        if (priceDrawdown >= 0.8) {
          logger.debug('label-generator', mint, 'rug_detected', 'Price drawdown 80% in 24h');
          return 1;
        }
      }

      return 0;
    } catch (error) {
      logger.error('label-generator', mint, 'rug_calculation_failed', `Failed to calculate rug label: ${error.message}`);
      return 0;
    }
  }

  /**
   * Generate labels for a single token
   */
  async generateTokenLabels(mint, token) {
    try {
      logger.info('label-generator', mint, 'processing_started', 'Generating labels');

      const startTime = new Date(new Date(token.first_seen_at).getTime() + 30 * 60 * 1000).toISOString();
      
      // Calculate winner label
      const winner2x24h = this.calculateWinnerLabel(mint, token.price_30m, startTime);
      
      // Calculate rug label
      const rug24h = this.calculateRugLabel(mint, startTime, token.rug_risk_score, token.liquidity_usd);

      // Get additional data for storage
      const endTime = new Date(new Date(startTime).getTime() + 24 * 60 * 60 * 1000).toISOString();
      const prices24h = this.getPriceData(mint, startTime, endTime);
      const liquidity24h = this.getLiquidityData(mint, startTime, endTime);
      
      const maxPrice24h = prices24h.length > 0 ? Math.max(...prices24h.map(p => p.price)) : null;
      const price24h = prices24h.length > 0 ? prices24h[prices24h.length - 1].price : null;
      const liquidity6h = liquidity24h.length > 0 ? 
        Math.min(...liquidity24h.slice(0, Math.min(6, liquidity24h.length)).map(l => l.liquidity_usd)) : null;

      // Store labels
      db.prepare(`
        INSERT OR REPLACE INTO token_labels (
          mint, first_seen_at, price_30m, max_price_24h, price_24h,
          winner_2x_24h, rug_24h, liquidity_30m, liquidity_6h, liquidity_24h,
          rug_risk_score_30m, lp_pulled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mint, token.first_seen_at, token.price_30m, maxPrice24h, price24h,
        winner2x24h, rug24h, token.liquidity_usd, liquidity6h, 
        liquidity24h.length > 0 ? liquidity24h[liquidity24h.length - 1].liquidity_usd : null,
        token.rug_risk_score, rug24h
      );

      logger.info('label-generator', mint, 'processing_completed', 
        `Winner: ${winner2x24h}, Rug: ${rug24h}`);

    } catch (error) {
      logger.error('label-generator', mint, 'processing_failed', `Failed to generate labels: ${error.message}`);
    }
  }

  /**
   * Main processing loop
   */
  async process() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    logger.info('label-generator', 'system', 'worker_started', 'Starting label generation worker');

    try {
      const tokens = this.getEligibleTokens();
      logger.info('label-generator', 'system', 'tokens_found', `Found ${tokens.length} eligible tokens`);

      let processed = 0;
      let winners = 0;
      let rugs = 0;

      for (const token of tokens) {
        await this.generateTokenLabels(token.mint, token);
        processed++;

        // Get the generated labels for counting
        const labels = db.prepare(`
          SELECT winner_2x_24h, rug_24h FROM token_labels WHERE mint = ?
        `).get(token.mint);
        
        if (labels) {
          if (labels.winner_2x_24h) winners++;
          if (labels.rug_24h) rugs++;
        }

        if (processed % 50 === 0) {
          logger.info('label-generator', 'system', 'progress', 
            `Processed ${processed}/${tokens.length} tokens (${winners} winners, ${rugs} rugs)`);
        }
      }

      logger.info('label-generator', 'system', 'worker_completed', 
        `Processed ${processed} tokens: ${winners} winners (${(winners/processed*100).toFixed(1)}%), ${rugs} rugs (${(rugs/processed*100).toFixed(1)}%)`);

    } catch (error) {
      logger.error('label-generator', 'system', 'processing_failed', `Worker failed: ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start the worker
   */
  start() {
    logger.info('label-generator', 'system', 'worker_starting', 'Starting label generation worker');
    
    // Run immediately
    this.process();
    
    // Then run daily
    setInterval(() => {
      this.process();
    }, 24 * 60 * 60 * 1000);
  }
}

// Run if called directly
if (require.main === module) {
  const worker = new LabelGeneratorWorker();
  worker.start();
}

module.exports = LabelGeneratorWorker;
