// workers/bundler-detector-worker.js - Bundler detection for Task 8
require('dotenv').config();
const Database = require('better-sqlite3');
const { fetchJson, sleep } = require('../lib/http');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

// --- Configuration ---
const K_WALLETS = 5; // Minimum wallets to fund to be considered a bundler
const T_MINUTES = 15; // Time window for bundling activity

// --- Database Queries ---
const pickTokensForBundlerDetection = db.prepare(`
  SELECT mint, symbol, first_seen_at, bundler_count
  FROM tokens
  WHERE first_seen_at IS NOT NULL
    AND datetime(first_seen_at) > datetime('now', '-24 hours')
  ORDER BY datetime(first_seen_at) DESC
  LIMIT 10
`);

const getTopHolders = db.prepare(`
  SELECT owner, amount, last_seen_at
  FROM holders
  WHERE mint = ?
  ORDER BY CAST(amount AS REAL) DESC
  LIMIT 50
`);

const insertFundingEdge = db.prepare(`
  INSERT OR IGNORE INTO funding_edges (src_wallet, dst_wallet, amount_sol, timestamp, signature)
  VALUES (?, ?, ?, ?, ?)
`);

const updateHolderType = db.prepare(`
  UPDATE holders
  SET holder_type = CASE 
    WHEN holder_type = 'unknown' THEN ?
    WHEN holder_type NOT LIKE '%' || ? || '%' THEN holder_type || ',' || ?
    ELSE holder_type
  END,
  is_bundler = ?
  WHERE mint = ? AND owner = ?
`);

const updateTokenBundlerCount = db.prepare(`
  UPDATE tokens
  SET bundler_count = ?, bundler_pct = ?
  WHERE mint = ?
`);

