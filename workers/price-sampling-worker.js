// workers/price-sampling-worker.js - Task 10 Price Sampling
const Database = require('better-sqlite3');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

class PriceSamplingWorker {
  constructor() {
    this.source = 'dexscreener'; // Single source for v1
    this.granularities = ['10m', '30m', '60m', '6h', '24h'];
  }

  /**
   * Get tokens that need price sampling
   * @returns {Array} Tokens needing price updates
   */
  getTokensForPriceSampling() {
    try {
      const tokens = db.prepare(`
        SELECT 
          t.mint, t.symbol, t.first_seen_at,
          CASE 
            WHEN (julianday('now') - julianday(t.first_seen_at)) * 24 * 60 <= 10 THEN '10m'
            WHEN (julianday('now') - julianday(t.first_seen_at)) * 24 * 60 <= 30 THEN '30m'
            WHEN (julianday('now') - julianday(t.first_seen_at)) * 24 * 60 <= 60 THEN '60m'
            WHEN (julianday('now') - julianday(t.first_seen_at)) * 24 * 60 <= 360 THEN '6h'
            WHEN (julianday('now') - julianday(t.first_seen_at)) * 24 * 60 <= 1440 THEN '24h'
            ELSE 'hourly'
          END as current_granularity
        FROM tokens t
        WHERE t.lp_exists = 1
          AND t.first_seen_at IS NOT NULL
          AND (julianday('now') - julianday(t.first_seen_at)) * 24 * 60 <= 1440
        ORDER BY t.first_seen_at DESC
        LIMIT 100
      `).all();

      return tokens;
    } catch (error) {
      logger.error('price-sampling', 'system', 'get_tokens_failed', `Failed to get tokens: ${error.message}`);
      return [];
    }
  }

  /**
   * Check if price sample is needed for a token at given granularity
   * @param {string} mint - Token mint
   * @param {string} granularity - Sampling granularity
   * @returns {boolean} True if sample needed
   */
  isPriceSampleNeeded(mint, granularity) {
    try {
      const lastSample = db.prepare(`
        SELECT timestamp
        FROM price_history
        WHERE mint = ? AND granularity = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `).get(mint, granularity);

      if (!lastSample) return true;

      const lastSampleTime = new Date(lastSample.timestamp);
      const now = new Date();
      const minutesSinceLastSample = (now - lastSampleTime) / (1000 * 60);

      // Check if enough time has passed based on granularity
      const granularityMinutes = {
        '10m': 10,
        '30m': 30,
        '60m': 60,
        '6h': 360,
        '24h': 1440,
        'hourly': 60
      };

      return minutesSinceLastSample >= (granularityMinutes[granularity] || 60);
    } catch (error) {
      logger.error('price-sampling', mint, 'check_sample_failed', `Failed to check sample: ${error.message}`);
      return false;
    }
  }

  /**
   * Fetch price data from Dexscreener (simulated for v1)
   * @param {string} mint - Token mint
   * @returns {object} Price data
   */
  async fetchPriceData(mint) {
    try {
      // Simulate Dexscreener API call
      // In production, this would make actual API calls
      const mockPriceData = {
        price_usd: Math.random() * 0.01 + 0.001, // $0.001 - $0.011
        price_sol: Math.random() * 0.0001 + 0.00001, // 0.00001 - 0.00011 SOL
        liquidity_usd: Math.random() * 50000 + 5000, // $5k - $55k
        pair_id: `pair_${mint.slice(0, 8)}`,
        status: 'live'
      };

      // Simulate some tokens having no pair
      if (Math.random() < 0.1) {
        return {
          price_usd: null,
          price_sol: null,
          liquidity_usd: null,
          pair_id: null,
          status: 'no_pair'
        };
      }

      return mockPriceData;
    } catch (error) {
      logger.error('price-sampling', mint, 'fetch_failed', `Failed to fetch price: ${error.message}`);
      return {
        price_usd: null,
        price_sol: null,
        liquidity_usd: null,
        pair_id: null,
        status: 'error'
      };
    }
  }

