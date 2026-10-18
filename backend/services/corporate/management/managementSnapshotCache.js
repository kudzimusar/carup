/**
 * CA-OWNER-02-R3 (D3) — the shared Corporate management snapshot, stale-while-revalidate.
 *
 *   fresh   (younger than ttlMs)                 served at once
 *   stale   (between ttlMs and maxStaleMs)       the LAST VALID snapshot is served at once while ONE background refresh runs
 *                                                (handed to `keepAlive` so the runtime keeps it alive past the response)
 *   too old (maxStaleMs or more), or none yet   the request waits for a new read; concurrent requests share it
 *
 * Every answer carries `meta` — generatedAt, ageMs, stale, refreshing — so a page can say how old its figures are and that a
 * refresh is running: a stale snapshot is never presented as a fresh one. A failed refresh keeps the last valid snapshot
 * (still marked stale) and the next request tries again; a snapshot computed for one host is never served for another.
 */
export function createSnapshotCache({ compute, ttlMs = 60_000, maxStaleMs = 600_000, now = () => Date.now(), keepAlive = () => {} } = {}) {
  let entry = null; // { key, value, at }
  let cold = null; // { key, promise }
  let refresh = null; // { key, promise }

  const generatedAtOf = (value, at) => (value?.now instanceof Date ? value.now : new Date(at));
  // Started synchronously (a throw becomes a rejection), so concurrent callers can never start a second computation.
  const run = (key) => { try { return Promise.resolve(compute(key)); } catch (err) { return Promise.reject(err); } };
  const answer = (e, { stale, refreshing }) => ({
    value: e.value,
    meta: { generatedAt: generatedAtOf(e.value, e.at), ageMs: Math.max(0, now() - e.at), stale, refreshing },
  });

  function startRefresh(key) {
    if (refresh && refresh.key === key) return;
    const startedAt = now();
    const promise = run(key).then((value) => { entry = { key, value, at: startedAt }; });
    const slot = { key, promise };
    refresh = slot;
    promise.then(() => { if (refresh === slot) refresh = null; }, () => { if (refresh === slot) refresh = null; });
    keepAlive(promise.catch(() => {}));
  }

  async function get(key) {
    const t = now();
    if (entry && entry.key === key) {
      const age = t - entry.at;
      if (age < ttlMs) return answer(entry, { stale: false, refreshing: Boolean(refresh && refresh.key === key) });
      if (age < maxStaleMs) {
        startRefresh(key);
        return answer(entry, { stale: true, refreshing: true });
      }
    }
    if (!cold || cold.key !== key) {
      const startedAt = t;
      const promise = run(key).then((value) => { entry = { key, value, at: startedAt }; return entry; });
      const slot = { key, promise };
      cold = slot;
      promise.then(() => { if (cold === slot) cold = null; }, () => { if (cold === slot) cold = null; });
    }
    const e = await cold.promise;
    return answer(e, { stale: false, refreshing: false });
  }

  return {
    get,
    /** Test seam: forget every snapshot and computation (each test world must not see a previous world's figures). */
    reset() { entry = null; cold = null; refresh = null; },
  };
}

/**
 * The runtime's way to keep a promise alive after the response is sent: Vercel's request context exposes `waitUntil`
 * (the mechanism @vercel/functions wraps). Outside Vercel — local runs and tests — Node keeps running pending work anyway.
 */
export function runtimeKeepAlive(promise) {
  try {
    const context = globalThis[Symbol.for('@vercel/request-context')]?.get?.();
    context?.waitUntil?.(promise);
  } catch { /* no request context: nothing to extend */ }
}