// --- Helius API Functions ---
async function fetchWalletTransactions(wallet, startTime, endTime) {
  if (!HELIUS_API_KEY || HELIUS_API_KEY === 'your_helius_key') {
    return [];
  }

  try {
    const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${HELIUS_API_KEY}&limit=1000&before=${endTime}&until=${startTime}`;
    const response = await fetchJson(url);
    return response || [];
  } catch (error) {
    logger.error('bundler-detector', wallet, 'api_error', `Failed to fetch transactions: ${error.message}`);
    return [];
  }
}

// --- Bundler Detection Functions ---
function extractSOLTransfers(transactions) {
  const transfers = [];
  
  for (const tx of transactions) {
    if (!tx?.transaction?.message?.instructions) continue;
    
    for (const instruction of tx.transaction.message.instructions) {
      // SOL transfers
      if (instruction?.program === '11111111111111111111111111111111') {
        const parsed = instruction?.parsed;
        if (parsed?.type === 'transfer') {
          transfers.push({
            from: parsed.info.source,
            to: parsed.info.destination,
            amount: parsed.info.lamports / 1e9, // Convert lamports to SOL
            signature: tx.transaction.signatures[0],
            timestamp: new Date(tx.blockTime * 1000).toISOString()
          });
        }
      }
    }
  }
  
  return transfers;
}

function buildFundingGraph(transfers) {
  const graph = new Map(); // wallet -> Set of funded wallets
  
  for (const transfer of transfers) {
    if (!graph.has(transfer.from)) {
      graph.set(transfer.from, new Set());
    }
    graph.get(transfer.from).add(transfer.to);
  }
  
  return graph;
}

function findBundlers(fundingGraph, tokenBuyers, minWallets = K_WALLETS) {
  const bundlers = new Map(); // bundler -> Set of bundled wallets
  
  for (const [funder, fundedWallets] of fundingGraph) {
    // Count how many funded wallets bought the token
    const tokenBuyingWallets = new Set();
    for (const fundedWallet of fundedWallets) {
      if (tokenBuyers.has(fundedWallet)) {
        tokenBuyingWallets.add(fundedWallet);
      }
    }
    
    // If enough wallets bought the token, this is a bundler
    if (tokenBuyingWallets.size >= minWallets) {
      bundlers.set(funder, tokenBuyingWallets);
    }
  }
  
  return bundlers;
}

function extractTokenBuyers(transactions, mint) {
  const buyers = new Set();
  
  for (const tx of transactions) {
    if (!tx?.transaction?.message?.instructions) continue;
    
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
  }
  
  return buyers;
}

// --- Main Processing Function ---
async function processTokenBundlerDetection(token) {
  const { mint, symbol, first_seen_at } = token;
  
  logger.info('bundler-detector', mint, 'start', `Processing bundler detection for ${symbol} (${mint})`);
  
  try {
    // 1. Calculate time window (T minutes before and after first_seen_at)
    const firstSeenTime = new Date(first_seen_at);
    const startTime = new Date(firstSeenTime.getTime() - T_MINUTES * 60 * 1000);
    const endTime = new Date(firstSeenTime.getTime() + T_MINUTES * 60 * 1000);
    
    // 2. Get top holders to analyze
    const topHolders = getTopHolders.all(mint);
    
    if (topHolders.length === 0) {
      logger.warning('bundler-detector', mint, 'no_holders', 'No holders found for analysis');
      return;
    }
    
    // 3. Collect all SOL transfers from top holders
    const allTransfers = [];
    const tokenBuyers = new Set();
    
    for (const holder of topHolders.slice(0, 20)) { // Limit to top 20 holders
      const transactions = await fetchWalletTransactions(holder.owner, startTime.toISOString(), endTime.toISOString());
      
      // Extract SOL transfers
      const transfers = extractSOLTransfers(transactions);
      allTransfers.push(...transfers);
      
      // Extract token buyers
      const buyers = extractTokenBuyers(transactions, mint);
      buyers.forEach(buyer => tokenBuyers.add(buyer));
      
      // Small delay to be polite to APIs
      await sleep(200);
    }
    
    if (allTransfers.length === 0) {
      logger.warning('bundler-detector', mint, 'no_transfers', 'No SOL transfers found in time window');
      return;
    }
    
    // 4. Build funding graph
    const fundingGraph = buildFundingGraph(allTransfers);
    
    // 5. Find bundlers
    const bundlers = findBundlers(fundingGraph, tokenBuyers, K_WALLETS);
    
    if (bundlers.size === 0) {
      logger.info('bundler-detector', mint, 'no_bundlers', 'No bundlers detected');
      return;
    }
    
    // 6. Store funding edges and update holder types
    let bundledCount = 0;
    let bundlerCount = 0;
    
    for (const [bundler, bundledWallets] of bundlers) {
      // Mark bundler
      try {
        updateHolderType.run('bundler', 'bundler', 'bundler', 1, mint, bundler);
        bundlerCount++;
      } catch (error) {
        logger.warning('bundler-detector', mint, 'update_error', `Failed to update bundler ${bundler}: ${error.message}`);
      }
      
      // Mark bundled wallets
      for (const bundledWallet of bundledWallets) {
        try {
          updateHolderType.run('bundled', 'bundled', 'bundled', 0, mint, bundledWallet);
          bundledCount++;
          
          // Store funding edge
          insertFundingEdge.run(bundler, bundledWallet, null, first_seen_at, null);
        } catch (error) {
          logger.warning('bundler-detector', mint, 'update_error', `Failed to update bundled wallet ${bundledWallet}: ${error.message}`);
        }
      }
    }
    
    // 7. Update token bundler count and percentage
    const token = db.prepare(`SELECT holders_count FROM tokens WHERE mint = ?`).get(mint);
    const holdersCount = token?.holders_count || 0;
    const bundlerPct = holdersCount > 0 ? (bundledCount / holdersCount) * 100 : 0;
    
    updateTokenBundlerCount.run(bundledCount, bundlerPct, mint);
    
    logger.success('bundler-detector', mint, 'complete', `Bundler detection completed`, {
      bundlers: bundlerCount,
      bundled: bundledCount,
      totalTransfers: allTransfers.length,
      tokenBuyers: tokenBuyers.size
    });
    
  } catch (error) {
    logger.error('bundler-detector', mint, 'failed', `Bundler detection failed: ${error.message}`);
    throw error;
  }
}

// --- Main Loop ---
async function mainLoop() {
  const tokens = pickTokensForBundlerDetection.all();
  
  if (tokens.length === 0) {
    logger.info('bundler-detector', null, 'batch', 'No tokens need bundler detection');
    return;
  }
  
  logger.info('bundler-detector', null, 'batch', `Processing ${tokens.length} tokens for bundler detection`, { 
    batchSize: tokens.length 
  });
  
  for (const token of tokens) {
    try {
      await processTokenBundlerDetection(token);
      // Small delay to be polite to APIs
      await sleep(2000);
    } catch (error) {
      logger.error('bundler-detector', token.mint, 'batch', `Failed to process token: ${error.message}`);
      // Continue with next token
    }
  }
  
  logger.info('bundler-detector', null, 'complete', 'Bundler detection batch completed');
}

// Run if called directly
if (require.main === module) {
  mainLoop().then(() => process.exit(0)).catch(error => {
    logger.error('bundler-detector', null, 'fatal', `Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { mainLoop, processTokenBundlerDetection };
