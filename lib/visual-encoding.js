// lib/visual-encoding.js - Visual encoding system for wallet profiling
const chalk = require('chalk');

// Visual encoding scheme for wallet classes
const WALLET_CLASSES = {
  fresh: {
    icon: '🟢',
    color: {
      light: '#10B981', // emerald 500
      dark: '#34D399'   // emerald 400
    },
    name: 'Fresh',
    description: 'Early organic buyers (≤30m, not inception)'
  },
  inception: {
    icon: '🟦',
    color: {
      light: '#3B82F6', // blue 500
      dark: '#60A5FA'   // blue 400
    },
    name: 'Inception',
    description: 'Initial distribution recipients'
  },
  snipers: {
    icon: '🔴',
    color: {
      light: '#EF4444', // red 500
      dark: '#F87171'   // red 400
    },
    name: 'Snipers',
    description: 'Bought within N blocks post-pool'
  },
  bundled: {
    icon: '🟣',
    color: {
      light: '#8B5CF6', // violet 500
      dark: '#A78BFA'   // violet 400
    },
    name: 'Bundled',
    description: 'Funded by a bundler / splitter'
  },
  insiders: {
    icon: '🟠',
    color: {
      light: '#F59E0B', // amber 500
      dark: '#FBBF24'   // amber 400
    },
    name: 'Insiders',
    description: 'Funding lineage overlaps with dev'
  },
  others: {
    icon: '⚪',
    color: {
      light: '#6B7280', // gray 500
      dark: '#9CA3AF'   // gray 400
    },
    name: 'Others',
    description: 'Everyone else'
  }
};

// Health score color bands
const HEALTH_SCORE_BANDS = {
  excellent: { min: 80, max: 100, color: '#10B981', name: 'Excellent', icon: '🟢' },
  good: { min: 60, max: 79, color: '#3B82F6', name: 'Good', icon: '🔵' },
  fair: { min: 40, max: 59, color: '#F59E0B', name: 'Fair', icon: '🟡' },
  poor: { min: 0, max: 39, color: '#EF4444', name: 'Poor', icon: '🔴' }
};

// Default class order for display
const CLASS_ORDER = ['fresh', 'inception', 'snipers', 'bundled', 'insiders', 'others'];

/**
 * Format wallet class with icon and color
 * @param {string} className - The wallet class name
 * @param {number} count - Number of wallets in this class
 * @param {number} percentage - Percentage of total holders
 * @param {boolean} useChalk - Whether to use chalk colors for CLI
 * @returns {string} Formatted string
 */
function formatWalletClass(className, count, percentage, useChalk = true) {
  const classInfo = WALLET_CLASSES[className] || WALLET_CLASSES.others;
  const icon = classInfo.icon;
  const name = classInfo.name;
  const pctStr = percentage !== null ? ` (${percentage.toFixed(1)}%)` : '';
  
  if (useChalk) {
    // CLI formatting with chalk colors
    const colorMap = {
      fresh: chalk.green,
      inception: chalk.blue,
      snipers: chalk.red,
      bundled: chalk.magenta,
      insiders: chalk.yellow,
      others: chalk.gray
    };
    
    const colorFn = colorMap[className] || chalk.gray;
    return `${icon} ${colorFn(`${name} ${count}${pctStr}`)}`;
  } else {
    // Plain text for Discord/Telegram
    return `${icon} ${name} ${count}${pctStr}`;
  }
}

/**
 * Format health score with color coding
 * @param {number} score - Health score (0-100)
 * @param {boolean} useChalk - Whether to use chalk colors
 * @returns {string} Formatted health score
 */
function formatHealthScore(score, useChalk = true) {
  const band = getHealthScoreBand(score);
  const icon = band.icon;
  const name = band.name;
  
  if (useChalk) {
    const colorMap = {
      excellent: chalk.green,
      good: chalk.blue,
      fair: chalk.yellow,
      poor: chalk.red
    };
    
    const colorFn = colorMap[band.name.toLowerCase()] || chalk.gray;
    return `${icon} Health ${score}/100 (${colorFn(name)})`;
  } else {
    return `${icon} Health ${score}/100 (${name})`;
  }
}

/**
 * Get health score band for a given score
 * @param {number} score - Health score (0-100)
 * @returns {object} Health score band info
 */
function getHealthScoreBand(score) {
  for (const [bandName, band] of Object.entries(HEALTH_SCORE_BANDS)) {
    if (score >= band.min && score <= band.max) {
      return { ...band, bandName };
    }
  }
  return HEALTH_SCORE_BANDS.poor; // fallback
}

/**
 * Format token display with SYMBOL (MINT) convention
 * @param {string} symbol - Token symbol
 * @param {string} mint - Token mint address
 * @param {number} maxLength - Maximum length for display
 * @returns {string} Formatted token display
 */
function formatTokenDisplay(symbol, mint, maxLength = 50) {
  const symbolStr = symbol || 'UNKNOWN';
  const mintShort = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  const display = `${symbolStr} (${mintShort})`;
  
  if (display.length > maxLength) {
    const truncatedSymbol = symbolStr.slice(0, maxLength - 8 - mintShort.length);
    return `${truncatedSymbol} (${mintShort})`;
  }
  
  return display;
}

/**
 * Format mint address for copy functionality
 * @param {string} mint - Token mint address
 * @returns {string} Formatted mint for copying
 */
function formatMintForCopy(mint) {
  return `\`${mint}\``;
}

