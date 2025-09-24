const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

const cmd = process.argv[2] || 'recent';

if (cmd === 'recent') {
  const rows = db.prepare(`
    SELECT mint, symbol, name, source, first_seen_at
    FROM tokens
    ORDER BY first_seen_at DESC
    LIMIT 20
  `).all();
  console.table(rows);
} else if (cmd === 'events') {
  const mint = process.argv[3]; 
  if (!mint) { 
    console.log('Usage: node cli.js events <MINT>'); 
    process.exit(1); 
  }
  const evts = db.prepare(`
    SELECT type, source, received_at
    FROM token_events WHERE mint = ? ORDER BY received_at DESC LIMIT 50
  `).all(mint);
  console.table(evts);
} else {
  console.log('Commands: recent | events <MINT>');
}
