/**
 * Diaspora GTM Drive lane — durable sync attempts (Issue #127).
 *
 * The behaviour under test is the difference between "the upload failed and nobody knows" and "the
 * upload is a row with a truthful state". So the tests here are mostly about the UNHAPPY paths:
 * concurrent duplicates, a rate limit that must back off, a revocation that must NOT be retried, and
 * a ceiling that must terminate rather than spin.
 *
 * Backoff jitter is injected, so the assertions are exact rather than statistical.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase, UNIQUE_INDEXES } = await import('./helpers/mockSupabase.js');
const { FAKE } = await import('./helpers/googleDriveFixtures.js');
const { DriveProviderError } = await import('../services/diaspora/drive/driveProvider.js');
const queue = await import('../services/diaspora/drive/driveSyncQueue.js');

const TENANT = '11111111-1111-1111-1111-111111111111';
const FIXED_NOW = new Date('2026-07-27T12:00:00.000Z');
const now = () => FIXED_NOW;
const noJitter = () => 1;      // take the full backoff window — deterministic
const zeroJitter = () => 0;

function db() {
  return createMockSupabase({ diaspora_drive_sync_attempts: [], diaspora_import_audit_log: [] });
}

const descriptor = (overrides = {}) => ({
  tenantId: TENANT,
  userId: 'user-1',
  connectionId: 'conn-1',
  operation: queue.SYNC_ATTEMPT_OPERATION.UPLOAD,
  entityType: 'buyer_order',
  entityId: 'ord-1',
  idempotencyKey: 'idem-1',
  contentChecksum: 'abc123',
  ...overrides,
});

// ── Backoff ──────────────────────────────────────────────────────────────────

test('backoff grows exponentially and is capped', () => {
  const windows = [1, 2, 3, 4, 5, 6, 7, 8, 20].map((n) => queue.computeBackoffMs(n, { jitter: noJitter }));
  assert.deepEqual(windows.slice(0, 5), [2000, 4000, 8000, 16000, 32000]);
  for (let i = 1; i < windows.length; i += 1) assert.ok(windows[i] >= windows[i - 1], 'must be monotonic');
  assert.equal(windows.at(-1), queue.BACKOFF_MAX_MS, 'and capped, not unbounded');
});

test('full jitter spreads retries across the window instead of synchronising them', () => {
  // The failure this defends against: every queued upload fails at the same instant when Drive rate
  // limits, so without jitter they all return at the same instant and reproduce the overload.
  assert.equal(queue.computeBackoffMs(3, { jitter: zeroJitter }), 0);
  assert.equal(queue.computeBackoffMs(3, { jitter: () => 0.5 }), 4000);
  assert.equal(queue.computeBackoffMs(3, { jitter: noJitter }), 8000);
});

test('a provider Retry-After hint wins over our own curve', () => {
  const withHint = queue.computeBackoffMs(1, { jitter: zeroJitter, retryAfterMs: 30_000 });
  assert.equal(withHint, 30_000, 'Google told us how long to wait; our curve does not know better');
  // …but never past the cap.
  assert.equal(queue.computeBackoffMs(1, { jitter: zeroJitter, retryAfterMs: 60 * 60 * 1000 }), queue.BACKOFF_MAX_MS);
});

test('attempt 0 and nonsense inputs still produce a sane delay', () => {
  assert.equal(queue.computeBackoffMs(0, { jitter: noJitter }), 2000);
  assert.equal(queue.computeBackoffMs(NaN, { jitter: noJitter }), 2000);
});

// ── Idempotency ──────────────────────────────────────────────────────────────

test('the idempotency guarantee is the database index, not an application check', () => {
  // If this registration is ever dropped, the duplicate test below would pass vacuously.
  assert.deepEqual(UNIQUE_INDEXES.diaspora_drive_sync_attempts, [['tenant_id', 'idempotency_key']]);
});

test('a duplicate enqueue loses the insert race and reads back the winner', async () => {
  const client = db();
  const first = await queue.enqueueSyncAttempt(client, descriptor());
  assert.equal(first.idempotentReplay, false);
  const second = await queue.enqueueSyncAttempt(client, descriptor());
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.attempt.id, first.attempt.id);
  assert.equal(client._rows('diaspora_drive_sync_attempts').length, 1);
});

test('the same key in a different tenant is a different attempt', async () => {
  const client = db();
  await queue.enqueueSyncAttempt(client, descriptor());
  const other = await queue.enqueueSyncAttempt(client, descriptor({ tenantId: '22222222-2222-2222-2222-222222222222' }));
  assert.equal(other.idempotentReplay, false);
  assert.equal(client._rows('diaspora_drive_sync_attempts').length, 2);
});

test('enqueue validates its inputs rather than writing a row the CHECK constraints would reject', async () => {
  const client = db();
  await assert.rejects(() => queue.enqueueSyncAttempt(client, descriptor({ tenantId: null })), /tenant context is required/);
  await assert.rejects(() => queue.enqueueSyncAttempt(client, descriptor({ idempotencyKey: null })), /idempotency key is required/);
  await assert.rejects(() => queue.enqueueSyncAttempt(client, descriptor({ operation: 'delete_everything' })), /Unsupported Drive sync operation/);
  assert.equal(client._rows('diaspora_drive_sync_attempts').length, 0);
});

// ── Claim / lease ────────────────────────────────────────────────────────────

test('claiming leases the attempt so a second worker cannot also deliver it', async () => {
  const client = db();
  const { attempt } = await queue.enqueueSyncAttempt(client, descriptor());
  const first = await queue.claimSyncAttempt(client, attempt.id, { now });
  assert.equal(first.claimed, true);
  assert.equal(first.attempt.state, 'in_flight');
  assert.equal(first.attempt.attempts, 1);
  assert.equal(first.attempt.next_attempt_at, null, 'an in-flight attempt is not also scheduled');

  const second = await queue.claimSyncAttempt(client, attempt.id, { now });
  assert.equal(second.claimed, false, 'double delivery is exactly what the lease prevents');
  assert.equal(second.attempt.attempts, 1, 'a lost claim must not inflate the attempt count');
});

test('a settled attempt cannot be claimed again', async () => {
  const client = db();
  const { attempt } = await queue.enqueueSyncAttempt(client, descriptor());
  await queue.claimSyncAttempt(client, attempt.id, { now });
  await queue.recordSyncSuccess(client, attempt.id, { providerFileId: 'file-1', now });
  assert.equal((await queue.claimSyncAttempt(client, attempt.id, { now })).claimed, false);
});

test('claiming an unknown attempt is an error, not a silent no-op', async () => {
  await assert.rejects(() => queue.claimSyncAttempt(db(), 'no-such-id'), /No such Drive sync attempt/);
});

// ── Settle ───────────────────────────────────────────────────────────────────

test('success records the provider ids and clears the schedule', async () => {
  const client = db();
  const { attempt } = await queue.enqueueSyncAttempt(client, descriptor());
  await queue.claimSyncAttempt(client, attempt.id, { now });
  const settled = await queue.recordSyncSuccess(client, attempt.id, {
    providerFileId: 'file-9', providerFolderId: 'folder-2', bytes: 1234, contentChecksum: 'deadbeef', now,
  });
  assert.equal(settled.state, 'succeeded');
  assert.equal(settled.provider_file_id, 'file-9');
  assert.equal(settled.bytes, 1234);
  assert.equal(settled.next_attempt_at, null);
  assert.equal(settled.completed_at, FIXED_NOW.toISOString());
});

test('a retryable failure backs off and stays retryable', async () => {
  const client = db();
  const { attempt } = await queue.enqueueSyncAttempt(client, descriptor());
  await queue.claimSyncAttempt(client, attempt.id, { now });
  const rateLimited = new DriveProviderError('Google Drive is rate limiting this account', 'RATE_LIMITED', { retryable: true });
  const settled = await queue.recordSyncFailure(client, attempt.id, { error: rateLimited, now, jitter: noJitter });
  assert.equal(settled.state, 'failed');
  assert.equal(settled.last_error_code, 'RATE_LIMITED');
  assert.equal(settled.next_attempt_at, new Date(FIXED_NOW.getTime() + 2000).toISOString());
});

test('a NON-retryable failure dead-letters immediately instead of burning the ceiling', async () => {
  const client = db();
  const { attempt } = await queue.enqueueSyncAttempt(client, descriptor());
  await queue.claimSyncAttempt(client, attempt.id, { now });
  // A revoked grant cannot be fixed by waiting; retrying it five times just delays the truth.
  const revoked = new DriveProviderError('Drive access has been revoked', 'REVOKED', { retryable: false });
  const settled = await queue.recordSyncFailure(client, attempt.id, { error: revoked, now, jitter: noJitter });
  assert.equal(settled.state, 'dead_lettered');
  assert.equal(settled.attempts, 1, 'dead-lettered on the FIRST attempt');
  assert.equal(settled.next_attempt_at, null);
});

test('the attempt ceiling terminates a retryable failure rather than retrying forever', async () => {
  const client = db();
  const { attempt } = await queue.enqueueSyncAttempt(client, descriptor());
  const transient = new DriveProviderError('Drive is unavailable', 'PROVIDER_UNAVAILABLE', { retryable: true });
  let state;
  for (let i = 0; i < 3; i += 1) {
    await queue.claimSyncAttempt(client, attempt.id, { now });
    state = await queue.recordSyncFailure(client, attempt.id, { error: transient, maxAttempts: 3, now, jitter: noJitter });
  }
  assert.equal(state.attempts, 3);
  assert.equal(state.state, 'dead_lettered');
  assert.equal(state.next_attempt_at, null, 'a dead letter must be unschedulable');
  // And a drainer will not pick it up again.
  assert.equal((await queue.listDueSyncAttempts(client, { tenantId: TENANT, now: new Date(FIXED_NOW.getTime() + 86_400_000) })).length, 0);
});

test('dead-lettering writes a CRITICAL audit row naming the entity that did not arrive', async () => {
  const client = db();
  const { attempt } = await queue.enqueueSyncAttempt(client, descriptor());
  await queue.claimSyncAttempt(client, attempt.id, { now });
  await queue.recordSyncFailure(client, attempt.id, {
    error: new DriveProviderError('quota', 'QUOTA_EXCEEDED', { retryable: false }),
    now,
    auditContext: { actorId: 'user-1' },
  });
  const audits = client._rows('diaspora_import_audit_log');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'DRIVE_SYNC_DEAD_LETTERED');
  assert.equal(audits[0].resource_id, attempt.id);
  assert.equal(audits[0].metadata.entityId, 'ord-1');
  assert.equal(audits[0].metadata.errorCode, 'QUOTA_EXCEEDED');
  assert.ok(audits[0].cryptographic_seal);
});

test('a retryable failure does NOT raise a dead-letter audit', async () => {
  const client = db();
  const { attempt } = await queue.enqueueSyncAttempt(client, descriptor());
  await queue.claimSyncAttempt(client, attempt.id, { now });
  await queue.recordSyncFailure(client, attempt.id, {
    error: new DriveProviderError('rate limited', 'RATE_LIMITED', { retryable: true }),
    now, jitter: noJitter, auditContext: { actorId: 'user-1' },
  });
  assert.equal(client._rows('diaspora_import_audit_log').length, 0);
});

test('a token echoed in a provider error never reaches last_error', async () => {
  const client = db();
  const { attempt } = await queue.enqueueSyncAttempt(client, descriptor());
  await queue.claimSyncAttempt(client, attempt.id, { now });
  const leaky = new DriveProviderError(`upstream said: bearer ${FAKE.accessToken} refresh ${FAKE.refreshToken}`, 'X', { retryable: true });
  const settled = await queue.recordSyncFailure(client, attempt.id, { error: leaky, now, jitter: noJitter });
  assert.ok(!settled.last_error.includes(FAKE.accessToken));
  assert.ok(!settled.last_error.includes(FAKE.refreshToken));
  assert.match(settled.last_error, /\[REDACTED\]/);
});

// ── The drainer view ─────────────────────────────────────────────────────────

test('only attempts whose schedule has come due are returned, oldest first', async () => {
  const client = db();
  const a = await queue.enqueueSyncAttempt(client, descriptor({ idempotencyKey: 'k-a' }));
  const b = await queue.enqueueSyncAttempt(client, descriptor({ idempotencyKey: 'k-b' }));
  await queue.claimSyncAttempt(client, b.attempt.id, { now });
  await queue.recordSyncFailure(client, b.attempt.id, {
    error: new DriveProviderError('x', 'RATE_LIMITED', { retryable: true }), now, jitter: noJitter,
  });

  const dueNow = await queue.listDueSyncAttempts(client, { tenantId: TENANT, now: FIXED_NOW });
  assert.deepEqual(dueNow.map((r) => r.id), [a.attempt.id], 'the backed-off attempt is not yet due');

  const dueLater = await queue.listDueSyncAttempts(client, { tenantId: TENANT, now: new Date(FIXED_NOW.getTime() + 10_000) });
  assert.equal(dueLater.length, 2);
});

test('attempts for an entity read back newest first with a sanitized shape', async () => {
  const client = db();
  const { attempt } = await queue.enqueueSyncAttempt(client, descriptor());
  await queue.claimSyncAttempt(client, attempt.id, { now });
  await queue.recordSyncSuccess(client, attempt.id, { providerFileId: 'file-1', now });
  const rows = await queue.listSyncAttemptsForEntity(client, { tenantId: TENANT, entityType: 'buyer_order', entityId: 'ord-1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, 'succeeded');
  assert.equal(rows[0].providerFileId, 'file-1');
  assert.ok(!('tenant_id' in rows[0]));
  assert.ok(!('connection_id' in rows[0]));
});

// ── The orchestrator ─────────────────────────────────────────────────────────

test('runSyncAttempt performs the work once and settles it', async () => {
  const client = db();
  let ran = 0;
  const outcome = await queue.runSyncAttempt(client, descriptor(), async () => {
    ran += 1;
    return { providerFileId: 'file-7', bytes: 42, result: { ok: true } };
  }, { now });
  assert.equal(ran, 1);
  assert.equal(outcome.attempt.state, 'succeeded');
  assert.deepEqual(outcome.result, { ok: true });
  assert.equal(outcome.replayed, false);
});

test('a replayed request returns the recorded outcome WITHOUT performing the work again', async () => {
  const client = db();
  let ran = 0;
  const work = async () => { ran += 1; return { providerFileId: 'file-7', result: { ok: true } }; };
  await queue.runSyncAttempt(client, descriptor(), work, { now });
  const replay = await queue.runSyncAttempt(client, descriptor(), work, { now });
  assert.equal(ran, 1, 'this is what makes a retried HTTP request safe');
  assert.equal(replay.replayed, true);
  assert.equal(replay.attempt.providerFileId, 'file-7');
});

test('a failure inside runSyncAttempt surfaces the provider error and records the attempt', async () => {
  const client = db();
  const boom = new DriveProviderError('Drive is unavailable', 'PROVIDER_UNAVAILABLE', { retryable: true });
  await assert.rejects(
    () => queue.runSyncAttempt(client, descriptor(), async () => { throw boom; }, { now, jitter: noJitter }),
    (err) => {
      assert.equal(err.code, 'PROVIDER_UNAVAILABLE');
      return true;
    },
  );
  const row = client._rows('diaspora_drive_sync_attempts')[0];
  assert.equal(row.state, 'failed');
  assert.equal(row.attempts, 1);
  assert.ok(row.next_attempt_at);
});

test('a retry after a failure re-runs the work and can succeed', async () => {
  const client = db();
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw new DriveProviderError('unavailable', 'PROVIDER_UNAVAILABLE', { retryable: true });
    return { providerFileId: 'file-2', result: 'ok' };
  };
  await assert.rejects(() => queue.runSyncAttempt(client, descriptor(), flaky, { now, jitter: noJitter }));
  const second = await queue.runSyncAttempt(client, descriptor(), flaky, { now, jitter: noJitter });
  assert.equal(second.attempt.state, 'succeeded');
  assert.equal(second.attempt.attempts, 2, 'the attempt count carries across the retry');
  assert.equal(calls, 2);
});

test('a dead-lettered operation refuses a silent automatic retry', async () => {
  const client = db();
  const fatal = new DriveProviderError('revoked', 'REVOKED', { retryable: false });
  await assert.rejects(() => queue.runSyncAttempt(client, descriptor(), async () => { throw fatal; }, { now }));
  await assert.rejects(
    () => queue.runSyncAttempt(client, descriptor(), async () => ({ result: 'should not run' }), { now }),
    /failed permanently and will not be retried automatically/,
  );
});

test('an attempt another worker holds is reported truthfully, not duplicated', async () => {
  const client = db();
  const { attempt } = await queue.enqueueSyncAttempt(client, descriptor());
  await queue.claimSyncAttempt(client, attempt.id, { now }); // another worker holds the lease
  await assert.rejects(
    () => queue.runSyncAttempt(client, descriptor(), async () => ({ result: 'double delivery' }), { now }),
    /already in progress/,
  );
});

test('bookkeeping failure never replaces the real diagnosis', async () => {
  const client = db();
  // Dead-lettering writes a CRITICAL audit row, and a critical audit write throws when it fails.
  // If that throw escaped, the operator would be told "audit failed" and never learn WHY the upload
  // died — so the provider error must win and the bookkeeping failure ride along beside it.
  const original = client.from.bind(client);
  client.from = (table) => (table === 'diaspora_import_audit_log'
    ? { insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'audit store unavailable' } }) }) }) }
    : original(table));

  const boom = new DriveProviderError('the real problem', 'REVOKED', { retryable: false });
  await assert.rejects(
    () => queue.runSyncAttempt(client, descriptor(), async () => { throw boom; }, {
      now, jitter: noJitter, auditContext: { actorId: 'user-1' },
    }),
    (err) => {
      assert.equal(err.message, 'the real problem');
      assert.match(err.bookkeepingError, /audit store unavailable/);
      return true;
    },
  );
  client.from = original;
  // The durable state still landed — the queue row IS the primary record; the audit row is secondary.
  assert.equal(client._rows('diaspora_drive_sync_attempts')[0].state, 'dead_lettered');
});
