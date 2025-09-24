const http = require('http');

const BASE_URL = 'http://localhost:3000';
const SHARED_SECRET = 'your-secret-key-here';

// Helper function to make HTTP requests
function makeRequest(method, path, data = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const jsonBody = JSON.parse(body);
                    resolve({ status: res.statusCode, data: jsonBody });
                } catch (e) {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });

        req.on('error', reject);

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

async function runTests() {
    console.log('🧪 Testing Webhook Server\n');

    try {
        // Test 1: Health check
        console.log('1️⃣ Testing GET /health...');
        const healthResponse = await makeRequest('GET', '/health');
        console.log(`   Status: ${healthResponse.status}`);
        console.log(`   Response:`, healthResponse.data);
        
        if (healthResponse.data.ok === true) {
            console.log('   ✅ Health check passed\n');
        } else {
            console.log('   ❌ Health check failed\n');
            return;
        }

        // Test 2: Webhook with valid secret
        console.log('2️⃣ Testing POST /webhook with valid secret...');
        const validEvent = {
            type: 'new_token',
            token_address: 'So11111111111111111111111111111111111111112',
            symbol: 'SOL',
            name: 'Solana',
            decimals: 9,
            mint_authority: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
        };

        const webhookResponse = await makeRequest('POST', '/webhook', validEvent, {
            'x-webhook-secret': SHARED_SECRET
        });
        
        console.log(`   Status: ${webhookResponse.status}`);
        console.log(`   Response:`, webhookResponse.data);
        
        if (webhookResponse.data.ok === true && webhookResponse.data.stored === true) {
            console.log('   ✅ Valid webhook request passed\n');
        } else {
            console.log('   ❌ Valid webhook request failed\n');
            return;
        }

        // Test 3: Webhook with invalid secret
        console.log('3️⃣ Testing POST /webhook with invalid secret...');
        const invalidResponse = await makeRequest('POST', '/webhook', validEvent, {
            'x-webhook-secret': 'wrong-secret'
        });
        
        console.log(`   Status: ${invalidResponse.status}`);
        console.log(`   Response:`, invalidResponse.data);
        
        if (invalidResponse.status === 401) {
            console.log('   ✅ Invalid secret correctly rejected\n');
        } else {
            console.log('   ❌ Invalid secret not properly rejected\n');
        }

        // Test 4: Multiple events
        console.log('4️⃣ Testing multiple events...');
        const events = [
            {
                type: 'new_token',
                token_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                symbol: 'USDC',
                name: 'USD Coin'
            },
            {
                type: 'new_token',
                token_address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
                symbol: 'USDT',
                name: 'Tether USD'
            }
        ];

        for (let i = 0; i < events.length; i++) {
            const response = await makeRequest('POST', '/webhook', events[i], {
                'x-webhook-secret': SHARED_SECRET
            });
            console.log(`   Event ${i + 1}: Status ${response.status}, Stored: ${response.data.stored}`);
        }

        console.log('\n🎉 All tests completed!');
        console.log('\n📄 Check data/intake/new_tokens.jsonl to see the stored events.');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

// Run tests
runTests();
