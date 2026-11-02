/**
 * Login attempt limiting, with no database.
 *
 * Failed sign-ins are counted per email and per client IP in fixed windows.
 * When a counter reaches its limit, further attempts are refused (`locked`)
 * until the window ends, even with the right password.
 *
 * The default store keeps counters in memory. On serverless hosting every
 * instance has its own memory, so the limit applies per instance: still a real
 * brake (each guess also costs a full scrypt hash), not a hard global cap.
 * Sites that want a global limit pass a shared store (Redis, Upstash, KV…)
 * implementing `RateLimitStore`.
 */

export type RateLimitCounter = { count: number; resetAt: number };

export interface RateLimitStore {
  get(key: string): Promise<RateLimitCounter | null>;
  /** Add one to the counter, starting a new window of `windowMs` if none is open. */
  increment(key: string, windowMs: number): Promise<RateLimitCounter>;
  reset(key: string): Promise<void>;
}

export type RateLimitOptions = {
  /** Failed attempts allowed per email in one window. Default 5. */
  maxPerEmail?: number;
  /** Failed attempts allowed per client IP in one window. Default 20. */
  maxPerIp?: number;
  /** Window (and lockout) length in seconds. Default 900 (15 minutes). */
  windowSeconds?: number;
  store?: RateLimitStore;
};

export function createMemoryRateLimitStore(now: () => number = Date.now, maxKeys = 10_000): RateLimitStore {
  const counters = new Map<string, RateLimitCounter>();
  function live(key: string): RateLimitCounter | null {
    const c = counters.get(key);
    if (!c) return null;
    if (c.resetAt <= now()) {
      counters.delete(key);
      return null;
    }
    return c;
  }
  function prune(): void {
    if (counters.size < maxKeys) return;
    const t = now();
    for (const [k, c] of counters) if (c.resetAt <= t) counters.delete(k);
    // Still full: drop the oldest entries (Map keeps insertion order).
    for (const k of counters.keys()) {
      if (counters.size < maxKeys) break;
      counters.delete(k);
    }
  }
  return {
    async get(key) {
      return live(key);
    },
    async increment(key, windowMs) {
      const c = live(key);
      if (c) {
        c.count += 1;
        return c;
      }
      prune();
      const fresh = { count: 1, resetAt: now() + windowMs };
      counters.set(key, fresh);
      return fresh;
    },
    async reset(key) {
      counters.delete(key);
    },
  };
}

export type RateLimiter = {
  /** Before checking the password: is this email or IP locked out? */
  check(email: string, ip: string | null): Promise<{ locked: false } | { locked: true; retryAfterSeconds: number }>;
  failure(email: string, ip: string | null): Promise<void>;
  success(email: string): Promise<void>;
};

export function createRateLimiter(opts: RateLimitOptions = {}, now: () => number = Date.now): RateLimiter {
  const maxPerEmail = opts.maxPerEmail ?? 5;
  const maxPerIp = opts.maxPerIp ?? 20;
  const windowMs = (opts.windowSeconds ?? 900) * 1000;
  const store = opts.store ?? createMemoryRateLimitStore(now);
  const emailKey = (e: string) => `email:${e}`;
  const ipKey = (ip: string) => `ip:${ip}`;

  return {
    async check(email, ip) {
      const checks: Array<[string, number]> = [[emailKey(email), maxPerEmail]];
      if (ip) checks.push([ipKey(ip), maxPerIp]);
      for (const [key, max] of checks) {
        const c = await store.get(key);
        if (c && c.count >= max) {
          return { locked: true, retryAfterSeconds: Math.max(1, Math.ceil((c.resetAt - now()) / 1000)) };
        }
      }
      return { locked: false };
    },
    async failure(email, ip) {
      await store.increment(emailKey(email), windowMs);
      if (ip) await store.increment(ipKey(ip), windowMs);
    },
    async success(email) {
      await store.reset(emailKey(email));
    },
  };
}
