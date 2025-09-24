const https = require('https');

// Configuration - use environment variables
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const WEBHOOK_URL = process.argv[2];
const WEBHOOK_TYPE = process.argv[3] || 'enhanced'; // enhanced or raw
const TRANSACTION_TYPES = process.argv[4] || 'TOKEN_MINT,SWAP'; // Comma-separated types

if (!HELIUS_API_KEY) {
    console.log('❌ HELIUS_API_KEY environment variable is required');
    console.log('Set it with: export HELIUS_API_KEY=your_api_key_here');
    process.exit(1);
}

if (!WEBHOOK_URL) {
    console.log('❌ Please provide a webhook URL');
    console.log('Usage: node setup-helius-webhook.js <WEBHOOK_URL> [TYPE] [TRANSACTION_TYPES]');
    console.log('Example: node setup-helius-webhook.js https://abc123.ngrok-free.app/webhook enhanced "TOKEN_MINT,SWAP"');
    console.log('Example: node setup-helius-webhook.js https://abc123.ngrok-free.app/webhook enhanced "ANY"');
    process.exit(1);
}

// Parse transaction types
const transactionTypes = TRANSACTION_TYPES.split(',').map(t => t.trim());

const webhookData = {
    webhookURL: WEBHOOK_URL,
    webhookType: WEBHOOK_TYPE,
    transactionTypes: transactionTypes,
    authHeader: 'x-webhook-secret: your-secret-key-here',
    accountAddresses: []
};

const postData = JSON.stringify(webhookData);

const options = {
    hostname: 'api.helius.xyz',
    port: 443,
    path: `/v0/webhooks?api-key=${HELIUS_API_KEY}`,
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    }
};

console.log('🚀 Creating Helius webhook...');
console.log(`📡 Webhook URL: ${WEBHOOK_URL}`);
console.log(`🔑 API Key: ${HELIUS_API_KEY.substring(0, 8)}...`);
console.log(`📋 Webhook Type: ${WEBHOOK_TYPE}`);
console.log(`🎯 Transaction Types: ${transactionTypes.join(', ')}`);

const req = https.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        try {
            const response = JSON.parse(data);
            if (res.statusCode === 200 || res.statusCode === 201) {
                console.log('✅ Webhook created successfully!');
                console.log('📋 Webhook Details:');
                console.log(`   ID: ${response.webhookID}`);
                console.log(`   URL: ${response.webhookURL}`);
                console.log(`   Type: ${response.webhookType}`);
                console.log(`   Transaction Types: ${response.transactionTypes?.join(', ') || 'ALL'}`);
                console.log(`   Status: ${response.status}`);
                console.log('\n🎉 Your webhook is now active!');
                console.log('📊 Monitor your server logs for incoming events');
                console.log('\n💡 Recommended transaction types for memecoin detection:');
                console.log('   - TOKEN_MINT: New token creation');
                console.log('   - SWAP: Token swaps (liquidity events)');
                console.log('   - TRANSFER: Token transfers');
                console.log('   - ANY: All transactions (more data, higher volume)');
            } else {
                console.log('❌ Failed to create webhook:');
                console.log(`   Status: ${res.statusCode}`);
                console.log(`   Response: ${data}`);
            }
        } catch (error) {
            console.log('❌ Error parsing response:', error.message);
            console.log('Raw response:', data);
        }
    });
});

req.on('error', (error) => {
    console.error('❌ Request failed:', error.message);
});

req.write(postData);
req.end();
