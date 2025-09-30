// workers/health-score-worker.js - Health score calculation for Task 8
require('dotenv').config();
const Database = require('better-sqlite3');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

// --- Database Queries ---
const pickTokensForHealthScore = db.prepare(`
  SELECT mint, symbol, holders_count, fresh_wallets_count, liquidity_usd, 
         sniper_count, bundler_count, insider_count, health_score,
         fresh_pct, sniper_pct, insider_pct, top10_share
  FROM tokens
  WHERE first_seen_at IS NOT NULL
    AND datetime(first_seen_at) > datetime('now', '-48 hours')
    AND lp_exists = 1
    AND holders_count IS NOT NULL
    AND (fresh_pct IS NOT NULL OR fresh_wallets_count IS NOT NULL)
    AND health_score IS NULL
  ORDER BY datetime(first_seen_at) DESC
  LIMIT 50
`);

const getTop10Holders = db.prepare(`
  SELECT amount
  FROM holders
  WHERE mint = ?
  ORDER BY CAST(amount AS REAL) DESC
  LIMIT 10
`);

const updateTokenHealthScore = db.prepare(`
  UPDATE tokens
  SET health_score = ?
  WHERE mint = ?
`);

// --- Health Score Calculation Functions ---
function calculateTop10Concentration(mint) {
  const top10Holders = getTop10Holders.all(mint);
  
  if (top10Holders.length === 0) return 0;
  
  const top10Amount = top10Holders.reduce((sum, holder) => sum + (parseFloat(holder.amount) || 0), 0);
  
  // Get total supply (approximate from all holders)
  const allHolders = db.prepare(`
    SELECT amount FROM holders WHERE mint = ?
  `).all(mint);
  
  const totalAmount = allHolders.reduce((sum, holder) => sum + (parseFloat(holder.amount) || 0), 0);
  
  return totalAmount > 0 ? top10Amount / totalAmount : 0;
}

function normalizeValue(value, min, max) {
  if (min === max) return 0.5; // Default to middle if no range
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function calculateMomentumBonus(mint) {
  try {
    // Get health score from 15 minutes ago and current
    const oldScore = db.prepare(`
      SELECT health_score FROM score_history
      WHERE mint = ? AND datetime(snapshot_time) <= datetime('now', '-15 minutes')
      ORDER BY snapshot_time DESC LIMIT 1
    `).get(mint);
    
    const currentScore = db.prepare(`
      SELECT health_score FROM tokens WHERE mint = ?
    `).get(mint);
    
    if (oldScore && currentScore) {
      const deltaHealth = currentScore.health_score - oldScore.health_score;
      return Math.max(0, Math.min(5, deltaHealth / 2)); // Clamp to 0-5 points
    }
    
    return 0;
  } catch (error) {
    return 0;
  }
}

function calculateHealthScore(token) {
  const {
    mint,
    holders_count = 0,
    fresh_wallets_count = 0,
    liquidity_usd = 0,
    sniper_count = 0,
    bundler_count = 0,
    insider_count = 0,
    fresh_pct = null,
    sniper_pct = null,
    insider_pct = null,
    top10_share = null
  } = token;
  
  // Handle NULLs with neutral priors (NA-aware scoring)
  let freshRatio = fresh_pct !== null ? fresh_pct : 
    (holders_count > 0 ? fresh_wallets_count / holders_count : 0.50); // neutral prior = 50%
  
  let sniperRatio = sniper_pct !== null ? sniper_pct : 
    (holders_count > 0 ? sniper_count / holders_count : 0.10); // neutral risk = 10%
  
  let insiderRatio = insider_pct !== null ? insider_pct : 
    (holders_count > 0 ? insider_count / holders_count : 0.10); // neutral risk = 10%
  
  // Calculate top 10 concentration with NULL handling
  let top10Concentration = top10_share !== null ? top10_share : 
    calculateTop10Concentration(mint);
  
  // Calculate liquidity score with NULL handling
  const liquidityScore = liquidity_usd !== null ? 
    Math.log10(Math.max(1, liquidity_usd)) / 6 : 0.40; // neutral prior = 40% of max

  // Cap extremes to reduce outlier impact
  freshRatio = Math.min(freshRatio, 0.90); // Cap at 90%
  sniperRatio = Math.min(sniperRatio, 0.50); // Cap at 50%
  insiderRatio = Math.min(insiderRatio, 0.50); // Cap at 50%
  top10Concentration = Math.min(top10Concentration, 0.90); // Cap at 90%
  
  // Calculate health score components (weights sum to 100)
  const freshScore = freshRatio * 35; // +35 points max
  const liquidityScoreWeighted = liquidityScore * 20; // +20 points max
  const sniperPenalty = sniperRatio * 15; // -15 points max
  const insiderPenalty = insiderRatio * 20; // -20 points max
  const concentrationPenalty = top10Concentration * 10; // -10 points max
  
  // Calculate base score
  let healthScore = freshScore + liquidityScoreWeighted - sniperPenalty - insiderPenalty - concentrationPenalty;
  
  // Add floor and momentum bonus
  healthScore = 5 + 0.95 * healthScore; // Base floor: 5 + 0.95 * score
  
  // Add momentum bonus if we have two snapshots
  const momentumBonus = calculateMomentumBonus(mint);
  healthScore += momentumBonus;
  
  // Clamp to 0-100 range
  healthScore = Math.max(0, Math.min(100, healthScore));
  
  return {
    healthScore: Math.round(healthScore * 100) / 100, // Round to 2 decimal places
    components: {
      freshRatio,
      sniperRatio,
      insiderRatio,
      top10Concentration,
      liquidityScore,
      freshScore,
      liquidityScoreWeighted,
      sniperPenalty,
      insiderPenalty,
      concentrationPenalty
    }
  };
}

// --- Main Processing Function ---
async function processTokenHealthScore(token) {
  const { mint, symbol } = token;
  
  logger.info('health-score', mint, 'start', `Calculating health score for ${symbol} (${mint})`);
  
  try {
    // Calculate health score
    const result = calculateHealthScore(token);
    
    // Update token with health score
    updateTokenHealthScore.run(result.healthScore, mint);
    
    logger.success('health-score', mint, 'complete', `Health score calculated`, {
      healthScore: result.healthScore,
      components: result.components
    });
    
  } catch (error) {
    logger.error('health-score', mint, 'failed', `Health score calculation failed: ${error.message}`);
    throw error;
  }
}

// --- Main Loop ---
async function mainLoop() {
  const tokens = pickTokensForHealthScore.all();
  
  if (tokens.length === 0) {
    logger.info('health-score', null, 'batch', 'No tokens need health score calculation');
    return;
  }
  
  logger.info('health-score', null, 'batch', `Calculating health scores for ${tokens.length} tokens`, { 
    batchSize: tokens.length 
  });
  
  for (const token of tokens) {
    try {
      await processTokenHealthScore(token);
      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      logger.error('health-score', token.mint, 'batch', `Failed to process token: ${error.message}`);
      // Continue with next token
    }
  }
  
  logger.info('health-score', null, 'complete', 'Health score calculation batch completed');
}

// Run if called directly
if (require.main === module) {
  mainLoop().then(() => process.exit(0)).catch(error => {
    logger.error('health-score', null, 'fatal', `Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { mainLoop, processTokenHealthScore };
