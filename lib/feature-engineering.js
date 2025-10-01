// lib/feature-engineering.js - Task 13 Feature Engineering for Advanced Scoring
const Database = require('better-sqlite3');
const logger = require('./logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

class FeatureEngineering {
  constructor() {
    this.featureNames = [
      // Core features from Tasks 8-12
      'health_30m', 'delta_health_15m', 'fresh_pct', 'sniper_pct', 'insider_pct', 
      'top10_pct', 'liquidity_usd_log', 'lp_burned', 'lp_locked', 'rug_risk_score_30m',
      
      // Wallet network features (Task 12)
      'sniper_bad_count', 'bundler_bad_count', 'insider_bad_count', 'bad_actor_score',
      'max_reputation_score', 'high_rep_snipers', 'high_rep_bundlers', 'high_rep_insiders',
      
      // Momentum features (pre-label, leakage-safe)
      'delta_price_15m', 'delta_holders_15m', 'delta_liquidity_15m',
      
      // Meta features
      'dex_type', 'pool_age_mins', 'weekday', 'hour', 'is_weekend'
    ];
  }

  /**
   * Get token data at T=30m snapshot
   */
  getTokenSnapshot30m(mint, firstSeenAt) {
    try {
      const snapshotTime = new Date(new Date(firstSeenAt).getTime() + 30 * 60 * 1000).toISOString();
      
      const token = db.prepare(`
        SELECT 
          t.mint, t.symbol, t.health_score, t.fresh_pct, t.sniper_pct, t.insider_pct,
          t.top10_share, t.liquidity_usd, t.rug_risk_score, t.lp_burned, t.lp_locked,
          t.sniper_bad_count, t.bundler_bad_count, t.insider_bad_count, t.bad_actor_score,
          ph.price as price_30m,
          hh.holders_count as holders_30m
        FROM tokens t
        LEFT JOIN price_history ph ON t.mint = ph.mint 
          AND ph.snapshot_time = datetime(t.first_seen_at, '+30 minutes')
        LEFT JOIN holders_history hh ON t.mint = hh.mint 
          AND hh.snapshot_time = datetime(t.first_seen_at, '+30 minutes')
        WHERE t.mint = ?
      `).get(mint);

      return token;
    } catch (error) {
      logger.error('feature-engineering', mint, 'get_snapshot_failed', `Failed to get 30m snapshot: ${error.message}`);
      return null;
    }
  }

  /**
   * Get momentum features (15m window ending at 30m)
   */
  getMomentumFeatures(mint, firstSeenAt) {
    try {
      const endTime = new Date(new Date(firstSeenAt).getTime() + 30 * 60 * 1000).toISOString();
      const startTime = new Date(new Date(firstSeenAt).getTime() + 15 * 60 * 1000).toISOString();

      // Price momentum (TWAP)
      const prices = db.prepare(`
        SELECT price, snapshot_time
        FROM price_history
        WHERE mint = ? 
          AND datetime(snapshot_time) >= datetime(?)
          AND datetime(snapshot_time) <= datetime(?)
        ORDER BY snapshot_time ASC
      `).all(mint, startTime, endTime);

      // Holders momentum
      const holders = db.prepare(`
        SELECT holders_count, snapshot_time
        FROM holders_history
        WHERE mint = ? 
          AND datetime(snapshot_time) >= datetime(?)
          AND datetime(snapshot_time) <= datetime(?)
        ORDER BY snapshot_time ASC
      `).all(mint, startTime, endTime);

      // Liquidity momentum (EMA)
      const liquidity = db.prepare(`
        SELECT liquidity_usd, snapshot_time
        FROM score_history
        WHERE mint = ? 
          AND datetime(snapshot_time) >= datetime(?)
          AND datetime(snapshot_time) <= datetime(?)
        ORDER BY snapshot_time ASC
      `).all(mint, startTime, endTime);

      const momentum = {
        delta_price_15m: 0,
        delta_holders_15m: 0,
        delta_liquidity_15m: 0
      };

      if (prices.length >= 2) {
        const priceStart = prices[0].price;
        const priceEnd = prices[prices.length - 1].price;
        momentum.delta_price_15m = (priceEnd - priceStart) / priceStart;
      }

      if (holders.length >= 2) {
        const holdersStart = holders[0].holders_count;
        const holdersEnd = holders[holders.length - 1].holders_count;
        momentum.delta_holders_15m = (holdersEnd - holdersStart) / Math.max(holdersStart, 1);
      }

      if (liquidity.length >= 2) {
        const liqStart = liquidity[0].liquidity_usd;
        const liqEnd = liquidity[liquidity.length - 1].liquidity_usd;
        momentum.delta_liquidity_15m = (liqEnd - liqStart) / Math.max(liqStart, 1);
      }

      return momentum;
    } catch (error) {
      logger.error('feature-engineering', mint, 'momentum_failed', `Failed to get momentum features: ${error.message}`);
      return { delta_price_15m: 0, delta_holders_15m: 0, delta_liquidity_15m: 0 };
    }
  }

  /**
   * Get wallet network features
   */
  getWalletNetworkFeatures(mint) {
    try {
      const features = db.prepare(`
        SELECT 
          MAX(wr.reputation_score) as max_reputation_score,
          COUNT(CASE WHEN h.is_sniper = 1 AND wr.reputation_score >= 60 THEN 1 END) as high_rep_snipers,
          COUNT(CASE WHEN h.is_bundler = 1 AND wr.reputation_score >= 60 THEN 1 END) as high_rep_bundlers,
          COUNT(CASE WHEN h.is_insider = 1 AND wr.reputation_score >= 60 THEN 1 END) as high_rep_insiders
        FROM holders h
        LEFT JOIN wallet_reputation wr ON h.owner = wr.wallet
        WHERE h.mint = ?
      `).get(mint);

      return {
        max_reputation_score: features.max_reputation_score || 0,
        high_rep_snipers: features.high_rep_snipers || 0,
        high_rep_bundlers: features.high_rep_bundlers || 0,
        high_rep_insiders: features.high_rep_insiders || 0
      };
    } catch (error) {
      logger.error('feature-engineering', mint, 'wallet_network_failed', `Failed to get wallet network features: ${error.message}`);
      return {
        max_reputation_score: 0,
        high_rep_snipers: 0,
        high_rep_bundlers: 0,
        high_rep_insiders: 0
      };
    }
  }

  /**
   * Get meta features
   */
  getMetaFeatures(firstSeenAt, source) {
    const date = new Date(firstSeenAt);
    const weekday = date.getDay();
    const hour = date.getHours();
    
    return {
      dex_type: source === 'pump.fun' ? 1 : 0, // One-hot for DEX type
      pool_age_mins: 30, // Always 30 minutes at snapshot time
      weekday: weekday,
      hour: hour,
      is_weekend: weekday === 0 || weekday === 6 ? 1 : 0
    };
  }

  /**
   * Calculate delta health at 15m
   */
  getDeltaHealth15m(mint, firstSeenAt) {
    try {
      const endTime = new Date(new Date(firstSeenAt).getTime() + 30 * 60 * 1000).toISOString();
      const startTime = new Date(new Date(firstSeenAt).getTime() + 15 * 60 * 1000).toISOString();

      const healthScores = db.prepare(`
        SELECT health_score, snapshot_time
        FROM score_history
        WHERE mint = ? 
          AND datetime(snapshot_time) >= datetime(?)
          AND datetime(snapshot_time) <= datetime(?)
        ORDER BY snapshot_time ASC
      `).all(mint, startTime, endTime);

      if (healthScores.length >= 2) {
        const healthStart = healthScores[0].health_score;
        const healthEnd = healthScores[healthScores.length - 1].health_score;
        return healthEnd - healthStart;
      }

      return 0;
    } catch (error) {
      logger.error('feature-engineering', mint, 'delta_health_failed', `Failed to get delta health: ${error.message}`);
      return 0;
    }
  }

  /**
   * Generate all features for a token
   */
  generateFeatures(mint, firstSeenAt, source) {
    try {
      const snapshot = this.getTokenSnapshot30m(mint, firstSeenAt);
      if (!snapshot) {
        return null;
      }

      const momentum = this.getMomentumFeatures(mint, firstSeenAt);
      const walletNetwork = this.getWalletNetworkFeatures(mint);
      const meta = this.getMetaFeatures(firstSeenAt, source);
      const deltaHealth = this.getDeltaHealth15m(mint, firstSeenAt);

      const features = {
        // Core features
        health_30m: snapshot.health_score || 0,
        delta_health_15m: deltaHealth,
        fresh_pct: snapshot.fresh_pct || 0,
        sniper_pct: snapshot.sniper_pct || 0,
        insider_pct: snapshot.insider_pct || 0,
        top10_pct: snapshot.top10_share || 0,
        liquidity_usd_log: Math.log(Math.max(snapshot.liquidity_usd || 1, 1)),
        lp_burned: snapshot.lp_burned || 0,
        lp_locked: snapshot.lp_locked || 0,
        rug_risk_score_30m: snapshot.rug_risk_score || 0,

        // Wallet network features
        sniper_bad_count: snapshot.sniper_bad_count || 0,
        bundler_bad_count: snapshot.bundler_bad_count || 0,
        insider_bad_count: snapshot.insider_bad_count || 0,
        bad_actor_score: snapshot.bad_actor_score || 0,
        max_reputation_score: walletNetwork.max_reputation_score,
        high_rep_snipers: walletNetwork.high_rep_snipers,
        high_rep_bundlers: walletNetwork.high_rep_bundlers,
        high_rep_insiders: walletNetwork.high_rep_insiders,

        // Momentum features
        delta_price_15m: momentum.delta_price_15m,
        delta_holders_15m: momentum.delta_holders_15m,
        delta_liquidity_15m: momentum.delta_liquidity_15m,

        // Meta features
        dex_type: meta.dex_type,
        pool_age_mins: meta.pool_age_mins,
        weekday: meta.weekday,
        hour: meta.hour,
        is_weekend: meta.is_weekend
      };

      // Add missing value indicators
      Object.keys(features).forEach(key => {
        if (features[key] === null || features[key] === undefined || isNaN(features[key])) {
          features[`is_missing_${key}`] = 1;
          features[key] = 0; // Replace with neutral prior
        } else {
          features[`is_missing_${key}`] = 0;
        }
      });

      return features;
    } catch (error) {
      logger.error('feature-engineering', mint, 'feature_generation_failed', `Failed to generate features: ${error.message}`);
      return null;
    }
  }

  /**
   * Generate features for training dataset
   */
  generateTrainingFeatures() {
    try {
      const tokens = db.prepare(`
        SELECT t.mint, t.first_seen_at, t.source, tl.winner_2x_24h, tl.rug_24h
        FROM tokens t
        JOIN token_labels tl ON t.mint = tl.mint
        WHERE tl.winner_2x_24h IS NOT NULL AND tl.rug_24h IS NOT NULL
        ORDER BY t.first_seen_at DESC
      `).all();

      const features = [];
      const labels = { winner: [], rug: [] };

      for (const token of tokens) {
        const tokenFeatures = this.generateFeatures(token.mint, token.first_seen_at, token.source);
        if (tokenFeatures) {
          features.push({
            mint: token.mint,
            features: tokenFeatures
          });
          labels.winner.push(token.winner_2x_24h);
          labels.rug.push(token.rug_24h);
        }
      }

      return { features, labels };
    } catch (error) {
      logger.error('feature-engineering', 'system', 'training_features_failed', `Failed to generate training features: ${error.message}`);
      return { features: [], labels: { winner: [], rug: [] } };
    }
  }

  /**
   * Generate features for inference
   */
  generateInferenceFeatures(mint) {
    try {
      const token = db.prepare(`
        SELECT mint, first_seen_at, source FROM tokens WHERE mint = ?
      `).get(mint);

      if (!token) {
        return null;
      }

      return this.generateFeatures(token.mint, token.first_seen_at, token.source);
    } catch (error) {
      logger.error('feature-engineering', mint, 'inference_features_failed', `Failed to generate inference features: ${error.message}`);
      return null;
    }
  }
}

module.exports = FeatureEngineering;
