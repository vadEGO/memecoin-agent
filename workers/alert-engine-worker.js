// workers/alert-engine-worker.js - Task 9 Alert Engine v2
const Database = require('better-sqlite3');
const logger = require('../lib/logger');
const { formatTokenDisplayWithHealth, formatHealthBadge } = require('../lib/visual-encoding');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

// --- Database Queries ---
const getActiveAlertRules = db.prepare(`
  SELECT * FROM alert_rules WHERE is_active = 1
`);

const getTokensForAlertCheck = db.prepare(`
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
`);

const checkRecentAlerts = db.prepare(`
  SELECT COUNT(*) as count
  FROM alerts 
  WHERE mint = ? 
    AND alert_type = ? 
    AND triggered_at > datetime('now', '-? minutes')
`);

const insertAlert = db.prepare(`
  INSERT OR IGNORE INTO alerts 
  (mint, alert_type, alert_level, message, triggered_at, metadata)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertAlertHistory = db.prepare(`
  INSERT OR IGNORE INTO alert_history 
  (mint, alert_type, triggered_at, metadata)
  VALUES (?, ?, ?, ?)
`);

const updateAlertStatus = db.prepare(`
  UPDATE alerts 
  SET status = ?, resolved_at = ?
  WHERE mint = ? AND alert_type = ? AND status = 'active'
`);

// --- Alert Engine Functions ---

/**
 * Check if token meets hard mute conditions
 * @param {object} token - Token data
 * @param {object} hardMuteConditions - Hard mute conditions from rule
 * @returns {boolean} True if token should be muted
 */
function checkHardMute(token, hardMuteConditions) {
  try {
    const conditions = JSON.parse(hardMuteConditions);
    
    // Check liquidity minimum
    if (conditions.liquidity_min && token.liquidity_usd < conditions.liquidity_min) {
      return true;
    }
    
    // Check holders minimum
    if (conditions.holders_min && token.holders_count < conditions.holders_min) {
      return true;
    }
    
    // Check sniper percentage maximum
    if (conditions.sniper_pct_max && token.sniper_pct > conditions.sniper_pct_max) {
      return true;
    }
    
    // Check insider percentage maximum
    if (conditions.insider_pct_max && token.insider_pct > conditions.insider_pct_max) {
      return true;
    }
    
    // Check top 10 share maximum
    if (conditions.top10_share_max && token.top10_share > conditions.top10_share_max) {
      return true;
    }
    
    return false;
  } catch (error) {
    logger.error('alert-engine', token.mint, 'hard_mute_error', `Failed to parse hard mute conditions: ${error.message}`);
    return false;
  }
}

/**
 * Check if token meets alert conditions
 * @param {object} token - Token data
 * @param {object} rule - Alert rule
 * @returns {boolean} True if token meets conditions
 */
function checkAlertConditions(token, rule) {
  try {
    const thresholds = JSON.parse(rule.thresholds);
    
    // Check health score minimum
    if (thresholds.health_min && token.health_score < thresholds.health_min) {
      return false;
    }
    
    // Check health score maximum
    if (thresholds.health_max && token.health_score > thresholds.health_max) {
      return false;
    }
    
    // Check liquidity minimum
    if (thresholds.liquidity_min && token.liquidity_usd < thresholds.liquidity_min) {
      return false;
    }
    
    // Check holders minimum
    if (thresholds.holders_min && token.holders_count < thresholds.holders_min) {
      return false;
    }
    
    // Check fresh percentage minimum
    if (thresholds.fresh_pct_min && token.fresh_pct < thresholds.fresh_pct_min) {
      return false;
    }
    
    // Check sniper percentage maximum
    if (thresholds.sniper_pct_max && token.sniper_pct > thresholds.sniper_pct_max) {
      return false;
    }
    
    // Check insider percentage maximum
    if (thresholds.insider_pct_max && token.insider_pct > thresholds.insider_pct_max) {
      return false;
    }
    
    // Check top 10 share maximum
    if (thresholds.top10_share_max && token.top10_share > thresholds.top10_share_max) {
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error('alert-engine', token.mint, 'conditions_error', `Failed to parse alert conditions: ${error.message}`);
    return false;
  }
}

/**
 * Generate alert message based on type and token data
 * @param {object} token - Token data
 * @param {string} alertType - Type of alert
 * @returns {string} Formatted alert message
 */
function generateAlertMessage(token, alertType) {
  const tokenDisplay = formatTokenDisplayWithHealth(token.symbol, token.mint, token.health_score, false);
  const healthBadge = formatHealthBadge(token.health_score, false);
  const liquidity = token.liquidity_usd ? `$${(token.liquidity_usd / 1000).toFixed(1)}k` : '$0';
  
  const baseMessage = `${tokenDisplay} • ${healthBadge}
Holders: ${token.holders_count} • Liq: ${liquidity}
Fresh: ${token.fresh_pct.toFixed(1)}% • Snipers: ${token.sniper_pct.toFixed(1)}% • Insiders: ${token.insider_pct.toFixed(1)}%`;

  switch (alertType) {
    case 'launch':
      return `🚀 LAUNCH ALERT: ${baseMessage}`;
    case 'momentum_upgrade':
      return `📈 MOMENTUM UPGRADE: ${baseMessage}`;
    case 'risk':
      return `⚠️ RISK ALERT: ${baseMessage}`;
    default:
      return `🔔 ALERT: ${baseMessage}`;
  }
}

/**
 * Check if alert should be debounced
 * @param {string} mint - Token mint
 * @param {string} alertType - Type of alert
 * @param {number} debounceMinutes - Debounce window in minutes
 * @returns {boolean} True if alert should be debounced
 */
function shouldDebounce(mint, alertType, debounceMinutes) {
  if (debounceMinutes <= 0) return false;
  
  const recentCount = checkRecentAlerts.get(mint, alertType, debounceMinutes);
  return recentCount.count > 0;
}

/**
 * Process alerts for a single token
 * @param {object} token - Token data
 * @param {object} rule - Alert rule
 */
async function processTokenAlerts(token, rule) {
  const { mint, symbol } = token;
  
  try {
    // Check hard mute conditions first
    if (checkHardMute(token, rule.hard_mute_conditions)) {
      logger.debug('alert-engine', mint, 'hard_muted', `Token ${symbol} muted by hard conditions`);
      return;
    }
    
    // Check if token meets alert conditions
    if (!checkAlertConditions(token, rule)) {
      logger.debug('alert-engine', mint, 'conditions_not_met', `Token ${symbol} does not meet alert conditions`);
      return;
    }
    
    // Check debounce window
    if (shouldDebounce(mint, rule.alert_type, rule.debounce_minutes)) {
      logger.debug('alert-engine', mint, 'debounced', `Alert for ${symbol} debounced (${rule.debounce_minutes}m window)`);
      return;
    }
    
    // Generate alert message
    const message = generateAlertMessage(token, rule.alert_type);
    const metadata = JSON.stringify({
      health_score: token.health_score,
      holders_count: token.holders_count,
      liquidity_usd: token.liquidity_usd,
      fresh_pct: token.fresh_pct,
      sniper_pct: token.sniper_pct,
      insider_pct: token.insider_pct,
      top10_share: token.top10_share,
      rule_name: rule.rule_name
    });
    
    // Insert alert
    const now = new Date().toISOString();
    insertAlert.run(
      mint,
      rule.alert_type,
      'high', // alert level
      message,
      now,
      metadata
    );
    
    // Insert alert history for tracking
    insertAlertHistory.run(mint, rule.alert_type, now, metadata);
    
    logger.success('alert-engine', mint, 'alert_triggered', `Alert triggered for ${symbol}`, {
      alert_type: rule.alert_type,
      rule_name: rule.rule_name,
      health_score: token.health_score
    });
    
  } catch (error) {
    logger.error('alert-engine', mint, 'alert_failed', `Failed to process alerts for ${symbol}: ${error.message}`);
  }
}

/**
 * Main alert processing loop
 */
async function processAlerts() {
  logger.info('alert-engine', 'system', 'start', 'Starting alert processing');
  
  try {
    // Get active alert rules
    const rules = getActiveAlertRules.all();
    if (rules.length === 0) {
      logger.warning('alert-engine', 'system', 'no_rules', 'No active alert rules found');
      return;
    }
    
    // Get tokens for alert checking
    const tokens = getTokensForAlertCheck.all();
    if (tokens.length === 0) {
      logger.warning('alert-engine', 'system', 'no_tokens', 'No tokens found for alert checking');
      return;
    }
    
    logger.info('alert-engine', 'system', 'processing', `Processing ${tokens.length} tokens with ${rules.length} rules`);
    
    // Process each token against each rule
    for (const token of tokens) {
      for (const rule of rules) {
        await processTokenAlerts(token, rule);
      }
    }
    
    logger.success('alert-engine', 'system', 'complete', 'Alert processing completed');
    
  } catch (error) {
    logger.error('alert-engine', 'system', 'failed', `Alert processing failed: ${error.message}`);
    throw error;
  }
}

/**
 * Clean up old alerts (older than 7 days)
 */
async function cleanupOldAlerts() {
  try {
    const result = db.prepare(`
      DELETE FROM alerts 
      WHERE triggered_at < datetime('now', '-7 days')
    `).run();
    
    if (result.changes > 0) {
      logger.info('alert-engine', 'cleanup', 'deleted', `Cleaned up ${result.changes} old alerts`);
    }
  } catch (error) {
    logger.error('alert-engine', 'cleanup', 'failed', `Failed to cleanup old alerts: ${error.message}`);
  }
}

/**
 * Main loop
 */
async function mainLoop() {
  logger.info('alert-engine', 'system', 'start', 'Starting Alert Engine Worker');
  
  try {
    await processAlerts();
    await cleanupOldAlerts();
    
    logger.success('alert-engine', 'system', 'complete', 'Alert Engine Worker completed');
  } catch (error) {
    logger.error('alert-engine', 'system', 'failed', `Alert Engine Worker failed: ${error.message}`);
    throw error;
  }
}

// Export for CLI usage
module.exports = {
  processAlerts,
  cleanupOldAlerts,
  mainLoop
};

// Run if called directly
if (require.main === module) {
  mainLoop().then(() => {
    console.log('✅ Alert Engine Worker completed');
    process.exit(0);
  }).catch(error => {
    console.error('❌ Alert Engine Worker failed:', error.message);
    process.exit(1);
  });
}
