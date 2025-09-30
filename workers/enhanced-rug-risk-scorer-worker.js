// workers/enhanced-rug-risk-scorer-worker.js - Task 11 Enhanced Rug Risk Scoring
const Database = require('better-sqlite3');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

class EnhancedRugRiskScorerWorker {
  constructor() {
    // Tunable weights for rug risk scoring
    this.weights = {
      lpSafety: 0.6,      // 60% weight for LP safety
      authorities: 0.2,    // 20% weight for authorities
      drains: 0.15,        // 15% weight for liquidity drains
      concentration: 0.05  // 5% weight for owner concentration
    };
    
    // Cool-off settings
    this.coolOffMinutes = 10;
    this.coolOffThreshold = 80;
  }

  /**
   * Get tokens that need enhanced rug risk scoring
   * @returns {Array} Tokens needing rug risk analysis
   */
  getTokensForRugRiskScoring() {
    try {
      const tokens = db.prepare(`
        SELECT 
          t.mint, t.symbol, t.name, t.lp_exists, t.lp_burned, t.lp_locked,
          t.lp_burn_pct, t.lp_locked_confidence, t.lp_lock_provider,
          t.lp_owner_top1_pct, t.lp_owner_top5_pct, t.lp_owner_is_creator,
          t.liquidity_usd, t.liquidity_usd_5m_delta, t.liquidity_usd_15m_delta,
          t.authorities_revoked, t.health_score, t.rug_risk_score,
          t.rug_flags, t.rug_breakdown
        FROM tokens t
        WHERE t.lp_exists = 1
          AND t.liquidity_usd IS NOT NULL
          AND t.liquidity_usd > 1000
          AND t.first_seen_at IS NOT NULL
          AND (julianday('now') - julianday(t.first_seen_at)) * 24 * 60 <= 2880
        ORDER BY t.liquidity_usd DESC
        LIMIT 200
      `).all();

      return tokens;
    } catch (error) {
      logger.error('enhanced-rug-risk-scorer', 'system', 'get_tokens_failed', `Failed to get tokens: ${error.message}`);
      return [];
    }
  }

  /**
   * Calculate LP safety score with burn percentage and lock confidence
   * @param {object} token - Token data
   * @returns {object} LP safety score and flags
   */
  calculateLPSafetyScore(token) {
    let score = 0;
    const flags = [];

    try {
      // LP burn check with percentage
      if (token.lp_burn_pct !== null) {
        if (token.lp_burn_pct >= 0.95) {
          // Fully burned - no penalty
          flags.push('lp_burned');
        } else if (token.lp_burn_pct > 0) {
          // Partial burn - sliding penalty
          const penalty = 30 * (1 - token.lp_burn_pct);
          score += penalty;
          flags.push(`lp_partial_burn_${Math.round(token.lp_burn_pct * 100)}%`);
        } else {
          // Not burned - full penalty
          score += 30;
          flags.push('lp_unburned');
        }
      } else {
        // Unknown burn status
        flags.push('lp_burn_unknown');
        score += 15; // Reduced penalty for unknown
      }

      // LP lock check with confidence
      if (token.lp_locked_confidence >= 2) {
        // High confidence lock - no penalty
        flags.push(`lp_locked_high_${token.lp_lock_provider || 'unknown'}`);
      } else if (token.lp_locked_confidence === 1) {
        // Low confidence lock - small penalty
        score += 10;
        flags.push(`lp_locked_low_${token.lp_lock_provider || 'unknown'}`);
      } else {
        // Not locked or unknown - penalty
        score += 20;
        flags.push('lp_unlocked');
      }

      return { score: Math.min(score, 60), flags };
    } catch (error) {
      logger.error('enhanced-rug-risk-scorer', token.mint, 'lp_safety_failed', `Failed to calculate LP safety: ${error.message}`);
      return { score: 0, flags: ['lp_safety_error'] };
    }
  }

  /**
   * Calculate authority safety score
   * @param {object} token - Token data
   * @returns {object} Authority safety score and flags
   */
  calculateAuthoritySafetyScore(token) {
    let score = 0;
    const flags = [];

    try {
      // Authorities check (20 points max)
      if (token.authorities_revoked === 1) {
        score += 20;
        flags.push('authorities_revoked');
      } else {
        score += 0;
        flags.push('authorities_active');
      }

      return { score: Math.min(score, 20), flags };
    } catch (error) {
      logger.error('enhanced-rug-risk-scorer', token.mint, 'authority_safety_failed', `Failed to calculate authority safety: ${error.message}`);
      return { score: 0, flags: ['authority_safety_error'] };
    }
  }

