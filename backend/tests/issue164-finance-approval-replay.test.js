/**
 * Issue #164 — finance approval replay identity/terms + scalar term validation.
 *
 * Codex P1: an Approved request is an idempotent replay ONLY when the persisted APR, monthly payment
 * AND deciding authority equal the normalized request. Same status with different terms or a
 * different lender/admin must Conflict, not silently succeed — and a genuine replay must emit no
 * duplicate domain event. This must hold in BOTH the same-status idempotency branch and the zero-row
 * concurrent-loser branch.
 *
 * Codex P2: finance term scalars accept only a primitive number or a nonblank numeric string;
 * false/true/[]/[5]/{}/null/undefined/''/whitespace/NaN/Infinity/negative-APR are rejected;
 * APR 0, "0" and positive finite values are preserved; monthly payment stays strictly > 0.
 *
 * Deterministic: the express handler is invoked directly against an in-memory supabase mock. A
 * concurrent winner is simulated by decoupling the loser's initial READ snapshot from the live store
 * the CAS update sees — no threads, fully repeatable.  Run:
 *   node --test backend/tests/issue164-finance-approval-replay.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { supabase } = await import('../db/supabase.js');
const financeRouter = (await import('../routes/financeRoutes.js')).default;

// ── locate the POST /update handler (skip the authorizeRole middleware, invoke the asyncHandler) ──
function updateHandler() {
  for (const layer of financeRouter.stack) {
    const r = layer.route;
    if (r && r.path === '/api/finance/applications/:id/update' && r.methods.post) {
      const stack = r.stack;
      return stack[stack.length - 1].handle; // the asyncHandler(fn)
    }
  }
  throw new Error('finance update route not found');
}
const handler = updateHandler();

// ── controllable in-memory supabase mock ──────────────────────────────────────
let live;          // the live finance_applications row (what CAS + fallback see)
let readSnapshot;  // what the initial .select().eq().maybeSingle() returns (null => use live)
let eventCount;    // domain_events inserts

function install() {
  supabase.from = (table) => {
    const st = { table, op: 'select', filters: {}, maybe: false, payload: null };
    const chain = {
      select() { return chain; },
      insert(p) { st.op = 'insert'; st.payload = p; return chain; },
      update(p) { st.op = 'update'; st.payload = p; return chain; },
      eq(k, v) { st.filters[k] = v; return chain; },
      maybeSingle() { st.maybe = true; return Promise.resolve(exec(st)); },
      single() { st.single = true; return Promise.resolve(exec(st)); },
      then(res, rej) { try { return Promise.resolve(exec(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
    };
    return chain;
  };
}

function exec(st) {
  if (st.table === 'domain_events') {
    if (st.op === 'insert') { eventCount += 1; return { data: { id: 'evt' }, error: null }; }
    return { data: null, error: null };
  }
  if (st.table !== 'finance_applications') return { data: st.single || st.maybe ? null : [], error: null };

  if (st.op === 'select') {
    // The read that drives the handler decision uses a snapshot the test controls; the fallback
    // re-read (also a select+maybeSingle) must reflect the LIVE store. We distinguish by whether a
    // snapshot is still "armed": the first select consumes it, later selects see live.
    if (readSnapshot !== undefined && readSnapshot !== null && !readSnapshot.__consumed) {
      readSnapshot.__consumed = true;
      const { __consumed, ...row } = readSnapshot;
      return { data: row, error: null };
    }
    return { data: live ? { ...live } : null, error: null };
  }

  if (st.op === 'update') {
    // CAS: apply only if the live status equals the requested prev-status filter.
    if (live && st.filters.id === live.id && st.filters.status === live.status) {
      live = { ...live, ...st.payload };
      return { data: [{ id: live.id, status: live.status }], error: null };
    }
    return { data: [], error: null }; // loser: zero rows
  }
  return { data: null, error: null };
}

function invoke(body, ctx) {
  install();
  eventCount = 0;
  const req = { params: { id: live.id }, body, userContext: ctx };
  let captured = null;
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  const next = (err) => { captured = err; };
  return Promise.resolve(handler(req, res, next)).then(() => ({ res, err: captured }));
}

const LENDER = { id: 'lender-1', role: 'bank' };
const OTHER_LENDER = { id: 'lender-2', role: 'bank' };
function pendingApp() { return { id: 'fa-1', user_id: 'u1', bank_id: 'lender-1', vin: 'V1', status: 'Pending', apr: null, monthly_payment: null, decision_source: null }; }

// ─────────────────────────────────────────────────────────────────────────────
// P1 — approval replay identity/terms
// ─────────────────────────────────────────────────────────────────────────────

test('concurrent same terms + same lender: one transition emits one event, replay emits none', async () => {
  live = pendingApp(); readSnapshot = null;
  const first = await invoke({ status: 'Approved', apr: 5, monthlyPayment: 200 }, LENDER);
  assert.equal(first.err, null);
  assert.equal(first.res.body.idempotentReplay, undefined, 'first call is a real transition, not a replay');
  assert.equal(first.res.body.success, true);
  assert.equal(eventCount, 1, 'the real transition emits exactly one domain event');

  // second identical request now sees Approved (same-status branch) -> replay, no event
  readSnapshot = null;
  const second = await invoke({ status: 'Approved', apr: 5, monthlyPayment: 200 }, LENDER);
  assert.equal(second.err, null);
  assert.equal(second.res.body.idempotentReplay, true, 'identical re-approval is a replay');
  assert.equal(eventCount, 0, 'a genuine replay emits NO duplicate domain event');
});

test('concurrent different APR: the loser conflicts', async () => {
  // live already Approved by the winner at apr 5; loser read the pre-race Pending snapshot.
  live = { ...pendingApp(), status: 'Approved', apr: 5, monthly_payment: 200, decision_source: 'lender:lender-1' };
  readSnapshot = pendingApp();
  const loser = await invoke({ status: 'Approved', apr: 9, monthlyPayment: 200 }, LENDER);
  assert.ok(loser.err, 'loser must not succeed');
  assert.equal(loser.err.name, 'ConflictError');
  assert.equal(eventCount, 0);
});

test('concurrent different monthly payment: the loser conflicts', async () => {
  live = { ...pendingApp(), status: 'Approved', apr: 5, monthly_payment: 200, decision_source: 'lender:lender-1' };
  readSnapshot = pendingApp();
  const loser = await invoke({ status: 'Approved', apr: 5, monthlyPayment: 999 }, LENDER);
  assert.ok(loser.err);
  assert.equal(loser.err.name, 'ConflictError');
  assert.equal(eventCount, 0);
});

test('same terms but different decision source: conflicts', async () => {
  // winner was lender-1; a different lender (lender-2, also the bank of record) replays same terms.
  live = { ...pendingApp(), bank_id: 'lender-2', status: 'Approved', apr: 5, monthly_payment: 200, decision_source: 'lender:lender-1' };
  readSnapshot = { ...pendingApp(), bank_id: 'lender-2' };
  const conflict = await invoke({ status: 'Approved', apr: 5, monthlyPayment: 200 }, OTHER_LENDER);
  assert.ok(conflict.err);
  assert.equal(conflict.err.name, 'ConflictError');
  assert.equal(eventCount, 0);
});

test('already-Approved request with different terms conflicts (same-status branch)', async () => {
  live = { ...pendingApp(), status: 'Approved', apr: 5, monthly_payment: 200, decision_source: 'lender:lender-1' };
  readSnapshot = null; // initial read sees the live Approved row directly
  const conflict = await invoke({ status: 'Approved', apr: 12, monthlyPayment: 200 }, LENDER);
  assert.ok(conflict.err);
  assert.equal(conflict.err.name, 'ConflictError');
  assert.equal(eventCount, 0);
});

test('concurrent same terms loser is a valid replay, not a conflict, and emits no event', async () => {
  live = { ...pendingApp(), status: 'Approved', apr: 5, monthly_payment: 200, decision_source: 'lender:lender-1' };
  readSnapshot = pendingApp();
  const loser = await invoke({ status: 'Approved', apr: 5, monthlyPayment: 200 }, LENDER);
  assert.equal(loser.err, null);
  assert.equal(loser.res.body.idempotentReplay, true);
  assert.equal(eventCount, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// P2 — scalar finance terms
// ─────────────────────────────────────────────────────────────────────────────

test('non-scalar and invalid APR/monthly terms are rejected before conversion', async () => {
  const reject = [false, true, [], [5], {}, null, undefined, '', '   ', 'abc', NaN, Infinity, -Infinity];
  for (const bad of reject) {
    live = pendingApp(); readSnapshot = null;
    const r = await invoke({ status: 'Approved', apr: bad, monthlyPayment: 200 }, LENDER);
    assert.ok(r.err, `APR ${String(bad)} must be rejected`);
    assert.equal(r.err.name, 'ValidationError', `APR ${String(bad)}`);
  }
  // negative APR is invalid too
  live = pendingApp(); readSnapshot = null;
  let r = await invoke({ status: 'Approved', apr: -1, monthlyPayment: 200 }, LENDER);
  assert.equal(r.err?.name, 'ValidationError', 'negative APR rejected');

  // monthly payment must be strictly > 0, and reject the same non-scalars
  for (const bad of [false, true, [], [5], {}, null, undefined, '', '   ', 0, '0', -5, NaN, Infinity]) {
    live = pendingApp(); readSnapshot = null;
    r = await invoke({ status: 'Approved', apr: 5, monthlyPayment: bad }, LENDER);
    assert.ok(r.err, `monthly ${String(bad)} must be rejected`);
    assert.equal(r.err.name, 'ValidationError', `monthly ${String(bad)}`);
  }
});

test('APR 0, "0" and positive finite values are preserved', async () => {
  for (const good of [0, '0', 5, '5', 12.5, '12.5']) {
    live = pendingApp(); readSnapshot = null;
    const r = await invoke({ status: 'Approved', apr: good, monthlyPayment: 200 }, LENDER);
    assert.equal(r.err, null, `APR ${String(good)} must be accepted`);
    assert.equal(r.res.body.success, true);
    assert.equal(Number(live.apr), Number(good), `APR ${String(good)} persisted`);
  }
  // monthly payment positive numeric string accepted
  live = pendingApp(); readSnapshot = null;
  const r = await invoke({ status: 'Approved', apr: 5, monthlyPayment: '350.50' }, LENDER);
  assert.equal(r.err, null);
  assert.equal(Number(live.monthly_payment), 350.5);
});
