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
INSERT INTO token_events (mint, type, source, received_at, raw_json)
VALUES (@mint, @type, @source, @received_at, @raw_json)
`);

module.exports = {
  saveToken(token) { return upsertToken.run(token); },
  saveEvent(evt) { return insertEvent.run(evt); },
};
