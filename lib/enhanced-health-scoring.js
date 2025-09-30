// lib/enhanced-health-scoring.js - Enhanced health scoring with improved math
const Database = require('better-sqlite3');

/**
 * Enhanced Health Scoring System v2
 * 
 * Improvements:
 * - Cap extremes to sane bands before weighting
 * - Improved liquidity scoring with log scale and floor
 * - Recency decay bonus for early momentum
 * - Class conflicts penalty for inorganic demand
 */

class EnhancedHealthScoring {
  constructor(dbPath = 'db/agent.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
  }

  /**
   * Cap input features to sane bands
   * @param {object} features - Raw feature values
   * @returns {object} Capped feature values
   */
  capExtremes(features) {
    return {
      freshPct: Math.max(0, Math.min(0.9, features.freshPct || 0)),
      sniperPct: Math.max(0, Math.min(0.5, features.sniperPct || 0)),
      insiderPct: Math.max(0, Math.min(0.5, features.insiderPct || 0)),
      top10Pct: Math.max(0, Math.min(0.9, features.top10Pct || 0)),
      liquidityUsd: features.liquidityUsd || 0
    };
  }

  /**
   * Calculate improved liquidity score with log scale and floor
   * @param {number} liquidityUsd - Liquidity in USD
   * @returns {number} Liquidity score (0-1)
   */
  calculateLiquidityScore(liquidityUsd) {
    // LiqScore = clamp(log10(liq_usd + 1) / 5, 0, 1)
    // $10k ≈ 0.8, $100k ≈ 1.0
    const logScore = Math.log10(liquidityUsd + 1) / 5;
    return Math.max(0, Math.min(1, logScore));
  }

  /**
   * Calculate recency decay bonus for early momentum
   * @param {string} mint - Token mint
   * @param {number} currentHealth - Current health score
   * @returns {number} Recency bonus (0-0.1)
   */
  calculateRecencyBonus(mint, currentHealth) {
    try {
      // Get health score from 15 minutes ago
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      
      const previousHealth = this.db.prepare(`
        SELECT health_score 
        FROM score_history 
        WHERE mint = ? AND snapshot_time <= ?
        ORDER BY snapshot_time DESC 
        LIMIT 1
      `).get(mint, fifteenMinutesAgo);

      if (!previousHealth || !previousHealth.health_score) {
        return 0;
      }

      const healthDelta = currentHealth - previousHealth.health_score;
      // Bonus = clamp((ΔHealth@15m)/20, 0, 0.1)
      return Math.max(0, Math.min(0.1, healthDelta / 20));
    } catch (error) {
      console.warn('Failed to calculate recency bonus:', error.message);
      return 0;
    }
  }

  /**
   * Calculate class conflicts penalty for inorganic demand
   * @param {object} features - Capped feature values
   * @returns {number} Class conflicts penalty (0-10)
   */
  calculateClassConflictsPenalty(features) {
    const { freshPct, sniperPct } = features;
    
    // If Fresh% > 60% and Sniper% > 12%, subtract 5-10 points
    if (freshPct > 0.6 && sniperPct > 0.12) {
      // Scale penalty based on severity
      const severity = Math.min(1, (freshPct - 0.6) / 0.3) * Math.min(1, (sniperPct - 0.12) / 0.38);
      return 5 + (severity * 5); // 5-10 point penalty
    }
    
    return 0;
  }

  /**
   * Calculate enhanced health score with all improvements
   * @param {object} token - Token data
   * @returns {object} Enhanced health score result
   */
  calculateEnhancedHealthScore(token) {
    const {
      mint,
      holders_count = 0,
      fresh_wallets_count = 0,
      liquidity_usd = 0,
      sniper_count = 0,
      bundler_count = 0,
      insider_count = 0
    } = token;

    // Calculate ratios
    const freshRatio = holders_count > 0 ? fresh_wallets_count / holders_count : 0;
    const sniperRatio = holders_count > 0 ? sniper_count / holders_count : 0;
    const insiderRatio = holders_count > 0 ? insider_count / holders_count : 0;

    // Calculate top 10 concentration
    const top10Concentration = this.calculateTop10Concentration(mint);

    // Prepare features for capping
    const rawFeatures = {
      freshPct: freshRatio,
      sniperPct: sniperRatio,
      insiderPct: insiderRatio,
      top10Pct: top10Concentration,
      liquidityUsd: liquidity_usd
    };

    // Cap extremes
    const cappedFeatures = this.capExtremes(rawFeatures);

    // Calculate improved liquidity score
    const liquidityScore = this.calculateLiquidityScore(cappedFeatures.liquidityUsd);

    // Calculate base health score components (weights sum to 100)
    const freshScore = cappedFeatures.freshPct * 35; // +35 points max
    const liquidityScoreWeighted = liquidityScore * 20; // +20 points max
    const sniperPenalty = cappedFeatures.sniperPct * 15; // -15 points max
    const insiderPenalty = cappedFeatures.insiderPct * 20; // -20 points max
    const concentrationPenalty = cappedFeatures.top10Pct * 10; // -10 points max

    // Calculate class conflicts penalty
    const classConflictsPenalty = this.calculateClassConflictsPenalty(cappedFeatures);

    // Calculate base score
    let healthScore = freshScore + liquidityScoreWeighted - sniperPenalty - insiderPenalty - concentrationPenalty - classConflictsPenalty;

    // Add recency decay bonus (only for tokens in first 2 hours)
    const tokenAge = this.getTokenAge(mint);
    if (tokenAge <= 2) { // First 2 hours
      const recencyBonus = this.calculateRecencyBonus(mint, healthScore);
      healthScore += recencyBonus;
    }

    // Clamp to 0-100 range
    healthScore = Math.max(0, Math.min(100, healthScore));

    return {
      healthScore: Math.round(healthScore * 100) / 100, // Round to 2 decimal places
      components: {
        freshRatio: cappedFeatures.freshPct,
        sniperRatio: cappedFeatures.sniperPct,
        insiderRatio: cappedFeatures.insiderPct,
        top10Concentration: cappedFeatures.top10Pct,
        liquidityScore,
        freshScore,
        liquidityScoreWeighted,
        sniperPenalty,
        insiderPenalty,
        concentrationPenalty,
        classConflictsPenalty,
        recencyBonus: tokenAge <= 2 ? this.calculateRecencyBonus(mint, healthScore) : 0
      },
      metadata: {
        tokenAge,
        cappedFeatures,
        rawFeatures
      }
    };
  }

