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

### Start the System
```bash
# Terminal 1: Start webhook server
npm start

# Terminal 2: Start Pump.fun WebSocket client
npm run pump
```

### View Live Data
```bash
# View recent tokens
npm run cli -- recent

# View recent Pump.fun tokens
npm run cli -- recent-pump

# View statistics
npm run cli -- stats
```

## 📋 CLI Commands

| Command | Description | Example |
|---------|-------------|---------|
| `recent [N]` | Show recent tokens (default: 20) | `npm run cli -- recent 50` |
| `recent-pump [N]` | Show recent Pump.fun tokens | `npm run cli -- recent-pump 10` |
| `events <MINT>` | Show events for specific token | `npm run cli -- events So111...` |
| `stats` | Show comprehensive statistics | `npm run cli -- stats` |

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
│  │   events    │  │   events    │  │      duplicates         │ │
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
│   └── daily-log.md         # Development progress log
└── 📄 package.json          # Dependencies & scripts
```

## 🔧 Configuration

### Environment Variables
```bash
export WEBHOOK_SECRET=your-secret-key-here
export HELIUS_API_KEY=your-helius-api-key
```

### Webhook Endpoints
- `GET /health` - Health check
- `GET /stats` - Event statistics  
- `POST /webhook` - Receive token events (requires `x-webhook-secret` header)

## 📊 Current Stats

- **117 Total Tokens** (81 Pump.fun, 35 Helius, 1 Jupiter)
- **175 Total Events** with deduplication
- **Real-time Detection** of new token launches
- **Zero Duplicates** thanks to unique indexes

## 🛠️ Development

### Branch-per-Task Workflow
```bash
# Create task branch
git checkout -b task-XX-description

# Implement features
# Test thoroughly
# Document in docs/daily-log.md

# Merge when complete
git checkout main
git merge task-XX-description
```

### Available Scripts
```bash
npm start          # Start webhook server
npm run pump       # Start Pump.fun WebSocket client
npm run cli        # Run CLI commands
npm run tunnel     # Start ngrok tunnel
npm run db:init    # Initialize database
```

## 🔒 Security

- Rate limiting on webhook endpoints
- Shared secret authentication
- Input validation and sanitization
- SQL injection protection via prepared statements

## 📈 Performance

- **Deduplication**: Unique indexes prevent duplicate storage
- **Efficient Queries**: Optimized database queries with proper indexing
- **Real-time Processing**: WebSocket integration for instant detection
- **Scalable Storage**: JSONL + SQLite for different use cases

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
