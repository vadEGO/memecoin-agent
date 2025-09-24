# Helius Webhook Integration

This document describes the integration with Helius webhooks for real-time Solana token events.

## Features Implemented

### ✅ **Helius Payload Normalization**
- Automatically detects Helius enhanced webhook payloads
- Extracts token information from `events.token` and `events.defi` sections
- Normalizes mint addresses, symbols, names, and decimals
- Preserves original payload in `raw_json` field

### ✅ **Security Measures**
- Rate limiting: 60 requests per 10 seconds per IP
- Body size limit: 256KB maximum
- Shared secret validation via `x-webhook-secret` header
- Proper error handling and logging

### ✅ **Dual Persistence**
- **JSONL**: Complete audit trail with normalized data
- **SQLite**: Queryable token registry and event history

## Webhook Configuration

### Helius Webhook Setup
```bash
# Set your Helius API key
export HELIUS_API_KEY=your_api_key_here

# Create webhook (replace with your public URL)
node setup-helius-webhook.js https://your-domain.com/webhook
```

### Webhook Parameters
- **Type**: `enhanced`
- **Transaction Types**: `ANY` (captures all token events)
- **Auth Header**: `x-webhook-secret: your-secret-key-here`
- **Account Addresses**: `[]` (empty for all accounts)

## Payload Examples

### Helius Enhanced Payload
```json
{
  "type": "TOKEN_MINT",
  "signature": "abc123def456",
  "timestamp": 1695561600,
  "events": {
    "token": {
      "mint": "So11111111111111111111111111111111111111112",
      "symbol": "SOL",
      "name": "Solana",
      "decimals": 9,
      "owner": "Creator123"
    }
  }
}
```

### Normalized Output
```json
{
  "source": "helius",
  "type": "TOKEN_MINT",
  "mint": "So11111111111111111111111111111111111111112",
  "symbol": "SOL",
  "name": "Solana",
  "decimals": 9,
  "creator": "Creator123",
  "launchTx": "abc123def456",
  "createdAt": "2023-09-24T13:20:00.000Z"
}
```

## Database Schema

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

## Usage

### Start the Server
```bash
npm start
```

### Expose Publicly (Optional)
```bash
# Using ngrok
npm run tunnel

# Or deploy to cloud provider
# (Fly.io, Render, Railway, etc.)
```

### Query Data
```bash
# Recent tokens
npm run cli

# Events for specific mint
npm run cli -- events <MINT_ADDRESS>
```

### Test Webhook
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your-secret-key-here" \
  -d '{"type":"TOKEN_MINT","signature":"test123","events":{"token":{"mint":"ABC123","symbol":"TEST"}}}'
```

## Monitoring

### Server Logs
The server logs all incoming events with:
- Timestamp
- Event type
- Token address
- Source
- Helius detection flag

### Database Queries
```sql
-- Recent Helius events
SELECT * FROM token_events WHERE source = 'helius' ORDER BY received_at DESC LIMIT 10;

-- Token statistics
SELECT source, COUNT(*) as count FROM tokens GROUP BY source;
```

## Troubleshooting

### Common Issues
1. **Tunnel not working**: Try different tunneling service or deploy to cloud
2. **Rate limiting**: Adjust limits in webhook-server.js
3. **Database locks**: Ensure only one process accesses SQLite
4. **Memory issues**: Monitor JSONL file size, implement rotation if needed

### Debug Commands
```bash
# Check server health
curl http://localhost:3000/health

# View recent events
tail -f data/intake/new_tokens.jsonl

# Database status
sqlite3 db/agent.db "SELECT COUNT(*) FROM tokens;"
```

## Next Steps

- Implement webhook signature verification
- Add event deduplication
- Set up monitoring and alerting
- Optimize database queries
- Add more event types and filters
