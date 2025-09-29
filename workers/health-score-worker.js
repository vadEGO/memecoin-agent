// workers/health-score-worker.js - Health score calculation for Task 8
require('dotenv').config();
const Database = require('better-sqlite3');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

// --- Database Queries ---
const pickTokensForHealthScore = db.prepare(`
  SELECT mint, symbol, holders_count, fresh_wallets_count, liquidity_usd, 
         sniper_count, bundler_count, insider_count, health_score
  FROM tokens
  WHERE first_seen_at IS NOT NULL
    AND datetime(first_seen_at) > datetime('now', '-24 hours')
  ORDER BY datetime(first_seen_at) DESC
  LIMIT 20
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

function calculateHealthScore(token) {
  const {
    mint,
    holders_count = 0,
    fresh_wallets_count = 0,
    liquidity_usd = 0,
    sniper_count = 0,
    bundler_count = 0,
    insider_count = 0
  } = token;
  
  // Calculate ratios
  const freshRatio = holders_count > 0 ? fresh_wallets_count / holders_count : 0;
  const sniperRatio = holders_count > 0 ? sniper_count / holders_count : 0;
  const insiderRatio = holders_count > 0 ? insider_count / holders_count : 0;
  
  // Calculate top 10 concentration
  const top10Concentration = calculateTop10Concentration(mint);
  
  // Normalize liquidity (log scale)
  const liquidityScore = Math.log10(Math.max(1, liquidity_usd)) / 6; // Normalize to 0-1 for $1 to $1M
  
  // Calculate health score components (weights sum to 100)
  const freshScore = freshRatio * 35; // +35 points max
  const liquidityScoreWeighted = liquidityScore * 20; // +20 points max
  const sniperPenalty = sniperRatio * 15; // -15 points max
  const insiderPenalty = insiderRatio * 20; // -20 points max
  const concentrationPenalty = top10Concentration * 10; // -10 points max
  
  // Calculate final score
  let healthScore = freshScore + liquidityScoreWeighted - sniperPenalty - insiderPenalty - concentrationPenalty;
  
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
