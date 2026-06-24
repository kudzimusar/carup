import assert from 'node:assert/strict';
import test from 'node:test';
import { logAuditEvent, normalizeTrustAuditEvent } from '../services/auditLogger.js';

// In-memory Supabase-ish stub. `memberships` seeds organization_users rows so the
// FK-safe legacy resolver can find a verified (user_id, organization_id) pair —
// a membership row guarantees both FKs (users(id) + organizations(id)) are valid.
function mockClient({ failTrustInsert = false, failLegacyInsert = false, memberships = [] } = {}) {
  const inserts = [];
  return {
    inserts,
    from(table) {
      const filters = {};
      const builder = {
        insert(payload) {
          inserts.push({ table, payload });
          const shouldFail = (table === 'trust_audit_events' && failTrustInsert) ||
            (table === 'organization_audit_logs' && failLegacyInsert);
          return Promise.resolve(shouldFail ? { error: { message: `${table} failed` } } : { error: null });
        },
        select() { return builder; },
        eq(col, val) { filters[col] = val; return builder; },
        maybeSingle() {
          if (table === 'organization_users') {
            const m = memberships.find(r =>
              (filters.user_id === undefined || r.user_id === filters.user_id) &&
              (filters.organization_id === undefined || r.organization_id === filters.organization_id));
            return Promise.resolve({ data: m ? { organization_id: m.organization_id } : null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        }
      };
      return builder;
    }
  };
}

const tick = () => new Promise((r) => setImmediate(r));
const legacyInserts = (c) => c.inserts.filter((e) => e.table === 'organization_audit_logs');
// Guard: the FK-violating sentinels must NEVER reach the database.
function assertNoFakeIdentity(client) {
  for (const e of legacyInserts(client)) {
    assert.notEqual(e.payload.user_id, 'system', 'must never insert fake user_id "system"');
    assert.notEqual(e.payload.organization_id, 'org_croco', 'must never insert fake organization_id "org_croco"');
  }
}

test('normalizes actor and request context into trust audit events', () => {
  const normalized = normalizeTrustAuditEvent({
    req: {
      requestId: 'req-test-123',
      ip: '127.0.0.1',
      headers: { 'user-agent': 'node-test' },
      userContext: { id: 'u5', role: 'government', tenantId: 'tenant-1' }
    },
    event_type: 'EVIDENCE_VERIFIED',
    vin: 'VIN123',
    targetType: 'evidence',
    targetId: 'ev-1'
  });

  assert.equal(normalized.event_type, 'EVIDENCE_VERIFIED');
  assert.equal(normalized.actor_user_id, 'u5');
  assert.equal(normalized.actor_role, 'government');
  assert.equal(normalized.actor_tenant_id, 'tenant-1');
  assert.equal(normalized.request_id, 'req-test-123');
  assert.deepEqual(normalized.evidence_ids, ['ev-1']);
});

test('writes central trust audit events and redacts sensitive JSON values', async () => {
  const client = mockClient();
  const result = await logAuditEvent(client, {
    event_type: 'PASSPORT_VERIFICATION_APPROVED',
    vin: 'VIN123',
    actor_user_id: 'u9',
    actor_role: 'admin',
    previous_value: { status: 'pending', api_key: 'secret-key' },
    new_value: { status: 'verified', nested: { password: 'secret' } }
  });

  assert.equal(result.success, true);
  const trustInsert = client.inserts.find(entry => entry.table === 'trust_audit_events');
  assert.ok(trustInsert);
  assert.equal(trustInsert.payload.event_type, 'PASSPORT_VERIFICATION_APPROVED');
  assert.equal(trustInsert.payload.previous_value.api_key, '[REDACTED]');
  assert.equal(trustInsert.payload.new_value.nested.password, '[REDACTED]');
});

// ── FK-safe legacy organization_audit_logs contract ─────────────────────────

test('valid user + valid (explicit) organization writes the legacy audit', async () => {
  // Primary fails so the legacy fallback path is awaited deterministically.
  const client = mockClient({ failTrustInsert: true, memberships: [{ user_id: 'u3', organization_id: 'org-1' }] });
  const result = await logAuditEvent(client, {
    organization_id: 'org-1',
    action: 'VERIFY_TEST_AUDIT',
    actorId: 'u3',
    actorRole: 'dealer',
    metadata: { token: 'secret-token', safeField: 'visible' }
  });

  assert.equal(result.success, true);
  assert.match(result.warning, /trust_audit_events failed/);
  const legacy = legacyInserts(client);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].payload.user_id, 'u3');
  assert.equal(legacy[0].payload.organization_id, 'org-1');
  const details = JSON.parse(legacy[0].payload.details);
  assert.equal(details.metadata.token, '[REDACTED]');
  assert.equal(details.metadata.safeField, 'visible');
  assertNoFakeIdentity(client);
});

test('valid user with a resolvable (membership) organization writes the legacy audit', async () => {
  const client = mockClient({ failTrustInsert: true, memberships: [{ user_id: 'u3', organization_id: 'org-resolved' }] });
  const result = await logAuditEvent(client, { action: 'X', actorId: 'u3', actorRole: 'owner' }); // no explicit org
  assert.equal(result.success, true);
  const legacy = legacyInserts(client);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].payload.organization_id, 'org-resolved');
  assert.equal(legacy[0].payload.user_id, 'u3');
  assertNoFakeIdentity(client);
});

