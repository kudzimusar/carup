/**
 * O2 — J-round closure.
 *
 * J-1  the REAL writer's error translation destroyed the native 23505 before the idempotency
 *      helper could see it, so the loser of a genuine race got a 500 instead of the winner's id.
 *      The I-round proof missed this because its writer threw the RAW driver error; this suite
 *      drives the SAME translation `insertEvidenceFromRequest` uses.
 * J-2  the idempotency key was globally scoped, so one actor's raw key could suppress another
 *      actor's upload — or return evidence belonging to a different VIN entirely.
 * J-3  a platform `dealer` with generic membership in ANY tenant minted Dealer seller authority
 *      for that tenant. Membership is not a dealership.
 * J-4  the catalogue advertised Dealer imports from the role string alone.
 *
 * Every database assertion runs against a REAL PostgreSQL (PGlite) built from the branch's own
 * migration DDL. Nothing here manufactures a constraint violation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  withUploadIdempotency,
  isIdempotencyUniqueViolation,
  toDatabaseError,
  IDEMPOTENCY_CONSTRAINT,
  IDEMPOTENCY_SCOPE_CONFLICT,
} from '../services/evidence/uploadIdempotency.js';
import { buildVehicleListingCandidate, getListingEligibility } from '../services/marketplace/marketplaceListingEligibility.js';
import {
  resolveDealerListingSubject,
  DEALER_SUBJECT_REASONS,
} from '../services/dealer/dealerListingAuthority.js';
import { resolveWorkbookCatalogue } from '../services/workbook/workbookCatalogueService.js';
import { evidenceIdempotencyKey } from '../services/workbook/vehicleWorkbookImportService.js';

/* ── a real database, built from the branch's own migration ────────────────────────────── */
const MIGRATION = fileURLToPath(new URL(
  '../../database/migrations/20260908120000_vehicle_evidence_upload_idempotency.sql', import.meta.url));

