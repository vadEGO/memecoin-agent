const fetch = require('node-fetch');
const Database = require('better-sqlite3');
const db = new Database('db/agent.db');
const HELIUS_KEY = process.env.HELIUS_API_KEY || '';
const BIRDEYE_KEY = process.env.BIRDEYE_API_KEY || ''; // optional

function nextUnvetted(limit=20){
  return db.prepare(`
    SELECT mint FROM tokens
    WHERE (authorities_revoked IS NULL OR lp_exists IS NULL OR liquidity_usd IS NULL)
    ORDER BY first_seen_at DESC
    LIMIT ?
  `).all(limit);
}

const upd = db.prepare(`
  UPDATE tokens SET
    authorities_revoked = COALESCE(@authorities_revoked, authorities_revoked),
    lp_exists = COALESCE(@lp_exists, lp_exists),
    lp_burned = COALESCE(@lp_burned, lp_burned),
    liquidity_usd = COALESCE(@liquidity_usd, liquidity_usd),
    last_updated_at = @now
  WHERE mint = @mint
`);

async function heliusMintInfo(mint){
  if(!HELIUS_KEY) {
    console.log('⚠️  No HELIUS_API_KEY, skipping authority check');
    return {};
  }
  const url = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
  const body = {
    jsonrpc:"2.0", id:"1", method:"getAsset", params:{ id: mint }
  };
  try {
    const r = await fetch(url,{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    const j = await r.json();
    const asset = j?.result || {};
    const mintAuth = asset?.authority || null;
    const freezeAuth = asset?.freezeAuthority || null;
    return { mintAuth, freezeAuth };
  } catch (e) {
    console.log(`⚠️  Helius API error for ${mint}:`, e.message);
    return {};
  }
}

async function birdeyeLiquidity(mint){
  if(!BIRDEYE_KEY) {
    console.log('⚠️  No BIRDEYE_API_KEY, skipping liquidity check');
    return {};
  }
  try {
    const r = await fetch(`https://public-api.birdeye.so/defi/txns/token_overview?address=${mint}`, {
      headers: { 'X-API-KEY': BIRDEYE_KEY, 'x-chain':'solana' }
    });
    if(!r.ok) return {};
    const j = await r.json();
    const liquidity_usd = j?.data?.liquidity || null;
    return { liquidity_usd, lp_exists: liquidity_usd ? 1 : 0 };
  } catch (e) {
    console.log(`⚠️  Birdeye API error for ${mint}:`, e.message);
    return {};
  }
}

async function vetMint(mint){
  const now = new Date().toISOString();

  // 1) Authorities
  let authorities_revoked = null;
  try {
    const { mintAuth, freezeAuth } = await heliusMintInfo(mint);
    if (mintAuth !== undefined || freezeAuth !== undefined){
      authorities_revoked = (mintAuth == null && freezeAuth == null) ? 1 : 0;
    }
  } catch (e) {
    console.log(`⚠️  Authority check failed for ${mint}:`, e.message);
  }

  // 2) Liquidity snapshot (simple pass; refine later per DEX)
  let lp_exists = null, lp_burned = null, liquidity_usd = null;
  try {
    const liq = await birdeyeLiquidity(mint);
    if (liq.liquidity_usd != null){
      liquidity_usd = liq.liquidity_usd;
      lp_exists = liq.lp_exists ?? (liquidity_usd > 0 ? 1 : 0);
      // lp_burned needs DEX-specific check; leave null for now
    }
  } catch (e) {
    console.log(`⚠️  Liquidity check failed for ${mint}:`, e.message);
  }

  upd.run({ mint, authorities_revoked, lp_exists, lp_burned, liquidity_usd, now });
  console.log(`✓ Vetted ${mint}: auth=${authorities_revoked} lp=${lp_exists} $liq=${liquidity_usd ?? 'n/a'}`);
}

(async () => {
  const mints = nextUnvetted(25);
  console.log(`🔍 Found ${mints.length} unvetted tokens`);
  
  if (mints.length === 0) {
    console.log('✅ All tokens are already vetted!');
    return;
  }
  
  for (const { mint } of mints) {
    await vetMint(mint);
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.log('✅ Vetting complete');
})();
