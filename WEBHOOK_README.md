# Solana Token Webhook Service

A minimal Express.js webhook service that receives "new token" events and persists them in a line-delimited JSON file.

## Features

- ✅ **POST /webhook** - Receives token events with shared secret validation
- ✅ **GET /health** - Health check endpoint
- ✅ **JSONL Persistence** - Events stored in `data/intake/new_tokens.jsonl`
- ✅ **Restart Persistence** - Events append correctly across server restarts
- ✅ **Timestamp Stamping** - Each event gets a timestamp and received_at field
- ✅ **Secret Validation** - Validates shared secret from HTTP headers

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   # or
   node webhook-server.js
   ```

3. **Test the endpoints:**
   ```bash
   npm test
   # or
   node test-webhook.js
   ```

## API Endpoints

### GET /health
Returns server health status.

**Response:**
```json
{ "ok": true }
```

### POST /webhook
Receives new token events. Requires shared secret in header.

**Headers:**
- `x-webhook-secret`: Your shared secret (default: `your-secret-key-here`)
- `Content-Type`: `application/json`

**Request Body Example:**
```json
{
  "type": "new_token",
  "token_address": "So11111111111111111111111111111111111111112",
  "symbol": "SOL",
  "name": "Solana",
  "decimals": 9,
  "mint_authority": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
}
```

**Success Response:**
```json
{
  "ok": true,
  "stored": true,
  "timestamp": "2025-09-24T00:13:47.854Z"
}
```

**Error Response (Invalid Secret):**
```json
{
  "ok": false,
  "error": "Invalid or missing shared secret"
}
```

## Configuration

### Environment Variables
- `PORT` - Server port (default: 3000)
- `WEBHOOK_SECRET` - Shared secret for webhook validation (default: `your-secret-key-here`)

### Data Storage
Events are stored in `data/intake/new_tokens.jsonl` in line-delimited JSON format:

```jsonl
{"type":"new_token","token_address":"So11111111111111111111111111111111111111112","symbol":"SOL","name":"Solana","decimals":9,"mint_authority":"9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM","timestamp":"2025-09-24T00:13:47.854Z","received_at":1758672827854}
{"type":"new_token","token_address":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","symbol":"USDC","name":"USD Coin","timestamp":"2025-09-24T00:13:47.859Z","received_at":1758672827859}
```

## Testing

### Manual Testing with curl

**Health Check:**
```bash
curl -X GET http://localhost:3000/health
```

**Send Token Event:**
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your-secret-key-here" \
  -d '{"type":"new_token","token_address":"ABC123","symbol":"TEST","name":"Test Token"}'
```

### Automated Testing
Run the test suite:
```bash
npm test
```

## Project Structure

```
Solana Agent/
├── webhook-server.js          # Main webhook server
├── test-webhook.js            # Test suite
├── data/
│   └── intake/
│       └── new_tokens.jsonl   # Event storage (auto-created)
├── package.json               # Dependencies and scripts
└── WEBHOOK_README.md          # This file
```

## Acceptance Checklist

- ✅ GET /health returns { ok: true }
- ✅ POST /webhook with correct secret responds with { ok: true, stored: true }
- ✅ data/intake/new_tokens.jsonl grows by one line per valid POST
- ✅ Server handles restarts without errors and keeps appending
- ✅ Shared secret validation works correctly
- ✅ Events are timestamped with both ISO string and Unix timestamp
- ✅ Invalid secrets are properly rejected with 401 status

## Development

The server includes:
- Graceful shutdown handling (SIGINT, SIGTERM)
- Comprehensive error handling
- Request logging
- Automatic directory creation
- Line-delimited JSON persistence

## Security Notes

- Change the default shared secret in production
- Consider adding rate limiting for production use
- Validate and sanitize incoming event data
- Consider adding request size limits
