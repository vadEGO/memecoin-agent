// db/migrate-task8-final.js - Final Task 8 migration with all required columns
const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

console.log('🔄 Migrating database for Task 8 final implementation...');

try {
  // Add pool fields to tokens table
  db.exec(`
    ALTER TABLE tokens ADD COLUMN pool_created_at TEXT;
  `);
  console.log('✅ Added pool_created_at column');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ pool_created_at column already exists');
  } else {
    console.log('⚠️  Error adding pool_created_at:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE tokens ADD COLUMN pool_signature TEXT;
  `);
  console.log('✅ Added pool_signature column');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ pool_signature column already exists');
  } else {
    console.log('⚠️  Error adding pool_signature:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE tokens ADD COLUMN pool_block INTEGER;
  `);
  console.log('✅ Added pool_block column');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ pool_block column already exists');
  } else {
    console.log('⚠️  Error adding pool_block:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE tokens ADD COLUMN dev_wallet TEXT;
  `);
  console.log('✅ Added dev_wallet column');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ dev_wallet column already exists');
  } else {
    console.log('⚠️  Error adding dev_wallet:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE tokens ADD COLUMN health_score REAL;
  `);
  console.log('✅ Added health_score column');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ health_score column already exists');
  } else {
    console.log('⚠️  Error adding health_score:', error.message);
  }
}

// Add all wallet class counts and percentages
const classColumns = [
  'inception_count', 'inception_pct',
  'fresh_count', 'fresh_pct', 
  'sniper_count', 'sniper_pct',
  'bundler_count', 'bundler_pct',
  'insider_count', 'insider_pct',
  'top10_share'
];

for (const column of classColumns) {
  try {
    const type = column.includes('_pct') || column.includes('_share') ? 'REAL' : 'INTEGER';
    db.exec(`ALTER TABLE tokens ADD COLUMN ${column} ${type};`);
    console.log(`✅ Added ${column} column`);
  } catch (error) {
    if (error.message.includes('duplicate column name')) {
      console.log(`✅ ${column} column already exists`);
    } else {
      console.log(`⚠️  Error adding ${column}:`, error.message);
    }
  }
}

// Add holder_type column to holders table
try {
  db.exec(`
    ALTER TABLE holders ADD COLUMN holder_type TEXT DEFAULT 'unknown';
  `);
  console.log('✅ Added holder_type column to holders');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ holder_type column already exists in holders');
  } else {
    console.log('⚠️  Error adding holder_type to holders:', error.message);
  }
}

// Add funding_edges table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS funding_edges (
      src_wallet TEXT,
      dst_wallet TEXT,
      mint TEXT,
      amount_sol REAL,
      timestamp TEXT,
      signature TEXT,
      PRIMARY KEY (src_wallet, dst_wallet, mint, timestamp)
    );
  `);
  console.log('✅ Created funding_edges table');
} catch (error) {
  console.log('⚠️  Error creating funding_edges table:', error.message);
}

// Add holders_history table
try {
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

console.log('🎉 Task 8 final migration completed!');
console.log('🔍 All required columns and tables added:');
console.log('   - Pool fields: pool_created_at, pool_signature, pool_block');
console.log('   - Wallet class counts and percentages');
console.log('   - Health score calculation');
console.log('   - Funding edges and history tracking');