test('system event without FK-backed identities skips the legacy write (no fake row)', async () => {
  const client = mockClient(); // no actor_user_id
  const result = await logAuditEvent(client, { event_type: 'SYSTEM_RECALC' });
  await tick();
  assert.equal(result.success, true); // primary trust audit still succeeds
  assert.equal(legacyInserts(client).length, 0); // NO organization_audit_logs insert attempted
  assertNoFakeIdentity(client);
});

test('unknown user (no membership) does not attempt an invalid legacy insertion', async () => {
  const client = mockClient({ memberships: [] }); // u-unknown is not a member of anything
  const result = await logAuditEvent(client, { event_type: 'E', actor_user_id: 'u-unknown' });
  await tick();
  assert.equal(result.success, true);
  assert.equal(legacyInserts(client).length, 0); // skipped — never inserts user_id that violates the FK
  assertNoFakeIdentity(client);
});

test('unknown organization does not attempt an invalid legacy insertion', async () => {
  // explicit org provided, but the user is not a member of it and has no other membership
  const client = mockClient({ memberships: [] });
  const result = await logAuditEvent(client, { event_type: 'E', actor_user_id: 'u3', organization_id: 'org-ghost' });
  await tick();
  assert.equal(result.success, true);
  assert.equal(legacyInserts(client).length, 0); // skipped — never inserts org_croco / an unverified org
  assertNoFakeIdentity(client);
});

test('primary trust audit still succeeds when the legacy write is skipped', async () => {
  const client = mockClient({ memberships: [] });
  const result = await logAuditEvent(client, { event_type: 'E', actor_user_id: 'u3' });
  await tick();
  assert.equal(result.success, true);
  const trustInsert = client.inserts.find((e) => e.table === 'trust_audit_events');
  assert.ok(trustInsert); // authoritative write happened
});

test('legacy write failure remains non-blocking on the success path', async () => {
  // Membership exists so the legacy insert is attempted; it fails, but the audit
  // call still reports success (the authoritative trust write succeeded).
  const client = mockClient({ failLegacyInsert: true, memberships: [{ user_id: 'u3', organization_id: 'org-1' }] });
  const result = await logAuditEvent(client, { event_type: 'E', actor_user_id: 'u3' });
  await tick();
  assert.equal(result.success, true);
  assert.equal(legacyInserts(client).length, 1); // attempted (and failed) — but non-blocking
});

test('no repeated hidden rejection: a skipped legacy write issues ZERO db inserts', async () => {
  // The previous bug inserted fake rows that the DB rejected with a 409 every call.
  // A clean skip must issue NO organization_audit_logs insert at all.
  const client = mockClient({ memberships: [] });
  for (let i = 0; i < 5; i++) {
    await logAuditEvent(client, { event_type: 'REPEAT', actor_user_id: 'u-unknown' });
    await tick();
  }
  assert.equal(legacyInserts(client).length, 0);
  assertNoFakeIdentity(client);
});

test('returns safe failure when both the primary and an attempted legacy write fail', async () => {
  // Membership present so the legacy fallback is actually attempted (then fails).
  const client = mockClient({ failTrustInsert: true, failLegacyInsert: true, memberships: [{ user_id: 'u7', organization_id: 'org-1' }] });
  const result = await logAuditEvent(client, { event_type: 'TEST_FAILURE', actor_user_id: 'u7' });
  assert.equal(result.success, false);
  assert.match(result.error, /trust_audit_events failed/);
  assert.match(result.fallbackError, /organization_audit_logs failed/);
});

test('primary failure + no FK-backed legacy identity reports the primary failure (not a fake success)', async () => {
  const client = mockClient({ failTrustInsert: true, memberships: [] });
  const result = await logAuditEvent(client, { event_type: 'TEST_FAILURE' }); // no actor → legacy skipped
  assert.equal(result.success, false);
  assert.match(result.error, /trust_audit_events failed/);
  assert.equal(result.legacySkipped, true);
  assert.equal(legacyInserts(client).length, 0);
});
