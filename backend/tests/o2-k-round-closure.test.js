/**
 * O2 — K-round closure.
 *
 * K1  the writer had a missing-column fallback; the READ side did not. Because staging has no
 *     `idempotency_key` column yet, the durable lookup's SELECT failed outright and the
 *     metadata dedupe that existed BEFORE the column was authored stopped working — a cold start
 *     created a duplicate for a plain sequential retry.
 * K2  a key bound to (actor, VIN) still could not tell two DIFFERENT uploads apart: the same key
 *     re-used on the same vehicle for a different class/subtype/checksum was told `deduped:true`
 *     and the second upload was discarded.
 * K3  the J-round made `dealer_profiles.tenant_id` the sole Dealer subject. Nothing writes it, so
 *     every current Dealer lost listing authority. The governed fact CarUp already had is the
 *     organisation itself.
 * K4  `dealer_vehicle_inventory` still advertised `import` from the role string alone.
 *
 * Databases here are real PostgreSQL (PGlite). Doubles answer FAITHFULLY — they apply exactly the
 * filters they are given — so an under-scoped query yields the real wrong answer rather than a
 * protective error that would hide the defect.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {
  withUploadIdempotency,
  lookupBySupabase,
  toDatabaseError,
  idempotencyScopeKey,
  OPERATION_IDENTITY_FIELDS,
  IDEMPOTENCY_OPERATION_CONFLICT,
  IDEMPOTENCY_SCOPE_CONFLICT,
} from '../services/evidence/uploadIdempotency.js';
import {
  resolveDealerListingSubject,
  DEALER_SUBJECT_REASONS,
  DEALERSHIP_TENANT_TYPES,
  BUSINESS_AUTHORITY_MEMBERSHIP_ROLES,
} from '../services/dealer/dealerListingAuthority.js';
import { buildVehicleListingCandidate, getListingEligibility } from '../services/marketplace/marketplaceListingEligibility.js';
import { resolveWorkbookCatalogue, WORKBOOK_ACTIONS } from '../services/workbook/workbookCatalogueService.js';

/* ══ evidence database, in both rolling states ═════════════════════════════════════════ */

async function evidenceDb({ withColumn }) {
  const db = new PGlite();
  await db.exec(`CREATE TABLE vehicle_evidence (
    id text PRIMARY KEY, vin text, uploaded_by text,
    evidence_class text, evidence_subtype text, evidence_type text, checksum text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb${withColumn ? ', idempotency_key text' : ''});`);
  if (withColumn) {
    await db.exec(`CREATE UNIQUE INDEX uq_vehicle_evidence_idempotency_key
      ON vehicle_evidence (uploaded_by, idempotency_key)
      WHERE idempotency_key IS NOT NULL AND uploaded_by IS NOT NULL;`);
  }
  return db;
}

/** The set of columns that actually exist — naming any other is an error, as PostgREST returns. */
const BASE_COLUMNS = ['id', 'vin', 'uploaded_by', 'evidence_class', 'evidence_subtype', 'evidence_type', 'checksum', 'metadata'];

function pgrestClient(db, { withColumn, failWith = null }) {
  const columns = new Set(withColumn ? [...BASE_COLUMNS, 'idempotency_key'] : BASE_COLUMNS);
  const calls = [];
  const client = {
    from: () => ({
      select: (cols) => {
        const f = { named: cols.split(',').map((c) => c.trim()), actor: undefined, key: null, viaColumn: false };
        const chain = {
          eq(col, value) {
            if (col === 'uploaded_by') f.actor = value;
            if (col === 'metadata->>idempotency_key') f.key = value;
            return chain;
          },
          or(filter) {
            f.key = String(filter).match(/idempotency_key\.eq\.([^,]+)/)?.[1] ?? null;
            f.viaColumn = true;
            return chain;
          },
          async limit() {
            calls.push({ named: [...f.named], viaColumn: f.viaColumn, actor: f.actor });
            if (failWith) return { data: null, error: failWith };
            const missing = f.named.filter((c) => !columns.has(c));
            if (missing.length || (f.viaColumn && !withColumn)) {
              return { data: null, error: { code: '42703', message: `column vehicle_evidence.${missing[0] || 'idempotency_key'} does not exist` } };
            }
            const { rows } = await db.query(
              `SELECT ${[...columns].join(', ')} FROM vehicle_evidence
                WHERE ($2::text IS NULL OR uploaded_by = $2)
                  AND (metadata->>'idempotency_key' = $1${withColumn ? ' OR idempotency_key = $1' : ''}) LIMIT 1;`,
              [f.key, f.actor === undefined ? null : f.actor]);
            return { data: rows, error: null };
          },
        };
        return chain;
      },
    }),
  };
  client.__calls = calls;
  return client;
}

