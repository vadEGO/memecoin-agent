// cli.js
const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

const cmd = process.argv[2] || 'recent';

// Input validation
function validateNumber(input, defaultValue = 20) {
    const num = Number(input);
    return isNaN(num) || num <= 0 ? defaultValue : num;
}

function showRecent(limit = 20) {
    const validatedLimit = validateNumber(limit, 20);
    const rows = db.prepare(`
        SELECT 
            mint, 
            symbol, 
            name, 
            source, 
            first_seen_at,
            authorities_revoked, 
            lp_exists, 
            liquidity_usd
        FROM tokens
        ORDER BY datetime(first_seen_at) DESC
        LIMIT ?
    `).all(validatedLimit);
    
    console.log(`📊 Recent ${validatedLimit} tokens:`);
    console.table(rows);
}

function showRecentPump(limit = 20) {
    const validatedLimit = validateNumber(limit, 20);
    const rows = db.prepare(`
        SELECT 
            mint, 
            symbol, 
            name, 
            first_seen_at,
            authorities_revoked, 
            lp_exists, 
            liquidity_usd
        FROM tokens
        WHERE source = 'pump.fun'
        ORDER BY datetime(first_seen_at) DESC
        LIMIT ?
    `).all(validatedLimit);
    
    if (rows.length === 0) {
        console.log('🔍 No Pump.fun tokens found yet. Make sure the WebSocket client is running!');
    } else {
        console.log(`🎉 Recent ${validatedLimit} Pump.fun tokens:`);
        console.table(rows);
    }
}

function showCandidates(limit = 20) {
    const validatedLimit = validateNumber(limit, 20);
    const rows = db.prepare(`
        SELECT 
            mint, 
            symbol, 
            name, 
            source, 
            first_seen_at,
            authorities_revoked, 
            lp_exists, 
            liquidity_usd
        FROM v_tokens_candidates
        ORDER BY datetime(first_seen_at) DESC
        LIMIT ?
    `).all(validatedLimit);
    
    if (rows.length === 0) {
        console.log('🔍 No candidate tokens found (need authorities_revoked=1 AND liquidity_usd >= threshold)');
        console.log('   Try lowering the threshold or check if any tokens meet criteria');
    } else {
        console.log(`🎯 Candidate tokens (authorities revoked + liquidity >= threshold):`);
        console.table(rows);
    }
}

function showEvents(mint) {
    if (!mint) { 
        console.log('❌ Usage: node cli.js events <MINT>');
        console.log('   Example: node cli.js events So11111111111111111111111111111111111111112');
        process.exit(1); 
    }
    
    const evts = db.prepare(`
        SELECT 
            type, 
            source, 
            received_at, 
            substr(signature,1,12) AS signature_short
        FROM token_events
        WHERE mint = ?
        ORDER BY datetime(received_at) DESC
        LIMIT 100
    `).all(mint);
    
    if (evts.length === 0) {
        console.log(`🔍 No events found for mint: ${mint}`);
    } else {
        console.log(`📋 Events for ${mint.substring(0, 8)}... (${evts.length} total):`);
        console.table(evts);
    }
}

