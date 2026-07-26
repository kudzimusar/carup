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

// ---------------------------------------------------------------------------
// Phase 8-10 refinements: /me listing, submit-for-review, duplicate rule,
// optimistic concurrency, metadata sanitization, suspension reason.
// ---------------------------------------------------------------------------

test('getOwnTradeProfiles returns only the caller\'s own profiles, even for a privileged reviewer', async () => {
  useClient();
  const mine = await svc.createTradeProfile(BASE, buyer);
  await svc.createTradeProfile(BASE, otherBuyer);
  const reviewerOwn = await svc.createTradeProfile({ ...BASE, role_type: 'agent' }, reviewer);

  const buyerProfiles = await svc.getOwnTradeProfiles(buyer);
  assert.equal(buyerProfiles.length, 1);
  assert.equal(buyerProfiles[0].id, mine.id);

  // Privilege does not widen /me — a reviewer's own list is still just their own profiles.
  const reviewerProfiles = await svc.getOwnTradeProfiles(reviewer);
  assert.equal(reviewerProfiles.length, 1);
  assert.equal(reviewerProfiles[0].id, reviewerOwn.id);
});

test('submitTradeProfileForReview: owner resubmits a REJECTED profile — PENDING_REVIEW, server-stamped, metadata preserved, audited', async () => {
  const client = useClient();
  const rejected = await svc.createTradeProfile(
    { ...BASE, user_id: 'buyer-1', verification_status: 'REJECTED', metadata: { businessName: 'Legit Trading' } },
    reviewer,
  );
  const resubmitted = await svc.submitTradeProfileForReview(rejected.id, {}, buyer);
  assert.equal(resubmitted.verification_status, 'PENDING_REVIEW');
  assert.ok(resubmitted.metadata.reviewRequestedAt, 'reviewRequestedAt must be stamped by the server');
  assert.ok(!Number.isNaN(new Date(resubmitted.metadata.reviewRequestedAt).getTime()));
  assert.equal(resubmitted.metadata.businessName, 'Legit Trading', 'other metadata must be preserved');
  const audits = client._rows('diaspora_import_audit_log').filter((a) => a.action === 'TRADE_PROFILE_REVIEW_REQUESTED');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].resource_id, rejected.id);
});

test('submitTradeProfileForReview fails closed on SUSPENDED (403) and rejects VERIFIED (400)', async () => {
  useClient();
  const suspended = await svc.createTradeProfile({ ...BASE, user_id: 'buyer-1', verification_status: 'SUSPENDED' }, reviewer);
  await assert.rejects(() => svc.submitTradeProfileForReview(suspended.id, {}, buyer), (err) => {
    assert.equal(err.statusCode, 403);
    assert.match(err.message, /suspended/i);
    return true;
  });

  const verified = await svc.createTradeProfile({ ...BASE, role_type: 'seller', user_id: 'buyer-1', verification_status: 'VERIFIED' }, reviewer);
  await assert.rejects(() => svc.submitTradeProfileForReview(verified.id, {}, buyer), (err) => {
    assert.equal(err.statusCode, 400);
    assert.match(err.message, /already verified/i);
    return true;
  });
});

test('a non-owner cannot submit someone else\'s profile for review', async () => {
  useClient();
  const rejected = await svc.createTradeProfile({ ...BASE, user_id: 'buyer-1', verification_status: 'REJECTED' }, reviewer);
  await assert.rejects(() => svc.submitTradeProfileForReview(rejected.id, {}, otherBuyer), /profile owner/i);
});

test('a duplicate (user, role, country) profile is rejected by the pre-check with DUPLICATE_TRADE_PROFILE', async () => {
  useClient();
  await svc.createTradeProfile(BASE, buyer);
  await assert.rejects(() => svc.createTradeProfile({ ...BASE, city: 'Nagoya' }, buyer), (err) => {
    assert.equal(err.code, 'DUPLICATE_TRADE_PROFILE');
    assert.equal(err.statusCode, 400);
    assert.match(err.message, /already exists/i);
    return true;
  });
  // A different country (or role) is NOT a duplicate.
  const other = await svc.createTradeProfile({ ...BASE, country: 'United Kingdom' }, buyer);
  assert.equal(other.country, 'United Kingdom');
});

