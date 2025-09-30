// lib/backtest-methodology.js - Backtest methodology for objective threshold tuning
const Database = require('better-sqlite3');

class BacktestMethodology {
  constructor(dbPath = 'db/agent.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
  }

  /**
   * Run stratified sampling to ensure representative token distribution
   * @param {number} sampleSize - Number of tokens to sample
   * @returns {Array} Stratified sample
   */
  stratifiedSampling(sampleSize = 1000) {
    try {
      // Get tokens with different liquidity and age ranges
      const liquidityRanges = [
        { min: 1000, max: 10000, weight: 0.3 },    // Low liquidity
        { min: 10000, max: 100000, weight: 0.4 },  // Medium liquidity
        { min: 100000, max: 1000000, weight: 0.3 } // High liquidity
      ];

      const ageRanges = [
        { min: 0, max: 2, weight: 0.4 },    // Early (0-2 hours)
        { min: 2, max: 24, weight: 0.4 },   // Mid (2-24 hours)
        { min: 24, max: 168, weight: 0.2 }  // Late (1-7 days)
      ];

      const samples = [];

      // Sample from each liquidity/age combination
      for (const liqRange of liquidityRanges) {
        for (const ageRange of ageRanges) {
          const rangeSampleSize = Math.floor(sampleSize * liqRange.weight * ageRange.weight);
          
          const rangeSample = this.db.prepare(`
            SELECT t.*, 
              (julianday('now') - julianday(t.first_seen_at)) * 24 as age_hours
            FROM tokens t
            WHERE t.health_score IS NOT NULL
              AND t.liquidity_usd >= ? AND t.liquidity_usd < ?
              AND (julianday('now') - julianday(t.first_seen_at)) * 24 >= ?
              AND (julianday('now') - julianday(t.first_seen_at)) * 24 < ?
            ORDER BY RANDOM()
            LIMIT ?
          `).all(liqRange.min, liqRange.max, ageRange.min, ageRange.max, rangeSampleSize);

          samples.push(...rangeSample);
        }
      }

      return samples.slice(0, sampleSize);
    } catch (error) {
      console.error('Failed to perform stratified sampling:', error.message);
      return [];
    }
  }

  /**
   * Calculate precision and lift for alert rules
   * @param {Array} alerts - Alert data
   * @param {Array} tokens - Token data
   * @param {string} alertType - Type of alert
   * @returns {object} Precision and lift metrics
   */
  calculatePrecisionAndLift(alerts, tokens, alertType) {
    try {
      const alertTokens = new Set(alerts.map(a => a.mint));
      const totalTokens = tokens.length;
      const totalAlerts = alerts.length;

      // Calculate true positives (alerts that were actually good)
      const truePositives = this.calculateTruePositives(alerts, alertType);
      const falsePositives = totalAlerts - truePositives;

      // Calculate precision (PPV)
      const precision = totalAlerts > 0 ? truePositives / totalAlerts : 0;

      // Calculate baseline (random selection)
      const baseline = this.calculateBaseline(tokens, alertType);

      // Calculate lift
      const lift = baseline > 0 ? precision / baseline : 0;

      return {
        precision: Math.round(precision * 1000) / 1000,
        lift: Math.round(lift * 1000) / 1000,
        truePositives,
        falsePositives,
        totalAlerts,
        baseline
      };
    } catch (error) {
      console.error('Failed to calculate precision and lift:', error.message);
      return { precision: 0, lift: 0, truePositives: 0, falsePositives: 0, totalAlerts: 0, baseline: 0 };
    }
  }

  /**
   * Calculate true positives based on post-alert performance
   * @param {Array} alerts - Alert data
   * @param {string} alertType - Type of alert
   * @returns {number} Number of true positives
   */
  calculateTruePositives(alerts, alertType) {
    let truePositives = 0;

    for (const alert of alerts) {
      const performance = this.getPostAlertPerformance(alert.mint, alert.triggered_at, alertType);
      if (performance.isPositive) {
        truePositives++;
      }
    }

    return truePositives;
  }