async function evidenceDb() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE users (id text PRIMARY KEY);`);
  await db.exec(`INSERT INTO users (id) VALUES ('actor-a'), ('actor-b');`);
  await db.exec(`CREATE TABLE vehicle_evidence (
    id text PRIMARY KEY, vin text, vehicle_id text, evidence_type text, file_url text,
    mime_type text, uploaded_by text NOT NULL REFERENCES users(id), uploader_role text,
    verification_status text CHECK (verification_status IN ('pending','verified','rejected')),
    trust_score_impact int, trust_impact int, checksum text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb);`);
  // An UNRELATED unique index, so "any 23505 is dedupe" cannot pass.
  await db.exec(`CREATE UNIQUE INDEX uq_vehicle_evidence_checksum ON vehicle_evidence (checksum) WHERE checksum IS NOT NULL;`);
  const sql = readFileSync(MIGRATION, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const statements = sql.match(/(ALTER TABLE[\s\S]*?;|CREATE UNIQUE INDEX[\s\S]*?;)/g) || [];
  assert.ok(statements.length >= 2, 'the migration must still carry its column and its unique index');
  for (const stmt of statements) await db.exec(stmt.replace(/public\./g, ''));
  return db;
}

/**
 * The canonical writer, shaped exactly like `insertEvidenceFromRequest`: a Supabase-style
 * `{ data, error }` result, then CarUp's own error translation. This is the shape J-1 is about —
 * a writer that throws the raw driver error proves nothing about the deployed path.
 */
let evidenceSeq = 0;
function appWriter(db, { corrupt = null } = {}) {
  return async ({ vin, key, actorId = 'actor-a', checksum = null }) => {
    evidenceSeq += 1;
    const id = `ev-${evidenceSeq}`;
    const cols = ['id', 'vin', 'vehicle_id', 'evidence_type', 'file_url', 'mime_type', 'uploaded_by',
      'uploader_role', 'verification_status', 'trust_score_impact', 'trust_impact', 'checksum', 'metadata'];
    const vals = [id, vin, vin, 'registration_book', 'https://f/a.pdf', 'application/pdf',
      corrupt === 'fk' ? 'ghost-actor' : actorId, 'owner',
      corrupt === 'check' ? 'not-a-status' : 'pending', 0, 0, checksum,
      JSON.stringify(key ? { idempotency_key: key } : {})];
    if (key) { cols.push('idempotency_key'); vals.push(key); }
    const ph = cols.map((_, i) => `$${i + 1}${cols[i] === 'metadata' ? '::jsonb' : ''}`).join(', ');

    // Supabase returns { data, error } — it does not throw. Mirror that, preserving the native
    // PostgreSQL identity exactly as PostgREST does (code, constraint, message).
    let data = null; let error = null;
    try {
      const { rows } = await db.query(
        `INSERT INTO vehicle_evidence (${cols.join(', ')}) VALUES (${ph}) RETURNING id, vin, uploaded_by, idempotency_key;`, vals);
      data = rows[0];
    } catch (e) {
      error = { message: e.message, code: e.code, constraint: e.constraint, details: e.detail };
    }
    // ── THE DEPLOYED TRANSLATION. J-1 lives on this line. ──
    if (error) throw toDatabaseError(error);
    return data;
  };
}

/**
 * A Supabase double whose reads go to the REAL database.
 *
 * It answers FAITHFULLY: apply the filters it was given and no others. An earlier version refused
 * an unscoped read, which felt safe and was actively harmful — it turned "the service forgot the
 * actor filter" into a lookup ERROR (fail-open, no leak), so removing the scope from the service
 * left the cross-actor test green. A double that protects the code under test cannot detect the
 * defect it is protecting against. Under-scoping is now asserted directly, by `lastFilters`.
 */
const supabaseOver = (db) => {
  const state = { lastFilters: null };
  const client = {
    from: () => ({
      select: () => {
        const f = { actorId: undefined, key: null };
        const chain = {
          eq(col, value) { if (col === 'uploaded_by') f.actorId = value; return chain; },
          or(filter) { f.key = String(filter).match(/idempotency_key\.eq\.([^,]+)/)?.[1] ?? null; return chain; },
          async limit() {
            state.lastFilters = { ...f };
            const scoped = f.actorId !== undefined;
            const { rows } = await db.query(
              `SELECT id, vin, uploaded_by, metadata, idempotency_key FROM vehicle_evidence
                WHERE (idempotency_key = $1 OR metadata->>'idempotency_key' = $1)
                  AND ($2::text IS NULL OR uploaded_by = $2) LIMIT 1;`,
              [f.key, scoped ? f.actorId : null]);
            return { data: rows, error: null };
          },
        };
        return chain;
      },
    }),
  };
  client.__state = state;
  return client;
};

const run = (db, store, { key, vin, actorId = 'actor-a', checksum = null, corrupt = null, writer = null, supabase = null }) =>
  withUploadIdempotency(key, vin, () => (writer || appWriter(db, { corrupt }))({ vin, key, actorId, checksum }),
    { store, supabase: supabase || supabaseOver(db), actorId });

/* ══ J-1 — the real writer's error translation ═════════════════════════════════════════ */

test('J-1 (1,2,3,4): two CONCURRENT writes through the REAL error translation converge', async () => {
  const db = await evidenceDb();
  const store = new Map();
  const write = appWriter(db);
  const go = () => withUploadIdempotency('wb:b1:1:0', 'VIN-A', () => write({ vin: 'VIN-A', key: 'wb:b1:1:0' }),
    { store, supabase: supabaseOver(db), actorId: 'actor-a' });

  const settled = await Promise.allSettled([go(), go()]);
  const rejected = settled.filter((s) => s.status === 'rejected');
  assert.deepEqual(rejected.map((r) => r.reason?.statusCode ?? r.reason?.message), [],
    '(4) neither caller may receive a 500 — the loser must converge, not fail');

  const [a, b] = settled.map((s) => s.value);
  const { rows } = await db.query(`SELECT count(*)::int c FROM vehicle_evidence WHERE idempotency_key='wb:b1:1:0';`);
  assert.equal(rows[0].c, 1, '(2) the database left exactly one row');
  assert.equal(a.evidenceId, b.evidenceId, '(3) both callers returned the SAME evidence id');
  assert.equal([a.deduped, b.deduped].filter(Boolean).length, 1, '(3) exactly one call is reported deduped');
  await db.close();
});

test('J-1 (5): an UNRELATED 23505 still propagates as a database error', async () => {
  const db = await evidenceDb();
  const write = appWriter(db);
  await run(db, new Map(), { key: 'k-1', vin: 'VIN-A', checksum: 'SAME-SUM', writer: write });
  // Same checksum, DIFFERENT idempotency key → uq_vehicle_evidence_checksum, not the idempotency index.
  await assert.rejects(
    () => run(db, new Map(), { key: 'k-2', vin: 'VIN-B', checksum: 'SAME-SUM', writer: write }),
    (err) => {
      assert.equal(err.code, 'DATABASE_ERROR', 'the public contract is unchanged for unrelated failures');
      assert.equal(err.statusCode, 500);
      assert.equal(err.cause?.code, '23505', 'the native identity is preserved…');
      assert.equal(isIdempotencyUniqueViolation(err), false, '…but this is NOT the idempotency index');
      assert.ok(!String(err.cause?.constraint).includes(IDEMPOTENCY_CONSTRAINT));
      return true;
    });
  const { rows } = await db.query(`SELECT count(*)::int c FROM vehicle_evidence;`);
  assert.equal(rows[0].c, 1, 'the unrelated failure created nothing and was not silently deduped');
  await db.close();
});

test('J-1 (6,7): FK and CHECK failures propagate untouched', async () => {
  for (const corrupt of ['fk', 'check']) {
    const db = await evidenceDb();
    await assert.rejects(
      () => run(db, new Map(), { key: `k-${corrupt}`, vin: 'VIN-A', corrupt }),
      (err) => {
        assert.equal(err.code, 'DATABASE_ERROR');
        assert.equal(isIdempotencyUniqueViolation(err), false, `${corrupt} must never be read as dedupe`);
        assert.ok(['23503', '23514'].includes(err.cause?.code), `${corrupt} keeps its native code (${err.cause?.code})`);
        return true;
      });
    const { rows } = await db.query(`SELECT count(*)::int c FROM vehicle_evidence;`);
    assert.equal(rows[0].c, 0, `${corrupt}: nothing was written`);
    await db.close();
  }
});

test('J-1: a DatabaseError with no native cause is NOT dedupe — the guard cannot be fooled', () => {
  const bare = toDatabaseError({ message: `duplicate key value violates unique constraint "${IDEMPOTENCY_CONSTRAINT}"` });
  assert.equal(isIdempotencyUniqueViolation(bare), false,
    'a message alone, with no native 23505, must not be treated as the idempotency race');
});

/* ══ J-2 — the collision domain ════════════════════════════════════════════════════════ */

test('J-2 (1): same actor / same VIN / same key → exactly one evidence', async () => {
  const db = await evidenceDb();
  const store = new Map();
  const a = await run(db, store, { key: 'K', vin: 'VIN-A' });
  const b = await run(db, store, { key: 'K', vin: 'VIN-A' });
  assert.equal(a.evidenceId, b.evidenceId);
  assert.equal(b.deduped, true);
  const { rows } = await db.query(`SELECT count(*)::int c FROM vehicle_evidence;`);
  assert.equal(rows[0].c, 1);
  await db.close();
});

test('J-2 (2): same actor / same VIN CONCURRENT → one row, both converge', async () => {
  const db = await evidenceDb();
  const store = new Map();
  const write = appWriter(db);
  const go = () => withUploadIdempotency('K', 'VIN-A', () => write({ vin: 'VIN-A', key: 'K' }),
    { store, supabase: supabaseOver(db), actorId: 'actor-a' });
  const [a, b] = await Promise.all([go(), go()]);
  assert.equal(a.evidenceId, b.evidenceId);
  const { rows } = await db.query(`SELECT count(*)::int c FROM vehicle_evidence;`);
  assert.equal(rows[0].c, 1);
  await db.close();
});

test('J-2 (3): same actor / DIFFERENT VIN / same key → explicit conflict, never silent suppression', async () => {
  const db = await evidenceDb();
  const store = new Map();
  const first = await run(db, store, { key: 'K', vin: 'VIN-A' });

  await assert.rejects(
    () => run(db, store, { key: 'K', vin: 'VIN-B' }),
    (err) => {
      assert.equal(err.statusCode, 409, 'reusing a key for a different resource is a CONFLICT');
      assert.equal(err.details?.reason, IDEMPOTENCY_SCOPE_CONFLICT);
      assert.notEqual(err.evidenceId, first.evidenceId, 'and it must not hand back the other VIN’s evidence');
      return true;
    },
    'a key bound to VIN-A must not silently dedupe an upload for VIN-B');

  const { rows } = await db.query(`SELECT vin, count(*)::int c FROM vehicle_evidence GROUP BY vin;`);
  assert.deepEqual(rows, [{ vin: 'VIN-A', c: 1 }], 'VIN-B was refused loudly, not absorbed into VIN-A');
  await db.close();
});

test('J-2 (4): a DIFFERENT actor reusing the same raw key gets an independent namespace', async () => {
  const db = await evidenceDb();
  const store = new Map();
  const mine = await run(db, store, { key: 'K', vin: 'VIN-A', actorId: 'actor-a' });
  const theirs = await run(db, store, { key: 'K', vin: 'VIN-B', actorId: 'actor-b' });

  assert.notEqual(theirs.evidenceId, mine.evidenceId, 'no cross-actor evidence-id leak');
  assert.equal(theirs.deduped, false, 'no cross-actor suppression of a legitimate upload');
  const { rows } = await db.query(
    `SELECT uploaded_by, vin FROM vehicle_evidence ORDER BY uploaded_by;`);
  assert.deepEqual(rows, [
    { uploaded_by: 'actor-a', vin: 'VIN-A' },
    { uploaded_by: 'actor-b', vin: 'VIN-B' },
  ], 'both actors kept their own evidence');
  await db.close();
});

test('J-2 (5,6): the workbook key and a mobile-style key both still dedupe', async () => {
  const db = await evidenceDb();
  const store = new Map();
  const wb = evidenceIdempotencyKey('batch-1', 3, 0);
  assert.match(wb, /^workbook-evidence:batch-1:3:0$/);
  const mobile = 'a7f3c1d2-9b4e-4a1f-8c2d-5e6f70819234';
  for (const key of [wb, mobile]) {
    const one = await run(db, store, { key, vin: 'VIN-A' });
    const two = await run(db, store, { key, vin: 'VIN-A' });
    assert.equal(two.deduped, true, `${key} must still dedupe a retry`);
    assert.equal(one.evidenceId, two.evidenceId);
  }
  const { rows } = await db.query(`SELECT count(*)::int c FROM vehicle_evidence;`);
  assert.equal(rows[0].c, 2, 'two distinct keys, two evidence rows — dedupe is not suppression');
  await db.close();
});

test('J-2 (7): the historical metadata corpus is found, and is ALSO actor-scoped', async () => {
  const db = await evidenceDb();
  // A pre-migration row: the key lives ONLY in metadata, and the column is NULL.
  await db.query(`INSERT INTO vehicle_evidence (id, vin, vehicle_id, uploaded_by, verification_status, metadata)
    VALUES ('old-1','VIN-A','VIN-A','actor-a','pending', '{"idempotency_key":"LEGACY"}'::jsonb);`);

  const mine = await run(db, new Map(), { key: 'LEGACY', vin: 'VIN-A', actorId: 'actor-a' });
  assert.equal(mine.deduped, true, 'the historical row is still found by the same lookup');
  assert.equal(mine.evidenceId, 'old-1');

  const theirs = await run(db, new Map(), { key: 'LEGACY', vin: 'VIN-B', actorId: 'actor-b' });
  assert.equal(theirs.deduped, false, 'another actor is NOT suppressed by a historical metadata row');
  assert.notEqual(theirs.evidenceId, 'old-1', 'and cannot read it back');
  await db.close();
});

test('J-2 (8): the index enforces EXACTLY the documented scope — (uploaded_by, idempotency_key)', async () => {
  const db = await evidenceDb();
  const { rows: idx } = await db.query(
    `SELECT indexdef FROM pg_indexes WHERE indexname = $1;`, [IDEMPOTENCY_CONSTRAINT]);
  assert.equal(idx.length, 1, 'the idempotency index must exist');
  assert.match(idx[0].indexdef, /\(uploaded_by, idempotency_key\)/,
    'a client-supplied key is scoped to its actor — the house convention (diaspora_stock_ledger, ' +
    'diaspora_workbook_import_batches, diaspora_usage_reservation all scope theirs)');
  assert.match(idx[0].indexdef, /WHERE .*idempotency_key IS NOT NULL/, 'and stays partial');

  const ins = (id, who, key) => db.query(
    `INSERT INTO vehicle_evidence (id, vin, vehicle_id, uploaded_by, verification_status, idempotency_key)
     VALUES ($1,'V','V',$2,'pending',$3);`, [id, who, key]);
  await ins('r1', 'actor-a', 'K');
  await assert.rejects(() => ins('r2', 'actor-a', 'K'), /duplicate key/, 'same actor + same key is refused');
  await ins('r3', 'actor-b', 'K');           // different actor — permitted
  await ins('r4', 'actor-a', null);          // unkeyed rows stay unconstrained
  await ins('r5', 'actor-a', null);
  const { rows } = await db.query(`SELECT count(*)::int c FROM vehicle_evidence;`);
  assert.equal(rows[0].c, 4);
  await db.close();
});

test('J-2: the durable lookup actually SENDS the actor filter', async () => {
  const db = await evidenceDb();
  const supabase = supabaseOver(db);
  await run(db, new Map(), { key: 'K', vin: 'VIN-A', actorId: 'actor-a', supabase });
  assert.deepEqual(supabase.__state.lastFilters, { actorId: 'actor-a', key: 'K' },
    'an unscoped lookup returns whichever row in the whole table carries the string — that is the leak');
  await db.close();
});

/* ══ J-3 — Dealer↔tenant authority ═════════════════════════════════════════════════════ */

async function dealerDb() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE dealer_profiles (
    id text PRIMARY KEY, user_id text NOT NULL, tenant_id text,
    suspension_state text NOT NULL DEFAULT 'none');`);
  // K-3: the authority composes THREE server-controlled tables. An audit of the candidate tree
  // found zero backend writes to `tenants` or `tenant_users` — only migration-002 seed statements
  // — so neither a tenant's type nor a membership can be minted by a client.
  await db.exec(`CREATE TABLE tenants (id text PRIMARY KEY, type text, status text);`);
  await db.exec(`CREATE TABLE tenant_users (tenant_id text, user_id text, role text);`);
  return db;
}

