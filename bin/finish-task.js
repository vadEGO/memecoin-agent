#!/usr/bin/env node
/**
 * Optional convenience: requires GitHub CLI `gh` installed and authenticated.
 * Usage: npm run task:finish -- 6
 */
const { execSync } = require('child_process');
const n = process.argv[2];
if (!n) { console.error('Usage: npm run task:finish -- <N>'); process.exit(1); }

try {
  execSync(`gh pr create --title "Task ${n}" --body "Daily task ${n}" --fill`, { stdio: 'inherit' });
  console.log('✅ PR opened');
} catch {
  console.log('ℹ️ Install & login GitHub CLI to auto-open PR, else push & open PR manually:');
  console.log('   git push --set-upstream origin $(git branch --show-current)');
}
