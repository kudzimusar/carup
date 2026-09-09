/**
 * O2 — L-round closure.
 *
 * L1  the K-round fingerprint (class/subtype/type/checksum) does not cover the canonical REMOTE
 *     shape. The route hashes only INLINE files, so a remote submission — exactly what the workbook
 *     evidence path sends — legitimately stores `checksum = NULL`. Measured: the same key with a
 *     different `file_url` returned the first record and FILE-B was discarded.
 * L2  K3 fixed listing CREATION and left every EXISTING-vehicle seller mutation authorizing on raw
 *     tenant equality. Measured on the real routes: the actor K3 refuses creation could publish,
 *     unpublish, reprice and set status.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {
  withUploadIdempotency,
  toDatabaseError,
  deriveRemoteReference,
  OPERATION_IDENTITY_FIELDS,
  IDEMPOTENCY_OPERATION_CONFLICT,
} from '../services/evidence/uploadIdempotency.js';
import {
  hasGovernedDealerVehicleAuthority,
  resolveDealerListingSubject,
} from '../services/dealer/dealerListingAuthority.js';
import { hasExistingSellerRelationship } from '../services/seller/sellerAuthorityService.js';

/* ══ L1 — remote evidence identity ═════════════════════════════════════════════════════ */

const IDENTITY = 'id, vin, uploaded_by, evidence_class, evidence_subtype, evidence_type, checksum, '
  + 'storage_bucket, file_path, file_url, metadata, idempotency_key';

