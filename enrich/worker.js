// enrich/worker.js
require('dotenv').config();
const Database = require('better-sqlite3');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const DEXSCREENER_BASE = process.env.DEXSCREENER_BASE || 'https://api.dexscreener.com';

// --- Queries ---
const pickBatch = db.prepare(`
  SELECT mint, symbol, name, decimals, authorities_revoked, lp_exists, liquidity_usd
  FROM tokens
  WHERE (authorities_revoked IS NULL OR lp_exists IS NULL OR liquidity_usd IS NULL
         OR symbol IS NULL OR name IS NULL OR decimals IS NULL)
  ORDER BY COALESCE(last_enriched_at, '1970-01-01') ASC
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

// --- API helpers ---
async function fetchTokenMetadataHelius(mints) {
  if (!HELIUS_API_KEY || HELIUS_API_KEY === 'your_helius_key') {
    console.log('⚠️  Skipping Helius metadata (no API key)');
    return {};
  }
  const { default: fetch } = await import('node-fetch');
  const url = `https://api.helius.xyz/v0/token-metadata?api-key=${HELIUS_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mintAccounts: mints })
  });
  if (!res.ok) throw new Error(`Helius metadata ${res.status}`);
  const arr = await res.json(); // [{account, onChainData:{metadata}, offChainData...}, ...]
  const out = {};
  for (const item of arr) {
    const acc = item?.account;
    const md = item?.onChainData || {};
    const sym = md?.symbol || item?.tokenInfo?.symbol || null;
    const name = md?.name || item?.tokenInfo?.name || null;
    const dec = item?.tokenInfo?.decimals ?? null;
    out[acc] = { symbol: sym || null, name: name || null, decimals: Number.isFinite(dec) ? dec : null };
  }
  return out;
}

async function fetchAuthoritiesRevoked(mint) {
  // Read the SPL mint account via JSON-RPC and parse authorities
  if (!HELIUS_API_KEY || HELIUS_API_KEY === 'your_helius_key') {
    console.log('⚠️  Skipping authorities check (no API key)');
    return null;
  }
  const { default: fetch } = await import('node-fetch');
  const rpc = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAccountInfo',
      params: [mint, { encoding: 'jsonParsed' }]
    })
  });
  if (!res.ok) throw new Error(`getAccountInfo ${res.status}`);
  const j = await res.json();
  const parsed = j?.result?.value?.data?.parsed;
  const info = parsed?.info || {};
  // If both authorities are null -> revoked
  const mintAuth = info?.mintAuthority ?? null;
  const freezeAuth = info?.freezeAuthority ?? null;
  return (mintAuth === null && freezeAuth === null) ? 1 : 0;
}

async function fetchLiquidityDexScreener(mint) {
  // DexScreener returns pairs; take max liquidityUSD across pairs
  const { default: fetch } = await import('node-fetch');
  const url = `${DEXSCREENER_BASE}/latest/dex/tokens/${mint}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DexScreener ${res.status}`);
  const j = await res.json();
  const pairs = j?.pairs || [];
  if (!pairs.length) return { lp_exists: 0, liquidity_usd: null };
  let best = 0;
  for (const p of pairs) {
    const liqUsd = Number(p?.liquidity?.usd ?? 0);
    if (liqUsd > best) best = liqUsd;
  }
  return { lp_exists: best > 0 ? 1 : 0, liquidity_usd: best || null };
}

// --- Orchestrator ---
async function enrichOne(token) {
  const nowIso = new Date().toISOString();
  markStart.run(token.mint);

  try {
    // Parallelize; then merge results
    const [metaMap, revoked, liq] = await Promise.all([
      fetchTokenMetadataHelius([token.mint]),
      fetchAuthoritiesRevoked(token.mint),
      fetchLiquidityDexScreener(token.mint),
    ]);

    const meta = metaMap[token.mint] || {};
    saveEnrichment.run(
      meta.symbol ?? null,
      meta.name ?? null,
      meta.decimals ?? null,
      Number.isInteger(revoked) ? revoked : null,
      liq.lp_exists ?? null,
      liq.liquidity_usd ?? null,
      nowIso,
      token.mint
    );
    console.log(`✅ enriched ${token.mint} ${meta.symbol || ''} liq=$${liq.liquidity_usd ?? 'n/a'} revoked=${revoked}`);
  } catch (e) {
    console.error(`❌ enrich failed ${token.mint}`, e.message);
    saveError.run(nowIso, String(e.message).slice(0, 500), token.mint);
  }
}

async function mainLoop() {
  const batch = pickBatch.all();
  if (!batch.length) {
    console.log('⏸ no tokens need enrichment');
    return;
  }
  for (const t of batch) {
    // small delay to be polite to APIs
    // eslint-disable-next-line no-await-in-loop
    await enrichOne(t);
    await new Promise(r => setTimeout(r, 300));
  }
}

mainLoop().then(() => process.exit(0));
