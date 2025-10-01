// workers/model-trainer-worker.js - Task 13 Model Training with Calibration
const Database = require('better-sqlite3');
const logger = require('../lib/logger');
const FeatureEngineering = require('../lib/feature-engineering');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

class ModelTrainerWorker {
  constructor() {
    this.isRunning = false;
    this.featureEngineering = new FeatureEngineering();
    this.models = {};
  }

  /**
   * Simple Logistic Regression implementation
   */
  class LogisticRegression {
    constructor(learningRate = 0.01, maxIterations = 1000) {
      this.learningRate = learningRate;
      this.maxIterations = maxIterations;
      this.weights = null;
      this.bias = 0;
    }

    sigmoid(z) {
      return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
    }

    fit(X, y) {
      const nSamples = X.length;
      const nFeatures = X[0].length;
      
      this.weights = new Array(nFeatures).fill(0);
      this.bias = 0;

      for (let iter = 0; iter < this.maxIterations; iter++) {
        let totalLoss = 0;
        const gradWeights = new Array(nFeatures).fill(0);
        let gradBias = 0;

        for (let i = 0; i < nSamples; i++) {
          const z = this.bias + this.weights.reduce((sum, w, j) => sum + w * X[i][j], 0);
          const prediction = this.sigmoid(z);
          const error = prediction - y[i];
          
          totalLoss += y[i] * Math.log(Math.max(prediction, 1e-15)) + 
                      (1 - y[i]) * Math.log(Math.max(1 - prediction, 1e-15));

          for (let j = 0; j < nFeatures; j++) {
            gradWeights[j] += error * X[i][j];
          }
          gradBias += error;
        }

        // Update weights
        for (let j = 0; j < nFeatures; j++) {
          this.weights[j] -= this.learningRate * gradWeights[j] / nSamples;
        }
        this.bias -= this.learningRate * gradBias / nSamples;

        if (iter % 100 === 0) {
          logger.debug('model-trainer', 'system', 'training_progress', 
            `Iteration ${iter}, Loss: ${(-totalLoss / nSamples).toFixed(4)}`);
        }
      }

      logger.info('model-trainer', 'system', 'training_completed', 
        `Trained with ${nSamples} samples, ${nFeatures} features`);
    }

    predict(X) {
      return X.map(x => {
        const z = this.bias + this.weights.reduce((sum, w, j) => sum + w * x[j], 0);
        return this.sigmoid(z);
      });
    }

    getFeatureWeights() {
      return this.weights;
    }
  }

  /**
   * Platt scaling for calibration
   */
  class PlattScaling {
    constructor() {
      this.A = 1;
      this.B = 0;
    }

    fit(predictions, labels) {
      // Simple implementation - in practice, use more sophisticated method
      const meanPred = predictions.reduce((sum, p) => sum + p, 0) / predictions.length;
      const meanLabel = labels.reduce((sum, l) => sum + l, 0) / labels.length;
      
      this.A = meanLabel / Math.max(meanPred, 1e-15);
      this.B = 0;
      
      logger.debug('model-trainer', 'system', 'platt_scaling', 
        `A: ${this.A.toFixed(4)}, B: ${this.B.toFixed(4)}`);
    }

    transform(predictions) {
      return predictions.map(p => {
        const scaled = this.A * p + this.B;
        return Math.max(0, Math.min(1, scaled));
      });
    }
  }

