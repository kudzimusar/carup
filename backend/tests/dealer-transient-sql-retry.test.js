// CARUP-DEALER-ONB-001-LR01-R6 DBA #4: bounded retry policy for whole-transaction dealership RPCs.
// Fictional values only; injected sleep/random so no test waits on a real timer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RETRYABLE_SQLSTATES,
  DEFAULT_TRANSIENT_RETRY,
  isTransientSqlConflict,
  transientRetryDelayMs,
  rpcWithTransientRetry,
} from '../services/dealer/dealerTransientSqlRetry.js';
import { prepareMyDealerListing } from '../services/dealer/dealerCanonicalListingService.js';
import { recordOperatingLifecycleDecision } from '../services/dealer/dealerOperatingLifecycleService.js';

const deadlock = Object.freeze({ code: '40P01', message: 'deadlock detected' });
const serialization = Object.freeze({ code: '40001', message: 'could not serialize access due to concurrent update' });
const ok = Object.freeze({ data: { fictional: true }, error: null });

/** A db whose rpc() returns the scripted results in order and records every call. */
function scriptedDb(...results) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push([name, args]);
      const next = results[Math.min(calls.length - 1, results.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    },
  };
}
const recordingSleep = () => { const waits = []; const sleep = async (ms) => { waits.push(ms); }; sleep.waits = waits; return sleep; };

test('the retryable vocabulary is exactly deadlock_detected and serialization_failure', () => {
  assert.deepEqual([...RETRYABLE_SQLSTATES].sort(), ['40001', '40P01']);
  assert.equal(DEFAULT_TRANSIENT_RETRY.maxAttempts, 3);
  assert.equal(isTransientSqlConflict(deadlock), true);
  assert.equal(isTransientSqlConflict(serialization), true);
  for (const code of ['P0001', '55P03', '57014', '23505', '42501', '40003', '40P02', '08006', '', undefined]) {
    assert.equal(isTransientSqlConflict({ code, message: 'deadlock detected' }), false, `code ${code} must not be retried`);
  }
  assert.equal(isTransientSqlConflict(null), false);
  assert.equal(isTransientSqlConflict('40P01'), false);
});

test('a 40P01 deadlock victim is retried and the later success is returned', async () => {
  const db = scriptedDb({ data: null, error: deadlock }, ok);
  const sleep = recordingSleep();
  const result = await rpcWithTransientRetry(db, 'dealer_record_operating_lifecycle_decision', { p: 1 }, { sleep, random: () => 0.5 });
  assert.equal(result, ok);
  assert.equal(db.calls.length, 2);
  assert.deepEqual(db.calls[1], ['dealer_record_operating_lifecycle_decision', { p: 1 }], 'the identical call is repeated');
  assert.equal(sleep.waits.length, 1);
  assert.ok(sleep.waits[0] >= 1 && sleep.waits[0] <= DEFAULT_TRANSIENT_RETRY.baseDelayMs);
});

test('a 40001 serialization failure is retried', async () => {
  const db = scriptedDb({ data: null, error: serialization }, ok);
  assert.equal(await rpcWithTransientRetry(db, 'f', {}, { sleep: recordingSleep() }), ok);
  assert.equal(db.calls.length, 2);
});

test('business refusals and every other error are returned after exactly ONE call', async () => {
  const refusals = [
    { code: 'P0001', message: 'DEALER_LISTING_AUTHORITY_NOT_CURRENT' },
    { code: 'P0001', message: 'ONLY_ACTIVE_DEALER_CAN_BE_SUSPENDED' },
    { code: '55P03', message: 'canceling statement due to lock timeout' },
    { code: '23505', message: 'duplicate key value violates unique constraint' },
    { code: '42501', message: 'permission denied for function' },
    { message: 'deadlock detected' }, // no SQLSTATE: never inferred from text
  ];
  for (const error of refusals) {
    const db = scriptedDb({ data: null, error }, ok);
    const sleep = recordingSleep();
    const result = await rpcWithTransientRetry(db, 'f', {}, { sleep });
    assert.equal(result.error, error, `${error.code} ${error.message} is returned unchanged`);
    assert.equal(db.calls.length, 1, `${error.code} ${error.message} must not be retried`);
    assert.equal(sleep.waits.length, 0);
  }
  const success = scriptedDb(ok, ok);
  assert.equal(await rpcWithTransientRetry(success, 'f', {}, { sleep: recordingSleep() }), ok);
  assert.equal(success.calls.length, 1);
});

