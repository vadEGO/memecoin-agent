# 🏗️ System Architecture

## High-Level Overview

The Memecoin Agent is a real-time token detection and tracking system that ingests data from multiple sources and provides a unified interface for analysis.

## Data Flow

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Pump.fun      │    │   Helius API     │    │   Jupiter API   │
│   WebSocket     │    │   Webhooks       │    │   Webhooks      │
│   (Real-time)   │    │   (Event-based)  │    │   (Event-based) │
└─────────┬───────┘    └─────────┬────────┘    └─────────┬───────┘
          │                      │                       │
          │                      │                       │
          ▼                      ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Webhook Server                              │
│                  (webhook-server.js)                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  • Rate Limiting    • Authentication  • Validation     │   │
│  │  • Data Normalization • Error Handling • Logging       │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Data Pipeline                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   JSONL     │  │   SQLite    │  │    Deduplication        │ │
│  │   Storage   │  │   Database  │  │    (Unique Indexes)     │ │
│  │             │  │             │  │                         │ │
│  │ • Raw Data  │  │ • Structured│  │ • Signature-based       │ │
│  │ • Line-by-  │  │ • Indexed   │  │ • Composite fallback    │ │
│  │   line      │  │ • Queryable │  │ • Prevents duplicates   │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CLI Interface                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   recent    │  │recent-pump  │  │        stats            │ │
│  │   events    │  │   events    │  │      duplicates         │ │
│  │             │  │             │  │                         │ │
│  │ • All tokens│  │ • Pump.fun  │  │ • Event counts          │ │
│  │ • Filtered  │  │ • Filtered  │  │ • Source breakdown      │ │
│  │ • Paginated │  │ • Paginated │  │ • Duplicate detection   │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Data Sources
- **Pump.fun WebSocket**: Real-time token creation events
- **Helius API**: Solana blockchain events and metadata
- **Jupiter API**: Token swap and liquidity events

### 2. Webhook Server
- **Port**: 3000 (configurable)
- **Authentication**: Shared secret via `x-webhook-secret` header
- **Rate Limiting**: 60 requests per 10-second window
- **Data Processing**: Normalization, validation, and storage

### 3. Database Layer
- **SQLite**: Primary structured storage
- **JSONL**: Raw event storage for debugging
- **Deduplication**: Unique indexes prevent duplicate entries
- **Indexing**: Optimized queries for performance

### 4. CLI Interface
- **Commands**: recent, recent-pump, events, stats
- **Filtering**: Source-based and time-based filtering
- **Pagination**: Configurable result limits
- **Formatting**: Table output for readability

## Data Models

### Token Events
```sql
CREATE TABLE token_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT,
  type TEXT,
  source TEXT,
  received_at TEXT,
  raw_json TEXT,
  signature TEXT,
  UNIQUE(signature) WHERE signature IS NOT NULL,
  UNIQUE(mint, type, received_at) WHERE signature IS NULL
);
```

### Tokens
```sql
CREATE TABLE tokens (
  mint TEXT PRIMARY KEY,
  symbol TEXT,
  name TEXT,
  decimals INTEGER,
  creator TEXT,
  launch_tx TEXT,
  source TEXT,
  first_seen_at TEXT,
  last_updated_at TEXT
);
```

## Security Features

- **Rate Limiting**: Prevents abuse of webhook endpoints
- **Authentication**: Shared secret validation
- **Input Validation**: Sanitization of incoming data
- **SQL Injection Protection**: Prepared statements only
- **Error Handling**: Graceful failure without data loss

## Performance Optimizations

- **Deduplication**: Unique indexes prevent duplicate storage
- **Efficient Queries**: Proper indexing for fast lookups
- **Real-time Processing**: WebSocket for instant detection
- **Dual Storage**: JSONL for raw data, SQLite for queries
- **Connection Pooling**: Optimized database connections

## Monitoring & Observability

- **Health Endpoint**: `/health` for system status
- **Statistics Endpoint**: `/stats` for event counts
- **CLI Commands**: Real-time data inspection
- **Logging**: Comprehensive event logging
- **Error Tracking**: Detailed error reporting