/**
 * A Supabase double over the real authority tables. It answers FAITHFULLY — it applies exactly the
 * filters it is given — so an under-scoped query produces the real (wrong) answer rather than a
 * protective error. What the resolver actually asked for is asserted separately.
 */
const dealerSupabaseOver = (db) => {
  const seen = [];
  const client = {
    from: (table) => ({
      select: () => {
        const f = {};
        const chain = {
          eq(col, value) { f[col] = value; return chain; },
          async maybeSingle() {
            seen.push({ table, filters: { ...f } });
            const where = Object.keys(f);
            const sql = {
              dealer_profiles: 'SELECT id, tenant_id, suspension_state FROM dealer_profiles',
              tenant_users: 'SELECT role FROM tenant_users',
              tenants: 'SELECT id, type, status FROM tenants',
            }[table];
            if (!sql) return { data: null, error: null };
            const clause = where.length ? ' WHERE ' + where.map((c, i) => `${c} = $${i + 1}`).join(' AND ') : '';
            const { rows } = await db.query(`${sql}${clause} LIMIT 1;`, where.map((c) => f[c]));
            return { data: rows[0] || null, error: null };
          },
        };
        return chain;
      },
    }),
  };
  client.__seen = seen;
  return client;
};

const GARAGE = 'tenant-garage-1';
const DEALERSHIP = 'tenant-moyo-motors';

