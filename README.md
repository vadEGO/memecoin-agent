# 🚀 Memecoin Agent

A real-time memecoin detection and tracking system built for Solana. This agent monitors the blockchain for new token launches, tracks their lifecycle, and provides comprehensive data storage and querying capabilities.

## ✨ Features

- **Real-time Detection**: Monitors Solana blockchain for new token launches
- **Helius Integration**: Uses Helius webhooks for enhanced transaction monitoring
- **Dual Persistence**: Stores events in both JSONL (audit trail) and SQLite (queryable)
- **RESTful API**: Clean webhook endpoints for receiving blockchain events
- **CLI Interface**: Easy data querying and management
- **Security**: Rate limiting, secret validation, and input sanitization
- **Production Ready**: Comprehensive error handling and logging

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Helius API    │───▶│  Webhook Server │───▶│   SQLite DB     │
│                 │    │                 │    │                 │
│ • Enhanced      │    │ • Rate Limiting │    │ • Token Registry│
│   Webhooks      │    │ • Validation    │    │ • Event History │
│ • Real-time     │    │ • Normalization │    │ • Queryable     │
│   Events        │    │ • Dual Storage  │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │   JSONL Files   │
                       │                 │
                       │ • Audit Trail   │
                       │ • Raw Events    │
                       │ • Persistent    │
                       └─────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js (v16 or higher)
- npm
- Helius API key (for real-time events)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/memecoin-agent.git
   cd memecoin-agent
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   # Copy the example environment file
   cp .env.example .env
   
   # Edit .env with your actual values
   nano .env
   ```

4. **Configure your environment**
   ```bash
   # Required environment variables
   export HELIUS_API_KEY=your_helius_api_key_here
   export WEBHOOK_SECRET=your-secret-key-here
   
   # Optional environment variables
   export HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_key
   export PORT=3000
   ```

5. **Initialize the database**
   ```bash
   npm run db:init
   ```

6. **Start the server**
   ```bash
   npm start
   ```

7. **Test the setup**
   ```bash
   npm test
   ```

## 📊 Usage

### Webhook Server

The main server runs on port 3000 and provides:

- `GET /health` - Health check endpoint
- `POST /webhook` - Receives blockchain events (requires secret header)

### CLI Commands

```bash
# View recent tokens
npm run cli

# View events for specific token
npm run cli -- events <MINT_ADDRESS>

# Initialize database
npm run db:init
```

### Exposing Publicly

For production use, expose your local server:

```bash
# Using ngrok (development)
npm run tunnel

# Or deploy to cloud provider
# (Fly.io, Render, Railway, etc.)
```

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
# Helius API Configuration
HELIUS_API_KEY=your_helius_api_key_here
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_helius_api_key_here

# Webhook Configuration
WEBHOOK_SECRET=your-secret-key-here
PORT=3000

# Database Configuration (optional)
DB_PATH=db/agent.db
```

### Helius Webhook Setup

1. **Get your Helius API key** from the [Helius Dashboard](https://dashboard.helius.xyz/)

2. **Create a webhook**
   ```bash
   export HELIUS_API_KEY=your_api_key_here
   node setup-helius-webhook.js https://your-domain.com/webhook
   ```

3. **Configure webhook parameters**
   - Type: `enhanced`
   - Transaction Types: `ANY`
   - Auth Header: `x-webhook-secret: your-secret-key-here`

## 📈 Data Schema

### Tokens Table
- `mint` (PRIMARY KEY): Token mint address
- `symbol`: Token symbol
- `name`: Token name
- `decimals`: Token decimals
- `creator`: Token creator/owner
- `launch_tx`: Transaction signature
- `source`: Event source (helius, pump.fun, etc.)
- `first_seen_at`: First appearance timestamp
- `last_updated_at`: Last update timestamp

### Token Events Table
- `id`: Auto-incrementing ID
- `mint`: Token mint address
- `type`: Event type (TOKEN_MINT, etc.)
- `source`: Event source
- `received_at`: Reception timestamp
- `raw_json`: Complete original payload

## 🛡️ Security

- **Rate Limiting**: 60 requests per 10 seconds per IP
- **Body Size Limit**: 256KB maximum
- **Secret Validation**: All webhook requests require valid secret
- **Input Sanitization**: Proper validation and error handling
- **Environment Variables**: No hardcoded secrets in code

## 📁 Project Structure

```
memecoin-agent/
├── webhook-server.js          # Main webhook server
├── cli.js                     # Command-line interface
├── test-webhook.js            # Test suite
├── setup-helius-webhook.js    # Helius webhook setup
├── start-tunnel.js            # ngrok tunnel setup
├── .env.example               # Environment variables template
├── db/
│   ├── init.js               # Database schema
│   ├── index.js              # Database helpers
│   └── agent.db              # SQLite database
├── data/
│   └── intake/
│       └── new_tokens.jsonl  # Event audit trail
├── package.json              # Dependencies and scripts
└── README.md                 # This file
```

## 🧪 Testing

### Manual Testing

```bash
# Health check
curl http://localhost:3000/health

# Send test event
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your-secret-key-here" \
  -d '{"type":"TOKEN_MINT","events":{"token":{"mint":"ABC123","symbol":"TEST"}}}'
```

### Automated Testing

```bash
npm test
```

## 📊 Monitoring

### Server Logs
The server logs all incoming events with:
- Timestamp
- Event type
- Token address
- Source
- Helius detection flag

### Database Queries
```sql
-- Recent events
SELECT * FROM token_events ORDER BY received_at DESC LIMIT 10;

-- Token statistics
SELECT source, COUNT(*) as count FROM tokens GROUP BY source;
```

## 🔐 Security Best Practices

1. **Never commit `.env` files** - They're in `.gitignore`
2. **Use strong secrets** - Generate random webhook secrets
3. **Rotate API keys** - Regularly update your Helius API key
4. **Monitor access** - Check logs for suspicious activity
5. **Use HTTPS** - Always use secure connections in production

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Helius](https://helius.xyz/) for blockchain data
- [Solana](https://solana.com/) for the blockchain platform
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for database
- [Express.js](https://expressjs.com/) for the web framework

## 📞 Support

If you have any questions or need help, please open an issue on GitHub.

---

**Happy memecoin hunting! ��💰**