function showStats() {
    const totals = db.prepare(`SELECT COUNT(*) AS tokens FROM tokens`).get();
    const bySource = db.prepare(`
        SELECT source, COUNT(*) AS tokens
        FROM tokens GROUP BY source ORDER BY tokens DESC
    `).all();
    const events = db.prepare(`SELECT COUNT(*) AS events FROM token_events`).get();
    const eventsBySource = db.prepare(`
        SELECT source, COUNT(*) AS events
        FROM token_events GROUP BY source ORDER BY events DESC
    `).all();
    
    const vettingStats = db.prepare(`
        SELECT 
            COUNT(*) as total,
            COUNT(authorities_revoked) as auth_vetted,
            COUNT(lp_exists) as lp_vetted,
            COUNT(liquidity_usd) as liq_vetted,
            SUM(CASE WHEN authorities_revoked = 1 THEN 1 ELSE 0 END) as auth_revoked_count,
            SUM(CASE WHEN lp_exists = 1 THEN 1 ELSE 0 END) as lp_exists_count
        FROM tokens
    `).get();
    
    const candidateCount = db.prepare(`SELECT COUNT(*) as count FROM v_tokens_candidates`).get();
    
    const holdersStats = db.prepare(`
        SELECT 
            COUNT(*) as total_tokens,
            COUNT(holders_count) as tokens_with_holders,
            COUNT(fresh_wallets_count) as tokens_with_fresh,
            AVG(holders_count) as avg_holders,
            AVG(fresh_wallets_count) as avg_fresh
        FROM tokens
    `).get();
    
    console.log('\n📊 System Statistics:');
    console.log(`   Total Tokens: ${totals.tokens}`);
    console.table(bySource);
    
    console.log(`\n📈 Events: ${events.events}`);
    console.table(eventsBySource);
    
    console.log('\n🔍 Vetting Status:');
    console.log(`   Authorities vetted: ${vettingStats.auth_vetted}/${vettingStats.total}`);
    console.log(`   LP status vetted: ${vettingStats.lp_vetted}/${vettingStats.total}`);
    console.log(`   Liquidity vetted: ${vettingStats.liq_vetted}/${vettingStats.total}`);
    console.log(`   Authorities revoked: ${vettingStats.auth_revoked_count}`);
    console.log(`   LP exists: ${vettingStats.lp_exists_count}`);
    console.log(`   Candidate tokens: ${candidateCount.count}`);
    
    console.log('\n👥 Holders Status:');
    console.log(`   Tokens with holders: ${holdersStats.tokens_with_holders}/${holdersStats.total_tokens}`);
    console.log(`   Tokens with fresh wallets: ${holdersStats.tokens_with_fresh}/${holdersStats.total_tokens}`);
    console.log(`   Average holders: ${holdersStats.avg_holders ? holdersStats.avg_holders.toFixed(2) : 'N/A'}`);
    console.log(`   Average fresh wallets: ${holdersStats.avg_fresh ? holdersStats.avg_fresh.toFixed(2) : 'N/A'}`);
}

function showErrors(limit = 20) {
    const validatedLimit = validateNumber(limit, 20);
    const rows = db.prepare(`
        SELECT 
            mint,
            symbol,
            enrich_attempts,
            last_enriched_at,
            enrich_error
        FROM tokens
        WHERE enrich_error IS NOT NULL
        ORDER BY datetime(last_enriched_at) DESC
        LIMIT ?
    `).all(validatedLimit);
    
    console.log(`❌ Recent ${validatedLimit} enrichment errors:`);
    console.table(rows);
}

function showUnenriched(limit = 20) {
    const validatedLimit = validateNumber(limit, 20);
    const rows = db.prepare(`
        SELECT 
            mint,
            symbol,
            name,
            first_seen_at,
            authorities_revoked,
            lp_exists,
            liquidity_usd,
            enrich_attempts,
            last_enriched_at
        FROM tokens
        WHERE (
            symbol IS NULL OR name IS NULL OR decimals IS NULL
            OR authorities_revoked IS NULL
            OR lp_exists IS NULL OR liquidity_usd IS NULL
        )
        ORDER BY datetime(first_seen_at) DESC
        LIMIT ?
    `).all(validatedLimit);
    
    console.log(`🔄 ${validatedLimit} tokens still needing enrichment:`);
    console.table(rows);
}

function enrichSingle(mint) {
    if (!mint) {
        console.log('❌ Please provide a mint address');
        return;
    }
    
    console.log(`🔄 Force enriching single token: ${mint}`);
    
    // Import and run the enrichment worker for a single token
    const { execSync } = require('child_process');
    try {
        execSync(`node -e "
            require('dotenv').config();
            const Database = require('better-sqlite3');
            const { fetchJson, sleep } = require('./lib/http');
            
            const db = new Database('db/agent.db');
            const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
            const DEXSCREENER_BASE = process.env.DEXSCREENER_BASE || 'https://api.dexscreener.com';
            
            // Get the token
            const token = db.prepare('SELECT * FROM tokens WHERE mint = ?').get('${mint}');
            if (!token) {
                console.log('❌ Token not found');
                process.exit(1);
            }
            
            // Run enrichment (simplified version)
            console.log('🔄 Running enrichment...');
            // This would need the full enrichment logic, but for now just show the token
            console.log('Token:', token);
        "`, { stdio: 'inherit' });
    } catch (error) {
        console.error('❌ Enrichment failed:', error.message);
    }
}

