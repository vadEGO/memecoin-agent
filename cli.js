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
}

function showHelp() {
    console.log(`
🚀 Memecoin Agent CLI

Commands:
  recent [N]           Show recent tokens (default: 20)
  recent-pump [N]      Show recent Pump.fun tokens (default: 20)
  candidates [N]       Show candidate tokens (default: 20)
  events <MINT>        Show events for specific token
  stats                Show comprehensive statistics
  help                 Show this help message

Examples:
  npm run cli -- recent 50
  npm run cli -- recent-pump 10
  npm run cli -- events So11111111111111111111111111111111111111112
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
} else if (cmd === 'stats') {
    showStats();
} else if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    showHelp();
} else {
    console.log(`❌ Unknown command: ${cmd}`);
    showHelp();
}