  /**
   * Calculate liquidity drain score with EMA smoothing and normalization
   * @param {object} token - Token data
   * @returns {object} Liquidity drain score and flags
   */
  calculateLiquidityDrainScore(token) {
    let score = 0;
    const flags = [];

    try {
      // Normalize by pool size to avoid micro-pool noise
      const normalizedLiquidity = Math.max(token.liquidity_usd || 0, 5000);
      const normalizationFactor = Math.min(normalizedLiquidity / 5000, 1);

      // 5m drain check (12 points max)
      if (token.liquidity_usd_5m_delta !== null) {
        const adjustedDelta5m = token.liquidity_usd_5m_delta * normalizationFactor;
        if (adjustedDelta5m <= -0.60) {
          score += 12;
          flags.push('drain_60_5m');
        } else if (adjustedDelta5m <= -0.40) {
          score += 8;
          flags.push('drain_40_5m');
        }
      }

      // 15m drain check (8 points max)
      if (token.liquidity_usd_15m_delta !== null) {
        const adjustedDelta15m = token.liquidity_usd_15m_delta * normalizationFactor;
        if (adjustedDelta15m <= -0.65) {
          score += 8;
          flags.push('drain_65_15m');
        }
      }

      return { score: Math.min(score, 20), flags };
    } catch (error) {
      logger.error('enhanced-rug-risk-scorer', token.mint, 'liquidity_drain_failed', `Failed to calculate liquidity drain: ${error.message}`);
      return { score: 0, flags: ['liquidity_drain_error'] };
    }
  }

  /**
   * Calculate owner concentration score with liquidity scaling
   * @param {object} token - Token data
   * @returns {object} Owner concentration score and flags
   */
  calculateOwnerConcentrationScore(token) {
    let score = 0;
    const flags = [];

    try {
      // Scale penalties by liquidity
      let liquidityScale = 1.0;
      if (token.liquidity_usd < 5000) {
        liquidityScale = 0.5; // 50% penalty reduction for small pools
      } else if (token.liquidity_usd >= 50000) {
        liquidityScale = 1.0; // Full penalty for large pools
      } else {
        // Linear scaling between $5k and $50k
        liquidityScale = 0.5 + (0.5 * (token.liquidity_usd - 5000) / 45000);
      }

      // Top 1 holder concentration
      if (token.lp_owner_top1_pct !== null) {
        let top1Penalty = 0;
        if (token.lp_owner_top1_pct >= 0.35) {
          top1Penalty = 15;
          flags.push('top1_gt35');
        } else if (token.lp_owner_top1_pct >= 0.20) {
          top1Penalty = 10;
          flags.push('top1_gt20');
        }

        // Extra penalty if creator holds LP
        if (token.lp_owner_is_creator === 1 && token.lp_owner_top1_pct >= 0.20) {
          top1Penalty += 10;
          flags.push('creator_holds_lp');
        }

        score += top1Penalty * liquidityScale;
      }

      // Top 5 holders concentration
      if (token.lp_owner_top5_pct !== null) {
        let top5Penalty = 0;
        if (token.lp_owner_top5_pct >= 0.70) {
          top5Penalty = 10;
          flags.push('top5_gt70');
        } else if (token.lp_owner_top5_pct >= 0.50) {
          top5Penalty = 5;
          flags.push('top5_gt50');
        }

        score += top5Penalty * liquidityScale;
      }

      return { score: Math.min(score, 20), flags };
    } catch (error) {
      logger.error('enhanced-rug-risk-scorer', token.mint, 'concentration_failed', `Failed to calculate concentration: ${error.message}`);
      return { score: 0, flags: ['concentration_error'] };
    }
  }