test('it gives up after maxAttempts and returns the last deadlock error unchanged', async () => {
  const db = scriptedDb({ data: null, error: deadlock });
  const sleep = recordingSleep();
  const result = await rpcWithTransientRetry(db, 'f', {}, { sleep, random: () => 0.999 });
  assert.equal(result.error, deadlock);
  assert.equal(db.calls.length, 3, 'three calls in total, never more');
  assert.equal(sleep.waits.length, 2, 'no wait after the final attempt');
  assert.deepEqual(sleep.waits, [40, 80], 'exponential cap per attempt at random≈1');
  const two = scriptedDb({ data: null, error: deadlock });
  await rpcWithTransientRetry(two, 'f', {}, { sleep: recordingSleep(), maxAttempts: 2 });
  assert.equal(two.calls.length, 2);
});

test('an invalid attempt budget fails safe to a single call', async () => {
  for (const maxAttempts of [0, -1, 1.5, 6, 100, '3', null]) {
    const db = scriptedDb({ data: null, error: deadlock });
    await rpcWithTransientRetry(db, 'f', {}, { sleep: recordingSleep(), maxAttempts });
    assert.equal(db.calls.length, 1, `maxAttempts=${maxAttempts}`);
  }
});

test('a thrown exception (network/client fault) propagates without a retry', async () => {
  const db = scriptedDb(Object.assign(new Error('fetch failed'), { code: '40P01' }));
  await assert.rejects(rpcWithTransientRetry(db, 'f', {}, { sleep: recordingSleep() }), /fetch failed/);
  assert.equal(db.calls.length, 1);
});

test('full-jitter delays stay inside [1, min(maxDelay, base*2^(n-1))]', () => {
  const cfg = { baseDelayMs: 40, maxDelayMs: 250 };
  assert.equal(transientRetryDelayMs(1, cfg, () => 0), 1);
  assert.equal(transientRetryDelayMs(1, cfg, () => 0.999999), 40);
  assert.equal(transientRetryDelayMs(2, cfg, () => 0.999999), 80);
  assert.equal(transientRetryDelayMs(4, cfg, () => 0.999999), 250, 'capped at maxDelayMs');
  assert.equal(transientRetryDelayMs(9, cfg, () => 5), 250, 'an out-of-range random is clamped');
  for (let i = 0; i < 200; i += 1) {
    const d = transientRetryDelayMs(2, cfg);
    assert.ok(Number.isInteger(d) && d >= 1 && d <= 80);
  }
});

test('onRetry observes code, attempt and delay (no SQL text, no arguments)', async () => {
  const seen = [];
  await rpcWithTransientRetry(scriptedDb({ data: null, error: deadlock }, ok), 'dealer_prepare_canonical_listing', { p_vin: 'X' },
    { sleep: recordingSleep(), random: () => 0, onRetry: (e) => seen.push(e) });
  assert.deepEqual(seen, [{ fn: 'dealer_prepare_canonical_listing', attempt: 1, code: '40P01', delayMs: 1 }]);
});

// ── Wiring: the two affected services retry a deadlock victim and never a refusal ──
const VIN = 'SYNTHR4P02DLR0001';
const owner = { actor_id: 'fictional-owner', tenant_id: '99999999-8888-4777-8666-555555555555' };
const listingPayload = {
  branch_id: '11111111-2222-4333-8444-555555555555', price: 18500, currency: 'USD', chassis_number: 'FICT-CHASSIS-1',
  engine_number: 'FICT-ENGINE-1', registration_status: 'customs_cleared_cvr_pending', listing_city: 'Harare',
  listing_province: 'Harare Metropolitan', location_visibility: 'public', public_seller_display: true,
};
const prepared = { data: { vin: VIN, published: false, governed_seller_is_approved_owner: true }, error: null };