async function evidenceDb() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE vehicle_evidence (
    id text PRIMARY KEY, vin text, uploaded_by text,
    evidence_class text, evidence_subtype text, evidence_type text, checksum text,
    storage_bucket text, file_path text, file_url text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb, idempotency_key text);`);
  await db.exec(`CREATE UNIQUE INDEX uq_vehicle_evidence_idempotency_key
    ON vehicle_evidence (uploaded_by, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND uploaded_by IS NOT NULL;`);
  return db;
}

const clientOver = (db) => ({
  from: () => ({
    select: () => {
      const f = {};
      const chain = {
        eq(k, v) { f[k] = v; return chain; },
        or(x) { f.key = String(x).match(/idempotency_key\.eq\.([^,]+)/)?.[1] ?? null; return chain; },
        async limit() {
          const { rows } = await db.query(
            `SELECT ${IDENTITY} FROM vehicle_evidence
              WHERE uploaded_by = $2 AND (idempotency_key = $1 OR metadata->>'idempotency_key' = $1) LIMIT 1;`,
            [f.key ?? f['metadata->>idempotency_key'] ?? null, f.uploaded_by ?? null]);
          return { data: rows, error: null };
        },
      };
      return chain;
    },
  }),
});

let seq = 0;
/** The canonical REMOTE shape: file_url/file_path and NO checksum, exactly as the workbook sends. */
const write = (db) => async ({ vin, key, actor, op }) => {
  seq += 1;
  let data = null; let error = null;
  try {
    const { rows } = await db.query(
      `INSERT INTO vehicle_evidence (id, vin, uploaded_by, evidence_class, evidence_subtype, evidence_type,
        checksum, storage_bucket, file_path, file_url, metadata, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10::jsonb,$11) RETURNING id, vin;`,
      [`ev-${seq}`, vin, actor, op.evidence_class, op.evidence_subtype, op.evidence_type,
        op.checksum ?? null, op.storage_bucket ?? 'vehicle-images', op.file_path ?? null,
        JSON.stringify({ idempotency_key: key }), key]);
    data = rows[0];
  } catch (e) {
    error = { message: e.message, code: e.code, constraint: e.constraint };
  }
  if (error) throw toDatabaseError(error);
  return data;
};

const REMOTE = (file_path, extra = {}) => ({
  evidence_class: 'registration', evidence_subtype: 'registration_book',
  evidence_type: 'registration_book', checksum: null,
  storage_bucket: 'vehicle-images', file_path, ...extra,
});
const fingerprint = (op) => ({ ...op, remote_ref: deriveRemoteReference(op) });

const send = (db, store, { key, vin = 'VIN-A', actor = 'u1', op }) =>
  withUploadIdempotency(key, vin, () => write(db)({ vin, key, actor, op }),
    { store, supabase: clientOver(db), actorId: actor, operation: fingerprint(op) });

test('L1 (1,6): the SAME remote reference dedupes — a workbook retry still collapses', async () => {
  const db = await evidenceDb();
  const store = new Map();
  const op = REMOTE('evidence/FILE-A.pdf');
  const a = await send(db, store, { key: 'workbook-evidence:b1:3:0', op });
  const b = await send(db, store, { key: 'workbook-evidence:b1:3:0', op });
  assert.equal(b.deduped, true);
  assert.equal(a.evidenceId, b.evidenceId);
  const { rows } = await db.query(`SELECT count(*)::int c FROM vehicle_evidence;`);
  assert.equal(rows[0].c, 1);
  await db.close();
});

test('L1 (2,7): a DIFFERENT remote reference with NO checksum is a 409, never a discard', async () => {
  const db = await evidenceDb();
  const store = new Map();
  const first = await send(db, store, { key: 'K', op: REMOTE('evidence/FILE-A.pdf') });
  await assert.rejects(
    () => send(db, store, { key: 'K', op: REMOTE('evidence/FILE-B.pdf') }),
    (e) => {
      assert.equal(e.statusCode, 409);
      assert.equal(e.details.reason, IDEMPOTENCY_OPERATION_CONFLICT);
      assert.equal(e.details.field, 'remote_ref');
      return true;
    },
    'a different remote document must not be absorbed under an earlier key');
  const { rows } = await db.query(`SELECT file_path FROM vehicle_evidence;`);
  assert.deepEqual(rows, [{ file_path: 'evidence/FILE-A.pdf' }], 'FILE-A stands; FILE-B was refused loudly');
  assert.ok(first.evidenceId);
  await db.close();
});

test('L1: a SIGNED-URL re-issue is the same object — signature and expiry are transient', async () => {
  const db = await evidenceDb();
  const store = new Map();
  const a = await send(db, store, { key: 'K', op: REMOTE('evidence/FILE-A.pdf?X-Amz-Signature=aaa&Expires=1') });
  const b = await send(db, store, { key: 'K', op: REMOTE('evidence/FILE-A.pdf?X-Amz-Signature=bbb&Expires=2') });
  assert.equal(b.deduped, true, 'a re-signed URL for the SAME object must not look like a new file');
  assert.equal(a.evidenceId, b.evidenceId);
  await db.close();
});

test('L1: object keys are CASE-SENSITIVE — two different objects are not one', async () => {
  assert.notEqual(deriveRemoteReference({ storage_bucket: 'b', file_path: 'evidence/FILE-A.pdf' }),
    deriveRemoteReference({ storage_bucket: 'b', file_path: 'evidence/file-a.pdf' }));
  const db = await evidenceDb();
  const store = new Map();
  await send(db, store, { key: 'K', op: REMOTE('evidence/FILE-A.pdf') });
  await assert.rejects(() => send(db, store, { key: 'K', op: REMOTE('evidence/file-a.pdf') }),
    (e) => e.details?.reason === IDEMPOTENCY_OPERATION_CONFLICT);
  await db.close();
});

test('L1 (3,4): CONTENT identity outranks location — same checksum dedupes, different is a 409', async () => {
  // Same document re-uploaded to a NEW object key: content says it is the same evidence.
  const db = await evidenceDb();
  const store = new Map();
  const a = await send(db, store, { key: 'K', op: REMOTE('evidence/A.pdf', { checksum: 'SUM-1' }) });
  const b = await send(db, store, { key: 'K', op: REMOTE('evidence/MOVED.pdf', { checksum: 'SUM-1' }) });
  assert.equal(b.deduped, true, 'a checksum match settles it regardless of where the object now lives');
  assert.equal(a.evidenceId, b.evidenceId);

  const db2 = await evidenceDb();
  const store2 = new Map();
  await send(db2, store2, { key: 'K', op: REMOTE('evidence/A.pdf', { checksum: 'SUM-1' }) });
  await assert.rejects(
    () => send(db2, store2, { key: 'K', op: REMOTE('evidence/A.pdf', { checksum: 'SUM-2' }) }),
    (e) => { assert.equal(e.details.field, 'checksum'); return true; });
  await db.close(); await db2.close();
});

test('L1 (5): INLINE evidence (checksum, no remote path) is unaffected', async () => {
  const db = await evidenceDb();
  const store = new Map();
  const inline = { evidence_class: 'registration', evidence_subtype: 'registration_book',
    evidence_type: 'registration_book', checksum: 'INLINE-1', storage_bucket: 'vehicle-images', file_path: null };
  const a = await send(db, store, { key: 'K', op: inline });
  const b = await send(db, store, { key: 'K', op: inline });
  assert.equal(b.deduped, true);
  assert.equal(a.evidenceId, b.evidenceId);
  await db.close();
});

test('L1 (8): the WARM CACHE and the COLD durable lookup enforce the same fingerprint', async () => {
  for (const cold of [false, true]) {
    const db = await evidenceDb();
    const store = new Map();
    await send(db, store, { key: 'K', op: REMOTE('evidence/FILE-A.pdf') });
    // cold = a fresh process, so the durable lookup must supply the operation from the ROW.
    const second = cold ? new Map() : store;
    await assert.rejects(
      () => send(db, second, { key: 'K', op: REMOTE('evidence/FILE-B.pdf') }),
      (e) => e.details?.reason === IDEMPOTENCY_OPERATION_CONFLICT,
      `cold=${cold}: both paths must refuse a different remote document`);
    await db.close();
  }
});

test('L1 (9): the PRE-MIGRATION metadata fallback still carries the operation identity', async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE vehicle_evidence (
    id text PRIMARY KEY, vin text, uploaded_by text,
    evidence_class text, evidence_subtype text, evidence_type text, checksum text,
    storage_bucket text, file_path text, file_url text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb);`);   // NO idempotency_key column
  await db.query(`INSERT INTO vehicle_evidence (id, vin, uploaded_by, evidence_class, evidence_subtype,
    evidence_type, storage_bucket, file_path, metadata)
    VALUES ('old-1','VIN-A','u1','registration','registration_book','registration_book',
            'vehicle-images','evidence/FILE-A.pdf','{"idempotency_key":"K"}'::jsonb);`);
  const legacy = {
    from: () => ({
      select: (cols) => {
        const f = {};
        const chain = {
          eq(k, v) { f[k] = v; return chain; },
          or() { f.viaColumn = true; return chain; },
          async limit() {
            if (f.viaColumn || cols.includes('idempotency_key')) {
              return { data: null, error: { code: '42703', message: 'column vehicle_evidence.idempotency_key does not exist' } };
            }
            const { rows } = await db.query(
              `SELECT id, vin, uploaded_by, evidence_class, evidence_subtype, evidence_type, checksum,
                      storage_bucket, file_path, file_url, metadata FROM vehicle_evidence
                WHERE uploaded_by = $2 AND metadata->>'idempotency_key' = $1 LIMIT 1;`,
              [f['metadata->>idempotency_key'], f.uploaded_by]);
            return { data: rows, error: null };
          },
        };
        return chain;
      },
    }),
  };
  const run = (op) => withUploadIdempotency('K', 'VIN-A', async () => ({ id: 'should-not-run' }),
    { store: new Map(), supabase: legacy, actorId: 'u1', operation: fingerprint(op) });

  const same = await run(REMOTE('evidence/FILE-A.pdf'));
  assert.equal(same.deduped, true, 'pre-migration dedupe still works');
  assert.equal(same.evidenceId, 'old-1');
  await assert.rejects(() => run(REMOTE('evidence/FILE-B.pdf')),
    (e) => e.details?.reason === IDEMPOTENCY_OPERATION_CONFLICT,
    'and it still enforces what it CAN know about the operation');
  await db.close();
});

