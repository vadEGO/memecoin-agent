// workers/reputation-aggregate-worker.js - Task 12 Wallet Reputation Aggregation
const Database = require('better-sqlite3');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

class ReputationAggregateWorker {
  constructor() {
    this.isRunning = false;
    this.WINDOW_DAYS = 30;
    this.DECAY_HALF_LIFE_DAYS = 14;
  }

  /**
   * Calculate decay factor for an event based on age
   */
  calculateDecayFactor(eventTimestamp) {
    const now = new Date();
    const eventTime = new Date(eventTimestamp);
    const daysAgo = (now.getTime() - eventTime.getTime()) / (1000 * 60 * 60 * 24);
    
    // Exponential decay with half-life of 14 days
    return Math.pow(0.5, daysAgo / this.DECAY_HALF_LIFE_DAYS);
  }

  /**
   * Check if wallet is tagged as market maker
   */
  isMarketMaker(wallet) {
    try {
      const result = db.prepare(`
        SELECT 1 FROM wallet_tags WHERE wallet = ? AND tag = 'market_maker'
      `).get(wallet);
      
      return !!result;
    } catch (error) {
      logger.error('reputation-aggregate', 'system', 'market_maker_check_failed', `Failed to check market maker status for ${wallet}: ${error.message}`);
      return false;
    }
  }

  /**
   * Get sniper events for a wallet in the last 30 days
   */
  getSniperEvents(wallet) {
    try {
      const events = db.prepare(`
        SELECT ts, is_sniper
        FROM buy_events
        WHERE wallet = ? 
          AND datetime(ts) > datetime('now', '-${this.WINDOW_DAYS} days')
          AND is_sniper = 1
        ORDER BY ts DESC
      `).all(wallet);

      return events;
    } catch (error) {
      logger.error('reputation-aggregate', 'system', 'sniper_events_failed', `Failed to get sniper events for ${wallet}: ${error.message}`);
      return [];
    }
  }

  /**
   * Get successful sniper events (with 24h return >= 50%)
   */
  getSuccessfulSniperEvents(wallet) {
    try {
      // This would need integration with Task 10 return labels
      // For now, we'll use a simplified heuristic
      const events = db.prepare(`
        SELECT be.ts, be.mint, be.is_sniper
        FROM buy_events be
        JOIN tokens t ON be.mint = t.mint
        WHERE be.wallet = ? 
          AND datetime(be.ts) > datetime('now', '-${this.WINDOW_DAYS} days')
          AND be.is_sniper = 1
          AND t.liquidity_usd > 1000  -- Basic success heuristic
        ORDER BY be.ts DESC
      `).all(wallet);

      return events;
    } catch (error) {
      logger.error('reputation-aggregate', 'system', 'successful_sniper_events_failed', `Failed to get successful sniper events for ${wallet}: ${error.message}`);
      return [];
    }
  }

  /**
   * Get bundle events for a wallet
   */
  getBundleEvents(wallet) {
    try {
      const events = db.prepare(`
        SELECT DISTINCT mint, ts
        FROM bundle_events
        WHERE bundler = ?
          AND datetime(ts) > datetime('now', '-${this.WINDOW_DAYS} days')
        ORDER BY ts DESC
      `).all(wallet);

      return events;
    } catch (error) {
      logger.error('reputation-aggregate', 'system', 'bundle_events_failed', `Failed to get bundle events for ${wallet}: ${error.message}`);
      return [];
    }
  }