let seq = 0;
function appWriter(db, { withColumn }) {
  return async ({ vin, key, actor, op }) => {
    seq += 1;
    const cols = ['id', 'vin', 'uploaded_by', 'evidence_class', 'evidence_subtype', 'evidence_type', 'checksum', 'metadata'];
    const vals = [`ev-${seq}`, vin, actor, op.evidence_class, op.evidence_subtype, op.evidence_type, op.checksum,
      JSON.stringify(key ? { idempotency_key: key } : {})];
    if (withColumn && key) { cols.push('idempotency_key'); vals.push(key); }
    const ph = cols.map((_, i) => `$${i + 1}${cols[i] === 'metadata' ? '::jsonb' : ''}`).join(', ');
    let data = null; let error = null;
    try {
      const { rows } = await db.query(
        `INSERT INTO vehicle_evidence (${cols.join(', ')}) VALUES (${ph}) RETURNING id, vin;`, vals);
      data = rows[0];
    } catch (e) {
      error = { message: e.message, code: e.code, constraint: e.constraint, details: e.detail };
    }
    if (error) throw toDatabaseError(error); // the deployed translation
    return data;
  };
}

const OP_A = { evidence_class: 'registration', evidence_subtype: 'registration_book', evidence_type: 'registration_book', checksum: 'SUM-A' };
const OP_B = { evidence_class: 'auction', evidence_subtype: 'auction_sheet', evidence_type: 'auction_sheet', checksum: 'SUM-B' };

const upload = (db, { withColumn, store, client, key, vin, actor = 'u1', op = OP_A }) =>
  withUploadIdempotency(key, vin, () => appWriter(db, { withColumn })({ vin, key, actor, op }),
    { store, supabase: client, actorId: actor, operation: op });

/* ══ K1 — the durable guarantee in BOTH rolling states ═════════════════════════════════ */

test('K1: PRE-MIGRATION, a cold-cache retry still dedupes through the metadata mirror', async () => {
  const db = await evidenceDb({ withColumn: false });
  const client = pgrestClient(db, { withColumn: false });
  const first = await upload(db, { withColumn: false, store: new Map(), client, key: 'K', vin: 'VIN-A' });
  // A fresh process: the in-memory map is gone and only the database can answer.
  const retry = await upload(db, { withColumn: false, store: new Map(), client, key: 'K', vin: 'VIN-A' });

  assert.equal(retry.deduped, true, 'the durable lookup, not the process cache, must settle this');
  assert.equal(retry.evidenceId, first.evidenceId);
  const { rows } = await db.query(`SELECT count(*)::int c FROM vehicle_evidence;`);
  assert.equal(rows[0].c, 1, 'one operation, one evidence row — even before the migration lands');
  // And it got there by falling back, not by luck: the canonical attempt was made first.
  assert.equal(client.__calls.length >= 2, true);
  assert.equal(client.__calls.at(-1).named.includes('idempotency_key'), false,
    'the compatibility read must name NO column the pre-migration schema lacks');
  await db.close();
});

test('K1: POST-MIGRATION, the canonical column answers and no fallback is needed', async () => {
  const db = await evidenceDb({ withColumn: true });
  const client = pgrestClient(db, { withColumn: true });
  const first = await upload(db, { withColumn: true, store: new Map(), client, key: 'K', vin: 'VIN-A' });
  const retry = await upload(db, { withColumn: true, store: new Map(), client, key: 'K', vin: 'VIN-A' });
  assert.equal(retry.deduped, true);
  assert.equal(retry.evidenceId, first.evidenceId);
  assert.equal(client.__calls.every((c) => c.named.includes('idempotency_key')), true,
    'post-migration every read is the canonical one — metadata is not the authority again');
  await db.close();
});

