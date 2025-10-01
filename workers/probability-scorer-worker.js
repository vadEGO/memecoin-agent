// workers/probability-scorer-worker.js - Task 13 Online Probability Scoring
const Database = require('better-sqlite3');
const logger = require('../lib/logger');
const FeatureEngineering = require('../lib/feature-engineering');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

class ProbabilityScorerWorker {
  constructor() {
    this.isRunning = false;
    this.featureEngineering = new FeatureEngineering();
    this.models = {};
  }

  /**
   * Load latest models from registry
   */
  loadLatestModels() {
    try {
      const winnerModel = db.prepare(`
        SELECT * FROM model_registry 
        WHERE target = '2x_24h' 
        ORDER BY created_at DESC 
        LIMIT 1
      `).get();

      const rugModel = db.prepare(`
        SELECT * FROM model_registry 
        WHERE target = 'rug_24h' 
        ORDER BY created_at DESC 
        LIMIT 1
      `).get();

      if (winnerModel) {
        this.models.winner = {
          modelId: winnerModel.model_id,
          calibration: JSON.parse(winnerModel.calibration),
          features: JSON.parse(winnerModel.features)
        };
        logger.info('probability-scorer', 'system', 'winner_model_loaded', `Loaded ${winnerModel.model_id}`);
      }

      if (rugModel) {
        this.models.rug = {
          modelId: rugModel.model_id,
          calibration: JSON.parse(rugModel.calibration),
          features: JSON.parse(rugModel.features)
        };
        logger.info('probability-scorer', 'system', 'rug_model_loaded', `Loaded ${rugModel.model_id}`);
      }

      return winnerModel && rugModel;
    } catch (error) {
      logger.error('probability-scorer', 'system', 'model_loading_failed', `Failed to load models: ${error.message}`);
      return false;
    }
  }

  /**
   * Simple Logistic Regression for inference
   */
  class LogisticRegressionInference {
    constructor(weights, bias) {
      this.weights = weights;
      this.bias = bias;
    }

    sigmoid(z) {
      return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
    }

    predict(X) {
      return X.map(x => {
        const z = this.bias + this.weights.reduce((sum, w, j) => sum + w * x[j], 0);
        return this.sigmoid(z);
      });
    }
  }

  /**
   * Platt scaling for calibration
   */
  class PlattScalingInference {
    constructor(A, B) {
      this.A = A;
      this.B = B;
    }

    transform(predictions) {
      return predictions.map(p => {
        const scaled = this.A * p + this.B;
        return Math.max(0, Math.min(1, scaled));
      });
    }
  }

  /**
   * Get tokens eligible for scoring (age 20-90 minutes)
   */
  getEligibleTokens() {
    try {
      const tokens = db.prepare(`
        SELECT mint, symbol, first_seen_at, source
        FROM tokens
        WHERE first_seen_at IS NOT NULL
          AND datetime(first_seen_at) >= datetime('now', '-90 minutes')
          AND datetime(first_seen_at) <= datetime('now', '-20 minutes')
          AND lp_exists = 1
        ORDER BY first_seen_at DESC
        LIMIT 50
      `).all();

      return tokens;
    } catch (error) {
      logger.error('probability-scorer', 'system', 'get_eligible_tokens_failed', `Failed to get eligible tokens: ${error.message}`);
      return [];
    }
  }

  /**
   * Generate explainability string
   */
  generateExplainability(features, weights, featureNames, topN = 3) {
    try {
      const contributions = weights.map((weight, i) => ({
        feature: featureNames[i] || `feature_${i}`,
        weight: weight,
        value: features[i] || 0,
        contribution: weight * (features[i] || 0)
      }));

      // Sort by absolute contribution
      contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

      const topContributors = contributions.slice(0, topN);
      const explainParts = topContributors.map(c => 
        `${c.feature} ${c.contribution >= 0 ? '+' : ''}${c.contribution.toFixed(2)}`
      );

      return explainParts.join(', ');
    } catch (error) {
      logger.error('probability-scorer', 'system', 'explainability_failed', `Failed to generate explainability: ${error.message}`);
      return '';
    }
  }

