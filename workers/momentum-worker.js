// workers/momentum-worker.js - Frequent snapshots for momentum tracking
require('dotenv').config();
const Database = require('better-sqlite3');
const { fetchJson, sleep } = require('../lib/http');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

// --- Database Queries ---
const getRecentTokens = db.prepare(`
  SELECT mint, first_seen_at, holders_count, fresh_wallets_count
  FROM tokens
  WHERE datetime(first_seen_at) > datetime('now', '-1 hour')
  AND first_seen_at IS NOT NULL
  ORDER BY datetime(first_seen_at) DESC
  LIMIT 50
`);

const getLastSnapshot = db.prepare(`
  SELECT MAX(snapshot_time) as last_snapshot
  FROM holders_history
  WHERE mint = ?
`);

const insertHistorySnapshot = db.prepare(`
  INSERT OR REPLACE INTO holders_history 
  (mint, snapshot_time, holders_count, fresh_wallets_count, inception_count, sniper_count, bundler_count, insider_count, fresh_ratio, top10_share, sniper_ratio, health_score)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateTokenCounts = db.prepare(`
  UPDATE tokens
  SET holders_count = ?, fresh_wallets_count = ?, last_updated_at = ?
  WHERE mint = ?
`);

// --- Simplified Processing for Frequent Snapshots ---
async function processMomentumSnapshot(token) {
  const { mint, first_seen_at } = token;
  const now = new Date().toISOString();
  
  logger.info('momentum', mint, 'snapshot', `Taking momentum snapshot for ${mint}`);
  
  try {
    // Get current holder counts by type
    const holderStats = db.prepare(`
      SELECT 
        COUNT(*) as total_holders,
        SUM(CASE WHEN holder_type = 'fresh' THEN 1 ELSE 0 END) as fresh_count,
        SUM(CASE WHEN holder_type = 'inception' THEN 1 ELSE 0 END) as inception_count,
        SUM(CASE WHEN holder_type = 'sniper' THEN 1 ELSE 0 END) as sniper_count,
        SUM(CASE WHEN holder_type = 'bundler' THEN 1 ELSE 0 END) as bundler_count,
        SUM(CASE WHEN holder_type = 'insider' THEN 1 ELSE 0 END) as insider_count
      FROM holders
      WHERE mint = ?
    `).get(mint);
    
    const holdersCount = holderStats.total_holders || 0;
    const freshWalletsCount = holderStats.fresh_count || 0;
    const inceptionCount = holderStats.inception_count || 0;
    const sniperCount = holderStats.sniper_count || 0;
    const bundlerCount = holderStats.bundler_count || 0;
    const insiderCount = holderStats.insider_count || 0;
    
    // Calculate ratios
    const freshRatio = holdersCount > 0 ? freshWalletsCount / holdersCount : 0;
    const sniperRatio = holdersCount > 0 ? sniperCount / holdersCount : 0;
    
    // Calculate top 10 share
    const top10Stats = db.prepare(`
      SELECT 
        SUM(CAST(amount AS REAL)) as total_amount,
        (SELECT SUM(CAST(amount AS REAL)) FROM (
          SELECT amount FROM holders 
          WHERE mint = ? 
          ORDER BY CAST(amount AS REAL) DESC 
          LIMIT 10
        )) as top10_amount
      FROM holders
      WHERE mint = ?
    `).get(mint, mint);
    
    const totalAmount = top10Stats.total_amount || 0;
    const top10Amount = top10Stats.top10_amount || 0;
    const top10Share = totalAmount > 0 ? top10Amount / totalAmount : 0;
    
    // Calculate health score
    let healthScore = 50; // Base score
    
    // Fresh ratio bonus (0-30 points)
    if (freshRatio > 0.7) healthScore += 30;
    else if (freshRatio > 0.5) healthScore += 20;
    else if (freshRatio > 0.3) healthScore += 10;
    
    // Top 10 share penalty (0-20 points)
    if (top10Share > 0.8) healthScore -= 20;
    else if (top10Share > 0.6) healthScore -= 10;
    else if (top10Share < 0.3) healthScore += 10;
    
    // Sniper ratio penalty (0-20 points)
    if (sniperRatio > 0.5) healthScore -= 20;
    else if (sniperRatio > 0.3) healthScore -= 10;
    
    // Holder count bonus (0-20 points)
    if (holdersCount > 1000) healthScore += 20;
    else if (holdersCount > 500) healthScore += 15;
    else if (holdersCount > 100) healthScore += 10;
    else if (holdersCount > 50) healthScore += 5;
    
    healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));
    
    // Update token counts
    updateTokenCounts.run(holdersCount, freshWalletsCount, now, mint);
    
    // Create history snapshot
    insertHistorySnapshot.run(
      mint,
      now,
      holdersCount,
      freshWalletsCount,
      inceptionCount,
      sniperCount,
      bundlerCount,
      insiderCount,
      freshRatio,
      top10Share,
      sniperRatio,
      healthScore
    );
    
    logger.success('momentum', mint, 'snapshot', `Momentum snapshot completed`, {
      holders: holdersCount,
      fresh: freshWalletsCount,
      healthScore: healthScore,
      freshRatio: freshRatio.toFixed(3),
      top10Share: top10Share.toFixed(3)
    });
    
  } catch (error) {
    logger.error('momentum', mint, 'failed', `Momentum snapshot failed: ${error.message}`);
    throw error;
  }
}

// --- Main Loop ---
async function mainLoop() {
  const tokens = getRecentTokens.all();
  
  if (tokens.length === 0) {
    logger.info('momentum', null, 'batch', 'No recent tokens need momentum tracking');
    return;
  }
  
  logger.info('momentum', null, 'batch', `Taking momentum snapshots for ${tokens.length} recent tokens`, { 
    batchSize: tokens.length 
  });
  
  for (const token of tokens) {
    try {
      // Check if we need a snapshot (every 5 minutes for first hour)
      const lastSnapshot = getLastSnapshot.get(token.mint);
      const lastSnapshotTime = lastSnapshot.last_snapshot;
      
      if (lastSnapshotTime) {
        const lastSnapshotDate = new Date(lastSnapshotTime);
        const now = new Date();
        const timeDiff = now - lastSnapshotDate;
        
        // Only snapshot if 5+ minutes have passed
        if (timeDiff < 5 * 60 * 1000) {
          logger.info('momentum', token.mint, 'skip', 'Skipping - snapshot too recent');
          continue;
        }
      }
      
      await processMomentumSnapshot(token);
      // Small delay to be polite
      await sleep(100);
    } catch (error) {
      logger.error('momentum', token.mint, 'batch', `Failed to process momentum snapshot: ${error.message}`);
      // Continue with next token
    }
  }
  
  logger.info('momentum', null, 'complete', 'Momentum snapshot batch completed');
}

// Run if called directly
if (require.main === module) {
  mainLoop().then(() => process.exit(0)).catch(error => {
    logger.error('momentum', null, 'fatal', `Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { mainLoop, processMomentumSnapshot };

