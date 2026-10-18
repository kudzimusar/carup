/**
 * CA-OWNER-02-R3 (D3) — a slow source, read at most once per `ttlMs` and waited for at most `budgetMs` per request.
 *
 * Used for get_communication_scheduler_health(), whose database implementation scans the full cron run history (about
 * 179,000 rows on staging) three times. That function cannot be changed in this lane (no migration, no index, no retention
 * change), so the application bounds how often it runs and how long a page waits for it:
 *
 *   · a value younger than `ttlMs` is served from the cache, with the time it was really read;
 *   · otherwise one read is started (never two at once) and waited for up to `budgetMs`;
 *   · a read slower than the budget keeps running in the background and fills the cache when it completes;
 *   · while it runs, the last value is served — with its own old read time — only while younger than `maxAgeMs`;
 *   · with no value young enough, the caller gets BoundedSourcePending: the figure says it is still being read. Nothing is
 *     ever invented, and a failed read is never cached as a value.
 */
export class BoundedSourcePending extends Error {
  constructor(message = 'The source read is still running.') {
    super(message);
    this.name = 'BoundedSourcePending';
  }
}

// Deliberately NOT unref'd: the wait is short (the budget), and an unref'd timer would let the process consider itself idle.
const settle = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const PENDING = Symbol('pending');

export function createBoundedSource(read, { ttlMs, budgetMs, maxAgeMs = ttlMs * 6, now = () => Date.now() } = {}) {
  let last = null; // { value, readAt: Date }
  let inflight = null; // Promise<{ value, readAt }>

  const start = () => {
    if (inflight) return inflight;
    const run = Promise.resolve()
      .then(read)
      .then((value) => { last = { value, readAt: new Date(now()) }; return last; });
    inflight = run;
    // The read may outlive every caller; settle the in-flight slot and never leave an unhandled rejection behind.
    run.then(() => { if (inflight === run) inflight = null; }, () => { if (inflight === run) inflight = null; });
    return run;
  };

  async function get() {
    const t = now();
    if (last && t - last.readAt.getTime() < ttlMs) return { ...last, cached: true, refreshing: false };
    const run = start();
    const outcome = await Promise.race([run.then((v) => v, (err) => ({ error: err })), settle(budgetMs).then(() => PENDING)]);
    if (outcome === PENDING) {
      if (last && t - last.readAt.getTime() < maxAgeMs) return { ...last, cached: true, refreshing: true };
      throw new BoundedSourcePending();
    }
    if (outcome?.error) throw outcome.error;
    return { ...outcome, cached: false, refreshing: false };
  }

  return {
    get,
    /** Test seam: forget the cached value and any read in flight. */
    reset() { last = null; inflight = null; },
  };
}
