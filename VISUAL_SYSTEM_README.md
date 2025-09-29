# Visual Encoding System for Wallet Profiling

## 🎨 Overview

This document describes the comprehensive visual encoding system implemented for Task 8 wallet profiling. The system provides consistent, accessible visual representations across CLI, Discord/Telegram, and future web dashboard interfaces.

## 🏷️ Visual Encoding Scheme

### Wallet Class Mappings

| Class | Meaning | Icon | Color (Light) | Color (Dark) | Notes |
|-------|---------|------|---------------|--------------|-------|
| **Fresh** | Early organic buyers (≤30m, not inception) | 🟢 | #10B981 (emerald 500) | #34D399 (emerald 400) | Positive signal; strongest green |
| **Inception** | Initial distribution recipients | 🟦 | #3B82F6 (blue 500) | #60A5FA (blue 400) | Neutral info; baseline cohort |
| **Snipers** | Bought within N blocks post-pool | 🔴 | #EF4444 (red 500) | #F87171 (red 400) | Caution/negative |
| **Bundled** | Funded by a bundler / splitter | 🟣 | #8B5CF6 (violet 500) | #A78BFA (violet 400) | Often inorganic coordination |
| **Insiders** | Funding lineage overlaps with dev | 🟠 | #F59E0B (amber 500) | #FBBF24 (amber 400) | Major risk flag |
| **Others** | Everyone else | ⚪ | #6B7280 (gray 500) | #9CA3AF (gray 400) | De-emphasized |

### Health Score Bands

| Band | Range | Color | Icon | Description |
|------|-------|-------|------|-------------|
| **Excellent** | 80-100 | #10B981 | 🟢 | High quality token |
| **Good** | 60-79 | #3B82F6 | 🔵 | Solid performance |
| **Fair** | 40-59 | #F59E0B | 🟡 | Moderate concerns |
| **Poor** | 0-39 | #EF4444 | 🔴 | High risk |

## 🎯 Display Conventions

### 1. Token Display Format
- **Always show**: `SYMBOL (MINT)`
- **Mint truncation**: `ABCD…WXYZ` with copy button
- **Explorer links**: Built from mint address

### 2. Count + Percentage Format
- **Format**: `count (pct%)` with 0 decimals for counts
- **Percentage**: 0-1 decimal places as helpful
- **Base**: `holders_count` (wallets can belong to multiple classes)

### 3. Class Ordering
- **Default order**: Fresh → Inception → Snipers → Bundled → Insiders → Others
- **Emphasis**: Fresh (green) and Snipers/Insiders (red/amber) as primary signals

## 📱 Interface Examples

### A) Discord/Telegram Alert (Short)
```
🚀 JUP (F4k3Mi…123) • Health 72
Holders 30m: 243 • Liq: $12.4k

🟢 Fresh 173 (71%)   🟦 Inception 15 (6%)
🔴 Snipers 8 (3%)    🟣 Bundled 12 (5%)
🟠 Insiders 7 (3%)

Links: Dexscreener | Birdeye | Solscan  •  Copy mint
```

### B) CLI Table (Monospace)
```
SYMBOL (MINT)                HOLDERS WALLET BREAKDOWN
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
JUP (F4k3Mi…123)             243    🟢 Fresh 173 (71%)   🟦 Inception 15 (6%)    🔴 Snipers 8 (3%)     🟣 Bundled 12 (5%)     🟠 Insiders 7 (3%)
VADDY (VaDdyMi…A77)          118    🟢 Fresh 64 (54%)    🟦 Inception 9 (8%)     🔴 Snipers 2 (2%)     🟣 Bundled 0 (0%)      🟠 Insiders 0 (0%)
```

### C) Health Score Card
```
🔵 Health 75.5/100 (Good)
TEST (Test…7890)
Fresh 4.0% • Snipers 2.0% • Insiders 2.0% • Liq $50.0k
```

### D) Token Detail View
```
🔍 Token Detail: TEST (TestMint1234567890123456789012345678901234567890)
════════════════════════════════════════════════════════════════════════════════
🔵 Health 75.5/100 (Good)
TEST (Test…7890)
Fresh 4.0% • Snipers 2.0% • Insiders 2.0% • Liq $50.0k

Pool Created: 2025-09-28T23:17:08.219Z
Dev Wallet: TestDev1234567890123456789012345678901234567890

📊 Wallet Classes:
🟢 Fresh 4 (4.0%)   🔴 Snipers 2 (2.0%)   🟣 Bundled 2 (2.0%)   🟠 Insiders 2 (2.0%)
```

