/**
 * OC-2A — /api/verification route convergence, proven through the REAL Express mount order.
 *
 * THE DEFECT. server.js mounted, ahead of every other /api/verification route:
 *
 *   app.use('/api/verification', rateLimiter({ max: 5, … isSensitive: true }));
 *   app.use('/api/verification', authorizeSessionRole(['admin', 'government']), documentIntelligenceRouter);
 *
 * Both are PREFIX middleware. The second one runs authorizeSessionRole for EVERY path under
 * /api/verification before Express ever looks at the routers mounted later — including the governed
 * Trust Fact routes (trustFactRoutes.js) and PartSentry review routes (partsentryReviewRoutes.js),
 * whose own route-level authorization deliberately admits owners, dealers and mechanics. So an
 * owner asking for a Trust Fact review, a dealer reading the audit trail and a mechanic asking for
 * PartSentry review were all refused 403 by a gate that belonged to a DIFFERENT router, and every
 * request on the prefix shared a 5/min budget meant for the legacy OCR/approval surface.
 *
 * The service-level suites (trust-fact-workflow, partsentry-review-workflow) call the services
 * directly with a hand-built actor, so they could never see a mount that shadowed the route. This
 * suite therefore drives the SHIPPED app (server.js, NODE_ENV=test → no listen, CSRF bypassed) over
 * real HTTP, with real session-token authentication against an in-memory Supabase double, so the
 * middleware order under test is exactly the order production runs.
 *
 * WHAT IT PROVES
 *   (i)   The five legacy document-intelligence routes are GONE: 404 from the app's safe fallback for
 *         every role including admin/government and for an anonymous caller — not 401/403 (which
 *         would mean a gate is still standing in front of something).
 *   (ii)  Owner and dealer REACH the Trust Fact request + audit-trail handlers (a pending request is
 *         really created; the audit trail really answers); owner and mechanic REACH the PartSentry
 *         request handler.
 *   (iii) The admin-only routes keep their OWN route-level authorization: owner/mechanic are still
 *         refused, an anonymous caller is still 401, and admin (and government where the route
 *         admits it) reach the handler — including an end-to-end admin approval.
 *   (iv)  More than 5 requests/min on the Trust Fact surface are no longer throttled by a
 *         /api/verification-specific limiter; only the global limiter governs them.
 *
 * MUTATION RECORD (not reproducible from the committed tree; recorded in the OC-2A report):
 *   - re-adding `app.use('/api/verification', authorizeSessionRole(['admin','government']), …)`
 *     makes the (ii) tests fail with 403;
 *   - re-adding the legacy router mount makes the (i) test fail (admin gets 400/500, not 404);
 *   - re-adding the 5/min prefix limiter makes (iv) fail with a 429 on the 6th request.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');

// ── In-memory Supabase double ────────────────────────────────────────────────────────────────
// The same thenable query-builder shape trust-fact-workflow.test.js uses, widened with no-op
// filters so unrelated middleware on the request path never trips on a missing method.

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

class MemoryQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this.inFilters = [];
    this.neqFilters = [];
    this.orderSpec = null;
    this.limitValue = null;
    this.operation = 'select';
    this.payload = null;
    db.log.push(table);
  }

  select() { return this; }
  eq(key, value) { this.filters.push({ key, value }); return this; }
  neq(key, value) { this.neqFilters.push({ key, value }); return this; }
  in(key, values) { this.inFilters.push({ key, values }); return this; }
  order(column, options = {}) { this.orderSpec = { column, ascending: options.ascending !== false }; return this; }
  limit(value) { this.limitValue = value; return this; }
  // Filters this suite never needs to evaluate — accepted so a chain never throws.
  is() { return this; }
  not() { return this; }
  or() { return this; }
  gt() { return this; }
  gte() { return this; }
  lt() { return this; }
  lte() { return this; }
  ilike() { return this; }
  like() { return this; }
  contains() { return this; }
  match() { return this; }
  range() { return this; }
  insert(payload) { this.operation = 'insert'; this.payload = payload; return this; }
  upsert(payload) { this.operation = 'insert'; this.payload = payload; return this; }
  update(payload) { this.operation = 'update'; this.payload = payload; return this; }
  delete() { this.operation = 'delete'; return this; }
  maybeSingle() { return this.execute({ single: true, maybe: true }); }
  single() { return this.execute({ single: true, maybe: false }); }
  then(resolve, reject) { return this.execute({ single: false, maybe: false }).then(resolve, reject); }

  rows() {
    if (!this.db.data[this.table]) this.db.data[this.table] = [];
    return this.db.data[this.table];
  }

  matches(row) {
    return this.filters.every((f) => row[f.key] === f.value)
      && this.inFilters.every((f) => f.values.includes(row[f.key]))
      && this.neqFilters.every((f) => row[f.key] !== f.value);
  }

  async execute({ single, maybe }) {
    if (this.operation === 'insert') {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((row) => ({
        id: row.id || `${this.table}-${++this.db.sequence}`,
        created_at: row.created_at || new Date().toISOString(),
        updated_at: row.updated_at || new Date().toISOString(),
        ...clone(row),
      }));
      this.rows().push(...rows);
      this.db.writes.push({ table: this.table, op: 'insert', rows: clone(rows) });
      return single ? { data: clone(rows[0]), error: null } : { data: clone(rows), error: null };
    }
    if (this.operation === 'update') {
      const updated = [];
      for (const row of this.rows()) {
        if (this.matches(row)) { Object.assign(row, clone(this.payload)); updated.push(clone(row)); }
      }
      this.db.writes.push({ table: this.table, op: 'update', rows: clone(updated) });
      if (single) {
        if (!updated.length && !maybe) return { data: null, error: { message: 'No rows updated' } };
        return { data: updated[0] || null, error: null };
      }
      return { data: updated, error: null };
    }
    if (this.operation === 'delete') {
      this.db.writes.push({ table: this.table, op: 'delete', rows: [] });
      return { data: null, error: null };
    }
    let rows = this.rows().filter((row) => this.matches(row)).map(clone);
    if (this.orderSpec) {
      const { column, ascending } = this.orderSpec;
      rows.sort((a, b) => (ascending
        ? String(a[column] || '').localeCompare(String(b[column] || ''))
        : String(b[column] || '').localeCompare(String(a[column] || ''))));
    }
    if (this.limitValue !== null) rows = rows.slice(0, this.limitValue);
    if (single) {
      if (!rows.length && !maybe) return { data: null, error: { code: 'PGRST116', message: 'No rows found' } };
      return { data: rows[0] || null, error: null };
    }
    return { data: rows, error: null };
  }
}

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

/** One proven session per role. Every request in this suite authenticates with a REAL token. */
const USERS = {
  owner: { id: 'owner-1', role: 'owner' },
  dealer: { id: 'dealer-1', role: 'dealer' },
  mechanic: { id: 'mech-1', role: 'mechanic' },
  admin: { id: 'admin-1', role: 'admin' },
  government: { id: 'gov-1', role: 'government' },
};
const tokenFor = (role) => `oc2a-session-${role}`;

