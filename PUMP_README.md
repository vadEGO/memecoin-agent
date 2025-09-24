# Pump.fun WebSocket Integration

This module connects to Pump.fun's WebSocket feed to ingest live new mints directly into the webhook pipeline.

## Usage

### Start the WebSocket Client
```bash
npm run pump
```

### Start the Webhook Server (in another terminal)
```bash
npm start
```

### View Recent Pump.fun Tokens
```bash
npm run cli -- recent-pump
```

## Features

- **Real-time WebSocket Connection**: Connects to `wss://pumpportal.fun/api/data`
- **Automatic Deduplication**: Uses unique indexes to prevent duplicate entries
- **Webhook Integration**: Forwards all new mints to the local webhook server
- **CLI Support**: View recent pump.fun tokens with `recent-pump` command

## Configuration

The WebSocket client uses the same webhook secret as the main server:
- Webhook URL: `http://localhost:3000/webhook`
- Secret: `your-secret-key-here` (configurable via `WEBHOOK_SECRET` env var)

## Database Schema

The system automatically deduplicates events using:
- `UNIQUE(mint, type, received_at)` - Prevents duplicate events for the same mint
- `UNIQUE(signature, type)` - Prevents duplicate events with the same signature

## Testing

Test the webhook endpoint directly:
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your-secret-key-here" \
  -d '{
    "source": "pump.fun",
    "type": "token_mint_detected",
    "mint": "So11111111111111111111111111111111111111112",
    "symbol": "TEST",
    "name": "Test Token"
  }'
```
