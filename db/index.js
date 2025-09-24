const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

const upsertToken = db.prepare(`
INSERT INTO tokens (mint, symbol, name, decimals, creator, launch_tx, source, first_seen_at, last_updated_at)
VALUES (@mint, @symbol, @name, @decimals, @creator, @launch_tx, @source, @first_seen_at, @last_updated_at)
ON CONFLICT(mint) DO UPDATE SET
  symbol=excluded.symbol,
  name=excluded.name,
  decimals=excluded.decimals,
  creator=excluded.creator,
  launch_tx=excluded.launch_tx,
  source=excluded.source,
  last_updated_at=excluded.last_updated_at
`);

const insertEvent = db.prepare(`
INSERT INTO token_events (mint, type, source, received_at, raw_json, signature)
VALUES (@mint, @type, @source, @received_at, @raw_json, @signature)
ON CONFLICT(mint, type, received_at) DO NOTHING
`);

const insertEventBySignature = db.prepare(`
INSERT INTO token_events (mint, type, source, received_at, raw_json, signature)
VALUES (@mint, @type, @source, @received_at, @raw_json, @signature)
ON CONFLICT(signature, type) DO NOTHING
`);

const checkEventExists = db.prepare(`
SELECT COUNT(*) as count FROM token_events 
WHERE (mint = @mint AND type = @type AND received_at = @received_at)
   OR (signature = @signature AND type = @type)
`);

module.exports = {
  saveToken(token) { 
    return upsertToken.run(token); 
  },
  
  saveEvent(evt) { 
    // Check if event already exists
    const exists = checkEventExists.get(evt);
    if (exists.count > 0) {
      console.log(`⚠️  Duplicate event detected, skipping:`, {
        mint: evt.mint,
        type: evt.type,
        signature: evt.signature
      });
      return { changes: 0 };
    }
    
    // Use signature-based deduplication if signature exists
    if (evt.signature) {
      return insertEventBySignature.run(evt);
    } else {
      return insertEvent.run(evt);
    }
  },
  
  getEventStats() {
    const stats = db.prepare(`
      SELECT 
        source,
        type,
        COUNT(*) as count,
        COUNT(DISTINCT mint) as unique_mints
      FROM token_events 
      GROUP BY source, type
      ORDER BY count DESC
    `).all();
    
    return stats;
  }
};