  /**
   * Calculate metrics
   */
  calculateMetrics(predictions, labels) {
    const n = predictions.length;
    let tp = 0, fp = 0, tn = 0, fn = 0;
    let brierSum = 0;

    for (let i = 0; i < n; i++) {
      const pred = predictions[i];
      const label = labels[i];
      const predBinary = pred >= 0.5 ? 1 : 0;

      brierSum += Math.pow(pred - label, 2);

      if (predBinary === 1 && label === 1) tp++;
      else if (predBinary === 1 && label === 0) fp++;
      else if (predBinary === 0 && label === 0) tn++;
      else if (predBinary === 0 && label === 1) fn++;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    const auroc = this.calculateAUROC(predictions, labels);
    const brier = brierSum / n;

    return {
      precision,
      recall,
      f1,
      auroc,
      brier,
      tp, fp, tn, fn
    };
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
   * Prepare training data
   */
  prepareTrainingData() {
    try {
      const { features, labels } = this.featureEngineering.generateTrainingFeatures();
      
      if (features.length === 0) {
        logger.warn('model-trainer', 'system', 'no_training_data', 'No training data available');
        return null;
      }

      // Convert to arrays
      const X = features.map(f => {
        const featureArray = [];
        Object.values(f.features).forEach(value => {
          if (typeof value === 'number' && !isNaN(value)) {
            featureArray.push(value);
          } else {
            featureArray.push(0);
          }
        });
        return featureArray;
      });

      const yWinner = labels.winner;
      const yRug = labels.rug;

      // Time-based split (70% train, 30% validation)
      const splitIndex = Math.floor(features.length * 0.7);
      
      const trainData = {
        X: X.slice(0, splitIndex),
        yWinner: yWinner.slice(0, splitIndex),
        yRug: yRug.slice(0, splitIndex)
      };

      const valData = {
        X: X.slice(splitIndex),
        yWinner: yWinner.slice(splitIndex),
        yRug: yRug.slice(splitIndex)
      };

      logger.info('model-trainer', 'system', 'data_prepared', 
        `Training: ${trainData.X.length}, Validation: ${valData.X.length}`);

      return { trainData, valData, featureNames: this.featureEngineering.featureNames };
    } catch (error) {
      logger.error('model-trainer', 'system', 'data_preparation_failed', `Failed to prepare training data: ${error.message}`);
      return null;
    }
  }

  /**
   * Train winner model
   */
  trainWinnerModel(trainData, valData, featureNames) {
    try {
      logger.info('model-trainer', 'system', 'training_winner', 'Training winner model');

      const model = new this.LogisticRegression(0.01, 1000);
      model.fit(trainData.X, trainData.yWinner);

      // Predict on validation set
      const valPredictions = model.predict(valData.X);
      const metrics = this.calculateMetrics(valPredictions, valData.yWinner);

      // Calibrate
      const calibrator = new this.PlattScaling();
      calibrator.fit(valPredictions, valData.yWinner);
      const calibratedPredictions = calibrator.transform(valPredictions);
      const calibratedMetrics = this.calculateMetrics(calibratedPredictions, valData.yWinner);

      const modelId = `win_v1_${new Date().toISOString().split('T')[0]}`;
      
      // Store in registry
      db.prepare(`
        INSERT OR REPLACE INTO model_registry 
        (model_id, target, features, train_window, metrics, calibration, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        modelId,
        '2x_24h',
        JSON.stringify(featureNames),
        `${new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]} to ${new Date().toISOString().split('T')[0]}`,
        JSON.stringify(calibratedMetrics),
        JSON.stringify({ method: 'platt_scaling', A: calibrator.A, B: calibrator.B }),
        new Date().toISOString()
      );

      this.models.winner = { model, calibrator, modelId, metrics: calibratedMetrics };

      logger.info('model-trainer', 'system', 'winner_trained', 
        `Winner model trained: AUROC ${calibratedMetrics.auroc.toFixed(3)}, Brier ${calibratedMetrics.brier.toFixed(3)}`);

      return { model, calibrator, modelId, metrics: calibratedMetrics };
    } catch (error) {
      logger.error('model-trainer', 'system', 'winner_training_failed', `Failed to train winner model: ${error.message}`);
      return null;
    }
  }

  /**
   * Train rug model
   */
  trainRugModel(trainData, valData, featureNames) {
    try {
      logger.info('model-trainer', 'system', 'training_rug', 'Training rug model');

      const model = new this.LogisticRegression(0.01, 1000);
      model.fit(trainData.X, trainData.yRug);

      // Predict on validation set
      const valPredictions = model.predict(valData.X);
      const metrics = this.calculateMetrics(valPredictions, valData.yRug);

      // Calibrate
      const calibrator = new this.PlattScaling();
      calibrator.fit(valPredictions, valData.yRug);
      const calibratedPredictions = calibrator.transform(valPredictions);
      const calibratedMetrics = this.calculateMetrics(calibratedPredictions, valData.yRug);

      const modelId = `rug_v1_${new Date().toISOString().split('T')[0]}`;
      
      // Store in registry
      db.prepare(`
        INSERT OR REPLACE INTO model_registry 
        (model_id, target, features, train_window, metrics, calibration, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        modelId,
        'rug_24h',
        JSON.stringify(featureNames),
        `${new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]} to ${new Date().toISOString().split('T')[0]}`,
        JSON.stringify(calibratedMetrics),
        JSON.stringify({ method: 'platt_scaling', A: calibrator.A, B: calibrator.B }),
        new Date().toISOString()
      );

      this.models.rug = { model, calibrator, modelId, metrics: calibratedMetrics };

      logger.info('model-trainer', 'system', 'rug_trained', 
        `Rug model trained: AUROC ${calibratedMetrics.auroc.toFixed(3)}, Brier ${calibratedMetrics.brier.toFixed(3)}`);

      return { model, calibrator, modelId, metrics: calibratedMetrics };
    } catch (error) {
      logger.error('model-trainer', 'system', 'rug_training_failed', `Failed to train rug model: ${error.message}`);
      return null;
    }
  }

  /**
   * Main training process
   */
  async train() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    logger.info('model-trainer', 'system', 'worker_started', 'Starting model training worker');

    try {
      const data = this.prepareTrainingData();
      if (!data) {
        logger.warn('model-trainer', 'system', 'no_data', 'No training data available');
        return;
      }

      const { trainData, valData, featureNames } = data;

      // Train both models
      const winnerResult = this.trainWinnerModel(trainData, valData, featureNames);
      const rugResult = this.trainRugModel(trainData, valData, featureNames);

      if (winnerResult && rugResult) {
        logger.info('model-trainer', 'system', 'training_completed', 
          'Both models trained successfully');
      } else {
        logger.error('model-trainer', 'system', 'training_failed', 'Model training failed');
      }

    } catch (error) {
      logger.error('model-trainer', 'system', 'training_failed', `Training failed: ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start the worker
   */
  start() {
    logger.info('model-trainer', 'system', 'worker_starting', 'Starting model training worker');
    
    // Run immediately
    this.train();
    
    // Then run weekly
    setInterval(() => {
      this.train();
    }, 7 * 24 * 60 * 60 * 1000);
  }
}

// Run if called directly
if (require.main === module) {
  const worker = new ModelTrainerWorker();
  worker.start();
}

module.exports = ModelTrainerWorker;
