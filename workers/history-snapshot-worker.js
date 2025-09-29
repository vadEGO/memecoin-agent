// workers/history-snapshot-worker.js - Time-series snapshots for momentum tracking
require('dotenv').config();
const Database = require('better-sqlite3');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

// --- Configuration ---
const SNAPSHOT_CADENCES = [
  { name: '5m', minutes: 5 },
  { name: '15m', minutes: 15 },
  { name: '30m', minutes: 30 },
  { name: '60m', minutes: 60 }
];

// --- Database Queries ---
const getTokensForSnapshot = db.prepare(`
  SELECT mint, symbol, first_seen_at
  FROM tokens
  WHERE first_seen_at IS NOT NULL
    AND datetime(first_seen_at) > datetime('now', '-24 hours')
  ORDER BY datetime(first_seen_at) DESC
  LIMIT 50
`);

const getTokenHolders = db.prepare(`
  SELECT 
    owner,
    amount,
    is_fresh,
    is_inception,
    is_sniper,
    is_bundler,
    is_insider,
    holder_type
  FROM holders
  WHERE mint = ?
`);

const insertHistorySnapshot = db.prepare(`
  INSERT OR REPLACE INTO holders_history (
    mint, snapshot_time, holders_count, fresh_wallets_count,
    inception_count, sniper_count, bundler_count, insider_count,
    fresh_ratio, top10_share, sniper_ratio, health_score
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const getTop10Holders = db.prepare(`
  SELECT owner, amount
  FROM holders
  WHERE mint = ?
  ORDER BY CAST(amount AS REAL) DESC
  LIMIT 10
`);

// --- Snapshot Functions ---
function calculateTop10Share(holders) {
  if (holders.length === 0) return 0;
  
  const totalSupply = holders.reduce((sum, holder) => sum + parseFloat(holder.amount || 0), 0);
  if (totalSupply === 0) return 0;
  
  const top10 = holders.slice(0, 10);
  const top10Supply = top10.reduce((sum, holder) => sum + parseFloat(holder.amount || 0), 0);
  
  return top10Supply / totalSupply;
}

function calculateHealthScore(freshRatio, sniperRatio, insiderRatio, top10Share, liquidityUsd) {
  // Health Score v1: +35 Fresh% +20 Liquidity −15 Sniper% −20 Insider% −10 Top10%
  const freshScore = Math.min(freshRatio * 100, 100) * 0.35;
  const liquidityScore = Math.min((liquidityUsd || 0) / 10000, 1) * 20; // Scale to $10k max
  const sniperPenalty = Math.min(sniperRatio * 100, 100) * 0.15;
  const insiderPenalty = Math.min(insiderRatio * 100, 100) * 0.20;
  const top10Penalty = Math.min(top10Share * 100, 100) * 0.10;
  
  const score = freshScore + liquidityScore - sniperPenalty - insiderPenalty - top10Penalty;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function createSnapshot(mint, holders) {
  const now = new Date();
  const snapshotTime = now.toISOString();
  
  // Calculate counts
  const holdersCount = holders.length;
  const freshCount = holders.filter(h => h.is_fresh).length;
  const inceptionCount = holders.filter(h => h.is_inception).length;
  const sniperCount = holders.filter(h => h.is_sniper).length;
  const bundlerCount = holders.filter(h => h.is_bundler).length;
  const insiderCount = holders.filter(h => h.is_insider).length;
  
  // Calculate ratios
  const freshRatio = holdersCount > 0 ? freshCount / holdersCount : 0;
  const sniperRatio = holdersCount > 0 ? sniperCount / holdersCount : 0;
  const insiderRatio = holdersCount > 0 ? insiderCount / holdersCount : 0;
  
  // Calculate top 10 share
  const top10Share = calculateTop10Share(holders);
  
  // Get liquidity for health score
  const token = db.prepare(`SELECT liquidity_usd FROM tokens WHERE mint = ?`).get(mint);
  const liquidityUsd = token?.liquidity_usd || 0;
  
  // Calculate health score
  const healthScore = calculateHealthScore(freshRatio, sniperRatio, insiderRatio, top10Share, liquidityUsd);
  
  return {
    mint,
    snapshotTime,
    holdersCount,
    freshCount,
    inceptionCount,
    sniperCount,
    bundlerCount,
    insiderCount,
    freshRatio,
    top10Share,
    sniperRatio,
    healthScore
  };
}

// --- Main Processing Function ---
async function processTokenSnapshot(mint) {
  logger.info('history-snapshot', mint, 'start', `Creating snapshot for ${mint}`);
  
  try {
    // Get all holders for this token
    const holders = getTokenHolders.all(mint);
    
    if (holders.length === 0) {
      logger.warning('history-snapshot', mint, 'no_holders', 'No holders found for snapshot');
      return;
    }
    
    // Create snapshot
    const snapshot = createSnapshot(mint, holders);
    
    // Store snapshot
    insertHistorySnapshot.run(
      snapshot.mint,
      snapshot.snapshotTime,
      snapshot.holdersCount,
      snapshot.freshCount,
      snapshot.inceptionCount,
      snapshot.sniperCount,
      snapshot.bundlerCount,
      snapshot.insiderCount,
      snapshot.freshRatio,
      snapshot.top10Share,
      snapshot.sniperRatio,
      snapshot.healthScore
    );
    
    logger.success('history-snapshot', mint, 'complete', `Snapshot created`, {
      holders: snapshot.holdersCount,
      fresh: snapshot.freshCount,
      snipers: snapshot.sniperCount,
      insiders: snapshot.insiderCount,
      healthScore: snapshot.healthScore
    });
    
  } catch (error) {
    logger.error('history-snapshot', mint, 'failed', `Snapshot failed: ${error.message}`);
    throw error;
  }
}

// --- Main Loop ---
async function mainLoop() {
  const tokens = getTokensForSnapshot.all();
  
  if (tokens.length === 0) {
    logger.info('history-snapshot', null, 'batch', 'No tokens need snapshots');
    return;
  }
  
  logger.info('history-snapshot', null, 'batch', `Creating snapshots for ${tokens.length} tokens`, { 
    batchSize: tokens.length 
  });
  
  for (const token of tokens) {
    try {
      await processTokenSnapshot(token.mint);
    } catch (error) {
      logger.error('history-snapshot', token.mint, 'batch', `Failed to create snapshot: ${error.message}`);
      // Continue with next token
    }
  }
  
  logger.info('history-snapshot', null, 'complete', 'Snapshot batch completed');
}

// --- Cadence-based Processing ---
async function processCadenceSnapshots() {
  const now = new Date();
  
  for (const cadence of SNAPSHOT_CADENCES) {
    const minutesAgo = now.getTime() - (cadence.minutes * 60 * 1000);
    const shouldSnapshot = minutesAgo % (cadence.minutes * 60 * 1000) < 60000; // Within 1 minute of cadence
    
    if (shouldSnapshot) {
      logger.info('history-snapshot', null, 'cadence', `Processing ${cadence.name} snapshots`);
      await mainLoop();
    }
  }
}

// Run if called directly
if (require.main === module) {
  mainLoop().then(() => process.exit(0)).catch(error => {
    logger.error('history-snapshot', null, 'fatal', `Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { 
  mainLoop, 
  processTokenSnapshot, 
  processCadenceSnapshots,
  createSnapshot 
};
