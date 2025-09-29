// db/migrate-pool-slot.js - Migration for pool slot tracking
const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

console.log('🔄 Migrating database for pool slot tracking...');

try {
  // Add slot column to tokens table for pool creation tracking
  db.exec(`
    ALTER TABLE tokens ADD COLUMN slot INTEGER;
  `);
  console.log('✅ Added slot column to tokens');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ slot column already exists');
  } else {
    console.log('⚠️  Error adding slot column:', error.message);
  }
}

try {
  // Add index for slot-based queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tokens_slot
    ON tokens (slot);
  `);
  console.log('✅ Added slot index');
} catch (error) {
  console.log('⚠️  Error creating slot index:', error.message);
}

console.log('🎉 Pool slot migration completed!');
console.log('🔍 Enhanced functionality added:');
console.log('   - Pool creation slot tracking');
console.log('   - Block-based sniper detection');
console.log('   - Performance index for slot queries');