test('a raced DB unique-violation (23505) is translated to the same friendly DUPLICATE_TRADE_PROFILE error', async () => {
  const client = useClient();
  const realFrom = client.from;
  // Simulate the race: the pre-check sees no duplicate (table is empty), but the INSERT hits the
  // DB unique constraint because a concurrent request won.
  Object.defineProperty(supabase, 'from', {
    configurable: true,
    writable: true,
    value: (table) => {
      const chain = realFrom(table);
      if (table === 'diaspora_trade_profiles') {
        chain.insert = () => ({
          select() { return this; },
          single() { return this; },
          then(resolve, reject) {
            return Promise.resolve({
              data: null,
              error: { message: 'duplicate key value violates unique constraint "diaspora_trade_profiles_user_id_role_type_country_key"', code: '23505' },
            }).then(resolve, reject);
          },
        });
      }
      return chain;
    },
  });
  await assert.rejects(() => svc.createTradeProfile(BASE, buyer), (err) => {
    assert.equal(err.code, 'DUPLICATE_TRADE_PROFILE');
    assert.equal(err.statusCode, 400);
    return true;
  });
});

test('updateTradeProfile optimistic concurrency: stale expected_updated_at rejected with PROFILE_STALE, matching value accepted', async () => {
  useClient();
  const profile = await svc.createTradeProfile(BASE, buyer);
  const first = await svc.updateTradeProfile(profile.id, { city: 'Osaka' }, buyer);
  assert.ok(first.updated_at);

  await assert.rejects(
    () => svc.updateTradeProfile(profile.id, { city: 'Kobe', expected_updated_at: new Date(2020, 0, 1).toISOString() }, buyer),
    (err) => {
      assert.equal(err.code, 'PROFILE_STALE');
      assert.equal(err.statusCode, 400);
      return true;
    },
  );

  const second = await svc.updateTradeProfile(profile.id, { city: 'Kobe', expected_updated_at: first.updated_at }, buyer);
  assert.equal(second.city, 'Kobe');
  assert.equal(second.expected_updated_at, undefined, 'expected_updated_at is a check, never a written column');
});

test('privilege-bearing metadata keys are stripped for a buyer on create AND update, but kept for a reviewer', async () => {
  useClient();
  const dirty = {
    verification: { forged: true },
    suspension: { forged: true },
    reviewRequestedAt: '2020-01-01T00:00:00.000Z',
    businessName: 'Legit Trading',
  };
  const created = await svc.createTradeProfile({ ...BASE, metadata: dirty }, buyer);
  assert.equal(created.metadata.verification, undefined);
  assert.equal(created.metadata.suspension, undefined);
  assert.equal(created.metadata.reviewRequestedAt, undefined);
  assert.equal(created.metadata.businessName, 'Legit Trading');

  const updated = await svc.updateTradeProfile(created.id, { metadata: dirty }, buyer);
  assert.equal(updated.metadata.verification, undefined);
  assert.equal(updated.metadata.suspension, undefined);
  assert.equal(updated.metadata.reviewRequestedAt, undefined);
  assert.equal(updated.metadata.businessName, 'Legit Trading');

  const seeded = await svc.createTradeProfile({ ...BASE, user_id: 'buyer-2', metadata: { verification: { approvedBy: 'rev-1' } } }, reviewer);
  assert.deepEqual(seeded.metadata.verification, { approvedBy: 'rev-1' });
});

test('suspendTradeProfile requires a non-empty reason; with a reason it suspends and records it', async () => {
  useClient();
  const profile = await svc.createTradeProfile(BASE, buyer);
  await assert.rejects(() => svc.suspendTradeProfile(profile.id, {}, reviewer), /reason is required/i);
  await assert.rejects(() => svc.suspendTradeProfile(profile.id, { reason: '   ' }, reviewer), /reason is required/i);
  const suspended = await svc.suspendTradeProfile(profile.id, { reason: 'documents forged' }, reviewer);
  assert.equal(suspended.verification_status, 'SUSPENDED');
  assert.equal(suspended.metadata.suspension.reason, 'documents forged');
});