async function subjectFor(db, ctx) {
  return resolveDealerListingSubject(dealerSupabaseOver(db), {
    role: ctx.role, userId: ctx.id, tenantId: ctx.tenantId ?? null,
  });
}

test('J-3: the authority matrix — no membership class outside a governed dealership may sell', async () => {
  const db = await dealerDb();
  // K-3 — the authority is a COMPOSITION of server-controlled facts, so the fixture seeds all of
  // them. `dealer_profiles.tenant_id` stays NULL exactly as it is in real data: the J-round made
  // that binding the sole prerequisite, which disabled every real Dealer.
  await db.query(`INSERT INTO tenants VALUES ($1,'dealership','active'), ($2,'garage','active'), ('tenant-other','garage','active');`, [DEALERSHIP, GARAGE]);
  await db.query(`INSERT INTO tenant_users VALUES
      ($1,'user-dealer','admin'), ($2,'user-dealer','admin'),
      ('tenant-other','user-dealer2','manager'), ($2,'user-dealer3','mechanic'),
      ($1,'user-revoked','admin'), ($2,'user-admin','member'), ($2,'user-gov','member');`, [DEALERSHIP, GARAGE]);
  await db.query(`INSERT INTO dealer_profiles VALUES ('dp-1','user-dealer',NULL,'none');`);
  await db.query(`INSERT INTO dealer_profiles VALUES ('dp-2','user-revoked',NULL,'suspended');`);

  const matrix = [
    // [label, userContext, expected seller type, expected tenant]
    ['Owner', { role: 'owner', id: 'user-owner', tenantId: null }, 'Private Owner', null],
    ['Dealer + its OWN governed dealership', { role: 'dealer', id: 'user-dealer', tenantId: DEALERSHIP }, 'Dealer', DEALERSHIP],
    ['Dealer with no tenant', { role: 'dealer', id: 'user-dealer', tenantId: null }, null, null],
    ['Dealer + tenant-ADMIN membership in an unrelated Garage', { role: 'dealer', id: 'user-dealer', tenantId: GARAGE }, null, null],
    ['Dealer + MECHANIC membership in a real DEALERSHIP (employment is not agency)', { role: 'dealer', id: 'user-mech-dlr', tenantId: DEALERSHIP }, null, null],
    ['Dealer + MANAGER membership in an unrelated tenant', { role: 'dealer', id: 'user-dealer2', tenantId: 'tenant-other' }, null, null],
    ['Dealer + MECHANIC membership', { role: 'dealer', id: 'user-dealer3', tenantId: GARAGE }, null, null],
    ['Dealer + a FOREIGN tenant', { role: 'dealer', id: 'user-nobody', tenantId: DEALERSHIP }, null, null],
    ['REVOKED dealer tenant relationship', { role: 'dealer', id: 'user-revoked', tenantId: DEALERSHIP }, null, null],
    ['Admin + generic tenant', { role: 'admin', id: 'user-admin', tenantId: GARAGE }, null, null],
    ['Government + generic tenant', { role: 'government', id: 'user-gov', tenantId: GARAGE }, null, null],
  ];

  for (const [label, ctx, expectedType, expectedTenant] of matrix) {
    const dealerListingSubject = await subjectFor(db, ctx);
    const candidate = buildVehicleListingCandidate({
      body: { vin: 'JTMHY7AJ2K4012345', make: 'Toyota', model: 'Hilux', year: 2019, price: 25000 },
      userContext: ctx,
      dealerListingSubject,
    });
    assert.equal(candidate.current_seller_type, expectedType, `${label}: seller type`);
    assert.equal(candidate.tenant_id, expectedTenant, `${label}: tenant subject`);
    if (expectedType === null) {
      const eligibility = getListingEligibility(candidate);
      assert.equal(eligibility.eligible, false, `${label}: must be ineligible, not merely tenant-less`);
    }
  }
  await db.close();
});

