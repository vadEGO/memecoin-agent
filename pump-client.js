// pump-client.js
const WebSocket = require('ws');
const fetch = require('node-fetch');

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhook';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'your-secret-key-here';

let ws;
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let reconnectDelay = 1000; // Start with 1 second
let maxReconnectDelay = 60000; // Max 60 seconds
let heartbeatInterval;
let lastMessageTime = Date.now();
const HEARTBEAT_TIMEOUT = 30000; // 30 seconds

function log(level, event, data = {}) {
  console.log(JSON.stringify({
    lvl: level,
    at: 'pump-client',
    event,
    ts: Date.now(),
    ...data
  }));
}

function connect() {
  try {
    ws = new WebSocket('wss://pumpportal.fun/api/data');
    
    ws.on('open', () => {
      log('info', 'connected');
      reconnectAttempts = 0;
      reconnectDelay = 1000;
      
      // Subscribe to token creation events
      ws.send(JSON.stringify({
        method: "subscribeNewToken"
      }));
      log('info', 'subscribed', { method: 'subscribeNewToken' });
      
      // Start heartbeat
      startHeartbeat();
    });

    ws.on('message', async (msg) => {
      lastMessageTime = Date.now();
      
      try {
        const data = JSON.parse(msg.toString());
        
        // Skip subscription confirmation messages
        if (data.message && data.message.includes('Successfully subscribed')) {
          log('info', 'subscription_confirmed', { message: data.message });
          return;
        }
        
        // Schema guard - ensure we have at least a mint
        const mint = data.mint || data.mintAddress || data.tokenAddress;
        if (!mint) {
          log('warn', 'no_mint_found', { data: Object.keys(data) });
          return;
        }

        // Safe field access with fallbacks
        const symbol = data.symbol || data.ticker || data.meta?.symbol || null;
        const name = data.name || data.meta?.name || null;
        const marketCap = data.marketCapSOL ?? data.marketCap ?? null;

        log('info', 'token_detected', { 
          mint: mint.substring(0, 8) + '...',
          symbol,
          name: name?.substring(0, 20) + (name?.length > 20 ? '...' : ''),
          marketCap
        });

        // Create unique signature for deduplication
        const signature = data.signature || data.tx || data.initialBuyTx || 
          `${mint}_${data.createdAt || Date.now()}`;

        // Transform to webhook format
        const webhookData = {
          source: 'pump.fun',
          type: 'token_mint_detected',
          mint,
          symbol: symbol || 'Unknown',
          name: name || 'Unknown',
          decimals: 6, // Pump.fun tokens typically use 6 decimals
          creator: data.traderPublicKey || 'Unknown',
          launch_tx: signature,
          market_cap_sol: marketCap,
          initial_buy: data.initialBuy,
          sol_amount: data.solAmount,
          bonding_curve_key: data.bondingCurveKey,
          v_tokens_in_bonding_curve: data.vTokensInBondingCurve,
          v_sol_in_bonding_curve: data.vSolInBondingCurve,
          tx_type: data.txType,
          signature
        };

        // Forward to webhook
        const res = await fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-secret': WEBHOOK_SECRET
          },
          body: JSON.stringify(webhookData)
        });

        const result = await res.json();
        log('info', 'webhook_forwarded', { 
          status: res.status, 
          stored: result.stored,
          mint: mint.substring(0, 8) + '...'
        });
        
      } catch (e) {
        log('error', 'message_processing_failed', { error: e.message });
      }
    });

    ws.on('error', (error) => {
      log('error', 'websocket_error', { error: error.message });
    });

    ws.on('close', (code, reason) => {
      log('warn', 'websocket_closed', { code, reason: reason.toString() });
      stopHeartbeat();
      
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        log('info', 'reconnecting', { attempt: reconnectAttempts, delay: reconnectDelay });
        
        setTimeout(() => {
          connect();
        }, reconnectDelay);
        
        // Exponential backoff
        reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
      } else {
        log('error', 'max_reconnect_attempts_reached');
        process.exit(1);
      }
    });

  } catch (error) {
    log('error', 'connection_failed', { error: error.message });
    process.exit(1);
  }
}

function startHeartbeat() {
  heartbeatInterval = setInterval(() => {
    const timeSinceLastMessage = Date.now() - lastMessageTime;
    
    if (timeSinceLastMessage > HEARTBEAT_TIMEOUT) {
      log('warn', 'heartbeat_timeout', { timeSinceLastMessage });
      ws.close();
    }
  }, 10000); // Check every 10 seconds
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  log('info', 'shutting_down');
  stopHeartbeat();
  if (ws) {
    ws.close();
  }
  process.exit(0);
});

// Start connection
connect();