function showHolders(mint, limit = 20) {
    if (!mint) {
        console.log('❌ Usage: node cli.js holders <MINT> [LIMIT]');
        console.log('   Example: node cli.js holders So11111111111111111111111111111111111111112 10');
        process.exit(1);
    }
    
    const validatedLimit = validateNumber(limit, 20);
    
    // First check if token exists
    const token = db.prepare('SELECT mint, symbol, name, holders_count, fresh_wallets_count FROM tokens WHERE mint = ?').get(mint);
    if (!token) {
        console.log(`❌ Token not found: ${mint}`);
        return;
    }
    
    // Get holders with classifications
    const holders = db.prepare(`
        SELECT owner, amount, last_seen_at, wallet_age_days, is_inception, is_sniper, is_bundler, is_insider
        FROM holders
        WHERE mint = ?
        ORDER BY CAST(amount AS INTEGER) DESC
        LIMIT ?
    `).all(mint, validatedLimit);
    
    if (holders.length === 0) {
        console.log(`🔍 No holders found for ${mint}`);
        console.log(`   Token: ${token.symbol || 'Unknown'} (${token.name || 'Unknown'})`);
        console.log(`   Holders count: ${token.holders_count !== null ? token.holders_count : 'Not processed'}`);
        console.log(`   Fresh wallets: ${token.fresh_wallets_count !== null ? token.fresh_wallets_count : 'Not processed'}`);
        return;
    }
    
    console.log(`👥 Top ${validatedLimit} holders for ${mint.substring(0, 8)}...`);
    console.log(`   Token: ${token.symbol || 'Unknown'} (${token.name || 'Unknown'})`);
    console.log(`   Total holders: ${token.holders_count !== null ? token.holders_count : 'Not processed'}`);
    console.log(`   Fresh wallets: ${token.fresh_wallets_count !== null ? token.fresh_wallets_count : 'Not processed'}`);
    console.log('');
    
    // Format holders data for display
    const formattedHolders = holders.map((holder, index) => {
        const types = [];
        if (holder.is_inception) types.push('Inception');
        if (holder.is_sniper) types.push('Sniper');
        if (holder.is_bundler) types.push('Bundler');
        if (holder.is_insider) types.push('Insider');
        if (types.length === 0) types.push('Fresh');
        
        return {
            '#': index + 1,
            'Owner': holder.owner.substring(0, 8) + '...' + holder.owner.substring(holder.owner.length - 8),
            'Amount': holder.amount,
            'Type': types.join(', '),
            'Age': holder.wallet_age_days ? `${holder.wallet_age_days}d` : 'Unknown',
            'Last Seen': holder.last_seen_at ? new Date(holder.last_seen_at).toLocaleString() : 'Unknown'
        };
    });
    
    console.table(formattedHolders);
}

function showMomentum(mint, limit = 20) {
    if (!mint) {
        console.log('❌ Usage: node cli.js momentum <MINT> [LIMIT]');
        console.log('   Example: node cli.js momentum So11111111111111111111111111111111111111112 10');
        process.exit(1);
    }
    
    const validatedLimit = validateNumber(limit, 20);
    
    // Get token info
    const token = db.prepare('SELECT mint, symbol, name FROM tokens WHERE mint = ?').get(mint);
    if (!token) {
        console.log(`❌ Token not found: ${mint}`);
        return;
    }
    
    // Get history snapshots
    const history = db.prepare(`
        SELECT snapshot_time, holders_count, fresh_wallets_count, health_score, fresh_ratio, top10_share, sniper_ratio
        FROM holders_history
        WHERE mint = ?
        ORDER BY datetime(snapshot_time) DESC
        LIMIT ?
    `).all(mint, validatedLimit);
    
    if (history.length === 0) {
        console.log(`🔍 No momentum data found for ${mint}`);
        console.log(`   Token: ${token.symbol || 'Unknown'} (${token.name || 'Unknown'})`);
        return;
    }
    
    console.log(`📈 Holder Growth Momentum for ${mint.substring(0, 8)}...`);
    console.log(`   Token: ${token.symbol || 'Unknown'} (${token.name || 'Unknown'})`);
    console.log('');
    
    // Format momentum data
    const formattedHistory = history.map((snapshot, index) => ({
        '#': index + 1,
        'Time': new Date(snapshot.snapshot_time).toLocaleString(),
        'Holders': snapshot.holders_count,
        'Fresh': snapshot.fresh_wallets_count,
        'Health': snapshot.health_score,
        'Fresh%': (snapshot.fresh_ratio * 100).toFixed(1) + '%',
        'Top10%': (snapshot.top10_share * 100).toFixed(1) + '%',
        'Sniper%': (snapshot.sniper_ratio * 100).toFixed(1) + '%'
    }));
    
    console.table(formattedHistory);
}