let db;
function resetDb() {
  db = {
    sequence: 0,
    log: [],
    writes: [],
    data: {
      users: Object.values(USERS).map((u) => ({ id: u.id, role: u.role, is_verified: true })),
      user_sessions: Object.keys(USERS).map((role) => ({
        token: tokenFor(role), user_id: USERS[role].id, is_valid: true, expires_at: FUTURE,
      })),
      tenant_users: [{ tenant_id: 'tenant-1', user_id: 'dealer-1', role: 'dealer' }],
      vehicles: [{
        vin: 'VIN1', owner_id: 'owner-1', tenant_id: 'tenant-1',
        vehicle_condition_category: 'unknown', passport_verified: false, passport_verified_at: null,
        passport_verification_source: null, inspection_ready: false,
      }],
      vehicle_evidence: [
        { id: 'ev-condition', vin: 'VIN1', evidence_type: 'dealer_listing_photo', verification_status: 'verified', visibility_level: 'public_safe' },
        { id: 'ev-reg', vin: 'VIN1', evidence_type: 'registration_document', verification_status: 'verified', visibility_level: 'restricted' },
        { id: 'ev-inspection', vin: 'VIN1', evidence_type: 'inspection_photo', verification_status: 'verified', visibility_level: 'public_safe' },
        { id: 'ev-work', vin: 'VIN1', evidence_type: 'work_order', verification_status: 'verified', visibility_level: 'restricted' },
      ],
      partsentry_logs: [{
        id: 101, vin: 'VIN1', mechanic_id: 'mech-1', part_name: 'Brake pads', part_oem: 'OEM-123',
        action_type: 'Replaced', mileage: 45000, timestamp: '2026-06-01T00:00:00Z',
        verification_status: 'unverified', part_verification_status: 'unverified',
        suspicion_status: 'none', public_card_eligible: false,
      }],
      trust_fact_requests: [],
      partsentry_review_requests: [],
      trust_audit_events: [],
      organization_audit_logs: [],
      organization_users: [],
    },
  };
}