test('K1: POST-MIGRATION concurrency is still settled by the database', async () => {
  const db = await evidenceDb({ withColumn: true });
  const client = pgrestClient(db, { withColumn: true });
  const store = new Map();
  const go = () => upload(db, { withColumn: true, store, client, key: 'K', vin: 'VIN-A' });
  const [a, b] = await Promise.all([go(), go()]);
  assert.equal(a.evidenceId, b.evidenceId);
  const { rows } = await db.query(`SELECT count(*)::int c FROM vehicle_evidence;`);
  assert.equal(rows[0].c, 1);
  await db.close();
});

test('K1: a NON-schema error never reaches the compatibility read', async () => {
  const db = await evidenceDb({ withColumn: true });
  for (const failWith of [
    { code: '42501', message: 'new row violates row-level security policy' },
    { code: 'PGRST301', message: 'JWT expired' },
    { code: '23503', message: 'insert or update violates foreign key constraint' },
    { code: 'ECONNRESET', message: 'network error' },
    { code: '42601', message: 'syntax error at or near' },
  ]) {
    const client = pgrestClient(db, { withColumn: true, failWith });
    const found = await lookupBySupabase(client, 'K', { actorId: 'u1' });
    assert.equal(found, null, `${failWith.code} must degrade to "treat as new"`);
    assert.equal(client.__calls.length, 1,
      `${failWith.code} must NOT trigger the missing-column compatibility read`);
  }
  await db.close();
});

test('K1: the actor scope survives BOTH lookup forms', async () => {
  for (const withColumn of [false, true]) {
    const db = await evidenceDb({ withColumn });
    const client = pgrestClient(db, { withColumn });
    await upload(db, { withColumn, store: new Map(), client, key: 'K', vin: 'VIN-A', actor: 'u1' });
    const theirs = await upload(db, { withColumn, store: new Map(), client, key: 'K', vin: 'VIN-B', actor: 'u2' });
    assert.equal(theirs.deduped, false, `withColumn=${withColumn}: no cross-actor suppression`);
    assert.equal(client.__calls.every((c) => c.actor !== undefined), true,
      `withColumn=${withColumn}: every lookup is actor-scoped`);
    await db.close();
  }
});

/* ══ K2 — operation identity ═══════════════════════════════════════════════════════════ */

test('K2 (1,2): the SAME operation dedupes, sequentially and concurrently', async () => {
  for (const concurrent of [false, true]) {
    const db = await evidenceDb({ withColumn: true });
    const client = pgrestClient(db, { withColumn: true });
    const store = new Map();
    const go = () => upload(db, { withColumn: true, store, client, key: 'K', vin: 'VIN-A', op: OP_A });
    const [a, b] = concurrent ? await Promise.all([go(), go()]) : [await go(), await go()];
    assert.equal(a.evidenceId, b.evidenceId, `concurrent=${concurrent}`);
    const { rows } = await db.query(`SELECT count(*)::int c FROM vehicle_evidence;`);
    assert.equal(rows[0].c, 1, `concurrent=${concurrent}: one operation, one row`);
    await db.close();
  }
});

test('K2 (3): same key, DIFFERENT VIN → 409 (the J-round guarantee, preserved)', async () => {
  const db = await evidenceDb({ withColumn: true });
  const client = pgrestClient(db, { withColumn: true });
  const store = new Map();
  await upload(db, { withColumn: true, store, client, key: 'K', vin: 'VIN-A' });
  await assert.rejects(
    () => upload(db, { withColumn: true, store, client, key: 'K', vin: 'VIN-B' }),
    (e) => { assert.equal(e.statusCode, 409); assert.equal(e.details.reason, IDEMPOTENCY_SCOPE_CONFLICT); return true; });
  await db.close();
});

test('K2 (4,5): same key, same VIN, but a DIFFERENT evidence operation → 409, never a discard', async () => {
  // Each dimension on its own must be enough to refuse.
  const cases = [
    ['subtype', { ...OP_A, evidence_subtype: 'police_clearance', evidence_type: 'police_clearance' }],
    ['class', { ...OP_A, evidence_class: 'auction' }],
    ['checksum', { ...OP_A, checksum: 'SUM-DIFFERENT' }],
  ];
  for (const [label, op] of cases) {
    const db = await evidenceDb({ withColumn: true });
    const client = pgrestClient(db, { withColumn: true });
    const store = new Map();
    const first = await upload(db, { withColumn: true, store, client, key: 'K', vin: 'VIN-A', op: OP_A });
    await assert.rejects(
      () => upload(db, { withColumn: true, store, client, key: 'K', vin: 'VIN-A', op }),
      (e) => {
        assert.equal(e.statusCode, 409, `${label}: a different upload is a conflict, not a duplicate`);
        assert.equal(e.details.reason, IDEMPOTENCY_OPERATION_CONFLICT);
        assert.notEqual(e.evidenceId, first.evidenceId);
        return true;
      }, `${label} must not be silently absorbed`);
    const { rows } = await db.query(`SELECT evidence_subtype, checksum FROM vehicle_evidence;`);
    assert.equal(rows.length, 1, `${label}: the first upload stands, the second was refused loudly`);
    await db.close();
  }
});