test('prepareMyDealerListing retries a deadlock victim, and maps a refusal after one call', async () => {
  const db = scriptedDb({ data: null, error: deadlock }, prepared);
  const receipt = await prepareMyDealerListing({ userId: 'fictional-owner' }, VIN, listingPayload,
    { db, resolveOwner: async () => owner, retry: { sleep: recordingSleep() } });
  assert.equal(receipt.vin, VIN);
  assert.equal(db.calls.length, 2);
  const refused = scriptedDb({ data: null, error: { code: 'P0001', message: 'DEALER_LISTING_AUTHORITY_NOT_CURRENT' } }, prepared);
  await assert.rejects(prepareMyDealerListing({ userId: 'fictional-owner' }, VIN, listingPayload,
    { db: refused, resolveOwner: async () => owner, retry: { sleep: recordingSleep() } }),
  (e) => e.code === 'DEALER_LISTING_AUTHORITY_NOT_CURRENT' && e.statusCode === 403);
  assert.equal(refused.calls.length, 1);
  const stuck = scriptedDb({ data: null, error: deadlock });
  await assert.rejects(prepareMyDealerListing({ userId: 'fictional-owner' }, VIN, listingPayload,
    { db: stuck, resolveOwner: async () => owner, retry: { sleep: recordingSleep() } }),
  (e) => e.code === 'DEALER_LISTING_PREPARATION_UNAVAILABLE' && e.statusCode === 503);
  assert.equal(stuck.calls.length, 3);
});

const lifecycleReason = 'Fictional CI lifecycle decision with a reason long enough to be recorded permanently.';
function lifecycleDb(...results) {
  const db = scriptedDb(...results);
  db.from = () => {
    const chain = { select() { return chain; }, eq() { return chain; },
      async maybeSingle() { return { data: { link_id: 'link-1', seed_dealer_id: 'ZW-DEAL-0001', claimant_user_id: 'fictional-owner',
        operating_status: 'ACTIVE', legal_review_id: 'legal-1' }, error: null }; } };
    return chain;
  };
  return db;
}
const suspended = { data: { seed_dealer_id: 'ZW-DEAL-0001', action: 'SUSPEND', operating_status: 'SUSPENDED',
  listings_republished: false, payment_entitlement_changed: false }, error: null };

test('recordOperatingLifecycleDecision retries a deadlock victim and never a refusal', async () => {
  const reviewer = { userId: 'fictional-reviewer', role: 'reviewer' };
  const opts = (db) => ({ db, independent: () => {}, stepUp: async () => {}, retry: { sleep: recordingSleep() } });
  const body = { action: 'SUSPEND', reason: lifecycleReason, reviewer_password: 'pw' };
  const db = lifecycleDb({ data: null, error: deadlock }, { data: null, error: serialization }, suspended);
  const receipt = await recordOperatingLifecycleDecision('ZW-DEAL-0001', reviewer, body, opts(db));
  assert.equal(receipt.operating_status, 'SUSPENDED');
  assert.equal(db.calls.length, 3);
  const refused = lifecycleDb({ data: null, error: { code: 'P0001', message: 'ONLY_ACTIVE_DEALER_CAN_BE_SUSPENDED' } }, suspended);
  await assert.rejects(recordOperatingLifecycleDecision('ZW-DEAL-0001', reviewer, body, opts(refused)),
    (e) => e.code === 'ONLY_ACTIVE_DEALER_CAN_BE_SUSPENDED' && e.statusCode === 409);
  assert.equal(refused.calls.length, 1, 'a business refusal is final');
});

test('source wiring: both affected RPCs go through the bounded retry', () => {
  const listing = readFileSync(new URL('../services/dealer/dealerCanonicalListingService.js', import.meta.url), 'utf8');
  const lifecycle = readFileSync(new URL('../services/dealer/dealerOperatingLifecycleService.js', import.meta.url), 'utf8');
  assert.match(listing, /rpcWithTransientRetry\(db, 'dealer_prepare_canonical_listing'/);
  assert.match(lifecycle, /rpcWithTransientRetry\(db, 'dealer_record_operating_lifecycle_decision'/);
  assert.doesNotMatch(listing, /db\.rpc\('dealer_prepare_canonical_listing'/);
  assert.doesNotMatch(lifecycle, /db\.rpc\('dealer_record_operating_lifecycle_decision'/);
});
