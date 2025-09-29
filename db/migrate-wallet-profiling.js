// db/migrate-wallet-profiling.js - Migration for Task 8: Wallet Profiling v1
const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

console.log('🔄 Migrating database for Task 8: Wallet Profiling v1...');

try {
  // Add new columns to tokens table
  db.exec(`
    ALTER TABLE tokens ADD COLUMN sniper_count INTEGER DEFAULT 0;
  `);
  console.log('✅ Added sniper_count column to tokens');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ sniper_count column already exists');
  } else {
    console.log('⚠️  Error adding sniper_count column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE tokens ADD COLUMN bundler_count INTEGER DEFAULT 0;
  `);
  console.log('✅ Added bundler_count column to tokens');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ bundler_count column already exists');
  } else {
    console.log('⚠️  Error adding bundler_count column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE tokens ADD COLUMN insider_count INTEGER DEFAULT 0;
  `);
  console.log('✅ Added insider_count column to tokens');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ insider_count column already exists');
  } else {
    console.log('⚠️  Error adding insider_count column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE tokens ADD COLUMN health_score REAL DEFAULT 0;
  `);
  console.log('✅ Added health_score column to tokens');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ health_score column already exists');
  } else {
    console.log('⚠️  Error adding health_score column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE tokens ADD COLUMN pool_created_at TEXT;
  `);
  console.log('✅ Added pool_created_at column to tokens');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ pool_created_at column already exists');
  } else {
    console.log('⚠️  Error adding pool_created_at column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE tokens ADD COLUMN pool_signature TEXT;
  `);
  console.log('✅ Added pool_signature column to tokens');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ pool_signature column already exists');
  } else {
    console.log('⚠️  Error adding pool_signature column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE tokens ADD COLUMN dev_wallet TEXT;
  `);
  console.log('✅ Added dev_wallet column to tokens');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ dev_wallet column already exists');
  } else {
    console.log('⚠️  Error adding dev_wallet column:', error.message);
  }
}

try {
  // Add new columns to holders table
  db.exec(`
    ALTER TABLE holders ADD COLUMN holder_type TEXT DEFAULT 'unknown';
  `);
  console.log('✅ Added holder_type column to holders');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ holder_type column already exists');
  } else {
    console.log('⚠️  Error adding holder_type column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE holders ADD COLUMN funded_by TEXT;
  `);
  console.log('✅ Added funded_by column to holders');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ funded_by column already exists');
  } else {
    console.log('⚠️  Error adding funded_by column:', error.message);
  }
}

try {
  // Create funding_edges table for graph analysis
  db.exec(`
    CREATE TABLE IF NOT EXISTS funding_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      src_wallet TEXT NOT NULL,
      dst_wallet TEXT NOT NULL,
      amount_sol REAL,
      timestamp TEXT,
      signature TEXT,
      UNIQUE(src_wallet, dst_wallet, signature)
    );
  `);
  console.log('✅ Created funding_edges table');
} catch (error) {
  console.log('⚠️  Error creating funding_edges table:', error.message);
}

try {
  // Add indexes for performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_funding_edges_src
    ON funding_edges (src_wallet);
  `);
  console.log('✅ Added funding_edges src index');
} catch (error) {
  console.log('⚠️  Error creating funding_edges src index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_funding_edges_dst
    ON funding_edges (dst_wallet);
  `);
  console.log('✅ Added funding_edges dst index');
} catch (error) {
  console.log('⚠️  Error creating funding_edges dst index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_funding_edges_timestamp
    ON funding_edges (timestamp);
  `);
  console.log('✅ Added funding_edges timestamp index');
} catch (error) {
  console.log('⚠️  Error creating funding_edges timestamp index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tokens_health_score
    ON tokens (health_score DESC);
  `);
  console.log('✅ Added tokens health_score index');
} catch (error) {
  console.log('⚠️  Error creating tokens health_score index:', error.message);
}

console.log('🎉 Wallet Profiling migration completed!');
console.log('🔍 Enhanced functionality added:');
console.log('   - Sniper, Bundler, Insider detection');
console.log('   - Health scoring system');
console.log('   - Pool creation tracking');
console.log('   - Funding graph analysis');
console.log('   - Wallet classification system');
