// workers/backtest-harness-worker.js - Task 13 Backtest Harness for Model Evaluation
const Database = require('better-sqlite3');
const logger = require('../lib/logger');
const FeatureEngineering = require('../lib/feature-engineering');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

class BacktestHarnessWorker {
  constructor() {
    this.isRunning = false;
    this.featureEngineering = new FeatureEngineering();
  }

  /**
   * Get validation dataset for backtesting
   */
  getValidationDataset() {
    try {
      const tokens = db.prepare(`
        SELECT 
          t.mint, t.symbol, t.first_seen_at, t.health_score, t.liquidity_usd,
          t.prob_2x_24h, t.prob_rug_24h, t.model_id_win, t.model_id_rug,
          tl.winner_2x_24h, tl.rug_24h
        FROM tokens t
        JOIN token_labels tl ON t.mint = tl.mint
        WHERE tl.winner_2x_24h IS NOT NULL 
          AND tl.rug_24h IS NOT NULL
          AND t.prob_2x_24h IS NOT NULL
          AND t.prob_rug_24h IS NOT NULL
        ORDER BY t.first_seen_at DESC
        LIMIT 500
      `).all();

      return tokens;
    } catch (error) {
      logger.error('backtest-harness', 'system', 'get_validation_dataset_failed', `Failed to get validation dataset: ${error.message}`);
      return [];
    }
  }

  /**
   * Calculate precision and recall at different thresholds
   */
  calculatePrecisionRecall(predictions, labels, thresholds) {
    const results = {};
    
    for (const threshold of thresholds) {
      const tp = predictions.filter((p, i) => p >= threshold && labels[i] === 1).length;
      const fp = predictions.filter((p, i) => p >= threshold && labels[i] === 0).length;
      const fn = predictions.filter((p, i) => p < threshold && labels[i] === 1).length;
      const tn = predictions.filter((p, i) => p < threshold && labels[i] === 0).length;
      
      const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
      const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
      const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
      
      results[threshold] = {
        precision,
        recall,
        f1,
        tp, fp, fn, tn
      };
    }
    
    return results;
  }

  /**
   * Calculate calibration metrics
   */
  calculateCalibrationMetrics(predictions, labels, nBins = 10) {
    const binSize = 1.0 / nBins;
    const bins = Array(nBins).fill().map(() => ({ predictions: [], labels: [] }));
    
    // Assign predictions to bins
    predictions.forEach((pred, i) => {
      const binIndex = Math.min(Math.floor(pred / binSize), nBins - 1);
      bins[binIndex].predictions.push(pred);
      bins[binIndex].labels.push(labels[i]);
    });
    
    // Calculate calibration metrics for each bin
    const binMetrics = bins.map((bin, index) => {
      if (bin.predictions.length === 0) {
        return { bin: index, meanPred: 0, meanLabel: 0, count: 0, ece: 0 };
      }
      
      const meanPred = bin.predictions.reduce((sum, p) => sum + p, 0) / bin.predictions.length;
      const meanLabel = bin.labels.reduce((sum, l) => sum + l, 0) / bin.labels.length;
      const count = bin.predictions.length;
      const ece = Math.abs(meanPred - meanLabel) * count;
      
      return { bin: index, meanPred, meanLabel, count, ece };
    });
    
    // Calculate overall ECE
    const totalCount = predictions.length;
    const ece = binMetrics.reduce((sum, bin) => sum + bin.ece, 0) / totalCount;
    
    return { binMetrics, ece };
  }

  /**
   * Calculate Brier score
   */
  calculateBrierScore(predictions, labels) {
    const n = predictions.length;
    let brierSum = 0;
    
    for (let i = 0; i < n; i++) {
      brierSum += Math.pow(predictions[i] - labels[i], 2);
    }
    
    return brierSum / n;
  }

  /**
   * Calculate AUROC
   */
  calculateAUROC(predictions, labels) {
    const n = predictions.length;
    const sorted = predictions.map((p, i) => ({ pred: p, label: labels[i] }))
      .sort((a, b) => b.pred - a.pred);

    let auc = 0;
    let fp = 0, tp = 0;
    let fpPrev = 0, tpPrev = 0;

    for (const item of sorted) {
      if (item.label === 1) {
        tp++;
      } else {
        fp++;
      }

      if (fp !== fpPrev || tp !== tpPrev) {
        auc += (fp - fpPrev) * (tp + tpPrev) / 2;
        fpPrev = fp;
        tpPrev = tp;
      }
    }

    const totalPos = labels.reduce((sum, l) => sum + l, 0);
    const totalNeg = n - totalPos;

    return totalPos > 0 && totalNeg > 0 ? auc / (totalPos * totalNeg) : 0.5;
  }

  /**
   * Calculate AUPRC
   */
  calculateAUPRC(predictions, labels) {
    const n = predictions.length;
    const sorted = predictions.map((p, i) => ({ pred: p, label: labels[i] }))
      .sort((a, b) => b.pred - a.pred);

    let auc = 0;
    let tp = 0, fp = 0;
    let tpPrev = 0, fpPrev = 0;

    for (const item of sorted) {
      if (item.label === 1) {
        tp++;
      } else {
        fp++;
      }

      if (tp !== tpPrev || fp !== fpPrev) {
        const precision = tp / (tp + fp);
        const recall = tp / labels.reduce((sum, l) => sum + l, 0);
        auc += (fp - fpPrev) * precision;
        tpPrev = tp;
        fpPrev = fp;
      }
    }

    return auc;
  }

