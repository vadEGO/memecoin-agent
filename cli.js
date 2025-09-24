// cli.js
const Database = require('better-sqlite3');
const db = new Database('db/agent.db');

const cmd = process.argv[2] || 'recent';

function showRecent(limit = 20) {
  const rows = db.prepare(`
    SELECT mint, symbol, name, source, first_seen_at
    FROM tokens
    ORDER BY datetime(first_seen_at) DESC
    LIMIT ?
  `).all(limit);
  console.table(rows);
}

function showRecentPump(limit = 20) {
  const rows = db.prepare(`
    SELECT mint, symbol, name, first_seen_at
    FROM tokens
    WHERE source = 'pump.fun'
    ORDER BY datetime(first_seen_at) DESC
    LIMIT ?
  `).all(limit);
  console.table(rows);
}

function showEvents(mint) {
  if (!mint) { console.log('Usage: node cli.js events <MINT>'); process.exit(1); }
  const evts = db.prepare(`
    SELECT type, source, received_at, substr(signature,1,12) AS signature
    FROM token_events
    WHERE mint = ?
    ORDER BY datetime(received_at) DESC
    LIMIT 100
  `).all(mint);
  console.table(evts);
}

function showStats() {
  const totals = db.prepare(`SELECT COUNT(*) AS tokens FROM tokens`).get();
  const bySource = db.prepare(`
    SELECT source, COUNT(*) AS tokens
    FROM tokens GROUP BY source ORDER BY tokens DESC
  `).all();
  const events = db.prepare(`SELECT COUNT(*) AS events FROM token_events`).get();
  const eventsBySource = db.prepare(`
    SELECT source, COUNT(*) AS events
    FROM token_events GROUP BY source ORDER BY events DESC
  `).all();
  console.log('\nTokens total:', totals.tokens);
  console.table(bySource);
  console.log('\nEvents total:', events.events);
  console.table(eventsBySource);
}

if (cmd === 'recent') {
  const n = Number(process.argv[3]) || 20;
  showRecent(n);
} else if (cmd === 'recent-pump') {
  const n = Number(process.argv[3]) || 20;
  showRecentPump(n);
} else if (cmd === 'events') {
  showEvents(process.argv[3]);
} else if (cmd === 'stats') {
  showStats();
} else {
  console.log('Commands: recent [N] | recent-pump [N] | events <MINT> | stats');
}
