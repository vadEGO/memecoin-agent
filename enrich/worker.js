// enrich/worker.js - Enhanced token enrichment with batching, rate limiting, and error handling
require('dotenv').config();
const Database = require('better-sqlite3');
const { fetchJson, sleep } = require('../lib/http');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const DEXSCREENER_BASE = process.env.DEXSCREENER_BASE || 'https://api.dexscreener.com';

// --- Enhanced Queries ---
// HOT: < 60 minutes old, never enriched or missing liq/holders
const pickHotBatch = db.prepare(`
  SELECT mint, symbol, name, decimals, authorities_revoked, lp_exists, liquidity_usd,
         first_seen_at, last_enriched_at, enrich_attempts
  FROM tokens
  WHERE datetime(first_seen_at) > datetime('now','-60 minutes')
    AND (liquidity_usd IS NULL OR holders_count IS NULL)
    AND (enrich_attempts IS NULL OR enrich_attempts < 10)
    AND (last_enriched_at IS NULL OR datetime(last_enriched_at) <= datetime('now','-2 minutes'))
  ORDER BY datetime(first_seen_at) DESC
  LIMIT 200
`);

// WARM: ≤ 7 days, still missing any class % or liq
const pickWarmBatch = db.prepare(`
  SELECT mint, symbol, name, decimals, authorities_revoked, lp_exists, liquidity_usd,
         first_seen_at, last_enriched_at, enrich_attempts
  FROM tokens
  WHERE datetime(first_seen_at) > datetime('now','-7 days')
    AND (fresh_pct IS NULL OR sniper_pct IS NULL OR insider_pct IS NULL OR liquidity_usd IS NULL)
    AND (enrich_attempts IS NULL OR enrich_attempts < 12)
    AND (last_enriched_at IS NULL OR datetime(last_enriched_at) <= datetime('now','-10 minutes'))
  ORDER BY datetime(first_seen_at) DESC
  LIMIT 500
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
    logger.warning('enrichment', null, 'metadata', 'Skipping Helius metadata (no API key)');
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
        logger.warning('enrichment', null, 'metadata', `Empty metadata response for batch of ${batch.length} mints`);
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
      logger.error('enrichment', null, 'metadata', `Helius metadata batch failed: ${error.message}`, { batchSize: batch.length });
      throw new Error(`HELIUS_META_${error.message}`);
    }
  }
  
  return out;
}

async function fetchAuthoritiesRevoked(mint) {
  if (!HELIUS_API_KEY || HELIUS_API_KEY === 'your_helius_key') {
    logger.warning('enrichment', mint, 'authorities', 'Skipping authorities check (no API key)');
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
    logger.error('enrichment', mint, 'authorities', `RPC authorities check failed: ${error.message}`);
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
      return { lp_exists: 0, liquidity_usd: 0, liq_status: 'no_pair' };
    }

    let maxUsd = 0;
    for (const p of pairs) {
      const liqUsd = Number(p?.liquidity?.usd ?? 0);
      if (liqUsd > maxUsd) maxUsd = liqUsd;
    }

    return { 
      lp_exists: maxUsd > 0 ? 1 : 0, 
      liquidity_usd: maxUsd, // Always persist, even if 0
      liq_status: 'ok'
    };
  } catch (error) {
    logger.error('enrichment', mint, 'liquidity', `DexScreener liquidity check failed: ${error.message}`);
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

    logger.success('enrichment', token.mint, 'complete', `Enriched successfully`, {
      symbol: meta.symbol || '',
      liquidity_usd: liq.liquidity_usd,
      authorities_revoked: auth.authorities_revoked
    });
  } catch (error) {
    const errorCode = error.message.slice(0, 120); // Truncate to 120 chars
    logger.error('enrichment', token.mint, 'failed', `Enrichment failed: ${errorCode}`);
    saveError.run(nowIso, errorCode, token.mint);
  }
}

async function mainLoop() {
  // Try HOT batch first (most recent tokens)
  let batch = pickHotBatch.all();
  let batchType = 'HOT';
  
  // If no HOT tokens, try WARM batch
  if (batch.length === 0) {
    batch = pickWarmBatch.all();
    batchType = 'WARM';
  }
  
  if (!batch.length) {
    logger.info('enrichment', null, 'batch', 'No tokens need enrichment');
    return;
  }

  logger.info('enrichment', null, 'batch', `Processing ${batch.length} ${batchType} tokens for enrichment`, { 
    batchSize: batch.length,
    batchType: batchType
  });
  
  for (const token of batch) {
    await enrichOne(token);
    // Small delay to be polite to APIs
    await sleep(300);
  }
}

mainLoop().then(() => process.exit(0));