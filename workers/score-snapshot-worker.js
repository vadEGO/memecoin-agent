// workers/score-snapshot-worker.js - Task 9 Score Snapshotting
const Database = require('better-sqlite3');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

// --- Database Queries ---
const getTokensForSnapshot = db.prepare(`
  SELECT 
    t.mint, t.symbol, t.health_score, t.holders_count, t.liquidity_usd,
    t.fresh_pct, t.sniper_pct, t.insider_pct, t.top10_share
  FROM tokens t
  WHERE t.health_score IS NOT NULL
    AND t.holders_count IS NOT NULL
    AND t.liquidity_usd IS NOT NULL
    AND t.fresh_pct IS NOT NULL
    AND t.sniper_pct IS NOT NULL
    AND t.insider_pct IS NOT NULL
    AND t.top10_share IS NOT NULL
  ORDER BY t.first_seen_at DESC
  LIMIT 200
`);

const insertScoreSnapshot = db.prepare(`
  INSERT OR REPLACE INTO score_history 
  (mint, snapshot_time, health_score, holders_count, fresh_pct, sniper_pct, insider_pct, top10_share, liquidity_usd)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const getLastSnapshotTime = db.prepare(`
  SELECT MAX(snapshot_time) as last_snapshot
  FROM score_history
`);

// --- Snapshot Functions ---

/**
 * Determine snapshot frequency based on token age
 * @param {string} firstSeenAt - When token was first seen
 * @returns {string} Snapshot frequency: 'early', 'mid', 'late'
 */
function getSnapshotFrequency(firstSeenAt) {
  const now = new Date();
  const firstSeen = new Date(firstSeenAt);
  const ageHours = (now - firstSeen) / (1000 * 60 * 60);
  
  if (ageHours <= 2) {
    return 'early'; // 5-minute intervals
  } else if (ageHours <= 24) {
    return 'mid'; // 15-minute intervals
  } else {
    return 'late'; // 1-hour intervals
  }
}

/**
 * Check if snapshot should be taken based on frequency and last snapshot
 * @param {string} frequency - Snapshot frequency
 * @param {string} lastSnapshot - Last snapshot time
 * @returns {boolean} True if snapshot should be taken
 */
function shouldTakeSnapshot(frequency, lastSnapshot) {
  if (!lastSnapshot) return true; // First snapshot
  
  const now = new Date();
  const lastSnapshotTime = new Date(lastSnapshot);
  const minutesSinceLastSnapshot = (now - lastSnapshotTime) / (1000 * 60);
  
  switch (frequency) {
    case 'early':
      return minutesSinceLastSnapshot >= 5; // 5-minute intervals
    case 'mid':
      return minutesSinceLastSnapshot >= 15; // 15-minute intervals
    case 'late':
      return minutesSinceLastSnapshot >= 60; // 1-hour intervals
    default:
      return minutesSinceLastSnapshot >= 60; // Default to 1-hour
  }
}

/**
 * Create score snapshot for a token
 * @param {object} token - Token data
 * @param {string} snapshotTime - Snapshot timestamp
 */
async function createScoreSnapshot(token, snapshotTime) {
  const { mint, symbol } = token;
  
  try {
    insertScoreSnapshot.run(
      mint,
      snapshotTime,
      token.health_score,
      token.holders_count,
      token.fresh_pct,
      token.sniper_pct,
      token.insider_pct,
      token.top10_share,
      token.liquidity_usd
    );
    
    logger.debug('score-snapshot', mint, 'snapshot_created', `Score snapshot created for ${symbol}`);
    
  } catch (error) {
    logger.error('score-snapshot', mint, 'snapshot_failed', `Failed to create snapshot for ${symbol}: ${error.message}`);
  }
}

/**
 * Process score snapshots for all eligible tokens
 */
async function processScoreSnapshots() {
  logger.info('score-snapshot', 'system', 'start', 'Starting score snapshot processing');
  
  try {
    // Get tokens for snapshot
    const tokens = getTokensForSnapshot.all();
    if (tokens.length === 0) {
      logger.warning('score-snapshot', 'system', 'no_tokens', 'No tokens found for snapshot');
      return;
    }
    
    // Get last snapshot time
    const lastSnapshotResult = getLastSnapshotTime.get();
    const lastSnapshot = lastSnapshotResult.last_snapshot;
    
    const now = new Date().toISOString();
    let snapshotsCreated = 0;
    
    // Process each token
    for (const token of tokens) {
      // Determine snapshot frequency based on token age
      const frequency = getSnapshotFrequency(token.first_seen_at || now);
      
      // Check if snapshot should be taken
      if (shouldTakeSnapshot(frequency, lastSnapshot)) {
        await createScoreSnapshot(token, now);
        snapshotsCreated++;
      }
    }
    
    logger.success('score-snapshot', 'system', 'complete', `Score snapshot processing completed - ${snapshotsCreated} snapshots created`);
    
  } catch (error) {
    logger.error('score-snapshot', 'system', 'failed', `Score snapshot processing failed: ${error.message}`);
    throw error;
  }
}

/**
 * Clean up old snapshots (older than 30 days)
 */
async function cleanupOldSnapshots() {
  try {
    const result = db.prepare(`
      DELETE FROM score_history 
      WHERE snapshot_time < datetime('now', '-30 days')
    `).run();
    
    if (result.changes > 0) {
      logger.info('score-snapshot', 'cleanup', 'deleted', `Cleaned up ${result.changes} old snapshots`);
    }
  } catch (error) {
    logger.error('score-snapshot', 'cleanup', 'failed', `Failed to cleanup old snapshots: ${error.message}`);
  }
}

/**
 * Get snapshot statistics
 */
function getSnapshotStats() {
  try {
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_snapshots,
        COUNT(DISTINCT mint) as unique_tokens,
        MIN(snapshot_time) as earliest_snapshot,
        MAX(snapshot_time) as latest_snapshot
      FROM score_history
    `).get();
    
    return stats;
  } catch (error) {
    logger.error('score-snapshot', 'stats', 'failed', `Failed to get snapshot stats: ${error.message}`);
    return null;
  }
}

/**
 * Main loop
 */
async function mainLoop() {
  logger.info('score-snapshot', 'system', 'start', 'Starting Score Snapshot Worker');
  
  try {
    await processScoreSnapshots();
    await cleanupOldSnapshots();
    
    // Log statistics
    const stats = getSnapshotStats();
    if (stats) {
      logger.info('score-snapshot', 'stats', 'summary', 
        `Total snapshots: ${stats.total_snapshots}, Unique tokens: ${stats.unique_tokens}`);
    }
    
    logger.success('score-snapshot', 'system', 'complete', 'Score Snapshot Worker completed');
  } catch (error) {
    logger.error('score-snapshot', 'system', 'failed', `Score Snapshot Worker failed: ${error.message}`);
    throw error;
  }
}

// Export for CLI usage
module.exports = {
  processScoreSnapshots,
  cleanupOldSnapshots,
  getSnapshotStats,
  mainLoop
};

// Run if called directly
if (require.main === module) {
  mainLoop().then(() => {
    console.log('✅ Score Snapshot Worker completed');
    process.exit(0);
  }).catch(error => {
    console.error('❌ Score Snapshot Worker failed:', error.message);
    process.exit(1);
  });
}
