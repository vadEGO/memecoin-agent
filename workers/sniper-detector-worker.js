// workers/sniper-detector-worker.js - Sniper detection for Task 8
require('dotenv').config();
const Database = require('better-sqlite3');
const { fetchJson, sleep } = require('../lib/http');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

// --- Configuration ---
const N_BLOCKS = 2; // Sniper window: first N blocks after pool creation

// --- Database Queries ---
const pickTokensForSniperDetection = db.prepare(`
  SELECT mint, symbol, pool_created_at, pool_signature, sniper_count
  FROM tokens
  WHERE pool_created_at IS NOT NULL 
    AND pool_signature IS NOT NULL
    AND datetime(pool_created_at) > datetime('now', '-24 hours')
  ORDER BY datetime(pool_created_at) DESC
  LIMIT 10
`);

const getTokenEvents = db.prepare(`
  SELECT signature, received_at, raw_json
  FROM token_events
  WHERE mint = ? AND received_at >= ? AND received_at < ?
  ORDER BY received_at ASC
`);

const updateHolderType = db.prepare(`
  UPDATE holders
  SET holder_type = CASE 
    WHEN holder_type = 'unknown' THEN ?
    WHEN holder_type NOT LIKE '%' || ? || '%' THEN holder_type || ',' || ?
    ELSE holder_type
  END,
  is_sniper = 1
  WHERE mint = ? AND owner = ?
`);

const updateTokenSniperCount = db.prepare(`
  UPDATE tokens
  SET sniper_count = ?
  WHERE mint = ?
`);

// --- Helius API Functions ---
async function fetchTransactionDetails(signature) {
  if (!HELIUS_API_KEY || HELIUS_API_KEY === 'your_helius_key') {
    return null;
  }

  try {
    const url = `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_API_KEY}`;
    const response = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: [signature] })
    });
    return response?.[0] || null;
  } catch (error) {
    logger.error('sniper-detector', signature, 'api_error', `Failed to fetch transaction details: ${error.message}`);
    return null;
  }
}

async function fetchBlockHeight(timestamp) {
  if (!HELIUS_API_KEY || HELIUS_API_KEY === 'your_helius_key') {
    return null;
  }

  try {
    // Convert timestamp to block height (approximate)
    const url = `https://api.helius.xyz/v0/blocks?api-key=${HELIUS_API_KEY}&before=${timestamp}`;
    const response = await fetchJson(url);
    return response?.[0]?.slot || null;
  } catch (error) {
    logger.error('sniper-detector', timestamp, 'api_error', `Failed to fetch block height: ${error.message}`);
    return null;
  }
}

// --- Sniper Detection Functions ---
function extractBuyersFromTransaction(tx, mint) {
  const buyers = new Set();
  
  if (!tx?.transaction?.message?.instructions) return buyers;
  
  for (const instruction of tx.transaction.message.instructions) {
    // Token transfers (buying)
    if (instruction?.program === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
      const parsed = instruction?.parsed;
      if (parsed?.type === 'transfer' && parsed?.info?.mint === mint) {
        const destination = parsed.info.destination;
        if (destination) {
          buyers.add(destination);
        }
      }
    }
    
    // DEX swaps (buying)
    if (instruction?.program === '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8' || // Raydium
        instruction?.program === 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB' || // Meteora
        instruction?.program === '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP') { // Orca
      const parsed = instruction?.parsed;
      if (parsed?.type === 'swap' && parsed?.info?.mintA === mint) {
        const user = parsed.info.user;
        if (user) {
          buyers.add(user);
        }
      }
    }
  }
  
  return buyers;
}

function findSniperTransactions(transactions, poolSlot, sniperWindowEnd) {
  const sniperBuyers = new Set();
  
  for (const tx of transactions) {
    if (!tx?.slot || !tx?.blockTime) continue;
    
    // Check if transaction is within sniper window (pool slot + N blocks)
    if (tx.slot >= poolSlot && tx.slot <= sniperWindowEnd) {
      // This transaction is in the sniper window
      const buyers = extractBuyersFromTransaction(tx, tx.mint);
      buyers.forEach(buyer => sniperBuyers.add(buyer));
    }
  }
  
  return sniperBuyers;
}