test('K2: the WARM CACHE compares the operation too — the fast path is not a bypass', async () => {
  const db = await evidenceDb({ withColumn: true });
  const client = pgrestClient(db, { withColumn: true });
  const store = new Map(); // shared, so the second call hits the in-memory entry
  await upload(db, { withColumn: true, store, client, key: 'K', vin: 'VIN-A', op: OP_A });
  assert.equal(store.has(idempotencyScopeKey('u1', 'K')), true, 'precondition: the cache is warm');
  await assert.rejects(
    () => upload(db, { withColumn: true, store, client, key: 'K', vin: 'VIN-A', op: OP_B }),
    (e) => e.details?.reason === IDEMPOTENCY_OPERATION_CONFLICT);
  await db.close();
});

test('K2 (6): a different actor with the same raw key is untouched by any of this', async () => {
  const db = await evidenceDb({ withColumn: true });
  const client = pgrestClient(db, { withColumn: true });
  const store = new Map();
  await upload(db, { withColumn: true, store, client, key: 'K', vin: 'VIN-A', actor: 'u1', op: OP_A });
  const theirs = await upload(db, { withColumn: true, store, client, key: 'K', vin: 'VIN-A', actor: 'u2', op: OP_B });
  assert.equal(theirs.deduped, false, 'no cross-actor conflict and no cross-actor dedupe');
  await db.close();
});

test('K2 (7,8): a workbook retry and a mobile retry still dedupe', async () => {
  const db = await evidenceDb({ withColumn: true });
  const client = pgrestClient(db, { withColumn: true });
  const store = new Map();
  for (const key of ['workbook-evidence:batch-1:3:0', 'a7f3c1d2-9b4e-4a1f-8c2d-5e6f70819234']) {
    const one = await upload(db, { withColumn: true, store, client, key, vin: 'VIN-A', op: OP_A });
    const two = await upload(db, { withColumn: true, store, client, key, vin: 'VIN-A', op: OP_A });
    assert.equal(two.deduped, true, `${key} must still dedupe an identical retry`);
    assert.equal(one.evidenceId, two.evidenceId);
  }
  await db.close();
});

test('K2: the documented COMPATIBILITY floor — a field neither side supplies cannot contradict', async () => {
  const db = await evidenceDb({ withColumn: true });
  const client = pgrestClient(db, { withColumn: true });
  // A historical row with NO canonical identity recorded at all.
  await db.query(`INSERT INTO vehicle_evidence (id, vin, uploaded_by, metadata)
    VALUES ('old-1','VIN-A','u1','{"idempotency_key":"LEGACY"}'::jsonb);`);
  const hit = await upload(db, { withColumn: true, store: new Map(), client, key: 'LEGACY', vin: 'VIN-A', op: OP_A });
  assert.equal(hit.deduped, true,
    'the floor is the VIN-scoped behaviour: an unknowable field must not break a legitimate retry');
  assert.equal(hit.evidenceId, 'old-1');
  await db.close();
});

test('K2: the fingerprint is the EXISTING canonical vocabulary, not a second taxonomy', () => {
  assert.deepEqual([...OPERATION_IDENTITY_FIELDS].sort(),
    ['checksum', 'evidence_class', 'evidence_subtype', 'evidence_type'],
    'these are columns the evidence route already writes');
});

/* ══ K3 — the Dealer authority matrix ══════════════════════════════════════════════════ */

