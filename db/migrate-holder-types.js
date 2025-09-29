// db/migrate-holder-types.js - Migration for cleaner wallet classification
const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

console.log('🔄 Migrating holders table for cleaner wallet classification...');

try {
  // Add holder_type column
  db.exec(`
    ALTER TABLE holders ADD COLUMN holder_type TEXT DEFAULT 'unknown';
  `);
  console.log('✅ Added holder_type column');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ holder_type column already exists');
  } else {
    console.log('⚠️  Error adding holder_type column:', error.message);
  }
}

try {
  // Update existing holders with proper holder_type based on flags
  db.exec(`
    UPDATE holders SET holder_type = 
      CASE 
        WHEN is_inception = 1 THEN 'inception'
        WHEN is_sniper = 1 THEN 'sniper'
        WHEN is_bundler = 1 THEN 'bundler'
        WHEN is_insider = 1 THEN 'insider'
        ELSE 'fresh'
      END
    WHERE holder_type = 'unknown' OR holder_type IS NULL;
  `);
  console.log('✅ Updated existing holders with proper types');
} catch (error) {
  console.log('⚠️  Error updating holder types:', error.message);
}

try {
  // Create scoring view for easy dashboard queries
  db.exec(`
    CREATE VIEW IF NOT EXISTS v_token_scores AS
    SELECT 
      t.mint,
      t.symbol,
      t.name,
      t.first_seen_at,
      h.holders_count,
      h.fresh_wallets_count,
      h.inception_count,
      h.sniper_count,
      h.bundler_count,
      h.insider_count,
      h.fresh_ratio,
      h.top10_share,
      h.sniper_ratio,
      h.health_score,
      h.snapshot_time,
      -- Additional computed metrics
      CASE 
        WHEN h.holders_count > 0 THEN ROUND((h.fresh_wallets_count * 100.0) / h.holders_count, 2)
        ELSE 0 
      END as fresh_percentage,
      CASE 
        WHEN h.holders_count > 0 THEN ROUND((h.sniper_count * 100.0) / h.holders_count, 2)
        ELSE 0 
      END as sniper_percentage,
      CASE 
        WHEN h.health_score >= 80 THEN 'excellent'
        WHEN h.health_score >= 60 THEN 'good'
        WHEN h.health_score >= 40 THEN 'fair'
        ELSE 'poor'
      END as health_grade
    FROM tokens t
    LEFT JOIN holders_history h ON t.mint = h.mint
    WHERE h.snapshot_time = (
      SELECT MAX(snapshot_time) 
      FROM holders_history h2 
      WHERE h2.mint = t.mint
    );
  `);
  console.log('✅ Created v_token_scores view');
} catch (error) {
  console.log('⚠️  Error creating scoring view:', error.message);
}

try {
  // Create momentum view for growth curve analysis
  db.exec(`
    CREATE VIEW IF NOT EXISTS v_momentum_curves AS
    SELECT 
      mint,
      snapshot_time,
      holders_count,
      fresh_wallets_count,
      health_score,
      fresh_ratio,
      top10_share,
      sniper_ratio,
      -- Calculate growth rates
      LAG(holders_count) OVER (PARTITION BY mint ORDER BY snapshot_time) as prev_holders,
      LAG(fresh_wallets_count) OVER (PARTITION BY mint ORDER BY snapshot_time) as prev_fresh,
      CASE 
        WHEN LAG(holders_count) OVER (PARTITION BY mint ORDER BY snapshot_time) > 0 
        THEN ROUND(((holders_count - LAG(holders_count) OVER (PARTITION BY mint ORDER BY snapshot_time)) * 100.0) / LAG(holders_count) OVER (PARTITION BY mint ORDER BY snapshot_time), 2)
        ELSE 0 
      END as holders_growth_rate,
      CASE 
        WHEN LAG(fresh_wallets_count) OVER (PARTITION BY mint ORDER BY snapshot_time) > 0 
        THEN ROUND(((fresh_wallets_count - LAG(fresh_wallets_count) OVER (PARTITION BY mint ORDER BY snapshot_time)) * 100.0) / LAG(fresh_wallets_count) OVER (PARTITION BY mint ORDER BY snapshot_time), 2)
        ELSE 0 
      END as fresh_growth_rate
    FROM holders_history
    ORDER BY mint, snapshot_time;
  `);
  console.log('✅ Created v_momentum_curves view');
} catch (error) {
  console.log('⚠️  Error creating momentum view:', error.message);
}

try {
  // Add indexes for better performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_holders_type
    ON holders (holder_type);
  `);
  console.log('✅ Added holder_type index');
} catch (error) {
  console.log('⚠️  Error creating holder_type index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_holders_history_health_score_desc
    ON holders_history (health_score DESC, snapshot_time DESC);
  `);
  console.log('✅ Added health_score_desc index');
} catch (error) {
  console.log('⚠️  Error creating health_score_desc index:', error.message);
}

console.log('🎉 Holder types migration completed!');
console.log('🔍 Enhanced functionality added:');
console.log('   - Clean holder_type classification (inception|fresh|sniper|insider|unknown)');
console.log('   - v_token_scores view for dashboard queries');
console.log('   - v_momentum_curves view for growth analysis');
console.log('   - Computed percentages and health grades');
console.log('   - Performance indexes for fast queries');
