/**
 * O2/P3 — People & Compliance aggregate + extended capability policy tests.
 *
 * Pinned rules: the three O2 capabilities derive from the SERVER-derived platform/base role and
 * refuse the x-user-id fallback exactly like M5's; the aggregate is a READ MODEL that keeps the
 * separate concepts separate (no "verified seller" boolean anywhere), projects who-must-act
 * through the DOMAIN-owned mappings, and leaks no identity artifact, no OCR payload, no audit
 * ip/user_agent and no reviewer user id.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const authz = await import('../services/operations/operationsAuthorizationService.js');
const { buildPersonComplianceReview } = await import('../services/operations/peopleComplianceReadModel.js');
const { OPERATIONS_CAPABILITIES } = authz;

const PERSON = 'u_seller_1';

// ---------------------------------------------------------------------------
// Capability policy — the O2 extensions obey every M5 rule
// ---------------------------------------------------------------------------

test('O2 capabilities derive from platform/base role only, like the M5 set', () => {
  for (const role of ['admin', 'platform_admin', 'super_admin', 'government']) {
    const ctx = { id: 'u1', role, baseRole: role, platformRole: null };
    assert.equal(authz.hasOperationsCapability(ctx, OPERATIONS_CAPABILITIES.PERSON_READ_PRIVATE), true, role);
    assert.equal(authz.hasOperationsCapability(ctx, OPERATIONS_CAPABILITIES.IDENTITY_REVIEW), true, role);
    assert.equal(authz.hasOperationsCapability(ctx, OPERATIONS_CAPABILITIES.DEALER_COMPLIANCE_REVIEW), true, role);
  }
  for (const role of ['owner', 'dealer', 'mechanic', 'insurance', 'bank']) {
    const ctx = { id: 'u1', role, baseRole: role, platformRole: null };
    assert.equal(authz.hasOperationsCapability(ctx, OPERATIONS_CAPABILITIES.PERSON_READ_PRIVATE), false, role);
  }
});

test('a tenant admin is NOT CarUp Operations: tenant/effective role never grants a People capability', () => {
  const smuggled = { id: 'u1', role: 'admin', effectiveRole: 'admin', tenantRole: 'admin', baseRole: 'dealer', platformRole: null };
  assert.equal(authz.hasOperationsCapability(smuggled, OPERATIONS_CAPABILITIES.PERSON_READ_PRIVATE), false);
  assert.equal(authz.hasOperationsCapability(smuggled, OPERATIONS_CAPABILITIES.IDENTITY_REVIEW), false);
  assert.equal(authz.hasOperationsCapability(smuggled, OPERATIONS_CAPABILITIES.DEALER_COMPLIANCE_REVIEW), false);
});

test('allowedPeopleOperationsActions is server-derived and never includes a bulk or identity-fact action', () => {
  const reviewer = { id: 'u1', role: 'admin', baseRole: 'admin', platformRole: 'admin' };
  const actions = authz.allowedPeopleOperationsActions(reviewer);
  assert.deepEqual([...actions].sort(), ['dealer_compliance.decide', 'identity.review', 'seller_authority.review']);
  for (const forbidden of ['person.verify', 'person.edit', 'identity.force_approve', 'approve_everything']) {
    assert.equal(actions.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(authz.allowedPeopleOperationsActions({ id: 'u2', role: 'owner', baseRole: 'owner' }), []);
});

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

function reviewClient(overrides = {}) {
  const tables = {
    users: [{
      id: PERSON, name: 'Sample Seller', email: 'seller@example.test', role: 'owner',
      is_verified: true, join_date: '2026-08-01', created_at: '2026-08-01T00:00:00Z',
      password_hash: 'scrypt:SHOULD-NEVER-LEAK', phone: '+263000000',
    }],
    tenant_users: [],
    verification_sessions: [{
      id: 'vs-1', user_id: PERSON, status: 'pending_review', workflow_phase: 'reviewer_action_required',
      final_disposition: 'none', primary_reason_code: null, review_decision: null, retry_reason: null,
      created_at: '2026-09-01T10:00:00Z', submitted_at: '2026-09-01T10:05:00Z', reviewed_at: null,
      // Fields that must NEVER surface through the aggregate:
      front_image_path: 'identity/SHOULD-NEVER-LEAK-front.jpg',
      ocr_payload: { raw: 'ID 63-123456A78' },
      internal_notes: 'reviewer scratchpad SHOULD-NEVER-LEAK',
    }],
    vehicle_seller_authority: [{
      vin: 'VIN-A', seller_user_id: PERSON, claim_type: 'owner', status: 'confirmed',
      basis: 'existing_relationship', reason: 'governed review', policy_version: 'seller_authority.v1',
      decided_by: 'u_reviewer_SHOULD-NEVER-LEAK', decided_by_role: 'admin',
      decided_at: '2026-09-02T00:00:00Z', created_at: '2026-09-01T00:00:00Z',
    }, {
      vin: 'VIN-B', seller_user_id: PERSON, claim_type: 'owner', status: 'insufficient',
      basis: null, reason: 'invoice alone is insufficient', policy_version: 'seller_authority.v1',
      decided_by: 'u_reviewer_SHOULD-NEVER-LEAK', decided_by_role: 'government',
      decided_at: '2026-09-02T01:00:00Z', created_at: '2026-09-01T01:00:00Z',
    }],
    vehicles: [{ vin: 'VIN-A', owner_id: PERSON, publication_status: 'published', make: 'Toyota', model: 'Hilux', year: 2019 }],
    vehicle_ownership_transfers: [{
      id: 'tr-1', vin: 'VIN-OLD', state: 'registry_pending', previous_owner_id: PERSON, incoming_owner_id: 'u_other',
      registry_authority: null, completed_at: null, created_at: '2026-09-02T02:00:00Z',
    }],
    dealer_profiles: [],
    dealer_compliance_requirements: [],
    trust_audit_events: [{
      id: 'a1', event_type: 'SELLER_AUTHORITY_REVIEWED', actor_role: 'admin',
      actor_user_id: 'u_reviewer_SHOULD-NEVER-LEAK', reason: 'governed review',
      created_at: '2026-09-02T00:00:01Z', target_type: 'vehicle_seller_authority', target_id: `VIN-A:${PERSON}`,
      ip_address: '10.0.0.1', user_agent: 'Mozilla SHOULD-NEVER-LEAK',
    }],
    ...overrides,
  };
  return {
    from(table) {
      const state = { filters: [] };
      const rowsFor = () => (tables[table] || []).filter((r) => state.filters.every(([k, v]) => r[k] === v));
      const chain = {
        select() { return chain; },
        eq(k, v) { state.filters.push([k, v]); return chain; },
        order() { return chain; },
        limit() { return chain; },
        maybeSingle() { return Promise.resolve({ data: rowsFor()[0] ?? null, error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: rowsFor(), error: null }).then(resolve, reject); },
      };
      return chain;
    },
  };
}

const REVIEWER_CTX = { id: 'u_reviewer', role: 'admin', baseRole: 'admin', platformRole: 'admin', authenticationMethod: 'session' };

test('the aggregate keeps the separate concepts separate — and never mints a combined boolean', async () => {
  const review = await buildPersonComplianceReview(reviewClient(), { userId: PERSON, userContext: REVIEWER_CTX });

  // Four distinct facts, four distinct places:
  assert.equal(review.person.email_verified, true, 'email verification is an account-email fact');
  assert.equal(review.identity.latest.workflow_phase, 'reviewer_action_required', 'identity has its own state');
  assert.equal(review.seller_authority.records.find((r) => r.vin === 'VIN-A').status, 'confirmed', 'authority is per vehicle');
  assert.equal(review.ownership.vehicles_owned[0].vin, 'VIN-A', 'ownership is canonical, not a badge');

  // No collapsed "verified seller" anywhere in the DTO.
  const serialized = JSON.stringify(review);
  assert.doesNotMatch(serialized, /verified_seller|seller_verified|fully_verified|is_trusted/i);
});

test('who-must-act is projected through the DOMAIN-owned mappings, in the ADR vocabulary', async () => {
  const review = await buildPersonComplianceReview(reviewClient(), { userId: PERSON, userContext: REVIEWER_CTX });
  assert.equal(review.identity.who_must_act, 'carup_review');
  assert.equal(review.seller_authority.records.find((r) => r.vin === 'VIN-A').who_must_act, 'none');
  assert.equal(review.seller_authority.records.find((r) => r.vin === 'VIN-B').who_must_act, 'subject_action');
  assert.equal(review.ownership.transfers[0].who_must_act, 'external_authority', 'a registry wait is never a CarUp queue');
});

test('privacy: no identity artifact, OCR payload, internal note, reviewer user id, credential or audit ip/user_agent leaves the aggregate', async () => {
  const review = await buildPersonComplianceReview(reviewClient(), { userId: PERSON, userContext: REVIEWER_CTX });
  const serialized = JSON.stringify(review);
  assert.doesNotMatch(serialized, /SHOULD-NEVER-LEAK/, 'a quarantined value escaped the aggregate');
  assert.doesNotMatch(serialized, /front_image|image_path|ocr_payload|internal_notes|password_hash|ip_address|user_agent/);
  // Audit shows the deciding ROLE, never the reviewer's user id.
  assert.equal(review.audit[0].actor_role, 'admin');
  assert.equal('actor_user_id' in review.audit[0], false);
  // Authority rows show decided_by_role, never decided_by.
  assert.equal('decided_by' in review.seller_authority.records[0], false);
});

test('a person who is not a dealer reports is_dealer=false rather than an invented compliance state', async () => {
  const review = await buildPersonComplianceReview(reviewClient(), { userId: PERSON, userContext: REVIEWER_CTX });
  assert.deepEqual(review.dealer_compliance, { is_dealer: false });
});

test('a dealer profile projects through the dealer domain mapping with its own statuses VERBATIM', async () => {
  const review = await buildPersonComplianceReview(reviewClient({
    dealer_profiles: [{
      id: 'dp-1', user_id: PERSON, suspension_state: 'suspended', restriction_state: 'none',
      compliance_review_state: 'passed', identity_status: 'verified', expiry_date: null,
    }],
  }), { userId: PERSON, userContext: REVIEWER_CTX });
  assert.equal(review.dealer_compliance.is_dealer, true);
  assert.equal(review.dealer_compliance.profile.suspension_state, 'suspended', 'the domain status is displayed, not replaced');
  assert.equal(review.dealer_compliance.who_must_act, 'subject_action', 'remediation is the dealer\'s');
});

test('allowed_actions come from the server capability policy — an unauthorized context gets none', async () => {
  const reviewer = await buildPersonComplianceReview(reviewClient(), { userId: PERSON, userContext: REVIEWER_CTX });
  assert.deepEqual([...reviewer.allowed_actions].sort(), ['dealer_compliance.decide', 'identity.review', 'seller_authority.review']);
  const nobody = await buildPersonComplianceReview(reviewClient(), { userId: PERSON, userContext: { id: 'u2', role: 'owner', baseRole: 'owner' } });
  assert.deepEqual(nobody.allowed_actions, []);
});

test('an unknown person is a 404, not an empty aggregate', async () => {
  await assert.rejects(
    buildPersonComplianceReview(reviewClient(), { userId: 'u_missing', userContext: REVIEWER_CTX }),
    (err) => err.status === 404,
  );
});
