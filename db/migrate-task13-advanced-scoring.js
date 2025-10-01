const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

console.log('🔄 Migrating database schema for Task 13 - Advanced Scoring v2...');

try {
  // Create model registry table
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_registry (
      model_id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      features JSON NOT NULL,
      train_window TEXT NOT NULL,
      metrics JSON NOT NULL,
      calibration JSON NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('✅ Created model_registry table');
} catch (error) {
  console.log('⚠️  Error creating model_registry table:', error.message);
}

try {
  // Create token predictions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_predictions (
      mint TEXT,
      ts TEXT,
      model_id TEXT,
      target TEXT,
      prob REAL NOT NULL,
      features_hash TEXT,
      explainability TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (mint, target, ts)
    );
  `);
  console.log('✅ Created token_predictions table');
} catch (error) {
  console.log('⚠️  Error creating token_predictions table:', error.message);
}

try {
  // Create backtest runs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS backtest_runs (
      run_id TEXT PRIMARY KEY,
      model_id_win TEXT,
      model_id_rug TEXT,
      thresholds JSON NOT NULL,
      metrics JSON NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('✅ Created backtest_runs table');
} catch (error) {
  console.log('⚠️  Error creating backtest_runs table:', error.message);
}

try {
  // Create labels table for training data
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_labels (
      mint TEXT PRIMARY KEY,
      first_seen_at TEXT NOT NULL,
      price_30m REAL,
      max_price_24h REAL,
      price_24h REAL,
      winner_2x_24h INTEGER DEFAULT 0,
      rug_24h INTEGER DEFAULT 0,
      liquidity_30m REAL,
      liquidity_6h REAL,
      liquidity_24h REAL,
      rug_risk_score_30m REAL,
      lp_pulled INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('✅ Created token_labels table');
} catch (error) {
  console.log('⚠️  Error creating token_labels table:', error.message);
}

try {
  // Add probability fields to tokens table
  db.exec(`
    ALTER TABLE tokens ADD COLUMN prob_2x_24h REAL;
  `);
  console.log('✅ Added prob_2x_24h column to tokens');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ prob_2x_24h column already exists');
  } else {
    console.log('⚠️  Error adding prob_2x_24h column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE tokens ADD COLUMN prob_rug_24h REAL;
  `);
  console.log('✅ Added prob_rug_24h column to tokens');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ prob_rug_24h column already exists');
  } else {
    console.log('⚠️  Error adding prob_rug_24h column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE tokens ADD COLUMN model_id_win TEXT;
  `);
  console.log('✅ Added model_id_win column to tokens');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ model_id_win column already exists');
  } else {
    console.log('⚠️  Error adding model_id_win column:', error.message);
  }
}

try {
  db.exec(`
    ALTER TABLE tokens ADD COLUMN model_id_rug TEXT;
  `);
  console.log('✅ Added model_id_rug column to tokens');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('✅ model_id_rug column already exists');
  } else {
    console.log('⚠️  Error adding model_id_rug column:', error.message);
  }
}

// Create performance indexes
try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_token_predictions_mint_ts
    ON token_predictions (mint, ts);
  `);
  console.log('✅ Added token_predictions mint index');
} catch (error) {
  console.log('⚠️  Error creating token_predictions index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_token_predictions_target
    ON token_predictions (target);
  `);
  console.log('✅ Added token_predictions target index');
} catch (error) {
  console.log('⚠️  Error creating token_predictions target index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_token_labels_first_seen
    ON token_labels (first_seen_at);
  `);
  console.log('✅ Added token_labels first_seen index');
} catch (error) {
  console.log('⚠️  Error creating token_labels index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_token_labels_winner
    ON token_labels (winner_2x_24h);
  `);
  console.log('✅ Added token_labels winner index');
} catch (error) {
  console.log('⚠️  Error creating token_labels winner index:', error.message);
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_token_labels_rug
    ON token_labels (rug_24h);
  `);
  console.log('✅ Added token_labels rug index');
} catch (error) {
  console.log('⚠️  Error creating token_labels rug index:', error.message);
}

console.log('🎉 Task 13 database migration completed!');
console.log('🔍 Added tables:');
console.log('   - model_registry (model versioning)');
console.log('   - token_predictions (probability predictions)');
console.log('   - backtest_runs (model evaluation)');
console.log('   - token_labels (training labels)');
console.log('🔍 Added token fields:');
console.log('   - prob_2x_24h, prob_rug_24h');
console.log('   - model_id_win, model_id_rug');
