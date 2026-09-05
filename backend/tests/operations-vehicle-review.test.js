/**
 * Operations Control Plane M4/M5 — Vehicle Operations aggregate + bounded
 * capability policy tests.
 *
 * Pinned rules: capabilities derive from the SERVER-derived platform/base role
 * (a client-steered effective role or tenant role can never escalate); the
 * x-user-id fallback identity is refused; the aggregate is a read model that
 * leaks no storage locator, no seller PII beyond the task, and no audit
 * ip/user_agent; allowed_actions are server-derived and contain no trust
 * mutation, no ZIMRA/CVR action and no admin publish.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const authz = await import('../services/operations/operationsAuthorizationService.js');
const { buildVehicleOperationsReview } = await import('../services/operations/vehicleOperationsReadModel.js');

const { OPERATIONS_CAPABILITIES } = authz;
const VIN = 'GFC27-027051';
const SELLER = 'u_66cace85fad949e4';

// ---------------------------------------------------------------------------
// Capability policy
// ---------------------------------------------------------------------------

test('capabilities derive from platform/base role — admin, platform_admin, super_admin, government', () => {
  for (const role of ['admin', 'platform_admin', 'super_admin', 'government']) {
    const ctx = { id: 'u1', role, baseRole: role, platformRole: ['admin', 'platform_admin', 'super_admin'].includes(role) ? role : null };
    assert.equal(authz.hasOperationsCapability(ctx, OPERATIONS_CAPABILITIES.VEHICLE_READ_PRIVATE), true, role);
    assert.equal(authz.hasOperationsCapability(ctx, OPERATIONS_CAPABILITIES.SELLER_AUTHORITY_REVIEW), true, role);
  }
  for (const role of ['owner', 'dealer', 'mechanic', 'insurance', 'bank', 'reviewer']) {
    const ctx = { id: 'u1', role, baseRole: role, platformRole: null };
    assert.equal(authz.capabilitiesForContext(ctx).length, 0, `${role} holds no operations capability`);
  }
});

test('a client-steered effective role can NEVER escalate to operations capability', () => {
  // The x-stakeholder-role header steers effectiveRole within tenant bounds;
  // the grant must come from the server-derived identity only.
  const smuggled = { id: 'u1', role: 'admin', effectiveRole: 'admin', baseRole: 'dealer', platformRole: null, tenantRole: 'admin' };
  assert.equal(authz.capabilitiesForContext(smuggled).length, 0);
  assert.equal(authz.hasOperationsCapability(smuggled, OPERATIONS_CAPABILITIES.VEHICLE_READ_PRIVATE), false);
});

test('the x-user-id fallback identity is not a proven session', () => {
  assert.equal(authz.isProvenSession({ id: 'u1', authenticationMethod: 'session' }), true);
  assert.equal(authz.isProvenSession({ id: 'u1', authenticationMethod: 'x-user-id-fallback' }), false);
  assert.equal(authz.isProvenSession({}), false);
});

function invokeMiddleware(middleware, userContext) {
  return new Promise((resolve) => {
    const req = { userContext };
    const res = {
      statusCode: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ statusCode: this.statusCode, body }); return this; },
    };
    middleware(req, res, () => resolve({ statusCode: 200, body: { passed: true } }));
  });
}

test('requireOperationsCapability middleware: grants, refuses, and demands proven sessions', async () => {
  const middleware = authz.requireOperationsCapability(OPERATIONS_CAPABILITIES.VEHICLE_READ_PRIVATE);

  const granted = await invokeMiddleware(middleware, { id: 'u1', baseRole: 'admin', authenticationMethod: 'session' });
  assert.equal(granted.body.passed, true);

  const fallback = await invokeMiddleware(middleware, { id: 'u1', baseRole: 'admin', authenticationMethod: 'x-user-id-fallback' });
  assert.equal(fallback.statusCode, 403);
  assert.equal(fallback.body.code, 'OPERATIONS_PROVEN_SESSION_REQUIRED');

  const wrongRole = await invokeMiddleware(middleware, { id: 'u1', baseRole: 'dealer', authenticationMethod: 'session' });
  assert.equal(wrongRole.statusCode, 403);
  assert.equal(wrongRole.body.code, 'OPERATIONS_CAPABILITY_REQUIRED');

  const anonymous = await invokeMiddleware(middleware, undefined);
  assert.equal(anonymous.statusCode, 401);
});

test('allowed actions contain no trust mutation, no government-fact action, no admin publish', () => {
  const actions = authz.allowedVehicleOperationsActions({ id: 'u1', baseRole: 'admin' });
  assert.ok(actions.includes('evidence.verify'));
  assert.ok(actions.includes('evidence.correct_classification'));
  assert.ok(actions.includes('seller_authority.review'));
  const joined = actions.join(' ');
  assert.doesNotMatch(joined, /trust\.set|trust\.score|zimra|cvr|publish/i);
  assert.deepEqual(authz.allowedVehicleOperationsActions({ id: 'u2', baseRole: 'owner' }), []);
});

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

const SERENA_VEHICLE = {
  vin: VIN, make: 'Nissan', model: 'Serena Highway Star', year: 2016,
  status: 'Available', publication_status: 'draft',
  chassis_number: VIN, engine_number: 'MR20961177B',
  plate_number: null, temp_plate_id: null,
  registration_status: null, registration_status_source: null,
  registration_country: null, registration_authority: null,
  owner_id: SELLER, current_seller_id: SELLER, current_seller_type: 'Private Owner',
  tenant_id: null, import_source: 'import', duty_paid: false,
  zimra_verified: false, passport_verified: false,
  trust_score: null, trust_band: null, trust_confidence: null,
  trust_calculation_version: null, trust_evaluated_at: null,
  price: 12800, currency: 'USD', listing_city: 'Harare', listing_province: null,
  created_at: '2026-09-01T09:48:38Z',
  normalized_plate_number: null,
};

const SERENA_EVIDENCE = [
  {
    id: 'ev-inv', vin: VIN, evidence_type: 'registration_document',
    evidence_class: 'import', evidence_subtype: 'commercial_invoice',
    verification_status: 'pending', visibility_level: 'private',
    uploaded_by: SELLER, uploader_role: 'owner', source_id: null, source_name: null,
    checksum: 'abc123', event_date: '2026-03-07', event_date_precision: 'day',
    capture_country: null, uploaded_at: '2026-09-02T11:34:08Z', verified_by: null, verified_at: null,
    mime_type: 'application/pdf',
    file_url: 'https://SHOULD-NEVER-LEAK.example/x.pdf', file_path: `${VIN}/x.pdf`, storage_bucket: 'ocr-documents',
    metadata: { ai_analysis: { ai_status: 'ai_pending' } },
  },
  {
    id: 'ev-t1', vin: VIN, evidence_type: 'registration_document',
    evidence_class: 'import', evidence_subtype: 'transit_declaration',
    verification_status: 'pending', visibility_level: 'public_safe',
    uploaded_by: SELLER, uploader_role: 'owner', source_id: null, source_name: null,
    checksum: 'def456', event_date: '2026-04-06', event_date_precision: 'day',
    capture_country: null, uploaded_at: '2026-09-02T11:28:00Z', verified_by: null, verified_at: null,
    mime_type: 'application/pdf', file_url: null, file_path: `${VIN}/t1.pdf`, storage_bucket: 'ocr-documents',
    metadata: {},
  },
  {
    id: 'ev-legacy', vin: VIN, evidence_type: 'inspection_photo',
    evidence_class: null, evidence_subtype: null,
    verification_status: 'verified', visibility_level: 'public_safe',
    uploaded_by: 'u_gov', uploader_role: 'government', source_id: null, source_name: 'VID',
    checksum: 'ghi789', event_date: null, event_date_precision: null,
    capture_country: 'ZW', uploaded_at: '2026-01-01T00:00:00Z', verified_by: 'u_admin', verified_at: '2026-01-02T00:00:00Z',
    mime_type: 'image/jpeg', file_url: 'https://public.example/i.jpg', file_path: `${VIN}/i.jpg`, storage_bucket: 'vehicle-images',
    metadata: {},
  },
];

function reviewClient() {
  const tables = {
    vehicles: [SERENA_VEHICLE],
    users: [{ id: SELLER, name: 'Kingstone M', role: 'owner', is_verified: false, email_verified_at: null, created_at: '2026-09-01T07:26:08Z', email: 'private@example.test', phone: '+263000000' }],
    vehicle_evidence: SERENA_EVIDENCE,
    vehicle_seller_authority: [],
    vehicle_document_extractions: [],
    trust_fact_requests: [],
    review_tasks: [],
    disputes: [],
    fraud_cases: [],
    trust_audit_events: [
      { id: 'a1', vin: VIN, event_type: 'EVIDENCE_UPLOADED', actor_role: 'owner', actor_type: 'user', trust_fact: null, reason: null, evidence_ids: ['ev-inv'], previous_value: null, new_value: null, created_at: '2026-09-02T11:34:10Z', ip_address: '127.0.0.1', user_agent: 'Mozilla' },
    ],
  };
  return {
    from(table) {
      const state = { filters: [], single: false, maybe: false };
      const rowsFor = () => (tables[table] || []).filter((r) => state.filters.every(([k, v]) => r[k] === v));
      const chain = {
        select() { return chain; },
        eq(k, v) { state.filters.push([k, v]); return chain; },
        order() { return chain; },
        limit() { return chain; },
        single() { return Promise.resolve({ data: rowsFor()[0] ?? null, error: rowsFor()[0] ? null : { message: 'no row' } }); },
        maybeSingle() { return Promise.resolve({ data: rowsFor()[0] ?? null, error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: rowsFor(), error: null }).then(resolve, reject); },
      };
      return chain;
    },
  };
}

const REVIEWER_CTX = { id: 'u_reviewer', role: 'admin', baseRole: 'admin', platformRole: 'admin', authenticationMethod: 'session' };

test('the aggregate composes the Serena state truthfully', async () => {
  const review = await buildVehicleOperationsReview(reviewClient(), { vin: VIN, userContext: REVIEWER_CTX });

  assert.equal(review.vehicle.publication_status, 'draft');
  assert.equal(review.seller.account.name, 'Kingstone M');
  assert.equal(review.seller.account.email_verified, false);
  assert.equal(review.seller_authority.status, 'recognized');
  assert.equal(review.seller_authority.public_statement, 'Listed by the recorded CarUp seller');
  assert.equal(review.registration.stage_provenance, 'not_recorded');
  assert.equal(review.registration.lifecycle.publication_blocking, true);

  // Evidence grouped canonically; the mislabel is SURFACED, not hidden.
  assert.ok(review.evidence.groups.import, 'import group exists');
  const invoice = review.evidence.groups.import.find((e) => e.id === 'ev-inv');
  assert.equal(invoice.semantic_label.includes('Commercial invoice'), true);
  assert.equal(invoice.legacy_contradicts_canonical, true);
  assert.equal(invoice.uploaded_by_seller, true);
  const legacyRow = review.evidence.groups.inspection.find((e) => e.id === 'ev-legacy');
  assert.equal(legacyRow.semantic_source, 'legacy_fallback');
  assert.equal(legacyRow.legacy_contradicts_canonical, false);

  assert.equal(review.publication_readiness.is_publishable, false);
  assert.ok(review.publication_readiness.requirements.some((r) => r.key === 'seller_authority'));
  assert.deepEqual(review.trust_summary.evaluated, false);
  assert.equal(review.risk_summary.open_cases, 0);
  assert.ok(review.allowed_actions.includes('seller_authority.review'));
});

test('the aggregate never leaks storage locators, seller contact PII, or audit network identity', async () => {
  const review = await buildVehicleOperationsReview(reviewClient(), { vin: VIN, userContext: REVIEWER_CTX });
  const serialized = JSON.stringify(review);
  assert.ok(!serialized.includes('SHOULD-NEVER-LEAK'), 'file_url must not appear');
  assert.ok(!serialized.includes(`${VIN}/x.pdf`), 'file_path must not appear');
  assert.ok(!serialized.includes('ocr-documents'), 'storage_bucket must not appear');
  assert.ok(!serialized.includes('private@example.test'), 'seller email must not appear');
  assert.ok(!serialized.includes('+263000000'), 'seller phone must not appear');
  assert.ok(!serialized.includes('127.0.0.1'), 'audit ip must not appear');
  assert.ok(!serialized.includes('Mozilla'), 'audit user_agent must not appear');
});

test('an unknown VIN returns null (route answers 404, never a fabricated review)', async () => {
  const review = await buildVehicleOperationsReview(reviewClient(), { vin: 'UNKNOWN-VIN-000', userContext: REVIEWER_CTX });
  assert.equal(review, null);
});
