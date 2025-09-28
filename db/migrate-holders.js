// db/migrate-holders.js - Migration for enhanced holders functionality
const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

console.log('🔄 Migrating holders table for enhanced functionality...');

try {
  // Add new columns to holders table
  db.exec(`
    ALTER TABLE holders ADD COLUMN wallet_age_days INTEGER;
  `);
  console.log('✅ Added wallet_age_days column');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ wallet_age_days column already exists');
  } else {
    console.log('⚠️  Error adding wallet_age_days column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE holders ADD COLUMN is_inception INTEGER DEFAULT 0;
  `);
  console.log('✅ Added is_inception column');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ is_inception column already exists');
  } else {
    console.log('⚠️  Error adding is_inception column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE holders ADD COLUMN is_sniper INTEGER DEFAULT 0;
  `);
  console.log('✅ Added is_sniper column');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ is_sniper column already exists');
  } else {
    console.log('⚠️  Error adding is_sniper column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE holders ADD COLUMN is_bundler INTEGER DEFAULT 0;
  `);
  console.log('✅ Added is_bundler column');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ is_bundler column already exists');
  } else {
    console.log('⚠️  Error adding is_bundler column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE holders ADD COLUMN is_insider INTEGER DEFAULT 0;
  `);
  console.log('✅ Added is_insider column');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ is_insider column already exists');
  } else {
    console.log('⚠️  Error adding is_insider column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE holders ADD COLUMN first_seen_at TEXT;
  `);
  console.log('✅ Added first_seen_at column');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ first_seen_at column already exists');
  } else {
    console.log('⚠️  Error adding first_seen_at column:', error.message);
  }
}

try {
  // Create holders_history table
  db.exec(`
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
  `);
  console.log('✅ Created holders_history table');
} catch (error) {
  console.log('⚠️  Error creating holders_history table:', error.message);
}

try {
  // Add indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_holders_wallet_type
    ON holders (mint, is_inception, is_sniper, is_bundler, is_insider);
  `);
  console.log('✅ Added wallet type index');
} catch (error) {
  console.log('⚠️  Error creating wallet type index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_holders_history_mint_time
    ON holders_history (mint, snapshot_time);
  `);
  console.log('✅ Added holders_history mint_time index');
} catch (error) {
  console.log('⚠️  Error creating holders_history mint_time index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_holders_history_health_score
    ON holders_history (health_score DESC);
  `);
  console.log('✅ Added holders_history health_score index');
} catch (error) {
  console.log('⚠️  Error creating holders_history health_score index:', error.message);
}

console.log('🎉 Holders migration completed!');
console.log('🔍 Enhanced functionality added:');
console.log('   - Wallet classification (inception, sniper, bundler, insider)');
console.log('   - Wallet age tracking');
console.log('   - Time series snapshots');
console.log('   - Health scoring system');