  /**
   * Score a single token
   */
  async scoreToken(mint, token) {
    try {
      logger.info('probability-scorer', mint, 'scoring_started', 'Starting probability scoring');

      // Generate features
      const features = this.featureEngineering.generateInferenceFeatures(mint);
      if (!features) {
        logger.warn('probability-scorer', mint, 'no_features', 'No features available');
        return;
      }

      const featureArray = Object.values(features).filter(v => typeof v === 'number' && !isNaN(v));
      const snapshotTime = new Date(new Date(token.first_seen_at).getTime() + 30 * 60 * 1000).toISOString();

      let prob2x24h = 0;
      let probRug24h = 0;
      let explainWin = '';
      let explainRug = '';

      // Score winner probability
      if (this.models.winner) {
        try {
          // In a real implementation, you would load the actual trained model
          // For now, we'll simulate with a simple heuristic
          const healthScore = features.health_30m || 0;
          const freshPct = features.fresh_pct || 0;
          const liquidityLog = features.liquidity_usd_log || 0;
          const sniperPct = features.sniper_pct || 0;
          const insiderPct = features.insider_pct || 0;

          // Simple heuristic-based scoring (replace with actual model)
          prob2x24h = Math.max(0, Math.min(1, 
            (healthScore / 100) * 0.3 + 
            (freshPct / 100) * 0.2 + 
            (liquidityLog / 15) * 0.2 + 
            (1 - sniperPct / 100) * 0.2 + 
            (1 - insiderPct / 100) * 0.1
          ));

          explainWin = `Health ${(healthScore/100*0.3).toFixed(2)}, Fresh ${(freshPct/100*0.2).toFixed(2)}, Liq ${(liquidityLog/15*0.2).toFixed(2)}`;
        } catch (error) {
          logger.error('probability-scorer', mint, 'winner_scoring_failed', `Failed to score winner: ${error.message}`);
        }
      }

      // Score rug probability
      if (this.models.rug) {
        try {
          const rugRiskScore = features.rug_risk_score_30m || 0;
          const badActorScore = features.bad_actor_score || 0;
          const liquidityLog = features.liquidity_usd_log || 0;
          const lpBurned = features.lp_burned || 0;

          // Simple heuristic-based scoring (replace with actual model)
          probRug24h = Math.max(0, Math.min(1,
            (rugRiskScore / 100) * 0.4 +
            (badActorScore / 30) * 0.3 +
            (1 - liquidityLog / 15) * 0.2 +
            (1 - lpBurned) * 0.1
          ));

          explainRug = `RugScore ${(rugRiskScore/100*0.4).toFixed(2)}, BadActors ${(badActorScore/30*0.3).toFixed(2)}, Liq ${((1-liquidityLog/15)*0.2).toFixed(2)}`;
        } catch (error) {
          logger.error('probability-scorer', mint, 'rug_scoring_failed', `Failed to score rug: ${error.message}`);
        }
      }

      // Store predictions
      const featuresHash = require('crypto')
        .createHash('md5')
        .update(JSON.stringify(features))
        .digest('hex');

      // Store winner prediction
      if (this.models.winner) {
        db.prepare(`
          INSERT OR REPLACE INTO token_predictions 
          (mint, ts, model_id, target, prob, features_hash, explainability, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          mint, snapshotTime, this.models.winner.modelId, '2x_24h', 
          prob2x24h, featuresHash, explainWin, new Date().toISOString()
        );
      }

      // Store rug prediction
      if (this.models.rug) {
        db.prepare(`
          INSERT OR REPLACE INTO token_predictions 
          (mint, ts, model_id, target, prob, features_hash, explainability, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          mint, snapshotTime, this.models.rug.modelId, 'rug_24h', 
          probRug24h, featuresHash, explainRug, new Date().toISOString()
        );
      }

      // Update tokens table
      db.prepare(`
        UPDATE tokens 
        SET prob_2x_24h = ?, prob_rug_24h = ?, model_id_win = ?, model_id_rug = ?
        WHERE mint = ?
      `).run(
        prob2x24h, probRug24h, 
        this.models.winner?.modelId || null, 
        this.models.rug?.modelId || null, 
        mint
      );

      logger.info('probability-scorer', mint, 'scoring_completed', 
        `Prob2x: ${prob2x24h.toFixed(3)}, ProbRug: ${probRug24h.toFixed(3)}`);

    } catch (error) {
      logger.error('probability-scorer', mint, 'scoring_failed', `Failed to score token: ${error.message}`);
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
    logger.info('probability-scorer', 'system', 'worker_started', 'Starting probability scorer worker');

    try {
      // Load latest models
      if (!this.loadLatestModels()) {
        logger.warn('probability-scorer', 'system', 'no_models', 'No models available for scoring');
        return;
      }

      const tokens = this.getEligibleTokens();
      logger.info('probability-scorer', 'system', 'tokens_found', `Found ${tokens.length} tokens to score`);

      let processed = 0;
      for (const token of tokens) {
        await this.scoreToken(token.mint, token);
        processed++;

        if (processed % 10 === 0) {
          logger.info('probability-scorer', 'system', 'progress', `Processed ${processed}/${tokens.length} tokens`);
        }
      }

      logger.info('probability-scorer', 'system', 'worker_completed', `Processed ${processed} tokens`);

    } catch (error) {
      logger.error('probability-scorer', 'system', 'processing_failed', `Worker failed: ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start the worker
   */
  start() {
    logger.info('probability-scorer', 'system', 'worker_starting', 'Starting probability scorer worker');
    
    // Run immediately
    this.process();
    
    // Then run every 5 minutes
    setInterval(() => {
      this.process();
    }, 5 * 60 * 1000);
  }
}

// Run if called directly
if (require.main === module) {
  const worker = new ProbabilityScorerWorker();
  worker.start();
}

module.exports = ProbabilityScorerWorker;