let server;
let baseUrl;
const realFrom = supabase.from;

before(async () => {
  resetDb();
  supabase.from = (table) => new MemoryQuery(db, table);
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  supabase.from = realFrom;
  if (server) await new Promise((resolve) => server.close(resolve));
});
beforeEach(resetDb);

/**
 * One HTTP call. `role` null = anonymous. `bypassLimiter` defaults ON for the authorization tests so
 * they measure authorization alone; the throttle test (iv) turns it OFF to measure the limiters.
 */
async function call(method, path, { role = null, body, headers = {}, bypassLimiter = true } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (bypassLimiter) h['x-bypass-rate-limit'] = 'true';
  if (role) h['x-session-token'] = tokenFor(role);
  const res = await fetch(`${baseUrl}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, headers: res.headers };
}

const ALL_ROLES = [null, ...Object.keys(USERS)];
const label = (role) => role || 'anonymous';

// ═══════════════════════════════════════════════════════════════════════════════════════════
// (i) The legacy document-intelligence surface is gone — 404, never 401/403, for everyone.
// ═══════════════════════════════════════════════════════════════════════════════════════════

const RETIRED_ROUTES = [
  ['POST', '/api/verification/ocr', { docType: 'national_id', capturedFront: 'data:image/png;base64,QUJD' }],
  ['POST', '/api/verification/ocr/ocr-doc-1/approve', { vin: 'VIN1', overrideJustification: 'probe' }],
  ['POST', '/api/verification/fraud-scan', { userId: 'owner-1' }],
  ['GET', '/api/verification/trust-score/owner-1', undefined],
  ['POST', '/api/verification/promote-trust', { userId: 'owner-1', trustLevel: 5 }],
];

test('OC-2A (i): the five retired document-intelligence routes answer 404 for every role, admin included', async () => {
  // The app's own safe fallback shape, measured from a path nothing has ever served. Per-request
  // fields (requestId, timestamp) are excluded; code + message identify the fallback.
  const fallbackOf = (body) => ({ success: body?.success, code: body?.error?.code, message: body?.error?.message });
  const notFound = fallbackOf((await call('GET', '/api/definitely-not-a-route-oc2a')).body);
  assert.deepEqual(notFound, { success: false, code: 'RESOURCE_NOT_FOUND', message: 'Route not found' });
  for (const [method, path, body] of RETIRED_ROUTES) {
    for (const role of ALL_ROLES) {
      const res = await call(method, path, { role, body });
      assert.equal(res.status, 404, `${method} ${path} as ${label(role)} must be 404 (retired), got ${res.status} ${JSON.stringify(res.body)}`);
      // The safe fallback answered — not a handler that happens to say "not found".
      assert.deepEqual(fallbackOf(res.body), notFound, `${method} ${path} as ${label(role)} must hit the safe 404 fallback`);
    }
  }
  // Nothing the retired surface used to write was touched by any of those calls.
  const retiredSinks = new Set(['administrative_overrides', 'kyc_profiles', 'ocr_documents', 'trust_score_history', 'cvr_ownership_records', 'zimra_declarations']);
  assert.deepEqual(db.writes.filter((w) => retiredSinks.has(w.table)), [], 'no retired-authority table was written');
  assert.equal(db.log.includes('vehicles'), false, 'no retired route read or wrote a vehicle');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// (ii) Owner, dealer and mechanic REACH the handlers their route-level authorization admits.
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('OC-2A (ii): an owner reaches the Trust Fact request handler and a pending request is created', async () => {
  const res = await call('POST', '/api/verification/trust-facts/VIN1/requests', {
    role: 'owner',
    body: {
      trust_fact: 'passport_verified', requested_value: { passport_verified: true },
      evidence_ids: ['ev-reg'], reason: 'Registration document ready for Passport review',
    },
  });
  assert.equal(res.status, 201, `owner must reach the handler, got ${res.status} ${JSON.stringify(res.body)}`);
  assert.equal(res.body.status, 'pending');
  assert.equal(db.data.trust_fact_requests.length, 1, 'the handler really created the request');
  assert.equal(db.data.trust_fact_requests[0].requested_by, 'owner-1', 'attributed to the session owner');
  assert.equal(db.data.trust_fact_requests[0].requested_by_role, 'owner');
});

test('OC-2A (ii): a dealer (tenant-scoped) reaches the Trust Fact request handler', async () => {
  const res = await call('POST', '/api/verification/trust-facts/VIN1/requests', {
    role: 'dealer',
    headers: { 'x-tenant-id': 'tenant-1' },
    body: {
      trust_fact: 'inspection_ready', requested_value: { inspection_ready: true },
      evidence_ids: ['ev-inspection'], reason: 'Inspection completed by dealer',
    },
  });
  assert.equal(res.status, 201, `dealer must reach the handler, got ${res.status} ${JSON.stringify(res.body)}`);
  assert.equal(db.data.trust_fact_requests[0].requested_by_role, 'dealer');
});

test('OC-2A (ii): owner and dealer reach the Trust Fact audit-trail handler', async () => {
  await call('POST', '/api/verification/trust-facts/VIN1/requests', {
    role: 'owner',
    body: {
      trust_fact: 'passport_verified', requested_value: { passport_verified: true },
      evidence_ids: ['ev-reg'], reason: 'Registration document ready for Passport review',
    },
  });
  for (const [role, headers] of [['owner', {}], ['dealer', { 'x-tenant-id': 'tenant-1' }]]) {
    const res = await call('GET', '/api/verification/audit-trail/VIN1', { role, headers });
    assert.equal(res.status, 200, `${role} must reach the audit-trail handler, got ${res.status} ${JSON.stringify(res.body)}`);
    assert.equal(res.body.vin, 'VIN1');
    assert.ok(Array.isArray(res.body.events), 'the handler answered with its own shape');
    assert.ok(res.body.total >= 1, `${role} sees the request event the owner just created`);
  }
});

test('OC-2A (ii): a mechanic and an owner reach the PartSentry review-request handler', async () => {
  const mech = await call('POST', '/api/verification/partsentry/101/requests', {
    role: 'mechanic',
    body: { request_type: 'public_card_eligible', requested_value: { public_card_eligible: true }, reason: 'Ready for public card review' },
  });
  assert.equal(mech.status, 201, `mechanic must reach the handler, got ${mech.status} ${JSON.stringify(mech.body)}`);
  assert.equal(mech.body.requested_by_role, 'mechanic');

  const own = await call('POST', '/api/verification/partsentry/101/requests', {
    role: 'owner',
    body: { request_type: 'verification_status', requested_value: { verification_status: 'verified' }, evidence_ids: ['ev-work'], reason: 'Owner wants service log verified' },
  });
  assert.equal(own.status, 201, `owner must reach the handler, got ${own.status} ${JSON.stringify(own.body)}`);
  assert.equal(db.data.partsentry_review_requests.length, 2, 'both requests were really created');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// (iii) The admin-only routes keep their OWN route-level authorization.
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('OC-2A (iii): admin-only routes still refuse owner/mechanic (403) and anonymous (401)', async () => {
  const adminOnly = [
    ['GET', '/api/verification/review-queue', undefined],
    ['PATCH', '/api/verification/trust-facts/any-request/approve', { reason: 'x' }],
    ['PATCH', '/api/verification/trust-facts/any-request/reject', { reason: 'x' }],
    ['PATCH', '/api/verification/trust-facts/any-request/revoke', { reason: 'x' }],
    ['GET', '/api/verification/partsentry/review-queue', undefined],
    ['PATCH', '/api/verification/partsentry/any-request/approve', { reason: 'x' }],
  ];
  for (const [method, path, body] of adminOnly) {
    for (const role of ['owner', 'mechanic']) {
      const res = await call(method, path, { role, body });
      assert.equal(res.status, 403, `${method} ${path} as ${role} must stay 403, got ${res.status}`);
      assert.match(JSON.stringify(res.body), new RegExp(`Role '${role}' cannot access this resource`));
    }
    const anon = await call(method, path, { body });
    assert.equal(anon.status, 401, `${method} ${path} anonymous must stay 401, got ${anon.status}`);
  }
  // Government is admitted to the Trust Fact queue but NOT to the PartSentry queue (route-level).
  const govPartsentry = await call('GET', '/api/verification/partsentry/review-queue', { role: 'government' });
  assert.equal(govPartsentry.status, 403, 'PartSentry review queue is admin-only at the route');
  assert.equal(db.data.trust_fact_requests.length + db.data.partsentry_review_requests.length, 0, 'no refused call wrote anything');
});

test('OC-2A (iii): admin (and government where admitted) reach the review queues', async () => {
  for (const role of ['admin', 'government']) {
    const res = await call('GET', '/api/verification/review-queue', { role });
    assert.equal(res.status, 200, `${role} must reach the Trust Fact review queue, got ${res.status} ${JSON.stringify(res.body)}`);
    assert.ok(Array.isArray(res.body.requests));
  }
  const ps = await call('GET', '/api/verification/partsentry/review-queue', { role: 'admin' });
  assert.equal(ps.status, 200, `admin must reach the PartSentry review queue, got ${ps.status} ${JSON.stringify(ps.body)}`);
  assert.ok(Array.isArray(ps.body.requests));
});

test('OC-2A (iii): end to end — an owner request is approved by an admin through the real mount', async () => {
  const created = await call('POST', '/api/verification/trust-facts/VIN1/requests', {
    role: 'owner',
    body: {
      trust_fact: 'vehicle_condition_category', requested_value: { condition_category: 'brand_new' },
      evidence_ids: ['ev-condition'], reason: 'Vehicle listing evidence supports brand new category',
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const ownerTry = await call('PATCH', `/api/verification/trust-facts/${created.body.id}/approve`, { role: 'owner', body: { reason: 'self' } });
  assert.equal(ownerTry.status, 403, 'the requester cannot approve their own request');
  assert.equal(db.data.vehicles[0].vehicle_condition_category, 'unknown');

  const approved = await call('PATCH', `/api/verification/trust-facts/${created.body.id}/approve`, { role: 'admin', body: { reason: 'Reviewed condition evidence' } });
  assert.equal(approved.status, 200, `admin must reach the approve handler, got ${approved.status} ${JSON.stringify(approved.body)}`);
  assert.equal(approved.body.success, true);
  assert.equal(db.data.trust_fact_requests[0].status, 'approved');
  assert.equal(db.data.vehicles[0].vehicle_condition_category, 'brand_new', 'the governed Trust Fact authority applied the approval');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// (iv) No /api/verification-specific throttle — only the global limiter governs these routes.
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('OC-2A (iv): more than 5 Trust Fact reads per minute are not throttled by a prefix limiter', async () => {
  const statuses = [];
  const limits = new Set();
  for (let i = 0; i < 12; i += 1) {
    const res = await call('GET', '/api/verification/audit-trail/VIN1', { role: 'owner', bypassLimiter: false });
    statuses.push(res.status);
    limits.add(res.headers.get('ratelimit-limit'));
  }
  assert.deepEqual(statuses, Array(12).fill(200), `no request may be throttled (statuses: ${statuses.join(',')})`);
  // The most-restrictive limiter's headers are what a response reports. Only the global limiter
  // (default 100/min off staging) applies; a 5/min prefix limiter would report '5' here.
  assert.deepEqual([...limits], ['100'], `only the global limiter applies (RateLimit-Limit seen: ${[...limits].join(',')})`);
});
