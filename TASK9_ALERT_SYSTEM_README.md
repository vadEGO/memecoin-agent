# Task 9: Scoring & Alert Rules v2

## Overview

Task 9 implements a comprehensive alert system with health scoring, anti-noise gates, and monetization tiers. The system provides real-time monitoring of token health with intelligent alerting to reduce false positives.

## Health Score Bands & Badges

### Four Health Bands

The system uses four distinct health bands with visual indicators:

| Band | Score Range | Icon | Badge | Color | Description |
|------|-------------|------|-------|-------|-------------|
| **Excellent** | 80-100 | 🟢 | EXCELLENT | Green | High-quality tokens with strong fundamentals |
| **Good** | 60-79 | 🔵 | GOOD | Blue | Solid tokens with good potential |
| **Fair** | 40-59 | 🟡 | FAIR | Yellow | Average tokens with mixed signals |
| **Poor** | 0-39 | 🔴 | POOR | Red | Low-quality tokens with concerning metrics |

### Health Score Calculation

The health score is calculated using weighted components:

- **Fresh Ratio**: +35 points max (early organic buyers)
- **Liquidity Score**: +20 points max (log scale, $1 to $1M)
- **Sniper Penalty**: -15 points max (bot/sniper activity)
- **Insider Penalty**: -20 points max (insider trading)
- **Concentration Penalty**: -10 points max (top 10 holder concentration)

**Formula**: `Health Score = Fresh Score + Liquidity Score - Sniper Penalty - Insider Penalty - Concentration Penalty`

## Alert Engine

### Three Alert Types

#### 1. Launch Alert 🚀
**Purpose**: Identify high-quality token launches
**Conditions**:
- Health score ≥ 70
- Liquidity ≥ $10,000
- Holders ≥ 50

**Debounce**: 30 minutes
**Sustain**: 0 minutes (immediate)
**Hard Mute**: Sniper% > 30%, Insider% > 20%, Top10% > 60%

#### 2. Momentum Upgrade Alert 📈
**Purpose**: Detect tokens gaining momentum
**Conditions**:
- Health score 60-79
- Fresh% ≥ 40%

**Debounce**: 15 minutes
**Sustain**: 60 minutes
**Hard Mute**: Sniper% > 40%, Insider% > 30%, Top10% > 70%

#### 3. Risk Alert ⚠️
**Purpose**: Warn about concerning token metrics
**Conditions**:
- Health score < 40 OR
- Sniper% > 50% OR
- Insider% > 40% OR
- Top10% > 80%

**Debounce**: 5 minutes
**Sustain**: 0 minutes (immediate)
**Hard Mute**: Liquidity < $1,000, Holders < 10

### Anti-Noise Gates

#### Debounce Windows
- **Launch**: 30 minutes (prevents spam from high-quality tokens)
- **Momentum**: 15 minutes (allows for trend detection)
- **Risk**: 5 minutes (quick response to concerning metrics)

#### Sustain Windows
- **Launch**: 0 minutes (immediate alerts)
- **Momentum**: 60 minutes (sustained trend confirmation)
- **Risk**: 0 minutes (immediate warnings)

#### Hard Mute Conditions
Tokens are automatically muted if they fail basic quality thresholds:
- Low liquidity (< $1,000 for risk alerts)
- Low holder count (< 10 for risk alerts)
- High sniper/insider percentages
- Excessive concentration

## Score Snapshotting

### Adaptive Snapshot Frequency

The system uses adaptive snapshot intervals based on token age:

| Token Age | Frequency | Interval | Purpose |
|-----------|-----------|----------|---------|
| **Early** | ≤ 2 hours | 5 minutes | Capture rapid changes |
| **Mid** | 2-24 hours | 15 minutes | Monitor growth patterns |
| **Late** | > 24 hours | 60 minutes | Long-term tracking |

### Snapshot Data

Each snapshot captures:
- Health score
- Holder count
- Fresh percentage
- Sniper percentage
- Insider percentage
- Top 10 share
- Liquidity USD

## CLI Commands

### Alert Commands
```bash
# Show recent alerts
npm run cli -- alerts [N]

# Show score history for a token
npm run cli -- score-history <MINT>

# Run alert engine
npm run cli -- alert-engine

# Run score snapshot worker
npm run cli -- score-snapshot
```

### Enhanced Display Commands
```bash
# Recent tokens with health badges
npm run cli -- recent [N]

# Candidates with health badges
npm run cli -- candidates [N]

# Top tokens with health badges
npm run cli -- top [N]
```

## Monetization Tiers

### Free Tier
- Basic health scoring
- Standard alert types
- 5-minute snapshot intervals
- Limited alert history (7 days)