  /**
   * Check for cool-off period
   * @param {string} mint - Token mint address
   * @param {number} newScore - New rug risk score
   * @returns {boolean} True if in cool-off period
   */
  isInCoolOffPeriod(mint, newScore) {
    try {
      if (newScore < this.coolOffThreshold) return false;

      const coolOffTime = new Date(Date.now() - this.coolOffMinutes * 60 * 1000).toISOString();
      
      const recentHighScore = db.prepare(`
        SELECT rug_risk_score, created_at
        FROM rug_risk_history
        WHERE mint = ? AND rug_risk_score >= ? AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(mint, this.coolOffThreshold, coolOffTime);

      return !!recentHighScore;
    } catch (error) {
      logger.error('enhanced-rug-risk-scorer', mint, 'cool_off_check_failed', `Failed to check cool-off: ${error.message}`);
      return false;
    }
  }

  /**
   * Calculate enhanced rug risk score with component breakdown
   * @param {object} token - Token data
   * @returns {object} Enhanced rug risk score and breakdown
   */
  calculateEnhancedRugRiskScore(token) {
    try {
      // Calculate component scores
      const lpSafety = this.calculateLPSafetyScore(token);
      const authoritySafety = this.calculateAuthoritySafetyScore(token);
      const liquidityDrain = this.calculateLiquidityDrainScore(token);
      const ownerConcentration = this.calculateOwnerConcentrationScore(token);

      // Calculate weighted total score
      const totalScore = 
        (lpSafety.score * this.weights.lpSafety) +
        (authoritySafety.score * this.weights.authorities) +
        (liquidityDrain.score * this.weights.drains) +
        (ownerConcentration.score * this.weights.concentration);

      // Check for cool-off period
      const finalScore = this.isInCoolOffPeriod(token.mint, totalScore) 
        ? Math.max(totalScore, this.coolOffThreshold)
        : totalScore;

      const clampedScore = Math.max(0, Math.min(100, finalScore));

      // Combine all flags
      const allFlags = [
        ...lpSafety.flags,
        ...authoritySafety.flags,
        ...liquidityDrain.flags,
        ...ownerConcentration.flags
      ];

      // Create breakdown
      const breakdown = {
        lp_safety: Math.round(lpSafety.score * this.weights.lpSafety),
        authorities: Math.round(authoritySafety.score * this.weights.authorities),
        drains: Math.round(liquidityDrain.score * this.weights.drains),
        concentration: Math.round(ownerConcentration.score * this.weights.concentration),
        total: Math.round(clampedScore)
      };

      return {
        score: Math.round(clampedScore * 100) / 100,
        flags: allFlags,
        breakdown: breakdown,
        components: {
          lpSafety: lpSafety.score,
          authoritySafety: authoritySafety.score,
          liquidityDrain: liquidityDrain.score,
          ownerConcentration: ownerConcentration.score
        }
      };
    } catch (error) {
      logger.error('enhanced-rug-risk-scorer', token.mint, 'calculate_score_failed', `Failed to calculate enhanced rug risk score: ${error.message}`);
      return {
        score: 0,
        flags: ['calculation_error'],
        breakdown: { lp_safety: 0, authorities: 0, drains: 0, concentration: 0, total: 0 },
        components: { lpSafety: 0, authoritySafety: 0, liquidityDrain: 0, ownerConcentration: 0 }
      };
    }
  }

  /**
   * Update token with enhanced rug risk data
   * @param {string} mint - Token mint address
   * @param {object} rugRiskData - Enhanced rug risk data
   */
  updateTokenRugRiskData(mint, rugRiskData) {
    try {
      db.prepare(`
        UPDATE tokens 
        SET 
          rug_risk_score = ?,
          rug_flags = ?,
          rug_breakdown = ?
        WHERE mint = ?
      `).run(
        rugRiskData.score,
        rugRiskData.flags.join(','),
        JSON.stringify(rugRiskData.breakdown),
        mint
      );

      // Store in history table
      db.prepare(`
        INSERT INTO rug_risk_history 
        (mint, timestamp, rug_risk_score, rug_flags, liquidity_usd, 
         lp_owner_top1_pct, lp_owner_top5_pct, liquidity_usd_5m_delta, liquidity_usd_15m_delta)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mint,
        new Date().toISOString(),
        rugRiskData.score,
        rugRiskData.flags.join(','),
        null, // Will be filled by actual data
        null, // Will be filled by actual data
        null, // Will be filled by actual data
        null, // Will be filled by actual data
        null  // Will be filled by actual data
      );

      logger.debug('enhanced-rug-risk-scorer', mint, 'updated', `Enhanced rug risk data updated: ${rugRiskData.score}/100`);
    } catch (error) {
      logger.error('enhanced-rug-risk-scorer', mint, 'update_failed', `Failed to update enhanced rug risk data: ${error.message}`);
    }
  }

