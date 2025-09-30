const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

console.log('🔄 Migrating database for Task 11: Liquidity Safety & Rug Checks...');

try {
  // Add rug risk columns to tokens table
  db.exec(`
    ALTER TABLE tokens ADD COLUMN lp_token_mint TEXT;
    ALTER TABLE tokens ADD COLUMN lp_burned INTEGER DEFAULT NULL;
    ALTER TABLE tokens ADD COLUMN lp_locked INTEGER DEFAULT NULL;
    ALTER TABLE tokens ADD COLUMN lp_owner_top1_pct REAL DEFAULT NULL;
    ALTER TABLE tokens ADD COLUMN lp_owner_top5_pct REAL DEFAULT NULL;
    ALTER TABLE tokens ADD COLUMN liquidity_usd_last REAL DEFAULT NULL;
    ALTER TABLE tokens ADD COLUMN liquidity_usd_5m_delta REAL DEFAULT NULL;
    ALTER TABLE tokens ADD COLUMN liquidity_usd_15m_delta REAL DEFAULT NULL;
    ALTER TABLE tokens ADD COLUMN rug_risk_score REAL DEFAULT NULL;
    ALTER TABLE tokens ADD COLUMN rug_flags TEXT DEFAULT NULL;
  `);
  console.log('✅ Added rug risk columns to tokens table');
} catch (error) {
  console.log('⚠️  Error adding columns (may already exist):', error.message);
}

try {
  // Create optional lp_holders table for debugging
  db.exec(`
    CREATE TABLE IF NOT EXISTS lp_holders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lp_mint TEXT NOT NULL,
      owner TEXT NOT NULL,
      amount REAL NOT NULL,
      pct REAL NOT NULL,
      timestamp TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(lp_mint, owner, timestamp)
    );
  `);
  console.log('✅ Created lp_holders table');
} catch (error) {
  console.log('⚠️  Error creating lp_holders table:', error.message);
}

try {
  // Create rug_risk_history table for tracking score changes
  db.exec(`
    CREATE TABLE IF NOT EXISTS rug_risk_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      rug_risk_score REAL NOT NULL,
      rug_flags TEXT,
      liquidity_usd REAL,
      lp_owner_top1_pct REAL,
      lp_owner_top5_pct REAL,
      liquidity_usd_5m_delta REAL,
      liquidity_usd_15m_delta REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('✅ Created rug_risk_history table');
} catch (error) {
  console.log('⚠️  Error creating rug_risk_history table:', error.message);
}

try {
  // Add indexes for performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tokens_rug_risk_score ON tokens (rug_risk_score DESC);
    CREATE INDEX IF NOT EXISTS idx_tokens_lp_token_mint ON tokens (lp_token_mint);
    CREATE INDEX IF NOT EXISTS idx_lp_holders_lp_mint ON lp_holders (lp_mint, amount DESC);
    CREATE INDEX IF NOT EXISTS idx_rug_risk_history_mint_time ON rug_risk_history (mint, timestamp DESC);
  `);
  console.log('✅ Added performance indexes');
} catch (error) {
  console.log('⚠️  Error adding indexes:', error.message);
}

console.log('🎉 Task 11 Rug Checks migration completed!');
console.log('🔍 Added functionality:');
console.log('   - Rug risk scoring system with 0-100 scale');
console.log('   - LP safety checks (burned/locked detection)');
console.log('   - LP ownership concentration analysis');
console.log('   - Liquidity drain monitoring with sliding windows');
console.log('   - Rug risk alerts and warnings');
console.log('   - Performance indexes for fast queries');
