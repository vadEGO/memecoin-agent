// db/migrate-wallet-classes.js - Migration for wallet class counts and percentages
const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

console.log('🔄 Migrating database for wallet class counts and percentages...');

try {
  // Add wallet class count columns to tokens table
  const classColumns = [
    'fresh_count', 'fresh_pct',
    'inception_count', 'inception_pct', 
    'snipers_count', 'snipers_pct',
    'bundled_count', 'bundled_pct',
    'insiders_count', 'insiders_pct',
    'others_count', 'others_pct'
  ];

  for (const column of classColumns) {
    const columnType = column.includes('_pct') ? 'REAL' : 'INTEGER';
    const defaultValue = column.includes('_pct') ? '0.0' : '0';
    
    try {
      db.exec(`
        ALTER TABLE tokens ADD COLUMN ${column} ${columnType} DEFAULT ${defaultValue};
      `);
      console.log(`✅ Added ${column} column to tokens`);
    } catch (error) {
      if (error.message.includes('duplicate column name')) {
        console.log(`✅ ${column} column already exists`);
      } else {
        console.log(`⚠️  Error adding ${column} column:`, error.message);
      }
    }
  }

  // Add indexes for performance
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tokens_fresh_pct
      ON tokens (fresh_pct DESC);
    `);
    console.log('✅ Added fresh_pct index');
  } catch (error) {
    console.log('⚠️  Error creating fresh_pct index:', error.message);
  }

  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tokens_snipers_pct
      ON tokens (snipers_pct DESC);
    `);
    console.log('✅ Added snipers_pct index');
  } catch (error) {
    console.log('⚠️  Error creating snipers_pct index:', error.message);
  }

  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tokens_insiders_pct
      ON tokens (insiders_pct DESC);
    `);
    console.log('✅ Added insiders_pct index');
  } catch (error) {
    console.log('⚠️  Error creating insiders_pct index:', error.message);
  }

  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tokens_top10_share
      ON tokens (top10_share DESC);
    `);
    console.log('✅ Added top10_share index');
  } catch (error) {
    console.log('⚠️  Error creating top10_share index:', error.message);
  }

  // Add top10_share column if it doesn't exist
  try {
    db.exec(`
      ALTER TABLE tokens ADD COLUMN top10_share REAL DEFAULT 0.0;
    `);
    console.log('✅ Added top10_share column to tokens');
  } catch (error) {
    if (error.message.includes('duplicate column name')) {
      console.log('✅ top10_share column already exists');
    } else {
      console.log('⚠️  Error adding top10_share column:', error.message);
    }
  }

  console.log('🎉 Wallet class migration completed!');
  console.log('🔍 Enhanced functionality added:');
  console.log('   - Wallet class counts and percentages');
  console.log('   - Top10 concentration tracking');
  console.log('   - Performance indexes for filtering');
  console.log('   - Support for candidates ranking');

} catch (error) {
  console.error('❌ Migration failed:', error.message);
  process.exit(1);
}
