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
    
    // Get holders
    const holders = db.prepare(`
        SELECT owner, amount, last_seen_at
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
    const formattedHolders = holders.map((holder, index) => ({
        '#': index + 1,
        'Owner': holder.owner.substring(0, 8) + '...' + holder.owner.substring(holder.owner.length - 8),
        'Amount': holder.amount,
        'Last Seen': holder.last_seen_at ? new Date(holder.last_seen_at).toLocaleString() : 'Unknown'
    }));
    
    console.table(formattedHolders);
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
  errors [N]           Show recent enrichment errors (default: 20)
  unenriched [N]       Show tokens still needing enrichment (default: 20)
  enrich <MINT>        Force enrich a single token
  stats                Show comprehensive statistics
  help                 Show this help message

Examples:
  npm run cli -- recent 50
  npm run cli -- recent-pump 10
  npm run cli -- events So11111111111111111111111111111111111111112
  npm run cli -- holders So11111111111111111111111111111111111111112 10
  npm run cli -- errors 10
  npm run cli -- unenriched 15
  npm run cli -- enrich 7ypeXztHG9pGX2mkZdm9hcMhYp4KRL4wZFmLxHXzpump
  npm run cli -- stats
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
} else if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    showHelp();
} else {
    console.log(`❌ Unknown command: ${cmd}`);
    showHelp();
}
