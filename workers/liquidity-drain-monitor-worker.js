// workers/liquidity-drain-monitor-worker.js - Task 11 Liquidity Drain Monitoring
const Database = require('better-sqlite3');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

class LiquidityDrainMonitorWorker {
  constructor() {
    this.drainThresholds = {
      rapid5m: -0.40,  // -40% in 5 minutes
      rapid15m: -0.65, // -65% in 15 minutes
      warning15m: -0.40 // -40% in 15 minutes for sustained drain
    };
  }

  /**
   * Get tokens that need liquidity monitoring
   * @returns {Array} Tokens needing liquidity monitoring
   */
  getTokensForLiquidityMonitoring() {
    try {
      const tokens = db.prepare(`
        SELECT 
          t.mint, t.symbol, t.liquidity_usd, t.liquidity_usd_last,
          t.first_seen_at, t.lp_exists
        FROM tokens t
        WHERE t.lp_exists = 1
          AND t.liquidity_usd IS NOT NULL
          AND t.liquidity_usd > 1000
          AND t.first_seen_at IS NOT NULL
          AND (julianday('now') - julianday(t.first_seen_at)) * 24 * 60 <= 2880
        ORDER BY t.liquidity_usd DESC
        LIMIT 100
      `).all();

      return tokens;
    } catch (error) {
      logger.error('liquidity-drain-monitor', 'system', 'get_tokens_failed', `Failed to get tokens: ${error.message}`);
      return [];
    }
  }

  /**
   * Get historical liquidity data for a token
   * @param {string} mint - Token mint address
   * @param {number} minutesAgo - Minutes ago to look back
   * @returns {number} Liquidity value at that time
   */
  getHistoricalLiquidity(mint, minutesAgo) {
    try {
      const targetTime = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
      
      // Get liquidity from score_history table
      const history = db.prepare(`
        SELECT liquidity_usd
        FROM score_history
        WHERE mint = ? AND snapshot_time <= ?
        ORDER BY snapshot_time DESC
        LIMIT 1
      `).get(mint, targetTime);

      return history ? history.liquidity_usd : null;
    } catch (error) {
      logger.error('liquidity-drain-monitor', mint, 'get_historical_failed', `Failed to get historical liquidity: ${error.message}`);
      return null;
    }
  }

  /**
   * Calculate liquidity deltas for a token
   * @param {string} mint - Token mint address
   * @param {number} currentLiquidity - Current liquidity value
   * @returns {object} Liquidity deltas
   */
  calculateLiquidityDeltas(mint, currentLiquidity) {
    try {
      const liquidity5mAgo = this.getHistoricalLiquidity(mint, 5);
      const liquidity15mAgo = this.getHistoricalLiquidity(mint, 15);

      let delta5m = null;
      let delta15m = null;

      if (liquidity5mAgo !== null && currentLiquidity > 0) {
        delta5m = (currentLiquidity - liquidity5mAgo) / Math.max(currentLiquidity, 1);
      }

      if (liquidity15mAgo !== null && currentLiquidity > 0) {
        delta15m = (currentLiquidity - liquidity15mAgo) / Math.max(currentLiquidity, 1);
      }

      return {
        delta5m: delta5m ? Math.round(delta5m * 10000) / 10000 : null,
        delta15m: delta15m ? Math.round(delta15m * 10000) / 10000 : null,
        liquidity5mAgo,
        liquidity15mAgo
      };
    } catch (error) {
      logger.error('liquidity-drain-monitor', mint, 'calculate_deltas_failed', `Failed to calculate deltas: ${error.message}`);
      return {
        delta5m: null,
        delta15m: null,
        liquidity5mAgo: null,
        liquidity15mAgo: null
      };
    }
  }

  /**
   * Check for liquidity drain alerts
   * @param {string} mint - Token mint address
   * @param {object} deltas - Liquidity deltas
   * @returns {Array} Alert conditions triggered
   */
  checkDrainAlerts(mint, deltas) {
    const alerts = [];

    try {
      // Check for rapid 5m drain
      if (deltas.delta5m !== null && deltas.delta5m <= this.drainThresholds.rapid5m) {
        alerts.push({
          type: 'rapid_drain_5m',
          severity: 'high',
          delta: deltas.delta5m,
          threshold: this.drainThresholds.rapid5m,
          message: `Rapid liquidity drain: ${(deltas.delta5m * 100).toFixed(1)}% in 5 minutes`
        });
      }

      // Check for rapid 15m drain
      if (deltas.delta15m !== null && deltas.delta15m <= this.drainThresholds.rapid15m) {
        alerts.push({
          type: 'rapid_drain_15m',
          severity: 'critical',
          delta: deltas.delta15m,
          threshold: this.drainThresholds.rapid15m,
          message: `Critical liquidity drain: ${(deltas.delta15m * 100).toFixed(1)}% in 15 minutes`
        });
      }

      // Check for sustained drain warning
      if (deltas.delta15m !== null && deltas.delta15m <= this.drainThresholds.warning15m) {
        alerts.push({
          type: 'sustained_drain_warning',
          severity: 'medium',
          delta: deltas.delta15m,
          threshold: this.drainThresholds.warning15m,
          message: `Sustained liquidity drain: ${(deltas.delta15m * 100).toFixed(1)}% in 15 minutes`
        });
      }

      return alerts;
    } catch (error) {
      logger.error('liquidity-drain-monitor', mint, 'check_alerts_failed', `Failed to check drain alerts: ${error.message}`);
      return [];
    }
  }

