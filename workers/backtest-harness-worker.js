// workers/backtest-harness-worker.js - Task 10 Backtest Harness v1
const Database = require('better-sqlite3');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

class BacktestHarnessWorker {
  constructor() {
    this.defaultSampleSize = 500;
  }

  /**
   * Get sample set for backtesting
   * @param {number} sampleSize - Number of tokens to sample
   * @returns {Array} Sample tokens with features at 30m
   */
  getSampleSet(sampleSize = 500) {
    try {
      const tokens = db.prepare(`
        SELECT 
          t.mint,
          t.symbol,
          t.health_score,
          t.fresh_pct,
          t.sniper_pct,
          t.insider_pct,
          t.top10_share,
          t.liquidity_usd,
          t.holders_count,
          rl.ret_6h,
          rl.ret_24h,
          rl.winner_50,
          rl.winner_100,
          rl.loser_50
        FROM tokens t
        LEFT JOIN return_labels rl ON t.mint = rl.mint
        WHERE t.lp_exists = 1
          AND t.holders_count >= 50
          AND t.liquidity_usd IS NOT NULL
          AND t.health_score IS NOT NULL
          AND datetime(t.first_seen_at) > datetime('now', '-48 hours')
        ORDER BY t.first_seen_at DESC
        LIMIT ?
      `).all(sampleSize);

      return tokens;
    } catch (error) {
      logger.error('backtest-harness', 'system', 'get_sample_failed', `Failed to get sample set: ${error.message}`);
      return [];
    }
  }

  /**
   * Calculate baseline probabilities
   * @param {Array} sample - Sample tokens
   * @returns {object} Baseline probabilities
   */
  calculateBaselines(sample) {
    const total = sample.length;
    const winners50 = sample.filter(t => t.winner_50 === 1).length;
    const winners100 = sample.filter(t => t.winner_100 === 1).length;
    const losers50 = sample.filter(t => t.loser_50 === 1).length;

    return {
      total,
      p50: total > 0 ? winners50 / total : 0,
      p100: total > 0 ? winners100 / total : 0,
      pLose50: total > 0 ? losers50 / total : 0
    };
  }

  /**
   * Test alert rule and calculate metrics
   * @param {Array} sample - Sample tokens
   * @param {object} rule - Alert rule configuration
   * @param {object} baselines - Baseline probabilities
   * @returns {object} Rule metrics
   */
  testAlertRule(sample, rule, baselines) {
    // Filter tokens that would trigger this rule
    const triggeredTokens = sample.filter(token => {
      return (
        (rule.health_min === null || token.health_score >= rule.health_min) &&
        (rule.health_max === null || token.health_score <= rule.health_max) &&
        (rule.fresh_pct_min === null || token.fresh_pct >= rule.fresh_pct_min) &&
        (rule.sniper_pct_max === null || token.snipers_pct <= rule.sniper_pct_max) &&
        (rule.insider_pct_max === null || token.insiders_pct <= rule.insider_pct_max) &&
        (rule.top10_share_max === null || token.top10_share <= rule.top10_share_max) &&
        (rule.liquidity_min === null || token.liquidity_usd >= rule.liquidity_min) &&
        (rule.holders_min === null || token.holders_count >= rule.holders_min)
      );
    });

    const totalTriggered = triggeredTokens.length;
    const winners50 = triggeredTokens.filter(t => t.winner_50 === 1).length;
    const winners100 = triggeredTokens.filter(t => t.winner_100 === 1).length;

    // Calculate precision
    const precision50 = totalTriggered > 0 ? winners50 / totalTriggered : 0;
    const precision100 = totalTriggered > 0 ? winners100 / totalTriggered : 0;

    // Calculate lift
    const lift50 = baselines.p50 > 0 ? precision50 / baselines.p50 : 0;
    const lift100 = baselines.p100 > 0 ? precision100 / baselines.p100 : 0;

    // Calculate volume (alerts per day)
    const volumePerDay = (totalTriggered / sample.length) * 100; // Assuming 100 tokens per day

    return {
      rule,
      totalTriggered,
      precision50: Math.round(precision50 * 1000) / 1000,
      precision100: Math.round(precision100 * 1000) / 1000,
      lift50: Math.round(lift50 * 1000) / 1000,
      lift100: Math.round(lift100 * 1000) / 1000,
      volumePerDay: Math.round(volumePerDay * 100) / 100
    };
  }

