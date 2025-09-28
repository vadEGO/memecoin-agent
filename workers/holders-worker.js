// workers/holders-worker.js - Holder snapshot and fresh wallets detection
require('dotenv').config();
const Database = require('better-sqlite3');
const { fetchJson, sleep } = require('../lib/http');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

// --- Database Queries ---
const pickTokensForHolders = db.prepare(`
  SELECT mint, first_seen_at, holders_count, fresh_wallets_count
  FROM tokens
  WHERE (
    holders_count IS NULL OR fresh_wallets_count IS NULL
    OR datetime(first_seen_at) > datetime('now', '-60 minutes')
  )
  AND first_seen_at IS NOT NULL
  ORDER BY datetime(first_seen_at) DESC
  LIMIT 20
`);

const upsertHolder = db.prepare(`
  INSERT OR REPLACE INTO holders (mint, owner, amount, last_seen_at)
  VALUES (?, ?, ?, ?)
`);

const updateTokenCounts = db.prepare(`
  UPDATE tokens
  SET holders_count = ?, fresh_wallets_count = ?, last_updated_at = ?
  WHERE mint = ?
`);

const getTokenEvents = db.prepare(`
  SELECT signature, received_at, raw_json
  FROM token_events
  WHERE mint = ? AND received_at >= ? AND received_at < ?
  ORDER BY received_at ASC
`);

// --- Helius API Functions ---
async function fetchTokenAccounts(mint) {
  if (!HELIUS_API_KEY || HELIUS_API_KEY === 'your_helius_key') {
    logger.warning('holders', mint, 'token_accounts', 'Skipping token accounts fetch (no API key)');
    return [];
  }

  // For now, return empty array to avoid API issues
  // TODO: Implement proper token accounts fetching
  logger.warning('holders', mint, 'token_accounts', 'Token accounts fetching not implemented yet');
  return [];
}

async function fetchParsedTransactions(mint, startTime, endTime) {
  if (!HELIUS_API_KEY || HELIUS_API_KEY === 'your_helius_key') {
    logger.warning('holders', mint, 'transactions', 'Skipping transaction fetch (no API key)');
    return [];
  }

  // For now, return empty array to avoid API issues
  // TODO: Implement proper transaction fetching
  logger.warning('holders', mint, 'transactions', 'Transaction fetching not implemented yet');
  return [];
}

// --- Analysis Functions ---
function extractInceptionHolders(transactions) {
  const inceptionHolders = new Set();
  
  for (const tx of transactions) {
    if (!tx?.transaction?.message?.instructions) continue;
    
    for (const instruction of tx.transaction.message.instructions) {
      if (instruction?.program === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
        const parsed = instruction?.parsed;
        if (parsed?.type === 'mintTo' && parsed?.info?.mint) {
          // This is a mintTo instruction - the destination is an inception holder
          const destination = parsed.info.destination;
          if (destination) {
            inceptionHolders.add(destination);
          }
        }
      }
    }
  }
  
  return inceptionHolders;
}

function extractFreshBuyers(transactions, inceptionHolders) {
  const freshBuyers = new Set();
  
  for (const tx of transactions) {
    if (!tx?.transaction?.message?.instructions) continue;
    
    for (const instruction of tx.transaction.message.instructions) {
      if (instruction?.program === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
        const parsed = instruction?.parsed;
        if (parsed?.type === 'transfer' && parsed?.info?.mint) {
          const destination = parsed.info.destination;
          const source = parsed.info.source;
          
          // If destination is not in inception holders, it's a fresh buyer
          if (destination && !inceptionHolders.has(destination)) {
            freshBuyers.add(destination);
          }
        }
      }
    }
  }
  
  return freshBuyers;
}

// --- Main Processing Function ---
async function processTokenHolders(token) {
  const { mint, first_seen_at } = token;
  const now = new Date().toISOString();
  
  logger.info('holders', mint, 'start', `Processing holders for ${mint}`);
  
  try {
    // 1. Fetch current token accounts
    const tokenAccounts = await fetchTokenAccounts(mint);
    
    // 2. Upsert all holders into database
    for (const account of tokenAccounts) {
      upsertHolder.run(mint, account.owner, account.amount, account.lastSeen);
    }
    
    // 3. Calculate fresh window (30 minutes from first_seen_at)
    const firstSeenTime = new Date(first_seen_at);
    const freshWindowEnd = new Date(firstSeenTime.getTime() + 30 * 60 * 1000); // +30 minutes
    
    // 4. Fetch transactions in the fresh window
    const transactions = await fetchParsedTransactions(
      mint, 
      first_seen_at, 
      freshWindowEnd.toISOString()
    );
    
    // 5. Extract inception holders and fresh buyers
    const inceptionHolders = extractInceptionHolders(transactions);
    const freshBuyers = extractFreshBuyers(transactions, inceptionHolders);
    
    // 6. Calculate counts
    const holdersCount = tokenAccounts.length;
    const freshWalletsCount = freshBuyers.size;
    
    // 7. Update token counts
    updateTokenCounts.run(holdersCount, freshWalletsCount, now, mint);
    
    logger.success('holders', mint, 'complete', `Holders processed successfully`, {
      holders: holdersCount,
      fresh: freshWalletsCount,
      inception: inceptionHolders.size
    });
    
  } catch (error) {
    logger.error('holders', mint, 'failed', `Holders processing failed: ${error.message}`);
    throw error;
  }
}

// --- Main Loop ---
async function mainLoop() {
  const tokens = pickTokensForHolders.all();
  
  if (tokens.length === 0) {
    logger.info('holders', null, 'batch', 'No tokens need holder processing');
    return;
  }
  
  logger.info('holders', null, 'batch', `Processing ${tokens.length} tokens for holders`, { 
    batchSize: tokens.length 
  });
  
  for (const token of tokens) {
    try {
      await processTokenHolders(token);
      // Small delay to be polite to APIs
      await sleep(500);
    } catch (error) {
      logger.error('holders', token.mint, 'batch', `Failed to process token: ${error.message}`);
      // Continue with next token
    }
  }
  
  logger.info('holders', null, 'complete', 'Holders processing batch completed');
}

// Run if called directly
if (require.main === module) {
  mainLoop().then(() => process.exit(0)).catch(error => {
    logger.error('holders', null, 'fatal', `Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { mainLoop, processTokenHolders };