  /**
   * Get post-alert performance metrics
   * @param {string} mint - Token mint
   * @param {string} alertTime - When alert was triggered
   * @param {string} alertType - Type of alert
   * @returns {object} Performance metrics
   */
  getPostAlertPerformance(mint, alertTime, alertType) {
    try {
      const alertTimestamp = new Date(alertTime);
      const oneHourLater = new Date(alertTimestamp.getTime() + 60 * 60 * 1000);

      // Get health score at alert time and 1 hour later
      const healthAtAlert = this.db.prepare(`
        SELECT health_score
        FROM score_history
        WHERE mint = ? AND snapshot_time <= ?
        ORDER BY snapshot_time DESC
        LIMIT 1
      `).get(mint, alertTime);

      const healthAfter = this.db.prepare(`
        SELECT health_score
        FROM score_history
        WHERE mint = ? AND snapshot_time >= ?
        ORDER BY snapshot_time ASC
        LIMIT 1
      `).get(mint, oneHourLater.toISOString());

      if (!healthAtAlert || !healthAfter) {
        return { isPositive: false, healthChange: 0 };
      }

      const healthChange = healthAfter.health_score - healthAtAlert.health_score;

      // Define positive performance based on alert type
      let isPositive = false;
      if (alertType === 'launch') {
        isPositive = healthChange >= 0; // Health maintained or improved
      } else if (alertType === 'momentum_upgrade') {
        isPositive = healthChange >= 5; // Health improved by at least 5 points
      } else if (alertType === 'risk') {
        isPositive = healthChange <= -5; // Health declined by at least 5 points
      }

      return { isPositive, healthChange };
    } catch (error) {
      return { isPositive: false, healthChange: 0 };
    }
  }

  /**
   * Calculate baseline performance (random selection)
   * @param {Array} tokens - Token data
   * @param {string} alertType - Type of alert
   * @returns {number} Baseline performance
   */
  calculateBaseline(tokens, alertType) {
    // This would be calculated based on historical data
    // For now, return a simple baseline
    const totalTokens = tokens.length;
    const goodTokens = tokens.filter(t => t.health_score >= 60).length;
    return goodTokens / totalTokens;
  }

