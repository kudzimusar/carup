/**
 * Pluggable rate-limit store interface.
 *
 * The rate limiter (see securityMiddleware.js) depends only on the small
 * `hit(key, windowMs)` contract below so the underlying counter can live in a
 * single process (default) or in a shared Redis instance for horizontal /
 * distributed deployments.
 *
 * Store contract:
 *   async hit(key, windowMs) -> { count, windowStart }
 *     Atomically increments the request counter for `key`, rolling the window
 *     over when `Date.now() - windowStart > windowMs`. Returns the post-increment
 *     count and the active window start.
 *   async reset(key)         -> void   (drops a key; primarily for tests/ops)
 *   async clear()            -> void   (drops all keys; primarily for tests)
 *
 * DISTRIBUTED MODE:
 *   Set process.env.REDIS_URL to activate a Redis-backed store. To avoid a hard
 *   dependency that breaks installs when redis is absent, the redis client is
 *   *injected* rather than required: pass a client to createRateLimitStore({ redisClient }),
 *   or set a global injector via setRedisClientFactory(). If REDIS_URL is set but
 *   no client can be resolved, the store falls back to the in-memory store and
 *   logs a single warning, preserving existing behavior.
 */

/**
 * In-memory store (default). Window counting + limit data identical to the
 * historical Map-based implementation in securityMiddleware.js.
 */
export class InMemoryRateLimitStore {
  constructor() {
    this.map = new Map();
    this.kind = 'memory';
  }

  async hit(key, windowMs) {
    const now = Date.now();
    let rateData = this.map.get(key);
    if (!rateData || now - rateData.windowStart > windowMs) {
      rateData = { count: 1, windowStart: now };
      this.map.set(key, rateData);
    } else {
      rateData.count++;
    }
    return { count: rateData.count, windowStart: rateData.windowStart };
  }

  async reset(key) {
    this.map.delete(key);
  }

  async clear() {
    this.map.clear();
  }

  /**
   * Evict keys whose window opened more than `maxAgeMs` ago. Used by the
   * periodic memory-leak sweeper. Synchronous on purpose (no I/O).
   */
  sweep(maxAgeMs) {
    const now = Date.now();
    for (const [key, data] of this.map.entries()) {
      if (now - data.windowStart > maxAgeMs) this.map.delete(key);
    }
  }
}

/**
 * Redis-backed store for distributed rate limiting.
 *
 * Uses a fixed-window counter: an INCR keyed by the limiter+client, with a TTL
 * (PEXPIRE) set to the window length on first hit. `windowStart` is tracked in a
 * companion key so behavior matches the in-memory semantics. The injected client
 * only needs a minimal command surface (incr, pexpire, pttl, set, get, del, flushdb-like).
 *
 * Any I/O error is non-fatal: the limiter treats a thrown store error as "allow"
 * upstream is the caller's choice; here we surface the error so the caller can
 * decide. securityMiddleware wraps this and fails open on store errors.
 */
export class RedisRateLimitStore {
  constructor(redisClient, { keyPrefix = 'rl:' } = {}) {
    if (!redisClient) throw new Error('RedisRateLimitStore requires a redis client');
    this.client = redisClient;
    this.keyPrefix = keyPrefix;
    this.kind = 'redis';
  }

  _k(key) {
    return `${this.keyPrefix}${key}`;
  }

  async hit(key, windowMs) {
    const countKey = this._k(`${key}:count`);
    const startKey = this._k(`${key}:start`);
    const now = Date.now();

    const count = await this.client.incr(countKey);
    if (count === 1) {
      // First hit in a fresh window — stamp the window start and TTL.
      await this.client.set(startKey, String(now));
      if (typeof this.client.pexpire === 'function') {
        await this.client.pexpire(countKey, windowMs);
        await this.client.pexpire(startKey, windowMs);
      }
      return { count, windowStart: now };
    }
    const rawStart = await this.client.get(startKey);
    const windowStart = rawStart ? parseInt(rawStart, 10) : now;
    return { count, windowStart };
  }

  async reset(key) {
    await this.client.del(this._k(`${key}:count`));
    await this.client.del(this._k(`${key}:start`));
  }

  async clear() {
    if (typeof this.client.flushdb === 'function') {
      await this.client.flushdb();
    }
  }
}

let _redisClientFactory = null;

/**
 * Optionally inject a factory that returns (or resolves to) a connected redis
 * client. Call this during app bootstrap if you want distributed rate limiting
 * without modifying securityMiddleware. The factory receives REDIS_URL.
 */
export function setRedisClientFactory(factory) {
  _redisClientFactory = typeof factory === 'function' ? factory : null;
}

/**
 * Resolve the store to use.
 *
 * @param {object} [opts]
 * @param {object} [opts.redisClient] - pre-connected redis client to use directly.
 * @param {string} [opts.redisUrl]    - overrides process.env.REDIS_URL.
 * @param {function} [opts.warn]      - logger for the fallback warning.
 * @returns {InMemoryRateLimitStore|RedisRateLimitStore}
 */
export function createRateLimitStore(opts = {}) {
  const redisUrl = opts.redisUrl ?? process.env.REDIS_URL;
  const warn = opts.warn || ((m) => console.warn(m));

  // No distributed mode requested -> preserve exact historical behavior.
  if (!redisUrl) {
    return new InMemoryRateLimitStore();
  }

  // Distributed mode requested. Resolve an injected client (never a hard require).
  let client = opts.redisClient || null;
  if (!client && _redisClientFactory) {
    try {
      client = _redisClientFactory(redisUrl);
    } catch (err) {
      warn(`⚠️ [Security] Redis client factory threw; falling back to in-memory rate limiting: ${err.message}`);
      client = null;
    }
  }

  if (!client) {
    warn('⚠️ [Security] REDIS_URL is set but no redis client was injected (createRateLimitStore/setRedisClientFactory). Falling back to in-memory rate limiting.');
    return new InMemoryRateLimitStore();
  }

  try {
    return new RedisRateLimitStore(client);
  } catch (err) {
    warn(`⚠️ [Security] Failed to construct Redis rate-limit store; falling back to in-memory: ${err.message}`);
    return new InMemoryRateLimitStore();
  }
}
