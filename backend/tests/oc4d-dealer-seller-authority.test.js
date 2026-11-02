/**
 * OC-4D — Dealer seller/commerce authority, ported from PR #208 (rounds G/H/I/J/K/L/M and the
 * predictive closure) and extended to the surfaces this lineage grew after #208 forked.
 *
 * THE DEFECT. `authorizeRole` sets `userContext.tenantId` from `x-tenant-id` once ANY `tenant_users`
 * row links the user to that tenant. Membership is generic (admin / manager / member / mechanic), so
 * raw `vehicle.tenant_id === userContext.tenantId` turned EMPLOYMENT into SELLING AUTHORITY: a
 * platform `dealer` who is only a mechanic in a dealership (or an admin of a garage) could list as
 * that organisation, publish / unpublish / reprice / mark Sold its vehicles, read their private
 * evidence and documents, and read its buyers' contact details.
 *
 * THE AUTHORITY (one primitive, `services/dealer/dealerListingAuthority.js`): effective role
 * `dealer` + a validated membership whose role ACTS FOR the business (owner/admin/dealer) + an
 * ACTIVE tenant whose canonical type is a dealership + no suspended dealer profile. Creation and
 * lifecycle consume the same function, so they cannot drift apart.
 *
 * Proof is layered the way #208 learned to layer it: pure matrices over the candidate; the real
 * resolver over real PostgreSQL rows (PGlite); the real `authorizeRole` middleware; a register
 * tripwire that says WHICH surfaces must be governed (rename detection only); and a BEHAVIOURAL
 * matrix through the real routes asserting status and row count — never spelling.
 *
 * RC-only surfaces added by OC-4D (code #208 never saw): private vehicle-document OCR scope, and the
 * seller inquiry inbox (buyer names, emails, phones).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
for (const method of ['log', 'info', 'warn', 'error', 'debug']) console[method] = () => {};

const {
  resolveDealerListingSubject, hasGovernedDealerVehicleAuthority,
  DEALER_SUBJECT_REASONS, DEALERSHIP_TENANT_TYPES, BUSINESS_AUTHORITY_MEMBERSHIP_ROLES,
} = await import('../services/dealer/dealerListingAuthority.js');
const { buildVehicleListingCandidate, getListingEligibility } = await import('../services/marketplace/marketplaceListingEligibility.js');
const { hasExistingSellerRelationship } = await import('../services/seller/sellerAuthorityService.js');
const { listInquiriesForSeller } = await import('../services/marketplace/marketplaceInquiryService.js');
const { authorizeRole } = await import('../middleware/authMiddleware.js');
const { supabase } = await import('../db/supabase.js');

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const DEALERSHIP = 'tenant-moyo-motors';
const GARAGE = 'tenant-garage-1';
const IMPORT = 'tenant-import-co';
const OWNER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const BODY = { vin: 'JTMHY7AJ2K4012345', make: 'Toyota', model: 'Hilux', year: 2019, price: 15000, currency: 'USD', mileage: 90000, city: 'Harare', description: 'A well maintained vehicle.' };

/** Real PostgreSQL rows for the three server-controlled authority tables. */
async function authorityDb() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE tenants (id text PRIMARY KEY, type text, status text);`);
  await db.exec(`CREATE TABLE tenant_users (tenant_id text, user_id text, role text);`);
  await db.exec(`CREATE TABLE dealer_profiles (id text PRIMARY KEY, user_id text, tenant_id text, suspension_state text);`);
  await db.query(`INSERT INTO tenants VALUES
    ($1,'dealership','active'), ($2,'garage','active'), ($3,'import','active'),
    ('tenant-wound-up','dealership','suspended');`, [DEALERSHIP, GARAGE, IMPORT]);
  await db.query(`INSERT INTO tenant_users VALUES
    ($1,'u-dealer','admin'),            -- the legitimate dealership relationship
    ($1,'u-dealer-mech','mechanic'),    -- employed BY the dealership
    ($1,'u-admin','admin'),             -- platform admin, in a dealership
    ($1,'u-gov','admin'),               -- government account, in a dealership
    ($2,'u-dealer-garage','mechanic'),  -- dealer role, garage membership
    ($2,'u-dealer-gadmin','admin'),     -- dealer role, garage ADMIN
    ($3,'u-dealer-import','admin'),     -- dealer role, import business
    ('tenant-wound-up','u-dealer-dead','admin'),
    ($1,'u-dealer-susp','admin');`, [DEALERSHIP, GARAGE, IMPORT]);
  await db.query(`INSERT INTO dealer_profiles VALUES ('dp-susp','u-dealer-susp',NULL,'suspended');`);
  return db;
}

/** A Supabase double that answers FAITHFULLY from the real rows (an under-scoped query gets the real, wrong answer). */
const authorityClient = (db) => ({
  from: (table) => ({
    select: () => {
      const f = {};
      const chain = {
        eq(col, value) { f[col] = value; return chain; },
        async maybeSingle() {
          const sql = {
            tenants: 'SELECT id, type, status FROM tenants',
            tenant_users: 'SELECT role FROM tenant_users',
            dealer_profiles: 'SELECT id, tenant_id, suspension_state FROM dealer_profiles',
          }[table];
          if (!sql) return { data: null, error: null };
          const keys = Object.keys(f);
          const clause = keys.length ? ' WHERE ' + keys.map((c, i) => `${c} = $${i + 1}`).join(' AND ') : '';
          const { rows } = await db.query(`${sql}${clause} LIMIT 1;`, keys.map((c) => f[c]));
          return { data: rows[0] || null, error: null };
        },
      };
      return chain;
    },
  }),
});

/* ══ 1. The listing candidate — role, membership and body mint nothing (G-2/H/I-2/J-3) ═════════ */

const granted = (tenantId) => ({ granted: true, tenantId, dealerProfileId: null, reason: null });
const subjectOf = (extra, userContext, dealerListingSubject = null) => {
  const c = buildVehicleListingCandidate({ body: { ...BODY, ...extra }, userContext, dealerListingSubject });
  return { owner: c.owner_id, tenant: c.tenant_id, type: c.current_seller_type, eligible: getListingEligibility(c).eligible };
};
const REFUSED = { owner: null, tenant: null, type: null, eligible: false };

test('candidate: an Owner still lists their own vehicle under Owner authority', () => {
  assert.deepEqual(subjectOf({}, { id: OWNER_ID, role: 'owner', tenantId: null }),
    { owner: OWNER_ID, tenant: null, type: 'Private Owner', eligible: true });
});

test('candidate: a Dealer lists for its governed dealership only — a tenant header alone is membership', () => {
  assert.deepEqual(subjectOf({}, { id: 'd1', role: 'dealer', tenantId: DEALERSHIP }, granted(DEALERSHIP)),
    { owner: null, tenant: DEALERSHIP, type: 'Dealer', eligible: true });
  assert.deepEqual(subjectOf({}, { id: 'd1', role: 'dealer', tenantId: DEALERSHIP }), REFUSED,
    'no resolved subject → no seller at all, never an open default');
  assert.equal(subjectOf({ tenant_id: GARAGE }, { id: 'd1', role: 'dealer', tenantId: DEALERSHIP }, granted(DEALERSHIP)).tenant,
    DEALERSHIP, 'the body cannot substitute a tenant');
});

test('candidate: Admin and Government are not Dealers, with or without any membership', () => {
  for (const role of ['admin', 'government']) {
    assert.deepEqual(subjectOf({}, { id: 'x1', role, tenantId: null }), REFUSED, `${role}, no tenant`);
    for (const tenantRole of ['admin', 'manager', 'mechanic', 'member']) {
      assert.deepEqual(subjectOf({}, { id: 'x1', role, tenantId: DEALERSHIP, tenantRole }), REFUSED, `${role} as tenant ${tenantRole}`);
    }
  }
});

test('candidate: a forged body owner_id / tenant_id / current_seller_type grants nothing (G-2: the body outranked the context)', () => {
  const admin = { id: 'a1', role: 'admin', tenantId: null };
  assert.deepEqual(subjectOf({ owner_id: OWNER_ID }, admin), REFUSED);
  assert.deepEqual(subjectOf({ tenant_id: DEALERSHIP }, admin), REFUSED);
  assert.deepEqual(subjectOf({ current_seller_type: 'Dealer' }, admin), REFUSED);
  assert.deepEqual(subjectOf({ owner_id: OWNER_ID, tenant_id: DEALERSHIP, current_seller_type: 'Dealer', 'x-user-id': OWNER_ID }, admin), REFUSED);
});

test('candidate: the listing candidate stays a pure function — it cannot mint an authority of its own', () => {
  const code = src('../services/marketplace/marketplaceListingEligibility.js')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.equal(/\.from\(|supabase|await /.test(code), false, 'no query, no client, no await');
  for (const invented of ['compliance_review_state', 'activateDealer', 'grantDealer', 'dealer_capability']) {
    assert.equal(code.includes(invented), false, `${invented} would be a dealer authority invented here`);
  }
});

/* ══ 2. The governed resolver over real rows (J-3 / K-3) ════════════════════════════════════════ */

test('resolver: the full authority matrix — every membership class measured, none assumed', async () => {
  const db = await authorityDb();
  const client = authorityClient(db);
  const matrix = [
    ['Owner', { role: 'owner', id: 'u-owner', tenantId: null }, 'Private Owner'],
    ['Dealer + its own active dealership (admin membership)', { role: 'dealer', id: 'u-dealer', tenantId: DEALERSHIP }, 'Dealer'],
    ['Dealer + no tenant', { role: 'dealer', id: 'u-dealer', tenantId: null }, null],
    ['Dealer + GARAGE mechanic membership', { role: 'dealer', id: 'u-dealer-garage', tenantId: GARAGE }, null],
    ['Dealer + GARAGE ADMIN membership', { role: 'dealer', id: 'u-dealer-gadmin', tenantId: GARAGE }, null],
    ['Dealer + import-business admin', { role: 'dealer', id: 'u-dealer-import', tenantId: IMPORT }, null],
    ['Dealer + dealership with NO membership', { role: 'dealer', id: 'u-nobody', tenantId: DEALERSHIP }, null],
    ['Dealer + SUSPENDED dealer profile', { role: 'dealer', id: 'u-dealer-susp', tenantId: DEALERSHIP }, null],
    ['Dealer + wound-up dealership', { role: 'dealer', id: 'u-dealer-dead', tenantId: 'tenant-wound-up' }, null],
    ['MECHANIC employed by the dealership (employment is not agency)', { role: 'dealer', id: 'u-dealer-mech', tenantId: DEALERSHIP }, null],
    ['Admin in the dealership', { role: 'admin', id: 'u-admin', tenantId: DEALERSHIP }, null],
    ['Government in the dealership', { role: 'government', id: 'u-gov', tenantId: DEALERSHIP }, null],
    ['Foreign tenant', { role: 'dealer', id: 'u-dealer', tenantId: 'tenant-does-not-exist' }, null],
  ];
  for (const [label, ctx, expectedType] of matrix) {
    const dealerListingSubject = await resolveDealerListingSubject(client, { role: ctx.role, userId: ctx.id, tenantId: ctx.tenantId });
    const candidate = buildVehicleListingCandidate({ body: BODY, userContext: ctx, dealerListingSubject });
    assert.equal(candidate.current_seller_type, expectedType, `${label}: seller type`);
    if (expectedType === null) {
      assert.equal(candidate.tenant_id, null, `${label}: no tenant subject`);
      assert.equal(getListingEligibility(candidate).eligible, false, `${label}: must be ineligible`);
    }
  }
  await db.close();
});

test('resolver: LEGITIMATE DEALER CONTINUITY — the real shape (admin of an active dealership, no profile binding) still lists', async () => {
  const db = await authorityDb();
  const s = await resolveDealerListingSubject(authorityClient(db), { role: 'dealer', userId: 'u-dealer', tenantId: DEALERSHIP });
  assert.equal(s.granted, true, 'the security fix must not disable real Dealers');
  assert.equal(s.tenantId, DEALERSHIP);
  assert.equal(s.dealerProfileId, null, 'no dealer_profiles row is required (nothing writes its tenant binding)');
  await db.close();
});

test('resolver: refusal reasons name the actual boundary', async () => {
  const db = await authorityDb();
  const why = async (ctx) => (await resolveDealerListingSubject(authorityClient(db), ctx)).reason;
  assert.equal(await why({ role: 'owner', userId: 'u', tenantId: null }), DEALER_SUBJECT_REASONS.NOT_A_DEALER_ROLE);
  assert.equal(await why({ role: 'dealer', userId: 'u-dealer', tenantId: null }), DEALER_SUBJECT_REASONS.NO_TENANT_CONTEXT);
  assert.equal(await why({ role: 'dealer', userId: 'u-nobody', tenantId: DEALERSHIP }), DEALER_SUBJECT_REASONS.NO_TENANT_MEMBERSHIP);
  assert.equal(await why({ role: 'dealer', userId: 'u-dealer-gadmin', tenantId: GARAGE }), DEALER_SUBJECT_REASONS.TENANT_NOT_A_DEALERSHIP);
  assert.equal(await why({ role: 'dealer', userId: 'u-dealer-mech', tenantId: DEALERSHIP }), DEALER_SUBJECT_REASONS.MEMBERSHIP_NOT_BUSINESS_AUTHORITY);
  assert.equal(await why({ role: 'dealer', userId: 'u-dealer-dead', tenantId: 'tenant-wound-up' }), DEALER_SUBJECT_REASONS.TENANT_NOT_ACTIVE);
  assert.equal(await why({ role: 'dealer', userId: 'u-dealer-susp', tenantId: DEALERSHIP }), DEALER_SUBJECT_REASONS.DEALER_AUTHORITY_WITHDRAWN);
  await db.close();
});

test('resolver: the vocabulary is CarUp\'s own and excludes what it should', () => {
  assert.deepEqual([...DEALERSHIP_TENANT_TYPES].sort(), ['dealer', 'dealership']);
  assert.equal(DEALERSHIP_TENANT_TYPES.has('garage'), false);
  assert.equal(DEALERSHIP_TENANT_TYPES.has('import'), false, 'an import business is not a dealership');
  assert.equal(BUSINESS_AUTHORITY_MEMBERSHIP_ROLES.has('mechanic'), false, 'employment is not agency');
  assert.equal(BUSINESS_AUTHORITY_MEMBERSHIP_ROLES.has('member'), false);
  assert.equal(BUSINESS_AUTHORITY_MEMBERSHIP_ROLES.has('admin'), true);
});

test('resolver: an unreadable authority (duplicate profile rows, any error) fails CLOSED', async () => {
  const erroring = { from: () => ({ select: () => ({ eq() { return this; }, async maybeSingle() { return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } }; } }) }) };
  assert.equal((await resolveDealerListingSubject(erroring, { role: 'dealer', userId: 'u-dup', tenantId: DEALERSHIP })).granted, false);
  const throwing = { from: () => { throw new Error('network down'); } };
  assert.equal((await resolveDealerListingSubject(throwing, { role: 'dealer', userId: 'u-dealer', tenantId: DEALERSHIP })).granted, false);
});

test('resolver: a self-writable dealer_profiles tenant binding can never grant on its own', async () => {
  const db = await authorityDb();
  await db.query(`INSERT INTO dealer_profiles VALUES ('dp-self','u-self',$1,'none');`, [GARAGE]);
  await db.query(`INSERT INTO tenant_users VALUES ($1,'u-self','admin');`, [GARAGE]);
  const s = await resolveDealerListingSubject(authorityClient(db), { role: 'dealer', userId: 'u-self', tenantId: GARAGE });
  assert.equal(s.granted, false);
  assert.equal(s.reason, DEALER_SUBJECT_REASONS.TENANT_NOT_A_DEALERSHIP);
  await db.close();
});

/* ══ 3. Existing-vehicle lifecycle — one primitive, same answer as creation (L-2) ═══════════════ */

test('lifecycle: the authority matrix over an EXISTING tenant-scoped vehicle', async () => {
  const db = await authorityDb();
  const client = authorityClient(db);
  const vehicle = (tenant = DEALERSHIP) => ({ tenant_id: tenant, owner_id: 'someone-else', current_seller_id: 'someone-else' });
  const matrix = [
    ['legitimate Dealer business actor', { id: 'u-dealer', role: 'dealer', tenantId: DEALERSHIP }, vehicle(), true],
    ['dealership MECHANIC', { id: 'u-dealer-mech', role: 'dealer', tenantId: DEALERSHIP }, vehicle(), false],
    ['garage admin', { id: 'u-dealer-gadmin', role: 'dealer', tenantId: GARAGE }, vehicle(GARAGE), false],
    ['import-business admin', { id: 'u-dealer-import', role: 'dealer', tenantId: IMPORT }, vehicle(IMPORT), false],
    ['wound-up dealership', { id: 'u-dealer-dead', role: 'dealer', tenantId: 'tenant-wound-up' }, vehicle('tenant-wound-up'), false],
    ['suspended authority', { id: 'u-dealer-susp', role: 'dealer', tenantId: DEALERSHIP }, vehicle(), false],
    ['a Dealer against ANOTHER tenant\'s vehicle', { id: 'u-dealer', role: 'dealer', tenantId: DEALERSHIP }, vehicle(GARAGE), false],
    ['an admin role in the dealership', { id: 'u-admin', role: 'admin', tenantId: DEALERSHIP }, vehicle(), false],
    ['a NULL-tenant vehicle never matches a NULL tenant context', { id: 'u-dealer', role: 'dealer', tenantId: null }, vehicle(null), false],
  ];
  for (const [label, ctx, veh, expected] of matrix) {
    assert.equal(await hasGovernedDealerVehicleAuthority(client, ctx, veh), expected, label);
  }
  for (const [id, expected] of [['u-dealer', true], ['u-dealer-mech', false]]) {
    const creation = (await resolveDealerListingSubject(client, { role: 'dealer', userId: id, tenantId: DEALERSHIP })).granted;
    assert.equal(creation, expected, `${id}: creation`);
    assert.equal(await hasGovernedDealerVehicleAuthority(client, { id, role: 'dealer', tenantId: DEALERSHIP }, vehicle()), creation,
      `${id}: creation and lifecycle must agree`);
  }
  await db.close();
});

test('lifecycle: Owner and current-seller recognition are untouched; the tenant clause needs the governed decision', () => {
  const vehicle = { owner_id: 'u-owner', current_seller_id: 'u-seller', tenant_id: DEALERSHIP };
  assert.equal(hasExistingSellerRelationship(vehicle, { id: 'u-owner' }), true);
  assert.equal(hasExistingSellerRelationship(vehicle, { id: 'u-seller' }), true);
  const other = { owner_id: 'other', current_seller_id: 'other', tenant_id: DEALERSHIP };
  assert.equal(hasExistingSellerRelationship(other, { id: 'u-dealer-mech', tenantId: DEALERSHIP }), false,
    'a caller that does not supply a governed decision gets no tenant clause');
  assert.equal(hasExistingSellerRelationship(other, { id: 'u-dealer', tenantId: DEALERSHIP }, { dealerTenantAuthorized: true }), true);
});

/* ══ 4. The real authorizeRole middleware feeds the same decision (I-7) ═════════════════════════ */

function middlewareStore() {
  const users = { 'u-owner': { id: 'u-owner', role: 'owner', is_verified: true }, 'u-admin': { id: 'u-admin', role: 'admin', is_verified: true } };
  const sessions = {
    'tok-owner': { user_id: 'u-owner', is_valid: true, expires_at: '2099-01-01T00:00:00Z' },
    'tok-admin': { user_id: 'u-admin', is_valid: true, expires_at: '2099-01-01T00:00:00Z' },
  };
  const memberships = [{ tenant_id: DEALERSHIP, user_id: 'u-admin', role: 'admin' }, { tenant_id: DEALERSHIP, user_id: 'u-owner', role: 'mechanic' }];
  return (table) => {
    const f = [];
    const api = {
      select: () => api,
      eq: (c, v) => { f.push([c, v]); return api; },
      async single() {
        const val = (c) => f.find(([k]) => k === c)?.[1];
        if (table === 'user_sessions') return sessions[val('token')] ? { data: sessions[val('token')], error: null } : { data: null, error: { message: 'not found' } };
        if (table === 'users') return users[val('id')] ? { data: users[val('id')], error: null } : { data: null, error: { message: 'not found' } };
        if (table === 'tenant_users') {
          const m = memberships.find((x) => x.tenant_id === val('tenant_id') && x.user_id === val('user_id'));
          // PostgREST's real zero-row .single() answer. OC-5D: a code-less error is a FAILED read (503).
          return m ? { data: { role: m.role }, error: null } : { data: null, error: { code: 'PGRST116', message: 'no membership' } };
        }
        return { data: null, error: null };
      },
    };
    api.maybeSingle = api.single;
    api.then = (res, rej) => api.single().then(res, rej);
    return api;
  };
}

async function deriveViaMiddleware(headers) {
  const saved = supabase.from;
  supabase.from = middlewareStore();
  try {
    const req = { headers, body: {}, params: {}, query: {} };
    let status = 200; let userContext = null;
    const res = { status(c) { status = c; return res; }, json() { return res; } };
    await new Promise((resolve) => {
      authorizeRole([])(req, res, () => { userContext = req.userContext; resolve(); });
      setTimeout(resolve, 100);
    });
    if (!userContext) return { refused: true, status };
    const c = buildVehicleListingCandidate({ body: BODY, userContext });
    return { refused: false, tenantId: userContext.tenantId ?? null, type: c.current_seller_type, tenant: c.tenant_id };
  } finally {
    supabase.from = saved;
  }
}

test('middleware: a proven ADMIN with a real tenant-admin membership is still not a seller', async () => {
  const r = await deriveViaMiddleware({ 'x-session-token': 'tok-admin', 'x-tenant-id': DEALERSHIP });
  assert.equal(r.refused, false);
  assert.equal(r.tenantId, DEALERSHIP, 'the membership really is established by the middleware');
  assert.equal(r.type, null);
  assert.equal(r.tenant, null);
});

test('middleware: a MECHANIC membership confers nothing — the owner path still governs that account', async () => {
  const r = await deriveViaMiddleware({ 'x-session-token': 'tok-owner', 'x-tenant-id': DEALERSHIP });
  assert.equal(r.refused, false);
  assert.equal(r.type, 'Private Owner');
  assert.equal(r.tenant, null);
});

test('middleware: a forged x-tenant-id with no membership is refused by the middleware itself', async () => {
  const r = await deriveViaMiddleware({ 'x-session-token': 'tok-owner', 'x-tenant-id': 'tenant-not-mine' });
  assert.equal(r.refused, true);
  assert.equal(r.status, 403);
});

/* ══ 5. Register — WHICH surfaces must be governed (rename detection only; the proof is §6) ═════ */

const SELLER_SURFACES = [
  ['../routes/vehiclesRoutes.js', "router.patch('/api/vehicles/:vin/status'", 'vehicle status'],
  ['../routes/vehiclesRoutes.js', 'async function loadScopedVehicle', 'publish / unpublish / price'],
  ['../routes/vehiclesRoutes.js', "router.get('/api/vehicles/:vin/seller-authority'", 'seller authority state read'],
  ['../routes/vehiclesRoutes.js', 'async function assertEvidenceOwnershipScope', 'evidence upload seller scope'],
  ['../routes/vehiclesRoutes.js', "router.get('/api/vehicles/:vin/evidence'", 'private evidence read'],
  ['../routes/vehiclesRoutes.js', "router.patch('/api/vehicles/:vin/evidence/:evidenceId/link-event'", 'evidence link-event'],
  ['../server.js', "app.post('/api/vehicles/add'", 'listing creation + existing-Passport reuse'],
  ['../server.js', "app.patch('/api/vehicles/:vin/seller-draft'", 'seller draft'],
  ['../server.js', "app.get('/api/vehicles/:vin/completeness'", 'vehicle completeness'],
  ['../services/storage/mediaRouter.js', "router.post('/upload/vehicle'", 'media upload'],
  ['../services/storage/mediaRouter.js', "router.post('/upload/document'", 'private document upload'],
  ['../services/storage/mediaRouter.js', "router.get('/upload/signed-url'", 'media signed url'],
  ['../services/storage/mediaRouter.js', "router.get('/document/signed-url'", 'private document read'],
  ['../services/seller/sellerAuthorityService.js', 'export function hasExistingSellerRelationship', 'seller relationship recognition'],
  // OC-4D — surfaces this lineage grew after #208 forked.
  ['../services/evidence/vehicleDocumentOcrService.js', 'async function requireVehicleScope', 'private vehicle-document OCR'],
  ['../services/marketplace/marketplaceInquiryService.js', 'export async function listInquiriesForSeller', 'seller inquiry inbox (buyer contact PII)'],
];

/** Surfaces that legitimately keep their OWN tenant scope — a different authority entirely. */
const NOT_SELLER_AUTHORITY = [
  // OC-5A replaced server.js's mechanicIsAssignedToVehicle (raw tenant equality OR any self-issued work
  // order) with ONE governed relationship: an owner-authorized work order whose ORGANISATION the
  // mechanic verifiably belongs to. It keeps its own scope — the work order's tenant — and is still not
  // seller authority: servicing a car is not selling it.
  ['../services/partsentry/partsentryServiceAuthority.js', 'export async function resolveMechanicServiceRelationship', 'PartSentry mechanic service relationship'],
  ['../middleware/vehicleObjectAuthority.js', 'export async function resolveVehicleObjectAuthority', 'lender/insurer object authority'],
];

/** A tenant RELATIONSHIP grant in any spelling: direct, aliased, or array membership. */
const TENANT_GRANT = /tenant_id\s*===|tenant_id\s*==[^=]|tenantIds?\s*\.\s*includes\s*\(|includes\(\s*[A-Za-z_$][\w$.?]*\.tenant_id|tenantId\s*===|seller_tenant_id/;

function surfaceBody(rel, anchor) {
  const code = src(rel).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const start = code.indexOf(anchor);
  assert.ok(start >= 0, `${rel}: anchor not found — "${anchor}". Update the register if it was renamed.`);
  const rest = code.slice(start + anchor.length);
  const end = rest.search(/\n(?:router|app)\.(?:get|post|patch|put|delete)\(|\n(?:export )?(?:async )?function /);
  return rest.slice(0, end === -1 ? rest.length : end);
}

test('register: every Seller surface that grants on a tenant reaches the governed decision', () => {
  const offenders = [];
  for (const [rel, anchor, label] of SELLER_SURFACES) {
    const body = surfaceBody(rel, anchor);
    if (!TENANT_GRANT.test(body)) continue;
    if (!/hasGovernedDealerVehicleAuthority|dealerTenantAuthorized|resolveDealerListingSubject/.test(body)) offenders.push(`${label} (${rel})`);
  }
  assert.deepEqual(offenders, [], 'route these through hasGovernedDealerVehicleAuthority');
});

test('register: Service Network, PartSentry and object authority keep their OWN scope', () => {
  for (const [rel, anchor, label] of NOT_SELLER_AUTHORITY) {
    const body = surfaceBody(rel, anchor);
    assert.equal(/hasGovernedDealerVehicleAuthority/.test(body), false, `${label}: servicing a car is not selling it`);
    assert.match(body, /tenant_id/, `${label} must still have its own tenant scope`);
  }
});

test('register (OC-5A): a DEALER writing PartSentry reaches the governed Dealer decision; the route grants on no raw tenant', () => {
  // RC1 residual finding A: the route's non-mechanic branch granted on `vehicle.tenant_id ===
  // userContext.tenantId`, so a dealership member with no Dealer authority wrote the dealership's
  // stock and moved its odometer. A dealer now needs the governed decision; raw membership is not it.
  const authority = surfaceBody('../services/partsentry/partsentryServiceAuthority.js', 'export async function resolvePartSentryWriteAuthority');
  assert.match(authority, /hasGovernedDealerVehicleAuthority\(client, userContext, vehicle\)/);
  assert.equal(TENANT_GRANT.test(authority), false, 'no raw tenant equality in the write authority');
  const route = surfaceBody('../server.js', "app.post('/api/partsentry/add'");
  assert.match(route, /resolvePartSentryWriteAuthority\(/);
  assert.equal(TENANT_GRANT.test(route), false, 'the route grants on no raw tenant');
});

