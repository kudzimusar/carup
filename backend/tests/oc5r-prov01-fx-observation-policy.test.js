/**
 * OC-5R-PROV-01 C1 — the ECB reference-FX refresh, cache and observation policy.
 *
 *   · every source request is bounded by a timeout;
 *   · the source is OBSERVED once per provider TTL (success) or failure TTL (outage), not per read;
 *   · a snapshot is written only when the source publishes a NEWER rate date than the stored one;
 *   · AVAILABLE vs STALE is decided at read time from the rate's own date;
 *   · nothing is ever fabricated — an unreachable or unpublished pair has no number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const fx = await import('../services/diaspora/tradeFxRateService.js');

const feedXml = (date, jpy = '181.59') => `<?xml version="1.0"?><gesmes:Envelope><Cube><Cube time='${date}'>
  <Cube currency='USD' rate='1.1622'/><Cube currency='JPY' rate='${jpy}'/><Cube currency='ZAR' rate='18.5571'/>
</Cube></Cube></gesmes:Envelope>`;

function countingFetch(xmlFor) {
  const calls = { n: 0 };
  const impl = async () => { calls.n += 1; return { ok: true, text: async () => xmlFor(calls.n) }; };
  return { calls, impl };
}

/** A mock client that also counts snapshot INSERT attempts. */
function snapshotsClient(seed = []) {
  const c = createMockSupabase({ diaspora_fx_rate_snapshots: seed });
  const inserts = { n: 0 };
  const from = c.from.bind(c);
  c.from = (table) => {
    const q = from(table);
    if (table !== 'diaspora_fx_rate_snapshots') return q;
    const insert = q.insert.bind(q);
    q.insert = (row) => { inserts.n += 1; return insert(row); };
    return q;
  };
  return { c, inserts };
}

test('C1: a hung source is cut off by the timeout and degrades to UNAVAILABLE', async () => {
  const hung = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const provider = fx.createEcbFxProvider({ fetchImpl: hung, timeoutMs: 40 });
  const started = Date.now();
  assert.equal(await provider.fetchDaily(), null);
  assert.ok(Date.now() - started < 2000, 'the read must not wait on the source indefinitely');
  const { c } = snapshotsClient();
  const rate = await fx.getReferenceRate('JPY', 'USD', { supabaseClient: c, provider: fx.createEcbFxProvider({ fetchImpl: hung, timeoutMs: 40 }), today: '2026-09-04' });
  assert.equal(rate.status, 'UNAVAILABLE');
  assert.equal(rate.rate, undefined);
});

test('C1: one observation serves every read — twenty components, three pairs, one source request', async () => {
  const { calls, impl } = countingFetch(() => feedXml('2026-09-04'));
  const provider = fx.createEcbFxProvider({ fetchImpl: impl });
  const { c } = snapshotsClient();
  for (let i = 0; i < 20; i += 1) {
    const [base] = [['JPY'], ['ZAR'], ['ZWG']][i % 3];
    await fx.toReferenceUsd(1000 + i, base, { supabaseClient: c, provider, today: '2026-09-04' });
  }
  assert.equal(calls.n, 1);
});

test('C1: an outage is remembered for the failure TTL, then re-probed', async () => {
  let now = 1_000_000;
  const calls = { n: 0 };
  const provider = fx.createEcbFxProvider({
    fetchImpl: async () => { calls.n += 1; throw new Error('network down'); },
    clock: () => now,
  });
  const { c } = snapshotsClient();
  for (let i = 0; i < 5; i += 1) {
    const r = await fx.getReferenceRate('JPY', 'USD', { supabaseClient: c, provider, today: '2026-09-04' });
    assert.equal(r.status, 'UNAVAILABLE');
  }
  assert.equal(calls.n, 1, 'an outage is not re-probed on every read');
  now += fx.ECB_FAILURE_TTL_MS + 1;
  await fx.getReferenceRate('JPY', 'USD', { supabaseClient: c, provider, today: '2026-09-04' });
  assert.equal(calls.n, 2, 'after the failure TTL the source is observed again');
});

test('C1: a successful observation is reused for the feed TTL, then refreshed', async () => {
  let now = 5_000_000;
  const { calls, impl } = countingFetch(() => feedXml('2026-09-04'));
  const provider = fx.createEcbFxProvider({ fetchImpl: impl, clock: () => now });
  await provider.fetchDaily();
  await provider.fetchDaily();
  assert.equal(calls.n, 1);
  now += fx.ECB_FEED_TTL_MS + 1;
  await provider.fetchDaily();
  assert.equal(calls.n, 2);
});

