/**
 * O2 — I-round closure (I-1 idempotency, I-2 listing authority).
 *
 * I-1's proof runs against a REAL PostgreSQL (PGlite) with the branch's own migration DDL, the
 * real column, the real partial unique index and the application's own insert shape. The H-round
 * proof threw a synthetic `{code:'23505'}` from its own createFn, which certified the recovery
 * branch and nothing about the database. Nothing here manufactures a violation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  withUploadIdempotency,
  idempotencyScopeKey,
  isIdempotencyUniqueViolation,
  isUndefinedColumnError,
  IDEMPOTENCY_CONSTRAINT,
} from '../services/evidence/uploadIdempotency.js';
import { buildVehicleListingCandidate, getListingEligibility } from '../services/marketplace/marketplaceListingEligibility.js';
import { resolveWorkbookCatalogue } from '../services/workbook/workbookCatalogueService.js';

/* ── a real database, built from the branch's own migration ────────────────────────────── */
async function evidenceDb({ withMigration = true } = {}) {
  const db = new PGlite();
  await db.exec(`CREATE TABLE vehicle_evidence (
    id text PRIMARY KEY, vin text, vehicle_id text, evidence_type text, file_url text,
    mime_type text, uploaded_by text, uploader_role text, verification_status text,
    trust_score_impact int, trust_impact int, metadata jsonb NOT NULL DEFAULT '{}'::jsonb);`);
  if (withMigration) {
    const sql = readFileSync(fileURLToPath(new URL(
      '../../database/migrations/20260908120000_vehicle_evidence_upload_idempotency.sql', import.meta.url)), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    for (const stmt of sql.match(/(ALTER TABLE[\s\S]*?;|CREATE UNIQUE INDEX[\s\S]*?;)/g) || []) {
      await db.exec(stmt.replace(/public\./g, ''));
    }
  }
  return db;
}

/** The canonical writer's shape: insertData + the top-level key + the metadata mirror. */
function applyWriter(db, { withColumn = true } = {}) {
  let n = 0;
  return async ({ vin, key }) => {
    n += 1;
    const id = `ev-${n}`;
    const cols = ['id', 'vin', 'vehicle_id', 'evidence_type', 'file_url', 'mime_type',
      'uploaded_by', 'uploader_role', 'verification_status', 'trust_score_impact', 'trust_impact', 'metadata'];
    const vals = [id, vin, vin, 'registration_book', 'https://f/a.pdf', 'application/pdf',
      'u1', 'owner', 'pending', 0, 0, JSON.stringify(key ? { idempotency_key: key } : {})];
    if (withColumn && key) { cols.push('idempotency_key'); vals.push(key); }
    const placeholders = cols.map((_, i) => `$${i + 1}${cols[i] === 'metadata' ? '::jsonb' : ''}`).join(', ');
    // RETURNING must not name a column that may not exist yet — that is the pre-migration state.
    const returning = withColumn ? 'id, vin, idempotency_key' : 'id, vin';
    const { rows } = await db.query(
      `INSERT INTO vehicle_evidence (${cols.join(', ')}) VALUES (${placeholders}) RETURNING ${returning};`, vals);
    return rows[0];
  };
}

/**
 * A supabase double whose reads go to the REAL database.
 * J-2: the lookup is ACTOR-scoped, so this double applies that filter too — a double that ignored
 * it would let an unscoped (cross-actor leaking) lookup pass as though it were correct.
 */
const ACTOR = 'u1'; // the uploader `applyWriter` records on every row
const supabaseOver = (db) => ({
  from: () => ({
    select: () => {
      const state = { actorId: undefined, key: null };
      const chain = {
        eq(col, value) { if (col === 'uploaded_by') state.actorId = value; return chain; },
        or(filter) { state.key = String(filter).match(/idempotency_key\.eq\.([^,]+)/)?.[1] ?? null; return chain; },
        async limit() {
          if (state.actorId === undefined) return { data: null, error: { message: 'lookup was not actor-scoped' } };
          const { rows } = await db.query(
            `SELECT id, vin, uploaded_by, metadata, idempotency_key FROM vehicle_evidence
              WHERE uploaded_by = $2 AND (idempotency_key = $1 OR metadata->>'idempotency_key' = $1) LIMIT 1;`,
            [state.key, state.actorId]);
          return { data: rows, error: null };
        },
      };
      return chain;
    },
  }),
});

/* ── I-1 ───────────────────────────────────────────────────────────────────────────────── */
test('I-1 (2): the real application write populates the TOP-LEVEL indexed column', async () => {
  const db = await evidenceDb();
  const row = await applyWriter(db)({ vin: 'VIN-A', key: 'wb:b1:1:0' });
  assert.equal(row.idempotency_key, 'wb:b1:1:0', 'the column the unique index constrains must be written');
  const { rows } = await db.query(`SELECT metadata->>'idempotency_key' m FROM vehicle_evidence WHERE id=$1;`, [row.id]);
  assert.equal(rows[0].m, 'wb:b1:1:0', '(3) and the metadata mirror is retained for the historical corpus');
  await db.close();
});

test('I-1 (4,5): two CONCURRENT same-key writes leave ONE row, and both callers get the same id', async () => {
  const db = await evidenceDb();
  const write = applyWriter(db);
  const supabase = supabaseOver(db);
  const store = new Map();
  // A genuine race: both callers miss the lookup, both attempt the insert, PostgreSQL decides.
  const create = () => write({ vin: 'VIN-A', key: 'wb:b1:1:0' });
  const [a, b] = await Promise.all([
    withUploadIdempotency('wb:b1:1:0', 'VIN-A', create, { store, supabase, actorId: ACTOR }),
    withUploadIdempotency('wb:b1:1:0', 'VIN-A', create, { store, supabase, actorId: ACTOR }),
  ]);
  const { rows } = await db.query(`SELECT count(*)::int c FROM vehicle_evidence WHERE idempotency_key='wb:b1:1:0';`);
  assert.equal(rows[0].c, 1, 'the database refused the loser — exactly one persistent evidence row');
  assert.equal(a.evidenceId, b.evidenceId, 'both callers converge on the same evidence');
  assert.equal([a.deduped, b.deduped].filter(Boolean).length, 1, 'exactly one caller is told it deduped');
  await db.close();
});

test('I-1 (6,7): different keys make different rows; the collision domain suppresses nothing legitimate', async () => {
  const db = await evidenceDb();
  const write = applyWriter(db);
  const supabase = supabaseOver(db);
  const store = new Map();
  const mk = (key, vin) => withUploadIdempotency(key, vin, () => write({ vin, key }), { store, supabase, actorId: ACTOR });
  await mk('wb:b1:1:0', 'VIN-A');   // first evidence item on row 1
  await mk('wb:b1:1:1', 'VIN-A');   // second item on the SAME row — a distinct legitimate upload
  await mk('wb:b1:2:0', 'VIN-B');   // a different workbook row / VIN
  await mk('wb:b2:1:0', 'VIN-A');   // the same row in a DIFFERENT batch
  const { rows } = await db.query(`SELECT count(*)::int c FROM vehicle_evidence;`);
  assert.equal(rows[0].c, 4, 'a unique key must not turn evidence history into deduplication');
  await db.close();
});

test('I-1 (8,9): an unrelated 23505, and FK/RLS/validation failures, are NOT swallowed', async () => {
  const db = await evidenceDb();
  const supabase = supabaseOver(db);
  const store = new Map();
  // A primary-key clash is a real 23505 that has nothing to do with idempotency.
  await db.query(`INSERT INTO vehicle_evidence (id, vin) VALUES ('fixed-id','VIN-A');`);
  await assert.rejects(
    () => withUploadIdempotency('wb:x:1:0', 'VIN-A', async () => {
      const { rows } = await db.query(`INSERT INTO vehicle_evidence (id, vin) VALUES ('fixed-id','VIN-A') RETURNING id;`);
      return rows[0];
    }, { store, supabase, actorId: ACTOR }),
    (error) => { assert.equal(error.code, '23505'); assert.match(String(error.constraint || error.message), /pkey/); return true; },
    'a primary-key violation must propagate, never become a silent dedupe',
  );
  for (const other of [
    { code: '23503', message: 'insert or update violates foreign key constraint' },
    { code: '42501', message: 'new row violates row-level security policy' },
    { code: '23502', message: 'null value in column violates not-null constraint' },
  ]) {
    await assert.rejects(
      () => withUploadIdempotency('wb:y:1:0', 'VIN-A', async () => { throw Object.assign(new Error(other.message), { code: other.code }); },
        { store: new Map(), supabase, actorId: ACTOR }),
      (e) => { assert.equal(e.code, other.code); return true; },
    );
  }
  await db.close();
});

test('I-1 (1): PRE-MIGRATION the column does not exist, and ordinary upload still works', async () => {
  const db = await evidenceDb({ withMigration: false });
  const cols = await db.query(`SELECT column_name FROM information_schema.columns
    WHERE table_name='vehicle_evidence' AND column_name='idempotency_key';`);
  assert.equal(cols.rows.length, 0, 'precondition: the migration is not applied');
  // The writer's fallback path: the column write fails 42703 and the pre-migration shape is used.
  let undefinedColumn = null;
  try { await applyWriter(db)({ vin: 'VIN-A', key: 'wb:b1:1:0' }); } catch (e) { undefinedColumn = e; }
  assert.ok(undefinedColumn, 'writing the column pre-migration does fail');
  assert.equal(isUndefinedColumnError(undefinedColumn, 'idempotency_key'), true,
    'and it is recognised as the ONE condition the fallback may act on');
  const row = await applyWriter(db, { withColumn: false })({ vin: 'VIN-A', key: 'wb:b1:1:0' });
  assert.ok(row.id, 'the pre-migration write succeeds — uploads are not broken by deploy order');
  await db.close();
});

test('I-1: the recovery is scoped to the idempotency index by name', () => {
  assert.equal(IDEMPOTENCY_CONSTRAINT, 'uq_vehicle_evidence_idempotency_key');
  assert.equal(isIdempotencyUniqueViolation({ code: '23505', constraint: IDEMPOTENCY_CONSTRAINT }), true);
  assert.equal(isIdempotencyUniqueViolation({ code: '23505', constraint: 'vehicle_evidence_pkey' }), false);
  assert.equal(isUndefinedColumnError({ code: '42703', message: 'column "idempotency_key" does not exist' }, 'idempotency_key'), true);
  assert.equal(isUndefinedColumnError({ code: '42501', message: 'rls' }, 'idempotency_key'), false);
});

test('I-1 (10): a failure BEFORE the insert claims no key, so the retry still creates exactly once', async () => {
  const db = await evidenceDb();
  const supabase = supabaseOver(db);
  const store = new Map();
  await assert.rejects(() => withUploadIdempotency('wb:b3:1:0', 'VIN-A',
    async () => { throw new Error('object storage unavailable'); }, { store, supabase, actorId: ACTOR }));
  assert.equal(store.has(idempotencyScopeKey(ACTOR, 'wb:b3:1:0')), false, 'a failed attempt must not claim the key');
  const after = await withUploadIdempotency('wb:b3:1:0', 'VIN-A',
    () => applyWriter(db)({ vin: 'VIN-A', key: 'wb:b3:1:0' }), { store, supabase, actorId: ACTOR });
  assert.equal(after.deduped, false);
  const { rows } = await db.query(`SELECT count(*)::int c FROM vehicle_evidence WHERE idempotency_key='wb:b3:1:0';`);
  assert.equal(rows[0].c, 1);
  await db.close();
});

test('I-1: after a restart (cold cache) the DURABLE lookup still dedupes', async () => {
  const db = await evidenceDb();
  const supabase = supabaseOver(db);
  await withUploadIdempotency('wb:b4:1:0', 'VIN-A', () => applyWriter(db)({ vin: 'VIN-A', key: 'wb:b4:1:0' }),
    { store: new Map(), supabase, actorId: ACTOR });
  const afterRestart = await withUploadIdempotency('wb:b4:1:0', 'VIN-A',
    async () => { throw new Error('must not be called'); }, { store: new Map(), supabase, actorId: ACTOR });
  assert.equal(afterRestart.deduped, true, 'the durable lookup, not the process cache, settles it');
  await db.close();
});

/* ── I-2 ───────────────────────────────────────────────────────────────────────────────── */
const OWNER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const TENANT_A = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const TENANT_B = '22222222-3333-4444-8555-666666666666';
const body = { vin: 'JTMHY7AJ2K4012345', make: 'Toyota', model: 'Hilux', year: 2019, price: 15000, currency: 'USD', mileage: 90000, city: 'Harare', description: 'A well maintained vehicle.' };
// J-3 — a dealer's tenant subject now comes from the governed `dealer_profiles` binding that
// `resolveDealerListingSubject` returns. Passing it explicitly keeps these I-2 assertions about
// what they were always about (who may be the seller) while telling the truth about where the
// tenant comes from.
const grantedFor = (tenantId) => ({ granted: true, tenantId, dealerProfileId: 'dp-i2', reason: null });
const subject = (extra, userContext, dealerListingSubject = null) => {
  const c = buildVehicleListingCandidate({ body: { ...body, ...extra }, userContext, dealerListingSubject });
  return { owner: c.owner_id, tenant: c.tenant_id, type: c.current_seller_type, eligible: getListingEligibility(c).eligible };
};
const refused = { owner: null, tenant: null, type: null, eligible: false };

test('I-2 (1): Owner still lists their own vehicle under Owner authority', () => {
  assert.deepEqual(subject({}, { id: OWNER_ID, role: 'owner', tenantId: null }),
    { owner: OWNER_ID, tenant: null, type: 'Private Owner', eligible: true });
});

test('I-2 (2,3,4): a genuine Dealer lists for its validated tenant, and only that one', () => {
  assert.deepEqual(subject({}, { id: 'd1', role: 'dealer', tenantId: TENANT_A }, grantedFor(TENANT_A)),
    { owner: null, tenant: TENANT_A, type: 'Dealer', eligible: true });
  // J-3: the SAME dealer, same header, but no governed dealership → no subject at all.
  assert.deepEqual(subject({}, { id: 'd1', role: 'dealer', tenantId: TENANT_A }), refused,
    'a validated tenant header is membership, not selling authority');
  // revoked / absent membership: authorizeRole leaves tenantId null, so there is no subject
  assert.equal(subject({}, { id: 'd1', role: 'dealer', tenantId: null }).eligible, false);
  // a foreign tenant never reaches here — authorizeRole 403s on the header — and the BODY cannot
  // substitute for it either.
  assert.equal(subject({ tenant_id: TENANT_B }, { id: 'd1', role: 'dealer', tenantId: TENANT_A }, grantedFor(TENANT_A)).tenant, TENANT_A);
});

test('I-2 (5,6,7,8): an Admin is NOT a Dealer — with no tenant, or with ANY tenant membership', () => {
  assert.deepEqual(subject({}, { id: 'a1', role: 'admin', tenantId: null }), refused);
  for (const tenantRole of ['admin', 'manager', 'mechanic', 'member']) {
    assert.deepEqual(subject({}, { id: 'a1', role: 'admin', tenantId: TENANT_A, tenantRole }), refused,
      `tenant role '${tenantRole}' must not confer Dealer selling authority`);
  }
});

test('I-2 (9): Government with a tenant membership is not a Dealer either', () => {
  assert.deepEqual(subject({}, { id: 'g1', role: 'government', tenantId: TENANT_A }), refused);
});

test('I-2 (10,11,12): forged body owner_id / tenant_id / current_seller_type all grant nothing', () => {
  const admin = { id: 'a1', role: 'admin', tenantId: null };
  assert.deepEqual(subject({ owner_id: OWNER_ID }, admin), refused);
  assert.deepEqual(subject({ tenant_id: TENANT_A }, admin), refused);
  assert.deepEqual(subject({ current_seller_type: 'Dealer' }, admin), refused);
  assert.deepEqual(subject({ owner_id: OWNER_ID, tenant_id: TENANT_A, current_seller_type: 'Dealer' }, admin), refused);
});

test('I-2 (13): an asserted x-user-id is not authority — the subject comes from userContext', () => {
  // The candidate reads userContext only; a body-borne identity has no path into the subject.
  assert.deepEqual(subject({ user_id: OWNER_ID, 'x-user-id': OWNER_ID }, { id: 'a1', role: 'admin', tenantId: TENANT_A }), refused);
});

test('I-2 (14): the catalogue mirrors the canonical subject exactly — no role-only offer', async () => {
  // The catalogue now consumes the governed dealership (J-4), so the double must model one:
  // `d1` IS the dealer for TENANT_A; nobody else is a dealer anywhere.
  const stub = (userId, tenantId) => ({
    supabaseClient: {
      from: (table) => ({
        select: () => {
          const f = {};
          const chain = {
            eq(k, v) { f[k] = v; return chain; },
            async maybeSingle() {
              // K-3: the governed relationship is a COMPOSITION — an active dealership-typed tenant
              // plus a membership that acts for the business. `d1` IS the dealer for TENANT_A.
              if (table === 'dealer_profiles') return { data: null, error: null };
              if (table === 'tenants') {
                return {
                  data: f.id === TENANT_A
                    ? { id: TENANT_A, type: 'dealership', status: 'active' }
                    : { id: f.id, type: 'garage', status: 'active' },
                  error: null,
                };
              }
              if (table === 'tenant_users') {
                const hit = f.user_id === 'd1' && f.tenant_id === TENANT_A;
                return { data: hit ? { role: 'admin' } : null, error: null };
              }
              return { data: null, error: null };
            },
            then: (r) => Promise.resolve({ data: [], error: null }).then(r),
          };
          return chain;
        },
      }),
    },
  });
  const offered = async (actor) => (await resolveWorkbookCatalogue(actor, stub(actor.id, actor.tenantId)))
    .available.some((t) => t.template_key === 'seller_vehicles');
  assert.equal(await offered({ id: 'o1', role: 'owner' }), true);
  assert.equal(await offered({ id: 'd1', role: 'dealer', tenantId: TENANT_A }), true);
  assert.equal(await offered({ id: 'a1', role: 'admin', tenantId: TENANT_A }), false, 'the H-round offered this; I-2 removes it');
  assert.equal(await offered({ id: 'g1', role: 'government', tenantId: TENANT_A }), false);
});

test('I-2 (15): no Dealer capability, compliance state or activation is fabricated', () => {
  const source = readFileSync(fileURLToPath(new URL('../services/marketplace/marketplaceListingEligibility.js', import.meta.url)), 'utf8');
  // Comments explain WHY the authority lives elsewhere; the guard is about executable code.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const invented of ['compliance_review_state', 'activateDealer', 'grantDealer', 'dealer_capability']) {
    assert.equal(code.includes(invented), false,
      `${invented} would be a new dealer authority invented to make a test pass`);
  }
  // Stronger than the original name-check: this module decides the subject from values handed to
  // it and queries NOTHING, so it cannot mint an authority of its own however it is called.
  assert.equal(/\.from\(|supabase|await /.test(code), false,
    'the listing candidate must stay a pure function over the resolved authority');
});

/* ── I-7 — the REAL middleware derivation, not a hand-built actor ───────────────────────── */
/**
 * The H-round execute tests supplied actor objects the test itself wrote. That proves the service
 * contract and nothing about how a request becomes an actor. These drive the ACTUAL
 * `authorizeRole` middleware — session lookup, platform role, `tenant_users` membership check,
 * effective-role resolution — and then feed the `req.userContext` IT produced into the canonical
 * subject derivation. No dependency is added: the middleware is invoked as the route invokes it.
 *
 * Scope, stated plainly: this proves MIDDLEWARE-DERIVED authority. It does not exercise HTTP
 * transport, CSRF or the express router itself.
 */
import { authorizeRole } from '../middleware/authMiddleware.js';

function fakeSupabase({ users = {}, sessions = {}, memberships = [] }) {
  return {
    from(table) {
      const api = { _t: table, _f: [] };
      api.select = () => api;
      api.eq = (c, v) => { api._f.push([c, v]); return api; };
      api.single = async () => {
        const val = (c) => api._f.find(([k]) => k === c)?.[1];
        if (api._t === 'user_sessions') {
          const s = sessions[val('token')];
          return s ? { data: s, error: null } : { data: null, error: { message: 'not found' } };
        }
        if (api._t === 'users') {
          const u = users[val('id')];
          return u ? { data: u, error: null } : { data: null, error: { message: 'not found' } };
        }
        if (api._t === 'tenant_users') {
          const m = memberships.find((x) => x.tenant_id === val('tenant_id') && x.user_id === val('user_id'));
          return m ? { data: { role: m.role }, error: null } : { data: null, error: { message: 'no membership' } };
        }
        return { data: null, error: null };
      };
      api.maybeSingle = api.single;
      api.then = (res, rej) => api.single().then(res, rej);
      return api;
    },
  };
}

/** Run the real middleware and return whatever it decided. */
async function deriveViaMiddleware({ headers = {}, store, options = {} }) {
  const req = { headers, body: {}, params: {}, query: {} };
  let status = 200; let payload = null; let userContext = null;
  const res = { status(c) { status = c; return res; }, json(b) { payload = b; return res; } };
  await new Promise((resolve) => {
    authorizeRole([], { supabaseClient: fakeSupabase(store), ...options })(req, res, () => { userContext = req.userContext; resolve(); });
    setTimeout(resolve, 50);
  });
  if (!userContext) return { refused: true, status, payload };
  const c = buildVehicleListingCandidate({ body, userContext });
  return {
    refused: false,
    role: userContext.role,
    tenantId: userContext.tenantId ?? null,
    subject: { owner: c.owner_id, tenant: c.tenant_id, type: c.current_seller_type },
    eligible: getListingEligibility(c).eligible,
  };
}

const ADMIN_ID = 'admin-user-1';
const STORE = {
  users: {
    [OWNER_ID]: { id: OWNER_ID, role: 'owner', is_verified: true },
    [ADMIN_ID]: { id: ADMIN_ID, role: 'admin', is_verified: true },
  },
  sessions: {
    'tok-owner': { user_id: OWNER_ID, is_valid: true, expires_at: '2099-01-01T00:00:00Z' },
    'tok-admin': { user_id: ADMIN_ID, is_valid: true, expires_at: '2099-01-01T00:00:00Z' },
  },
  memberships: [
    { tenant_id: TENANT_A, user_id: ADMIN_ID, role: 'admin' },
    { tenant_id: TENANT_A, user_id: OWNER_ID, role: 'mechanic' },
  ],
};

test('I-7: a middleware-derived OWNER produces the SAME subject the service tests certify', async () => {
  const r = await deriveViaMiddleware({ headers: { 'x-session-token': 'tok-owner' }, store: STORE });
  assert.equal(r.refused, false);
  assert.equal(r.role, 'owner');
  assert.deepEqual(r.subject, { owner: OWNER_ID, tenant: null, type: 'Private Owner' });
  assert.equal(r.eligible, true);
});

test('I-7: a forged x-tenant-id with no membership is refused by the middleware itself', async () => {
  const r = await deriveViaMiddleware({ headers: { 'x-session-token': 'tok-owner', 'x-tenant-id': TENANT_B }, store: STORE });
  assert.equal(r.refused, true);
  assert.equal(r.status, 403);
  assert.match(String(r.payload?.error), /do not have access to this tenant/i);
});

test('I-7: a middleware-derived ADMIN with a REAL tenant-admin membership is still not a Dealer', async () => {
  const r = await deriveViaMiddleware({ headers: { 'x-session-token': 'tok-admin', 'x-tenant-id': TENANT_A }, store: STORE });
  assert.equal(r.refused, false);
  assert.equal(r.tenantId, TENANT_A, 'the membership really is established by the middleware');
  assert.deepEqual(r.subject, { owner: null, tenant: null, type: null }, 'and confers no selling authority');
  assert.equal(r.eligible, false);
});

test('I-7: a MECHANIC membership confers nothing — the owner path still governs that account', async () => {
  const r = await deriveViaMiddleware({ headers: { 'x-session-token': 'tok-owner', 'x-tenant-id': TENANT_A }, store: STORE });
  assert.equal(r.refused, false);
  assert.equal(r.tenantId, TENANT_A);
  assert.equal(r.subject.type, 'Private Owner', 'their OWN authority, never the tenant\'s');
  assert.equal(r.subject.tenant, null);
});

test('I-7: an unauthenticated request never reaches a subject at all', async () => {
  const r = await deriveViaMiddleware({ headers: {}, store: STORE });
  assert.equal(r.refused, true);
  assert.ok(r.status === 401 || r.status === 403, `expected a refusal, got ${r.status}`);
});

test('I-7: an asserted x-user-id never carries a proven session, and is refused where it matters', async () => {
  // The fallback exists and is env-gated; the honest assertion is what it PRODUCES, not that it
  // is universally refused. On a route that opts out (authorizeSessionRole → allowUserIdFallback
  // false, which every step-up-gated route uses) it is refused outright.
  const refusedRoute = await deriveViaMiddleware({
    headers: { 'x-user-id': ADMIN_ID }, store: STORE, options: { allowUserIdFallback: false },
  });
  assert.equal(refusedRoute.refused, true, 'a sensitive route must never accept an asserted identity');

  // And even where the fallback is permitted, it cannot become Dealer selling authority.
  const permissive = await deriveViaMiddleware({
    headers: { 'x-user-id': ADMIN_ID, 'x-tenant-id': TENANT_A }, store: STORE,
  });
  if (!permissive.refused) {
    assert.deepEqual(permissive.subject, { owner: null, tenant: null, type: null },
      'an asserted identity plus a tenant header is still not a seller');
    assert.equal(permissive.eligible, false);
  }
});
