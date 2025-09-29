// workers/pool-locator-worker.js - Pool creation detection for Task 8
require('dotenv').config();
const Database = require('better-sqlite3');
const { fetchJson, sleep } = require('../lib/http');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

// --- Database Queries ---
const pickTokensForPoolDetection = db.prepare(`
  SELECT mint, symbol, first_seen_at, pool_created_at, pool_signature
  FROM tokens
  WHERE pool_created_at IS NULL 
    AND first_seen_at IS NOT NULL
    AND datetime(first_seen_at) > datetime('now', '-24 hours')
  ORDER BY datetime(first_seen_at) DESC
  LIMIT 10
`);

const updateTokenPoolInfo = db.prepare(`
  UPDATE tokens
  SET pool_created_at = ?, pool_signature = ?, dev_wallet = ?
  WHERE mint = ?
`);

// --- Helius API Functions ---
async function fetchTokenTransactions(mint, startTime, endTime) {
  if (!HELIUS_API_KEY || HELIUS_API_KEY === 'your_helius_key') {
    logger.warning('pool-locator', mint, 'transactions', 'Skipping transaction fetch (no API key)');
    return [];
  }

  try {
    const url = `https://api.helius.xyz/v0/addresses/${mint}/transactions?api-key=${HELIUS_API_KEY}&limit=1000&before=${endTime}&until=${startTime}`;
    const response = await fetchJson(url);
    return response || [];
  } catch (error) {
    logger.error('pool-locator', mint, 'api_error', `Failed to fetch transactions: ${error.message}`);
    return [];
  }
}

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
    logger.error('pool-locator', signature, 'api_error', `Failed to fetch transaction details: ${error.message}`);
    return null;
  }
}

// --- Pool Detection Functions ---
function findPoolCreationTransaction(transactions, mint) {
  // Look for DEX pool creation patterns
  for (const tx of transactions) {
    if (!tx?.transaction?.message?.instructions) continue;
    
    for (const instruction of tx.transaction.message.instructions) {
      // Raydium pool creation
      if (instruction?.program === '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8') {
        const parsed = instruction?.parsed;
        if (parsed?.type === 'initialize' && parsed?.info?.mintA === mint) {
          return {
            signature: tx.transaction.signatures[0],
            timestamp: new Date(tx.blockTime * 1000).toISOString(),
            type: 'raydium'
          };
        }
      }
      
      // Meteora pool creation
      if (instruction?.program === 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB') {
        const parsed = instruction?.parsed;
        if (parsed?.type === 'initialize' && parsed?.info?.mintA === mint) {
          return {
            signature: tx.transaction.signatures[0],
            timestamp: new Date(tx.blockTime * 1000).toISOString(),
            type: 'meteora'
          };
        }
      }
      
      // Orca pool creation
      if (instruction?.program === '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP') {
        const parsed = instruction?.parsed;
        if (parsed?.type === 'initialize' && parsed?.info?.mintA === mint) {
          return {
            signature: tx.transaction.signatures[0],
            timestamp: new Date(tx.blockTime * 1000).toISOString(),
            type: 'orca'
          };
        }
      }
    }
  }
  
  return null;
}

function findDevWallet(transactions, mint) {
  // Look for the creator/developer wallet
  for (const tx of transactions) {
    if (!tx?.transaction?.message?.instructions) continue;
    
    for (const instruction of tx.transaction.message.instructions) {
      // Token creation or initial mint
      if (instruction?.program === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
        const parsed = instruction?.parsed;
        if (parsed?.type === 'mintTo' && parsed?.info?.mint === mint) {
          // The authority that can mint is likely the dev
          return parsed.info.authority;
        }
      }
    }
  }
  
  return null;
}

// --- Main Processing Function ---
async function processTokenPoolDetection(token) {
  const { mint, symbol, first_seen_at } = token;
  
  logger.info('pool-locator', mint, 'start', `Processing pool detection for ${symbol} (${mint})`);
  
  try {
    // 1. Calculate time window (1 hour before first_seen_at to 1 hour after)
    const firstSeenTime = new Date(first_seen_at);
    const startTime = new Date(firstSeenTime.getTime() - 60 * 60 * 1000); // -1 hour
    const endTime = new Date(firstSeenTime.getTime() + 60 * 60 * 1000); // +1 hour
    
    // 2. Fetch transactions in the time window
    const transactions = await fetchTokenTransactions(mint, startTime.toISOString(), endTime.toISOString());
    
    if (transactions.length === 0) {
      logger.warning('pool-locator', mint, 'no_transactions', 'No transactions found in time window');
      return;
    }
    
    // 3. Find pool creation transaction
    const poolInfo = findPoolCreationTransaction(transactions, mint);
    
    if (!poolInfo) {
      logger.warning('pool-locator', mint, 'no_pool', 'No pool creation transaction found');
      return;
    }
    
    // 4. Find developer wallet
    const devWallet = findDevWallet(transactions, mint);
    
    // 5. Update token with pool information
    updateTokenPoolInfo.run(
      poolInfo.timestamp,
      poolInfo.signature,
      devWallet,
      mint
    );
    
    logger.success('pool-locator', mint, 'complete', `Pool detection completed`, {
      poolTime: poolInfo.timestamp,
      poolSignature: poolInfo.signature,
      poolType: poolInfo.type,
      devWallet: devWallet
    });
    
  } catch (error) {
    logger.error('pool-locator', mint, 'failed', `Pool detection failed: ${error.message}`);
    throw error;
  }
}

// --- Main Loop ---
async function mainLoop() {
  const tokens = pickTokensForPoolDetection.all();
  
  if (tokens.length === 0) {
    logger.info('pool-locator', null, 'batch', 'No tokens need pool detection');
    return;
  }
  
  logger.info('pool-locator', null, 'batch', `Processing ${tokens.length} tokens for pool detection`, { 
    batchSize: tokens.length 
  });
  
  for (const token of tokens) {
    try {
      await processTokenPoolDetection(token);
      // Small delay to be polite to APIs
      await sleep(1000);
    } catch (error) {
      logger.error('pool-locator', token.mint, 'batch', `Failed to process token: ${error.message}`);
      // Continue with next token
    }
  }
  
  logger.info('pool-locator', null, 'complete', 'Pool detection batch completed');
}

// Run if called directly
if (require.main === module) {
  mainLoop().then(() => process.exit(0)).catch(error => {
    logger.error('pool-locator', null, 'fatal', `Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { mainLoop, processTokenPoolDetection };
