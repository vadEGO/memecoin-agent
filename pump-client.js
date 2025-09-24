// pump-client.js
const WebSocket = require('ws');
const fetch = require('node-fetch'); // only if you want to call your webhook

const WEBHOOK_URL = 'http://localhost:3000/webhook';
const WEBHOOK_SECRET = 'your-secret-key-here';

// Use Pump.fun WS endpoint
const ws = new WebSocket('wss://pumpportal.fun/api/data');

// When connected
ws.on('open', () => {
  console.log('✅ Connected to Pump.fun WS');
  // Subscribe to token creation events (correct method name)
  ws.send(JSON.stringify({
    method: "subscribeNewToken" // corrected method name
  }));
  console.log('📡 Subscribed to new token events...');
});

// Handle messages
ws.on('message', async (msg) => {
  try {
    const data = JSON.parse(msg.toString());
    
    // Skip subscription confirmation messages
    if (data.message && data.message.includes('Successfully subscribed')) {
      console.log('✅', data.message);
      return;
    }
    
    // Skip messages without mint (like subscription confirmations)
    if (!data.mint) {
      console.log('⚠️  No mint found in message, skipping...');
      return;
    }

    // Sanitize fields before logging
    const mint = data.mint || data.mintAddress || data.tokenAddress || '(no mint)';
    const symbol = data.symbol || data.ticker || data.meta?.symbol || '';
    const name = data.name || data.meta?.name || '';
    const mcap = data.marketCapSOL ?? data.marketCap ?? null;

    console.log('🎉 New token detected:');
    console.log('   Mint:', mint);
    if (name)   console.log('   Name:', name);
    if (symbol) console.log('   Symbol:', symbol);
    if (mcap != null) console.log('   Market Cap:', mcap, 'SOL');

    // Transform Pump.fun data to our webhook format
    const webhookData = {
      source: 'pump.fun',
      type: 'token_mint_detected',
      mint: mint,
      symbol: symbol || 'Unknown',
      name: name || 'Unknown',
      decimals: 6, // Pump.fun tokens typically use 6 decimals
      creator: data.traderPublicKey || 'Unknown',
      launch_tx: data.signature,
      market_cap_sol: mcap,
      initial_buy: data.initialBuy,
      sol_amount: data.solAmount,
      bonding_curve_key: data.bondingCurveKey,
      v_tokens_in_bonding_curve: data.vTokensInBondingCurve,
      v_sol_in_bonding_curve: data.vSolInBondingCurve,
      tx_type: data.txType,
      signature: data.signature || data.tx || data.initialBuyTx || null // if available
    };

    // forward to your webhook
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET
      },
      body: JSON.stringify(webhookData)
    });

    const result = await res.json();
    console.log(`→ Forwarded to webhook: ${res.status} - ${result.stored ? 'Stored' : 'Not stored'}`);
    
  } catch (e) {
    console.error('Parse/forward error:', e);
  }
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

ws.on('close', (code, reason) => {
  console.log(`WebSocket closed: ${code} - ${reason}`);
});

// Keep the process alive
process.on('SIGINT', () => {
  console.log('\n👋 Disconnecting from Pump.fun...');
  ws.close();
  process.exit(0);
});
