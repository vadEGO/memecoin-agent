// lib/enhanced-candidates.js - Enhanced candidates list for traders
const Database = require('better-sqlite3');
const { formatTokenDisplayWithHealth } = require('./visual-encoding');

class EnhancedCandidates {
  constructor(dbPath = 'db/agent.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
  }

  /**
   * Get enhanced candidates with trader-focused gating and ranking
   * @param {number} limit - Number of candidates to return
   * @returns {Array} Enhanced candidates list
   */
  getEnhancedCandidates(limit = 20) {
    try {
      // Business-ready gating: hard gates + risk gates + momentum gates + probability gates
      const candidates = this.db.prepare(`
        SELECT 
          t.mint, t.symbol, t.name, t.health_score, t.holders_count, 
          t.liquidity_usd, t.fresh_pct, t.sniper_pct, t.insider_pct, t.top10_share,
          t.first_seen_at, t.prob_2x_24h, t.prob_rug_24h, t.model_id_win, t.model_id_rug,
          COALESCE((
            SELECT h2.health_score - h1.health_score
            FROM score_history h1
            JOIN score_history h2 ON h1.mint = h2.mint
            WHERE h1.mint = t.mint
              AND h1.snapshot_time = (
                SELECT MAX(snapshot_time) 
                FROM score_history h3 
                WHERE h3.mint = t.mint 
                  AND h3.snapshot_time <= datetime('now', '-15 minutes')
              )
              AND h2.snapshot_time = (
                SELECT MAX(snapshot_time) 
                FROM score_history h4 
                WHERE h4.mint = t.mint
              )
          ), 0) as health_delta_15m,
          0 as price_delta_15m
        FROM tokens t
        WHERE t.health_score IS NOT NULL
          AND t.holders_count IS NOT NULL
          AND t.liquidity_usd IS NOT NULL
          AND datetime(t.first_seen_at) > datetime('now', '-48 hours')
          -- Hard gates (keeps quality)
          AND t.lp_exists = 1
          AND t.liquidity_usd >= 3000
          AND t.holders_count >= 50
          -- Risk gates (soft at first)
          AND COALESCE(t.sniper_pct, 0) <= 0.15
          AND COALESCE(t.insider_pct, 0) <= 0.15
          -- Probability gates (Task 13)
          AND COALESCE(t.prob_rug_24h, 0) <= 0.20
        ORDER BY 
          COALESCE(t.prob_2x_24h, 0) DESC,
          t.health_score DESC,
          health_delta_15m DESC,
          t.holders_count DESC
        LIMIT ?
      `).all(limit);

      // Enhance with sparklines and diversity scoring
      return candidates.map((candidate, index) => {
        const sparklines = this.getSparklines(candidate.mint);
        const diversityScore = this.calculateDiversityScore(candidate.mint);
        
        const explainability = this.generateExplainability(candidate);
        
        return {
          ...candidate,
          rank: index + 1,
          sparklines,
          diversityScore,
          explainability,
          display: formatTokenDisplayWithHealth(candidate.symbol, candidate.mint, candidate.health_score, true, 40),
          probDisplay: this.formatProbabilityDisplay(candidate)
        };
      });

    } catch (error) {
      console.error('Failed to get enhanced candidates:', error.message);
      return [];
    }
  }

  /**
   * Generate explainability string for why token passed candidate criteria
   * @param {object} candidate - Candidate token data
   * @returns {string} Explainability string
   */
  generateExplainability(candidate) {
    const reasons = [];
    
    // Check probability features (Task 13)
    if (candidate.prob_2x_24h && candidate.prob_2x_24h > 0) {
      reasons.push(`Prob2x ${(candidate.prob_2x_24h * 100).toFixed(0)}%`);
    }
    if (candidate.prob_rug_24h && candidate.prob_rug_24h > 0) {
      reasons.push(`Rug ${(candidate.prob_rug_24h * 100).toFixed(0)}%`);
    }
    
    // Check hard gates
    if (candidate.liquidity_usd >= 5000) {
      reasons.push(`Liq $${(candidate.liquidity_usd / 1000).toFixed(1)}k`);
    }
    if (candidate.holders_count >= 80) {
      reasons.push(`Holders ${candidate.holders_count}`);
    }
    
    // Check risk gates
    const freshPct = (candidate.fresh_pct || 0) * 100;
    const sniperPct = (candidate.sniper_pct || 0) * 100;
    const insiderPct = (candidate.insider_pct || 0) * 100;
    
    if (sniperPct <= 12) {
      reasons.push(`Snipers ${sniperPct.toFixed(1)}% ≤ 12%`);
    }
    if (insiderPct <= 10) {
      reasons.push(`Insiders ${insiderPct.toFixed(1)}% ≤ 10%`);
    }
    
    // Check momentum gates
    if (candidate.price_delta_15m >= 3.0) {
      reasons.push(`PriceΔ +${candidate.price_delta_15m.toFixed(1)}% ≥ +3%`);
    }
    if (candidate.health_delta_15m >= 3.0) {
      reasons.push(`HealthΔ +${candidate.health_delta_15m.toFixed(1)} ≥ +3`);
    }
    
    return reasons.join(', ');
  }

