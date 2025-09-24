const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

console.log('🔄 Migrating database schema...');

try {
  // Add signature column if it doesn't exist
  db.exec(`
    ALTER TABLE token_events ADD COLUMN signature TEXT;
  `);
  console.log('✅ Added signature column');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ Signature column already exists');
  } else {
    console.log('⚠️  Error adding signature column:', error.message);
  }
}

try {
  // Create new indexes for deduplication
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_token_events_mint_type_time
    ON token_events (mint, type, received_at);
  `);
  console.log('✅ Added unique index: (mint, type, received_at)');
} catch (error) {
  console.log('⚠️  Error creating mint-type-time index:', error.message);
}

try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_token_events_signature_type
    ON token_events (signature, type);
  `);
  console.log('✅ Added unique index: (signature, type)');
} catch (error) {
  console.log('⚠️  Error creating signature-type index:', error.message);
}

try {
  // Add performance indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_token_events_signature
    ON token_events (signature);
  `);
  console.log('✅ Added signature index');
} catch (error) {
  console.log('⚠️  Error creating signature index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_token_events_type
    ON token_events (type);
  `);
  console.log('✅ Added type index');
} catch (error) {
  console.log('⚠️  Error creating type index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_token_events_source
    ON token_events (source);
  `);
  console.log('✅ Added source index');
} catch (error) {
  console.log('⚠️  Error creating source index:', error.message);
}

console.log('🎉 Database migration completed!');
console.log('🔍 Deduplication indexes added:');
console.log('   - UNIQUE(mint, type, received_at)');
console.log('   - UNIQUE(signature, type)');
