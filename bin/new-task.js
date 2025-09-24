#!/usr/bin/env node
/**
 * Usage: npm run task:new -- 6 "Initial Vetting: Liquidity + Authorities"
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const n = process.argv[2];
const title = process.argv.slice(3).join(' ') || 'Untitled Task';
if (!n) { console.error('Usage: npm run task:new -- <N> "<TITLE>"'); process.exit(1); }

const slug = title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
const branch = `task-${n}-${slug}`;
execSync(`git checkout -b ${branch}`, { stdio: 'inherit' });

const logPath = path.join('docs','daily-log.md');
if (!fs.existsSync('docs')) fs.mkdirSync('docs');
const today = new Date().toISOString().slice(0,10);
const block = [
  `\n## ${today} – Task ${n}: ${title}`,
  `**Branch:** ${branch}`,
  `**PR:** (link after opening)`,
  `\n### Core Task\n- [ ] TODO`,
  `\n### Stretch (optional)\n- [ ] TODO`,
  `\n### Output / Notes\n- Evidence here`,
  ``,
].join('\n');

fs.appendFileSync(logPath, block);
console.log(`✅ Created branch ${branch} and appended to ${logPath}`);
