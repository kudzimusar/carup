/**
 * CA-OWNER-02 — the Corporate management FACT: the one shape every Corporate read-model figure takes.
 *
 * Proven here:
 *   · a live fact names its source, as-of time, scope and window, or it does not exist;
 *   · a live operational / technical fact keeps a measured 0 as a value and is labelled for what it is — never a certified
 *     Corporate Actual (OD-CAMETRIC-022); only a governance record of the persistent Corporate authority is a governed actual;
 *   · a failed or incomplete read is DEGRADED and carries no value — a failed read is never zero;
 *   · a statement fact (no source, no semantics, no accounting authority…) states its reason and never carries a value.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  liveFact, statementFact, readFact, rollingWindow, CURRENT_WINDOW, FACT_STATES,
} = await import('../services/corporate/management/managementFact.js');

const NOW = new Date('2026-10-18T00:00:00.000Z');
const base = {
  id: 'communications.thread.open.operational',
  label: 'Open conversations (operational)',
  source: { authority: 'message_threads', path: 'Command Center thread store' },
  asOf: NOW,
  scope: 'Staging · all CarUp organisations',
  window: CURRENT_WINDOW,
};

test('a live operational fact keeps a measured 0 as a value and is labelled operational — never a certified Actual', () => {
  const f = liveFact({ ...base, kind: 'operational', value: 0 });
  assert.equal(f.state, 'TECHNICAL_OPERATIONAL');
  assert.equal(f.kind, 'operational');
  assert.equal(f.value, 0);
  assert.equal(f.certification, 'not_certified');
  assert.equal(f.as_of, '2026-10-18T00:00:00.000Z');
  assert.deepEqual(f.window, { kind: 'current' });
  assert.equal(f.scope, 'Staging · all CarUp organisations');
  assert.equal(f.source.authority, 'message_threads');
  assert.ok(Object.isFrozen(f));
});

test('a technical fact may carry a text value (a build identity), still never an Actual', () => {
  const f = liveFact({ ...base, id: 'platform.build.sha', kind: 'technical', value: '166025842bc2' });
  assert.equal(f.state, 'TECHNICAL_OPERATIONAL');
  assert.equal(f.kind, 'technical');
  assert.equal(f.value, '166025842bc2');
});

test('only a governance record of the persistent Corporate authority is a governed actual', () => {
  const f = liveFact({ ...base, id: 'corporate.governance.membership.active', kind: 'governance', value: 2 });
  assert.equal(f.state, 'GOVERNED_ACTUAL');
  assert.equal(f.certification, 'governance_record');
});

test('a live fact refuses to exist without its source, as-of time or scope', () => {
  assert.throws(() => liveFact({ ...base, kind: 'operational', value: 1, source: undefined }), /source/);
  assert.throws(() => liveFact({ ...base, kind: 'operational', value: 1, asOf: undefined }), /as-of/);
  assert.throws(() => liveFact({ ...base, kind: 'operational', value: 1, scope: '' }), /scope/);
  assert.throws(() => liveFact({ ...base, kind: 'operational', value: -1 }), /value/);
  assert.throws(() => liveFact({ ...base, kind: 'operational', value: Number.NaN }), /value/);
  assert.throws(() => liveFact({ ...base, kind: 'corporate_actual', value: 1 }), /kind/);
});

test('a failed read is DEGRADED with no value — never zero — and says the read failed', async () => {
  const f = await readFact({ ...base, kind: 'operational' }, async () => { throw new Error('connection reset'); }, { now: NOW });
  assert.equal(f.state, 'DEGRADED');
  assert.equal(f.value, null);
  assert.match(f.reason, /could not be read/i);
  assert.doesNotMatch(f.reason, /connection reset/, 'internal error text is never shown');
});

test('an incomplete read (a row cap reached) is DEGRADED with no value', async () => {
  const f = await readFact({ ...base, kind: 'operational' }, async () => ({ value: 5000, complete: false, detail: 'row cap 5000 reached' }), { now: NOW });
  assert.equal(f.state, 'DEGRADED');
  assert.equal(f.value, null);
  assert.match(f.reason, /incomplete/i);
});

test('a complete read becomes a live fact carrying its provenance summary', async () => {
  const provenance = { authority: 'PC01-K2B', raw: 10, operational: 3, excluded_non_operational: 6, unknown_requires_review: 1, by_class: { uat: 6, real_business_operational: 3, unknown_requires_review: 1 } };
  const f = await readFact({ ...base, kind: 'operational' }, async () => ({ value: 3, provenance }), { now: NOW });
  assert.equal(f.state, 'TECHNICAL_OPERATIONAL');
  assert.equal(f.value, 3);
  assert.deepEqual(f.provenance, provenance);
});

test('a read that outlives its time budget is DEGRADED, not pending forever', async () => {
  const f = await readFact({ ...base, kind: 'operational' }, () => new Promise(() => {}), { now: NOW, timeoutMs: 20 });
  assert.equal(f.state, 'DEGRADED');
  assert.equal(f.value, null);
});

test('CA-OWNER-02-R3 D3: a reader may report when its source was REALLY read — a cached figure keeps its own read time', async () => {
  const readAt = new Date(NOW.getTime() - 120_000);
  const f = await readFact({ ...base, kind: 'technical' }, async () => ({ value: 'healthy', asOf: readAt, detail: 'cached read' }), { now: NOW });
  assert.equal(f.state, 'TECHNICAL_OPERATIONAL');
  assert.equal(f.as_of, readAt.toISOString(), 'the figure says when it was read, not when the page asked');
  const future = await readFact({ ...base, kind: 'technical' }, async () => ({ value: 'healthy', asOf: new Date(NOW.getTime() + 60_000) }), { now: NOW });
  assert.equal(future.as_of, NOW.toISOString(), 'a read time in the future is never believed');
});

test('CA-OWNER-02-R3 D3: a reader may say exactly why no value is shown — still DEGRADED with no value', async () => {
  const err = Object.assign(new Error('pending'), { factReason: 'The scheduler-health read is still running, so no value is shown yet.' });
  const f = await readFact({ ...base, kind: 'technical' }, async () => { throw err; }, { now: NOW });
  assert.equal(f.state, 'DEGRADED');
  assert.equal(f.value, null);
  assert.equal(f.reason, 'The scheduler-health read is still running, so no value is shown yet.');
});

test('a statement fact states its reason and never carries a value, even when one is passed', () => {
  const f = statementFact({ id: 'finance.gmv', label: 'GMV', state: 'PENDING_CA_FIN', reason: 'No accepted Corporate accounting system of record exists.', value: 123 });
  assert.equal(f.state, 'PENDING_CA_FIN');
  assert.equal(f.value, null);
  assert.equal(f.reason, 'No accepted Corporate accounting system of record exists.');
  assert.throws(() => statementFact({ id: 'x', label: 'X', state: 'UNAVAILABLE_NO_SOURCE' }), /reason/);
  assert.throws(() => statementFact({ id: 'x', label: 'X', state: 'TECHNICAL_OPERATIONAL', reason: 'r' }), /statement state/);
});

test('a fact may carry the extent of its population — the oldest and newest record times — and nothing invalid', async () => {
  const f = liveFact({ ...base, kind: 'operational', value: 3, extent: { oldestAt: '2026-10-01T10:00:00Z', newestAt: new Date('2026-10-17T10:00:00Z') } });
  assert.deepEqual(f.extent, { oldest_at: '2026-10-01T10:00:00.000Z', newest_at: '2026-10-17T10:00:00.000Z' });
  assert.equal(liveFact({ ...base, kind: 'operational', value: 0, extent: { oldestAt: null, newestAt: null } }).extent.oldest_at, null);
  assert.throws(() => liveFact({ ...base, kind: 'operational', value: 1, extent: { oldestAt: 'not a date', newestAt: null } }), /extent/);
  const read = await readFact({ ...base, kind: 'operational' }, async () => ({ value: 2, extent: { oldestAt: '2026-10-02T00:00:00Z', newestAt: '2026-10-03T00:00:00Z' } }), { now: NOW });
  assert.equal(read.extent.oldest_at, '2026-10-02T00:00:00.000Z');
  assert.equal(liveFact({ ...base, kind: 'operational', value: 1 }).extent, null);
});

test('a fact may carry a named breakdown (states, per-currency amounts) — never a total across currencies', () => {
  const f = liveFact({
    ...base, kind: 'operational', value: 3,
    breakdown: [{ key: 'status:open', label: 'Open', value: 2 }, { key: 'amount:USD', label: 'Requested amount', value: 1500.5, currency: 'USD' }],
  });
  assert.deepEqual(f.breakdown, [
    { key: 'status:open', label: 'Open', value: 2, currency: null },
    { key: 'amount:USD', label: 'Requested amount', value: 1500.5, currency: 'USD' },
  ]);
  assert.throws(() => liveFact({ ...base, kind: 'operational', value: 1, breakdown: [{ key: 'x', label: 'X', value: -1 }] }), /breakdown/);
  assert.throws(() => liveFact({ ...base, kind: 'operational', value: 1, breakdown: [{ key: 'x', label: '', value: 1 }] }), /breakdown/);
  assert.equal(liveFact({ ...base, kind: 'operational', value: 1 }).breakdown, null);
});

test('a rolling window names its days and its exact bounds', () => {
  assert.deepEqual(rollingWindow(7, NOW), { kind: 'rolling', days: 7, from: '2026-10-11T00:00:00.000Z', to: '2026-10-18T00:00:00.000Z' });
  assert.ok(FACT_STATES.includes('DEGRADED'));
  assert.ok(!FACT_STATES.includes('MEASURED_ZERO'), 'a staging diagnostic zero is never presented as a measured Actual zero');
});
