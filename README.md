# 🚀 Memecoin Agent

**Real-time Solana memecoin detection and tracking system** with Helius webhooks, Pump.fun WebSocket integration, and SQLite persistence.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-21.7.3-green.svg)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-3-blue.svg)](https://sqlite.org/)

## ✨ Features

- 🔴 **Real-time Detection** - Live Pump.fun WebSocket integration
- 🎯 **Multi-Source** - Helius, Pump.fun, and Jupiter API support
- 🛡️ **Deduplication** - Rock-solid duplicate prevention
- 📊 **CLI Interface** - Powerful command-line tools
- 💾 **Dual Storage** - JSONL + SQLite persistence
- ⚡ **High Performance** - Optimized for real-time processing
- 🚨 **Alert System** - Intelligent alerts with anti-noise gates
- 🎯 **Health Scoring** - Four-tier health bands with visual badges
- 📈 **Score Tracking** - Adaptive snapshot frequency for trend analysis

## 🚀 Quick Start

### Prerequisites
- Node.js 20+ 
- Helius API key (optional, for enhanced data)

### Installation
```bash
git clone https://github.com/vadEGO/memecoin-agent.git
cd memecoin-agent
npm install
```

### Dev Loop (One-Click Setup)
```bash
# 1. Initialize database
npm run db:init

# 2. Start webhook server (Terminal 1)
npm start

# 3. Start Pump.fun WebSocket client (Terminal 2)
npm run pump

# 4. Monitor the data (Terminal 3)
npm run cli -- stats
```

### Environment Setup
```bash
# Copy environment template
cp .env.example .env

# Edit with your API keys (optional)
# WEBHOOK_SECRET=your-secret-key-here
# HELIUS_API_KEY=your-helius-api-key
# BIRDEYE_API_KEY=your-birdeye-api-key
```

## 📋 CLI Commands

| Command | Description | Example |
|---------|-------------|---------|
| `recent [N]` | Show recent tokens (default: 20) | `npm run cli -- recent 50` |
| `recent-pump [N]` | Show recent Pump.fun tokens | `npm run cli -- recent-pump 10` |
| `candidates [N]` | Show candidate tokens (filtered) | `npm run cli -- candidates 5` |
| `events <MINT>` | Show events for specific token | `npm run cli -- events So111...` |
| `stats` | Show comprehensive statistics | `npm run cli -- stats` |
| `help` | Show help message | `npm run cli -- help` |

### 🔍 Wallet Profiling Commands (Task 8)

| Command | Description | Example |
|---------|-------------|---------|
| `profiling` | Show wallet profiling dashboard | `npm run cli -- profiling` |
| `profiling-detail <MINT>` | Show detailed wallet analysis | `npm run cli -- profiling-detail So111...` |
| `classes <MINT>` | Show wallet class breakdown | `npm run cli -- classes So111...` |
| `candidates [N]` | Show quality-ranked candidates | `npm run cli -- candidates 10` |
| `discord-alert <MINT>` | Generate Discord/Telegram alert | `npm run cli -- discord-alert So111...` |

### 🚨 Alert System Commands (Task 9)

| Command | Description | Example |
|---------|-------------|---------|
| `alerts [N]` | Show recent alerts with health badges | `npm run cli -- alerts 20` |
| `score-history <MINT>` | Show score history for token | `npm run cli -- score-history So111...` |
| `alert-engine` | Run alert engine worker | `npm run cli -- alert-engine` |
| `score-snapshot` | Run score snapshot worker | `npm run cli -- score-snapshot` |

## 🎯 Mint-First Invariant

**Every display must show `SYMBOL (MINT)` format with copy functionality. Symbol-only displays are disallowed.**

### ✅ Correct Patterns
- `TEST (Test…7890)` - SYMBOL (MINT) format
- `🚀 TEST (Test…7890)` - With emoji prefix
- `Copy mint: \`TestMint1234567890123456789012345678901234567890\`` - Copy functionality

### ❌ Disallowed Patterns
- `TEST` - Symbol only
- `TestMint1234567890123456789012345678901234567890` - Mint only
- `TEST - TestMint1234567890123456789012345678901234567890` - Dash separator

### 🔗 Explorer Links
All explorer links are generated from mint address:
- **Dexscreener**: `https://dexscreener.com/solana/<MINT>`
- **Birdeye**: `https://birdeye.so/token/<MINT>?chain=solana`
- **Solscan**: `https://solscan.io/token/<MINT>`

See [MINT_FIRST_INVARIANT.md](MINT_FIRST_INVARIANT.md) for complete details.

## 🎯 Health Scoring System

### Four Health Bands

| Band | Score Range | Icon | Badge | Description |
|------|-------------|------|-------|-------------|
| **Excellent** | 80-100 | 🟢 | EXCELLENT | High-quality tokens with strong fundamentals |
| **Good** | 60-79 | 🔵 | GOOD | Solid tokens with good potential |
| **Fair** | 40-59 | 🟡 | FAIR | Average tokens with mixed signals |
| **Poor** | 0-39 | 🔴 | POOR | Low-quality tokens with concerning metrics |

### Health Score Calculation

The health score is calculated using weighted components:
- **Fresh Ratio**: +35 points max (early organic buyers)
- **Liquidity Score**: +20 points max (log scale, $1 to $1M)
- **Sniper Penalty**: -15 points max (bot/sniper activity)
- **Insider Penalty**: -20 points max (insider trading)
- **Concentration Penalty**: -10 points max (top 10 holder concentration)

### Alert System

Three intelligent alert types with anti-noise gates:
- **🚀 Launch Alert**: High-quality token launches (Health ≥ 70, Liq ≥ $10k)
- **📈 Momentum Upgrade**: Tokens gaining momentum (Health 60-79, Fresh% ≥ 40%)
- **⚠️ Risk Alert**: Concerning metrics (Health < 40, high sniper/insider %)

See [TASK9_ALERT_SYSTEM_README.md](TASK9_ALERT_SYSTEM_README.md) for complete details.

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Pump.fun      │    │   Helius API     │    │   Jupiter API   │
│   WebSocket     │    │   Webhooks       │    │   Webhooks      │
└─────────┬───────┘    └─────────┬────────┘    └─────────┬───────┘
          │                      │                       │
          │                      │                       │
          ▼                      ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Webhook Server                              │
│                  (webhook-server.js)                          │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Data Pipeline                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   JSONL     │  │   SQLite    │  │    Deduplication        │ │
│  │   Storage   │  │   Database  │  │    (Unique Indexes)     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CLI Interface                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   recent    │  │recent-pump  │  │        stats            │ │
│  │   events    │  │candidates   │  │      duplicates         │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
memecoin-agent/
├── 📄 webhook-server.js      # Main webhook server
├── 📄 pump-client.js         # Pump.fun WebSocket client
├── 📄 cli.js                 # Command-line interface
├── 📁 db/                    # Database layer
│   ├── index.js             # Database functions
│   ├── init.js              # Schema initialization
│   └── migrate.js           # Database migrations
├── 📁 data/                  # Data storage
│   └── intake/              # JSONL files
├── 📁 docs/                  # Documentation
│   ├── daily-log.md         # Development progress log
│   └── architecture.md      # System architecture
├── 📁 workers/               # Background workers
│   └── vetting-worker.js    # Token vetting worker
├── 📁 bin/                   # Utility scripts
│   ├── new-task.js          # Start new task
│   └── finish-task.js       # Finish task
└── 📄 .env.example          # Environment template
```

## 🔧 Configuration

### Environment Variables
```bash
# Required
WEBHOOK_SECRET=your-secret-key-here

# Optional
HELIUS_API_KEY=your-helius-api-key
BIRDEYE_API_KEY=your-birdeye-api-key
PORT=3000
WEBHOOK_URL=http://localhost:3000/webhook
MIN_LIQ_USD=5000
```

### Webhook Endpoints
- `GET /health` - Health check
- `GET /stats` - Event statistics  
- `POST /webhook` - Receive token events (requires `x-webhook-secret` header)

## 📊 Current Stats

- **311 Total Tokens** (229 Helius, 81 Pump.fun, 1 Jupiter)
- **369 Total Events** with deduplication
- **Real-time Detection** of new token launches
- **Zero Duplicates** thanks to unique indexes

## 🛠️ Development

### Branch-per-Task Workflow
```bash
# Start new task
npm run task:new -- 7 "Holder Snapshot + Fresh Wallets"

# Do the work, commit changes
git add . && git commit -m "task(7): holder analysis"

# Finish task (opens PR or shows instructions)
npm run task:finish -- 7
```

### Available Scripts
```bash
npm start          # Start webhook server
npm run pump       # Start Pump.fun WebSocket client
npm run cli        # Run CLI commands
npm run vet        # Run token vetting worker
npm run tunnel     # Start ngrok tunnel
npm run db:init    # Initialize database
npm test           # Test webhook endpoint
```

## 🔒 Security

- Rate limiting on webhook endpoints
- Shared secret authentication
- Input validation and sanitization
- SQL injection protection via prepared statements
- Content-Type validation
- Body size limits

## 📈 Performance

- **Deduplication**: Unique indexes prevent duplicate storage
- **Efficient Queries**: Optimized database queries with proper indexing
- **Real-time Processing**: WebSocket integration for instant detection
- **Scalable Storage**: JSONL + SQLite for different use cases
- **Structured Logging**: JSON logs for better monitoring

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Helius](https://helius.xyz/) for Solana webhook infrastructure
- [Pump.fun](https://pump.fun/) for real-time token data
- [PumpPortal](https://pumpportal.fun/) for WebSocket API access

---

**Built with ❤️ for the Solana memecoin ecosystem**
