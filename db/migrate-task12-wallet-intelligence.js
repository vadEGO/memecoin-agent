const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

console.log('🔄 Migrating database schema for Task 12 - Wallet Network Intelligence...');

try {
  // Create funding_edges table for direct SOL sends
  db.exec(`
    CREATE TABLE IF NOT EXISTS funding_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      src TEXT NOT NULL,
      dst TEXT NOT NULL,
      ts TEXT NOT NULL,
      amount_lamports INTEGER NOT NULL,
      signature TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(src, dst, ts, signature)
    );
  `);
  console.log('✅ Created funding_edges table');
} catch (error) {
  console.log('⚠️  Error creating funding_edges table:', error.message);
}

try {
  // Create buy_events table for any buy transactions
  db.exec(`
    CREATE TABLE IF NOT EXISTS buy_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      mint TEXT NOT NULL,
      ts TEXT NOT NULL,
      method TEXT,
      is_sniper INTEGER DEFAULT 0,
      amount_lamports INTEGER,
      signature TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(wallet, mint, ts, signature)
    );
  `);
  console.log('✅ Created buy_events table');
} catch (error) {
  console.log('⚠️  Error creating buy_events table:', error.message);
}

try {
  // Create bundle_events table from bundler detector
  db.exec(`
    CREATE TABLE IF NOT EXISTS bundle_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bundler TEXT NOT NULL,
      recipient TEXT NOT NULL,
      mint TEXT NOT NULL,
      ts TEXT NOT NULL,
      signature TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(bundler, recipient, mint, ts, signature)
    );
  `);
  console.log('✅ Created bundle_events table');
} catch (error) {
  console.log('⚠️  Error creating bundle_events table:', error.message);
}

try {
  // Create insider_events table from insider heuristic
  db.exec(`
    CREATE TABLE IF NOT EXISTS insider_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      mint TEXT NOT NULL,
      ts TEXT NOT NULL,
      reason_flags TEXT,
      signature TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(wallet, mint, ts, signature)
    );
  `);
  console.log('✅ Created insider_events table');
} catch (error) {
  console.log('⚠️  Error creating insider_events table:', error.message);
}

try {
  // Create wallet_reputation table
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_reputation (
      wallet TEXT PRIMARY KEY,
      snipes_total INTEGER DEFAULT 0,
      snipes_success INTEGER DEFAULT 0,
      bundles_total INTEGER DEFAULT 0,
      recipients_total INTEGER DEFAULT 0,
      insider_hits INTEGER DEFAULT 0,
      rug_involved INTEGER DEFAULT 0,
      last_seen_at TEXT,
      reputation_score REAL DEFAULT 0,
      score_breakdown TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('✅ Created wallet_reputation table');
} catch (error) {
  console.log('⚠️  Error creating wallet_reputation table:', error.message);
}

try {
  // Create wallet_tags table for market maker whitelisting
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_tags (
      wallet TEXT,
      tag TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (wallet, tag)
    );
  `);
  console.log('✅ Created wallet_tags table');
} catch (error) {
  console.log('⚠️  Error creating wallet_tags table:', error.message);
}

try {
  // Add bad actor fields to tokens table
  db.exec(`
    ALTER TABLE tokens ADD COLUMN sniper_bad_count INTEGER DEFAULT 0;
  `);
  console.log('✅ Added sniper_bad_count column to tokens');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ sniper_bad_count column already exists');
  } else {
    console.log('⚠️  Error adding sniper_bad_count column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE tokens ADD COLUMN bundler_bad_count INTEGER DEFAULT 0;
  `);
  console.log('✅ Added bundler_bad_count column to tokens');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ bundler_bad_count column already exists');
  } else {
    console.log('⚠️  Error adding bundler_bad_count column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE tokens ADD COLUMN insider_bad_count INTEGER DEFAULT 0;
  `);
  console.log('✅ Added insider_bad_count column to tokens');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ insider_bad_count column already exists');
  } else {
    console.log('⚠️  Error adding insider_bad_count column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE tokens ADD COLUMN bad_actor_score INTEGER DEFAULT 0;
  `);
  console.log('✅ Added bad_actor_score column to tokens');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ bad_actor_score column already exists');
  } else {
    console.log('⚠️  Error adding bad_actor_score column:', error.message);
  }
}

// Create performance indexes
try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_funding_edges_src_dst_ts
    ON funding_edges (src, dst, ts);
  `);
  console.log('✅ Added funding_edges index');
} catch (error) {
  console.log('⚠️  Error creating funding_edges index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_funding_edges_dst_ts
    ON funding_edges (dst, ts);
  `);
  console.log('✅ Added funding_edges dst index');
} catch (error) {
  console.log('⚠️  Error creating funding_edges dst index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_buy_events_wallet_ts
    ON buy_events (wallet, ts);
  `);
  console.log('✅ Added buy_events wallet index');
} catch (error) {
  console.log('⚠️  Error creating buy_events index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_buy_events_mint_ts
    ON buy_events (mint, ts);
  `);
  console.log('✅ Added buy_events mint index');
} catch (error) {
  console.log('⚠️  Error creating buy_events mint index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_bundle_events_bundler_ts
    ON bundle_events (bundler, ts);
  `);
  console.log('✅ Added bundle_events index');
} catch (error) {
  console.log('⚠️  Error creating bundle_events index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_insider_events_wallet_ts
    ON insider_events (wallet, ts);
  `);
  console.log('✅ Added insider_events index');
} catch (error) {
  console.log('⚠️  Error creating insider_events index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_wallet_reputation_score
    ON wallet_reputation (reputation_score DESC);
  `);
  console.log('✅ Added wallet_reputation score index');
} catch (error) {
  console.log('⚠️  Error creating wallet_reputation index:', error.message);
}

console.log('🎉 Task 12 database migration completed!');
console.log('🔍 Added tables:');
console.log('   - funding_edges (SOL sends)');
console.log('   - buy_events (token purchases)');
console.log('   - bundle_events (bundler activity)');
console.log('   - insider_events (insider activity)');
console.log('   - wallet_reputation (reputation scoring)');
console.log('   - wallet_tags (market maker whitelist)');
console.log('🔍 Added token fields:');
console.log('   - sniper_bad_count, bundler_bad_count, insider_bad_count');
console.log('   - bad_actor_score');