/**
 * Format token display with copy functionality
 * @param {string} symbol - Token symbol
 * @param {string} mint - Token mint address
 * @param {boolean} includeCopy - Whether to include copy functionality
 * @returns {string} Formatted token display with copy
 */
function formatTokenDisplayWithCopy(symbol, mint, includeCopy = true) {
  const display = formatTokenDisplay(symbol, mint);
  if (includeCopy) {
    return `${display} • Copy: ${formatMintForCopy(mint)}`;
  }
  return display;
}

/**
 * Generate explorer links from mint address
 * @param {string} mint - Token mint address
 * @returns {object} Object with explorer links
 */
function generateExplorerLinks(mint) {
  return {
    dexscreener: `https://dexscreener.com/solana/${mint}`,
    birdeye: `https://birdeye.so/token/${mint}?chain=solana`,
    solscan: `https://solscan.io/token/${mint}`
  };
}

/**
 * Format wallet class breakdown for display
 * @param {object} counts - Object with class counts
 * @param {number} totalHolders - Total number of holders
 * @param {boolean} useChalk - Whether to use chalk colors
 * @returns {string} Formatted breakdown
 */
function formatWalletBreakdown(counts, totalHolders, useChalk = true) {
  const breakdown = [];
  
  for (const className of CLASS_ORDER) {
    const count = counts[className] || 0;
    const percentage = totalHolders > 0 ? (count / totalHolders) * 100 : 0;
    
    if (count > 0) {
      breakdown.push(formatWalletClass(className, count, percentage, useChalk));
    }
  }
  
  return breakdown.join('   ');
}

/**
 * Format Discord/Telegram alert
 * @param {object} token - Token data
 * @param {object} counts - Wallet class counts
 * @returns {string} Formatted alert
 */
function formatDiscordAlert(token, counts) {
  const { symbol, mint, health_score, holders_count, liquidity_usd } = token;
  const totalHolders = holders_count || 0;
  const liquidity = liquidity_usd ? `$${(liquidity_usd / 1000).toFixed(1)}k` : '$0';
  
  const tokenDisplay = formatTokenDisplay(symbol, mint);
  const healthDisplay = formatHealthScore(health_score || 0, false);
  
  const breakdown = formatWalletBreakdown(counts, totalHolders, false);
  
  const links = generateExplorerLinks(mint);
  
  return `🚀 ${tokenDisplay} • ${healthDisplay}
Holders 30m: ${totalHolders} • Liq: ${liquidity}

${breakdown}

Links: [Dexscreener](${links.dexscreener}) | [Birdeye](${links.birdeye}) | [Solscan](${links.solscan}) • Copy mint: \`${mint}\``;
}

/**
 * Format CLI table row for wallet profiling
 * @param {object} token - Token data
 * @param {object} counts - Wallet class counts
 * @returns {string} Formatted table row
 */
function formatCLITableRow(token, counts) {
  const { symbol, mint, holders_count, health_score, liquidity_usd } = token;
  const totalHolders = holders_count || 0;
  const liquidity = liquidity_usd ? `$${(liquidity_usd / 1000).toFixed(1)}k` : '$0';
  
  const tokenDisplay = formatTokenDisplay(symbol, mint, 30);
  const healthDisplay = formatHealthScore(health_score || 0, true);
  
  const breakdown = formatWalletBreakdown(counts, totalHolders, true);
  
  return `${tokenDisplay.padEnd(30)} ${totalHolders.toString().padEnd(6)} ${breakdown}`;
}

/**
 * Format CLI table header
 * @returns {string} Formatted table header
 */
function formatCLITableHeader() {
  const header = 'SYMBOL (MINT)'.padEnd(30) + 'HOLDERS'.padEnd(8) + 'WALLET BREAKDOWN';
  const separator = '─'.repeat(120);
  return `${header}\n${separator}`;
}

/**
 * Format health score card
 * @param {object} token - Token data
 * @param {object} counts - Wallet class counts
 * @returns {string} Formatted health score card
 */
function formatHealthScoreCard(token, counts) {
  const { symbol, mint, health_score, holders_count, liquidity_usd } = token;
  const totalHolders = holders_count || 0;
  const liquidity = liquidity_usd ? `$${(liquidity_usd / 1000).toFixed(1)}k` : '$0';
  
  const tokenDisplay = formatTokenDisplay(symbol, mint);
  const healthDisplay = formatHealthScore(health_score || 0, true);
  
  const freshPct = totalHolders > 0 ? ((counts.fresh || 0) / totalHolders * 100).toFixed(1) : '0.0';
  const sniperPct = totalHolders > 0 ? ((counts.snipers || 0) / totalHolders * 100).toFixed(1) : '0.0';
  const insiderPct = totalHolders > 0 ? ((counts.insiders || 0) / totalHolders * 100).toFixed(1) : '0.0';
  
  const subtext = `Fresh ${freshPct}% • Snipers ${sniperPct}% • Insiders ${insiderPct}% • Liq ${liquidity}`;
  
  return `${healthDisplay}
${tokenDisplay}
${subtext}`;
}

module.exports = {
  WALLET_CLASSES,
  HEALTH_SCORE_BANDS,
  CLASS_ORDER,
  formatWalletClass,
  formatHealthScore,
  getHealthScoreBand,
  formatTokenDisplay,
  formatMintForCopy,
  formatTokenDisplayWithCopy,
  generateExplorerLinks,
  formatWalletBreakdown,
  formatDiscordAlert,
  formatCLITableRow,
  formatCLITableHeader,
  formatHealthScoreCard
};