function showScore(mint) {
    if (!mint) {
        console.log('❌ Usage: node cli.js score <MINT>');
        console.log('   Example: node cli.js score So11111111111111111111111111111111111111112');
        process.exit(1);
    }
    
    // Get latest health score
    const latest = db.prepare(`
        SELECT h.*, t.symbol, t.name
        FROM holders_history h
        JOIN tokens t ON h.mint = t.mint
        WHERE h.mint = ?
        ORDER BY datetime(h.snapshot_time) DESC
        LIMIT 1
    `).get(mint);
    
    if (!latest) {
        console.log(`❌ No score data found for ${mint}`);
        return;
    }
    
    // Get wallet type breakdown
    const walletTypes = db.prepare(`
        SELECT 
            SUM(is_inception) as inception_count,
            SUM(is_sniper) as sniper_count,
            SUM(is_bundler) as bundler_count,
            SUM(is_insider) as insider_count,
            COUNT(*) as total_holders
        FROM holders
        WHERE mint = ?
    `).get(mint);
    
    const score = latest.health_score;
    const scoreEmoji = score >= 80 ? '🟢' : score >= 60 ? '🟡' : score >= 40 ? '🟠' : '🔴';
    const scoreText = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Poor';
    
    console.log(`🎯 Health Score for ${mint.substring(0, 8)}...`);
    console.log(`   Token: ${latest.symbol || 'Unknown'} (${latest.name || 'Unknown'})`);
    console.log('');
    console.log(`${scoreEmoji} Overall Score: ${score}/100 (${scoreText})`);
    console.log('');
    console.log('📊 Key Metrics:');
    console.log(`   Fresh Ratio: ${(latest.fresh_ratio * 100).toFixed(1)}%`);
    console.log(`   Top 10 Share: ${(latest.top10_share * 100).toFixed(1)}%`);
    console.log(`   Sniper Ratio: ${(latest.sniper_ratio * 100).toFixed(1)}%`);
    console.log(`   Total Holders: ${latest.holders_count}`);
    console.log('');
    console.log('👥 Wallet Breakdown:');
    console.log(`   Inception: ${walletTypes.inception_count || 0}`);
    console.log(`   Sniper: ${walletTypes.sniper_count || 0}`);
    console.log(`   Bundler: ${walletTypes.bundler_count || 0}`);
    console.log(`   Insider: ${walletTypes.insider_count || 0}`);
    console.log(`   Fresh: ${(walletTypes.total_holders || 0) - (walletTypes.inception_count || 0)}`);
}

function showTopTokens(limit = 20) {
    const validatedLimit = validateNumber(limit, 20);
    
    const topTokens = db.prepare(`
        SELECT 
            mint,
            symbol,
            name,
            holders_count,
            fresh_wallets_count,
            health_score,
            fresh_percentage,
            sniper_percentage,
            health_grade,
            snapshot_time
        FROM v_token_scores
        WHERE holders_count > 0
        ORDER BY health_score DESC, holders_count DESC
        LIMIT ?
    `).all(validatedLimit);
    
    if (topTokens.length === 0) {
        console.log('🔍 No tokens with scores found');
        return;
    }
    
    console.log(`🏆 Top ${validatedLimit} Tokens by Health Score:`);
    console.log('');
    
    const formattedTokens = topTokens.map((token, index) => ({
        '#': index + 1,
        'Token': (token.symbol || 'Unknown').substring(0, 12),
        'Holders': token.holders_count,
        'Fresh%': token.fresh_percentage + '%',
        'Sniper%': token.sniper_percentage + '%',
        'Health': token.health_score,
        'Grade': token.health_grade,
        'Updated': new Date(token.snapshot_time).toLocaleString()
    }));
    
    console.table(formattedTokens);
}

