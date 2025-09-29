// db/migrate-holders-complete.js - Complete holders table migration
const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

console.log('🔄 Migrating holders table to complete schema...');

try {
  // Add missing columns to holders table
  db.exec(`
    ALTER TABLE holders ADD COLUMN is_fresh INTEGER DEFAULT 0;
  `);
  console.log('✅ Added is_fresh column to holders');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ is_fresh column already exists');
  } else {
    console.log('⚠️  Error adding is_fresh column:', error.message);
  }
}

try {
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

console.log('🎉 Holders table migration completed!');
console.log('🔍 Enhanced functionality added:');
console.log('   - Fresh wallet detection');
console.log('   - Holder type classification');
console.log('   - Funding relationship tracking');
