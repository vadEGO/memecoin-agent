const express = require('express');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const rateLimit = require('express-rate-limit');
const { saveToken, saveEvent } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration - use environment variables
const SHARED_SECRET = process.env.WEBHOOK_SECRET || 'your-secret-key-here';
const DATA_DIR = path.join(__dirname, 'data', 'intake');
const JSONL_FILE = path.join(DATA_DIR, 'new_tokens.jsonl');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Security middleware
app.use('/webhook', rateLimit({ 
    windowMs: 10_000, // 10 seconds
    max: 60, // limit each IP to 60 requests per windowMs
    message: { ok: false, error: 'Too many requests' }
}));

// Body parsing with size limit
app.use(express.json({ limit: '256kb' }));

// Helper function to append to JSONL file
function appendToJsonl(data) {
    const jsonLine = JSON.stringify(data) + '\n';
    fs.appendFileSync(JSONL_FILE, jsonLine, 'utf8');
}

// Helper function to validate shared secret
function validateSecret(req) {
    const providedSecret = req.headers['x-webhook-secret'] || req.headers['authorization'];
    return providedSecret === SHARED_SECRET;
}

// Helius payload normalization
function normalizeHelius(body) {
    const out = { source: 'helius', type: body.type || 'unknown' };

    // Try to find a mint address from enhanced events
    const tokenEvt = body?.events?.token || {};
    const defiEvt = body?.events?.defi || {};
    const mint =
        tokenEvt?.mint ||
        tokenEvt?.tokenAccount ||
        defiEvt?.mint ||
        body?.mint ||
        null;

    const symbol = tokenEvt?.symbol || null;
    const name = tokenEvt?.name || null;
    const decimals = Number.isFinite(tokenEvt?.decimals) ? tokenEvt.decimals : null;

    return {
        ...out,
        mint,
        symbol,
        name,
        decimals,
        creator: tokenEvt?.owner || null,
        launchTx: body.signature || null,
        createdAt: body?.timestamp ? new Date(body.timestamp * 1000).toISOString() : null
    };
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ ok: true });
});

// Stats endpoint for monitoring
app.get('/stats', async (req, res) => {
    try {
        const { getEventStats } = require('./db');
        const stats = getEventStats();
        res.json({ 
            ok: true, 
            stats,
            total_events: stats.reduce((sum, stat) => sum + stat.count, 0)
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Failed to get stats' });
    }
});

// Webhook endpoint
app.post('/webhook', (req, res) => {
    try {
        // Validate shared secret
        if (!validateSecret(req)) {
            return res.status(401).json({ 
                ok: false, 
                error: 'Invalid or missing shared secret' 
            });
        }

        // Get the event data from request body
        const eventData = req.body;
        
        // Normalize Helius payload if it's from Helius
        let normalized = {};
        if (req.body && (req.body.events || req.body.signature)) {
            normalized = normalizeHelius(req.body);
        }

        // Extract signature for deduplication
        const signature = req.body.signature || req.body.txHash || null;

        // Add timestamp to the event
        const timestampedEvent = {
            ...eventData,
            timestamp: new Date().toISOString(),
            received_at: Date.now(),
            normalized: normalized,
            signature: signature
        };

        // Append to JSONL file (audit trail)
        appendToJsonl(timestampedEvent);

        // Extract data for SQLite
        const nowIso = new Date().toISOString();
        const mint = normalized.mint || req.body.mint || req.body.token_address || 'unknown';
        const creator = normalized.creator || req.body.creator || null;
        const decimals = normalized.decimals ?? (typeof req.body?.metadata?.decimals === 'number' ? req.body.metadata.decimals : null);

        // Save to SQLite - Token upsert
        saveToken({
            mint,
            symbol: normalized.symbol || req.body?.metadata?.symbol || req.body.symbol || null,
            name: normalized.name || req.body?.metadata?.name || req.body.name || null,
            decimals,
            creator,
            launch_tx: normalized.launchTx || req.body.launchTx || signature,
            source: normalized.source || req.body.source || 'unknown',
            first_seen_at: normalized.createdAt || req.body.createdAt || nowIso,
            last_updated_at: nowIso,
        });

        // Save to SQLite - Event insert with deduplication
        const eventResult = saveEvent({
            mint,
            type: normalized.type || req.body.type || 'unknown',
            source: normalized.source || req.body.source || 'unknown',
            received_at: nowIso,
            raw_json: JSON.stringify(req.body),
            signature: signature
        });

        console.log(`✅ New token event received and stored:`, {
            timestamp: timestampedEvent.timestamp,
            event_type: normalized.type || eventData.type || 'unknown',
            token_address: mint,
            source: normalized.source || req.body.source || 'unknown',
            signature: signature ? `${signature.substring(0, 8)}...` : 'none',
            is_helius: !!(req.body.events || req.body.signature),
            stored: eventResult.changes > 0 ? 'yes' : 'duplicate'
        });

        res.json({ 
            ok: true, 
            stored: eventResult.changes > 0,
            duplicate: eventResult.changes === 0,
            timestamp: timestampedEvent.timestamp,
            signature: signature
        });

    } catch (error) {
        console.error('❌ Error processing webhook:', error);
        res.status(500).json({ 
            ok: false, 
            error: 'Internal server error' 
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Webhook server running on port ${PORT}`);
    console.log(`📁 Data directory: ${DATA_DIR}`);
    console.log(`📄 JSONL file: ${JSONL_FILE}`);
    console.log(`🗄️  SQLite DB: db/agent.db`);
    console.log(`🔐 Shared secret: ${SHARED_SECRET.substring(0, 8)}...`);
    console.log(`\n📋 Available endpoints:`);
    console.log(`   GET  /health - Health check`);
    console.log(`   GET  /stats - Event statistics`);
    console.log(`   POST /webhook - Receive token events (requires x-webhook-secret header)`);
    console.log(`\n🔧 Test with curl:`);
    console.log(`   curl -X GET http://localhost:${PORT}/health`);
    console.log(`   curl -X GET http://localhost:${PORT}/stats`);
    console.log(`   curl -X POST http://localhost:${PORT}/webhook \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -H "x-webhook-secret: ${SHARED_SECRET}" \\`);
    console.log(`     -d '{"type":"new_token","token_address":"ABC123","symbol":"TEST"}'`);
    console.log(`\n🌐 To expose publicly, run: node start-tunnel.js`);
    console.log(`\n⚠️  Make sure to set your environment variables:`);
    console.log(`   export WEBHOOK_SECRET=your-secret-key-here`);
    console.log(`   export HELIUS_API_KEY=your-helius-api-key`);
    console.log(`\n🔍 Deduplication enabled:`);
    console.log(`   - By (mint, type, received_at)`);
    console.log(`   - By (signature, type)`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down webhook server...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down webhook server...');
    process.exit(0);
});