/* ══ 6. BEHAVIOUR through the real routes — status and row count, never spelling (P4/F3) ═══════ */

const VIN = 'JTMHY7AJ2K4012345';
function makeWorld() {
  const updates = [];
  const db = {
    users: {
      'u-mech': { id: 'u-mech', role: 'dealer', is_verified: true },    // ADVERSARY: dealer role, mechanic membership
      'u-dlr': { id: 'u-dlr', role: 'dealer', is_verified: true },      // POSITIVE: dealer role, admin membership
      'u-owner': { id: 'u-owner', role: 'owner', is_verified: true },   // owner control
    },
    tenantUsers: { [`${DEALERSHIP}|u-mech`]: { role: 'mechanic' }, [`${DEALERSHIP}|u-dlr`]: { role: 'admin' } },
    tenants: { [DEALERSHIP]: { id: DEALERSHIP, type: 'dealership', status: 'active' } },
    vehicles: {
      [VIN]: {
        vin: VIN, status: 'Available', publication_status: 'published', owner_id: 'u-owner', current_seller_id: 'u-owner',
        tenant_id: DEALERSHIP, price: 15000, currency: 'USD', make: 'Toyota', model: 'Hilux', year: 2019,
      },
    },
    vehicle_evidence: { 'ev-1': { id: 'ev-1', vin: VIN, vehicle_id: VIN, linked_registry_event_id: null } },
  };
  const builder = (table) => {
    const f = {}; let single = false; let upd = null;
    const ok = (d) => ({ data: d, error: null });
    const miss = (m) => ({ data: null, error: { message: m, code: 'PGRST116' } });
    const resolve = () => {
      if (upd) { updates.push({ table, patch: upd }); return ok({ ...(db[table]?.[f.id] || {}), ...upd }); }
      switch (table) {
        case 'user_sessions': return miss('no session');
        case 'users': return db.users[f.id] ? ok(db.users[f.id]) : miss('no user');
        case 'tenant_users': {
          const hit = db.tenantUsers[`${f.tenant_id}|${f.user_id}`];
          if (hit) return single ? ok(hit) : ok([{ ...hit, tenant_id: f.tenant_id }]);
          return single ? miss('no membership') : ok([]);
        }
        case 'tenants': return ok(db.tenants[f.id] || null);
        case 'dealer_profiles': return ok(null);
        case 'vehicles': return db.vehicles[f.vin] ? ok(db.vehicles[f.vin]) : miss('no vehicle');
        case 'vehicle_evidence': {
          if (f.id) return db.vehicle_evidence[f.id] ? ok(db.vehicle_evidence[f.id]) : miss('none');
          const rows = Object.values(db.vehicle_evidence).map((r) => ({
            ...r, visibility_level: 'private', storage_bucket: 'ocr-documents', file_path: 'ev/private.pdf',
            evidence_class: 'registration', evidence_subtype: 'registration_book', metadata: {},
          }));
          return single ? ok(rows[0]) : ok(rows);
        }
        default: return single ? ok({ id: 'mock', vin: VIN, metadata: {} }) : ok([]);
      }
    };
    const c = {
      select: () => c, insert: () => c, update: (p) => { upd = p; return c; }, delete: () => c, upsert: () => c,
      eq: (k, v) => { f[k] = v; return c; }, neq: () => c, is: () => c, in: () => c, or: () => c, ilike: () => c,
      order: () => c, range: () => c, limit: () => c, gte: () => c, lte: () => c, gt: () => c, lt: () => c, not: () => c,
      single: () => { single = true; return c; }, maybeSingle: () => { single = true; return c; },
      then: (r, j) => { try { return Promise.resolve(resolve()).then(r, j); } catch (e) { return j ? j(e) : Promise.reject(e); } },
    };
    return c;
  };
  return { updates, builder };
}

