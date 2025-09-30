const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

console.log('🔄 Migrating database for Task 9: Alert Engine...');

try {
  // Create alerts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      alert_level TEXT NOT NULL,
      message TEXT NOT NULL,
      triggered_at TEXT NOT NULL,
      resolved_at TEXT,
      status TEXT DEFAULT 'active',
      metadata TEXT,
      UNIQUE(mint, alert_type, triggered_at)
    );
  `);
  console.log('✅ Created alerts table');
} catch (error) {
  console.log('⚠️  Error creating alerts table:', error.message);
}

try {
  // Create alert rules table
  db.exec(`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_name TEXT UNIQUE NOT NULL,
      alert_type TEXT NOT NULL,
      conditions TEXT NOT NULL,
      thresholds TEXT NOT NULL,
      debounce_minutes INTEGER DEFAULT 0,
      sustain_minutes INTEGER DEFAULT 0,
      hard_mute_conditions TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('✅ Created alert_rules table');
} catch (error) {
  console.log('⚠️  Error creating alert_rules table:', error.message);
}

try {
  // Create alert history table for tracking debounce/sustain
  db.exec(`
    CREATE TABLE IF NOT EXISTS alert_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      triggered_at TEXT NOT NULL,
      resolved_at TEXT,
      status TEXT DEFAULT 'active',
      metadata TEXT,
      UNIQUE(mint, alert_type, triggered_at)
    );
  `);
  console.log('✅ Created alert_history table');
} catch (error) {
  console.log('⚠️  Error creating alert_history table:', error.message);
}

try {
  // Create score_history table for Task 9 score snapshotting
  db.exec(`
    CREATE TABLE IF NOT EXISTS score_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT NOT NULL,
      snapshot_time TEXT NOT NULL,
      health_score REAL,
      holders_count INTEGER,
      fresh_pct REAL,
      sniper_pct REAL,
      insider_pct REAL,
      top10_share REAL,
      liquidity_usd REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(mint, snapshot_time)
    );
  `);
  console.log('✅ Created score_history table');
} catch (error) {
  console.log('⚠️  Error creating score_history table:', error.message);
}

try {
  // Add indexes for performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_alerts_mint_type
    ON alerts (mint, alert_type);
    
    CREATE INDEX IF NOT EXISTS idx_alerts_triggered_at
    ON alerts (triggered_at DESC);
    
    CREATE INDEX IF NOT EXISTS idx_alerts_status
    ON alerts (status);
    
    CREATE INDEX IF NOT EXISTS idx_alert_history_mint_type
    ON alert_history (mint, alert_type);
    
    CREATE INDEX IF NOT EXISTS idx_alert_history_triggered_at
    ON alert_history (triggered_at DESC);
    
    CREATE INDEX IF NOT EXISTS idx_score_history_mint_time
    ON score_history (mint, snapshot_time DESC);
    
    CREATE INDEX IF NOT EXISTS idx_score_history_snapshot_time
    ON score_history (snapshot_time DESC);
  `);
  console.log('✅ Added performance indexes');
} catch (error) {
  console.log('⚠️  Error adding indexes:', error.message);
}

try {
  // Insert default alert rules for Task 9
  const defaultRules = [
    {
      rule_name: 'launch_alert',
      alert_type: 'launch',
      conditions: 'health_score >= 70 AND liquidity_usd >= 10000 AND holders_count >= 50',
      thresholds: '{"health_min": 70, "liquidity_min": 10000, "holders_min": 50}',
      debounce_minutes: 30,
      sustain_minutes: 0,
      hard_mute_conditions: '{"sniper_pct_max": 30, "insider_pct_max": 20, "top10_share_max": 0.6}'
    },
    {
      rule_name: 'momentum_upgrade_alert',
      alert_type: 'momentum_upgrade',
      conditions: 'health_score >= 60 AND health_score < 80 AND fresh_pct >= 40',
      thresholds: '{"health_min": 60, "health_max": 80, "fresh_pct_min": 40}',
      debounce_minutes: 15,
      sustain_minutes: 60,
      hard_mute_conditions: '{"sniper_pct_max": 40, "insider_pct_max": 30, "top10_share_max": 0.7}'
    },
    {
      rule_name: 'risk_alert',
      alert_type: 'risk',
      conditions: 'health_score < 40 OR sniper_pct > 50 OR insider_pct > 40 OR top10_share > 0.8',
      thresholds: '{"health_max": 40, "sniper_pct_max": 50, "insider_pct_max": 40, "top10_share_max": 0.8}',
      debounce_minutes: 5,
      sustain_minutes: 0,
      hard_mute_conditions: '{"liquidity_min": 1000, "holders_min": 10}'
    }
  ];

  const insertRule = db.prepare(`
    INSERT OR REPLACE INTO alert_rules 
    (rule_name, alert_type, conditions, thresholds, debounce_minutes, sustain_minutes, hard_mute_conditions)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rule of defaultRules) {
    insertRule.run(
      rule.rule_name,
      rule.alert_type,
      rule.conditions,
      rule.thresholds,
      rule.debounce_minutes,
      rule.sustain_minutes,
      rule.hard_mute_conditions
    );
  }
  console.log('✅ Inserted default alert rules');
} catch (error) {
  console.log('⚠️  Error inserting default rules:', error.message);
}

console.log('🎉 Task 9 Alert Engine migration completed!');
console.log('🔍 Added functionality:');
console.log('   - Alert system with three types: Launch, Momentum Upgrade, Risk');
console.log('   - Debounce and sustain windows for noise reduction');
console.log('   - Hard mute conditions for low-quality tokens');
console.log('   - Score history table for tracking health metrics over time');
console.log('   - Performance indexes for fast queries');