  /**
   * Get recipient count for a bundler
   */
  getRecipientCount(wallet) {
    try {
      const result = db.prepare(`
        SELECT COUNT(DISTINCT recipient) as count
        FROM bundle_events
        WHERE bundler = ?
          AND datetime(ts) > datetime('now', '-${this.WINDOW_DAYS} days')
      `).get(wallet);

      return result ? result.count : 0;
    } catch (error) {
      logger.error('reputation-aggregate', 'system', 'recipient_count_failed', `Failed to get recipient count for ${wallet}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Get insider events for a wallet
   */
  getInsiderEvents(wallet) {
    try {
      const events = db.prepare(`
        SELECT DISTINCT mint, ts
        FROM insider_events
        WHERE wallet = ?
          AND datetime(ts) > datetime('now', '-${this.WINDOW_DAYS} days')
        ORDER BY ts DESC
      `).all(wallet);

      return events;
    } catch (error) {
      logger.error('reputation-aggregate', 'system', 'insider_events_failed', `Failed to get insider events for ${wallet}: ${error.message}`);
      return [];
    }
  }

  /**
   * Get rug involvement count for a wallet
   */
  getRugInvolvement(wallet) {
    try {
      const result = db.prepare(`
        SELECT COUNT(DISTINCT h.mint) as count
        FROM holders h
        JOIN tokens t ON h.mint = t.mint
        WHERE h.owner = ?
          AND h.amount IN (
            SELECT amount FROM holders h2 
            WHERE h2.mint = h.mint 
            ORDER BY CAST(h2.amount AS REAL) DESC 
            LIMIT 10
          )
          AND t.rug_risk_score >= 90
          AND datetime(h.last_seen_at) > datetime('now', '-${this.WINDOW_DAYS} days')
      `).get(wallet);

      return result ? result.count : 0;
    } catch (error) {
      logger.error('reputation-aggregate', 'system', 'rug_involvement_failed', `Failed to get rug involvement for ${wallet}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Calculate reputation score for a wallet
   */
  calculateReputationScore(wallet) {
    try {
      const isMM = this.isMarketMaker(wallet);
      const penaltyFactor = isMM ? 0.25 : 1.0;

      // Get all events
      const sniperEvents = this.getSniperEvents(wallet);
      const successfulSniperEvents = this.getSuccessfulSniperEvents(wallet);
      const bundleEvents = this.getBundleEvents(wallet);
      const recipientCount = this.getRecipientCount(wallet);
      const insiderEvents = this.getInsiderEvents(wallet);
      const rugInvolvement = this.getRugInvolvement(wallet);

      // Calculate scores with decay
      let S_snipes = 0;
      for (const event of sniperEvents) {
        const decay = this.calculateDecayFactor(event.ts);
        S_snipes += decay;
      }
      S_snipes = Math.min(20, S_snipes) * 2;

      let S_bundles = 0;
      S_bundles += Math.min(20, bundleEvents.length) * 2;
      S_bundles += Math.min(50, recipientCount / 5);

      const S_insider = insiderEvents.length * 10;
      const S_rug = rugInvolvement * 20;
      const S_reward = Math.min(10, successfulSniperEvents.length * 2);

      // Apply market maker penalty
      const rawScore = S_snipes + S_bundles + S_insider + S_rug - S_reward;
      const reputationScore = Math.max(0, Math.min(100, rawScore * penaltyFactor));

      const scoreBreakdown = {
        S_snipes: Math.round(S_snipes * 100) / 100,
        S_bundles: Math.round(S_bundles * 100) / 100,
        S_insider: Math.round(S_insider * 100) / 100,
        S_rug: Math.round(S_rug * 100) / 100,
        S_reward: Math.round(S_reward * 100) / 100,
        penalty_factor: penaltyFactor,
        is_market_maker: isMM
      };

      return {
        reputationScore: Math.round(reputationScore * 100) / 100,
        scoreBreakdown: JSON.stringify(scoreBreakdown),
        snipesTotal: sniperEvents.length,
        snipesSuccess: successfulSniperEvents.length,
        bundlesTotal: bundleEvents.length,
        recipientsTotal: recipientCount,
        insiderHits: insiderEvents.length,
        rugInvolved: rugInvolvement
      };
    } catch (error) {
      logger.error('reputation-aggregate', 'system', 'score_calculation_failed', `Failed to calculate reputation for ${wallet}: ${error.message}`);
      return {
        reputationScore: 0,
        scoreBreakdown: JSON.stringify({}),
        snipesTotal: 0,
        snipesSuccess: 0,
        bundlesTotal: 0,
        recipientsTotal: 0,
        insiderHits: 0,
        rugInvolved: 0
      };
    }
  }

  /**
   * Get all wallets that need reputation calculation
   */
  getWalletsForReputation() {
    try {
      const wallets = db.prepare(`
        SELECT DISTINCT wallet FROM (
          SELECT src as wallet FROM funding_edges WHERE datetime(ts) > datetime('now', '-${this.WINDOW_DAYS} days')
          UNION
          SELECT dst as wallet FROM funding_edges WHERE datetime(ts) > datetime('now', '-${this.WINDOW_DAYS} days')
          UNION
          SELECT wallet FROM buy_events WHERE datetime(ts) > datetime('now', '-${this.WINDOW_DAYS} days')
          UNION
          SELECT bundler as wallet FROM bundle_events WHERE datetime(ts) > datetime('now', '-${this.WINDOW_DAYS} days')
          UNION
          SELECT recipient as wallet FROM bundle_events WHERE datetime(ts) > datetime('now', '-${this.WINDOW_DAYS} days')
          UNION
          SELECT wallet FROM insider_events WHERE datetime(ts) > datetime('now', '-${this.WINDOW_DAYS} days')
        )
        ORDER BY wallet
      `).all();

      return wallets.map(w => w.wallet);
    } catch (error) {
      logger.error('reputation-aggregate', 'system', 'get_wallets_failed', `Failed to get wallets: ${error.message}`);
      return [];
    }
  }

  /**
   * Update wallet reputation in database
   */
  updateWalletReputation(wallet, reputationData) {
    try {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO wallet_reputation (
          wallet, snipes_total, snipes_success, bundles_total, recipients_total,
          insider_hits, rug_involved, last_seen_at, reputation_score, score_breakdown,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, datetime('now'))
      `);

      stmt.run(
        wallet,
        reputationData.snipesTotal,
        reputationData.snipesSuccess,
        reputationData.bundlesTotal,
        reputationData.recipientsTotal,
        reputationData.insiderHits,
        reputationData.rugInvolved,
        reputationData.reputationScore,
        reputationData.scoreBreakdown
      );

      logger.debug('reputation-aggregate', wallet, 'reputation_updated', `Score: ${reputationData.reputationScore}`);
    } catch (error) {
      logger.error('reputation-aggregate', 'system', 'reputation_update_failed', `Failed to update reputation for ${wallet}: ${error.message}`);
    }
  }

  /**
   * Process all wallets for reputation calculation
   */
  async process() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    logger.info('reputation-aggregate', 'system', 'worker_started', 'Starting reputation aggregation worker');

    try {
      const wallets = this.getWalletsForReputation();
      logger.info('reputation-aggregate', 'system', 'wallets_found', `Found ${wallets.length} wallets to process`);

      let processed = 0;
      for (const wallet of wallets) {
        try {
          const reputationData = this.calculateReputationScore(wallet);
          this.updateWalletReputation(wallet, reputationData);
          processed++;

          if (processed % 100 === 0) {
            logger.info('reputation-aggregate', 'system', 'progress', `Processed ${processed}/${wallets.length} wallets`);
          }
        } catch (error) {
          logger.error('reputation-aggregate', 'system', 'wallet_processing_failed', `Failed to process wallet ${wallet}: ${error.message}`);
        }
      }

      logger.info('reputation-aggregate', 'system', 'worker_completed', `Processed ${processed} wallets`);
    } catch (error) {
      logger.error('reputation-aggregate', 'system', 'processing_failed', `Worker failed: ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start the worker
   */
  start() {
    logger.info('reputation-aggregate', 'system', 'worker_starting', 'Starting reputation aggregation worker');
    
    // Run immediately
    this.process();
    
    // Then run every hour
    setInterval(() => {
      this.process();
    }, 60 * 60 * 1000);
  }
}

// Run if called directly
if (require.main === module) {
  const worker = new ReputationAggregateWorker();
  worker.start();
}

module.exports = ReputationAggregateWorker;
