// lib/http.js - HTTP client with retry logic and rate limiting

class RateLimiter {
  constructor(requestsPerSecond = 4, burstSize = 10) {
    this.requestsPerSecond = requestsPerSecond;
    this.burstSize = burstSize;
    this.tokens = burstSize;
    this.lastRefill = Date.now();
  }

  async acquire() {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.burstSize, this.tokens + timePassed * this.requestsPerSecond);
    this.lastRefill = now;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    const waitTime = (1 - this.tokens) / this.requestsPerSecond * 1000;
    await new Promise(resolve => setTimeout(resolve, waitTime));
    this.tokens = 0;
  }
}

const limiters = {
  dexscreener: new RateLimiter(4, 10), // 4 req/s, burst 10
  helius: new RateLimiter(10, 20),     // 10 req/s, burst 20
  rpc: new RateLimiter(5, 15)          // 5 req/s, burst 15
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}, retryConfig = {}) {
  const {
    retries = 3,
    backoffMs = 1000,
    timeoutMs = 8000,
    rateLimiter = 'default'
  } = retryConfig;

  const limiter = limiters[rateLimiter] || limiters.helius;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await limiter.acquire();
      
      const { default: fetch } = await import('node-fetch');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : backoffMs * Math.pow(2, attempt);
        console.log(`⏳ Rate limited, waiting ${waitTime}ms (attempt ${attempt + 1}/${retries + 1})`);
        await sleep(waitTime);
        continue;
      }

      // Handle server errors
      if (response.status >= 500) {
        if (attempt === retries) {
          throw new Error(`HTTP_${response.status}`);
        }
        const waitTime = backoffMs * Math.pow(2, attempt);
        console.log(`⚠️  Server error ${response.status}, retrying in ${waitTime}ms`);
        await sleep(waitTime);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP_${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('TIMEOUT');
      }
      
      if (attempt === retries) {
        throw error;
      }
      
      const waitTime = backoffMs * Math.pow(2, attempt);
      console.log(`⚠️  Request failed: ${error.message}, retrying in ${waitTime}ms`);
      await sleep(waitTime);
    }
  }
}

module.exports = { fetchJson, sleep };
