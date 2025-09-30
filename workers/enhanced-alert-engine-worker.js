// workers/enhanced-alert-engine-worker.js - Enhanced Alert Engine with Quality Gates
const Database = require('better-sqlite3');
const logger = require('../lib/logger');
const { formatTokenDisplayWithHealth, formatHealthBadge } = require('../lib/visual-encoding');
const EnhancedHealthScoring = require('../lib/enhanced-health-scoring');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

class EnhancedAlertEngine {
  constructor() {
    this.healthScoring = new EnhancedHealthScoring();
    this.alertCooldowns = new Map(); // Track alert cooldowns per mint
    this.priceFeeds = new Map(); // Track price feed conflicts
  }

  /**
   * Check for price feed conflicts
   * @param {string} mint - Token mint
   * @returns {boolean} True if price conflict detected
   */
  checkPriceFeedConflict(mint) {
    try {
      // This would integrate with multiple price feeds
      // For now, simulate a simple conflict check
      const feeds = this.getPriceFeeds(mint);
      if (feeds.length < 2) return false;

      const [feedA, feedB] = feeds;
      const priceDiff = Math.abs(feedA.price - feedB.price) / Math.min(feedA.price, feedB.price);
      
      if (priceDiff > 0.15) { // 15% difference
        logger.warning('alert-engine', mint, 'price_conflict', `Price feeds differ by ${(priceDiff * 100).toFixed(1)}%`);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('alert-engine', mint, 'price_conflict_error', `Failed to check price conflict: ${error.message}`);
      return false;
    }
  }

  /**
   * Get price feeds for a token (simulated)
   * @param {string} mint - Token mint
   * @returns {Array} Array of price feed data
   */
  getPriceFeeds(mint) {
    // This would integrate with real price feeds
    // For now, return simulated data
    return [
      { source: 'dexscreener', price: 0.001, timestamp: Date.now() },
      { source: 'birdeye', price: 0.0011, timestamp: Date.now() }
    ];
  }

  /**
   * Check snapshot agreement for Launch alerts
   * @param {string} mint - Token mint
   * @param {object} thresholds - Alert thresholds
   * @returns {boolean} True if snapshots agree
   */
  checkSnapshotAgreement(mint, thresholds) {
    try {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();

      // Get current and previous snapshots
      const snapshots = db.prepare(`
        SELECT * FROM score_history
        WHERE mint = ? AND snapshot_time >= ?
        ORDER BY snapshot_time DESC
        LIMIT 2
      `).all(mint, fiveMinutesAgo);

      if (snapshots.length < 2) return false;

      const [current, previous] = snapshots;

      // Check if both snapshots meet Launch thresholds
      const currentMeets = this.checkLaunchThresholds(current, thresholds);
      const previousMeets = this.checkLaunchThresholds(previous, thresholds);

      return currentMeets && previousMeets;
    } catch (error) {
      logger.error('alert-engine', mint, 'snapshot_agreement_error', `Failed to check snapshot agreement: ${error.message}`);
      return false;
    }
  }

  /**
   * Check Launch alert thresholds
   * @param {object} snapshot - Score snapshot data
   * @param {object} thresholds - Alert thresholds
   * @returns {boolean} True if thresholds met
   */
  checkLaunchThresholds(snapshot, thresholds) {
    return snapshot.health_score >= thresholds.health_min &&
           snapshot.liquidity_usd >= thresholds.liquidity_min &&
           snapshot.holders_count >= thresholds.holders_min;
  }

  /**
   * Check holder growth guard
   * @param {string} mint - Token mint
   * @param {number} requiredGrowth - Required holder growth
   * @returns {boolean} True if growth requirement met
   */
  checkHolderGrowthGuard(mint, requiredGrowth = 30) {
    try {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      const snapshots = db.prepare(`
        SELECT holders_count, snapshot_time
        FROM score_history
        WHERE mint = ? AND snapshot_time >= ?
        ORDER BY snapshot_time ASC
        LIMIT 2
      `).all(mint, tenMinutesAgo);

      if (snapshots.length < 2) return false;

      const [old, recent] = snapshots;
      const holderGrowth = recent.holders_count - old.holders_count;

      return holderGrowth >= requiredGrowth;
    } catch (error) {
      logger.error('alert-engine', mint, 'holder_growth_error', `Failed to check holder growth: ${error.message}`);
      return false;
    }
  }

  /**
   * Check score slope guard
   * @param {string} mint - Token mint
   * @param {number} requiredSlope - Required score change
   * @returns {boolean} True if slope requirement met
   */
  checkScoreSlopeGuard(mint, requiredSlope) {
    try {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      const snapshots = db.prepare(`
        SELECT health_score, snapshot_time
        FROM score_history
        WHERE mint = ? AND snapshot_time >= ?
        ORDER BY snapshot_time ASC
        LIMIT 2
      `).all(mint, tenMinutesAgo);

      if (snapshots.length < 2) return false;

      const [old, recent] = snapshots;
      const scoreChange = recent.health_score - old.health_score;

      return scoreChange >= requiredSlope;
    } catch (error) {
      logger.error('alert-engine', mint, 'score_slope_error', `Failed to check score slope: ${error.message}`);
      return false;
    }
  }

  /**
   * Check alert cooldown
   * @param {string} mint - Token mint
   * @param {string} alertType - Type of alert
   * @returns {boolean} True if cooldown active
   */
  checkAlertCooldown(mint, alertType) {
    const key = `${mint}:${alertType}`;
    const lastAlert = this.alertCooldowns.get(key);
    
    if (!lastAlert) return false;

    const cooldownMinutes = 20; // 20 minutes cooldown
    const cooldownMs = cooldownMinutes * 60 * 1000;
    
    return (Date.now() - lastAlert) < cooldownMs;
  }

  /**
   * Set alert cooldown
   * @param {string} mint - Token mint
   * @param {string} alertType - Type of alert
   */
  setAlertCooldown(mint, alertType) {
    const key = `${mint}:${alertType}`;
    this.alertCooldowns.set(key, Date.now());
  }

  /**
   * Generate explainable alert message
   * @param {object} token - Token data
   * @param {string} alertType - Type of alert
   * @param {object} thresholds - Alert thresholds
   * @param {object} features - Token features
   * @returns {string} Explainable alert message
   */
  generateExplainableAlert(token, alertType, thresholds, features) {
    const tokenDisplay = formatTokenDisplayWithHealth(token.symbol, token.mint, token.health_score, false);
    const healthBadge = formatHealthBadge(token.health_score, false);
    const liquidity = token.liquidity_usd ? `$${(token.liquidity_usd / 1000).toFixed(1)}k` : '$0';
    
    // Calculate why this fired
    const whyReasons = [];
    const riskCaveats = [];

    if (alertType === 'launch') {
      if (features.freshPct >= 0.6) whyReasons.push(`Fresh ${(features.freshPct * 100).toFixed(0)}% ≥ 60%`);
      if (features.sniperPct <= 0.05) whyReasons.push(`Snipers ${(features.sniperPct * 100).toFixed(0)}% ≤ 5%`);
      if (features.insiderPct <= 0.08) whyReasons.push(`Insiders ${(features.insiderPct * 100).toFixed(0)}% ≤ 8%`);
      if (token.liquidity_usd >= thresholds.liquidity_min) whyReasons.push(`Liq ${liquidity} ≥ $${(thresholds.liquidity_min / 1000).toFixed(0)}k`);
      
      // Check for score momentum
      const scoreChange = this.getScoreChange(token.mint, 10);
      if (scoreChange > 0) whyReasons.push(`ΔHealth@10m +${scoreChange.toFixed(0)}`);
    }

    // Add risk caveats
    if (features.top10Pct > 0.6) riskCaveats.push('High Top10%');
    if (this.checkPriceFeedConflict(token.mint)) riskCaveats.push('Price feed conflict');

    const baseMessage = `${tokenDisplay} • ${healthBadge}
Fresh ${(features.freshPct * 100).toFixed(0)}% • Snipers ${(features.sniperPct * 100).toFixed(0)}% • Insiders ${(features.insiderPct * 100).toFixed(0)}% • Liq ${liquidity}`;

    const whyLine = whyReasons.length > 0 ? `\nWhy: ${whyReasons.join(', ')}` : '';
    const riskLine = riskCaveats.length > 0 ? `\n⚠️ ${riskCaveats.join(', ')}` : '';

    switch (alertType) {
      case 'launch':
        return `🚀 ${tokenDisplay} • Health ${token.health_score.toFixed(0)} ${healthBadge}${whyLine}${riskLine}`;
      case 'momentum_upgrade':
        return `📈 ${tokenDisplay} • Health ${token.health_score.toFixed(0)} ${healthBadge}${whyLine}${riskLine}`;
      case 'risk':
        return `⚠️ ${tokenDisplay} • Health ${token.health_score.toFixed(0)} ${healthBadge}${whyLine}${riskLine}`;
      default:
        return `🔔 ${tokenDisplay} • Health ${token.health_score.toFixed(0)} ${healthBadge}${whyLine}${riskLine}`;
    }
  }

  /**
   * Get score change over time
   * @param {string} mint - Token mint
   * @param {number} minutes - Time window in minutes
   * @returns {number} Score change
   */
  getScoreChange(mint, minutes) {
    try {
      const timeAgo = new Date(Date.now() - minutes * 60 * 1000).toISOString();
      
      const snapshots = db.prepare(`
        SELECT health_score, snapshot_time
        FROM score_history
        WHERE mint = ? AND snapshot_time >= ?
        ORDER BY snapshot_time ASC
        LIMIT 2
      `).all(mint, timeAgo);

      if (snapshots.length < 2) return 0;

      const [old, recent] = snapshots;
      return recent.health_score - old.health_score;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Process enhanced alerts for a token
   * @param {object} token - Token data
   * @param {object} rule - Alert rule
   */
  async processEnhancedAlerts(token, rule) {
    const { mint, symbol } = token;
    
    try {
      // Check cooldown first
      if (this.checkAlertCooldown(mint, rule.alert_type)) {
        logger.debug('alert-engine', mint, 'cooldown', `Alert for ${symbol} in cooldown`);
        return;
      }

      // Check price feed conflicts
      if (this.checkPriceFeedConflict(mint)) {
        logger.debug('alert-engine', mint, 'price_conflict', `Alert for ${symbol} suppressed due to price conflict`);
        return;
      }

      // Parse thresholds
      const thresholds = JSON.parse(rule.thresholds);
      const hardMuteConditions = JSON.parse(rule.hard_mute_conditions);

      // Check hard mute conditions
      if (this.checkHardMute(token, hardMuteConditions)) {
        logger.debug('alert-engine', mint, 'hard_muted', `Token ${symbol} muted by hard conditions`);
        return;
      }

      // Check basic alert conditions
      if (!this.checkAlertConditions(token, thresholds)) {
        logger.debug('alert-engine', mint, 'conditions_not_met', `Token ${symbol} does not meet alert conditions`);
        return;
      }

      // Apply quality gates based on alert type
      if (rule.alert_type === 'launch') {
        // Require snapshot agreement for Launch alerts
        if (!this.checkSnapshotAgreement(mint, thresholds)) {
          logger.debug('alert-engine', mint, 'snapshot_disagreement', `Launch alert for ${symbol} requires snapshot agreement`);
          return;
        }

        // Require holder growth
        if (!this.checkHolderGrowthGuard(mint, 30)) {
          logger.debug('alert-engine', mint, 'insufficient_growth', `Launch alert for ${symbol} requires holder growth`);
          return;
        }

        // Require positive score slope
        if (!this.checkScoreSlopeGuard(mint, 5)) {
          logger.debug('alert-engine', mint, 'insufficient_slope', `Launch alert for ${symbol} requires positive score slope`);
          return;
        }
      } else if (rule.alert_type === 'risk') {
        // For risk alerts, check score slope (negative)
        if (!this.checkScoreSlopeGuard(mint, -8)) {
          logger.debug('alert-engine', mint, 'insufficient_risk_slope', `Risk alert for ${symbol} requires negative score slope`);
          return;
        }
      }

      // Generate enhanced alert message
      const features = {
        freshPct: token.fresh_pct || 0,
        sniperPct: token.sniper_pct || 0,
        insiderPct: token.insider_pct || 0,
        top10Pct: token.top10_share || 0
      };

      const message = this.generateExplainableAlert(token, rule.alert_type, thresholds, features);
      const metadata = JSON.stringify({
        health_score: token.health_score,
        holders_count: token.holders_count,
        liquidity_usd: token.liquidity_usd,
        fresh_pct: token.fresh_pct,
        sniper_pct: token.sniper_pct,
        insider_pct: token.insider_pct,
        top10_share: token.top10_share,
        rule_name: rule.rule_name,
        why_fired: this.getWhyFired(token, rule.alert_type, thresholds, features),
        risk_caveats: this.getRiskCaveats(token, features)
      });

      // Insert alert
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO alerts 
        (mint, alert_type, alert_level, message, triggered_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(mint, rule.alert_type, 'high', message, now, metadata);

      // Set cooldown
      this.setAlertCooldown(mint, rule.alert_type);

      logger.success('alert-engine', mint, 'alert_triggered', `Enhanced alert triggered for ${symbol}`, {
        alert_type: rule.alert_type,
        rule_name: rule.rule_name,
        health_score: token.health_score
      });

    } catch (error) {
      logger.error('alert-engine', mint, 'alert_failed', `Failed to process enhanced alerts for ${symbol}: ${error.message}`);
    }
  }

  /**
   * Get why alert fired
   * @param {object} token - Token data
   * @param {string} alertType - Alert type
   * @param {object} thresholds - Thresholds
   * @param {object} features - Features
   * @returns {string} Why alert fired
   */
  getWhyFired(token, alertType, thresholds, features) {
    const reasons = [];
    
    if (alertType === 'launch') {
      if (features.freshPct >= 0.6) reasons.push(`Fresh ${(features.freshPct * 100).toFixed(0)}% ≥ 60%`);
      if (features.sniperPct <= 0.05) reasons.push(`Snipers ${(features.sniperPct * 100).toFixed(0)}% ≤ 5%`);
      if (features.insiderPct <= 0.08) reasons.push(`Insiders ${(features.insiderPct * 100).toFixed(0)}% ≤ 8%`);
      if (token.liquidity_usd >= thresholds.liquidity_min) reasons.push(`Liq $${(token.liquidity_usd / 1000).toFixed(1)}k ≥ $${(thresholds.liquidity_min / 1000).toFixed(0)}k`);
      
      const scoreChange = this.getScoreChange(token.mint, 10);
      if (scoreChange > 0) reasons.push(`ΔHealth@10m +${scoreChange.toFixed(0)}`);
    }
    
    return reasons.join(', ');
  }

  /**
   * Get risk caveats
   * @param {object} token - Token data
   * @param {object} features - Features
   * @returns {Array} Risk caveats
   */
  getRiskCaveats(token, features) {
    const caveats = [];
    
    if (features.top10Pct > 0.6) caveats.push('High Top10%');
    if (this.checkPriceFeedConflict(token.mint)) caveats.push('Price feed conflict');
    
    return caveats;
  }

  /**
   * Check hard mute conditions (same as before)
   */
  checkHardMute(token, hardMuteConditions) {
    try {
      if (hardMuteConditions.liquidity_min && token.liquidity_usd < hardMuteConditions.liquidity_min) {
        return true;
      }
      if (hardMuteConditions.holders_min && token.holders_count < hardMuteConditions.holders_min) {
        return true;
      }
      if (hardMuteConditions.sniper_pct_max && token.sniper_pct > hardMuteConditions.sniper_pct_max) {
        return true;
      }
      if (hardMuteConditions.insider_pct_max && token.insider_pct > hardMuteConditions.insider_pct_max) {
        return true;
      }
      if (hardMuteConditions.top10_share_max && token.top10_share > hardMuteConditions.top10_share_max) {
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check alert conditions (same as before)
   */
  checkAlertConditions(token, thresholds) {
    try {
      if (thresholds.health_min && token.health_score < thresholds.health_min) {
        return false;
      }
      if (thresholds.health_max && token.health_score > thresholds.health_max) {
        return false;
      }
      if (thresholds.liquidity_min && token.liquidity_usd < thresholds.liquidity_min) {
        return false;
      }
      if (thresholds.holders_min && token.holders_count < thresholds.holders_min) {
        return false;
      }
      if (thresholds.fresh_pct_min && token.fresh_pct < thresholds.fresh_pct_min) {
        return false;
      }
      if (thresholds.sniper_pct_max && token.sniper_pct > thresholds.sniper_pct_max) {
        return false;
      }
      if (thresholds.insider_pct_max && token.insider_pct > thresholds.insider_pct_max) {
        return false;
      }
      if (thresholds.top10_share_max && token.top10_share > thresholds.top10_share_max) {
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Main processing loop
   */
  async processAlerts() {
    logger.info('alert-engine', 'system', 'start', 'Starting enhanced alert processing');
    
    try {
      // Get active alert rules
      const rules = db.prepare('SELECT * FROM alert_rules WHERE is_active = 1').all();
      if (rules.length === 0) {
        logger.warning('alert-engine', 'system', 'no_rules', 'No active alert rules found');
        return;
      }

      // Get tokens for alert checking
      const tokens = db.prepare(`
        SELECT 
          t.mint, t.symbol, t.name, t.health_score, t.holders_count, 
          t.liquidity_usd, t.fresh_pct, t.sniper_pct, t.insider_pct, t.top10_share
        FROM tokens t
        WHERE t.health_score IS NOT NULL
          AND t.holders_count IS NOT NULL
          AND t.liquidity_usd IS NOT NULL
          AND t.fresh_pct IS NOT NULL
          AND t.sniper_pct IS NOT NULL
          AND t.insider_pct IS NOT NULL
          AND t.top10_share IS NOT NULL
        ORDER BY t.first_seen_at DESC
        LIMIT 100
      `).all();

      if (tokens.length === 0) {
        logger.warning('alert-engine', 'system', 'no_tokens', 'No tokens found for alert checking');
        return;
      }

      logger.info('alert-engine', 'system', 'processing', `Processing ${tokens.length} tokens with ${rules.length} rules`);

      // Process each token against each rule
      for (const token of tokens) {
        for (const rule of rules) {
          await this.processEnhancedAlerts(token, rule);
        }
      }

      logger.success('alert-engine', 'system', 'complete', 'Enhanced alert processing completed');

    } catch (error) {
      logger.error('alert-engine', 'system', 'failed', `Enhanced alert processing failed: ${error.message}`);
      throw error;
    }
  }
}

// Export for CLI usage
module.exports = {
  EnhancedAlertEngine,
  processAlerts: async () => {
    const engine = new EnhancedAlertEngine();
    await engine.processAlerts();
  },
  mainLoop: async () => {
    const engine = new EnhancedAlertEngine();
    await engine.processAlerts();
    logger.success('alert-engine', 'system', 'complete', 'Enhanced Alert Engine Worker completed');
  }
};

// Run if called directly
if (require.main === module) {
  const engine = new EnhancedAlertEngine();
  engine.processAlerts().then(() => {
    console.log('✅ Enhanced Alert Engine Worker completed');
    process.exit(0);
  }).catch(error => {
    console.error('❌ Enhanced Alert Engine Worker failed:', error.message);
    process.exit(1);
  });
}