  /**
   * Run backtest for all alert rules
   * @param {number} sampleSize - Sample size
   * @param {string} since - Time period (e.g., '7d')
   * @returns {object} Backtest results
   */
  async runBacktest(sampleSize = 500, since = '7d') {
    logger.info('backtest-harness', 'system', 'start', `Starting backtest with sample size ${sampleSize}`);

    try {
      // Get sample set
      const sample = this.getSampleSet(sampleSize);
      
      if (sample.length === 0) {
        logger.warning('backtest-harness', 'system', 'no_sample', 'No tokens found for backtesting');
        return null;
      }

      logger.info('backtest-harness', 'system', 'sample_loaded', `Loaded ${sample.length} tokens for backtesting`);

      // Calculate baselines
      const baselines = this.calculateBaselines(sample);

      // Define alert rules to test
      const alertRules = [
        {
          name: 'Launch v2',
          alert_type: 'launch',
          health_min: 70,
          health_max: null,
          fresh_pct_min: 0.60,
          sniper_pct_max: 0.05,
          insider_pct_max: 0.08,
          top10_share_max: null,
          liquidity_min: 8000,
          holders_min: 120
        },
        {
          name: 'Momentum v2',
          alert_type: 'momentum_upgrade',
          health_min: 60,
          health_max: null,
          fresh_pct_min: null,
          sniper_pct_max: null,
          insider_pct_max: null,
          top10_share_max: null,
          liquidity_min: null,
          holders_min: null
        },
        {
          name: 'Risk v2',
          alert_type: 'risk',
          health_min: null,
          health_max: 50,
          fresh_pct_min: null,
          sniper_pct_max: null,
          insider_pct_max: 0.20,
          top10_share_max: 0.70,
          liquidity_min: null,
          holders_min: null
        }
      ];

      // Test each rule
      const results = [];
      const rulesetId = `backtest_${Date.now()}`;

      for (const rule of alertRules) {
        const metrics = this.testAlertRule(sample, rule, baselines);
        results.push(metrics);

        // Store results in database
        this.storeBacktestResult(rulesetId, rule, metrics, sample.length);
      }

      const backtestResults = {
        rulesetId,
        sampleSize: sample.length,
        baselines,
        results,
        timestamp: new Date().toISOString()
      };

      logger.success('backtest-harness', 'system', 'complete', 'Backtest completed', {
        rulesetId,
        sampleSize: sample.length,
        rulesTested: results.length
      });

      return backtestResults;

    } catch (error) {
      logger.error('backtest-harness', 'system', 'failed', `Backtest failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Store backtest result in database
   * @param {string} rulesetId - Ruleset identifier
   * @param {object} rule - Alert rule
   * @param {object} metrics - Rule metrics
   * @param {number} sampleSize - Sample size
   */
  storeBacktestResult(rulesetId, rule, metrics, sampleSize) {
    try {
      db.prepare(`
        INSERT INTO backtest_results
        (ruleset_id, alert_type, threshold_health_min, threshold_health_max, 
         threshold_fresh_pct_min, threshold_sniper_pct_max, threshold_insider_pct_max,
         threshold_top10_share_max, threshold_liquidity_min, threshold_holders_min,
         precision_50, precision_100, lift_50, lift_100, volume_per_day, sample_size)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        rulesetId,
        rule.alert_type,
        rule.health_min,
        rule.health_max,
        rule.fresh_pct_min,
        rule.sniper_pct_max,
        rule.insider_pct_max,
        rule.top10_share_max,
        rule.liquidity_min,
        rule.holders_min,
        metrics.precision50,
        metrics.precision100,
        metrics.lift50,
        metrics.lift100,
        metrics.volumePerDay,
        sampleSize
      );
    } catch (error) {
      logger.error('backtest-harness', 'system', 'store_failed', `Failed to store result: ${error.message}`);
    }
  }