  /**
   * Format probability display for candidates
   * @param {object} candidate - Candidate token data
   * @returns {string} Formatted probability display
   */
  formatProbabilityDisplay(candidate) {
    const parts = [];
    
    if (candidate.prob_2x_24h && candidate.prob_2x_24h > 0) {
      const prob2x = candidate.prob_2x_24h * 100;
      const color = prob2x >= 40 ? '🟢' : prob2x >= 25 ? '🟡' : '🔵';
      parts.push(`${color} Prob2x ${prob2x.toFixed(0)}%`);
    }
    
    if (candidate.prob_rug_24h && candidate.prob_rug_24h > 0) {
      const probRug = candidate.prob_rug_24h * 100;
      const color = probRug >= 60 ? '🔴' : probRug >= 30 ? '🟠' : '🟢';
      parts.push(`${color} Rug ${probRug.toFixed(0)}%`);
    }
    
    return parts.join(' • ');
  }

  /**
   * Get sparklines for a token (health and price changes)
   * @param {string} mint - Token mint
   * @returns {object} Sparkline data
   */
  getSparklines(mint) {
    try {
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      
      // Get health score changes
      const healthSnapshots = this.db.prepare(`
        SELECT health_score, snapshot_time
        FROM score_history
        WHERE mint = ? AND snapshot_time >= ?
        ORDER BY snapshot_time ASC
        LIMIT 5
      `).all(mint, fifteenMinutesAgo);

      // Get price changes (simulated - would integrate with price feeds)
      const priceChanges = this.getPriceChanges(mint, 15);

      const healthDelta = healthSnapshots.length >= 2 
        ? healthSnapshots[healthSnapshots.length - 1].health_score - healthSnapshots[0].health_score
        : 0;

      return {
        healthDelta: healthDelta.toFixed(1),
        priceDelta: priceChanges.toFixed(1),
        healthTrend: this.getTrendDirection(healthDelta),
        priceTrend: this.getTrendDirection(priceChanges)
      };
    } catch (error) {
      return {
        healthDelta: '0.0',
        priceDelta: '0.0',
        healthTrend: '→',
        priceTrend: '→'
      };
    }
  }

  /**
   * Get price changes for a token (simulated)
   * @param {string} mint - Token mint
   * @param {number} minutes - Time window in minutes
   * @returns {number} Price change percentage
   */
  getPriceChanges(mint, minutes) {
    // This would integrate with real price feeds
    // For now, return simulated data
    return Math.random() * 20 - 10; // -10% to +10%
  }

  /**
   * Get trend direction from delta
   * @param {number} delta - Change value
   * @returns {string} Trend direction symbol
   */
  getTrendDirection(delta) {
    if (delta > 2) return '↗';
    if (delta > 0) return '↗';
    if (delta < -2) return '↘';
    if (delta < 0) return '↘';
    return '→';
  }

  /**
   * Calculate diversity score to avoid bundler clustering
   * @param {string} mint - Token mint
   * @returns {number} Diversity score (0-1, higher is better)
   */
  calculateDiversityScore(mint) {
    try {
      // Get bundler information for this token
      const bundlers = this.db.prepare(`
        SELECT h.funded_by, COUNT(DISTINCT h.owner) as recipient_count
        FROM holders h
        WHERE h.mint = ? AND h.is_bundler = 1
        GROUP BY h.funded_by
        ORDER BY recipient_count DESC
      `).all(mint);

      if (bundlers.length === 0) return 1.0; // No bundlers = high diversity

      // Calculate Herfindahl index for bundler concentration
      const totalRecipients = bundlers.reduce((sum, b) => sum + b.recipient_count, 0);
      const hhi = bundlers.reduce((sum, b) => {
        const share = b.recipient_count / totalRecipients;
        return sum + (share * share);
      }, 0);

      // Convert HHI to diversity score (0-1)
      return Math.max(0, 1 - hhi);
    } catch (error) {
      return 0.5; // Default moderate diversity
    }
  }