  /**
   * Update token liquidity data
   * @param {string} mint - Token mint address
   * @param {number} currentLiquidity - Current liquidity value
   * @param {object} deltas - Liquidity deltas
   */
  updateTokenLiquidityData(mint, currentLiquidity, deltas) {
    try {
      db.prepare(`
        UPDATE tokens 
        SET 
          liquidity_usd_last = ?,
          liquidity_usd_5m_delta = ?,
          liquidity_usd_15m_delta = ?
        WHERE mint = ?
      `).run(
        currentLiquidity,
        deltas.delta5m,
        deltas.delta15m,
        mint
      );

      logger.debug('liquidity-drain-monitor', mint, 'updated', 'Liquidity data updated');
    } catch (error) {
      logger.error('liquidity-drain-monitor', mint, 'update_failed', `Failed to update liquidity data: ${error.message}`);
    }
  }

  /**
   * Process liquidity monitoring for a single token
   * @param {object} token - Token data
   */
  async processTokenLiquidityMonitoring(token) {
    const { mint, symbol, liquidity_usd } = token;

    try {
      // Calculate liquidity deltas
      const deltas = this.calculateLiquidityDeltas(mint, liquidity_usd);

      // Update token with liquidity data
      this.updateTokenLiquidityData(mint, liquidity_usd, deltas);

      // Check for drain alerts
      const alerts = this.checkDrainAlerts(mint, deltas);

      if (alerts.length > 0) {
        logger.warning('liquidity-drain-monitor', mint, 'drain_detected', `Liquidity drain detected for ${symbol}`, {
          alerts: alerts.map(a => a.message),
          delta5m: deltas.delta5m ? (deltas.delta5m * 100).toFixed(1) + '%' : 'N/A',
          delta15m: deltas.delta15m ? (deltas.delta15m * 100).toFixed(1) + '%' : 'N/A'
        });
      } else {
        logger.debug('liquidity-drain-monitor', mint, 'no_drain', `No significant drain detected for ${symbol}`);
      }

    } catch (error) {
      logger.error('liquidity-drain-monitor', mint, 'process_failed', `Failed to process ${symbol}: ${error.message}`);
    }
  }

  /**
   * Main liquidity monitoring loop
   */
  async processLiquidityMonitoring() {
    logger.info('liquidity-drain-monitor', 'system', 'start', 'Starting liquidity drain monitoring');

    try {
      const tokens = this.getTokensForLiquidityMonitoring();
      
      if (tokens.length === 0) {
        logger.warning('liquidity-drain-monitor', 'system', 'no_tokens', 'No tokens found for liquidity monitoring');
        return;
      }

      logger.info('liquidity-drain-monitor', 'system', 'processing', `Processing ${tokens.length} tokens`);

      // Process each token
      for (const token of tokens) {
        await this.processTokenLiquidityMonitoring(token);
        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      logger.success('liquidity-drain-monitor', 'system', 'complete', 'Liquidity drain monitoring completed');

    } catch (error) {
      logger.error('liquidity-drain-monitor', 'system', 'failed', `Liquidity drain monitoring failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get liquidity monitoring data for a specific token
   * @param {string} mint - Token mint address
   * @returns {object} Liquidity monitoring data
   */
  getLiquidityMonitoringData(mint) {
    try {
      return db.prepare(`
        SELECT 
          t.mint, t.symbol, t.liquidity_usd, t.liquidity_usd_last,
          t.liquidity_usd_5m_delta, t.liquidity_usd_15m_delta
        FROM tokens t
        WHERE t.mint = ?
      `).get(mint);
    } catch (error) {
      logger.error('liquidity-drain-monitor', mint, 'get_data_failed', `Failed to get liquidity data: ${error.message}`);
      return null;
    }
  }

  /**
   * Get tokens with significant liquidity drains
   * @param {number} limit - Number of tokens to return
   * @returns {Array} Tokens with significant drains
   */
  getTokensWithDrains(limit = 20) {
    try {
      return db.prepare(`
        SELECT 
          t.mint, t.symbol, t.liquidity_usd, t.liquidity_usd_5m_delta, t.liquidity_usd_15m_delta
        FROM tokens t
        WHERE t.lp_exists = 1
          AND (t.liquidity_usd_5m_delta <= -0.20 OR t.liquidity_usd_15m_delta <= -0.30)
        ORDER BY t.liquidity_usd_5m_delta ASC, t.liquidity_usd_15m_delta ASC
        LIMIT ?
      `).all(limit);
    } catch (error) {
      logger.error('liquidity-drain-monitor', 'system', 'get_drains_failed', `Failed to get drain data: ${error.message}`);
      return [];
    }
  }
}

// Export for CLI usage
module.exports = {
  LiquidityDrainMonitorWorker,
  processLiquidityMonitoring: async () => {
    const worker = new LiquidityDrainMonitorWorker();
    await worker.processLiquidityMonitoring();
  },
  mainLoop: async () => {
    const worker = new LiquidityDrainMonitorWorker();
    await worker.processLiquidityMonitoring();
    logger.success('liquidity-drain-monitor', 'system', 'complete', 'Liquidity Drain Monitor Worker completed');
  }
};

// Run if called directly
if (require.main === module) {
  const worker = new LiquidityDrainMonitorWorker();
  worker.processLiquidityMonitoring().then(() => {
    console.log('✅ Liquidity Drain Monitor Worker completed');
    process.exit(0);
  }).catch(error => {
    console.error('❌ Liquidity Drain Monitor Worker failed:', error.message);
    process.exit(1);
  });
}