  /**
   * Store price sample in database
   * @param {string} mint - Token mint
   * @param {string} granularity - Sampling granularity
   * @param {object} priceData - Price data
   */
  storePriceSample(mint, granularity, priceData) {
    try {
      const now = new Date().toISOString();
      
      db.prepare(`
        INSERT OR REPLACE INTO price_history 
        (mint, timestamp, price_usd, price_sol, liquidity_usd, source, pair_id, granularity, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mint,
        now,
        priceData.price_usd,
        priceData.price_sol,
        priceData.liquidity_usd,
        this.source,
        priceData.pair_id,
        granularity,
        priceData.status
      );

      logger.debug('price-sampling', mint, 'sample_stored', `Price sample stored for ${granularity}`);
    } catch (error) {
      logger.error('price-sampling', mint, 'store_failed', `Failed to store sample: ${error.message}`);
    }
  }

  /**
   * Process price sampling for a single token
   * @param {object} token - Token data
   */
  async processTokenPriceSampling(token) {
    const { mint, symbol, current_granularity } = token;

    try {
      // Check if we need to sample at current granularity
      if (!this.isPriceSampleNeeded(mint, current_granularity)) {
        logger.debug('price-sampling', mint, 'skip', `No sample needed for ${symbol} at ${current_granularity}`);
        return;
      }

      // Fetch price data
      const priceData = await this.fetchPriceData(mint);

      // Store price sample
      this.storePriceSample(mint, current_granularity, priceData);

      logger.success('price-sampling', mint, 'sampled', `Price sampled for ${symbol} at ${current_granularity}`, {
        price_usd: priceData.price_usd,
        status: priceData.status
      });

    } catch (error) {
      logger.error('price-sampling', mint, 'process_failed', `Failed to process ${symbol}: ${error.message}`);
    }
  }

  /**
   * Main price sampling loop
   */
  async processPriceSampling() {
    logger.info('price-sampling', 'system', 'start', 'Starting price sampling');

    try {
      const tokens = this.getTokensForPriceSampling();
      
      if (tokens.length === 0) {
        logger.warning('price-sampling', 'system', 'no_tokens', 'No tokens found for price sampling');
        return;
      }

      logger.info('price-sampling', 'system', 'processing', `Processing ${tokens.length} tokens`);

      // Process each token
      for (const token of tokens) {
        await this.processTokenPriceSampling(token);
        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      logger.success('price-sampling', 'system', 'complete', 'Price sampling completed');

    } catch (error) {
      logger.error('price-sampling', 'system', 'failed', `Price sampling failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get price history for a token
   * @param {string} mint - Token mint
   * @param {number} limit - Number of records to return
   * @returns {Array} Price history records
   */
  getPriceHistory(mint, limit = 10) {
    try {
      return db.prepare(`
        SELECT 
          ph.timestamp,
          ph.price_usd,
          ph.price_sol,
          ph.liquidity_usd,
          ph.source,
          ph.pair_id,
          ph.granularity,
          ph.status,
          t.symbol
        FROM price_history ph
        LEFT JOIN tokens t ON ph.mint = t.mint
        WHERE ph.mint = ?
        ORDER BY ph.timestamp DESC
        LIMIT ?
      `).all(mint, limit);
    } catch (error) {
      logger.error('price-sampling', mint, 'get_history_failed', `Failed to get price history: ${error.message}`);
      return [];
    }
  }
}

// Export for CLI usage
module.exports = {
  PriceSamplingWorker,
  processPriceSampling: async () => {
    const worker = new PriceSamplingWorker();
    await worker.processPriceSampling();
  },
  mainLoop: async () => {
    const worker = new PriceSamplingWorker();
    await worker.processPriceSampling();
    logger.success('price-sampling', 'system', 'complete', 'Price Sampling Worker completed');
  }
};

// Run if called directly
if (require.main === module) {
  const worker = new PriceSamplingWorker();
  worker.processPriceSampling().then(() => {
    console.log('✅ Price Sampling Worker completed');
    process.exit(0);
  }).catch(error => {
    console.error('❌ Price Sampling Worker failed:', error.message);
    process.exit(1);
  });
}
