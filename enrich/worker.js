// enrich/worker.js - Enhanced token enrichment with batching, rate limiting, and error handling
require('dotenv').config();
const Database = require('better-sqlite3');
const { fetchJson, sleep } = require('../lib/http');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const DEXSCREENER_BASE = process.env.DEXSCREENER_BASE || 'https://api.dexscreener.com';

// --- Enhanced Queries ---
const pickBatch = db.prepare(`
  SELECT mint, symbol, name, decimals, authorities_revoked, lp_exists, liquidity_usd,
         first_seen_at, last_enriched_at, enrich_attempts
  FROM tokens
  WHERE (
    symbol IS NULL OR name IS NULL OR decimals IS NULL
    OR authorities_revoked IS NULL
    OR lp_exists IS NULL OR liquidity_usd IS NULL
  )
  AND (
    -- Hot: first hour → at most every 2 minutes
    (datetime(first_seen_at) > datetime('now', '-60 minutes') AND
     (last_enriched_at IS NULL OR datetime(last_enriched_at) <= datetime('now', '-2 minutes')))
    OR
    -- Warm: first 6h → at most every 15 minutes
    (datetime(first_seen_at) > datetime('now', '-6 hours') AND
     datetime(first_seen_at) <= datetime('now', '-60 minutes') AND
     (last_enriched_at IS NULL OR datetime(last_enriched_at) <= datetime('now', '-15 minutes')))
    OR
    -- Cold: otherwise → at most daily
    (datetime(first_seen_at) <= datetime('now', '-6 hours') AND
     (last_enriched_at IS NULL OR datetime(last_enriched_at) <= datetime('now', '-1 day')))
  )
  ORDER BY datetime(first_seen_at) DESC
  LIMIT 10
`);

const markStart = db.prepare(`
  UPDATE tokens SET enrich_attempts = COALESCE(enrich_attempts,0)+1 WHERE mint = ?
`);

const saveEnrichment = db.prepare(`
  UPDATE tokens
  SET symbol = COALESCE(?, symbol),
      name = COALESCE(?, name),
      decimals = COALESCE(?, decimals),
      authorities_revoked = COALESCE(?, authorities_revoked),
      lp_exists = COALESCE(?, lp_exists),
      liquidity_usd = COALESCE(?, liquidity_usd),
      last_enriched_at = ?,
      enrich_error = NULL
  WHERE mint = ?
`);

const saveError = db.prepare(`
  UPDATE tokens
  SET last_enriched_at = ?, enrich_error = ?
  WHERE mint = ?
`);

// --- Enhanced API helpers ---
async function fetchTokenMetadataHelius(mints) {
  if (!HELIUS_API_KEY || HELIUS_API_KEY === 'your_helius_key') {
    console.log('⚠️  Skipping Helius metadata (no API key)');
    return {};
  }

  const out = {};
  const url = `https://api.helius.xyz/v0/token-metadata?api-key=${HELIUS_API_KEY}`;
  
  // Batch in chunks of 100
  for (let i = 0; i < mints.length; i += 100) {
    const batch = mints.slice(i, i + 100);
    
    try {
      const arr = await fetchJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mintAccounts: batch })
      }, { rateLimiter: 'helius', retries: 2, backoffMs: 1000 });

      if (!Array.isArray(arr) || arr.length === 0) {
        console.log(`⚠️  Empty metadata response for batch of ${batch.length} mints`);
        continue;
      }

      for (const item of arr) {
        const acc = item?.account;
        if (!acc) continue;
        
        const md = item?.onChainData || {};
        const sym = md?.symbol || item?.tokenInfo?.symbol || null;
        const name = md?.name || item?.tokenInfo?.name || null;
        const dec = item?.tokenInfo?.decimals ?? null;
        
        out[acc] = { 
          symbol: sym || null, 
          name: name || null, 
          decimals: Number.isFinite(dec) ? dec : null 
        };
      }
    } catch (error) {
      console.error(`❌ Helius metadata batch failed:`, error.message);
      throw new Error(`HELIUS_META_${error.message}`);
    }
  }
  
  return out;
}

