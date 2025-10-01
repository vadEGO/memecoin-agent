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
            liquidity_usd,
            health_score,
            fresh_pct,
            snipers_pct,
            insiders_pct
        FROM tokens
        ORDER BY datetime(first_seen_at) DESC
        LIMIT ?
    `).all(validatedLimit);
    
    console.log(`📊 Recent ${validatedLimit} tokens:`);
    
    // Format each row with mint-first display and health score
    const { formatTokenDisplayWithHealth, formatHealthScore } = require('./lib/visual-encoding');
    
    rows.forEach((row, index) => {
        const display = formatTokenDisplayWithHealth(row.symbol, row.mint, row.health_score);
        const healthDisplay = row.health_score !== null ? formatHealthScore(row.health_score) : 'N/A';
        const healthNum = row.health_score !== null ? row.health_score.toFixed(1) : 'N/A';
        
        console.log(`${index + 1}. ${display} • Health ${healthNum}`);
        console.log(`   Source: ${row.source} • Seen: ${row.first_seen_at}`);
        if (row.liquidity_usd) {
            console.log(`   💰 Liquidity: $${row.liquidity_usd.toFixed(0)}`);
        }
        if (row.fresh_pct !== null || row.snipers_pct !== null || row.insiders_pct !== null) {
            const metrics = [];
            if (row.fresh_pct !== null) metrics.push(`Fresh: ${row.fresh_pct.toFixed(1)}%`);
            if (row.snipers_pct !== null) metrics.push(`Snipers: ${row.snipers_pct.toFixed(1)}%`);
            if (row.insiders_pct !== null) metrics.push(`Insiders: ${row.insiders_pct.toFixed(1)}%`);
            console.log(`   📊 ${metrics.join(' • ')}`);
        }
        console.log(`   Copy: \`${row.mint}\``);
        console.log('');
    });
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
    
    // Use enhanced candidates for better trader-focused results
    const EnhancedCandidates = require('./lib/enhanced-candidates');
    const candidates = new EnhancedCandidates();
    
    const enhancedCandidates = candidates.getEnhancedCandidates(validatedLimit);
    
    if (enhancedCandidates.length === 0) {
        console.log('🔍 No enhanced candidates found (need liq ≥ $3k, holders ≥ 50, sniper% ≤ 15%, insider% ≤ 15%)');
        console.log('   Try lowering the threshold or check if any tokens meet criteria');
    } else {
        candidates.formatCandidatesDisplay(enhancedCandidates);
        
        // Show statistics
        const stats = candidates.getCandidatesStats();
        if (stats) {
            console.log(`\n📊 Enhanced Candidates Statistics:`);
            console.log(`   Total: ${stats.totalCandidates} | Avg Health: ${stats.averageHealth} | Avg Fresh: ${stats.averageFresh}%`);
            console.log(`   Avg Snipers: ${stats.averageSnipers}% | Avg Insiders: ${stats.averageInsiders}% | Avg Liq: $${(stats.averageLiquidity / 1000).toFixed(1)}k`);
        }
    }
}

function showDataGaps() {
    const Diagnostics = require('./lib/diagnostics');
    const diagnostics = new Diagnostics();
    
    const gaps = diagnostics.getDataGaps();
    if (!gaps) {
        console.log('❌ Failed to get data gaps');
        return;
    }
    
    console.log('📊 Data Coverage Analysis:');
    console.log(`   Total tokens: ${gaps.totalTokens}`);
    console.log(`   Recent tokens (24h): ${gaps.recentTokens24h}`);
    console.log(`   Recent tokens (48h): ${gaps.recentTokens48h}`);
    console.log(`   Eligible cohort (24h): ${gaps.eligibleRecent24h}`);
    console.log(`   Has liquidity data: ${gaps.hasLiquidityData}`);
    console.log('');
    console.log('🔍 Missing Features:');
    console.log(`   Liquidity: ${gaps.missingLiquidity} (${((gaps.missingLiquidity/gaps.totalTokens)*100).toFixed(1)}%)`);
    console.log(`   Holders: ${gaps.missingHolders} (${((gaps.missingHolders/gaps.totalTokens)*100).toFixed(1)}%)`);
    console.log(`   Fresh%: ${gaps.missingFreshPct} (${((gaps.missingFreshPct/gaps.totalTokens)*100).toFixed(1)}%)`);
    console.log(`   Sniper%: ${gaps.missingSniperPct} (${((gaps.missingSniperPct/gaps.totalTokens)*100).toFixed(1)}%)`);
    console.log(`   Insider%: ${gaps.missingInsiderPct} (${((gaps.missingInsiderPct/gaps.totalTokens)*100).toFixed(1)}%)`);
    console.log(`   Top10%: ${gaps.missingTop10Share} (${((gaps.missingTop10Share/gaps.totalTokens)*100).toFixed(1)}%)`);
    console.log(`   Health Score: ${gaps.missingHealthScore} (${((gaps.missingHealthScore/gaps.totalTokens)*100).toFixed(1)}%)`);
    console.log('');
    console.log('⚙️ Enrichment Success Rates:');
    console.log(`   Overall: ${gaps.enrichmentSuccessRate}%`);
    console.log(`   Liquidity: ${gaps.liquiditySuccessRate}%`);
    console.log(`   Holders: ${gaps.holdersSuccessRate}%`);
    console.log(`   Fresh%: ${gaps.freshSuccessRate}%`);
    
    // Alarm if eligible cohort is too low
    if (gaps.eligibleRecent24h === 0) {
      console.log('');
      console.log('🚨 ALARM: No eligible tokens in last 24h! Check enrichment pipeline.');
    } else if (gaps.eligibleRecent24h < 5) {
      console.log('');
      console.log('⚠️  WARNING: Very low eligible cohort. Consider running backfill sweeper.');
    }
}

function showHealthAnalysis() {
    const Diagnostics = require('./lib/diagnostics');
    const diagnostics = new Diagnostics();
    
    const analysis = diagnostics.getHealthAnalysisEligible();
    if (!analysis) {
        console.log('❌ Failed to get health analysis');
        return;
    }
    
    const { eligible, buckets } = analysis;
    
    console.log('🏥 Health Analysis (Eligible Cohort Only):');
    console.log(`   Eligible tokens: ${eligible.eligible_count}`);
    console.log(`   Average health: ${eligible.avg_health?.toFixed(2) || 'N/A'}`);
    console.log(`   Range: ${eligible.min_health?.toFixed(2) || 'N/A'} - ${eligible.max_health?.toFixed(2) || 'N/A'}`);
    console.log('');
    console.log('📊 Health Bands:');
    console.log(`   🟢 Excellent (80+): ${eligible.excellent_count}`);
    console.log(`   🔵 Good (60-79): ${eligible.good_count}`);
    console.log(`   🟡 Fair (40-59): ${eligible.fair_count}`);
    console.log(`   🔴 Poor (<40): ${eligible.poor_count}`);
    console.log('');
    console.log('📈 Score Distribution:');
    buckets.forEach(bucket => {
        const bar = '█'.repeat(Math.ceil(bucket.count / 2));
        console.log(`   ${bucket.bucket.toString().padStart(3)}: ${bar} (${bucket.count})`);
    });
}