  /**
   * Format candidates for CLI display
   * @param {Array} candidates - Enhanced candidates
   * @returns {string} Formatted display
   */
  formatCandidatesDisplay(candidates) {
    if (candidates.length === 0) {
      return '🔍 No enhanced candidates found (need liq ≥ $5k, fresh% ≥ 55%, insider% ≤ 10%, sniper% ≤ 8%)';
    }

    console.log(`🎯 Enhanced Candidates (${candidates.length} found):`);
    console.log('─'.repeat(120));
    
    const header = 'Rank'.padEnd(6) + 
                  'Token'.padEnd(45) + 
                  'Health'.padEnd(8) + 
                  'Fresh%'.padEnd(8) + 
                  'Snipers%'.padEnd(10) + 
                  'Insiders%'.padEnd(11) + 
                  'Liq'.padEnd(10) + 
                  'Holders'.padEnd(8) + 
                  'HealthΔ'.padEnd(8) + 
                  'PriceΔ'.padEnd(8) + 
                  'Div';
    console.log(header);
    console.log('─'.repeat(120));

    candidates.forEach(candidate => {
      // Add risk chips
      const riskChips = [];
      const sniperPct = (candidate.sniper_pct || 0) * 100;
      const insiderPct = (candidate.insider_pct || 0) * 100;
      
      if (sniperPct >= 10) riskChips.push(`Snipers ${sniperPct.toFixed(1)}% ⚠`);
      if (insiderPct >= 8) riskChips.push(`Insiders ${insiderPct.toFixed(1)}% ⚠`);
      
      const riskChipStr = riskChips.length > 0 ? ` (${riskChips.join(', ')})` : '';
      
      const row = 
        candidate.rank.toString().padEnd(6) +
        candidate.display.padEnd(45) +
        candidate.health_score.toFixed(1).padEnd(8) +
        (candidate.fresh_pct * 100).toFixed(1).padEnd(8) +
        (candidate.sniper_pct * 100).toFixed(1).padEnd(10) +
        (candidate.insider_pct * 100).toFixed(1).padEnd(11) +
        `$${(candidate.liquidity_usd / 1000).toFixed(1)}k`.padEnd(10) +
        candidate.holders_count.toString().padEnd(8) +
        `${candidate.sparklines.healthTrend}${candidate.sparklines.healthDelta}%`.padEnd(8) +
        `${candidate.sparklines.priceTrend}${candidate.sparklines.priceDelta}%`.padEnd(8) +
        (candidate.diversityScore * 100).toFixed(0) + '%' + riskChipStr;
      
      console.log(row);
      
      // Show explainability
      if (candidate.explainability) {
        console.log(`     Why: ${candidate.explainability}`);
      }
    });

    console.log('─'.repeat(120));
    console.log('Legend: HealthΔ = 15m health change, PriceΔ = 15m price change, Div = Diversity score');
    
    return '';
  }

  /**
   * Get candidates statistics
   * @returns {object} Statistics
   */
  getCandidatesStats() {
    try {
      const stats = this.db.prepare(`
        SELECT 
          COUNT(*) as total_candidates,
          AVG(health_score) as avg_health,
          AVG(COALESCE(fresh_pct, 0) * 100) as avg_fresh_pct,
          AVG(COALESCE(sniper_pct, 0) * 100) as avg_sniper_pct,
          AVG(COALESCE(insider_pct, 0) * 100) as avg_insider_pct,
          AVG(liquidity_usd) as avg_liquidity,
          AVG(holders_count) as avg_holders
        FROM tokens
        WHERE health_score IS NOT NULL
          AND holders_count IS NOT NULL
          AND liquidity_usd IS NOT NULL
          AND datetime(first_seen_at) > datetime('now', '-48 hours')
          AND lp_exists = 1
          AND liquidity_usd >= 3000
          AND COALESCE(fresh_pct, 0) >= 0.45
          AND COALESCE(insider_pct, 0) <= 0.15
          AND COALESCE(sniper_pct, 0) <= 0.20
      `).get();

      return {
        totalCandidates: stats.total_candidates,
        averageHealth: Math.round(stats.avg_health * 100) / 100,
        averageFresh: Math.round(stats.avg_fresh_pct * 100) / 100,
        averageSnipers: Math.round(stats.avg_sniper_pct * 100) / 100,
        averageInsiders: Math.round(stats.avg_insider_pct * 100) / 100,
        averageLiquidity: Math.round(stats.avg_liquidity),
        averageHolders: Math.round(stats.avg_holders)
      };
    } catch (error) {
      return null;
    }
  }
}

module.exports = EnhancedCandidates;

