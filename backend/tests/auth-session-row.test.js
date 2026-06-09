/**
 * Unit tests for buildSessionRow — the root-cause fix for the Diaspora buyer login loop.
 *
 * Production user_sessions has legacy NOT NULL columns (id, active_role, created_at) with no DB
 * default. The login/register/switch-role inserts used to omit them, so the insert failed, the
 * session was never persisted, and the returned token 401'd on the next request. buildSessionRow
 * guarantees those columns are always populated.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionRow } from '../services/auth/sessionRow.js';

test('populates the legacy NOT NULL columns (id, active_role, created_at) and the token columns', () => {
  const row = buildSessionRow({
    userId: 'u1',
    activeRole: 'owner',
    token: 'sk_live_abc',
    expiresAt: '2026-06-10T00:00:00.000Z',
    req: { ip: '1.2.3.4', headers: { 'user-agent': 'UA/1.0' } },
  });

  // The columns that previously caused the NOT NULL violation must be present and non-null.
  for (const key of ['id', 'user_id', 'active_role', 'created_at', 'expires_at', 'token', 'is_valid']) {
    assert.ok(row[key] !== undefined && row[key] !== null, `${key} must be present and non-null`);
  }

  assert.equal(row.user_id, 'u1');
  assert.equal(row.active_role, 'owner');
  assert.equal(row.token, 'sk_live_abc');
  assert.equal(row.expires_at, '2026-06-10T00:00:00.000Z');
  assert.equal(row.is_valid, true);
  assert.equal(row.ip_address, '1.2.3.4');
  assert.equal(row.user_agent, 'UA/1.0');
  assert.equal(typeof row.id, 'string');
  assert.ok(row.id.length > 0);
  assert.equal(typeof row.created_at, 'string');
});

test('generates a unique id per call', () => {
  const a = buildSessionRow({ userId: 'u1', activeRole: 'owner', token: 't1', expiresAt: 'x' });
  const b = buildSessionRow({ userId: 'u1', activeRole: 'owner', token: 't2', expiresAt: 'x' });
  assert.notEqual(a.id, b.id);
});

test('maps tenantId to active_organization_id and defaults ip/user_agent when no req', () => {
  const row = buildSessionRow({ userId: 'u1', activeRole: 'admin', token: 't', expiresAt: 'x', tenantId: 'tenant-9' });
  assert.equal(row.active_organization_id, 'tenant-9');
  assert.equal(row.ip_address, '127.0.0.1');
  assert.equal(row.user_agent, null);
});

test('defaults active_organization_id to null when no tenant', () => {
  const row = buildSessionRow({ userId: 'u1', activeRole: 'owner', token: 't', expiresAt: 'x' });
  assert.equal(row.active_organization_id, null);
});