// --- Main Processing Function ---
async function processTokenSniperDetection(token) {
  const { mint, symbol, pool_created_at, pool_signature } = token;
  
  logger.info('sniper-detector', mint, 'start', `Processing sniper detection for ${symbol} (${mint})`);
  
  try {
    // 1. Get pool creation slot from database
    const poolInfo = db.prepare(`
      SELECT pool_created_at, pool_signature, slot
      FROM tokens 
      WHERE mint = ? AND pool_signature IS NOT NULL
    `).get(mint);
    
    if (!poolInfo || !poolInfo.slot) {
      logger.warning('sniper-detector', mint, 'no_pool_slot', 'No pool slot found, skipping sniper detection');
      return;
    }
    
    const poolSlot = poolInfo.slot;
    
    // 2. Calculate sniper window (pool slot + N blocks)
    // Note: In Solana, slots are roughly equivalent to blocks
    const sniperWindowEnd = poolSlot + N_BLOCKS;
    
    // 3. Calculate time window for fetching transactions (wider window to ensure we catch all)
    const poolTime = new Date(pool_created_at);
    const windowStart = new Date(poolTime.getTime() - 5 * 60 * 1000); // -5 minutes
    const windowEnd = new Date(poolTime.getTime() + 15 * 60 * 1000); // +15 minutes
    
    // 4. Fetch transactions in the time window
    const transactions = await fetchTokenTransactions(mint, windowStart.toISOString(), windowEnd.toISOString());
    
    if (transactions.length === 0) {
      logger.warning('sniper-detector', mint, 'no_transactions', 'No transactions found in time window');
      return;
    }
    
    // 5. Find sniper buyers using block-based detection
    const sniperBuyers = findSniperTransactions(transactions, poolSlot, sniperWindowEnd);
    
    if (sniperBuyers.size === 0) {
      logger.info('sniper-detector', mint, 'no_snipers', 'No snipers detected');
      return;
    }
    
    // 6. Update holder types
    let updatedCount = 0;
    for (const buyer of sniperBuyers) {
      try {
        updateHolderType.run('sniper', 'sniper', 'sniper', mint, buyer);
        updatedCount++;
      } catch (error) {
        logger.warning('sniper-detector', mint, 'update_error', `Failed to update holder ${buyer}: ${error.message}`);
      }
    }
    
    // 7. Update token sniper count
    updateTokenSniperCount.run(sniperBuyers.size, mint);
    
    logger.success('sniper-detector', mint, 'complete', `Sniper detection completed`, {
      snipers: sniperBuyers.size,
      updated: updatedCount,
      poolSlot: poolSlot,
      sniperWindowEnd: sniperWindowEnd
    });
    
  } catch (error) {
    logger.error('sniper-detector', mint, 'failed', `Sniper detection failed: ${error.message}`);
    throw error;
  }
}

// Helper function to fetch token transactions
async function fetchTokenTransactions(mint, startTime, endTime) {
  if (!HELIUS_API_KEY || HELIUS_API_KEY === 'your_helius_key') {
    logger.warning('sniper-detector', mint, 'transactions', 'Skipping transaction fetch (no API key)');
    return [];
  }

  try {
    const url = `https://api.helius.xyz/v0/addresses/${mint}/transactions?api-key=${HELIUS_API_KEY}&limit=1000&before=${endTime}&until=${startTime}`;
    const response = await fetchJson(url);
    return response || [];
  } catch (error) {
    logger.error('sniper-detector', mint, 'api_error', `Failed to fetch transactions: ${error.message}`);
    return [];
  }
}

// --- Main Loop ---
async function mainLoop() {
  const tokens = pickTokensForSniperDetection.all();
  
  if (tokens.length === 0) {
    logger.info('sniper-detector', null, 'batch', 'No tokens need sniper detection');
    return;
  }
  
  logger.info('sniper-detector', null, 'batch', `Processing ${tokens.length} tokens for sniper detection`, { 
    batchSize: tokens.length 
  });
  
  for (const token of tokens) {
    try {
      await processTokenSniperDetection(token);
      // Small delay to be polite to APIs
      await sleep(1000);
    } catch (error) {
      logger.error('sniper-detector', token.mint, 'batch', `Failed to process token: ${error.message}`);
      // Continue with next token
    }
  }
  
  logger.info('sniper-detector', null, 'complete', 'Sniper detection batch completed');
}

// Run if called directly
if (require.main === module) {
  mainLoop().then(() => process.exit(0)).catch(error => {
    logger.error('sniper-detector', null, 'fatal', `Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { mainLoop, processTokenSniperDetection };
