// workers/rug-risk-scorer-worker.js - Task 11 Rug Risk Scoring
const Database = require('better-sqlite3');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

class RugRiskScorerWorker {
  constructor() {
    this.weights = {
      lpSafety: 60,    // Max 60 points for LP safety
      authorities: 20, // Max 20 points for authority checks
      liquidity: 20    // Max 20 points for liquidity behavior
    };
  }

  /**
   * Get tokens that need rug risk scoring
   * @returns {Array} Tokens needing rug risk analysis
   */
  getTokensForRugRiskScoring() {
    try {
      const tokens = db.prepare(`
        SELECT 
          t.mint, t.symbol, t.name, t.lp_exists, t.lp_burned, t.lp_locked,
          t.lp_owner_top1_pct, t.lp_owner_top5_pct, t.liquidity_usd,
          t.liquidity_usd_5m_delta, t.liquidity_usd_15m_delta,
          t.authorities_revoked,
          t.health_score, t.rug_risk_score
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
      logger.error('rug-risk-scorer', 'system', 'get_tokens_failed', `Failed to get tokens: ${error.message}`);
      return [];
    }
  }

  /**
   * Calculate LP safety score (0-60 points)
   * @param {object} token - Token data
   * @returns {object} LP safety score and flags
   */
  calculateLPSafetyScore(token) {
    let score = 0;
    const flags = [];

    try {
      // LP burned/locked check (30 points max)
      if (token.lp_burned === 0 && token.lp_locked === 0) {
        score += 30;
        flags.push('lp_unburned');
        flags.push('lp_unlocked');
      } else if (token.lp_burned === 1) {
        // LP is burned, this is good
        flags.push('lp_burned');
      } else if (token.lp_locked === 1) {
        // LP is locked, this is good
        flags.push('lp_locked');
      }

      // Top 1 holder concentration (15 points max)
      if (token.lp_owner_top1_pct !== null) {
        if (token.lp_owner_top1_pct >= 0.35) {
          flags.push('top1_gt35');
        } else if (token.lp_owner_top1_pct >= 0.20) {
          score += 15;
          flags.push('top1_gt20');
        }
      }

      // Top 5 holders concentration (15 points max)
      if (token.lp_owner_top5_pct !== null) {
        if (token.lp_owner_top5_pct >= 0.50) {
          score += 15;
          flags.push('top5_gt50');
        }
      }

      return { score: Math.min(score, 60), flags };
    } catch (error) {
      logger.error('rug-risk-scorer', token.mint, 'lp_safety_failed', `Failed to calculate LP safety: ${error.message}`);
      return { score: 0, flags: ['lp_safety_error'] };
    }
  }

  /**
   * Calculate authority safety score (0-20 points)
   * @param {object} token - Token data
   * @returns {object} Authority safety score and flags
   */
  calculateAuthoritySafetyScore(token) {
    let score = 0;
    const flags = [];

    try {
      // Authorities check (20 points max)
      if (token.authorities_revoked === 0) {
        score += 20;
        flags.push('authorities_active');
      } else {
        score += 0;
        flags.push('authorities_revoked');
      }

      return { score: Math.min(score, 20), flags };
    } catch (error) {
      logger.error('rug-risk-scorer', token.mint, 'authority_safety_failed', `Failed to calculate authority safety: ${error.message}`);
      return { score: 0, flags: ['authority_safety_error'] };
    }
  }

  /**
   * Calculate liquidity behavior score (0-20 points)
   * @param {object} token - Token data
   * @returns {object} Liquidity behavior score and flags
   */
  calculateLiquidityBehaviorScore(token) {
    let score = 0;
    const flags = [];

    try {
      // Rapid 5m drain check (12 points max)
      if (token.liquidity_usd_5m_delta !== null) {
        if (token.liquidity_usd_5m_delta <= -0.60) {
          flags.push('drain_60_5m');
        } else if (token.liquidity_usd_5m_delta <= -0.40) {
          score += 12;
          flags.push('drain_40_5m');
        }
      }

      // Rapid 15m drain check (8 points max)
      if (token.liquidity_usd_15m_delta !== null) {
        if (token.liquidity_usd_15m_delta <= -0.65) {
          score += 8;
          flags.push('drain_65_15m');
        }
      }

      return { score: Math.min(score, 20), flags };
    } catch (error) {
      logger.error('rug-risk-scorer', token.mint, 'liquidity_behavior_failed', `Failed to calculate liquidity behavior: ${error.message}`);
      return { score: 0, flags: ['liquidity_behavior_error'] };
    }
  }

  /**
   * Calculate total rug risk score (0-100)
   * @param {object} token - Token data
   * @returns {object} Total rug risk score and all flags
   */
  calculateRugRiskScore(token) {
    try {
      // Calculate component scores
      const lpSafety = this.calculateLPSafetyScore(token);
      const authoritySafety = this.calculateAuthoritySafetyScore(token);
      const liquidityBehavior = this.calculateLiquidityBehaviorScore(token);

      // Calculate total score
      const totalScore = lpSafety.score + authoritySafety.score + liquidityBehavior.score;
      const clampedScore = Math.max(0, Math.min(100, totalScore));

      // Combine all flags
      const allFlags = [
        ...lpSafety.flags,
        ...authoritySafety.flags,
        ...liquidityBehavior.flags
      ];

      return {
        score: Math.round(clampedScore * 100) / 100,
        flags: allFlags,
        components: {
          lpSafety: lpSafety.score,
          authoritySafety: authoritySafety.score,
          liquidityBehavior: liquidityBehavior.score
        }
      };
    } catch (error) {
      logger.error('rug-risk-scorer', token.mint, 'calculate_score_failed', `Failed to calculate rug risk score: ${error.message}`);
      return {
        score: 0,
        flags: ['calculation_error'],
        components: { lpSafety: 0, authoritySafety: 0, liquidityBehavior: 0 }
      };
    }
  }

  /**
   * Update token with rug risk data
   * @param {string} mint - Token mint address
   * @param {object} rugRiskData - Rug risk score and flags
   */
  updateTokenRugRiskData(mint, rugRiskData) {
    try {
      db.prepare(`
        UPDATE tokens 
        SET 
          rug_risk_score = ?,
          rug_flags = ?
        WHERE mint = ?
      `).run(
        rugRiskData.score,
        rugRiskData.flags.join(','),
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

      logger.debug('rug-risk-scorer', mint, 'updated', `Rug risk data updated: ${rugRiskData.score}/100`);
    } catch (error) {
      logger.error('rug-risk-scorer', mint, 'update_failed', `Failed to update rug risk data: ${error.message}`);
    }
  }

  /**
   * Process rug risk scoring for a single token
   * @param {object} token - Token data
   */
  async processTokenRugRiskScoring(token) {
    const { mint, symbol } = token;

    try {
      // Calculate rug risk score
      const rugRiskData = this.calculateRugRiskScore(token);

      // Update token with rug risk data
      this.updateTokenRugRiskData(mint, rugRiskData);

      // Log significant risk scores
      if (rugRiskData.score >= 80) {
        logger.warning('rug-risk-scorer', mint, 'high_risk', `High rug risk detected for ${symbol}`, {
          score: rugRiskData.score,
          flags: rugRiskData.flags,
          components: rugRiskData.components
        });
      } else if (rugRiskData.score >= 60) {
        logger.info('rug-risk-scorer', mint, 'medium_risk', `Medium rug risk for ${symbol}`, {
          score: rugRiskData.score,
          flags: rugRiskData.flags
        });
      } else {
        logger.debug('rug-risk-scorer', mint, 'low_risk', `Low rug risk for ${symbol}: ${rugRiskData.score}/100`);
      }

    } catch (error) {
      logger.error('rug-risk-scorer', mint, 'process_failed', `Failed to process ${symbol}: ${error.message}`);
    }
  }

  /**
   * Main rug risk scoring loop
   */
  async processRugRiskScoring() {
    logger.info('rug-risk-scorer', 'system', 'start', 'Starting rug risk scoring');

    try {
      const tokens = this.getTokensForRugRiskScoring();
      
      if (tokens.length === 0) {
        logger.warning('rug-risk-scorer', 'system', 'no_tokens', 'No tokens found for rug risk scoring');
        return;
      }

      logger.info('rug-risk-scorer', 'system', 'processing', `Processing ${tokens.length} tokens`);

      // Process each token
      for (const token of tokens) {
        await this.processTokenRugRiskScoring(token);
        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      logger.success('rug-risk-scorer', 'system', 'complete', 'Rug risk scoring completed');

    } catch (error) {
      logger.error('rug-risk-scorer', 'system', 'failed', `Rug risk scoring failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get rug risk data for a specific token
   * @param {string} mint - Token mint address
   * @returns {object} Rug risk data
   */
  getRugRiskData(mint) {
    try {
      return db.prepare(`
        SELECT 
          t.mint, t.symbol, t.rug_risk_score, t.rug_flags,
          t.lp_burned, t.lp_locked, t.lp_owner_top1_pct, t.lp_owner_top5_pct,
          t.liquidity_usd, t.liquidity_usd_5m_delta, t.liquidity_usd_15m_delta,
          t.authorities_revoked
        FROM tokens t
        WHERE t.mint = ?
      `).get(mint);
    } catch (error) {
      logger.error('rug-risk-scorer', mint, 'get_data_failed', `Failed to get rug risk data: ${error.message}`);
      return null;
    }
  }

  /**
   * Get tokens with high rug risk scores
   * @param {number} limit - Number of tokens to return
   * @returns {Array} Tokens with high rug risk
   */
  getHighRiskTokens(limit = 20) {
    try {
      return db.prepare(`
        SELECT 
          t.mint, t.symbol, t.rug_risk_score, t.rug_flags,
          t.liquidity_usd, t.lp_owner_top1_pct, t.lp_owner_top5_pct
        FROM tokens t
        WHERE t.rug_risk_score IS NOT NULL
          AND t.rug_risk_score >= 60
        ORDER BY t.rug_risk_score DESC
        LIMIT ?
      `).all(limit);
    } catch (error) {
      logger.error('rug-risk-scorer', 'system', 'get_high_risk_failed', `Failed to get high risk tokens: ${error.message}`);
      return [];
    }
  }
}

// Export for CLI usage
module.exports = {
  RugRiskScorerWorker,
  processRugRiskScoring: async () => {
    const worker = new RugRiskScorerWorker();
    await worker.processRugRiskScoring();
  },
  mainLoop: async () => {
    const worker = new RugRiskScorerWorker();
    await worker.processRugRiskScoring();
    logger.success('rug-risk-scorer', 'system', 'complete', 'Rug Risk Scorer Worker completed');
  }
};

// Run if called directly
if (require.main === module) {
  const worker = new RugRiskScorerWorker();
  worker.processRugRiskScoring().then(() => {
    console.log('✅ Rug Risk Scorer Worker completed');
    process.exit(0);
  }).catch(error => {
    console.error('❌ Rug Risk Scorer Worker failed:', error.message);
    process.exit(1);
  });
}