test('J-3: a client body cannot mint a dealership, and neither can a bare tenant header', async () => {
  const db = await dealerDb();
  const ctx = { role: 'dealer', id: 'user-dealer', tenantId: GARAGE };
  const candidate = buildVehicleListingCandidate({
    body: { vin: 'JTMHY7AJ2K4012345', tenant_id: DEALERSHIP, owner_id: 'user-dealer', current_seller_type: 'Dealer' },
    userContext: ctx,
    dealerListingSubject: await subjectFor(db, ctx),
  });
  assert.equal(candidate.tenant_id, null);
  assert.equal(candidate.current_seller_type, null);
  assert.equal(candidate.owner_id, null);
  await db.close();
});

test('J-3: a MISSING resolution fails closed — a caller that forgets the gate grants nothing', () => {
  const candidate = buildVehicleListingCandidate({
    body: { vin: 'JTMHY7AJ2K4012345' },
    userContext: { role: 'dealer', id: 'user-dealer', tenantId: DEALERSHIP },
    // dealerListingSubject deliberately omitted
  });
  assert.equal(candidate.current_seller_type, null, 'no resolution means no subject — never an open default');
  assert.equal(candidate.tenant_id, null);
});

test('J-3: the refusal REASONS name the actual boundary', async () => {
  const db = await dealerDb();
  // K-3 — the authority is a COMPOSITION of server-controlled facts, so the fixture seeds all of
  // them. `dealer_profiles.tenant_id` stays NULL exactly as it is in real data: the J-round made
  // that binding the sole prerequisite, which disabled every real Dealer.
  await db.query(`INSERT INTO tenants VALUES ($1,'dealership','active'), ($2,'garage','active'), ('tenant-other','garage','active');`, [DEALERSHIP, GARAGE]);
  await db.query(`INSERT INTO tenant_users VALUES
      ($1,'user-dealer','admin'), ($2,'user-dealer','admin'),
      ('tenant-other','user-dealer2','manager'), ($2,'user-dealer3','mechanic'),
      ($1,'user-revoked','admin'), ($2,'user-admin','member'), ($2,'user-gov','member');`, [DEALERSHIP, GARAGE]);
  await db.query(`INSERT INTO dealer_profiles VALUES ('dp-1','user-dealer',NULL,'none');`);
  await db.query(`INSERT INTO dealer_profiles VALUES ('dp-2','user-revoked',NULL,'suspended');`);
  const reason = async (ctx) => (await subjectFor(db, ctx)).reason;
  assert.equal(await reason({ role: 'owner', id: 'u', tenantId: null }), DEALER_SUBJECT_REASONS.NOT_A_DEALER_ROLE);
  assert.equal(await reason({ role: 'dealer', id: 'user-dealer', tenantId: null }), DEALER_SUBJECT_REASONS.NO_TENANT_CONTEXT);
  assert.equal(await reason({ role: 'dealer', id: 'user-nobody', tenantId: DEALERSHIP }), DEALER_SUBJECT_REASONS.NO_TENANT_MEMBERSHIP);
  assert.equal(await reason({ role: 'dealer', id: 'user-dealer', tenantId: GARAGE }), DEALER_SUBJECT_REASONS.TENANT_NOT_A_DEALERSHIP);
  assert.equal(await reason({ role: 'dealer', id: 'user-mech-dlr', tenantId: DEALERSHIP }), DEALER_SUBJECT_REASONS.NO_TENANT_MEMBERSHIP);
  assert.equal(await reason({ role: 'dealer', id: 'user-revoked', tenantId: DEALERSHIP }), DEALER_SUBJECT_REASONS.DEALER_AUTHORITY_WITHDRAWN);
  assert.equal(await reason({ role: 'dealer', id: 'user-dealer', tenantId: DEALERSHIP }), null);
  await db.close();
});

