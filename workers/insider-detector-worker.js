// workers/insider-detector-worker.js - Insider detection for Task 8
require('dotenv').config();
const Database = require('better-sqlite3');
const { fetchJson, sleep } = require('../lib/http');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

// --- Configuration ---
const HOPS = 2; // Maximum hops for funding lineage analysis
const AGE_FRESH_DAYS = 2; // Maximum age for fresh wallets
const TOP_N = 20; // Number of top holders to analyze

// --- Database Queries ---
const pickTokensForInsiderDetection = db.prepare(`
  SELECT mint, symbol, dev_wallet, insider_count
  FROM tokens
  WHERE dev_wallet IS NOT NULL
    AND datetime(first_seen_at) > datetime('now', '-24 hours')
  ORDER BY datetime(first_seen_at) DESC
  LIMIT 10
`);

const getTopHolders = db.prepare(`
  SELECT owner, amount, wallet_age_days, first_seen_at
  FROM holders
  WHERE mint = ?
  ORDER BY CAST(amount AS REAL) DESC
  LIMIT ?
`);

const getFundingEdges = db.prepare(`
  SELECT src_wallet, dst_wallet, timestamp
  FROM funding_edges
  WHERE src_wallet = ? OR dst_wallet = ?
  ORDER BY timestamp DESC
`);

const updateHolderType = db.prepare(`
  UPDATE holders
  SET holder_type = CASE 
    WHEN holder_type = 'unknown' THEN ?
    WHEN holder_type NOT LIKE '%' || ? || '%' THEN holder_type || ',' || ?
    ELSE holder_type
  END,
  is_insider = 1
  WHERE mint = ? AND owner = ?
`);

const updateTokenInsiderCount = db.prepare(`
  UPDATE tokens
  SET insider_count = ?
  WHERE mint = ?
`);

// --- Insider Detection Functions ---
function buildFundingLineageGraph(fundingEdges) {
  const graph = new Map(); // wallet -> Set of connected wallets
  
  for (const edge of fundingEdges) {
    if (!graph.has(edge.src_wallet)) {
      graph.set(edge.src_wallet, new Set());
    }
    if (!graph.has(edge.dst_wallet)) {
      graph.set(edge.dst_wallet, new Set());
    }
    
    graph.get(edge.src_wallet).add(edge.dst_wallet);
    graph.get(edge.dst_wallet).add(edge.src_wallet); // Bidirectional for lineage
  }
  
  return graph;
}

function findUpstreamFunders(wallet, fundingGraph, maxHops = HOPS) {
  const upstreamFunders = new Set();
  const visited = new Set();
  const queue = [{ wallet, hops: 0 }];
  
  while (queue.length > 0) {
    const { wallet: currentWallet, hops } = queue.shift();
    
    if (visited.has(currentWallet) || hops > maxHops) continue;
    visited.add(currentWallet);
    
    if (hops > 0) {
      upstreamFunders.add(currentWallet);
    }
    
    const connectedWallets = fundingGraph.get(currentWallet) || new Set();
    for (const connectedWallet of connectedWallets) {
      if (!visited.has(connectedWallet)) {
        queue.push({ wallet: connectedWallet, hops: hops + 1 });
      }
    }
  }
  
  return upstreamFunders;
}

function calculateWalletAge(firstSeenAt) {
  if (!firstSeenAt) return null;
  const firstSeen = new Date(firstSeenAt);
  const now = new Date();
  const diffTime = Math.abs(now - firstSeen);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // days
}

