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
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_token_events_mint_time
ON token_events (mint, received_at);
`);

console.log('✅ DB schema ready at db/agent.db');