  /**
   * Get latest backtest results
   * @returns {object} Latest backtest results
   */
  getLatestBacktestResults() {
    try {
      const results = db.prepare(`
        SELECT 
          ruleset_id,
          alert_type,
          threshold_health_min,
          threshold_health_max,
          threshold_fresh_pct_min,
          threshold_sniper_pct_max,
          threshold_insider_pct_max,
          threshold_top10_share_max,
          threshold_liquidity_min,
          threshold_holders_min,
          precision_50,
          precision_100,
          lift_50,
          lift_100,
          volume_per_day,
          sample_size,
          created_at
        FROM backtest_results
        WHERE created_at >= datetime('now', '-7 days')
        ORDER BY created_at DESC
        LIMIT 10
      `).all();

      return results;
    } catch (error) {
      logger.error('backtest-harness', 'system', 'get_results_failed', `Failed to get results: ${error.message}`);
      return [];
    }
  }

  /**
   * Format backtest results for CLI display
   * @param {object} results - Backtest results
   * @returns {string} Formatted results
   */
  formatBacktestResults(results) {
    if (!results) {
      return 'No backtest results available';
    }

    console.log('📊 Backtest Results:');
    console.log('─'.repeat(80));
    console.log(`Ruleset ID: ${results.rulesetId}`);
    console.log(`Sample Size: ${results.sampleSize} tokens`);
    console.log(`Timestamp: ${new Date(results.timestamp).toLocaleString()}`);
    console.log('');

    console.log('📈 Baselines:');
    console.log(`   P(+50%): ${(results.baselines.p50 * 100).toFixed(1)}%`);
    console.log(`   P(+100%): ${(results.baselines.p100 * 100).toFixed(1)}%`);
    console.log(`   P(-50%): ${(results.baselines.pLose50 * 100).toFixed(1)}%`);
    console.log('');

    console.log('🎯 Alert Rules Performance:');
    console.log('─'.repeat(60));

    results.results.forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.rule.name} (${result.rule.alert_type.toUpperCase()}):`);
      console.log(`   Thresholds:`);
      if (result.rule.health_min !== null) console.log(`     Health ≥ ${result.rule.health_min}`);
      if (result.rule.fresh_pct_min !== null) console.log(`     Fresh% ≥ ${(result.rule.fresh_pct_min * 100).toFixed(0)}%`);
      if (result.rule.sniper_pct_max !== null) console.log(`     Sniper% ≤ ${(result.rule.sniper_pct_max * 100).toFixed(0)}%`);
      if (result.rule.insider_pct_max !== null) console.log(`     Insider% ≤ ${(result.rule.insider_pct_max * 100).toFixed(0)}%`);
      if (result.rule.liquidity_min !== null) console.log(`     Liquidity ≥ $${result.rule.liquidity_min.toLocaleString()}`);
      if (result.rule.holders_min !== null) console.log(`     Holders ≥ ${result.rule.holders_min}`);
      
      console.log(`   Performance:`);
      console.log(`     Precision (+50%): ${(result.precision50 * 100).toFixed(1)}%`);
      console.log(`     Precision (+100%): ${(result.precision100 * 100).toFixed(1)}%`);
      console.log(`     Lift (+50%): ${result.lift50.toFixed(2)}x`);
      console.log(`     Lift (+100%): ${result.lift100.toFixed(2)}x`);
      console.log(`     Volume: ${result.volumePerDay.toFixed(1)} alerts/day`);
      console.log(`     Tokens Triggered: ${result.totalTriggered}`);
    });

    return '';
  }
}

// Export for CLI usage
module.exports = {
  BacktestHarnessWorker,
  runBacktest: async (sampleSize = 500, since = '7d') => {
    const worker = new BacktestHarnessWorker();
    return await worker.runBacktest(sampleSize, since);
  },
  mainLoop: async () => {
    const worker = new BacktestHarnessWorker();
    const results = await worker.runBacktest();
    if (results) {
      worker.formatBacktestResults(results);
    }
    logger.success('backtest-harness', 'system', 'complete', 'Backtest Harness Worker completed');
  }
};

// Run if called directly
if (require.main === module) {
  const worker = new BacktestHarnessWorker();
  worker.runBacktest().then((results) => {
    if (results) {
      worker.formatBacktestResults(results);
    }
    console.log('✅ Backtest Harness Worker completed');
    process.exit(0);
  }).catch(error => {
    console.error('❌ Backtest Harness Worker failed:', error.message);
    process.exit(1);
  });
}