function showWhyNotCandidate(mint) {
    if (!mint) {
        console.log('❌ Please provide a mint address');
        return;
    }
    
    const Diagnostics = require('./lib/diagnostics');
    const diagnostics = new Diagnostics();
    
    const analysis = diagnostics.whyNotCandidate(mint);
    if (analysis.error) {
        console.log(`❌ ${analysis.error}`);
        return;
    }
    
    const { token, reasons, isCandidate } = analysis;
    
    console.log(`🔍 Candidate Analysis for ${token.symbol || 'Unknown'} (${mint}):`);
    console.log(`   Health Score: ${token.health_score || 'NULL'}`);
    console.log(`   Liquidity: $${token.liquidity_usd?.toFixed(0) || 'NULL'}`);
    console.log(`   Holders: ${token.holders_count || 'NULL'}`);
    console.log(`   Fresh%: ${token.fresh_pct ? (token.fresh_pct * 100).toFixed(1) + '%' : 'NULL'}`);
    console.log(`   Sniper%: ${token.sniper_pct ? (token.sniper_pct * 100).toFixed(1) + '%' : 'NULL'}`);
    console.log(`   Insider%: ${token.insider_pct ? (token.insider_pct * 100).toFixed(1) + '%' : 'NULL'}`);
    console.log(`   LP Exists: ${token.lp_exists}`);
    console.log('');
    
    if (isCandidate) {
        console.log('✅ This token IS a candidate!');
    } else {
        console.log('❌ This token is NOT a candidate. Reasons:');
        reasons.forEach(reason => console.log(`   • ${reason}`));
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
    
    const healthStats = db.prepare(`
        SELECT 
            COUNT(health_score) as tokens_with_health,
            AVG(health_score) as avg_health,
            MIN(health_score) as min_health,
            MAX(health_score) as max_health,
            SUM(CASE WHEN health_score >= 80 THEN 1 ELSE 0 END) as excellent_count,
            SUM(CASE WHEN health_score >= 60 AND health_score < 80 THEN 1 ELSE 0 END) as good_count,
            SUM(CASE WHEN health_score >= 40 AND health_score < 60 THEN 1 ELSE 0 END) as fair_count,
            SUM(CASE WHEN health_score < 40 THEN 1 ELSE 0 END) as poor_count
        FROM tokens
        WHERE health_score IS NOT NULL
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
    
    console.log('\n🎯 Health Score Status:');
    console.log(`   Tokens with health scores: ${healthStats.tokens_with_health}/${totals.tokens}`);
    console.log(`   Average health score: ${healthStats.avg_health ? healthStats.avg_health.toFixed(1) : 'N/A'}`);
    console.log(`   Health range: ${healthStats.min_health ? healthStats.min_health.toFixed(1) : 'N/A'} - ${healthStats.max_health ? healthStats.max_health.toFixed(1) : 'N/A'}`);
    console.log(`   🟢 Excellent (80+): ${healthStats.excellent_count || 0}`);
    console.log(`   🟡 Good (60-79): ${healthStats.good_count || 0}`);
    console.log(`   🟠 Fair (40-59): ${healthStats.fair_count || 0}`);
    console.log(`   🔴 Poor (<40): ${healthStats.poor_count || 0}`);
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
    console.log('');
    console.log('🔗 Links:');
    console.log(`   Dexscreener: https://dexscreener.com/solana/${mint}`);
    console.log(`   Birdeye: https://birdeye.so/token/${mint}`);
    console.log(`   Solscan: https://solscan.io/token/${mint}`);
    console.log(`   GMGN: https://gmgn.ai/solana/token/${mint}`);
    console.log(`   Copy: \`${mint}\``);
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
    
    const { formatTokenDisplayWithHealth } = require('./lib/visual-encoding');
    const formattedTokens = topTokens.map((token, index) => ({
        '#': index + 1,
        'Token': formatTokenDisplayWithHealth(token.symbol, token.mint, token.health_score, true, 30),
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

function showWalletClasses(mint) {
    if (!mint) {
        console.log('❌ Usage: node cli.js classes <MINT>');
        console.log('   Example: node cli.js classes So11111111111111111111111111111111111111112');
        process.exit(1);
    }
    
    // Get token info
    const token = db.prepare('SELECT mint, symbol, fresh_count, fresh_pct, inception_count, inception_pct, snipers_count, snipers_pct, bundled_count, bundled_pct, insiders_count, insiders_pct, others_count, others_pct FROM tokens WHERE mint = ?').get(mint);
    
    if (!token) {
        console.log(`❌ Token not found: ${mint}`);
        return;
    }
    
    const { formatWalletClass } = require('./lib/visual-encoding');
    
    console.log(`📊 Wallet Classes for ${token.symbol || 'Unknown'} (${mint.slice(0, 4)}…${mint.slice(-4)})`);
    console.log('─'.repeat(60));
    
    // Format each class with count and percentage
    const classes = [
        { name: 'fresh', count: token.fresh_count || 0, pct: token.fresh_pct || 0 },
        { name: 'inception', count: token.inception_count || 0, pct: token.inception_pct || 0 },
        { name: 'snipers', count: token.snipers_count || 0, pct: token.snipers_pct || 0 },
        { name: 'bundled', count: token.bundled_count || 0, pct: token.bundled_pct || 0 },
        { name: 'insiders', count: token.insiders_count || 0, pct: token.insiders_pct || 0 },
        { name: 'others', count: token.others_count || 0, pct: token.others_pct || 0 }
    ];
    
    const formattedClasses = classes
        .filter(cls => cls.count > 0)
        .map(cls => formatWalletClass(cls.name, cls.count, cls.pct, true))
        .join(' • ');
    
    if (formattedClasses) {
        console.log(formattedClasses);
    } else {
        console.log('No wallet class data available');
    }
    
    console.log(`\nCopy mint: \`${mint}\``);
}

function showBundlers(mint) {
    if (!mint) {
        console.log('❌ Usage: node cli.js bundlers <MINT>');
        console.log('   Example: node cli.js bundlers So11111111111111111111111111111111111111112');
        process.exit(1);
    }
    
    // Get token info
    const token = db.prepare('SELECT mint, symbol FROM tokens WHERE mint = ?').get(mint);
    
    if (!token) {
        console.log(`❌ Token not found: ${mint}`);
        return;
    }
    
    // Get bundler data - funders who funded multiple recipients who bought this token
    const bundlers = db.prepare(`
        SELECT 
            h.funded_by as funder,
            COUNT(DISTINCT h.owner) as recipient_count,
            GROUP_CONCAT(DISTINCT h.owner) as recipients
        FROM holders h
        WHERE h.mint = ? 
            AND h.funded_by IS NOT NULL 
            AND h.is_bundler = 1
        GROUP BY h.funded_by
        ORDER BY recipient_count DESC
    `).all(mint);
    
    const { formatTokenDisplay } = require('./lib/visual-encoding');
    
    console.log(`🔗 Bundlers for ${formatTokenDisplay(token.symbol, mint)}`);
    console.log('─'.repeat(60));
    
    if (bundlers.length === 0) {
        console.log('No bundlers found for this token');
        return;
    }
    
    bundlers.forEach((bundler, index) => {
        console.log(`${index + 1}. ${bundler.funder.slice(0, 8)}…${bundler.funder.slice(-8)} → ${bundler.recipient_count} recipients`);
        const recipients = bundler.recipients.split(',').slice(0, 5); // Show first 5
        recipients.forEach(recipient => {
            console.log(`   └─ ${recipient.slice(0, 8)}…${recipient.slice(-8)}`);
        });
        if (bundler.recipients.split(',').length > 5) {
            console.log(`   └─ ... and ${bundler.recipients.split(',').length - 5} more`);
        }
        console.log('');
    });
    
    console.log(`Copy mint: \`${mint}\``);
}

function showInsiderDetails(mint) {
    if (!mint) {
        console.log('❌ Usage: node cli.js insider-details <MINT>');
        console.log('   Example: node cli.js insider-details So11111111111111111111111111111111111111112');
        process.exit(1);
    }
    
    // Get token info
    const token = db.prepare('SELECT mint, symbol, dev_wallet FROM tokens WHERE mint = ?').get(mint);
    
    if (!token) {
        console.log(`❌ Token not found: ${mint}`);
        return;
    }
    
    // Get insider holders with their flag details
    const insiders = db.prepare(`
        SELECT 
            h.owner,
            h.wallet_age_days,
            h.amount,
            h.funded_by,
            h.holder_type,
            CASE 
                WHEN h.funded_by = ? OR h.funded_by IN (
                    SELECT src_wallet FROM funding_edges WHERE dst_wallet = ?
                ) THEN 1 ELSE 0 
            END as f1_lineage,
            CASE 
                WHEN h.wallet_age_days <= 2 THEN 1 ELSE 0 
            END as f2_age,
            CASE 
                WHEN h.amount IN (
                    SELECT amount FROM holders 
                    WHERE mint = ? 
                    ORDER BY CAST(amount AS REAL) DESC 
                    LIMIT 10
                ) THEN 1 ELSE 0 
            END as f3_top10
        FROM holders h
        WHERE h.mint = ? AND h.is_insider = 1
        ORDER BY CAST(h.amount AS REAL) DESC
    `).all(mint, token.dev_wallet, token.dev_wallet, mint);
    
    const { formatTokenDisplay } = require('./lib/visual-encoding');
    
    console.log(`🕵️ Insider Details for ${formatTokenDisplay(token.symbol, mint)}`);
    console.log('─'.repeat(80));
    console.log('F1: Funding lineage with dev | F2: Wallet age ≤48h | F3: Top-10 by balance');
    console.log('');
    
    if (insiders.length === 0) {
        console.log('No insiders found for this token');
        return;
    }
    
    insiders.forEach((insider, index) => {
        const flags = [];
        if (insider.f1_lineage) flags.push('F1');
        if (insider.f2_age) flags.push('F2');
        if (insider.f3_top10) flags.push('F3');
        
        console.log(`${index + 1}. ${insider.owner.slice(0, 8)}…${insider.owner.slice(-8)}`);
        console.log(`   Flags: ${flags.join(' + ')} (${flags.length}/3)`);
        console.log(`   Age: ${insider.wallet_age_days} days | Amount: ${insider.amount}`);
        console.log(`   Funded by: ${insider.funded_by ? insider.funded_by.slice(0, 8) + '…' + insider.funded_by.slice(-8) : 'N/A'}`);
        console.log('');
    });
    
    console.log(`Copy mint: \`${mint}\``);
}

// --- Task 9 Alert System Functions ---

function showAlerts(limit = 20) {
    const validatedLimit = validateNumber(limit, 20);
    const rows = db.prepare(`
        SELECT 
            a.id,
            a.mint,
            t.symbol,
            a.alert_type,
            a.alert_level,
            a.message,
            a.triggered_at,
            a.status,
            a.metadata
        FROM alerts a
        LEFT JOIN tokens t ON a.mint = t.mint
        ORDER BY datetime(a.triggered_at) DESC
        LIMIT ?
    `).all(validatedLimit);
    
    if (rows.length === 0) {
        console.log('🔍 No alerts found');
        return;
    }
    
    console.log(`🚨 Recent ${validatedLimit} alerts:`);
    console.log('');
    
    const { formatTokenDisplayWithHealth } = require('./lib/visual-encoding');
    
    rows.forEach((row, index) => {
        const alertIcon = row.alert_type === 'launch' ? '🚀' : 
                         row.alert_type === 'momentum_upgrade' ? '📈' : 
                         row.alert_type === 'risk' ? '⚠️' : '🔔';
        
        const statusIcon = row.status === 'active' ? '🟢' : '🔴';
        
        console.log(`${index + 1}. ${alertIcon} ${row.alert_type.toUpperCase()} ${statusIcon}`);
        console.log(`   Token: ${formatTokenDisplayWithHealth(row.symbol, row.mint, null, true, 50)}`);
        console.log(`   Level: ${row.alert_level} • Status: ${row.status}`);
        console.log(`   Triggered: ${new Date(row.triggered_at).toLocaleString()}`);
        console.log(`   Message: ${row.message}`);
        console.log('');
    });
}

function showScoreHistory(mint) {
    if (!mint) {
        console.log('❌ Usage: node cli.js score-history <MINT>');
        console.log('   Example: node cli.js score-history So11111111111111111111111111111111111111112');
        process.exit(1);
    }
    
    // Get token info
    const token = db.prepare('SELECT mint, symbol, name FROM tokens WHERE mint = ?').get(mint);
    if (!token) {
        console.log(`❌ Token not found: ${mint}`);
        return;
    }
    
    // Get score history
    const history = db.prepare(`
        SELECT 
            snapshot_time,
            health_score,
            holders_count,
            fresh_pct,
            sniper_pct,
            insider_pct,
            top10_share,
            liquidity_usd
        FROM score_history
        WHERE mint = ?
        ORDER BY datetime(snapshot_time) DESC
        LIMIT 50
    `).all(mint);
    
    if (history.length === 0) {
        console.log(`🔍 No score history found for ${mint}`);
        console.log(`   Token: ${token.symbol || 'Unknown'} (${token.name || 'Unknown'})`);
        return;
    }
    
    console.log(`📊 Score History for ${token.symbol || 'Unknown'} (${mint.substring(0, 8)}...)`);
    console.log(`   Token: ${token.name || 'Unknown'}`);
    console.log('');
    
    // Format history data
    const formattedHistory = history.map((snapshot, index) => ({
        '#': index + 1,
        'Time': new Date(snapshot.snapshot_time).toLocaleString(),
        'Health': snapshot.health_score ? snapshot.health_score.toFixed(1) : 'N/A',
        'Holders': snapshot.holders_count || 0,
        'Fresh%': snapshot.fresh_pct ? (snapshot.fresh_pct * 100).toFixed(1) + '%' : 'N/A',
        'Sniper%': snapshot.sniper_pct ? (snapshot.sniper_pct * 100).toFixed(1) + '%' : 'N/A',
        'Insider%': snapshot.insider_pct ? (snapshot.insider_pct * 100).toFixed(1) + '%' : 'N/A',
        'Top10%': snapshot.top10_share ? (snapshot.top10_share * 100).toFixed(1) + '%' : 'N/A',
        'Liq': snapshot.liquidity_usd ? `$${(snapshot.liquidity_usd / 1000).toFixed(1)}k` : '$0'
    }));
    
    console.table(formattedHistory);
    console.log(`\nCopy mint: \`${mint}\``);
}

function runAlertEngine() {
    console.log('🔄 Running alert engine...');
    const { mainLoop } = require('./workers/alert-engine-worker');
    mainLoop().then(() => {
        console.log('✅ Alert engine completed');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Alert engine failed:', error.message);
        process.exit(1);
    });
}

function runScoreSnapshot() {
    console.log('🔄 Running score snapshot worker...');
    const { mainLoop } = require('./workers/score-snapshot-worker');
    mainLoop().then(() => {
        console.log('✅ Score snapshot worker completed');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Score snapshot worker failed:', error.message);
        process.exit(1);
    });
}

function showBacktestResults() {
    console.log('📊 Running backtest analysis...');
    const BacktestMethodology = require('./lib/backtest-methodology');
    const backtest = new BacktestMethodology();
    
    const results = backtest.formatBacktestResults();
    console.log(results);
}

function runBacktestRetune() {
    console.log('🔄 Running backtest re-tune...');
    const BacktestMethodology = require('./lib/backtest-methodology');
    const backtest = new BacktestMethodology();
    
    const results = backtest.rollingRetune();
    if (results) {
        console.log('✅ Backtest re-tune completed');
        console.log(`   Ruleset ID: ${results.rulesetId}`);
        console.log(`   Timestamp: ${results.timestamp}`);
        
        for (const [alertType, result] of Object.entries(results.results)) {
            console.log(`   ${alertType.toUpperCase()}: Precision ${(result.metrics.precision * 100).toFixed(1)}%, Lift ${result.metrics.lift.toFixed(2)}x`);
        }
    } else {
        console.error('❌ Backtest re-tune failed');
    }
}

function showEnhancedHealthScoring() {
    console.log('🎯 Running enhanced health scoring analysis...');
    const EnhancedHealthScoring = require('./lib/enhanced-health-scoring');
    const scoring = new EnhancedHealthScoring();
    
    const distribution = scoring.getScoreDistribution();
    if (distribution) {
        console.log('📊 Enhanced Health Score Distribution:');
        console.log(`   Total Tokens: ${distribution.total}`);
        console.log(`   Average Score: ${distribution.average}`);
        console.log(`   Score Range: ${distribution.range.min} - ${distribution.range.max}`);
        console.log('');
        console.log('   Distribution:');
        console.log(`     🟢 Excellent (80+): ${distribution.distribution.excellent}`);
        console.log(`     🔵 Good (60-79): ${distribution.distribution.good}`);
        console.log(`     🟡 Fair (40-59): ${distribution.distribution.fair}`);
        console.log(`     🔴 Poor (<40): ${distribution.distribution.poor}`);
        console.log('');
        console.log('   Quality Metrics:');
        console.log(`     Pegged at 0: ${distribution.extremes.peggedAtZero}`);
        console.log(`     Pegged at 100: ${distribution.extremes.peggedAtMax}`);
    } else {
        console.log('❌ Failed to get health score distribution');
    }
}

function showPriceHistory(mint) {
    if (!mint) {
        console.log('❌ Usage: node cli.js price-history <MINT>');
        console.log('   Example: node cli.js price-history So11111111111111111111111111111111111111112');
        return;
    }

    console.log(`📈 Price History for ${mint}:`);
    const { PriceSamplingWorker } = require('./workers/price-sampling-worker');
    const worker = new PriceSamplingWorker();
    
    const history = worker.getPriceHistory(mint, 10);
    
    if (history.length === 0) {
        console.log('   No price history found for this token');
        return;
    }

    console.log('─'.repeat(100));
    console.log('Timestamp'.padEnd(20) + 'Price USD'.padEnd(12) + 'Price SOL'.padEnd(12) + 'Liquidity'.padEnd(12) + 'Granularity'.padEnd(10) + 'Status');
    console.log('─'.repeat(100));

    history.forEach(record => {
        const timestamp = new Date(record.timestamp).toLocaleString();
        const priceUsd = record.price_usd ? `$${record.price_usd.toFixed(6)}` : 'N/A';
        const priceSol = record.price_sol ? `${record.price_sol.toFixed(8)}` : 'N/A';
        const liquidity = record.liquidity_usd ? `$${(record.liquidity_usd / 1000).toFixed(1)}k` : 'N/A';
        const granularity = record.granularity || 'N/A';
        const status = record.status || 'N/A';

        console.log(
            timestamp.padEnd(20) +
            priceUsd.padEnd(12) +
            priceSol.padEnd(12) +
            liquidity.padEnd(12) +
            granularity.padEnd(10) +
            status
        );
    });
}

function showReturnLabels(mint) {
    if (!mint) {
        console.log('❌ Usage: node cli.js labels <MINT>');
        console.log('   Example: node cli.js labels So11111111111111111111111111111111111111112');
        return;
    }

    console.log(`🏷️  Return Labels for ${mint}:`);
    const { ReturnLabelsWorker } = require('./workers/return-labels-worker');
    const worker = new ReturnLabelsWorker();
    
    const labels = worker.getReturnLabels(mint);
    
    if (labels.length === 0) {
        console.log('   No return labels found for this token');
        return;
    }

    console.log('─'.repeat(120));
    console.log('Anchor Time'.padEnd(20) + 'Price 30m'.padEnd(12) + 'Price 6h'.padEnd(12) + 'Price 24h'.padEnd(12) + 'RET 6h'.padEnd(10) + 'RET 24h'.padEnd(10) + 'Winner 50'.padEnd(10) + 'Winner 100'.padEnd(10) + 'Loser 50');
    console.log('─'.repeat(120));

    labels.forEach(label => {
        const anchorTime = new Date(label.anchor_timestamp).toLocaleString();
        const price30m = label.price_30m ? `$${label.price_30m.toFixed(6)}` : 'N/A';
        const price6h = label.price_6h ? `$${label.price_6h.toFixed(6)}` : 'N/A';
        const price24h = label.price_24h ? `$${label.price_24h.toFixed(6)}` : 'N/A';
        const ret6h = label.ret_6h ? `${(label.ret_6h * 100).toFixed(1)}%` : 'N/A';
        const ret24h = label.ret_24h ? `${(label.ret_24h * 100).toFixed(1)}%` : 'N/A';
        const winner50 = label.winner_50 ? '✅' : '❌';
        const winner100 = label.winner_100 ? '✅' : '❌';
        const loser50 = label.loser_50 ? '✅' : '❌';

        console.log(
            anchorTime.padEnd(20) +
            price30m.padEnd(12) +
            price6h.padEnd(12) +
            price24h.padEnd(12) +
            ret6h.padEnd(10) +
            ret24h.padEnd(10) +
            winner50.padEnd(10) +
            winner100.padEnd(10) +
            loser50
        );
    });
}

function runBacktestHarness(sampleSize = 500, since = '7d') {
    console.log(`🔄 Running backtest harness with sample size ${sampleSize}...`);
    const { BacktestHarnessWorker } = require('./workers/backtest-harness-worker');
    const worker = new BacktestHarnessWorker();
    
    worker.runBacktest(sampleSize, since).then((results) => {
        if (results) {
            worker.formatBacktestResults(results);
        }
        console.log('✅ Backtest harness completed');
    }).catch(error => {
        console.error('❌ Backtest harness failed:', error.message);
    });
}

function showBacktestLast() {
    console.log('📊 Latest Backtest Results:');
    const { BacktestHarnessWorker } = require('./workers/backtest-harness-worker');
    const worker = new BacktestHarnessWorker();
    
    const results = worker.getLatestBacktestResults();
    
    if (results.length === 0) {
        console.log('   No backtest results found for the last 7 days');
        return;
    }

    // Group by ruleset_id
    const groupedResults = {};
    results.forEach(result => {
        if (!groupedResults[result.ruleset_id]) {
            groupedResults[result.ruleset_id] = {
                rulesetId: result.ruleset_id,
                timestamp: result.created_at,
                rules: []
            };
        }
        groupedResults[result.ruleset_id].rules.push(result);
    });

    Object.values(groupedResults).forEach((ruleset, index) => {
        console.log(`\n${index + 1}. Ruleset: ${ruleset.rulesetId}`);
        console.log(`   Timestamp: ${new Date(ruleset.timestamp).toLocaleString()}`);
        console.log('   ─'.repeat(60));

        ruleset.rules.forEach(rule => {
            console.log(`   ${rule.alert_type.toUpperCase()}:`);
            console.log(`     Precision (+50%): ${(rule.precision_50 * 100).toFixed(1)}%`);
            console.log(`     Precision (+100%): ${(rule.precision_100 * 100).toFixed(1)}%`);
            console.log(`     Lift (+50%): ${rule.lift_50.toFixed(2)}x`);
            console.log(`     Lift (+100%): ${rule.lift_100.toFixed(2)}x`);
            console.log(`     Volume: ${rule.volume_per_day.toFixed(1)} alerts/day`);
            console.log(`     Sample Size: ${rule.sample_size}`);
        });
    });
}

function runPriceSampling() {
    console.log('🔄 Running price sampling worker...');
    const { mainLoop } = require('./workers/price-sampling-worker');
    mainLoop().then(() => {
        console.log('✅ Price sampling worker completed');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Price sampling worker failed:', error.message);
        process.exit(1);
    });
}

function runReturnLabels() {
    console.log('🔄 Running return labels worker...');
    const { mainLoop } = require('./workers/return-labels-worker');
    mainLoop().then(() => {
        console.log('✅ Return labels worker completed');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Return labels worker failed:', error.message);
        process.exit(1);
    });
}

function showRugRisk(mint) {
    if (!mint) {
        console.log('❌ Usage: node cli.js rug <MINT>');
        console.log('   Example: node cli.js rug So11111111111111111111111111111111111111112');
        return;
    }

    console.log(`🚨 Rug Risk Analysis for ${mint}:`);
    const { EnhancedRugRiskScorerWorker } = require('./workers/enhanced-rug-risk-scorer-worker');
    const worker = new EnhancedRugRiskScorerWorker();
    
    const rugData = worker.getEnhancedRugRiskData(mint);
    
    if (!rugData) {
        console.log('   No rug risk data found for this token');
        return;
    }

    const { formatTokenDisplayWithHealth } = require('./lib/visual-encoding');
    const tokenDisplay = formatTokenDisplayWithHealth(rugData.symbol, rugData.mint, null, true, 40);

    console.log('─'.repeat(80));
    console.log(`Token: ${tokenDisplay}`);
    console.log('');

    // Enhanced LP Safety with percentages and confidence
    console.log('🔒 LP Safety:');
    const burnStatus = rugData.lp_burn_pct !== null 
        ? `${(rugData.lp_burn_pct * 100).toFixed(0)}%` 
        : 'Unknown';
    const lockStatus = rugData.lp_locked_confidence === 2 
        ? `High (${rugData.lp_lock_provider || 'Unknown'})`
        : rugData.lp_locked_confidence === 1 
        ? `Low (${rugData.lp_lock_provider || 'Unknown'})`
        : 'No';
    
    console.log(`   LP: Burn ${burnStatus} • Lock: ${lockStatus} • Top1 ${(rugData.lp_owner_top1_pct * 100).toFixed(0)}% • Top5 ${(rugData.lp_owner_top5_pct * 100).toFixed(0)}%`);
    console.log('');

    // Liquidity Deltas with EMA notation
    console.log('💧 Liquidity Behavior:');
    const delta5m = rugData.liquidity_usd_5m_delta ? (rugData.liquidity_usd_5m_delta * 100).toFixed(1) + '%' : 'N/A';
    const delta15m = rugData.liquidity_usd_15m_delta ? (rugData.liquidity_usd_15m_delta * 100).toFixed(1) + '%' : 'N/A';
    console.log(`   ΔLiq: ${delta5m}/5m, ${delta15m}/15m (EMA) • ΔPrice: N/A/15m (TWAP)`);
    console.log('');

    // Authority Safety
    console.log('🛡️  Authority Safety:');
    console.log(`   Authorities: mint_revoked=${rugData.authorities_revoked === 1 ? 'Yes' : 'No'}, freeze_revoked=${rugData.authorities_revoked === 1 ? 'Yes' : 'No'}`);
    console.log('');

    // Enhanced Rug Score with breakdown
    console.log('🎯 Rug Risk Score:');
    if (rugData.rug_breakdown) {
        const breakdown = JSON.parse(rugData.rug_breakdown);
        console.log(`   RugScore: ${rugData.rug_risk_score || 'N/A'} (LP:${breakdown.lp_safety}, Auth:${breakdown.authorities}, Drains:${breakdown.drains}, Concentration:${breakdown.concentration})`);
    } else {
        console.log(`   RugScore: ${rugData.rug_risk_score || 'N/A'}/100`);
    }
    console.log('');

    // Risk Flags
    if (rugData.rug_flags) {
        console.log('🚩 Risk Flags:');
        const flags = rugData.rug_flags.split(',').filter(f => f.trim());
        flags.forEach(flag => {
            console.log(`   • ${flag}`);
        });
        console.log('');
    }

    console.log('🔗 Links:');
    console.log(`   Dexscreener: https://dexscreener.com/solana/${mint}`);
    console.log(`   Birdeye: https://birdeye.so/token/${mint}`);
    console.log(`   Solscan: https://solscan.io/token/${mint}`);
    console.log(`   GMGN: https://gmgn.ai/solana/token/${mint}`);
    console.log(`   Copy: \`${mint}\``);
}

function showLiquidityWatch(mint) {
    if (!mint) {
        console.log('❌ Usage: node cli.js watch-liq <MINT>');
        console.log('   Example: node cli.js watch-liq So11111111111111111111111111111111111111112');
        return;
    }

    console.log(`💧 Liquidity Watch for ${mint}:`);
    const { LiquidityDrainMonitorWorker } = require('./workers/liquidity-drain-monitor-worker');
    const worker = new LiquidityDrainMonitorWorker();
    
    const liqData = worker.getLiquidityMonitoringData(mint);
    
    if (!liqData) {
        console.log('   No liquidity data found for this token');
        return;
    }

    console.log('─'.repeat(60));
    console.log(`Current Liquidity: $${(liqData.liquidity_usd / 1000).toFixed(1)}k`);
    console.log(`Last Recorded: $${liqData.liquidity_usd_last ? (liqData.liquidity_usd_last / 1000).toFixed(1) + 'k' : 'N/A'}`);
    console.log('');

    // Deltas with trend indicators
    const delta5m = liqData.liquidity_usd_5m_delta;
    const delta15m = liqData.liquidity_usd_15m_delta;

    console.log('📊 Liquidity Deltas:');
    if (delta5m !== null) {
        const trend5m = delta5m > 0 ? '📈' : delta5m < -0.1 ? '📉' : '➡️';
        console.log(`   5m: ${trend5m} ${(delta5m * 100).toFixed(1)}%`);
    } else {
        console.log('   5m: ❓ No data');
    }

    if (delta15m !== null) {
        const trend15m = delta15m > 0 ? '📈' : delta15m < -0.1 ? '📉' : '➡️';
        console.log(`   15m: ${trend15m} ${(delta15m * 100).toFixed(1)}%`);
    } else {
        console.log('   15m: ❓ No data');
    }

    console.log('');
    console.log('⚠️  Drain Alerts:');
    if (delta5m !== null && delta5m <= -0.40) {
        console.log(`   🚨 Rapid 5m drain: ${(delta5m * 100).toFixed(1)}%`);
    }
    if (delta15m !== null && delta15m <= -0.65) {
        console.log(`   🚨 Critical 15m drain: ${(delta15m * 100).toFixed(1)}%`);
    }
    if (delta15m !== null && delta15m <= -0.40 && delta15m > -0.65) {
        console.log(`   ⚠️  Sustained drain: ${(delta15m * 100).toFixed(1)}%`);
    }
    if ((!delta5m || delta5m > -0.40) && (!delta15m || delta15m > -0.40)) {
        console.log('   ✅ No significant drains detected');
    }
    
    console.log('');
    console.log('🔗 Links:');
    console.log(`   Dexscreener: https://dexscreener.com/solana/${mint}`);
    console.log(`   Birdeye: https://birdeye.so/token/${mint}`);
    console.log(`   Solscan: https://solscan.io/token/${mint}`);
    console.log(`   GMGN: https://gmgn.ai/solana/token/${mint}`);
    console.log(`   Copy: \`${mint}\``);
}

function showCandidatesRisk(limit = 10) {
    const validatedLimit = validateNumber(limit, 10);
    const { RugRiskScorerWorker } = require('./workers/rug-risk-scorer-worker');
    const worker = new RugRiskScorerWorker();
    
    const highRiskTokens = worker.getHighRiskTokens(validatedLimit);
    
    if (highRiskTokens.length === 0) {
        console.log('🔍 No high-risk tokens found (RugScore ≥ 60)');
        console.log('   All tokens appear to have low rug risk');
    } else {
        console.log(`🚨 High-Risk Tokens (RugScore ≥ 60):`);
        
        const { formatTokenDisplayWithHealth } = require('./lib/visual-encoding');
        const formattedRows = highRiskTokens.map((row, index) => ({
            '#': index + 1,
            'Token': formatTokenDisplayWithHealth(row.symbol, row.mint, null, true, 40),
            'RugScore': row.rug_risk_score ? row.rug_risk_score.toFixed(1) : 'N/A',
            'Liq': row.liquidity_usd ? `$${(row.liquidity_usd / 1000).toFixed(1)}k` : '$0',
            'Top1%': row.lp_owner_top1_pct ? (row.lp_owner_top1_pct * 100).toFixed(1) + '%' : 'N/A',
            'Top5%': row.lp_owner_top5_pct ? (row.lp_owner_top5_pct * 100).toFixed(1) + '%' : 'N/A',
            'Flags': row.rug_flags ? row.rug_flags.split(',').slice(0, 2).join(', ') : 'N/A'
        }));
        
        console.table(formattedRows);
        
        console.log('\n⚠️  Risk Legend:');
        console.log('   lp_unburned: LP tokens not burned');
        console.log('   lp_unlocked: LP tokens not locked');
        console.log('   top1_gt20: Top holder owns >20% of LP');
        console.log('   drain_40_5m: -40% liquidity drain in 5m');
        console.log('   authorities_active: Mint/freeze authorities still active');
    }
}

function runPoolIntrospector() {
    console.log('🔄 Running pool introspector worker...');
    const { mainLoop } = require('./workers/pool-introspector-worker');
    mainLoop().then(() => {
        console.log('✅ Pool introspector worker completed');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Pool introspector worker failed:', error.message);
        process.exit(1);
    });
}

function runLiquidityDrainMonitor() {
    console.log('🔄 Running liquidity drain monitor worker...');
    const { mainLoop } = require('./workers/liquidity-drain-monitor-worker');
    mainLoop().then(() => {
        console.log('✅ Liquidity drain monitor worker completed');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Liquidity drain monitor worker failed:', error.message);
        process.exit(1);
    });
}

function runRugRiskScorer() {
    console.log('🔄 Running rug risk scorer worker...');
    const { mainLoop } = require('./workers/rug-risk-scorer-worker');
    mainLoop().then(() => {
        console.log('✅ Rug risk scorer worker completed');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Rug risk scorer worker failed:', error.message);
        process.exit(1);
    });
}

function runEnhancedPoolIntrospector() {
    console.log('🔄 Running enhanced pool introspector worker...');
    const { mainLoop } = require('./workers/enhanced-pool-introspector-worker');
    mainLoop().then(() => {
        console.log('✅ Enhanced pool introspector worker completed');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Enhanced pool introspector worker failed:', error.message);
        process.exit(1);
    });
}

function runEnhancedRugRiskScorer() {
    console.log('🔄 Running enhanced rug risk scorer worker...');
    const { mainLoop } = require('./workers/enhanced-rug-risk-scorer-worker');
    mainLoop().then(() => {
        console.log('✅ Enhanced rug risk scorer worker completed');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Enhanced rug risk scorer worker failed:', error.message);
        process.exit(1);
    });
}

function showWalletReputation(wallet) {
    if (!wallet) {
        console.log('❌ Usage: node cli.js wallet <WALLET>');
        return;
    }

    try {
        const reputation = db.prepare(`
            SELECT 
                wallet,
                snipes_total,
                snipes_success,
                bundles_total,
                recipients_total,
                insider_hits,
                rug_involved,
                reputation_score,
                score_breakdown,
                last_seen_at,
                updated_at
            FROM wallet_reputation
            WHERE wallet = ?
        `).get(wallet);

        if (!reputation) {
            console.log(`❌ No reputation data found for wallet: ${wallet}`);
            return;
        }

        console.log(`🔍 Wallet Reputation: ${wallet}`);
        console.log(`📊 Reputation Score: ${reputation.reputation_score.toFixed(1)}/100`);
        console.log(`📈 Snipes: ${reputation.snipes_total} (${reputation.snipes_success} successful)`);
        console.log(`📦 Bundles: ${reputation.bundles_total} (${reputation.recipients_total} recipients)`);
        console.log(`🎯 Insider Hits: ${reputation.insider_hits}`);
        console.log(`💀 Rug Involved: ${reputation.rug_involved}`);
        console.log(`🕒 Last Seen: ${reputation.last_seen_at}`);
        console.log(`🔄 Updated: ${reputation.updated_at}`);

        if (reputation.score_breakdown) {
            try {
                const breakdown = JSON.parse(reputation.score_breakdown);
                console.log(`\n📋 Score Breakdown:`);
                console.log(`   S_snipes: ${breakdown.S_snipes}`);
                console.log(`   S_bundles: ${breakdown.S_bundles}`);
                console.log(`   S_insider: ${breakdown.S_insider}`);
                console.log(`   S_rug: ${breakdown.S_rug}`);
                console.log(`   S_reward: ${breakdown.S_reward}`);
                if (breakdown.is_market_maker) {
                    console.log(`   🏦 Market Maker (penalty: ${breakdown.penalty_factor})`);
                }
            } catch (e) {
                console.log(`   Raw breakdown: ${reputation.score_breakdown}`);
            }
        }
    } catch (error) {
        console.log(`❌ Error fetching wallet reputation: ${error.message}`);
    }
}

function showWalletTop(limit = 10) {
    const validatedLimit = validateNumber(limit, 10);
    
    try {
        const wallets = db.prepare(`
            SELECT 
                wallet,
                reputation_score,
                snipes_total,
                bundles_total,
                insider_hits,
                rug_involved,
                last_seen_at
            FROM wallet_reputation
            WHERE reputation_score > 0
            ORDER BY reputation_score DESC
            LIMIT ?
        `).all(validatedLimit);

        if (wallets.length === 0) {
            console.log('❌ No wallet reputation data found');
            return;
        }

        console.log(`🏆 Top ${validatedLimit} Worst Actors (by reputation score):`);
        console.log('');

        wallets.forEach((wallet, index) => {
            const riskLevel = wallet.reputation_score >= 80 ? '🔴' : 
                             wallet.reputation_score >= 60 ? '🟠' : 
                             wallet.reputation_score >= 40 ? '🟡' : '🟢';
            
            console.log(`${index + 1}. ${riskLevel} ${wallet.wallet}`);
            console.log(`   Score: ${wallet.reputation_score.toFixed(1)} | Snipes: ${wallet.snipes_total} | Bundles: ${wallet.bundles_total}`);
            console.log(`   Insiders: ${wallet.insider_hits} | Rugs: ${wallet.rug_involved} | Last: ${wallet.last_seen_at}`);
            console.log('');
        });
    } catch (error) {
        console.log(`❌ Error fetching top wallets: ${error.message}`);
    }
}

function showWalletClassesWithReputation(mint) {
    if (!mint) {
        console.log('❌ Usage: node cli.js classes <MINT>');
        return;
    }

    try {
        // Get wallet classes with reputation data
        const classes = db.prepare(`
            SELECT 
                h.owner,
                h.amount,
                h.is_inception,
                h.is_sniper,
                h.is_bundler,
                h.is_insider,
                wr.reputation_score,
                wr.snipes_total,
                wr.bundles_total,
                wr.insider_hits,
                wr.rug_involved
            FROM holders h
            LEFT JOIN wallet_reputation wr ON h.owner = wr.wallet
            WHERE h.mint = ?
            ORDER BY CAST(h.amount AS REAL) DESC
            LIMIT 50
        `).all(mint);

        if (classes.length === 0) {
            console.log(`❌ No holders found for mint: ${mint}`);
            return;
        }

        console.log(`👥 Wallet Classes for ${mint}:`);
        console.log('');

        // Group by class and count high-rep actors
        const classStats = {
            inception: { total: 0, highRep: 0, wallets: [] },
            sniper: { total: 0, highRep: 0, wallets: [] },
            bundler: { total: 0, highRep: 0, wallets: [] },
            insider: { total: 0, highRep: 0, wallets: [] },
            other: { total: 0, highRep: 0, wallets: [] }
        };

        classes.forEach(holder => {
            const isHighRep = holder.reputation_score >= 60;
            const classes = [];
            
            if (holder.is_inception) classes.push('inception');
            if (holder.is_sniper) classes.push('sniper');
            if (holder.is_bundler) classes.push('bundler');
            if (holder.is_insider) classes.push('insider');
            if (classes.length === 0) classes.push('other');

            classes.forEach(cls => {
                classStats[cls].total++;
                if (isHighRep) classStats[cls].highRep++;
                classStats[cls].wallets.push({
                    wallet: holder.owner,
                    amount: holder.amount,
                    reputation: holder.reputation_score || 0,
                    snipes: holder.snipes_total || 0,
                    bundles: holder.bundles_total || 0,
                    insiders: holder.insider_hits || 0,
                    rugs: holder.rug_involved || 0
                });
            });
        });

        // Display class statistics
        Object.entries(classStats).forEach(([className, stats]) => {
            if (stats.total > 0) {
                const highRepPct = ((stats.highRep / stats.total) * 100).toFixed(1);
                console.log(`📊 ${className.toUpperCase()}: ${stats.total} total (${stats.highRep} high-rep, ${highRepPct}%)`);
                
                // Show top high-rep wallets in this class
                const highRepWallets = stats.wallets
                    .filter(w => w.reputation >= 60)
                    .sort((a, b) => b.reputation - a.reputation)
                    .slice(0, 3);
                
                if (highRepWallets.length > 0) {
                    console.log(`   🚨 High-rep actors:`);
                    highRepWallets.forEach(w => {
                        console.log(`      ${w.wallet} (${w.reputation.toFixed(1)}) - S:${w.snipes} B:${w.bundles} I:${w.insiders} R:${w.rugs}`);
                    });
                }
                console.log('');
            }
        });
    } catch (error) {
        console.log(`❌ Error fetching wallet classes: ${error.message}`);
    }
}

function showBadActors(mint) {
    if (!mint) {
        console.log('❌ Usage: node cli.js bad-actors <MINT>');
        return;
    }

    try {
        // Get high-rep actors involved with this token
        const badActors = db.prepare(`
            SELECT DISTINCT
                h.owner as wallet,
                wr.reputation_score,
                wr.snipes_total,
                wr.bundles_total,
                wr.insider_hits,
                wr.rug_involved,
                h.is_sniper,
                h.is_bundler,
                h.is_insider,
                h.amount,
                wr.last_seen_at
            FROM holders h
            JOIN wallet_reputation wr ON h.owner = wr.wallet
            WHERE h.mint = ? 
              AND wr.reputation_score >= 60
            ORDER BY wr.reputation_score DESC
        `).all(mint);

        if (badActors.length === 0) {
            console.log(`✅ No high-reputation bad actors found for ${mint}`);
            return;
        }

        console.log(`🚨 High-Reputation Bad Actors for ${mint}:`);
        console.log('');

        badActors.forEach((actor, index) => {
            const roles = [];
            if (actor.is_sniper) roles.push('Sniper');
            if (actor.is_bundler) roles.push('Bundler');
            if (actor.is_insider) roles.push('Insider');
            
            const why = [];
            if (actor.snipes_total > 0) why.push(`${actor.snipes_total} snipes`);
            if (actor.bundles_total > 0) why.push(`${actor.bundles_total} bundles`);
            if (actor.insider_hits > 0) why.push(`${actor.insider_hits} insider hits`);
            if (actor.rug_involved > 0) why.push(`${actor.rug_involved} rug involvement`);

            console.log(`${index + 1}. 🔴 ${actor.wallet}`);
            console.log(`   Score: ${actor.reputation_score.toFixed(1)} | Roles: ${roles.join(', ') || 'None'}`);
            console.log(`   Why: ${why.join(', ')} | Amount: ${actor.amount}`);
            console.log(`   Last seen: ${actor.last_seen_at}`);
            console.log('');
        });
    } catch (error) {
        console.log(`❌ Error fetching bad actors: ${error.message}`);
    }
}

function showPredict(mint) {
    if (!mint) {
        console.log('❌ Usage: node cli.js predict <MINT>');
        return;
    }

    try {
        const token = db.prepare(`
            SELECT 
                t.mint, t.symbol, t.name, t.health_score, t.liquidity_usd,
                t.prob_2x_24h, t.prob_rug_24h, t.model_id_win, t.model_id_rug,
                tp_win.explainability as explain_win,
                tp_rug.explainability as explain_rug
            FROM tokens t
            LEFT JOIN token_predictions tp_win ON t.mint = tp_win.mint 
                AND tp_win.target = '2x_24h' 
                AND tp_win.ts = (
                    SELECT MAX(ts) FROM token_predictions tp2 
                    WHERE tp2.mint = t.mint AND tp2.target = '2x_24h'
                )
            LEFT JOIN token_predictions tp_rug ON t.mint = tp_rug.mint 
                AND tp_rug.target = 'rug_24h' 
                AND tp_rug.ts = (
                    SELECT MAX(ts) FROM token_predictions tp3 
                    WHERE tp3.mint = t.mint AND tp3.target = 'rug_24h'
                )
            WHERE t.mint = ?
        `).get(mint);

        if (!token) {
            console.log(`❌ Token not found: ${mint}`);
            return;
        }

        console.log(`🔮 Probability Prediction: ${token.symbol} (${mint})`);
        console.log(`📊 Health Score: ${token.health_score || 'N/A'}`);
        console.log(`💰 Liquidity: $${token.liquidity_usd ? (token.liquidity_usd / 1000).toFixed(1) + 'k' : 'N/A'}`);
        console.log('');

        if (token.prob_2x_24h !== null) {
            const prob2x = token.prob_2x_24h * 100;
            const color2x = prob2x >= 40 ? '🟢' : prob2x >= 25 ? '🟡' : '🔵';
            console.log(`${color2x} Prob2x 24h: ${prob2x.toFixed(1)}%`);
            if (token.explain_win) {
                console.log(`   Why: ${token.explain_win}`);
            }
            console.log(`   Model: ${token.model_id_win || 'N/A'}`);
        } else {
            console.log('🔵 Prob2x 24h: Not available');
        }

        if (token.prob_rug_24h !== null) {
            const probRug = token.prob_rug_24h * 100;
            const colorRug = probRug >= 60 ? '🔴' : probRug >= 30 ? '🟠' : '🟢';
            console.log(`${colorRug} ProbRug 24h: ${probRug.toFixed(1)}%`);
            if (token.explain_rug) {
                console.log(`   Why: ${token.explain_rug}`);
            }
            console.log(`   Model: ${token.model_id_rug || 'N/A'}`);
        } else {
            console.log('🟢 ProbRug 24h: Not available');
        }

        console.log('');
        console.log('🔗 Links:');
        console.log(`   Dexscreener: https://dexscreener.com/solana/${mint}`);
        console.log(`   Birdeye: https://birdeye.so/token/${mint}`);
        console.log(`   Solscan: https://solscan.io/token/${mint}`);
        console.log(`   GMGN: https://gmgn.ai/solana/token/${mint}`);
        console.log(`   Copy: \`${mint}\``);

    } catch (error) {
        console.log(`❌ Error fetching prediction: ${error.message}`);
    }
}

function showBacktestLast() {
    try {
        const backtest = db.prepare(`
            SELECT * FROM backtest_runs
            ORDER BY created_at DESC
            LIMIT 1
        `).get();

        if (!backtest) {
            console.log('❌ No backtest results found');
            return;
        }

        const metrics = JSON.parse(backtest.metrics);
        const thresholds = JSON.parse(backtest.thresholds);

        console.log('📊 Latest Backtest Results:');
        console.log(`Run ID: ${backtest.run_id}`);
        console.log(`Created: ${backtest.created_at}`);
        console.log('');

        console.log('🎯 Winner Model (2x_24h):');
        console.log(`   AUROC: ${metrics.winner?.auroc?.toFixed(3) || 'N/A'}`);
        console.log(`   AUPRC: ${metrics.winner?.auprc?.toFixed(3) || 'N/A'}`);
        console.log(`   Brier: ${metrics.winner?.brier?.toFixed(3) || 'N/A'}`);
        console.log('');

        console.log('🚨 Rug Model (rug_24h):');
        console.log(`   AUROC: ${metrics.rug?.auroc?.toFixed(3) || 'N/A'}`);
        console.log(`   AUPRC: ${metrics.rug?.auprc?.toFixed(3) || 'N/A'}`);
        console.log(`   Brier: ${metrics.rug?.brier?.toFixed(3) || 'N/A'}`);
        console.log('');

        console.log('⚙️ Operating Thresholds:');
        console.log(`   Prob2x ≥ ${(thresholds.prob2x_threshold * 100).toFixed(0)}% for Pro alerts`);
        console.log(`   Prob2x ≥ ${(thresholds.prob2x_free_threshold * 100).toFixed(0)}% for Free alerts`);
        console.log(`   ProbRug ≥ ${(thresholds.probrug_risk_threshold * 100).toFixed(0)}% for Risk alerts`);
        console.log(`   ProbRug ≥ ${(thresholds.probrug_immediate_threshold * 100).toFixed(0)}% for immediate Rug alerts`);

    } catch (error) {
        console.log(`❌ Error fetching backtest results: ${error.message}`);
    }
}

function showHelp() {
    console.log(`
🚀 Memecoin Agent CLI

Commands:
  recent [N]           Show recent tokens (default: 20)
  recent-pump [N]      Show recent Pump.fun tokens (default: 20)
  candidates [N]       Show candidate tokens (default: 20)
  
  Wallet Intelligence (Task 12):
  wallet <WALLET>      Show wallet reputation details
  wallet-top [N]       Show top worst actors by reputation (default: 10)
  classes <MINT>       Show wallet classes with high-rep counts
  bad-actors <MINT>    Show high-rep bad actors for a token
  
  Advanced Scoring (Task 13):
  predict <MINT>       Show probability predictions for a token
  backtest-last        Show latest backtest results and metrics
  events <MINT>        Show events for specific token
  holders <MINT> [N]   Show top holders for specific token (default: 20)
  momentum <MINT> [N]  Show holder growth momentum over time (default: 20)
  
  🩺 Diagnostics:
  data-gaps            Show data coverage analysis
  health-analysis      Show health score analysis for eligible tokens
  why-not-candidate <MINT>  Analyze why a token isn't a candidate
  curve <MINT> [N]     Show momentum curve with growth rates (default: 20)
  score <MINT>         Show health score and wallet analysis
  top [N]              Show top tokens by health score (default: 20)
  errors [N]           Show recent enrichment errors (default: 20)
  unenriched [N]       Show tokens still needing enrichment (default: 20)
  enrich <MINT>        Force enrich a single token
  stats                Show comprehensive statistics
  
  🚨 Task 9 Alert System:
  alerts [N]           Show recent alerts (default: 20)
  score-history <MINT> Show score history for specific token
  alert-engine         Run alert engine worker
  score-snapshot       Run score snapshot worker
  backtest             Show backtest results and metrics
  backtest-retune      Run backtest re-tuning
  health-analysis      Show enhanced health scoring analysis
  
  📈 Task 10 Price Feeds & Backtests:
  price-history <MINT> Show price history for specific token
  labels <MINT>        Show return labels for specific token
  backtest-run [N]     Run backtest harness (default: 500 tokens)
  backtest-last        Show latest backtest results
  price-sampling       Run price sampling worker
  return-labels        Run return labels worker
  
  🚨 Task 11 Rug Checks & Safety:
  rug <MINT>           Show rug risk analysis for specific token
  watch-liq <MINT>     Stream liquidity monitoring with deltas
  candidates-risk [N]  Show high-risk tokens ranked by RugScore
  pool-introspector    Run pool introspector worker
  liquidity-monitor    Run liquidity drain monitor worker
  rug-risk-scorer      Run rug risk scorer worker
  
  🔍 Wallet Profiling (Task 8):
  profiling            Show wallet profiling dashboard
  profiling-detail <MINT>  Show detailed wallet analysis for token
  profiling-run        Run full wallet profiling pipeline
  discord-alert <MINT> Generate Discord/Telegram alert for token
  classes <MINT>       Show wallet class breakdown for token
  bundlers <MINT>      Show bundler funder → recipients mapping
  insider-details <MINT> Show insider details with 2-of-3 rule evidence
  candidates [N]       Show candidate tokens ranked by quality
  profiling-pool       Run pool locator worker
  profiling-sniper     Run sniper detector worker
  profiling-bundler    Run bundler detector worker
  profiling-insider    Run insider detector worker
  profiling-health     Run health score calculator
  profiling-history    Run history snapshot worker
  
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
} else if (cmd === 'data-gaps') {
    showDataGaps();
} else if (cmd === 'health-analysis') {
    showHealthAnalysis();
} else if (cmd === 'why-not-candidate') {
    showWhyNotCandidate(process.argv[3]);
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
} else if (cmd === 'classes') {
    showWalletClasses(process.argv[3]);
} else if (cmd === 'bundlers') {
    showBundlers(process.argv[3]);
} else if (cmd === 'insider-details') {
    showInsiderDetails(process.argv[3]);
} else if (cmd === 'candidates') {
    const limit = process.argv[3];
    showCandidates(limit);
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
} else if (cmd === 'profiling-history') {
    const { mainLoop } = require('./workers/history-snapshot-worker');
    mainLoop().then(() => process.exit(0)).catch(error => {
        console.error('❌ History snapshot failed:', error.message);
        process.exit(1);
    });
} else if (cmd === 'alerts') {
    const n = process.argv[3];
    showAlerts(n);
} else if (cmd === 'score-history') {
    showScoreHistory(process.argv[3]);
} else if (cmd === 'alert-engine') {
    runAlertEngine();
} else if (cmd === 'score-snapshot') {
    runScoreSnapshot();
} else if (cmd === 'backtest') {
    showBacktestResults();
} else if (cmd === 'backtest-retune') {
    runBacktestRetune();
} else if (cmd === 'health-analysis') {
    showEnhancedHealthScoring();
} else if (cmd === 'price-history') {
    showPriceHistory(process.argv[3]);
} else if (cmd === 'labels') {
    showReturnLabels(process.argv[3]);
} else if (cmd === 'backtest-run') {
    const sampleSize = process.argv[3] ? parseInt(process.argv[3]) : 500;
    runBacktestHarness(sampleSize);
} else if (cmd === 'backtest-last') {
    showBacktestLast();
} else if (cmd === 'price-sampling') {
    runPriceSampling();
} else if (cmd === 'return-labels') {
    runReturnLabels();
} else if (cmd === 'rug') {
    showRugRisk(process.argv[3]);
} else if (cmd === 'watch-liq') {
    showLiquidityWatch(process.argv[3]);
} else if (cmd === 'candidates-risk') {
    const limit = process.argv[3] ? parseInt(process.argv[3]) : 10;
    showCandidatesRisk(limit);
} else if (cmd === 'pool-introspector') {
    runPoolIntrospector();
} else if (cmd === 'liquidity-monitor') {
    runLiquidityDrainMonitor();
} else if (cmd === 'rug-risk-scorer') {
    runRugRiskScorer();
} else if (cmd === 'enhanced-pool-introspector') {
    runEnhancedPoolIntrospector();
} else if (cmd === 'enhanced-rug-risk-scorer') {
    runEnhancedRugRiskScorer();
} else if (cmd === 'wallet') {
    showWalletReputation(process.argv[3]);
} else if (cmd === 'wallet-top') {
    const limit = process.argv[3];
    showWalletTop(limit);
} else if (cmd === 'classes') {
    showWalletClassesWithReputation(process.argv[3]);
} else if (cmd === 'bad-actors') {
    showBadActors(process.argv[3]);
} else if (cmd === 'predict') {
    showPredict(process.argv[3]);
} else if (cmd === 'backtest-last') {
    showBacktestLast();
} else if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    showHelp();
} else {
    console.log(`❌ Unknown command: ${cmd}`);
    showHelp();
}