function isInsider(holder, devWallet, fundingGraph, topHolders) {
  const flags = {
    F1: false, // Shares upstream funder with dev wallet
    F2: false, // Wallet age <= AGE_FRESH_DAYS
    F3: false  // Top 10 holder OR received tokens pre/at mint
  };
  
  // F1: Check if shares upstream funder with dev wallet
  if (devWallet) {
    const holderUpstream = findUpstreamFunders(holder.owner, fundingGraph, HOPS);
    const devUpstream = findUpstreamFunders(devWallet, fundingGraph, HOPS);
    
    // Check for intersection
    for (const funder of holderUpstream) {
      if (devUpstream.has(funder)) {
        flags.F1 = true;
        break;
      }
    }
  }
  
  // F2: Check wallet age
  const walletAge = calculateWalletAge(holder.first_seen_at);
  if (walletAge !== null && walletAge <= AGE_FRESH_DAYS) {
    flags.F2 = true;
  }
  
  // F3: Check if top 10 holder
  const holderRank = topHolders.findIndex(h => h.owner === holder.owner) + 1;
  if (holderRank <= 10) {
    flags.F3 = true;
  }
  
  // Insider if 2 or more flags are true
  const flagCount = Object.values(flags).filter(Boolean).length;
  return flagCount >= 2;
}

// --- Main Processing Function ---
async function processTokenInsiderDetection(token) {
  const { mint, symbol, dev_wallet } = token;
  
  logger.info('insider-detector', mint, 'start', `Processing insider detection for ${symbol} (${mint})`);
  
  try {
    // 1. Get top holders for analysis
    const topHolders = getTopHolders.all(mint, TOP_N);
    
    if (topHolders.length === 0) {
      logger.warning('insider-detector', mint, 'no_holders', 'No holders found for analysis');
      return;
    }
    
    // 2. Get funding edges for lineage analysis
    const fundingEdges = getFundingEdges.all(dev_wallet, dev_wallet);
    
    // 3. Build funding lineage graph
    const fundingGraph = buildFundingLineageGraph(fundingEdges);
    
    // 4. Analyze each top holder for insider signals
    const insiders = [];
    
    for (const holder of topHolders) {
      if (isInsider(holder, dev_wallet, fundingGraph, topHolders)) {
        insiders.push(holder);
      }
    }
    
    if (insiders.length === 0) {
      logger.info('insider-detector', mint, 'no_insiders', 'No insiders detected');
      return;
    }
    
    // 5. Update holder types
    let updatedCount = 0;
    for (const insider of insiders) {
      try {
        updateHolderType.run('insider', 'insider', 'insider', mint, insider.owner);
        updatedCount++;
      } catch (error) {
        logger.warning('insider-detector', mint, 'update_error', `Failed to update insider ${insider.owner}: ${error.message}`);
      }
    }
    
    // 6. Update token insider count
    updateTokenInsiderCount.run(insiders.length, mint);
    
    logger.success('insider-detector', mint, 'complete', `Insider detection completed`, {
      insiders: insiders.length,
      updated: updatedCount,
      devWallet: dev_wallet,
      fundingEdges: fundingEdges.length
    });
    
  } catch (error) {
    logger.error('insider-detector', mint, 'failed', `Insider detection failed: ${error.message}`);
    throw error;
  }
}

// --- Main Loop ---
async function mainLoop() {
  const tokens = pickTokensForInsiderDetection.all();
  
  if (tokens.length === 0) {
    logger.info('insider-detector', null, 'batch', 'No tokens need insider detection');
    return;
  }
  
  logger.info('insider-detector', null, 'batch', `Processing ${tokens.length} tokens for insider detection`, { 
    batchSize: tokens.length 
  });
  
  for (const token of tokens) {
    try {
      await processTokenInsiderDetection(token);
      // Small delay to be polite to APIs
      await sleep(1000);
    } catch (error) {
      logger.error('insider-detector', token.mint, 'batch', `Failed to process token: ${error.message}`);
      // Continue with next token
    }
  }
  
  logger.info('insider-detector', null, 'complete', 'Insider detection batch completed');
}

// Run if called directly
if (require.main === module) {
  mainLoop().then(() => process.exit(0)).catch(error => {
    logger.error('insider-detector', null, 'fatal', `Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { mainLoop, processTokenInsiderDetection };
