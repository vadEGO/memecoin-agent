// workers/wallet-profiling-worker.js - Main orchestrator for Task 8: Wallet Profiling v1
require('dotenv').config();
const Database = require('better-sqlite3');
const logger = require('../lib/logger');
const { 
  formatCLITableHeader, 
  formatCLITableRow, 
  formatHealthScoreCard,
  formatDiscordAlert,
  formatWalletBreakdown,
  WALLET_CLASSES
} = require('../lib/visual-encoding');

// Import all detection workers
const poolLocator = require('./pool-locator-worker');
const sniperDetector = require('./sniper-detector-worker');
const bundlerDetector = require('./bundler-detector-worker');
const insiderDetector = require('./insider-detector-worker');
const healthScoreCalculator = require('./health-score-worker');
const historySnapshot = require('./history-snapshot-worker');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

// --- Database Queries ---
const getTokenSummary = db.prepare(`
  SELECT mint, symbol, holders_count, fresh_wallets_count, liquidity_usd,
         sniper_count, bundler_count, insider_count, health_score,
         pool_created_at, dev_wallet
  FROM tokens
  WHERE first_seen_at IS NOT NULL
    AND datetime(first_seen_at) > datetime('now', '-24 hours')
  ORDER BY health_score DESC
  LIMIT 50
`);

const getTokenHolders = db.prepare(`
  SELECT owner, amount, holder_type, wallet_age_days
  FROM holders
  WHERE mint = ?
  ORDER BY CAST(amount AS REAL) DESC
`);

// --- Main Processing Function ---
async function processWalletProfiling() {
  logger.info('wallet-profiling', null, 'start', 'Starting wallet profiling pipeline');
  
  try {
    // Step 1: Pool Detection
    logger.info('wallet-profiling', null, 'step1', 'Running pool detection...');
    await poolLocator.mainLoop();
    
    // Step 2: Sniper Detection
    logger.info('wallet-profiling', null, 'step2', 'Running sniper detection...');
    await sniperDetector.mainLoop();
    
    // Step 3: Bundler Detection
    logger.info('wallet-profiling', null, 'step3', 'Running bundler detection...');
    await bundlerDetector.mainLoop();
    
    // Step 4: Insider Detection
    logger.info('wallet-profiling', null, 'step4', 'Running insider detection...');
    await insiderDetector.mainLoop();
    
    // Step 5: Health Score Calculation
    logger.info('wallet-profiling', null, 'step5', 'Calculating health scores...');
    await healthScoreCalculator.mainLoop();
    
    // Step 6: History Snapshots
    logger.info('wallet-profiling', null, 'step6', 'Creating history snapshots...');
    await historySnapshot.mainLoop();
    
    // Step 7: Generate Summary Report
    logger.info('wallet-profiling', null, 'step7', 'Generating summary report...');
    await generateSummaryReport();
    
    logger.success('wallet-profiling', null, 'complete', 'Wallet profiling pipeline completed successfully');
    
  } catch (error) {
    logger.error('wallet-profiling', null, 'failed', `Wallet profiling pipeline failed: ${error.message}`);
    throw error;
  }
}

// --- Summary Report Generation ---
async function generateSummaryReport() {
  const tokens = getTokenSummary.all();
  
  if (tokens.length === 0) {
    logger.info('wallet-profiling', null, 'report', 'No tokens found for summary report');
    return;
  }
  
  logger.info('wallet-profiling', null, 'report', `Generating summary report for ${tokens.length} tokens`);
  
  // Generate alerts for high-risk tokens
  const highRiskTokens = tokens.filter(token => 
    token.health_score < 30 || 
    token.insider_count > token.holders_count * 0.2 ||
    token.sniper_count > token.holders_count * 0.3
  );
  
  if (highRiskTokens.length > 0) {
    logger.warning('wallet-profiling', null, 'high_risk', `Found ${highRiskTokens.length} high-risk tokens`);
    
    for (const token of highRiskTokens) {
      const riskReasons = [];
      if (token.health_score < 30) riskReasons.push('Low health score');
      if (token.insider_count > token.holders_count * 0.2) riskReasons.push('High insider ratio');
      if (token.sniper_count > token.holders_count * 0.3) riskReasons.push('High sniper ratio');
      
      logger.warning('wallet-profiling', token.mint, 'risk_alert', 
        `⚠️ ${token.symbol} (${token.mint}) — ${riskReasons.join(', ')}`, {
          healthScore: token.health_score,
          insiders: token.insider_count,
          snipers: token.sniper_count,
          holders: token.holders_count
        }
      );
    }
  }
  
  // Generate success alerts for healthy tokens
  const healthyTokens = tokens.filter(token => token.health_score > 70);
  
  if (healthyTokens.length > 0) {
    logger.info('wallet-profiling', null, 'healthy', `Found ${healthyTokens.length} healthy tokens`);
    
    for (const token of healthyTokens.slice(0, 5)) { // Show top 5 healthy tokens
      // Get wallet class counts for Discord alert
      const holders = getTokenHolders.all(token.mint);
      const counts = {
        fresh: holders.filter(h => h.holder_type.includes('fresh')).length,
        inception: holders.filter(h => h.holder_type.includes('inception')).length,
        snipers: holders.filter(h => h.holder_type.includes('sniper')).length,
        bundled: holders.filter(h => h.holder_type.includes('bundled')).length,
        insiders: holders.filter(h => h.holder_type.includes('insider')).length,
        others: holders.filter(h => h.holder_type === 'unknown').length
      };
      
      const discordAlert = formatDiscordAlert(token, counts);
      logger.info('wallet-profiling', token.mint, 'health_alert', discordAlert, {
        healthScore: token.health_score,
        freshRatio: token.fresh_wallets_count / token.holders_count,
        liquidity: token.liquidity_usd
      });
    }
  }
  
  // Log summary statistics
  const avgHealthScore = tokens.reduce((sum, token) => sum + token.health_score, 0) / tokens.length;
  const totalSnipers = tokens.reduce((sum, token) => sum + token.sniper_count, 0);
  const totalBundlers = tokens.reduce((sum, token) => sum + token.bundler_count, 0);
  const totalInsiders = tokens.reduce((sum, token) => sum + token.insider_count, 0);
  
  logger.info('wallet-profiling', null, 'summary', 'Wallet profiling summary', {
    totalTokens: tokens.length,
    avgHealthScore: Math.round(avgHealthScore * 100) / 100,
    totalSnipers,
    totalBundlers,
    totalInsiders,
    highRiskTokens: highRiskTokens.length,
    healthyTokens: healthyTokens.length
  });
}

