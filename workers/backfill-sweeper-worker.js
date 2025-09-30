// workers/backfill-sweeper-worker.js - Backfill sweeper for missing data
require('dotenv').config();
const Database = require('better-sqlite3');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

// --- Database Queries ---
const pickBackfillBatch = db.prepare(`
  SELECT mint, symbol, first_seen_at, last_enriched_at, enrich_attempts
  FROM tokens
  WHERE datetime(first_seen_at) > datetime('now', '-72 hours')
    AND (
      liquidity_usd IS NULL OR 
      holders_count IS NULL OR 
      fresh_pct IS NULL OR 
      sniper_pct IS NULL OR 
      insider_pct IS NULL OR 
      top10_share IS NULL
    )
    AND (enrich_attempts IS NULL OR enrich_attempts < 5)
  ORDER BY datetime(first_seen_at) DESC
  LIMIT 50
`);

const markBackfillStart = db.prepare(`
  UPDATE tokens SET enrich_attempts = COALESCE(enrich_attempts,0)+1 WHERE mint = ?
`);

const saveBackfillError = db.prepare(`
  UPDATE tokens
  SET last_enriched_at = ?, enrich_error = ?
  WHERE mint = ?
`);

// --- Backfill Functions ---
async function backfillTokenData(token) {
  const nowIso = new Date().toISOString();
  markBackfillStart.run(token.mint);

  try {
    // Run all enrichment workers for this token
    const workers = [
      '../enrich/worker.js',
      '../workers/holders-worker.js',
      '../workers/wallet-profiling-worker.js',
      '../workers/health-score-worker.js'
    ];

    for (const worker of workers) {
      try {
        const workerModule = require(worker);
        if (workerModule.processToken) {
          await workerModule.processToken(token);
        } else if (workerModule.mainLoop) {
          // For workers that process batches, we'll run them separately
          continue;
        }
      } catch (error) {
        logger.warn('backfill-sweeper', token.mint, 'worker_failed', `Worker ${worker} failed: ${error.message}`);
      }
    }

    logger.success('backfill-sweeper', token.mint, 'complete', `Backfilled data for ${token.symbol || 'Unknown'}`);
  } catch (error) {
    const errorCode = error.message.slice(0, 120);
    logger.error('backfill-sweeper', token.mint, 'failed', `Backfill failed: ${errorCode}`);
    saveBackfillError.run(nowIso, errorCode, token.mint);
  }
}

// --- Main Loop ---
async function mainLoop() {
  const tokens = pickBackfillBatch.all();
  
  if (tokens.length === 0) {
    logger.info('backfill-sweeper', null, 'batch', 'No tokens need backfilling');
    return;
  }
  
  logger.info('backfill-sweeper', null, 'batch', `Backfilling data for ${tokens.length} tokens`, { 
    batchSize: tokens.length 
  });
  
  for (const token of tokens) {
    try {
      await backfillTokenData(token);
      // Small delay to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      logger.error('backfill-sweeper', token.mint, 'batch', `Failed to process token: ${error.message}`);
    }
  }
  
  logger.info('backfill-sweeper', null, 'complete', 'Backfill batch completed');
}

// Run if called directly
if (require.main === module) {
  mainLoop().then(() => process.exit(0)).catch(error => {
    logger.error('backfill-sweeper', null, 'fatal', `Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { mainLoop, backfillTokenData };