test('C1: a read writes a snapshot only when the source has published something newer', async () => {
  const { impl } = countingFetch(() => feedXml('2026-09-04'));
  const { c, inserts } = snapshotsClient();
  const opts = (today, fetchImpl = impl) => ({ supabaseClient: c, provider: fx.createEcbFxProvider({ fetchImpl }), today });
  const first = await fx.getReferenceRate('JPY', 'USD', opts('2026-09-04'));
  assert.equal(inserts.n, 1, 'the first observation of a publication is recorded');
  // Later days, the source still publishing the same date: nothing is written.
  for (const today of ['2026-09-05', '2026-09-06', '2026-09-07']) {
    const r = await fx.getReferenceRate('JPY', 'USD', opts(today));
    assert.equal(r.snapshot_id, first.snapshot_id);
  }
  assert.equal(inserts.n, 1, 'reads of an unchanged publication write nothing');
  // A newer publication is a new snapshot.
  const newer = countingFetch(() => feedXml('2026-09-08', '150.00'));
  const moved = await fx.getReferenceRate('JPY', 'USD', opts('2026-09-08', newer.impl));
  assert.notEqual(moved.snapshot_id, first.snapshot_id);
  assert.equal(inserts.n, 2);
});

test('C1: an unpublished currency writes nothing and is never approximated', async () => {
  const { calls, impl } = countingFetch(() => feedXml('2026-09-04'));
  const provider = fx.createEcbFxProvider({ fetchImpl: impl });
  const { c, inserts } = snapshotsClient();
  for (let i = 0; i < 5; i += 1) {
    const r = await fx.getReferenceRate('ZWG', 'USD', { supabaseClient: c, provider, today: '2026-09-04' });
    assert.equal(r.status, 'UNAVAILABLE');
    assert.equal(r.rate, undefined);
  }
  assert.equal(inserts.n, 0);
  assert.equal(calls.n, 1);
});

test('C1: staleness is decided at read time — a row written AVAILABLE is STALE once it is old', async () => {
  const seeded = {
    id: 'snap-old', base_currency: 'JPY', quote_currency: 'USD', rate: 0.0064, rate_date: '2026-09-04',
    source: 'ECB', source_reference: 'x', status: 'AVAILABLE', triangulation: null,
  };
  // The source is still on the same publication (a long non-publication period).
  const stuck = countingFetch(() => feedXml('2026-09-04'));
  const { c, inserts } = snapshotsClient([seeded]);
  const r = await fx.getReferenceRate('JPY', 'USD', { supabaseClient: c, provider: fx.createEcbFxProvider({ fetchImpl: stuck.impl }), today: '2026-09-20' });
  assert.equal(r.status, 'STALE', 'a sixteen-day-old rate is not current, whatever its row says');
  assert.equal(r.rate_date, '2026-09-04');
  assert.equal(r.snapshot_id, 'snap-old');
  assert.match(r.reason, /2026-09-04/);
  assert.equal(inserts.n, 0);
  // And during an outage the same row is still STALE, with the outage named.
  const dead = fx.createEcbFxProvider({ fetchImpl: async () => { throw new Error('down'); } });
  const out = await fx.getReferenceRate('JPY', 'USD', { supabaseClient: c, provider: dead, today: '2026-09-20' });
  assert.equal(out.status, 'STALE');
  assert.match(out.reason, /could not be reached/);
});

test('C1: a snapshot dated today is served without consulting the source', async () => {
  const seeded = {
    id: 'snap-today', base_currency: 'JPY', quote_currency: 'USD', rate: 0.0064, rate_date: '2026-09-04',
    source: 'ECB', source_reference: 'x', status: 'AVAILABLE', triangulation: null,
  };
  const { calls, impl } = countingFetch(() => feedXml('2026-09-04'));
  const { c } = snapshotsClient([seeded]);
  const r = await fx.getReferenceRate('JPY', 'USD', { supabaseClient: c, provider: fx.createEcbFxProvider({ fetchImpl: impl }), today: '2026-09-04' });
  assert.equal(r.snapshot_id, 'snap-today');
  assert.equal(r.status, 'AVAILABLE');
  assert.equal(calls.n, 0);
});

test('C1: without an injected provider every read shares ONE process observer', async () => {
  const saved = globalThis.fetch;
  const calls = { n: 0 };
  globalThis.fetch = async () => { calls.n += 1; return { ok: true, text: async () => feedXml('2026-09-04') }; };
  try {
    const fresh = await import('../services/diaspora/tradeFxRateService.js?shared-observer');
    const { c } = snapshotsClient();
    await fresh.getReferenceRate('JPY', 'USD', { supabaseClient: c, today: '2026-09-05' });
    await fresh.getReferenceRate('ZAR', 'USD', { supabaseClient: c, today: '2026-09-05' });
    await fresh.getReferenceRate('ZWG', 'USD', { supabaseClient: c, today: '2026-09-05' });
    assert.equal(calls.n, 1);
  } finally {
    globalThis.fetch = saved;
  }
});
