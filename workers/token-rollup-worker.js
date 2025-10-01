// workers/token-rollup-worker.js - Task 12 Token Bad Actor Rollup
const Database = require('better-sqlite3');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

class TokenRollupWorker {
  constructor() {
    this.isRunning = false;
    this.REPUTATION_THRESHOLD = 60; // High reputation threshold
  }

  /**
   * Get tokens that need bad actor rollup
   */
  getTokensForRollup() {
    try {
      const tokens = db.prepare(`
        SELECT mint, symbol, health_score, rug_risk_score
        FROM tokens
        WHERE first_seen_at IS NOT NULL
          AND datetime(first_seen_at) > datetime('now', '-7 days')
        ORDER BY datetime(first_seen_at) DESC
        LIMIT 50
      `).all();

      return tokens;
    } catch (error) {
      logger.error('token-rollup', 'system', 'get_tokens_failed', `Failed to get tokens: ${error.message}`);
      return [];
    }
  }

  /**
   * Get bad sniper count for a token
   */
  getBadSniperCount(mint) {
    try {
      const result = db.prepare(`
        SELECT COUNT(DISTINCT h.owner) as count
        FROM holders h
        JOIN wallet_reputation wr ON h.owner = wr.wallet
        WHERE h.mint = ?
          AND h.is_sniper = 1
          AND wr.reputation_score >= ?
      `).get(mint, this.REPUTATION_THRESHOLD);

      return result ? result.count : 0;
    } catch (error) {
      logger.error('token-rollup', 'system', 'bad_sniper_count_failed', `Failed to get bad sniper count for ${mint}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Get bad bundler count for a token
   */
  getBadBundlerCount(mint) {
    try {
      const result = db.prepare(`
        SELECT COUNT(DISTINCT be.bundler) as count
        FROM bundle_events be
        JOIN wallet_reputation wr ON be.bundler = wr.wallet
        JOIN buy_events bue ON be.recipient = bue.wallet AND be.mint = bue.mint
        WHERE be.mint = ?
          AND wr.reputation_score >= ?
          AND datetime(be.ts) <= datetime(bue.ts)
      `).get(mint, this.REPUTATION_THRESHOLD);

      return result ? result.count : 0;
    } catch (error) {
      logger.error('token-rollup', 'system', 'bad_bundler_count_failed', `Failed to get bad bundler count for ${mint}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Get bad insider count for a token
   */
  getBadInsiderCount(mint) {
    try {
      const result = db.prepare(`
        SELECT COUNT(DISTINCT ie.wallet) as count
        FROM insider_events ie
        JOIN wallet_reputation wr ON ie.wallet = wr.wallet
        WHERE ie.mint = ?
          AND wr.reputation_score >= ?
      `).get(mint, this.REPUTATION_THRESHOLD);

      return result ? result.count : 0;
    } catch (error) {
      logger.error('token-rollup', 'system', 'bad_insider_count_failed', `Failed to get bad insider count for ${mint}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Calculate bad actor score for a token
   */
  calculateBadActorScore(sniperBadCount, bundlerBadCount, insiderBadCount) {
    // Formula: clamp(5*bad_snipers + 7*bad_bundlers + 9*bad_insiders, 0, 30)
    const rawScore = (5 * sniperBadCount) + (7 * bundlerBadCount) + (9 * insiderBadCount);
    return Math.max(0, Math.min(30, rawScore));
  }

  /**
   * Calculate adjusted health score
   */
  calculateAdjustedHealthScore(originalHealthScore, badActorScore) {
    // health_score = clamp(health_score - min(15, bad_actor_score/2), 0, 100)
    const penalty = Math.min(15, badActorScore / 2);
    return Math.max(0, Math.min(100, originalHealthScore - penalty));
  }

  /**
   * Calculate adjusted rug risk score
   */
  calculateAdjustedRugRiskScore(originalRugRiskScore, badActorScore) {
    // rug_risk_score = clamp(rug_risk_score + min(20, bad_actor_score), 0, 100)
    const penalty = Math.min(20, badActorScore);
    return Math.max(0, Math.min(100, originalRugRiskScore + penalty));
  }

  /**
   * Update token with bad actor information
   */
  updateTokenBadActorInfo(mint, sniperBadCount, bundlerBadCount, insiderBadCount, badActorScore, adjustedHealthScore, adjustedRugRiskScore) {
    try {
      const stmt = db.prepare(`
        UPDATE tokens 
        SET sniper_bad_count = ?,
            bundler_bad_count = ?,
            insider_bad_count = ?,
            bad_actor_score = ?,
            health_score = ?,
            rug_risk_score = ?,
            last_updated_at = datetime('now')
        WHERE mint = ?
      `);

      stmt.run(
        sniperBadCount,
        bundlerBadCount,
        insiderBadCount,
        badActorScore,
        adjustedHealthScore,
        adjustedRugRiskScore,
        mint
      );

      logger.debug('token-rollup', mint, 'bad_actor_updated', 
        `Snipers: ${sniperBadCount}, Bundlers: ${bundlerBadCount}, Insiders: ${insiderBadCount}, Score: ${badActorScore}`);
    } catch (error) {
      logger.error('token-rollup', 'system', 'token_update_failed', `Failed to update token ${mint}: ${error.message}`);
    }
  }

  /**
   * Process a single token for bad actor rollup
   */
  async processToken(mint) {
    try {
      logger.info('token-rollup', mint, 'processing_started', 'Starting bad actor rollup');

      // Get current token info
      const tokenInfo = db.prepare(`
        SELECT health_score, rug_risk_score FROM tokens WHERE mint = ?
      `).get(mint);

      if (!tokenInfo) {
        logger.warn('token-rollup', mint, 'token_not_found', 'Token not found in database');
        return;
      }

      // Get bad actor counts
      const sniperBadCount = this.getBadSniperCount(mint);
      const bundlerBadCount = this.getBadBundlerCount(mint);
      const insiderBadCount = this.getBadInsiderCount(mint);

      // Calculate bad actor score
      const badActorScore = this.calculateBadActorScore(sniperBadCount, bundlerBadCount, insiderBadCount);

      // Calculate adjusted scores
      const adjustedHealthScore = this.calculateAdjustedHealthScore(tokenInfo.health_score, badActorScore);
      const adjustedRugRiskScore = this.calculateAdjustedRugRiskScore(tokenInfo.rug_risk_score, badActorScore);

      // Update token
      this.updateTokenBadActorInfo(
        mint,
        sniperBadCount,
        bundlerBadCount,
        insiderBadCount,
        badActorScore,
        adjustedHealthScore,
        adjustedRugRiskScore
      );

      // Log significant changes
      const healthChange = adjustedHealthScore - tokenInfo.health_score;
      const rugChange = adjustedRugRiskScore - tokenInfo.rug_risk_score;

      if (Math.abs(healthChange) > 5 || Math.abs(rugChange) > 5) {
        logger.info('token-rollup', mint, 'significant_change', 
          `Health: ${tokenInfo.health_score} → ${adjustedHealthScore} (${healthChange > 0 ? '+' : ''}${healthChange}), ` +
          `Rug: ${tokenInfo.rug_risk_score} → ${adjustedRugRiskScore} (${rugChange > 0 ? '+' : ''}${rugChange})`);
      }

      logger.info('token-rollup', mint, 'processing_completed', 
        `Bad actors - Snipers: ${sniperBadCount}, Bundlers: ${bundlerBadCount}, Insiders: ${insiderBadCount}, Score: ${badActorScore}`);

    } catch (error) {
      logger.error('token-rollup', mint, 'processing_failed', `Failed to process token: ${error.message}`);
    }
  }

  /**
   * Main processing loop
   */
  async process() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    logger.info('token-rollup', 'system', 'worker_started', 'Starting token rollup worker');

    try {
      const tokens = this.getTokensForRollup();
      logger.info('token-rollup', 'system', 'tokens_found', `Found ${tokens.length} tokens to process`);

      let processed = 0;
      for (const token of tokens) {
        await this.processToken(token.mint);
        processed++;

        if (processed % 10 === 0) {
          logger.info('token-rollup', 'system', 'progress', `Processed ${processed}/${tokens.length} tokens`);
        }
      }

      logger.info('token-rollup', 'system', 'worker_completed', `Processed ${processed} tokens`);
    } catch (error) {
      logger.error('token-rollup', 'system', 'processing_failed', `Worker failed: ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start the worker
   */
  start() {
    logger.info('token-rollup', 'system', 'worker_starting', 'Starting token rollup worker');
    
    // Run immediately
    this.process();
    
    // Then run every 2 hours
    setInterval(() => {
      this.process();
    }, 2 * 60 * 60 * 1000);
  }
}

// Run if called directly
if (require.main === module) {
  const worker = new TokenRollupWorker();
  worker.start();
}

module.exports = TokenRollupWorker;
