// workers/wallet-class-calculator-worker.js - Calculate wallet class counts and percentages
require('dotenv').config();
const Database = require('better-sqlite3');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

// --- Database Queries ---
const pickTokensForClassCalculation = db.prepare(`
  SELECT mint, symbol, holders_count
  FROM tokens
  WHERE first_seen_at IS NOT NULL
    AND datetime(first_seen_at) > datetime('now', '-24 hours')
  ORDER BY datetime(first_seen_at) DESC
  LIMIT 20
`);

const getTokenHolders = db.prepare(`
  SELECT owner, holder_type, amount
  FROM holders
  WHERE mint = ?
`);

const updateTokenClassCounts = db.prepare(`
  UPDATE tokens
  SET fresh_count = ?, fresh_pct = ?,
      inception_count = ?, inception_pct = ?,
      snipers_count = ?, snipers_pct = ?,
      bundled_count = ?, bundled_pct = ?,
      insiders_count = ?, insiders_pct = ?,
      others_count = ?, others_pct = ?,
      top10_share = ?
  WHERE mint = ?
`);

// --- Wallet Class Calculation Functions ---
function calculateWalletClassCounts(holders) {
  const counts = {
    fresh: 0,
    inception: 0,
    snipers: 0,
    bundled: 0,
    insiders: 0,
    others: 0
  };

  for (const holder of holders) {
    const types = holder.holder_type.split(',').map(t => t.trim()).filter(t => t);
    
    if (types.length === 0 || types.includes('unknown')) {
      counts.others++;
    } else {
      for (const type of types) {
        if (counts.hasOwnProperty(type)) {
          counts[type]++;
        }
      }
    }
  }

  return counts;
}

function calculateTop10Share(holders) {
  if (holders.length === 0) return 0;
  
  const sortedByAmount = holders
    .map(h => parseFloat(h.amount) || 0)
    .sort((a, b) => b - a);
  
  const top10Amount = sortedByAmount.slice(0, 10).reduce((sum, amount) => sum + amount, 0);
  const totalAmount = sortedByAmount.reduce((sum, amount) => sum + amount, 0);
  
  return totalAmount > 0 ? top10Amount / totalAmount : 0;
}

function calculatePercentages(counts, totalHolders) {
  const percentages = {};
  
  for (const [className, count] of Object.entries(counts)) {
    percentages[className] = totalHolders > 0 ? (count / totalHolders) * 100 : 0;
  }
  
  return percentages;
}

// --- Main Processing Function ---
async function processTokenClassCalculation(token) {
  const { mint, symbol, holders_count } = token;
  
  logger.info('wallet-class-calc', mint, 'start', `Calculating wallet classes for ${symbol} (${mint})`);
  
  try {
    // Get all holders for this token
    const holders = getTokenHolders.all(mint);
    
    if (holders.length === 0) {
      logger.warning('wallet-class-calc', mint, 'no_holders', 'No holders found for calculation');
      return;
    }
    
    // Calculate wallet class counts
    const counts = calculateWalletClassCounts(holders);
    
    // Calculate percentages
    const percentages = calculatePercentages(counts, holders_count || holders.length);
    
    // Calculate top10 share
    const top10Share = calculateTop10Share(holders);
    
    // Update token with calculated values
    updateTokenClassCounts.run(
      counts.fresh, percentages.fresh,
      counts.inception, percentages.inception,
      counts.snipers, percentages.snipers,
      counts.bundled, percentages.bundled,
      counts.insiders, percentages.insiders,
      counts.others, percentages.others,
      top10Share,
      mint
    );
    
    logger.success('wallet-class-calc', mint, 'complete', `Wallet class calculation completed`, {
      totalHolders: holders.length,
      counts: counts,
      percentages: percentages,
      top10Share: top10Share.toFixed(3)
    });
    
  } catch (error) {
    logger.error('wallet-class-calc', mint, 'failed', `Wallet class calculation failed: ${error.message}`);
    throw error;
  }
}

// --- Main Loop ---
async function mainLoop() {
  const tokens = pickTokensForClassCalculation.all();
  
  if (tokens.length === 0) {
    logger.info('wallet-class-calc', null, 'batch', 'No tokens need wallet class calculation');
    return;
  }
  
  logger.info('wallet-class-calc', null, 'batch', `Calculating wallet classes for ${tokens.length} tokens`, { 
    batchSize: tokens.length 
  });
  
  for (const token of tokens) {
    try {
      await processTokenClassCalculation(token);
      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      logger.error('wallet-class-calc', token.mint, 'batch', `Failed to process token: ${error.message}`);
      // Continue with next token
    }
  }
  
  logger.info('wallet-class-calc', null, 'complete', 'Wallet class calculation batch completed');
}

// Run if called directly
if (require.main === module) {
  mainLoop().then(() => process.exit(0)).catch(error => {
    logger.error('wallet-class-calc', null, 'fatal', `Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { mainLoop, processTokenClassCalculation };
