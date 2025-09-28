const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

db.pragma('journal_mode = WAL');

// Core token registry
db.exec(`
CREATE TABLE IF NOT EXISTS tokens (
  mint TEXT PRIMARY KEY,
  symbol TEXT,
  name TEXT,
  decimals INTEGER,
  creator TEXT,
  launch_tx TEXT,
  source TEXT,
  first_seen_at TEXT,
  authorities_revoked INTEGER DEFAULT 0,
  lp_exists INTEGER DEFAULT 0,
  lp_burned INTEGER DEFAULT 0,
  liquidity_usd REAL,
  holders_count INTEGER,
  fresh_wallets_count INTEGER,
  last_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS token_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT,
  type TEXT,
  source TEXT,
  received_at TEXT,
  raw_json TEXT,
  signature TEXT,
  UNIQUE(mint, type, received_at),
  UNIQUE(signature, type)
);

CREATE TABLE IF NOT EXISTS holders (
  mint TEXT,
  owner TEXT,
  amount TEXT,
  last_seen_at TEXT,
  wallet_age_days INTEGER,
  is_inception INTEGER DEFAULT 0,
  is_sniper INTEGER DEFAULT 0,
  is_bundler INTEGER DEFAULT 0,
  is_insider INTEGER DEFAULT 0,
  first_seen_at TEXT,
  PRIMARY KEY (mint, owner)
);

CREATE TABLE IF NOT EXISTS holders_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT,
  snapshot_time TEXT,
  holders_count INTEGER,
  fresh_wallets_count INTEGER,
  inception_count INTEGER,
  sniper_count INTEGER,
  bundler_count INTEGER,
  insider_count INTEGER,
  fresh_ratio REAL,
  top10_share REAL,
  sniper_ratio REAL,
  health_score INTEGER,
  UNIQUE(mint, snapshot_time)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_token_events_mint_time
ON token_events (mint, received_at);

CREATE INDEX IF NOT EXISTS idx_token_events_signature
ON token_events (signature);

CREATE INDEX IF NOT EXISTS idx_token_events_type
ON token_events (type);

CREATE INDEX IF NOT EXISTS idx_token_events_source
ON token_events (source);

CREATE INDEX IF NOT EXISTS idx_holders_mint
ON holders (mint);

CREATE INDEX IF NOT EXISTS idx_holders_owner
ON holders (owner);

CREATE INDEX IF NOT EXISTS idx_holders_wallet_type
ON holders (mint, is_inception, is_sniper, is_bundler, is_insider);

CREATE INDEX IF NOT EXISTS idx_holders_history_mint_time
ON holders_history (mint, snapshot_time);

CREATE INDEX IF NOT EXISTS idx_holders_history_health_score
ON holders_history (health_score DESC);
`);

console.log('✅ DB schema ready at db/agent.db');
console.log('🔍 Added deduplication indexes:');
console.log('   - UNIQUE(mint, type, received_at)');
console.log('   - UNIQUE(signature, type)');