/* ══ J-4 — the catalogue consumes the SAME result ══════════════════════════════════════ */

async function catalogueFor(db, actor) {
  return resolveWorkbookCatalogue(actor, { supabaseClient: dealerSupabaseOver(db) });
}
const listingEntry = (cat) => ({
  available: cat.available.some((t) => t.template_key === 'seller_vehicles'),
  unavailable: cat.unavailable.find((t) => t.template_key === 'seller_vehicles') || null,
});

test('J-4: the catalogue does not advertise an import that execute knows has no subject', async () => {
  const db = await dealerDb();
  // K-3 — the authority is a COMPOSITION of server-controlled facts, so the fixture seeds all of
  // them. `dealer_profiles.tenant_id` stays NULL exactly as it is in real data: the J-round made
  // that binding the sole prerequisite, which disabled every real Dealer.
  await db.query(`INSERT INTO tenants VALUES ($1,'dealership','active'), ($2,'garage','active'), ('tenant-other','garage','active');`, [DEALERSHIP, GARAGE]);
  await db.query(`INSERT INTO tenant_users VALUES
      ($1,'user-dealer','admin'), ($2,'user-dealer','admin'),
      ('tenant-other','user-dealer2','manager'), ($2,'user-dealer3','mechanic'),
      ($1,'user-revoked','admin'), ($2,'user-admin','member'), ($2,'user-gov','member');`, [DEALERSHIP, GARAGE]);
  await db.query(`INSERT INTO dealer_profiles VALUES ('dp-1','user-dealer',NULL,'none');`);
  await db.query(`INSERT INTO dealer_profiles VALUES ('dp-2','user-revoked',NULL,'suspended');`);

  const governed = listingEntry(await catalogueFor(db, { role: 'dealer', id: 'user-dealer', tenantId: DEALERSHIP }));
  assert.equal(governed.available, true, 'a genuine dealership keeps its import');

  for (const [label, actor] of [
    ['Dealer role + NO tenant', { role: 'dealer', id: 'user-dealer', tenantId: null }],
    ['Dealer role + unrelated Garage membership', { role: 'dealer', id: 'user-dealer', tenantId: GARAGE }],
  ]) {
    const entry = listingEntry(await catalogueFor(db, actor));
    assert.equal(entry.available, false, `${label}: must not be advertised as executable`);
    assert.ok(entry.unavailable, `${label}: must appear with a reason instead`);
    assert.equal(entry.unavailable.reason, 'no_listing_subject');
  }
  await db.close();
});

test('J-4: an owner is unaffected — the gate is the subject, not a narrower role list', async () => {
  const db = await dealerDb();
  const entry = listingEntry(await catalogueFor(db, { role: 'owner', id: 'user-owner', tenantId: null }));
  assert.equal(entry.available, true);
  await db.close();
});
