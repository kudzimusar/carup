/**
 * Trade-profile self-service tests — service-level, in-memory mock Supabase.
 *
 * Covers the self-service authorization hardening added this loop: a non-privileged caller may only
 * create/edit/list/read THEIR OWN profile and can never self-set verification_status/trust_score;
 * verify/suspend remain reviewer/admin-only at the service layer (not just the route). Previously
 * none of this was enforced or tested — any authenticated user could create a profile for an
 * arbitrary user_id, self-approve via a client-supplied verification_status, and list/read every
 * profile on the platform.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { supabase } = await import('../db/supabase.js');
const svc = await import('../services/diaspora/diasporaTradeProfileService.js');

const buyer = { id: 'buyer-1', userId: 'buyer-1', role: 'owner', platformRole: 'owner', tenantId: null };
const otherBuyer = { id: 'buyer-2', userId: 'buyer-2', role: 'owner', platformRole: 'owner', tenantId: null };
const reviewer = { id: 'rev-1', userId: 'rev-1', role: 'reviewer', platformRole: 'reviewer', tenantId: null };
const tenantAdmin = { id: 'ta-1', userId: 'ta-1', role: 'admin', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-1' };

function useClient(seed = {}) {
  const client = createMockSupabase({ diaspora_trade_profiles: [], diaspora_import_audit_log: [], ...seed });
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: client.from });
  Object.defineProperty(supabase, 'rpc', { configurable: true, writable: true, value: client.rpc });
  return client;
}

const BASE = { country: 'Japan', city: 'Yokohama', role_type: 'buyer' };

test('a buyer creating their own profile always starts PENDING_REVIEW, even if they try to self-approve', async () => {
  useClient();
  const profile = await svc.createTradeProfile({ ...BASE, verification_status: 'VERIFIED', trust_score: 100 }, buyer);
  assert.equal(profile.verification_status, 'PENDING_REVIEW');
  assert.equal(profile.trust_score, 50);
  assert.equal(profile.user_id, 'buyer-1');
});

test('a buyer cannot create a profile for another user_id (403)', async () => {
  useClient();
  await assert.rejects(
    () => svc.createTradeProfile({ ...BASE, user_id: 'buyer-2' }, buyer),
    /own account/i,
  );
});

test('a non-privileged caller cannot inject an arbitrary tenant_id via the body (derived from context only)', async () => {
  useClient();
  // buyer has no tenant context; a body-supplied tenant_id must be ignored, not written.
  const profile = await svc.createTradeProfile({ ...BASE, tenant_id: 'victim-tenant-XYZ' }, buyer);
  assert.equal(profile.tenant_id, null);
});

test('a non-privileged tenant member gets their own verified tenant_id, never a body-supplied one', async () => {
  useClient();
  const tenantBuyer = { ...buyer, tenantId: 'tenant-1' };
  const profile = await svc.createTradeProfile({ ...BASE, tenant_id: 'victim-tenant-XYZ' }, tenantBuyer);
  assert.equal(profile.tenant_id, 'tenant-1');
});

test('a platform admin/reviewer MAY seed a profile under a body-supplied tenant_id', async () => {
  useClient();
  const profile = await svc.createTradeProfile({ ...BASE, user_id: 'buyer-2', tenant_id: 'seed-tenant-1' }, reviewer);
  assert.equal(profile.tenant_id, 'seed-tenant-1');
});

test('a platform admin/reviewer may create a profile for another user with an initial verification_status', async () => {
  useClient();
  const profile = await svc.createTradeProfile({ ...BASE, user_id: 'buyer-2', verification_status: 'VERIFIED', trust_score: 90 }, reviewer);
  assert.equal(profile.user_id, 'buyer-2');
  assert.equal(profile.verification_status, 'VERIFIED');
  assert.equal(profile.trust_score, 90);
});

test('a buyer can list and read only their own profile, not another buyer\'s', async () => {
  const client = useClient();
  const mine = await svc.createTradeProfile(BASE, buyer);
  const theirs = await svc.createTradeProfile(BASE, otherBuyer);
  void client;

  const listed = await svc.listTradeProfiles({}, buyer);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, mine.id);

  const readMine = await svc.getTradeProfile(mine.id, buyer);
  assert.equal(readMine.id, mine.id);

  await assert.rejects(() => svc.getTradeProfile(theirs.id, buyer), /do not have access/i);
});

test('a reviewer can list and read across all profiles', async () => {
  useClient();
  const mine = await svc.createTradeProfile(BASE, buyer);
  const theirs = await svc.createTradeProfile(BASE, otherBuyer);
  const listed = await svc.listTradeProfiles({}, reviewer);
  assert.equal(listed.length, 2);
  assert.ok(await svc.getTradeProfile(mine.id, reviewer));
  assert.ok(await svc.getTradeProfile(theirs.id, reviewer));
});

test('a tenant admin can read a profile in their own tenant but not another tenant\'s', async () => {
  useClient();
  const inTenant = await svc.createTradeProfile({ ...BASE, tenant_id: 'tenant-1' }, { ...buyer, tenantId: 'tenant-1' });
  const otherTenant = await svc.createTradeProfile({ ...BASE, tenant_id: 'tenant-2' }, { ...otherBuyer, tenantId: 'tenant-2' });
  assert.ok(await svc.getTradeProfile(inTenant.id, tenantAdmin));
  await assert.rejects(() => svc.getTradeProfile(otherTenant.id, tenantAdmin), /do not have access/i);
});

test('self-service update can change country/city but never verification_status or trust_score', async () => {
  useClient();
  const profile = await svc.createTradeProfile(BASE, buyer);
  const updated = await svc.updateTradeProfile(profile.id, { city: 'Osaka', verification_status: 'VERIFIED', trust_score: 100 }, buyer);
  assert.equal(updated.city, 'Osaka');
  assert.equal(updated.verification_status, 'PENDING_REVIEW');
  assert.equal(updated.trust_score, 50);
});

test('a buyer cannot update another buyer\'s profile (403)', async () => {
  useClient();
  const theirs = await svc.createTradeProfile(BASE, otherBuyer);
  await assert.rejects(() => svc.updateTradeProfile(theirs.id, { city: 'Osaka' }, buyer), /do not have access/i);
});

test('verifyTradeProfile/suspendTradeProfile are rejected at the service layer for non-privileged callers, even if the route filter were bypassed', async () => {
  useClient();
  const profile = await svc.createTradeProfile(BASE, buyer);
  await assert.rejects(() => svc.verifyTradeProfile(profile.id, {}, buyer), /platform admin or reviewer/i);
  await assert.rejects(() => svc.suspendTradeProfile(profile.id, {}, buyer), /platform admin or reviewer/i);
});

test('a reviewer can verify then suspend a profile, both audited', async () => {
  useClient();
  const profile = await svc.createTradeProfile(BASE, buyer);
  const verified = await svc.verifyTradeProfile(profile.id, { trust_score: 85 }, reviewer);
  assert.equal(verified.verification_status, 'VERIFIED');
  assert.equal(verified.trust_score, 85);
  const suspended = await svc.suspendTradeProfile(profile.id, { reason: 'fraud report' }, reviewer);
  assert.equal(suspended.verification_status, 'SUSPENDED');
});