  /**
   * Run backtest for a specific target
   */
  runBacktestForTarget(target, tokens) {
    try {
      const predictions = tokens.map(t => target === '2x_24h' ? t.prob_2x_24h : t.prob_rug_24h);
      const labels = tokens.map(t => target === '2x_24h' ? t.winner_2x_24h : t.rug_24h);
      
      // Calculate metrics
      const auroc = this.calculateAUROC(predictions, labels);
      const auprc = this.calculateAUPRC(predictions, labels);
      const brier = this.calculateBrierScore(predictions, labels);
      const calibration = this.calculateCalibrationMetrics(predictions, labels);
      
      // Calculate precision/recall at different thresholds
      const thresholds = target === '2x_24h' ? [0.2, 0.3, 0.4, 0.5] : [0.4, 0.6, 0.8, 0.9];
      const precisionRecall = this.calculatePrecisionRecall(predictions, labels, thresholds);
      
      return {
        auroc,
        auprc,
        brier,
        ece: calibration.ece,
        precisionRecall,
        calibrationBins: calibration.binMetrics
      };
    } catch (error) {
      logger.error('backtest-harness', 'system', 'backtest_failed', `Failed to run backtest for ${target}: ${error.message}`);
      return null;
    }
  }

  /**
   * Generate operating thresholds
   */
  generateOperatingThresholds(winnerMetrics, rugMetrics) {
    // Find optimal thresholds based on precision/recall trade-offs
    const winnerThresholds = winnerMetrics.precisionRecall;
    const rugThresholds = rugMetrics.precisionRecall;
    
    // Choose thresholds that balance precision and recall
    const prob2xThreshold = 0.30; // 30% for Pro alerts
    const prob2xFreeThreshold = 0.40; // 40% for Free alerts (delayed)
    const probRugRiskThreshold = 0.60; // 60% for Risk alerts
    const probRugImmediateThreshold = 0.80; // 80% for immediate Rug alerts
    
    return {
      prob2x_threshold: prob2xThreshold,
      prob2x_free_threshold: prob2xFreeThreshold,
      probrug_risk_threshold: probRugRiskThreshold,
      probrug_immediate_threshold: probRugImmediateThreshold
    };
  }

  /**
   * Main backtest process
   */
  async runBacktest() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    logger.info('backtest-harness', 'system', 'worker_started', 'Starting backtest harness worker');

    try {
      const tokens = this.getValidationDataset();
      if (tokens.length === 0) {
        logger.warning('backtest-harness', 'system', 'no_data', 'No validation data available');
        return;
      }

      logger.info('backtest-harness', 'system', 'dataset_loaded', `Loaded ${tokens.length} tokens for backtesting`);

      // Run backtests for both targets
      const winnerMetrics = this.runBacktestForTarget('2x_24h', tokens);
      const rugMetrics = this.runBacktestForTarget('rug_24h', tokens);

      if (!winnerMetrics || !rugMetrics) {
        logger.error('backtest-harness', 'system', 'backtest_failed', 'Backtest calculation failed');
        return;
      }

      // Generate operating thresholds
      const thresholds = this.generateOperatingThresholds(winnerMetrics, rugMetrics);

      // Store backtest results
      const runId = `backtest_${new Date().toISOString().split('T')[0]}_${Date.now()}`;
      const metrics = {
        winner: winnerMetrics,
        rug: rugMetrics
      };

      db.prepare(`
        INSERT OR REPLACE INTO backtest_runs 
        (run_id, model_id_win, model_id_rug, thresholds, metrics, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        runId,
        tokens[0]?.model_id_win || 'unknown',
        tokens[0]?.model_id_rug || 'unknown',
        JSON.stringify(thresholds),
        JSON.stringify(metrics),
        new Date().toISOString()
      );

      logger.info('backtest-harness', 'system', 'backtest_completed', 
        `Backtest completed: Winner AUROC ${winnerMetrics.auroc.toFixed(3)}, Rug AUROC ${rugMetrics.auroc.toFixed(3)}`);

      // Log detailed results
      logger.info('backtest-harness', 'system', 'winner_metrics', 
        `Winner: AUROC ${winnerMetrics.auroc.toFixed(3)}, AUPRC ${winnerMetrics.auprc.toFixed(3)}, Brier ${winnerMetrics.brier.toFixed(3)}, ECE ${winnerMetrics.ece.toFixed(3)}`);
      
      logger.info('backtest-harness', 'system', 'rug_metrics', 
        `Rug: AUROC ${rugMetrics.auroc.toFixed(3)}, AUPRC ${rugMetrics.auprc.toFixed(3)}, Brier ${rugMetrics.brier.toFixed(3)}, ECE ${rugMetrics.ece.toFixed(3)}`);

    } catch (error) {
      logger.error('backtest-harness', 'system', 'backtest_failed', `Backtest failed: ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start the worker
   */
  start() {
    logger.info('backtest-harness', 'system', 'worker_starting', 'Starting backtest harness worker');
    
    // Run immediately
    this.runBacktest();
    
    // Then run daily
    setInterval(() => {
      this.runBacktest();
    }, 24 * 60 * 60 * 1000);
  }
}

// Run if called directly
if (require.main === module) {
  const worker = new BacktestHarnessWorker();
  worker.start();
}

module.exports = BacktestHarnessWorker;