async function fetchAuthoritiesRevoked(mint) {
  if (!HELIUS_API_KEY || HELIUS_API_KEY === 'your_helius_key') {
    console.log('⚠️  Skipping authorities check (no API key)');
    return null;
  }

  const rpc = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  
  try {
    const j = await fetchJson(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [mint, { encoding: 'jsonParsed' }]
      })
    }, { rateLimiter: 'rpc', retries: 3, backoffMs: 2000, timeoutMs: 8000 });

    const result = j?.result?.value;
    
    // Fast guard: uninitialized mint
    if (result === null) {
      return { authorities_revoked: 0, error: 'UNINITIALIZED_MINT' };
    }

    const parsed = result?.data?.parsed;
    const info = parsed?.info || {};
    
    // Check if both authorities are null (revoked)
    const mintAuth = info?.mintAuthority ?? null;
    const freezeAuth = info?.freezeAuthority ?? null;
    const revoked = (mintAuth === null && freezeAuth === null) ? 1 : 0;
    
    return { authorities_revoked: revoked };
  } catch (error) {
    console.error(`❌ RPC authorities check failed for ${mint}:`, error.message);
    throw new Error(`RPC_AUTH_${error.message}`);
  }
}

async function fetchLiquidityDexScreener(mint) {
  const url = `${DEXSCREENER_BASE}/latest/dex/tokens/${mint}`;
  
  try {
    const j = await fetchJson(url, {}, { 
      rateLimiter: 'dexscreener', 
      retries: 2, 
      backoffMs: 2000,
      timeoutMs: 6000 
    });

    const pairs = j?.pairs || [];
    if (!pairs.length) {
      return { lp_exists: 0, liquidity_usd: null };
    }

    let maxUsd = 0;
    for (const p of pairs) {
      const liqUsd = Number(p?.liquidity?.usd ?? 0);
      if (liqUsd > maxUsd) maxUsd = liqUsd;
    }

    return { 
      lp_exists: maxUsd > 0 ? 1 : 0, 
      liquidity_usd: maxUsd > 0 ? maxUsd : null 
    };
  } catch (error) {
    console.error(`❌ DexScreener liquidity check failed for ${mint}:`, error.message);
    throw new Error(`DEX_LIQ_${error.message}`);
  }
}

// --- Enhanced Orchestrator ---
async function enrichOne(token) {
  const nowIso = new Date().toISOString();
  markStart.run(token.mint);

  try {
    // Parallelize API calls
    const [metaMap, authResult, liqResult] = await Promise.allSettled([
      fetchTokenMetadataHelius([token.mint]),
      fetchAuthoritiesRevoked(token.mint),
      fetchLiquidityDexScreener(token.mint)
    ]);

    const meta = metaMap.status === 'fulfilled' ? metaMap.value[token.mint] || {} : {};
    const auth = authResult.status === 'fulfilled' ? (authResult.value || { authorities_revoked: null }) : { authorities_revoked: null };
    const liq = liqResult.status === 'fulfilled' ? (liqResult.value || { lp_exists: null, liquidity_usd: null }) : { lp_exists: null, liquidity_usd: null };

    // Build error message for any failures
    const errors = [];
    if (metaMap.status === 'rejected') errors.push(metaMap.reason.message);
    if (authResult.status === 'rejected') errors.push(authResult.reason.message);
    if (liqResult.status === 'rejected') errors.push(liqResult.reason.message);

    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    // Save enrichment data
    saveEnrichment.run(
      meta.symbol ?? null,
      meta.name ?? null,
      meta.decimals ?? null,
      auth.authorities_revoked ?? null,
      liq.lp_exists ?? null,
      liq.liquidity_usd ?? null,
      nowIso,
      token.mint
    );

    console.log(`✅ enriched ${token.mint} ${meta.symbol || ''} liq=$${liq.liquidity_usd ?? 'n/a'} revoked=${auth.authorities_revoked}`);
  } catch (error) {
    const errorCode = error.message.slice(0, 120); // Truncate to 120 chars
    console.error(`❌ enrich failed ${token.mint}:`, errorCode);
    saveError.run(nowIso, errorCode, token.mint);
  }
}

async function mainLoop() {
  const batch = pickBatch.all();
  if (!batch.length) {
    console.log('⏸ no tokens need enrichment');
    return;
  }

  console.log(`🔄 Processing ${batch.length} tokens for enrichment`);
  
  for (const token of batch) {
    await enrichOne(token);
    // Small delay to be polite to APIs
    await sleep(300);
  }
}

mainLoop().then(() => process.exit(0));