## 🔗 Explorer Links

All explorer links are generated from the mint address:

- **Dexscreener**: `https://dexscreener.com/solana/<MINT>`
- **Birdeye**: `https://birdeye.so/token/<MINT>?chain=solana`
- **Solscan**: `https://solscan.io/token/<MINT>`

## ♿ Accessibility Features

### Color + Icon System
- **Never color alone**: Always use both color and icon
- **High contrast**: > 4.5:1 ratio for text on backgrounds
- **White text**: On strong colors (Fresh/Sniper/Insider pills)
- **Dark gray text**: On blue/gray pills

### Color-Blind Support
- **Patterns**: Diagonal hatch for Snipers, dots for Bundled
- **Icons**: Consistent iconography across all interfaces
- **Text labels**: Always include class names

## 🛠️ Implementation

### Core Utility (`lib/visual-encoding.js`)
```javascript
const { 
  formatWalletClass,
  formatHealthScore,
  formatTokenDisplay,
  formatDiscordAlert,
  formatCLITableRow,
  formatHealthScoreCard
} = require('./lib/visual-encoding');
```

### CLI Commands
```bash
# Show visual dashboard
npm run cli -- profiling

# Show detailed token analysis
npm run cli -- profiling-detail <MINT>

# Generate Discord/Telegram alert
npm run cli -- discord-alert <MINT>
```

### Programmatic Usage
```javascript
// Format wallet class
const freshDisplay = formatWalletClass('fresh', 173, 71.0, true);

// Format health score
const healthDisplay = formatHealthScore(75.5, true);

// Generate Discord alert
const alert = formatDiscordAlert(token, counts);
```

## 📊 Health Score Formula

The health score uses weighted components (sum to 100):

- **Fresh Ratio** (+35 points): Percentage of fresh wallets
- **Liquidity Quality** (+20 points): Log-scaled liquidity amount
- **Sniper Ratio** (-15 points): Percentage of sniper wallets
- **Insider Ratio** (-20 points): Percentage of insider wallets
- **Top 10 Concentration** (-10 points): Concentration of top holders

```javascript
healthScore = clamp(
  35 * freshRatio + 
  20 * liquidityScore - 
  15 * sniperRatio - 
  20 * insiderRatio - 
  10 * top10Concentration, 
  0, 100
)
```

## 🎨 Future Web Dashboard Components

The visual system is designed to support these future components:

### TokenRow Component
- Props: `token`, `counts`, `onClick`
- Displays: Symbol, health score, wallet breakdown
- Styling: Responsive table row with hover effects

### ClassChips Component
- Props: `counts`, `totalHolders`, `compact`
- Displays: Pill-shaped chips for each wallet class
- Styling: Rounded pills with icons and colors

### HealthScoreBadge Component
- Props: `score`, `size`, `showLabel`
- Displays: Color-coded health score badge
- Styling: Circular or rectangular badge with band colors

### DonutHoldersChart Component
- Props: `counts`, `totalHolders`, `size`
- Displays: Donut chart with wallet class distribution
- Styling: SVG chart with patterns for accessibility

## ✅ Acceptance Checklist

- [x] All displays use `SYMBOL (MINT)` format
- [x] Each class shows icon + color + count (pct%)
- [x] Alerts fit within 5-7 lines, mobile-readable
- [x] Chart colors + patterns meet accessibility standards
- [x] Health score badge color matches numeric band
- [x] Explorer links built from mint address
- [x] Copy mint functionality included
- [x] Consistent visual language across interfaces

## 🚀 Usage Examples

### CLI Dashboard
```bash
npm run cli -- profiling
```

### Token Detail
```bash
npm run cli -- profiling-detail So11111111111111111111111111111111111111112
```

### Discord Alert
```bash
npm run cli -- discord-alert So11111111111111111111111111111111111111112
```

The visual system provides a comprehensive, accessible, and consistent way to display wallet profiling data across all interfaces, making it instantly scannable for users to make informed decisions about token quality and risk.