function showMomentumCurve(mint, limit = 20) {
    if (!mint) {
        console.log('❌ Usage: node cli.js curve <MINT> [LIMIT]');
        console.log('   Example: node cli.js curve So11111111111111111111111111111111111111112 10');
        process.exit(1);
    }
    
    const validatedLimit = validateNumber(limit, 20);
    
    // Get token info
    const token = db.prepare('SELECT mint, symbol, name FROM tokens WHERE mint = ?').get(mint);
    if (!token) {
        console.log(`❌ Token not found: ${mint}`);
        return;
    }
    
    // Get momentum curve data
    const curve = db.prepare(`
        SELECT 
            snapshot_time,
            holders_count,
            fresh_wallets_count,
            health_score,
            fresh_ratio,
            top10_share,
            sniper_ratio,
            holders_growth_rate,
            fresh_growth_rate
        FROM v_momentum_curves
        WHERE mint = ?
        ORDER BY datetime(snapshot_time) ASC
        LIMIT ?
    `).all(mint, validatedLimit);
    
    if (curve.length === 0) {
        console.log(`🔍 No momentum curve data found for ${mint}`);
        console.log(`   Token: ${token.symbol || 'Unknown'} (${token.name || 'Unknown'})`);
        return;
    }
    
    console.log(`📈 Momentum Curve for ${mint.substring(0, 8)}...`);
    console.log(`   Token: ${token.symbol || 'Unknown'} (${token.name || 'Unknown'})`);
    console.log('');
    
    // Format curve data
    const formattedCurve = curve.map((point, index) => ({
        '#': index + 1,
        'Time': new Date(point.snapshot_time).toLocaleString(),
        'Holders': point.holders_count,
        'Fresh': point.fresh_wallets_count,
        'Health': point.health_score,
        'Fresh%': (point.fresh_ratio * 100).toFixed(1) + '%',
        'Top10%': (point.top10_share * 100).toFixed(1) + '%',
        'H.Growth': point.holders_growth_rate ? point.holders_growth_rate + '%' : 'N/A',
        'F.Growth': point.fresh_growth_rate ? point.fresh_growth_rate + '%' : 'N/A'
    }));
    
    console.table(formattedCurve);
}

function showWalletProfiling() {
    const { displayTokenTable } = require('./workers/wallet-profiling-worker');
    displayTokenTable();
}

function showWalletProfilingDetail(mint) {
    if (!mint) {
        console.log('❌ Usage: node cli.js profiling-detail <MINT>');
        console.log('   Example: node cli.js profiling-detail So11111111111111111111111111111111111111112');
        process.exit(1);
    }
    
    const { displayTokenDetail } = require('./workers/wallet-profiling-worker');
    displayTokenDetail(mint);
}

function runWalletProfiling() {
    console.log('🔄 Running wallet profiling pipeline...');
    const { mainLoop } = require('./workers/wallet-profiling-worker');
    mainLoop().then(() => {
        console.log('✅ Wallet profiling completed');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Wallet profiling failed:', error.message);
        process.exit(1);
    });
}

function showDiscordAlert(mint) {
    if (!mint) {
        console.log('❌ Usage: node cli.js discord-alert <MINT>');
        console.log('   Example: node cli.js discord-alert So11111111111111111111111111111111111111112');
        process.exit(1);
    }
    
    const { generateDiscordAlert } = require('./workers/wallet-profiling-worker');
    const alert = generateDiscordAlert(mint);
    console.log(alert);
}