test('L1: remote_ref is in the canonical fingerprint', () => {
  assert.ok(OPERATION_IDENTITY_FIELDS.includes('remote_ref'));
});

/* ══ L2 — Dealer seller/commerce authority over an EXISTING vehicle ════════════════════ */

const DEALERSHIP = 'tenant-moyo';
const GARAGE = 'tenant-garage';
const IMPORT = 'tenant-import';

async function authorityDb() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE tenants (id text PRIMARY KEY, type text, status text);`);
  await db.exec(`CREATE TABLE tenant_users (tenant_id text, user_id text, role text);`);
  await db.exec(`CREATE TABLE dealer_profiles (id text PRIMARY KEY, user_id text, tenant_id text, suspension_state text);`);
  await db.query(`INSERT INTO tenants VALUES ($1,'dealership','active'), ($2,'garage','active'),
    ($3,'import','active'), ('tenant-dead','dealership','suspended');`, [DEALERSHIP, GARAGE, IMPORT]);
  await db.query(`INSERT INTO tenant_users VALUES
    ($1,'u-dealer','admin'), ($1,'u-mech','mechanic'), ($2,'u-garage-admin','admin'),
    ($3,'u-import-admin','admin'), ('tenant-dead','u-dead','admin'), ($1,'u-susp','admin');`,
  [DEALERSHIP, GARAGE, IMPORT]);
  await db.query(`INSERT INTO dealer_profiles VALUES ('dp-s','u-susp',NULL,'suspended');`);
  return db;
}
const authClient = (db) => ({
  from: (table) => ({
    select: () => {
      const f = {};
      const chain = {
        eq(k, v) { f[k] = v; return chain; },
        async maybeSingle() {
          const sql = { tenants: 'SELECT id, type, status FROM tenants',
            tenant_users: 'SELECT role FROM tenant_users',
            dealer_profiles: 'SELECT id, tenant_id, suspension_state FROM dealer_profiles' }[table];
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

test('L2: the authority matrix for an EXISTING tenant-scoped vehicle', async () => {
  const db = await authorityDb();
  const client = authClient(db);
  const vehicle = { tenant_id: DEALERSHIP, owner_id: 'someone-else', current_seller_id: 'someone-else' };

  const matrix = [
    ['legitimate Dealer business actor', { id: 'u-dealer', role: 'dealer', tenantId: DEALERSHIP }, vehicle, true],
    ['dealership MECHANIC', { id: 'u-mech', role: 'dealer', tenantId: DEALERSHIP }, vehicle, false],
    ['garage admin', { id: 'u-garage-admin', role: 'dealer', tenantId: GARAGE }, { ...vehicle, tenant_id: GARAGE }, false],
    ['import-tenant admin', { id: 'u-import-admin', role: 'dealer', tenantId: IMPORT }, { ...vehicle, tenant_id: IMPORT }, false],
    ['inactive dealership', { id: 'u-dead', role: 'dealer', tenantId: 'tenant-dead' }, { ...vehicle, tenant_id: 'tenant-dead' }, false],
    ['withdrawn (suspended) authority', { id: 'u-susp', role: 'dealer', tenantId: DEALERSHIP }, vehicle, false],
    ['dealer against ANOTHER tenant\'s vehicle', { id: 'u-dealer', role: 'dealer', tenantId: DEALERSHIP }, { ...vehicle, tenant_id: GARAGE }, false],
    ['admin role in the dealership', { id: 'u-dealer', role: 'admin', tenantId: DEALERSHIP }, vehicle, false],
  ];
  for (const [label, ctx, veh, expected] of matrix) {
    assert.equal(await hasGovernedDealerVehicleAuthority(client, ctx, veh), expected, label);
  }
  await db.close();
});

test('L2 (13): CREATION and LIFECYCLE agree — one primitive, one answer', async () => {
  const db = await authorityDb();
  const client = authClient(db);
  const vehicle = { tenant_id: DEALERSHIP, owner_id: 'x', current_seller_id: 'x' };
  for (const [id, expected] of [['u-dealer', true], ['u-mech', false]]) {
    const ctx = { id, role: 'dealer', tenantId: DEALERSHIP };
    const creation = (await resolveDealerListingSubject(client, { role: ctx.role, userId: ctx.id, tenantId: ctx.tenantId })).granted;
    const lifecycle = await hasGovernedDealerVehicleAuthority(client, ctx, vehicle);
    assert.equal(creation, expected, `${id}: creation`);
    assert.equal(lifecycle, expected, `${id}: lifecycle`);
    assert.equal(creation, lifecycle, `${id}: the two surfaces must not disagree`);
  }
  await db.close();
});

test('L2 (7,8): Owner and current-seller recognition are untouched', () => {
  const owner = { id: 'u-owner' };
  const seller = { id: 'u-seller' };
  const vehicle = { owner_id: 'u-owner', current_seller_id: 'u-seller', tenant_id: DEALERSHIP };
  assert.equal(hasExistingSellerRelationship(vehicle, owner), true, 'canonical Owner survives');
  assert.equal(hasExistingSellerRelationship(vehicle, seller), true, 'current seller survives');
});

test('L2: the recognition primitive FAILS CLOSED on the tenant clause', () => {
  const vehicle = { owner_id: 'other', current_seller_id: 'other', tenant_id: DEALERSHIP };
  const member = { id: 'u-mech', tenantId: DEALERSHIP };
  assert.equal(hasExistingSellerRelationship(vehicle, member), false,
    'a caller that does not supply a governed decision must NOT get the tenant clause');
  assert.equal(hasExistingSellerRelationship(vehicle, member, { dealerTenantAuthorized: true }), true,
    'and it is granted only when the governed authority said so');
});

/* ══ L2 tripwire — a new raw seller tenant-equality clause cannot creep back ═══════════ */

test('L2 TRIPWIRE: no SELLER surface re-introduces raw tenant equality', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  // The seller/commerce surfaces this round closed. A raw `tenant_id === ...tenantId` comparison
  // reappearing in any of them is the exact defect L2 fixed, so it fails here rather than in review.
  const GUARDED = [
    '../routes/vehiclesRoutes.js',
    '../services/storage/mediaRouter.js',
    '../services/seller/sellerAuthorityService.js',
  ];
  const RAW = /tenant_id\s*===\s*[A-Za-z_$][\w$.?]*\.tenantId/g;
  for (const rel of GUARDED) {
    // A comparison guarded by the governed decision is NOT raw — that is the closed form, and the
    // flag defaults to false, so it cannot fire unless a caller resolved the authority.
    const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.includes('dealerTenantAuthorized'))
      .join('\n');
    const hits = code.match(RAW) || [];
    assert.deepEqual(hits, [],
      `${rel} re-introduced raw tenant equality as seller authority — route it through `
      + 'hasGovernedDealerVehicleAuthority instead');
  }
});

test('L2: Service Network and PartSentry authority are deliberately NOT routed through this', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const server = readFileSync(fileURLToPath(new URL('../server.js', import.meta.url)), 'utf8');
  // A mechanic servicing a vehicle is not a Dealer seller. This closure must not have taken their
  // governed assignment path away, so the Service Network clause must still be its own.
  const mechanicFn = server.slice(server.indexOf('async function mechanicIsAssignedToVehicle'));
  assert.match(mechanicFn.slice(0, 600), /tenant_id === userContext\.tenantId/,
    'Service Network assignment keeps its own tenant scope — marketplace authority must not replace it');
});

/* ══ L5 — prepare persists artefacts but never authority; export stays actor-owned ═════ */

test('L5: EXPORT is actor-owned — a prepare-only Dealer cannot read another tenant\'s inventory', async () => {
  const { exportVehicleWorkbookFromDatabase } = await import('../services/workbook/workbookDbExportService.js');
  const seen = [];
  const client = {
    from: (table) => {
      const f = {};
      const chain = {
        select() { return chain; },
        eq(k, v) { f[k] = v; if (table === 'vehicles') seen.push({ k, v }); return chain; },
        in() { return chain; },
        limit() { return Promise.resolve({ data: [], error: null }); },
        then(r) { return Promise.resolve({ data: [], error: null }).then(r); },
      };
      return chain;
    },
  };
  await exportVehicleWorkbookFromDatabase('seller_vehicles', { id: 'u-dealer', tenantId: 'tenant-someone-else' },
    { supabaseClient: client });
  assert.deepEqual(seen, [{ k: 'current_seller_id', v: 'u-dealer' }],
    'export is scoped to the actor\'s OWN vehicles — never to a tenant they merely belong to');
});

test('L5: the action contract says prepare creates no AUTHORITY, not that it writes nothing', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../services/workbook/workbookCatalogueService.js', import.meta.url)), 'utf8');
  // Comment prose wraps across lines and carries ` * ` prefixes, so compare on normalised text.
  const prose = src.replace(/^\s*\*\s?/gm, ' ').replace(/\s+/g, ' ');
  assert.equal(/prepare[\s\S]{0,200}creates nothing/.test(prose), false,
    'the old wording was untrue of the dry run and would invite "fixing" behaviour that is correct');
  assert.match(prose, /persist preparation artefacts/);
  assert.match(prose, /never creates is a vehicle, evidence, a listing subject/);
});

/* ══ dealer_profiles duplicate race — AUDIT ONLY, recorded not fixed ═══════════════════ */

test('AUDIT: a duplicated dealer_profiles row FAILS CLOSED — it denies, it does not widen', async () => {
  // `dealer_profiles.user_id` carries a non-unique index, and createOrUpdateProfile is
  // read-then-insert, so two concurrent calls could in principle create two rows for one user.
  // What matters for THIS lane is the authority direction: `maybeSingle()` errors on multiple
  // rows, and the resolver treats an unreadable authority as no authority.
  const multiRow = {
    from: () => ({
      select: () => ({
        eq() { return this; },
        async maybeSingle() {
          return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
        },
      }),
    }),
  };
  const subject = await resolveDealerListingSubject(multiRow,
    { role: 'dealer', userId: 'u-dup', tenantId: DEALERSHIP });
  assert.equal(subject.granted, false,
    'a duplicate profile must never be able to mask a suspension or grant authority');
});

test('L: a dealer_profiles tenant binding CANNOT grant authority on its own', async () => {
  // dealer_profiles carries RLS policies letting `authenticated` INSERT/UPDATE their own row, and
  // the WITH CHECK constrains user_id but not tenant_id. A self-written binding must therefore
  // never be sufficient — the governed organisation facts are required in every case.
  const db = await authorityDb();
  await db.query(`INSERT INTO dealer_profiles VALUES ('dp-self','u-self',$1,'none');`, [GARAGE]);
  await db.query(`INSERT INTO tenant_users VALUES ($1,'u-self','admin');`, [GARAGE]);
  const s = await resolveDealerListingSubject(authClient(db),
    { role: 'dealer', userId: 'u-self', tenantId: GARAGE });
  assert.equal(s.granted, false, 'a self-assignable binding must not outrank the tenant type test');
  assert.equal(s.reason, 'tenant_not_a_dealership');
  await db.close();
});
