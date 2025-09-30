// lib/diagnostics.js - Diagnostic commands for Task 9/10 debugging
const Database = require('better-sqlite3');

class Diagnostics {
  constructor(dbPath = 'db/agent.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
  }

  /**
   * Show data gaps - counts of tokens missing key features
   * @returns {object} Data gap statistics
   */
  getDataGaps() {
    try {
      const gaps = this.db.prepare(`
        SELECT 
          COUNT(*) as total_tokens,
          COUNT(CASE WHEN liquidity_usd IS NULL THEN 1 END) as missing_liquidity,
          COUNT(CASE WHEN holders_count IS NULL THEN 1 END) as missing_holders,
          COUNT(CASE WHEN fresh_pct IS NULL THEN 1 END) as missing_fresh_pct,
          COUNT(CASE WHEN sniper_pct IS NULL THEN 1 END) as missing_sniper_pct,
          COUNT(CASE WHEN insider_pct IS NULL THEN 1 END) as missing_insider_pct,
          COUNT(CASE WHEN top10_share IS NULL THEN 1 END) as missing_top10_share,
          COUNT(CASE WHEN health_score IS NULL THEN 1 END) as missing_health_score,
          COUNT(CASE WHEN lp_exists = 1 AND liquidity_usd IS NOT NULL THEN 1 END) as has_liquidity_data,
          COUNT(CASE WHEN datetime(first_seen_at) > datetime('now', '-24 hours') THEN 1 END) as recent_tokens_24h,
          COUNT(CASE WHEN datetime(first_seen_at) > datetime('now', '-48 hours') THEN 1 END) as recent_tokens_48h
        FROM tokens
      `).get();

      // Get eligible cohort count
      const eligible = this.db.prepare(`
        SELECT COUNT(*) as eligible_recent_24h
        FROM tokens
        WHERE datetime(first_seen_at) > datetime('now', '-24 hours')
          AND lp_exists = 1
          AND holders_count IS NOT NULL
          AND (fresh_pct IS NOT NULL OR fresh_wallets_count IS NOT NULL)
      `).get();

      // Get enrichment success rates
      const enrichment = this.db.prepare(`
        SELECT 
          COUNT(*) as total_attempts,
          COUNT(CASE WHEN enrich_error IS NULL THEN 1 END) as successful_attempts,
          COUNT(CASE WHEN liquidity_usd IS NOT NULL THEN 1 END) as liquidity_success,
          COUNT(CASE WHEN holders_count IS NOT NULL THEN 1 END) as holders_success,
          COUNT(CASE WHEN fresh_pct IS NOT NULL THEN 1 END) as fresh_success
        FROM tokens
        WHERE last_enriched_at IS NOT NULL
      `).get();

      return {
        totalTokens: gaps.total_tokens,
        missingLiquidity: gaps.missing_liquidity,
        missingHolders: gaps.missing_holders,
        missingFreshPct: gaps.missing_fresh_pct,
        missingSniperPct: gaps.missing_sniper_pct,
        missingInsiderPct: gaps.missing_insider_pct,
        missingTop10Share: gaps.missing_top10_share,
        missingHealthScore: gaps.missing_health_score,
        hasLiquidityData: gaps.has_liquidity_data,
        recentTokens24h: gaps.recent_tokens_24h,
        recentTokens48h: gaps.recent_tokens_48h,
        eligibleRecent24h: eligible.eligible_recent_24h,
        enrichmentSuccessRate: enrichment.total_attempts > 0 ? 
          (enrichment.successful_attempts / enrichment.total_attempts * 100).toFixed(1) : 0,
        liquiditySuccessRate: enrichment.total_attempts > 0 ? 
          (enrichment.liquidity_success / enrichment.total_attempts * 100).toFixed(1) : 0,
        holdersSuccessRate: enrichment.total_attempts > 0 ? 
          (enrichment.holders_success / enrichment.total_attempts * 100).toFixed(1) : 0,
        freshSuccessRate: enrichment.total_attempts > 0 ? 
          (enrichment.fresh_success / enrichment.total_attempts * 100).toFixed(1) : 0
      };
    } catch (error) {
      console.error('Failed to get data gaps:', error.message);
      return null;
    }
  }