// --- Discord/Telegram Alert Generation ---
function generateDiscordAlert(mint) {
  const token = db.prepare(`
    SELECT * FROM tokens WHERE mint = ?
  `).get(mint);
  
  if (!token) {
    return `Token ${mint} not found`;
  }
  
  const holders = getTokenHolders.all(mint);
  const counts = {
    fresh: holders.filter(h => h.holder_type.includes('fresh')).length,
    inception: holders.filter(h => h.holder_type.includes('inception')).length,
    snipers: holders.filter(h => h.holder_type.includes('sniper')).length,
    bundled: holders.filter(h => h.holder_type.includes('bundled')).length,
    insiders: holders.filter(h => h.holder_type.includes('insider')).length,
    others: holders.filter(h => h.holder_type === 'unknown').length
  };
  
  return formatDiscordAlert(token, counts);
}

// --- CLI Display Functions ---
function displayTokenTable() {
  const tokens = getTokenSummary.all();
  
  if (tokens.length === 0) {
    console.log('No tokens found for display');
    return;
  }
  
  console.log('\n📊 Wallet Profiling Dashboard');
  console.log(formatCLITableHeader());
  
  for (const token of tokens) {
    // Get wallet class counts for this token
    const holders = getTokenHolders.all(token.mint);
    const counts = {
      fresh: holders.filter(h => h.holder_type.includes('fresh')).length,
      inception: holders.filter(h => h.holder_type.includes('inception')).length,
      snipers: holders.filter(h => h.holder_type.includes('sniper')).length,
      bundled: holders.filter(h => h.holder_type.includes('bundled')).length,
      insiders: holders.filter(h => h.holder_type.includes('insider')).length,
      others: holders.filter(h => h.holder_type === 'unknown').length
    };
    
    console.log(formatCLITableRow(token, counts));
  }
  
  console.log('─'.repeat(120));
}

function displayTokenDetail(mint) {
  const token = db.prepare(`
    SELECT * FROM tokens WHERE mint = ?
  `).get(mint);
  
  if (!token) {
    console.log(`Token ${mint} not found`);
    return;
  }
  
  const holders = getTokenHolders.all(mint);
  
  // Calculate wallet class counts
  const counts = {
    fresh: holders.filter(h => h.holder_type.includes('fresh')).length,
    inception: holders.filter(h => h.holder_type.includes('inception')).length,
    snipers: holders.filter(h => h.holder_type.includes('sniper')).length,
    bundled: holders.filter(h => h.holder_type.includes('bundled')).length,
    insiders: holders.filter(h => h.holder_type.includes('insider')).length,
    others: holders.filter(h => h.holder_type === 'unknown').length
  };
  
  console.log(`\n🔍 Token Detail: ${token.symbol} (${mint})`);
  console.log('═'.repeat(80));
  
  // Health score card
  console.log(formatHealthScoreCard(token, counts));
  
  console.log(`\nPool Created: ${token.pool_created_at || 'Unknown'}`);
  console.log(`Dev Wallet: ${token.dev_wallet || 'Unknown'}`);
  
  console.log('\n📊 Wallet Classes:');
  const breakdown = formatWalletBreakdown(counts, token.holders_count || 0, true);
  console.log(breakdown);
  
  console.log('\n💰 Top 10 Holders:');
  holders.slice(0, 10).forEach((holder, index) => {
    const types = holder.holder_type.split(',').map(t => t.trim()).filter(t => t);
    const typeDisplay = types.length > 0 ? types.join(', ') : 'unknown';
    console.log(`  ${index + 1}. ${holder.owner.slice(0, 8)}... (${holder.amount}) - ${typeDisplay}`);
  });
}

// --- Main Loop ---
async function mainLoop() {
  try {
    await processWalletProfiling();
  } catch (error) {
    logger.error('wallet-profiling', null, 'fatal', `Fatal error: ${error.message}`);
    process.exit(1);
  }
}

// --- CLI Interface ---
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Run full profiling pipeline
    mainLoop().then(() => process.exit(0));
  } else if (args[0] === 'table') {
    // Display token table
    displayTokenTable();
  } else if (args[0] === 'detail' && args[1]) {
    // Display token detail
    displayTokenDetail(args[1]);
  } else {
    console.log('Usage:');
    console.log('  node wallet-profiling-worker.js          # Run full profiling pipeline');
    console.log('  node wallet-profiling-worker.js table    # Display token table');
    console.log('  node wallet-profiling-worker.js detail <mint>  # Display token detail');
  }
}

module.exports = { 
  mainLoop, 
  processWalletProfiling, 
  displayTokenTable, 
  displayTokenDetail,
  generateDiscordAlert
};
