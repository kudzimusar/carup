/**
 * CA-OWNER-02-R3 (D3) — a slow source, read at most once per `ttlMs` and waited for at most `budgetMs` per request.
 *
 * Used for get_communication_scheduler_health(), whose database implementation scans the full cron run history (about
 * 179,000 rows on staging) three times. That function cannot be changed in this lane (no migration, no index, no retention
 * change), so the application bounds how often it runs and how long a page waits for it:
 *
 *   · a value younger than `ttlMs` is served from the cache, with the time it was really read;
 *   · otherwise one read is started (never two at once) and waited for up to `budgetMs`;
 *   · a read slower than the budget keeps running in the background and fills the cache when it completes — every read
 *     started is handed to `keepAlive` (Vercel's waitUntil) so the runtime does not freeze it once the response is sent;
 *   · while it runs, the last value is served — with its own old read time — only while younger than `maxAgeMs`;
 *   · with no value young enough, the caller gets BoundedSourcePending: the figure says it is still being read. Nothing is
 *     ever invented, and a failed read is never cached as a value;
 *   · with `failureTtlMs`, a failed read is REMEMBERED (when, and the error) for that long: no new read is started inside it,
 *     the caller is told the read failed (BoundedSourceFailed) — or is served the last value young enough, with the failure
 *     alongside — and every later answer carries the last failure until a read succeeds. A source that keeps failing (on
 *     staging every scheduler-health read is cancelled at the database's statement timeout) is therefore reported as
 *     failing, never as "still running", and is not re-run on every request.
 */
export class BoundedSourcePending extends Error {
  constructor(message = 'The source read is still running.', { lastFailure = null } = {}) {
    super(message);
    this.name = 'BoundedSourcePending';
    /** The last failed read ({ at: Date, error }), if any — a read is running now, but the previous one did not complete. */
    this.lastFailure = lastFailure;
  }
}

export class BoundedSourceFailed extends Error {
  constructor(failure) {
    super('The last source read failed.');
    this.name = 'BoundedSourceFailed';
    /** { at: Date, error } — when the read failed, and why. */
    this.failure = failure;
  }
}

// Deliberately NOT unref'd: the wait is short (the budget), and an unref'd timer would let the process consider itself idle.
const settle = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const PENDING = Symbol('pending');

export function createBoundedSource(read, { ttlMs, budgetMs, maxAgeMs = ttlMs * 6, failureTtlMs = 0, now = () => Date.now(), keepAlive = () => {} } = {}) {
  let last = null; // { value, readAt: Date }
  let failure = null; // { at: Date, error } — the last failed read, until a read succeeds
  let inflight = null; // Promise<{ value, readAt }>

  const start = () => {
    if (inflight) return inflight;
    const run = Promise.resolve()
      .then(read)
      .then((value) => { last = { value, readAt: new Date(now()) }; failure = null; return last; });
    inflight = run;
    // The read may outlive every caller; settle the in-flight slot, remember a failure, and never leave an unhandled
    // rejection behind. The runtime is asked to keep that settling alive, so a read slower than the budget can still
    // complete — or be recorded as failed — after the response.
    keepAlive(run.then(
      () => { if (inflight === run) inflight = null; },
      (error) => { failure = { at: new Date(now()), error }; if (inflight === run) inflight = null; },
    ));
    return run;
  };

  async function get() {
    const t = now();
    if (last && t - last.readAt.getTime() < ttlMs) return { ...last, cached: true, refreshing: false, lastFailure: null };
    const usable = last && t - last.readAt.getTime() < maxAgeMs ? last : null;
    if (!inflight && failure && t - failure.at.getTime() < failureTtlMs) {
      // A read failed recently: the slow source is not run again before the failure TTL. Serve what is still young enough,
      // with the failure alongside; otherwise say plainly that the read failed.
      if (usable) return { ...usable, cached: true, refreshing: false, lastFailure: failure };
      throw new BoundedSourceFailed(failure);
    }
    const run = start();
    const outcome = await Promise.race([run.then((v) => v, (err) => ({ error: err })), settle(budgetMs).then(() => PENDING)]);
    if (outcome === PENDING) {
      if (usable) return { ...usable, cached: true, refreshing: true, lastFailure: failure };
      throw new BoundedSourcePending(undefined, { lastFailure: failure });
    }
    if (outcome?.error) throw outcome.error;
    return { ...outcome, cached: false, refreshing: false, lastFailure: null };
  }

  return {
    get,
    /** Test seam: forget the cached value, any remembered failure and any read in flight. */
    reset() { last = null; failure = null; inflight = null; },
  };
}
