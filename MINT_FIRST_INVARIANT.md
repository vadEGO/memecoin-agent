# Mint-First Invariant

## 🎯 Core Principle

**Every display must show `SYMBOL (MINT)` format with copy functionality. Symbol-only displays are disallowed.**

## 📋 Implementation Checklist

- [x] **CLI rows**: First column renders `symbol (mintShort)` where `mintShort = ABCD…WXYZ`
- [x] **Copy functionality**: Separate "copy" action that copies the full mint address
- [x] **Alerts (TG/Discord)**: Title `🚀 SYMBOL (MINT)`, body includes copy-mint button and explorer links
- [x] **Database queries**: All token displays use mint address as primary key
- [x] **Explorer links**: Built from mint address, never from symbol

## 🔧 Technical Implementation

### Visual Encoding System
```javascript
// Format token display with SYMBOL (MINT) convention
function formatTokenDisplay(symbol, mint, maxLength = 50) {
  const symbolStr = symbol || 'UNKNOWN';
  const mintShort = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  return `${symbolStr} (${mintShort})`;
}

// Format mint for copy functionality
function formatMintForCopy(mint) {
  return `\`${mint}\``;
}
```

### CLI Commands
```bash
# All commands use SYMBOL (MINT) format
npm run cli -- profiling
npm run cli -- classes <MINT>
npm run cli -- candidates
npm run cli -- discord-alert <MINT>
```

### Database Schema
- **Primary Key**: `mint` (never symbol)
- **Display Format**: `SYMBOL (MINT)` in all queries
- **Explorer Links**: Generated from mint address

## 📱 Interface Examples

### CLI Dashboard
```
SYMBOL (MINT)                 HOLDERS WALLET BREAKDOWN
TEST (Test…7890)               100    🟢 Fresh 4 (4.0%)   🔴 Snipers 2 (2.0%)
```

### Discord/Telegram Alert
```
🚀 TEST (Test…7890) • 🔵 Health 75.5/100 (Good)
Holders 30m: 100 • Liq: $50.0k

🟢 Fresh 4 (4.0%)   🔴 Snipers 2 (2.0%)   🟣 Bundled 2 (2.0%)

Links: [Dexscreener](https://dexscreener.com/solana/TestMint1234567890123456789012345678901234567890) • Copy mint: `TestMint1234567890123456789012345678901234567890`
```

### Wallet Classes Command
```
📊 Wallet Classes for TEST (Test…7890)
────────────────────────────────────────────────────────────
🟢 Fresh 4 (4.0%) • 🟣 Bundled 2 (2.0%)

Copy mint: `TestMint1234567890123456789012345678901234567890`
```

## 🚫 Anti-Patterns (Disallowed)

- ❌ `TEST` (symbol only)
- ❌ `TestMint1234567890123456789012345678901234567890` (mint only)
- ❌ `TEST - TestMint1234567890123456789012345678901234567890` (dash separator)
- ❌ `TEST_TestMint1234567890123456789012345678901234567890` (underscore separator)

## ✅ Correct Patterns

- ✅ `TEST (Test…7890)` (SYMBOL (MINT) format)
- ✅ `TEST (TestMint1234567890123456789012345678901234567890)` (full mint when space allows)
- ✅ `🚀 TEST (Test…7890)` (with emoji prefix)
- ✅ `Copy mint: \`TestMint1234567890123456789012345678901234567890\`` (copy functionality)

## 🔗 Explorer Link Generation

All explorer links are generated from the mint address:

- **Dexscreener**: `https://dexscreener.com/solana/<MINT>`
- **Birdeye**: `https://birdeye.so/token/<MINT>?chain=solana`
- **Solscan**: `https://solscan.io/token/<MINT>`

## 📊 Database Queries

All token-related queries use mint as the primary identifier:

```sql
-- Correct: Use mint as primary key
SELECT symbol, mint, holders_count FROM tokens WHERE mint = ?

-- Correct: Display format
SELECT symbol || ' (' || substr(mint, 1, 4) || '…' || substr(mint, -4) || ')' as display
FROM tokens WHERE mint = ?
```

## 🎯 Benefits

1. **Uniqueness**: Mint addresses are globally unique, symbols are not
2. **Copy Functionality**: Easy to copy full mint for trading/analysis
3. **Explorer Links**: Direct links to blockchain explorers
4. **Consistency**: Same format across all interfaces
5. **Accessibility**: Clear identification of tokens

## 🔍 PR Checklist

Before submitting any PR, verify:

- [ ] All token displays use `SYMBOL (MINT)` format
- [ ] No symbol-only displays exist
- [ ] Copy functionality is available where appropriate
- [ ] Explorer links are built from mint address
- [ ] Database queries use mint as primary key
- [ ] CLI commands accept mint addresses
- [ ] All interfaces are consistent

## 🚀 Future Web Dashboard

The mint-first invariant will be maintained in the web dashboard:

- **Token Cards**: `SYMBOL (MINT)` with copy button
- **Tables**: First column shows `SYMBOL (MINT)` format
- **Modals**: Full mint address with copy functionality
- **URLs**: Use mint addresses in routes (`/token/<MINT>`)
- **API**: All endpoints use mint as identifier

This invariant ensures consistency, usability, and accuracy across all interfaces while making it easy for users to copy mint addresses for trading and analysis.
