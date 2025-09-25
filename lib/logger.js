// lib/logger.js - Structured JSON logging for enrichment system
const fs = require('fs');
const path = require('path');

class Logger {
  constructor(logFile = 'logs/enrichment.log') {
    this.logFile = logFile;
    this.ensureLogDir();
  }

  ensureLogDir() {
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  log(level, source, mint, type, message, data = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      source,
      mint: mint ? mint.slice(0, 8) + '...' : null, // Truncate for readability
      type,
      message,
      ...data
    };

    // Console output with emoji
    const emoji = {
      'info': 'ℹ️',
      'success': '✅',
      'warning': '⚠️',
      'error': '❌',
      'debug': '🔍'
    }[level] || '📝';

    console.log(`${emoji} [${level.toUpperCase()}] ${source}:${type} ${message}`, data.mint ? `(${data.mint})` : '');

    // JSON log file
    try {
      fs.appendFileSync(this.logFile, JSON.stringify(logEntry) + '\n');
    } catch (err) {
      console.error('Failed to write to log file:', err.message);
    }
  }

  info(source, mint, type, message, data = {}) {
    this.log('info', source, mint, type, message, data);
  }

  success(source, mint, type, message, data = {}) {
    this.log('success', source, mint, type, message, data);
  }

  warning(source, mint, type, message, data = {}) {
    this.log('warning', source, mint, type, message, data);
  }

  error(source, mint, type, message, data = {}) {
    this.log('error', source, mint, type, message, data);
  }

  debug(source, mint, type, message, data = {}) {
    this.log('debug', source, mint, type, message, data);
  }
}

module.exports = new Logger();