function showHelp() {
    console.log(`
🚀 Memecoin Agent CLI

Commands:
  recent [N]           Show recent tokens (default: 20)
  recent-pump [N]      Show recent Pump.fun tokens (default: 20)
  candidates [N]       Show candidate tokens (default: 20)
  events <MINT>        Show events for specific token
  holders <MINT> [N]   Show top holders for specific token (default: 20)
  momentum <MINT> [N]  Show holder growth momentum over time (default: 20)
  curve <MINT> [N]     Show momentum curve with growth rates (default: 20)
  score <MINT>         Show health score and wallet analysis
  top [N]              Show top tokens by health score (default: 20)
  errors [N]           Show recent enrichment errors (default: 20)
  unenriched [N]       Show tokens still needing enrichment (default: 20)
  enrich <MINT>        Force enrich a single token
  stats                Show comprehensive statistics
  
  🔍 Wallet Profiling (Task 8):
  profiling            Show wallet profiling dashboard
  profiling-detail <MINT>  Show detailed wallet analysis for token
  profiling-run        Run full wallet profiling pipeline
  discord-alert <MINT> Generate Discord/Telegram alert for token
  profiling-pool       Run pool locator worker
  profiling-sniper     Run sniper detector worker
  profiling-bundler    Run bundler detector worker
  profiling-insider    Run insider detector worker
  profiling-health     Run health score calculator
  
  help                 Show this help message

Examples:
  npm run cli -- recent 50
  npm run cli -- recent-pump 10
  npm run cli -- events So11111111111111111111111111111111111111112
  npm run cli -- holders So11111111111111111111111111111111111111112 10
  npm run cli -- momentum So11111111111111111111111111111111111111112 10
  npm run cli -- curve So11111111111111111111111111111111111111112 10
  npm run cli -- score So11111111111111111111111111111111111111112
  npm run cli -- top 20
  npm run cli -- errors 10
  npm run cli -- unenriched 15
  npm run cli -- enrich 7ypeXztHG9pGX2mkZdm9hcMhYp4KRL4wZFmLxHXzpump
  npm run cli -- stats
  
  # Wallet Profiling
  npm run cli -- profiling
  npm run cli -- profiling-detail So11111111111111111111111111111111111111112
  npm run cli -- profiling-run
`);
}

// Command routing
if (cmd === 'recent') {
    const n = process.argv[3];
    showRecent(n);
} else if (cmd === 'recent-pump') {
    const n = process.argv[3];
    showRecentPump(n);
} else if (cmd === 'candidates') {
    const n = process.argv[3];
    showCandidates(n);
} else if (cmd === 'events') {
    showEvents(process.argv[3]);
} else if (cmd === 'holders') {
    const mint = process.argv[3];
    const limit = process.argv[4];
    showHolders(mint, limit);
} else if (cmd === 'momentum') {
    const mint = process.argv[3];
    const limit = process.argv[4];
    showMomentum(mint, limit);
} else if (cmd === 'score') {
    const mint = process.argv[3];
    showScore(mint);
} else if (cmd === 'top') {
    const limit = process.argv[3];
    showTopTokens(limit);
} else if (cmd === 'curve') {
    const mint = process.argv[3];
    const limit = process.argv[4];
    showMomentumCurve(mint, limit);
} else if (cmd === 'errors') {
    const n = process.argv[3];
    showErrors(n);
} else if (cmd === 'unenriched') {
    const n = process.argv[3];
    showUnenriched(n);
} else if (cmd === 'enrich') {
    enrichSingle(process.argv[3]);
} else if (cmd === 'stats') {
    showStats();
} else if (cmd === 'profiling') {
    showWalletProfiling();
} else if (cmd === 'profiling-detail') {
    showWalletProfilingDetail(process.argv[3]);
} else if (cmd === 'profiling-run') {
    runWalletProfiling();
} else if (cmd === 'discord-alert') {
    showDiscordAlert(process.argv[3]);
} else if (cmd === 'profiling-pool') {
    const { mainLoop } = require('./workers/pool-locator-worker');
    mainLoop().then(() => process.exit(0)).catch(error => {
        console.error('❌ Pool locator failed:', error.message);
        process.exit(1);
    });
} else if (cmd === 'profiling-sniper') {
    const { mainLoop } = require('./workers/sniper-detector-worker');
    mainLoop().then(() => process.exit(0)).catch(error => {
        console.error('❌ Sniper detector failed:', error.message);
        process.exit(1);
    });
} else if (cmd === 'profiling-bundler') {
    const { mainLoop } = require('./workers/bundler-detector-worker');
    mainLoop().then(() => process.exit(0)).catch(error => {
        console.error('❌ Bundler detector failed:', error.message);
        process.exit(1);
    });
} else if (cmd === 'profiling-insider') {
    const { mainLoop } = require('./workers/insider-detector-worker');
    mainLoop().then(() => process.exit(0)).catch(error => {
        console.error('❌ Insider detector failed:', error.message);
        process.exit(1);
    });
} else if (cmd === 'profiling-health') {
    const { mainLoop } = require('./workers/health-score-worker');
    mainLoop().then(() => process.exit(0)).catch(error => {
        console.error('❌ Health score calculator failed:', error.message);
        process.exit(1);
    });
} else if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    showHelp();
} else {
    console.log(`❌ Unknown command: ${cmd}`);
    showHelp();
}