### Pro Tier
- Advanced health scoring
- Custom alert rules
- 1-minute snapshot intervals
- Extended alert history (30 days)
- Priority processing

### Elite Tier
- Premium health scoring
- Custom alert conditions
- Real-time snapshots
- Unlimited alert history
- White-label integration
- API access

## Example Alert Messages

### Launch Alert
```
🚀 LAUNCH ALERT: PEPE (7ype...pump) • 🟢 EXCELLENT
Holders: 150 • Liq: $25.5k
Fresh: 65.2% • Snipers: 12.1% • Insiders: 8.3%
```

### Momentum Upgrade Alert
```
📈 MOMENTUM UPGRADE: DOGE (So11...1112) • 🔵 GOOD
Holders: 89 • Liq: $15.2k
Fresh: 45.8% • Snipers: 18.7% • Insiders: 15.2%
```

### Risk Alert
```
⚠️ RISK ALERT: SCAM (9xyz...abc) • 🔴 POOR
Holders: 25 • Liq: $2.1k
Fresh: 12.3% • Snipers: 65.4% • Insiders: 45.2%
```

## Database Schema

### Alerts Table
```sql
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  alert_level TEXT NOT NULL,
  message TEXT NOT NULL,
  triggered_at TEXT NOT NULL,
  resolved_at TEXT,
  status TEXT DEFAULT 'active',
  metadata TEXT,
  UNIQUE(mint, alert_type, triggered_at)
);
```

### Score History Table
```sql
CREATE TABLE score_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  snapshot_time TEXT NOT NULL,
  health_score REAL,
  holders_count INTEGER,
  fresh_pct REAL,
  sniper_pct REAL,
  insider_pct REAL,
  top10_share REAL,
  liquidity_usd REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(mint, snapshot_time)
);
```

### Alert Rules Table
```sql
CREATE TABLE alert_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_name TEXT UNIQUE NOT NULL,
  alert_type TEXT NOT NULL,
  conditions TEXT NOT NULL,
  thresholds TEXT NOT NULL,
  debounce_minutes INTEGER DEFAULT 0,
  sustain_minutes INTEGER DEFAULT 0,
  hard_mute_conditions TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

## Configuration

### Alert Rule Configuration
Alert rules are stored in the database and can be modified via SQL:

```sql
-- Update launch alert thresholds
UPDATE alert_rules 
SET thresholds = '{"health_min": 75, "liquidity_min": 15000, "holders_min": 75}'
WHERE rule_name = 'launch_alert';

-- Modify debounce window
UPDATE alert_rules 
SET debounce_minutes = 45
WHERE rule_name = 'launch_alert';
```

### Hard Mute Configuration
```sql
-- Update hard mute conditions
UPDATE alert_rules 
SET hard_mute_conditions = '{"sniper_pct_max": 25, "insider_pct_max": 15, "top10_share_max": 0.5}'
WHERE rule_name = 'launch_alert';
```

## Performance Considerations

### Indexing
- `idx_alerts_mint_type` on alerts table
- `idx_alerts_triggered_at` on alerts table
- `idx_score_history_mint_time` on score_history table
- `idx_score_history_snapshot_time` on score_history table

### Cleanup
- Alerts older than 7 days are automatically cleaned up
- Score history older than 30 days is automatically cleaned up
- Alert history is maintained for debounce/sustain logic

## Monitoring

### Health Score Distribution
```bash
# View health score statistics
npm run cli -- stats
```

### Alert Statistics
```bash
# View recent alerts
npm run cli -- alerts 50
```

### Score History Analysis
```bash
# View score history for specific token
npm run cli -- score-history <MINT>
```

## Troubleshooting

### Common Issues

1. **No alerts triggering**
   - Check if tokens meet minimum thresholds
   - Verify alert rules are active
   - Check debounce windows

2. **Too many alerts**
   - Adjust hard mute conditions
   - Increase debounce windows
   - Tighten alert thresholds

3. **Missing score history**
   - Ensure score snapshot worker is running
   - Check token age for snapshot frequency
   - Verify database permissions

### Debug Commands
```bash
# Check alert rules
sqlite3 db/agent.db "SELECT * FROM alert_rules WHERE is_active = 1;"

# Check recent alerts
sqlite3 db/agent.db "SELECT * FROM alerts ORDER BY triggered_at DESC LIMIT 10;"

# Check score history
sqlite3 db/agent.db "SELECT COUNT(*) FROM score_history;"
```

## Future Enhancements

- Machine learning-based threshold adjustment
- Custom alert channels (Discord, Telegram, email)
- Advanced charting and visualization
- Portfolio tracking and alerts
- Social sentiment integration
- Cross-chain token support