const ADVERSARY = { id: 'u-mech', label: 'platform Dealer with only a MECHANIC membership in the dealership' };
const LEGITIMATE = { id: 'u-dlr', label: 'governed Dealer business actor' };
const OWNER = { id: 'u-owner', label: 'canonical Owner' };

test('behaviour: seller mutations — adversary refused with ZERO effect; Dealer and Owner pass the gate', async (t) => {
  const express = (await import('express')).default;
  const http = await import('node:http');
  const vehiclesRouter = (await import('../routes/vehiclesRoutes.js')).default;
  const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
  const world = makeWorld();
  const saved = { from: supabase.from, rpc: supabase.rpc };
  supabase.from = world.builder;
  supabase.rpc = async () => ({ data: null, error: null });
  const app = express();
  app.use(express.json());
  app.use(vehiclesRouter);
  app.use(errorHandler);
  const server = await new Promise((r) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (actor, method, path, body, tenant = DEALERSHIP) => {
    world.updates.length = 0;
    const headers = { 'content-type': 'application/json', 'x-user-id': actor.id };
    if (tenant) headers['x-tenant-id'] = tenant;
    const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, mutations: world.updates.length, text: await res.text() };
  };
  try {
    for (const [label, method, path, body] of [
      ['publish', 'POST', `/api/vehicles/${VIN}/publish`, {}],
      ['unpublish', 'POST', `/api/vehicles/${VIN}/unpublish`, {}],
      ['reprice', 'PATCH', `/api/vehicles/${VIN}/price`, { price: 99999 }],
      ['set status', 'PATCH', `/api/vehicles/${VIN}/status`, { status: 'Sold' }],
      ['link evidence', 'PATCH', `/api/vehicles/${VIN}/evidence/ev-1/link-event`, { linked_registry_event_id: 'te-1', event_type: 'registration' }],
    ]) {
      await t.test(`${label}: ${ADVERSARY.label} is refused and changes nothing`, async () => {
        const r = await call(ADVERSARY, method, path, body);
        assert.equal(r.status, 403, `${label}: ${r.text.slice(0, 160)}`);
        assert.equal(r.mutations, 0);
      });
      await t.test(`${label}: the ${LEGITIMATE.label} passes the gate`, async () => {
        assert.notEqual((await call(LEGITIMATE, method, path, body)).status, 403);
      });
      await t.test(`${label}: the ${OWNER.label} passes the gate`, async () => {
        assert.notEqual((await call(OWNER, method, path, body, null)).status, 403);
      });
    }
    await t.test('private evidence read: the adversary is not handed private rows; the Dealer is', async () => {
      const read = async (actor) => {
        const res = await fetch(`${base}/api/vehicles/${VIN}/evidence`, { headers: { 'x-user-id': actor.id, 'x-tenant-id': DEALERSHIP } });
        return { status: res.status, text: await res.text() };
      };
      const adversary = await read(ADVERSARY);
      assert.equal(adversary.status, 200, 'the read itself still works');
      assert.equal(/ev\/private\.pdf/.test(adversary.text), false, 'no private storage path for raw membership');
      const dealer = await read(LEGITIMATE);
      assert.equal(dealer.status, 200);
      assert.equal(/ev\/private\.pdf|registration_book/.test(dealer.text), true, 'the governed Dealer does see the private evidence (positive control)');
    });
    await t.test('seller authority state: raw membership is not reported as an existing relationship', async () => {
      const r = await call(ADVERSARY, 'GET', `/api/vehicles/${VIN}/seller-authority`);
      assert.equal(/"recognition_basis"\s*:\s*"existing_relationship"/.test(r.text), false, r.text.slice(0, 200));
    });
  } finally {
    await new Promise((r) => server.close(r));
    supabase.from = saved.from;
    supabase.rpc = saved.rpc;
  }
});

