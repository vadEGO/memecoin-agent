// workers/edges-ingest-worker.js - Task 12 Edges & Events Ingestion
require('dotenv').config();
const Database = require('better-sqlite3');
const { fetchJson, sleep } = require('../lib/http');
const logger = require('../lib/logger');

const db = new Database('db/agent.db');
db.pragma('journal_mode = WAL');

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

class EdgesIngestWorker {
  constructor() {
    this.isRunning = false;
    this.processedTransactions = new Set();
  }

  /**
   * Get recent tokens that need edge analysis
   */
  getTokensForEdgeAnalysis() {
    try {
      const tokens = db.prepare(`
        SELECT mint, symbol, first_seen_at, launch_tx
        FROM tokens
        WHERE first_seen_at IS NOT NULL
          AND datetime(first_seen_at) > datetime('now', '-7 days')
        ORDER BY datetime(first_seen_at) DESC
        LIMIT 20
      `).all();

      return tokens;
    } catch (error) {
      logger.error('edges-ingest', 'system', 'get_tokens_failed', `Failed to get tokens: ${error.message}`);
      return [];
    }
  }

  /**
   * Get holders for a token to analyze their funding patterns
   */
  getTokenHolders(mint) {
    try {
      const holders = db.prepare(`
        SELECT owner, amount, first_seen_at, is_sniper, is_bundler, is_insider
        FROM holders
        WHERE mint = ?
        ORDER BY CAST(amount AS REAL) DESC
        LIMIT 100
      `).all(mint);

      return holders;
    } catch (error) {
      logger.error('edges-ingest', 'system', 'get_holders_failed', `Failed to get holders for ${mint}: ${error.message}`);
      return [];
    }
  }

