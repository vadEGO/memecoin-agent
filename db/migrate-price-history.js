const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

console.log('🔄 Migrating database for Task 10: Price Feeds & Backtests...');

try {
  // Create price_history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      price_usd REAL,
      price_sol REAL,
      liquidity_usd REAL,
      source TEXT NOT NULL,
      pair_id TEXT,
      granularity TEXT NOT NULL,
      status TEXT DEFAULT 'live',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(mint, timestamp, granularity)
    );
  `);
  console.log('✅ Created price_history table');
} catch (error) {
  console.log('⚠️  Error creating price_history table:', error.message);
}

try {
  // Create return_labels table for backtest targets
  db.exec(`
    CREATE TABLE IF NOT EXISTS return_labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT NOT NULL,
      anchor_timestamp TEXT NOT NULL,
      price_30m REAL,
      price_6h REAL,
      price_24h REAL,
      ret_6h REAL,
      ret_24h REAL,
      winner_50 INTEGER DEFAULT 0,
      winner_100 INTEGER DEFAULT 0,
      loser_50 INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(mint, anchor_timestamp)
    );
  `);
  console.log('✅ Created return_labels table');
} catch (error) {
  console.log('⚠️  Error creating return_labels table:', error.message);
}

try {
  // Create backtest_results table for threshold tuning
  db.exec(`
    CREATE TABLE IF NOT EXISTS backtest_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ruleset_id TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      threshold_health_min REAL,
      threshold_health_max REAL,
      threshold_fresh_pct_min REAL,
      threshold_sniper_pct_max REAL,
      threshold_insider_pct_max REAL,
      threshold_top10_share_max REAL,
      threshold_liquidity_min REAL,
      threshold_holders_min INTEGER,
      precision_50 REAL,
      precision_100 REAL,
      lift_50 REAL,
      lift_100 REAL,
      volume_per_day REAL,
      sample_size INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('✅ Created backtest_results table');
} catch (error) {
  console.log('⚠️  Error creating backtest_results table:', error.message);
}

try {
  // Add indexes for performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_price_history_mint_timestamp
    ON price_history (mint, timestamp DESC);
    
    CREATE INDEX IF NOT EXISTS idx_price_history_granularity
    ON price_history (granularity);
    
    CREATE INDEX IF NOT EXISTS idx_return_labels_mint_timestamp
    ON return_labels (mint, anchor_timestamp DESC);
    
    CREATE INDEX IF NOT EXISTS idx_backtest_results_ruleset
    ON backtest_results (ruleset_id, alert_type);
  `);
  console.log('✅ Added performance indexes');
} catch (error) {
  console.log('⚠️  Error adding indexes:', error.message);
}

console.log('🎉 Task 10 Price Feeds migration completed!');
console.log('🔍 Added functionality:');
console.log('   - Price history tracking with multiple granularities');
console.log('   - Return labels for backtest targets');
console.log('   - Backtest results storage for threshold tuning');
console.log('   - Performance indexes for fast queries');
