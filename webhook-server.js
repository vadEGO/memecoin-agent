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

// Structured logging
function log(level, event, data = {}) {
    console.log(JSON.stringify({
        lvl: level,
        at: 'webhook-server',
        event,
        ts: Date.now(),
        ...data
    }));
}

// Security middleware
app.use('/webhook', rateLimit({ 
    windowMs: 10_000, // 10 seconds
    max: 60, // limit each IP to 60 requests per windowMs
    message: { ok: false, error: 'Too many requests' }
}));

// Body parsing with size limit
app.use(express.json({ limit: '256kb' }));

// Content-Type validation middleware
app.use('/webhook', (req, res, next) => {
    if (req.method === 'POST' && !req.is('application/json')) {
        log('warn', 'invalid_content_type', { 
            contentType: req.get('Content-Type'),
            ip: req.ip 
        });
        return res.status(400).json({ 
            ok: false, 
            error: 'Content-Type must be application/json' 
        });
    }
    next();
});

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

// Clock hygiene - normalize to ISO 8601 UTC
function normalizeTimestamp(timestamp) {
    if (!timestamp) return new Date().toISOString();
    
    try {
        // If it's already ISO format, return as-is
        if (typeof timestamp === 'string' && timestamp.includes('T')) {
            return new Date(timestamp).toISOString();
        }
        
        // If it's a number (Unix timestamp), convert
        if (typeof timestamp === 'number') {
            return new Date(timestamp * 1000).toISOString();
        }
        
        // Default to current time
        return new Date().toISOString();
    } catch (e) {
        return new Date().toISOString();
    }
}

// Helius payload normalization
function normalizeHelius(body) {
    const out = { source: 'helius', type: body.type || 'unknown' };

    // Try to find a mint address from enhanced events
    const tokenEvt = body?.events?.token || {};
    const defiEvt = body?.events?.defi || {};
    const mint =
        tokenEvt.mint ||
        defiEvt.mint ||
        body.mint ||
        body.tokenAddress ||
        body.token_address;

    if (!mint) {
        log('warn', 'no_mint_found', { source: 'helius', type: body.type });
        return null;
    }

    out.mint = mint;
    out.symbol = tokenEvt.symbol || body.symbol || null;
    out.name = tokenEvt.name || body.name || null;
    out.decimals = tokenEvt.decimals || body.decimals || null;
    out.creator = tokenEvt.creator || body.creator || null;
    out.launchTx = body.signature || body.tx || null;
    out.createdAt = normalizeTimestamp(body.timestamp || body.createdAt);

    return out;
}

// Generic payload normalization
function normalizePayload(body) {
    // Try Helius first
    if (body.events || body.signature) {
        return normalizeHelius(body);
    }

    // Generic fallback
    const mint = body.mint || body.tokenAddress || body.token_address;
    if (!mint) {
        log('warn', 'no_mint_found', { source: body.source || 'unknown' });
        return null;
    }

    return {
        source: body.source || 'unknown',
        type: body.type || 'unknown',
        mint,
        symbol: body.symbol || null,
        name: body.name || null,
        decimals: body.decimals || null,
        creator: body.creator || null,
        launchTx: body.signature || body.tx || null,
        createdAt: normalizeTimestamp(body.timestamp || body.createdAt)
    };
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Stats endpoint
app.get('/stats', (req, res) => {
    try {
        const { getEventStats } = require('./db');
        const stats = getEventStats();
        res.json({ ok: true, stats });
    } catch (error) {
        log('error', 'stats_failed', { error: error.message });
        res.status(500).json({ ok: false, error: 'Failed to get stats' });
    }
});

// Main webhook endpoint
app.post('/webhook', (req, res) => {
    const startTime = Date.now();
    
    try {
        // Validate shared secret
        if (!validateSecret(req)) {
            log('warn', 'invalid_secret', { ip: req.ip });
            return res.status(401).json({ 
                ok: false, 
                error: 'Invalid webhook secret' 
            });
        }

        // Normalize payload
        const normalized = normalizePayload(req.body);
        if (!normalized) {
            log('warn', 'invalid_payload', { 
                ip: req.ip,
                bodyKeys: Object.keys(req.body)
            });
            return res.status(400).json({ 
                ok: false, 
                error: 'Invalid payload - missing mint address' 
            });
        }

        const { mint, source, type } = normalized;
        const nowIso = new Date().toISOString();

        // Create timestamped event
        const timestampedEvent = {
            timestamp: nowIso,
            event_type: type,
            token_address: mint,
            source,
            signature: normalized.launchTx ? normalized.launchTx.substring(0, 8) + '...' : 'none',
            is_helius: !!(req.body.events || req.body.signature)
        };

        // Save to JSONL
        appendToJsonl(timestampedEvent);

        // Save to SQLite - Token upsert
        const tokenResult = saveToken({
            mint,
            symbol: normalized.symbol,
            name: normalized.name,
            decimals: normalized.decimals,
            creator: normalized.creator,
            launch_tx: normalized.launchTx,
            source,
            first_seen_at: normalized.createdAt || nowIso,
            last_updated_at: nowIso,
        });

        // Save to SQLite - Event insert with deduplication
        const eventResult = saveEvent({
            mint,
            type,
            source,
            received_at: nowIso,
            raw_json: JSON.stringify(req.body),
            signature: normalized.launchTx || null
        });

        const processingTime = Date.now() - startTime;
        
        log('info', 'event_stored', {
            source,
            mint: mint.substring(0, 8) + '...',
            type,
            stored: eventResult.changes > 0,
            duplicate: eventResult.changes === 0,
            processingTime
        });

        res.json({ 
            ok: true, 
            stored: eventResult.changes > 0,
            duplicate: eventResult.changes === 0,
            timestamp: timestampedEvent.timestamp,
            signature: normalized.launchTx
        });

    } catch (error) {
        const processingTime = Date.now() - startTime;
        log('error', 'webhook_processing_failed', { 
            error: error.message,
            processingTime,
            ip: req.ip
        });
        res.status(500).json({ 
            ok: false, 
            error: 'Internal server error' 
        });
    }
});

// Start server
app.listen(PORT, () => {
    log('info', 'server_started', { 
        port: PORT,
        dataDir: DATA_DIR,
        jsonlFile: JSONL_FILE
    });
});