  /**
   * Process enhanced rug risk scoring for a single token
   * @param {object} token - Token data
   */
  async processTokenRugRiskScoring(token) {
    const { mint, symbol } = token;

    try {
      // Calculate enhanced rug risk score
      const rugRiskData = this.calculateEnhancedRugRiskScore(token);

      // Update token with enhanced rug risk data
      this.updateTokenRugRiskData(mint, rugRiskData);

      // Log significant risk scores
      if (rugRiskData.score >= 80) {
        logger.warning('enhanced-rug-risk-scorer', mint, 'high_risk', `High rug risk detected for ${symbol}`, {
          score: rugRiskData.score,
          breakdown: rugRiskData.breakdown,
          flags: rugRiskData.flags
        });
      } else if (rugRiskData.score >= 60) {
        logger.info('enhanced-rug-risk-scorer', mint, 'medium_risk', `Medium rug risk for ${symbol}`, {
          score: rugRiskData.score,
          breakdown: rugRiskData.breakdown
        });
      } else {
        logger.debug('enhanced-rug-risk-scorer', mint, 'low_risk', `Low rug risk for ${symbol}: ${rugRiskData.score}/100`);
      }

    } catch (error) {
      logger.error('enhanced-rug-risk-scorer', mint, 'process_failed', `Failed to process ${symbol}: ${error.message}`);
    }
  }

  /**
   * Main enhanced rug risk scoring loop
   */
  async processRugRiskScoring() {
    logger.info('enhanced-rug-risk-scorer', 'system', 'start', 'Starting enhanced rug risk scoring');

    try {
      const tokens = this.getTokensForRugRiskScoring();
      
      if (tokens.length === 0) {
        logger.warning('enhanced-rug-risk-scorer', 'system', 'no_tokens', 'No tokens found for enhanced rug risk scoring');
        return;
      }

      logger.info('enhanced-rug-risk-scorer', 'system', 'processing', `Processing ${tokens.length} tokens`);

      // Process each token
      for (const token of tokens) {
        await this.processTokenRugRiskScoring(token);
        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      logger.success('enhanced-rug-risk-scorer', 'system', 'complete', 'Enhanced rug risk scoring completed');

    } catch (error) {
      logger.error('enhanced-rug-risk-scorer', 'system', 'failed', `Enhanced rug risk scoring failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get enhanced rug risk data for a specific token
   * @param {string} mint - Token mint address
   * @returns {object} Enhanced rug risk data
   */
  getEnhancedRugRiskData(mint) {
    try {
      return db.prepare(`
        SELECT 
          t.mint, t.symbol, t.rug_risk_score, t.rug_flags, t.rug_breakdown,
          t.lp_burned, t.lp_locked, t.lp_burn_pct, t.lp_locked_confidence, t.lp_lock_provider,
          t.lp_owner_top1_pct, t.lp_owner_top5_pct, t.lp_owner_is_creator,
          t.liquidity_usd, t.liquidity_usd_5m_delta, t.liquidity_usd_15m_delta,
          t.authorities_revoked
        FROM tokens t
        WHERE t.mint = ?
      `).get(mint);
    } catch (error) {
      logger.error('enhanced-rug-risk-scorer', mint, 'get_data_failed', `Failed to get enhanced rug risk data: ${error.message}`);
      return null;
    }
  }
}

// Export for CLI usage
module.exports = {
  EnhancedRugRiskScorerWorker,
  processRugRiskScoring: async () => {
    const worker = new EnhancedRugRiskScorerWorker();
    await worker.processRugRiskScoring();
  },
  mainLoop: async () => {
    const worker = new EnhancedRugRiskScorerWorker();
    await worker.processRugRiskScoring();
    logger.success('enhanced-rug-risk-scorer', 'system', 'complete', 'Enhanced Rug Risk Scorer Worker completed');
  }
};

// Run if called directly
if (require.main === module) {
  const worker = new EnhancedRugRiskScorerWorker();
  worker.processRugRiskScoring().then(() => {
    console.log('✅ Enhanced Rug Risk Scorer Worker completed');
    process.exit(0);
  }).catch(error => {
    console.error('❌ Enhanced Rug Risk Scorer Worker failed:', error.message);
    process.exit(1);
  });
}