  /**
   * Control alert volume by adjusting thresholds
   * @param {string} alertType - Type of alert
   * @param {number} targetVolume - Target daily volume
   * @returns {object} Adjusted thresholds
   */
  controlAlertVolume(alertType, targetVolume = 30) {
    try {
      // Get current alert volume for the last 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      
      const currentVolume = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM alerts
        WHERE alert_type = ? AND triggered_at >= ?
      `).get(alertType, sevenDaysAgo);

      const dailyVolume = currentVolume.count / 7;

      if (dailyVolume <= targetVolume) {
        return null; // No adjustment needed
      }

      // Calculate adjustment factor
      const adjustmentFactor = targetVolume / dailyVolume;

      // Get current thresholds
      const currentRule = this.db.prepare(`
        SELECT * FROM alert_rules WHERE alert_type = ? AND is_active = 1
      `).get(alertType);

      if (!currentRule) return null;

      const currentThresholds = JSON.parse(currentRule.thresholds);
      const adjustedThresholds = { ...currentThresholds };

      // Adjust thresholds based on alert type
      if (alertType === 'launch') {
        adjustedThresholds.health_min = Math.min(100, currentThresholds.health_min * (1 + adjustmentFactor * 0.1));
        adjustedThresholds.liquidity_min = Math.floor(currentThresholds.liquidity_min * (1 + adjustmentFactor * 0.2));
        adjustedThresholds.holders_min = Math.floor(currentThresholds.holders_min * (1 + adjustmentFactor * 0.1));
      } else if (alertType === 'momentum_upgrade') {
        adjustedThresholds.health_min = Math.min(100, currentThresholds.health_min * (1 + adjustmentFactor * 0.1));
        adjustedThresholds.fresh_pct_min = Math.min(1, currentThresholds.fresh_pct_min * (1 + adjustmentFactor * 0.1));
      } else if (alertType === 'risk') {
        adjustedThresholds.health_max = Math.max(0, currentThresholds.health_max * (1 - adjustmentFactor * 0.1));
        adjustedThresholds.sniper_pct_max = Math.max(0, currentThresholds.sniper_pct_max * (1 - adjustmentFactor * 0.1));
        adjustedThresholds.insider_pct_max = Math.max(0, currentThresholds.insider_pct_max * (1 - adjustmentFactor * 0.1));
      }

      return {
        alertType,
        currentVolume: Math.round(dailyVolume * 100) / 100,
        targetVolume,
        adjustmentFactor: Math.round(adjustmentFactor * 1000) / 1000,
        adjustedThresholds
      };
    } catch (error) {
      console.error('Failed to control alert volume:', error.message);
      return null;
    }
  }

  /**
   * Rolling re-tune thresholds weekly
   * @returns {object} Re-tuning results
   */
  rollingRetune() {
    try {
      const rulesetId = `ruleset_${Date.now()}`;
      const retuneResults = {};

      // Get all active alert types
      const alertTypes = ['launch', 'momentum_upgrade', 'risk'];

      for (const alertType of alertTypes) {
        // Get stratified sample
        const sample = this.stratifiedSampling(500);
        
        // Get recent alerts for this type
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const alerts = this.db.prepare(`
          SELECT * FROM alerts
          WHERE alert_type = ? AND triggered_at >= ?
        `).all(alertType, sevenDaysAgo);

        // Calculate metrics
        const metrics = this.calculatePrecisionAndLift(alerts, sample, alertType);
        
        // Control volume
        const volumeControl = this.controlAlertVolume(alertType, 30);

        retuneResults[alertType] = {
          metrics,
          volumeControl,
          rulesetId
        };
      }

      // Store re-tuning results
      this.storeRetuneResults(rulesetId, retuneResults);

      return {
        rulesetId,
        results: retuneResults,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Failed to perform rolling re-tune:', error.message);
      return null;
    }
  }

  /**
   * Store re-tuning results
   * @param {string} rulesetId - Ruleset identifier
   * @param {object} results - Re-tuning results
   */
  storeRetuneResults(rulesetId, results) {
    try {
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS retune_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ruleset_id TEXT NOT NULL,
          alert_type TEXT NOT NULL,
          precision REAL,
          lift REAL,
          volume_control TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `).run();

      for (const [alertType, result] of Object.entries(results)) {
        this.db.prepare(`
          INSERT INTO retune_results (ruleset_id, alert_type, precision, lift, volume_control)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          rulesetId,
          alertType,
          result.metrics.precision,
          result.metrics.lift,
          JSON.stringify(result.volumeControl)
        );
      }
    } catch (error) {
      console.error('Failed to store re-tuning results:', error.message);
    }
  }

  /**
   * Get backtest results for CLI display
   * @returns {object} Backtest results
   */
  getBacktestResults() {
    try {
      const results = this.db.prepare(`
        SELECT 
          ruleset_id,
          alert_type,
          precision,
          lift,
          volume_control,
          created_at
        FROM retune_results
        WHERE created_at >= datetime('now', '-7 days')
        ORDER BY created_at DESC
      `).all();

      // Group by ruleset_id
      const groupedResults = {};
      for (const result of results) {
        if (!groupedResults[result.ruleset_id]) {
          groupedResults[result.ruleset_id] = {
            rulesetId: result.ruleset_id,
            timestamp: result.created_at,
            alerts: {}
          };
        }
        groupedResults[result.ruleset_id].alerts[result.alert_type] = {
          precision: result.precision,
          lift: result.lift,
          volumeControl: JSON.parse(result.volume_control || '{}')
        };
      }

      return Object.values(groupedResults);
    } catch (error) {
      console.error('Failed to get backtest results:', error.message);
      return [];
    }
  }

  /**
   * Format backtest results for CLI display
   * @returns {string} Formatted results
   */
  formatBacktestResults() {
    const results = this.getBacktestResults();
    
    if (results.length === 0) {
      return 'No backtest results found for the last 7 days';
    }

    console.log('📊 Backtest Results (Last 7 Days):');
    console.log('─'.repeat(80));

    results.forEach((ruleset, index) => {
      console.log(`\n${index + 1}. Ruleset: ${ruleset.rulesetId}`);
      console.log(`   Timestamp: ${new Date(ruleset.timestamp).toLocaleString()}`);
      console.log('   ─'.repeat(60));

      for (const [alertType, metrics] of Object.entries(ruleset.alerts)) {
        const volumeInfo = metrics.volumeControl && metrics.volumeControl.currentVolume 
          ? ` (Vol: ${metrics.volumeControl.currentVolume}/day)`
          : '';
        
        console.log(`   ${alertType.toUpperCase()}:`);
        console.log(`     Precision: ${(metrics.precision * 100).toFixed(1)}%`);
        console.log(`     Lift: ${metrics.lift.toFixed(2)}x`);
        const baseline = metrics.volumeControl && metrics.volumeControl.baseline 
          ? (metrics.volumeControl.baseline * 100).toFixed(1)
          : 'N/A';
        console.log(`     Baseline: ${baseline}%${volumeInfo}`);
      }
    });

    return '';
  }
}

module.exports = BacktestMethodology;
