import assert from 'node:assert/strict';
import test from 'node:test';
import { logAuditEvent, normalizeTrustAuditEvent } from '../services/auditLogger.js';

function mockClient({ failTrustInsert = false, failLegacyInsert = false } = {}) {
  const inserts = [];
  return {
    inserts,
    from(table) {
      return {
        insert(payload) {
          inserts.push({ table, payload });
          const shouldFail = (table === 'trust_audit_events' && failTrustInsert) ||
            (table === 'organization_audit_logs' && failLegacyInsert);
          return Promise.resolve(shouldFail ? { error: { message: `${table} failed` } } : { error: null });
        },
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        }
      };
    }
  };
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

test('falls back to legacy organization audit when trust audit insert fails', async () => {
  const client = mockClient({ failTrustInsert: true });
  const result = await logAuditEvent(client, {
    action: 'VERIFY_TEST_AUDIT',
    actorId: 'u3',
    actorRole: 'dealer',
    metadata: { token: 'secret-token', safeField: 'visible' }
  });

  assert.equal(result.success, true);
  assert.match(result.warning, /trust_audit_events failed/);
  const legacyInsert = client.inserts.find(entry => entry.table === 'organization_audit_logs');
  assert.ok(legacyInsert);
  const details = JSON.parse(legacyInsert.payload.details);
  assert.equal(details.metadata.token, '[REDACTED]');
  assert.equal(details.metadata.safeField, 'visible');
});

test('returns safe failure when all audit writes fail', async () => {
  const client = mockClient({ failTrustInsert: true, failLegacyInsert: true });
  const result = await logAuditEvent(client, { event_type: 'TEST_FAILURE' });

  assert.equal(result.success, false);
  assert.match(result.error, /trust_audit_events failed/);
  assert.match(result.fallbackError, /organization_audit_logs failed/);
});