test('behaviour: private document upload via the media router — adversary refused, nothing written', async () => {
  const express = (await import('express')).default;
  const http = await import('node:http');
  const mediaRouter = (await import('../services/storage/mediaRouter.js')).default;
  const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
  const world = makeWorld();
  const saved = { from: supabase.from, rpc: supabase.rpc };
  supabase.from = world.builder;
  supabase.rpc = async () => ({ data: null, error: null });
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/media', mediaRouter);
  app.use(errorHandler);
  const server = await new Promise((r) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r(s)); });
  try {
    world.updates.length = 0;
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/media/upload/document`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': ADVERSARY.id, 'x-tenant-id': DEALERSHIP },
      body: JSON.stringify({ vin: VIN, docType: 'registration_book', document: `data:application/pdf;base64,${Buffer.from('%PDF-1.4').toString('base64')}` }),
    });
    assert.ok(res.status === 403 || res.status === 401, `a mechanic-only membership must not upload a private document; got ${res.status}`);
    assert.equal(world.updates.length, 0);
  } finally {
    await new Promise((r) => server.close(r));
    supabase.from = saved.from;
    supabase.rpc = saved.rpc;
  }
});

/* ══ 7. OC-4D — the seller inquiry inbox (buyer contact PII) ════════════════════════════════════ */

test('inquiry inbox: raw membership never reads the dealership\'s buyers; the governed Dealer and the seller still do', async () => {
  const db = await authorityDb();
  const authority = authorityClient(db);
  const INQUIRIES = [
    { id: 'iq-1', seller_id: null, seller_tenant_id: DEALERSHIP, inquiry_type: 'availability', status: 'new', source_channel: 'web', message: 'Is it available?', guest_name: 'Buyer One', guest_email: 'buyer1@example.invalid', guest_phone: '+263700000001', created_at: '2026-10-01T00:00:00Z' },
    { id: 'iq-2', seller_id: 'u-private-seller', seller_tenant_id: null, inquiry_type: 'availability', status: 'new', source_channel: 'web', message: 'Still for sale?', guest_name: 'Buyer Two', guest_email: 'buyer2@example.invalid', guest_phone: '+263700000002', created_at: '2026-10-02T00:00:00Z' },
  ];
  const client = {
    from(table) {
      if (table === 'marketplace_inquiries') {
        const chain = {
          select: () => chain, order: () => chain, limit: () => chain, range: () => chain, or: () => chain, eq: () => chain,
          then: (r, j) => Promise.resolve({ data: INQUIRIES, error: null }).then(r, j),
        };
        return chain;
      }
      return authority.from(table);
    },
  };
  const ids = async (actor) => (await listInquiriesForSeller(client, actor)).map((i) => i.id).sort();
  assert.deepEqual(await ids({ id: 'u-dealer-mech', role: 'dealer', tenantId: DEALERSHIP }), [], 'a dealership MECHANIC reads no buyer contacts');
  assert.deepEqual(await ids({ id: 'u-admin', role: 'admin', tenantId: DEALERSHIP }), [], 'nor does an admin-role membership');
  assert.deepEqual(await ids({ id: 'u-dealer-gadmin', role: 'dealer', tenantId: GARAGE }), [], 'nor a garage admin');
  assert.deepEqual(await ids({ id: 'u-dealer', role: 'dealer', tenantId: DEALERSHIP }), ['iq-1'], 'the governed Dealer still reads its inbox');
  assert.deepEqual(await ids({ id: 'u-private-seller', role: 'owner', tenantId: null }), ['iq-2'], 'the seller_id leg is unchanged');
  await db.close();
});