  /**
   * Fetch transaction history for a wallet
   */
  async fetchWalletTransactions(wallet, limit = 100) {
    try {
      const response = await fetchJson(`https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${HELIUS_API_KEY}&limit=${limit}`);
      
      if (!response || !Array.isArray(response)) {
        return [];
      }

      return response;
    } catch (error) {
      logger.error('edges-ingest', 'system', 'fetch_transactions_failed', `Failed to fetch transactions for ${wallet}: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse transaction for funding edges (direct SOL sends)
   */
  parseFundingEdges(transaction, wallet) {
    const edges = [];
    
    try {
      if (!transaction.transaction || !transaction.transaction.message) {
        return edges;
      }

      const { message } = transaction.transaction;
      const { instructions } = message;
      const { preBalances, postBalances } = transaction.meta;

      // Check for SOL transfers
      for (let i = 0; i < instructions.length; i++) {
        const instruction = instructions[i];
        
        // Look for System Program transfer instructions
        if (instruction.programId === '11111111111111111111111111111111') {
          const programIdIndex = instruction.programIdIndex;
          const accountKeys = message.accountKeys;
          
          // Find the program account in accountKeys
          const programAccount = accountKeys.find(account => 
            account.pubkey === '11111111111111111111111111111111'
          );
          
          if (programAccount) {
            const programIndex = accountKeys.indexOf(programAccount);
            
            if (instruction.accounts && instruction.accounts.length >= 2) {
              const fromIndex = instruction.accounts[0];
              const toIndex = instruction.accounts[1];
              
              if (fromIndex < accountKeys.length && toIndex < accountKeys.length) {
                const fromWallet = accountKeys[fromIndex].pubkey;
                const toWallet = accountKeys[toIndex].pubkey;
                
                // Calculate SOL amount transferred
                const fromPreBalance = preBalances[fromIndex] || 0;
                const fromPostBalance = postBalances[fromIndex] || 0;
                const amountLamports = fromPreBalance - fromPostBalance;
                
                if (amountLamports > 0 && fromWallet === wallet) {
                  edges.push({
                    src: fromWallet,
                    dst: toWallet,
                    ts: new Date(transaction.blockTime * 1000).toISOString(),
                    amount_lamports: amountLamports,
                    signature: transaction.transaction.signatures[0]
                  });
                }
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error('edges-ingest', 'system', 'parse_funding_edges_failed', `Failed to parse funding edges: ${error.message}`);
    }

    return edges;
  }

  /**
   * Parse transaction for buy events
   */
  parseBuyEvents(transaction, wallet, mint) {
    const events = [];
    
    try {
      if (!transaction.transaction || !transaction.transaction.message) {
        return events;
      }

      const { message } = transaction.transaction;
      const { instructions } = message;

      // Check for token swap instructions (Raydium, Jupiter, etc.)
      for (const instruction of instructions) {
        // Raydium AMM program
        if (instruction.programId === '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8') {
          // This is a Raydium swap - check if it involves our token
          const accountKeys = message.accountKeys;
          
          // Look for token mint in account keys
          const hasTokenMint = accountKeys.some(account => account.pubkey === mint);
          
          if (hasTokenMint) {
            events.push({
              wallet,
              mint,
              ts: new Date(transaction.blockTime * 1000).toISOString(),
              method: 'raydium_swap',
              is_sniper: this.isSniperTransaction(transaction, mint),
              signature: transaction.transaction.signatures[0]
            });
          }
        }
        
        // Jupiter program
        if (instruction.programId === 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB') {
          const accountKeys = message.accountKeys;
          const hasTokenMint = accountKeys.some(account => account.pubkey === mint);
          
          if (hasTokenMint) {
            events.push({
              wallet,
              mint,
              ts: new Date(transaction.blockTime * 1000).toISOString(),
              method: 'jupiter_swap',
              is_sniper: this.isSniperTransaction(transaction, mint),
              signature: transaction.transaction.signatures[0]
            });
          }
        }
      }
    } catch (error) {
      logger.error('edges-ingest', 'system', 'parse_buy_events_failed', `Failed to parse buy events: ${error.message}`);
    }

    return events;
  }

  /**
   * Check if transaction is a sniper transaction (first N blocks post-pool)
   */
  isSniperTransaction(transaction, mint) {
    try {
      // Get token creation time
      const tokenInfo = db.prepare(`
        SELECT first_seen_at FROM tokens WHERE mint = ?
      `).get(mint);

      if (!tokenInfo || !tokenInfo.first_seen_at) {
        return false;
      }

      const tokenCreatedAt = new Date(tokenInfo.first_seen_at);
      const transactionTime = new Date(transaction.blockTime * 1000);
      
      // Check if transaction is within first 10 blocks (approximately 1 minute)
      const timeDiff = transactionTime.getTime() - tokenCreatedAt.getTime();
      return timeDiff <= 60000; // 1 minute in milliseconds
    } catch (error) {
      logger.error('edges-ingest', 'system', 'sniper_check_failed', `Failed to check sniper status: ${error.message}`);
      return false;
    }
  }

  /**
   * Insert funding edges into database
   */
  insertFundingEdges(edges) {
    try {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO funding_edges (src, dst, ts, amount_lamports, signature)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const edge of edges) {
        stmt.run(edge.src, edge.dst, edge.ts, edge.amount_lamports, edge.signature);
      }

      logger.info('edges-ingest', 'system', 'funding_edges_inserted', `Inserted ${edges.length} funding edges`);
    } catch (error) {
      logger.error('edges-ingest', 'system', 'funding_edges_insert_failed', `Failed to insert funding edges: ${error.message}`);
    }
  }

  /**
   * Insert buy events into database
   */
  insertBuyEvents(events) {
    try {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO buy_events (wallet, mint, ts, method, is_sniper, signature)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const event of events) {
        stmt.run(event.wallet, event.mint, event.ts, event.method, event.is_sniper ? 1 : 0, event.signature);
      }

      logger.info('edges-ingest', 'system', 'buy_events_inserted', `Inserted ${events.length} buy events`);
    } catch (error) {
      logger.error('edges-ingest', 'system', 'buy_events_insert_failed', `Failed to insert buy events: ${error.message}`);
    }
  }

  /**
   * Process a single token for edge analysis
   */
  async processToken(mint) {
    try {
      logger.info('edges-ingest', mint, 'processing_started', 'Starting edge analysis');

      const holders = this.getTokenHolders(mint);
      let totalEdges = 0;
      let totalEvents = 0;

      for (const holder of holders) {
        const { owner } = holder;
        
        // Skip if we've already processed this wallet recently
        if (this.processedTransactions.has(owner)) {
          continue;
        }

        try {
          // Fetch recent transactions for this wallet
          const transactions = await this.fetchWalletTransactions(owner, 50);
          
          for (const transaction of transactions) {
            // Parse funding edges
            const edges = this.parseFundingEdges(transaction, owner);
            if (edges.length > 0) {
              this.insertFundingEdges(edges);
              totalEdges += edges.length;
            }

            // Parse buy events
            const events = this.parseBuyEvents(transaction, owner, mint);
            if (events.length > 0) {
              this.insertBuyEvents(events);
              totalEvents += events.length;
            }
          }

          this.processedTransactions.add(owner);
          
          // Rate limiting
          await sleep(100);
        } catch (error) {
          logger.error('edges-ingest', mint, 'holder_processing_failed', `Failed to process holder ${owner}: ${error.message}`);
        }
      }

      logger.info('edges-ingest', mint, 'processing_completed', `Processed ${holders.length} holders, found ${totalEdges} edges, ${totalEvents} events`);
    } catch (error) {
      logger.error('edges-ingest', mint, 'processing_failed', `Failed to process token: ${error.message}`);
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
    logger.info('edges-ingest', 'system', 'worker_started', 'Starting edges ingest worker');

    try {
      const tokens = this.getTokensForEdgeAnalysis();
      logger.info('edges-ingest', 'system', 'tokens_found', `Found ${tokens.length} tokens to process`);

      for (const token of tokens) {
        await this.processToken(token.mint);
        await sleep(1000); // Rate limiting between tokens
      }

      // Clean up old processed transactions (keep last 1000)
      if (this.processedTransactions.size > 1000) {
        const toDelete = Array.from(this.processedTransactions).slice(0, this.processedTransactions.size - 1000);
        toDelete.forEach(wallet => this.processedTransactions.delete(wallet));
      }

    } catch (error) {
      logger.error('edges-ingest', 'system', 'processing_failed', `Worker failed: ${error.message}`);
    } finally {
      this.isRunning = false;
      logger.info('edges-ingest', 'system', 'worker_completed', 'Edges ingest worker completed');
    }
  }

  /**
   * Start the worker
   */
  start() {
    logger.info('edges-ingest', 'system', 'worker_starting', 'Starting edges ingest worker');
    
    // Run immediately
    this.process();
    
    // Then run every 30 minutes
    setInterval(() => {
      this.process();
    }, 30 * 60 * 1000);
  }
}

// Run if called directly
if (require.main === module) {
  const worker = new EdgesIngestWorker();
  worker.start();
}

module.exports = EdgesIngestWorker;
