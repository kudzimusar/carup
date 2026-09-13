/**
 * The pre-shard capacity guard.
 *
 * The whole reason this exists is that the incident's instance looked healthy by every ordinary
 * measure. So these tests are written against the REAL measurements taken during the incident, not
 * against invented numbers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../../scripts/ci/assert-staging-capacity.mjs');

/** The numbers actually measured on carup-staging during the outage, 2026-09-08. */
const INCIDENT = {
  short: { millions: 1, ms: 379, per_million: 379 },
  long: { millions: 3, ms: 16087, per_million: 5362.33 },
  timezone_ms: null,
  timezone_failed: true,
};

/** A healthy instance: cost per row is constant, and 3M finishes well inside PostgREST's budget. */
const HEALTHY = {
  short: { millions: 1, ms: 120, per_million: 120 },
  long: { millions: 3, ms: 400, per_million: 133.3 },
  timezone_ms: 210,
  timezone_failed: false,
};

test('a healthy instance passes and reports its numbers', async () => {
  const { classify } = await load();
  const m = classify(HEALTHY);
  assert.equal(m.throttle_ratio, 1.11);
  assert.equal(m.timezone_ms, 210);
});

test('the incident is refused, by the RIGHT reason', async () => {
  const { classify } = await load();
  assert.throws(() => classify(INCIDENT), (e) => {
    // PostgREST's inability to start is the most specific fact, and the one that explains the 148
    // failures — so it must be the reason reported, not the generic throttle finding.
    assert.equal(e.reason, 'postgrest-cannot-start');
    assert.equal(e.measurements.throttle_ratio, 14.15);
    return true;
  });
});

test('quota throttling is caught even when pg_timezone_names still squeaks through', async () => {
  const { classify } = await load();
  // Throttling ramps. Refusing only once PostgREST has already died would let a run start on an
  // instance that is certain to fail partway — and a half-run gate is worse than a refused one.
  assert.throws(
    () => classify({ ...INCIDENT, timezone_failed: false, timezone_ms: 7900 }),
    (e) => e.reason === 'cpu-quota-throttled',
  );
});

test('a uniformly slow instance is refused against PostgREST\'s own budget', async () => {
  const { classify, POSTGREST_STATEMENT_TIMEOUT_MS } = await load();
  // Cost per row is CONSTANT here, so the ratio check sees nothing wrong — the instance is just
  // slow. PostgREST still cannot rebuild its cache, so it still must not certify.
  const uniformlySlow = {
    short: { millions: 1, ms: 3400, per_million: 3400 },
    long: { millions: 3, ms: 10200, per_million: 3400 },
    timezone_ms: 500,
    timezone_failed: false,
  };
  assert.equal(uniformlySlow.long.per_million / uniformlySlow.short.per_million, 1);
  assert.throws(() => classify(uniformlySlow), (e) => {
    assert.equal(e.reason, 'below-postgrest-budget');
    assert.ok(uniformlySlow.long.ms > POSTGREST_STATEMENT_TIMEOUT_MS);
    return true;
  });
});

test('the refusal carries the measurements, so the failure names its own cause', async () => {
  const { classify } = await load();
  assert.throws(() => classify(INCIDENT), (e) => {
    for (const key of ['short_ms', 'long_ms', 'throttle_ratio', 'postgrest_budget_ms']) {
      assert.ok(key in e.measurements, `the refusal does not report ${key}`);
    }
    return true;
  });
});

test('the threshold is not so loose that the incident would pass', async () => {
  const { MAX_THROTTLE_RATIO } = await load();
  const incidentRatio = INCIDENT.long.per_million / INCIDENT.short.per_million;
  assert.ok(MAX_THROTTLE_RATIO < incidentRatio,
    `a limit of ${MAX_THROTTLE_RATIO}× would have let a ${incidentRatio.toFixed(1)}× throttled instance certify`);
  // …nor so tight that ordinary measurement noise fails a healthy run.
  assert.ok(MAX_THROTTLE_RATIO > HEALTHY.long.per_million / HEALTHY.short.per_million);
});

test('the guard REFUSES — it never retries or downgrades to a warning', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('scripts/ci/assert-staging-capacity.mjs', 'utf8');
  assert.ok(!/::warning::/.test(src), 'a capacity failure was downgraded to a warning');
  assert.ok(!/for \(let attempt|retr(y|ies)\b.*await/i.test(src.replace(/^\s*\*.*$/gm, '')),
    'the guard retries — a throttled instance would just be measured until it happened to pass');
});

// ── measureCapacity: the half that actually talks to the database ──────────
// classify() alone was fully covered while `measureCapacity` had no test — so changing the long
// probe to the same size as the short one made the ratio permanently 1.0 and the guard blind, with
// every test still green. The tripwire caught that, and these close it.

/** A pg client that records the probes issued and answers with a configurable per-row cost. */
function fakeClient({ msPerMillion = (m) => m * 120, timezone = 210 } = {}) {
  const probes = [];
  return {
    probes,
    async query(sql, params) {
      if (/generate_series/.test(sql)) {
        const millions = Number(params[0]) / 1_000_000;
        probes.push(millions);
        return { rows: [{ n: params[0], ms: msPerMillion(millions) }] };
      }
      if (/pg_timezone_names/.test(sql)) {
        if (timezone === 'timeout') { const e = new Error('canceling statement due to statement timeout'); e.code = '57014'; throw e; }
        return { rows: [{ n: 1200, ms: timezone }] };
      }
      return { rows: [] };
    },
  };
}

test('measureCapacity probes TWO different sizes — otherwise the ratio is meaningless', async () => {
  const { measureCapacity } = await load();
  const client = fakeClient();
  await measureCapacity(client);
  assert.equal(client.probes.length, 2, 'the guard must take a short and a long probe');
  const [short, long] = client.probes;
  assert.ok(long > short, `the long probe (${long}M) must be larger than the short one (${short}M)`);
  assert.ok(long / short >= 3, 'the probes are too close in size to expose quota throttling');
});

test('measureCapacity refuses a throttled instance end to end', async () => {
  const { measureCapacity } = await load();
  // Reproduces the incident's shape: 1M cheap, 3M stalled.
  const client = fakeClient({ msPerMillion: (m) => (m === 1 ? 379 : 16087), timezone: 'timeout' });
  await assert.rejects(measureCapacity(client), (e) => e.reason === 'postgrest-cannot-start');
});

test('measureCapacity passes a healthy instance end to end', async () => {
  const { measureCapacity } = await load();
  const m = await measureCapacity(fakeClient());
  assert.equal(m.throttle_ratio, 1);
  assert.equal(m.timezone_ms, 210);
});

test('measureCapacity restores the statement timeout it set', async () => {
  const { measureCapacity } = await load();
  const seen = [];
  const base = fakeClient();
  const client = { ...base, async query(sql, params) { seen.push(sql); return base.query(sql, params); } };
  await measureCapacity(client);
  assert.ok(seen.some((s) => /set local statement_timeout = 8000/.test(s)), 'the PostgREST budget was never applied');
  assert.ok(seen.some((s) => /set local statement_timeout = default/.test(s)), 'the timeout was left changed');
});