  /**
   * Show health analysis for eligible cohort only
   * @returns {object} Health analysis for scoreable tokens
   */
  getHealthAnalysisEligible() {
    try {
      // Get eligible tokens (recent, LP exists, has holders)
      const eligible = this.db.prepare(`
        SELECT 
          COUNT(*) as eligible_count,
          AVG(health_score) as avg_health,
          MIN(health_score) as min_health,
          MAX(health_score) as max_health,
          COUNT(CASE WHEN health_score >= 80 THEN 1 END) as excellent_count,
          COUNT(CASE WHEN health_score >= 60 AND health_score < 80 THEN 1 END) as good_count,
          COUNT(CASE WHEN health_score >= 40 AND health_score < 60 THEN 1 END) as fair_count,
          COUNT(CASE WHEN health_score < 40 THEN 1 END) as poor_count
        FROM tokens
        WHERE datetime(first_seen_at) > datetime('now', '-48 hours')
          AND lp_exists = 1
          AND holders_count IS NOT NULL
          AND (fresh_pct IS NOT NULL OR fresh_wallets_count IS NOT NULL)
          AND health_score IS NOT NULL
      `).get();

      // Get score distribution buckets
      const buckets = this.db.prepare(`
        SELECT 
          ROUND(health_score/10)*10 AS bucket, 
          COUNT(*) as count
        FROM tokens
        WHERE health_score IS NOT NULL
          AND datetime(first_seen_at) > datetime('now', '-48 hours')
          AND lp_exists = 1
          AND holders_count IS NOT NULL
        GROUP BY bucket 
        ORDER BY bucket
      `).all();

      return {
        eligible,
        buckets
      };
    } catch (error) {
      console.error('Failed to get health analysis:', error.message);
      return null;
    }
  }

  /**
   * Show why a specific mint is not a candidate
   * @param {string} mint - Token mint address
   * @returns {object} Analysis of why token fails candidate criteria
   */
  whyNotCandidate(mint) {
    try {
      const token = this.db.prepare(`
        SELECT 
          mint, symbol, health_score, holders_count, liquidity_usd, 
          fresh_pct, sniper_pct, insider_pct, top10_share,
          first_seen_at, lp_exists
        FROM tokens
        WHERE mint = ?
      `).get(mint);

      if (!token) {
        return { error: 'Token not found' };
      }

      const reasons = [];
      
      // Check each criterion
      if (!token.health_score) reasons.push('Missing health_score');
      if (!token.holders_count) reasons.push('Missing holders_count');
      if (!token.liquidity_usd) reasons.push('Missing liquidity_usd');
      
      const ageHours = (new Date() - new Date(token.first_seen_at)) / (1000 * 60 * 60);
      if (ageHours > 24) reasons.push(`Too old (${ageHours.toFixed(1)}h ago)`);
      
      if (token.lp_exists !== 1) reasons.push('No LP exists');
      if (token.liquidity_usd < 3000) reasons.push(`Liquidity too low ($${token.liquidity_usd?.toFixed(0) || 'NULL'})`);
      
      const freshPct = token.fresh_pct || 0;
      if (freshPct < 0.45) reasons.push(`Fresh% too low (${(freshPct * 100).toFixed(1)}%)`);
      
      const sniperPct = token.sniper_pct || 0;
      if (sniperPct > 0.12) reasons.push(`Sniper% too high (${(sniperPct * 100).toFixed(1)}%)`);
      
      const insiderPct = token.insider_pct || 0;
      if (insiderPct > 0.15) reasons.push(`Insider% too high (${(insiderPct * 100).toFixed(1)}%)`);

      return {
        token,
        reasons,
        isCandidate: reasons.length === 0
      };
    } catch (error) {
      console.error('Failed to analyze token:', error.message);
      return { error: error.message };
    }
  }

  /**
   * Get validation queries results
   * @returns {object} Validation statistics
   */
  getValidationStats() {
    try {
      // How many are actually scoreable now?
      const scoreable = this.db.prepare(`
        SELECT COUNT(*) AS eligible
        FROM tokens
        WHERE lp_exists=1
          AND liquidity_usd IS NOT NULL
          AND holders_count IS NOT NULL
          AND datetime(first_seen_at) > datetime('now', '-24 hours')
      `).get();

      // What's the new score distribution?
      const scoreDist = this.db.prepare(`
        SELECT
          ROUND(health_score/10)*10 AS bucket, COUNT(*) cnt
        FROM tokens
        WHERE health_score IS NOT NULL
          AND datetime(first_seen_at) > datetime('now', '-24 hours')
        GROUP BY bucket ORDER BY bucket
      `).all();

      // Do candidates exist now?
      const candidates = this.db.prepare(`
        SELECT mint, symbol, health_score, liquidity_usd, fresh_pct, sniper_pct, insider_pct
        FROM tokens
        WHERE datetime(first_seen_at) > datetime('now', '-24 hours')
          AND lp_exists=1
          AND liquidity_usd >= 3000
        ORDER BY health_score DESC LIMIT 10
      `).all();

      return {
        scoreable: scoreable.eligible,
        scoreDistribution: scoreDist,
        candidates: candidates
      };
    } catch (error) {
      console.error('Failed to get validation stats:', error.message);
      return null;
    }
  }
}

module.exports = Diagnostics;