  /**
   * Calculate top 10 concentration
   * @param {string} mint - Token mint
   * @returns {number} Top 10 concentration ratio
   */
  calculateTop10Concentration(mint) {
    try {
      const top10Holders = this.db.prepare(`
        SELECT amount
        FROM holders
        WHERE mint = ?
        ORDER BY CAST(amount AS REAL) DESC
        LIMIT 10
      `).all(mint);

      if (top10Holders.length === 0) return 0;

      const top10Amount = top10Holders.reduce((sum, holder) => sum + (parseFloat(holder.amount) || 0), 0);

      // Get total supply (approximate from all holders)
      const allHolders = this.db.prepare(`
        SELECT amount FROM holders WHERE mint = ?
      `).all(mint);

      const totalAmount = allHolders.reduce((sum, holder) => sum + (parseFloat(holder.amount) || 0), 0);

      return totalAmount > 0 ? top10Amount / totalAmount : 0;
    } catch (error) {
      console.warn('Failed to calculate top 10 concentration:', error.message);
      return 0;
    }
  }

  /**
   * Get token age in hours
   * @param {string} mint - Token mint
   * @returns {number} Token age in hours
   */
  getTokenAge(mint) {
    try {
      const token = this.db.prepare(`
        SELECT first_seen_at FROM tokens WHERE mint = ?
      `).get(mint);

      if (!token || !token.first_seen_at) return 0;

      const firstSeen = new Date(token.first_seen_at);
      const now = new Date();
      return (now - firstSeen) / (1000 * 60 * 60); // Convert to hours
    } catch (error) {
      console.warn('Failed to get token age:', error.message);
      return 0;
    }
  }

  /**
   * Get health score distribution for analysis
   * @returns {object} Score distribution statistics
   */
  getScoreDistribution() {
    try {
      const stats = this.db.prepare(`
        SELECT 
          COUNT(*) as total,
          AVG(health_score) as avg_score,
          MIN(health_score) as min_score,
          MAX(health_score) as max_score,
          SUM(CASE WHEN health_score = 0 THEN 1 ELSE 0 END) as zero_scores,
          SUM(CASE WHEN health_score = 100 THEN 1 ELSE 0 END) as max_scores,
          SUM(CASE WHEN health_score >= 80 THEN 1 ELSE 0 END) as excellent_count,
          SUM(CASE WHEN health_score >= 60 AND health_score < 80 THEN 1 ELSE 0 END) as good_count,
          SUM(CASE WHEN health_score >= 40 AND health_score < 60 THEN 1 ELSE 0 END) as fair_count,
          SUM(CASE WHEN health_score < 40 THEN 1 ELSE 0 END) as poor_count
        FROM tokens
        WHERE health_score IS NOT NULL
      `).get();

      return {
        total: stats.total,
        average: Math.round(stats.avg_score * 100) / 100,
        range: { min: stats.min_score, max: stats.max_score },
        distribution: {
          excellent: stats.excellent_count,
          good: stats.good_count,
          fair: stats.fair_count,
          poor: stats.poor_count
        },
        extremes: {
          zeroScores: stats.zero_scores,
          maxScores: stats.max_scores,
          peggedAtZero: (stats.zero_scores / stats.total * 100).toFixed(1) + '%',
          peggedAtMax: (stats.max_scores / stats.total * 100).toFixed(1) + '%'
        }
      };
    } catch (error) {
      console.error('Failed to get score distribution:', error.message);
      return null;
    }
  }
}

module.exports = EnhancedHealthScoring;