const DEALERSHIP = 'tenant-moyo-motors';
const GARAGE = 'tenant-garage-1';
const IMPORT = 'tenant-import-co';

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
    ('tenant-wound-up','u-dealer-dead','admin');`, [DEALERSHIP, GARAGE, IMPORT]);
  await db.query(`INSERT INTO dealer_profiles VALUES ('dp-susp','u-dealer-susp',NULL,'suspended');`);
  await db.query(`INSERT INTO tenant_users VALUES ($1,'u-dealer-susp','admin');`, [DEALERSHIP]);
  return db;
}

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

test('K3: the full authority matrix — every case measured, none assumed', async () => {
  const db = await authorityDb();
  const client = authorityClient(db);
  const subject = (ctx) => resolveDealerListingSubject(client, { role: ctx.role, userId: ctx.id, tenantId: ctx.tenantId });

  const matrix = [
    ['Owner',                                   { role: 'owner',      id: 'u-owner',          tenantId: null },        true,  'Private Owner'],
    ['Dealer + legitimate dealership',          { role: 'dealer',     id: 'u-dealer',         tenantId: DEALERSHIP },  true,  'Dealer'],
    ['Dealer + no tenant',                      { role: 'dealer',     id: 'u-dealer',         tenantId: null },        false, null],
    ['Dealer + GARAGE mechanic membership',     { role: 'dealer',     id: 'u-dealer-garage',  tenantId: GARAGE },      false, null],
    ['Dealer + GARAGE ADMIN membership',        { role: 'dealer',     id: 'u-dealer-gadmin',  tenantId: GARAGE },      false, null],
    ['Dealer + generic unrelated (import) org', { role: 'dealer',     id: 'u-dealer-import',  tenantId: IMPORT },      false, null],
    ['Dealer + dealership but NO membership',   { role: 'dealer',     id: 'u-nobody',         tenantId: DEALERSHIP },  false, null],
    ['Dealer + SUSPENDED business authority',   { role: 'dealer',     id: 'u-dealer-susp',    tenantId: DEALERSHIP },  false, null],
    ['Dealer + wound-up (inactive) dealership', { role: 'dealer',     id: 'u-dealer-dead',    tenantId: 'tenant-wound-up' }, false, null],
    ['MECHANIC employed by the dealership',     { role: 'dealer',     id: 'u-dealer-mech',    tenantId: DEALERSHIP },  false, null],
    ['Admin in the dealership',                 { role: 'admin',      id: 'u-admin',          tenantId: DEALERSHIP },  false, null],
    ['Government in the dealership',            { role: 'government', id: 'u-gov',            tenantId: DEALERSHIP },  false, null],
    ['Foreign tenant',                          { role: 'dealer',     id: 'u-dealer',         tenantId: 'tenant-does-not-exist' }, false, null],
  ];

  for (const [label, ctx, shouldList, expectedType] of matrix) {
    const dealerListingSubject = await subject(ctx);
    const candidate = buildVehicleListingCandidate({
      body: { vin: 'JTMHY7AJ2K4012345', make: 'Toyota', model: 'Hilux', year: 2019, price: 25000 },
      userContext: ctx,
      dealerListingSubject,
    });
    assert.equal(candidate.current_seller_type, expectedType, `${label}: seller type`);
    if (!shouldList) {
      assert.equal(getListingEligibility(candidate).eligible, false, `${label}: must be ineligible`);
      assert.equal(candidate.tenant_id, null, `${label}: no tenant subject`);
    }
  }
  await db.close();
});

test('K3: LEGITIMATE DEALER CONTINUITY — the shape real Dealers actually have is preserved', async () => {
  // Measured on staging: every one of the 5 platform-dealer memberships is `admin` of an ACTIVE
  // tenant, and 0 dealer profiles carry a tenant_id. This asserts that exact shape still lists.
  const db = await authorityDb();
  const s = await resolveDealerListingSubject(authorityClient(db),
    { role: 'dealer', userId: 'u-dealer', tenantId: DEALERSHIP });
  assert.equal(s.granted, true, 'a real Dealer must NOT be disabled by the security fix');
  assert.equal(s.tenantId, DEALERSHIP);
  assert.equal(s.dealerProfileId, null, 'and must not require a dealer_profiles row that nothing writes');
  await db.close();
});

test('K3: the refusal reasons name the actual boundary', async () => {
  const db = await authorityDb();
  const client = authorityClient(db);
  const why = async (ctx) => (await resolveDealerListingSubject(client, ctx)).reason;
  assert.equal(await why({ role: 'owner', userId: 'u', tenantId: null }), DEALER_SUBJECT_REASONS.NOT_A_DEALER_ROLE);
  assert.equal(await why({ role: 'dealer', userId: 'u-dealer', tenantId: null }), DEALER_SUBJECT_REASONS.NO_TENANT_CONTEXT);
  assert.equal(await why({ role: 'dealer', userId: 'u-nobody', tenantId: DEALERSHIP }), DEALER_SUBJECT_REASONS.NO_TENANT_MEMBERSHIP);
  assert.equal(await why({ role: 'dealer', userId: 'u-dealer-gadmin', tenantId: GARAGE }), DEALER_SUBJECT_REASONS.TENANT_NOT_A_DEALERSHIP);
  assert.equal(await why({ role: 'dealer', userId: 'u-dealer-mech', tenantId: DEALERSHIP }), DEALER_SUBJECT_REASONS.MEMBERSHIP_NOT_BUSINESS_AUTHORITY);
  assert.equal(await why({ role: 'dealer', userId: 'u-dealer-dead', tenantId: 'tenant-wound-up' }), DEALER_SUBJECT_REASONS.TENANT_NOT_ACTIVE);
  assert.equal(await why({ role: 'dealer', userId: 'u-dealer-susp', tenantId: DEALERSHIP }), DEALER_SUBJECT_REASONS.DEALER_AUTHORITY_WITHDRAWN);
  await db.close();
});

test('K3: the vocabulary is CarUp\'s own, and excludes what it should', () => {
  assert.deepEqual([...DEALERSHIP_TENANT_TYPES].sort(), ['dealer', 'dealership'],
    'mirrors DEALER_SELLER_TYPES in marketplaceTransactionAuthority');
  assert.equal(DEALERSHIP_TENANT_TYPES.has('garage'), false);
  assert.equal(DEALERSHIP_TENANT_TYPES.has('import'), false, 'an import business is not a dealership');
  assert.equal(BUSINESS_AUTHORITY_MEMBERSHIP_ROLES.has('mechanic'), false, 'employment is not agency');
  assert.equal(BUSINESS_AUTHORITY_MEMBERSHIP_ROLES.has('member'), false);
  assert.equal(BUSINESS_AUTHORITY_MEMBERSHIP_ROLES.has('admin'), true);
});

/* ══ K4 — action-level catalogue truth ═════════════════════════════════════════════════ */

const catalogueClient = (db) => {
  const base = authorityClient(db);
  return {
    from: (table) => {
      const chain = base.from(table);
      // Tables the catalogue reads that this fixture does not model answer as an EMPTY SET,
      // exactly as real Postgres does for a user with no rows.
      return { select: () => Object.assign(chain.select(), { then: (r) => Promise.resolve({ data: [], error: null }).then(r) }) };
    },
  };
};

test('K4: the dealer inventory entry never advertises an import it cannot perform', async () => {
  const db = await authorityDb();
  const client = catalogueClient(db);
  const entry = async (actor) => {
    const cat = await resolveWorkbookCatalogue(actor, { supabaseClient: client });
    return cat.available.find((t) => t.template_key === 'dealer_vehicle_inventory')
      || cat.unavailable.find((t) => t.template_key === 'dealer_vehicle_inventory');
  };

  const governed = await entry({ id: 'u-dealer', role: 'dealer', tenantId: DEALERSHIP });
  assert.ok(governed.actions.includes('import'), 'a real dealership keeps execution');
  assert.ok(governed.actions.includes('prepare'));

  for (const [label, actor] of [
    ['dealer with no listing subject', { id: 'u-dealer', role: 'dealer', tenantId: null }],
    ['dealer with a garage membership', { id: 'u-dealer-garage', role: 'dealer', tenantId: GARAGE }],
  ]) {
    const e = await entry(actor);
    assert.equal(e.actions.includes('import'), false, `${label}: execution must not be advertised`);
    assert.equal(e.actions.includes('prepare'), true, `${label}: preparation genuinely is available`);
    assert.equal(e.actions.includes('template'), true, `${label}: the template is still obtainable`);
    assert.match(e.note, /Preparation only/, `${label}: and the prose says the same thing`);
  }
  await db.close();
});

test('K4: prepare and import are distinct verbs in the action vocabulary', () => {
  assert.ok(WORKBOOK_ACTIONS.includes('prepare'), 'preparation is nameable on its own');
  assert.ok(WORKBOOK_ACTIONS.includes('import'), 'execution keeps its own verb');
  assert.notEqual(WORKBOOK_ACTIONS.indexOf('prepare'), WORKBOOK_ACTIONS.indexOf('import'));
});
