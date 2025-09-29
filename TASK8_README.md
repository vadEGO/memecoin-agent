# Task 8 — Snipers, Bundlers, Insiders (Wallet Profiling v1)

## Overview

This task implements comprehensive wallet profiling to detect and classify early token holders into categories: Snipers, Bundlers, and Suspected Insiders. It provides a health scoring system and real-time alerts for risk assessment.

## Features

### 🔍 Detection Capabilities

- **Sniper Detection**: Identifies wallets that buy within the first 2 blocks after pool creation
- **Bundler Detection**: Finds wallets that fund 5+ other wallets that subsequently buy the token
- **Insider Detection**: Uses heuristics to identify suspected insiders based on funding lineage and wallet age
- **Health Scoring**: Calculates a 0-100 health score based on multiple factors

### 📊 Database Schema

#### New Columns in `tokens` table:
- `sniper_count` - Number of sniper wallets
- `bundler_count` - Number of bundled wallets  
- `insider_count` - Number of suspected insider wallets
- `health_score` - Calculated health score (0-100)
- `pool_created_at` - Pool creation timestamp
- `pool_signature` - Pool creation transaction signature
- `dev_wallet` - Developer/creator wallet address

#### New Columns in `holders` table:
- `holder_type` - Classification (inception|fresh|sniper|bundled|insider|unknown)
- `funded_by` - Direct SOL funder wallet (if known)

#### New `funding_edges` table:
- `src_wallet` - Source wallet address
- `dst_wallet` - Destination wallet address  
- `amount_sol` - SOL amount transferred
- `timestamp` - Transfer timestamp
- `signature` - Transaction signature

## Workers

### 1. Pool Locator Worker (`pool-locator-worker.js`)
- **Purpose**: Identifies pool creation transactions and developer wallets
- **Input**: Tokens without pool information
- **Output**: Pool creation time, signature, and dev wallet
- **Usage**: `npm run pool-locator`

### 2. Sniper Detector Worker (`sniper-detector-worker.js`)
- **Purpose**: Detects wallets that buy within first 2 blocks after pool creation
- **Input**: Tokens with pool creation data
- **Output**: Sniper wallet classifications
- **Usage**: `npm run sniper-detector`

### 3. Bundler Detector Worker (`bundler-detector-worker.js`)
- **Purpose**: Identifies wallets that fund multiple other wallets that buy the token
- **Input**: Tokens with holder data
- **Output**: Bundler and bundled wallet classifications
- **Usage**: `npm run bundler-detector`

### 4. Insider Detector Worker (`insider-detector-worker.js`)
- **Purpose**: Uses heuristics to identify suspected insiders
- **Input**: Tokens with dev wallet and funding data
- **Output**: Insider wallet classifications
- **Usage**: `npm run insider-detector`

### 5. Health Score Worker (`health-score-worker.js`)
- **Purpose**: Calculates health scores based on multiple factors
- **Input**: Tokens with all profiling data
- **Output**: Health scores (0-100)
- **Usage**: `npm run health-score`

### 6. Main Wallet Profiling Worker (`wallet-profiling-worker.js`)
- **Purpose**: Orchestrates all detection workers and provides CLI interface
- **Input**: All tokens needing profiling
- **Output**: Complete profiling pipeline results
- **Usage**: `npm run wallet-profiling`

## Health Score Calculation

The health score is calculated using weighted components:

- **Fresh Ratio** (+35 points): Percentage of fresh wallets
- **Liquidity Quality** (+20 points): Log-scaled liquidity amount
- **Sniper Ratio** (-15 points): Percentage of sniper wallets
- **Insider Ratio** (-20 points): Percentage of insider wallets
- **Top 10 Concentration** (-10 points): Concentration of top 10 holders

Final score is clamped to 0-100 range.

## CLI Usage

### Run Full Profiling Pipeline
```bash
npm run wallet-profiling
```

### Display Token Table
```bash
npm run wallet-profiling table
```

### Display Token Detail
```bash
npm run wallet-profiling detail <mint_address>
```

### Run Individual Workers
```bash
npm run pool-locator
npm run sniper-detector
npm run bundler-detector
npm run insider-detector
npm run health-score
```

## Alert System

### High-Risk Alerts
- Health score < 30
- Insider ratio > 20%
- Sniper ratio > 30%

### Success Alerts
- Health score > 70
- High fresh wallet ratio
- Good liquidity

## Configuration

### Sniper Detection
- `N_BLOCKS = 2` - Sniper window (blocks after pool creation)

### Bundler Detection  
- `K_WALLETS = 5` - Minimum wallets to fund
- `T_MINUTES = 15` - Time window for bundling activity

### Insider Detection
- `HOPS = 2` - Maximum hops for funding lineage
- `AGE_FRESH_DAYS = 2` - Maximum age for fresh wallets
- `TOP_N = 20` - Number of top holders to analyze

## Database Migration

Run the migration to add new columns and tables:

```bash
node db/migrate-wallet-profiling.js
```

## Performance Notes

- **Windowing**: Runs every 2-3 minutes for first 60 minutes of token life
- **Caps**: Limits transaction parsing per cycle (500 tx max)
- **Idempotency**: Detection updates are idempotent (re-runs overwrite flags)
- **Auditability**: Logs per-mint summaries as JSON lines

## Example Output

### Token Table
```
SYMBOL (MINT)                                    Fresh%  Sniper%  Insider%  Liq        Holders  Score
────────────────────────────────────────────────────────────────────────────────────────────────────
PEPE (AbC123...456)                             71.2    3.1      0.0       $12.4k     243      72.1
DOGE (DeF789...012)                             45.8    8.2      5.1       $8.7k      156      58.3
```

### Risk Alert
```
⚠️ SCAM (XyZ456...789) — Low health score, High insider ratio
Health Score: 15 | Insiders: 7 (23%) | Snipers: 3 (10%) | Holders: 30
```

### Success Alert
```
🚀 PEPE (AbC123...456) — Health 72
Holders(30m)=243 | Fresh=71% | Snipers=3% | Insiders=0% | Liq=$12.4k
```

## Integration

The wallet profiling system integrates with:
- Existing holder tracking system
- Helius API for transaction data
- Real-time alert system
- CLI dashboard
- Database persistence layer

## Future Enhancements

- Graph store for funding relationships
- Known market maker whitelist
- Backtesting hooks for score validation
- Feature store for ML model iteration
- Advanced insider detection algorithms
