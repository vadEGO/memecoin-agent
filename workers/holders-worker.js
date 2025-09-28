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
  INSERT OR REPLACE INTO holders (mint, owner, amount, last_seen_at, wallet_age_days, is_inception, is_sniper, is_bundler, is_insider, first_seen_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

const insertHistorySnapshot = db.prepare(`
  INSERT OR REPLACE INTO holders_history 
  (mint, snapshot_time, holders_count, fresh_wallets_count, inception_count, sniper_count, bundler_count, insider_count, fresh_ratio, top10_share, sniper_ratio, health_score)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

// --- Wallet Classification Functions ---
function calculateWalletAge(firstSeenAt) {
  if (!firstSeenAt) return null;
  const firstSeen = new Date(firstSeenAt);
  const now = new Date();
  const diffTime = Math.abs(now - firstSeen);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // days
}

function classifyWallet(owner, tokenAccounts, inceptionHolders, transactions, firstSeenAt) {
  const walletAge = calculateWalletAge(firstSeenAt);
  const isInception = inceptionHolders.has(owner);
  
  // Sniper: first 1-2 blocks post-launch
  const isSniper = walletAge === 0 && !isInception;
  
  // Bundler: 1 wallet disperses to 10+ wallets right after buying
  const isBundler = false; // TODO: Implement bundler detection logic
  
  // Insider: received SOL from same wallet as dev (simplified check)
  const isInsider = false; // TODO: Implement insider detection logic
  
  return {
    walletAge,
    isInception: isInception ? 1 : 0,
    isSniper: isSniper ? 1 : 0,
    isBundler: isBundler ? 1 : 0,
    isInsider: isInsider ? 1 : 0
  };
}

function calculateRatios(holders) {
  const totalHolders = holders.length;
  if (totalHolders === 0) {
    return { freshRatio: 0, top10Share: 0, sniperRatio: 0 };
  }
  
  const freshCount = holders.filter(h => h.isInception === 0).length;
  const sniperCount = holders.filter(h => h.isSniper === 1).length;
  
  // Top 10 share calculation
  const sortedByAmount = holders
    .map(h => parseFloat(h.amount) || 0)
    .sort((a, b) => b - a);
  const top10Amount = sortedByAmount.slice(0, 10).reduce((sum, amount) => sum + amount, 0);
  const totalAmount = sortedByAmount.reduce((sum, amount) => sum + amount, 0);
  const top10Share = totalAmount > 0 ? top10Amount / totalAmount : 0;
  
  return {
    freshRatio: freshCount / totalHolders,
    top10Share,
    sniperRatio: sniperCount / totalHolders
  };
}

function calculateHealthScore(ratios, holders) {
  let score = 50; // Base score
  
  // Fresh ratio bonus (0-30 points)
  if (ratios.freshRatio > 0.7) score += 30;
  else if (ratios.freshRatio > 0.5) score += 20;
  else if (ratios.freshRatio > 0.3) score += 10;
  
  // Top 10 share penalty (0-20 points)
  if (ratios.top10Share > 0.8) score -= 20;
  else if (ratios.top10Share > 0.6) score -= 10;
  else if (ratios.top10Share < 0.3) score += 10;
  
  // Sniper ratio penalty (0-20 points)
  if (ratios.sniperRatio > 0.5) score -= 20;
  else if (ratios.sniperRatio > 0.3) score -= 10;
  
  // Holder count bonus (0-20 points)
  if (holders.length > 1000) score += 20;
  else if (holders.length > 500) score += 15;
  else if (holders.length > 100) score += 10;
  else if (holders.length > 50) score += 5;
  
  return Math.max(0, Math.min(100, Math.round(score)));
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
    
    // 2. Calculate fresh window (30 minutes from first_seen_at)
    const firstSeenTime = new Date(first_seen_at);
    const freshWindowEnd = new Date(firstSeenTime.getTime() + 30 * 60 * 1000); // +30 minutes
    
    // 3. Fetch transactions in the fresh window
    const transactions = await fetchParsedTransactions(
      mint, 
      first_seen_at, 
      freshWindowEnd.toISOString()
    );
    
    // 4. Extract inception holders and classify wallets
    const inceptionHolders = extractInceptionHolders(transactions);
    
    // 5. Upsert all holders with classification into database
    const classifiedHolders = [];
    for (const account of tokenAccounts) {
      const classification = classifyWallet(
        account.owner, 
        tokenAccounts, 
        inceptionHolders, 
        transactions, 
        account.lastSeen
      );
      
      upsertHolder.run(
        mint, 
        account.owner, 
        account.amount, 
        account.lastSeen,
        classification.walletAge,
        classification.isInception,
        classification.isSniper,
        classification.isBundler,
        classification.isInsider,
        account.lastSeen
      );
      
      classifiedHolders.push({
        owner: account.owner,
        amount: account.amount,
        ...classification
      });
    }
    
    // 6. Calculate ratios and health score
    const ratios = calculateRatios(classifiedHolders);
    const healthScore = calculateHealthScore(ratios, classifiedHolders);
    
    // 7. Calculate counts by type
    const holdersCount = classifiedHolders.length;
    const freshWalletsCount = classifiedHolders.filter(h => h.isInception === 0).length;
    const inceptionCount = classifiedHolders.filter(h => h.isInception === 1).length;
    const sniperCount = classifiedHolders.filter(h => h.isSniper === 1).length;
    const bundlerCount = classifiedHolders.filter(h => h.isBundler === 1).length;
    const insiderCount = classifiedHolders.filter(h => h.isInsider === 1).length;
    
    // 8. Update token counts
    updateTokenCounts.run(holdersCount, freshWalletsCount, now, mint);
    
    // 9. Create history snapshot
    insertHistorySnapshot.run(
      mint,
      now,
      holdersCount,
      freshWalletsCount,
      inceptionCount,
      sniperCount,
      bundlerCount,
      insiderCount,
      ratios.freshRatio,
      ratios.top10Share,
      ratios.sniperRatio,
      healthScore
    );
    
    logger.success('holders', mint, 'complete', `Holders processed successfully`, {
      holders: holdersCount,
      fresh: freshWalletsCount,
      inception: inceptionCount,
      sniper: sniperCount,
      healthScore: healthScore,
      freshRatio: ratios.freshRatio.toFixed(3),
      top10Share: ratios.top10Share.toFixed(3)
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
