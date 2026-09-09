/**
 * O2 — M-round closure.
 *
 * M1  a checksum sent BESIDE a remote URL is a caller's assertion, not knowledge. The L-round let
 *     any checksum on both sides outrank the object location, so the same asserted string with a
 *     different `file_url` discarded a genuinely different document.
 * M2  stripping every query string is right for a SIGNED storage URL and wrong for an arbitrary
 *     external one, where the query can be the only thing naming the document.
 * M3  the evidence link-event route read the tenant through a local alias, so raw membership still
 *     linked evidence — the L2 defect in another spelling.
 * M4  `GET /api/vehicles/:vin/completeness` says it mirrors `loadScopedVehicle` and did not.
 * M5  the L tripwire never inspected `server.js` and could not see aliasing. Replaced with a
 *     register-driven invariant over the Seller/commerce/private-evidence surfaces.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  withUploadIdempotency,
  toDatabaseError,
  deriveRemoteReference,
  CHECKSUM_SOURCES,
  IDEMPOTENCY_OPERATION_CONFLICT,
  PROVENANCE_KEY,
  buildProvenance,
} from '../services/evidence/uploadIdempotency.js';
import { hasGovernedDealerVehicleAuthority } from '../services/dealer/dealerListingAuthority.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/* ══ M1 — a checksum may outrank location only where the SERVER computed it ════════════ */

const COLS = 'id, vin, uploaded_by, evidence_class, evidence_subtype, evidence_type, checksum, '
  + 'storage_bucket, file_path, file_url, metadata, idempotency_key';

async function evidenceDb() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE vehicle_evidence (id text PRIMARY KEY, vin text, uploaded_by text,
    evidence_class text, evidence_subtype text, evidence_type text, checksum text,
    storage_bucket text, file_path text, file_url text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb, idempotency_key text);`);
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
            `SELECT ${COLS} FROM vehicle_evidence WHERE uploaded_by = $2
              AND (idempotency_key = $1 OR metadata->>'idempotency_key' = $1) LIMIT 1;`,
            [f.key, f.uploaded_by]);
          return { data: rows, error: null };
        },
      };
      return chain;
    },
  }),
});

let seq = 0;
const write = (db) => async ({ op, key }) => {
  seq += 1;
  const meta = { idempotency_key: key };
  // P1 — provenance is server-authored under its own namespace; the flat key is never read.
  if (op.checksum_source) {
    meta[PROVENANCE_KEY] = buildProvenance({
      hasInlineBuffer: op.checksum_source === CHECKSUM_SOURCES.SERVER_INLINE,
      hasChecksum: Boolean(op.checksum),
    });
  }
  let data = null; let error = null;
  try {
    const { rows } = await db.query(
      `INSERT INTO vehicle_evidence (id, vin, uploaded_by, evidence_class, evidence_subtype,
        evidence_type, checksum, storage_bucket, file_path, file_url, metadata, idempotency_key)
       VALUES ($1,'VIN-A','u1',$2,$3,$4,$5,$6,$7,$7,$8::jsonb,$9) RETURNING id, vin;`,
      [`ev-${seq}`, op.evidence_class, op.evidence_subtype, op.evidence_type, op.checksum ?? null,
        op.storage_bucket ?? 'vehicle-images', op.file_path ?? null, JSON.stringify(meta), key]);
    data = rows[0];
  } catch (e) { error = { message: e.message, code: e.code, constraint: e.constraint }; }
  if (error) throw toDatabaseError(error);
  return data;
};

const OP = (file_path, checksum = null, checksum_source = null) => ({
  evidence_class: 'registration', evidence_subtype: 'registration_book',
  evidence_type: 'registration_book', checksum, checksum_source,
  storage_bucket: 'vehicle-images', file_path,
});
const fp = (op) => ({ ...op, remote_ref: deriveRemoteReference(op) });
const send = (db, store, op, key = 'K') =>
  withUploadIdempotency(key, 'VIN-A', () => write(db)({ op, key }),
    { store, supabase: clientOver(db), actorId: 'u1', operation: fp(op) });

test('M1: a CLIENT-ASSERTED checksum must not suppress a changed remote object', async () => {
  const db = await evidenceDb();
  const store = new Map();
  await send(db, store, OP('evidence/FILE-A.pdf', 'ASSERTED-SAME', CHECKSUM_SOURCES.CLIENT_ASSERTED));
  await assert.rejects(
    () => send(db, store, OP('evidence/FILE-B.pdf', 'ASSERTED-SAME', CHECKSUM_SOURCES.CLIENT_ASSERTED)),
    (e) => {
      assert.equal(e.statusCode, 409);
      assert.equal(e.details.reason, IDEMPOTENCY_OPERATION_CONFLICT);
      assert.equal(e.details.field, 'remote_ref', 'the LOCATION decides when the checksum is unverified');
      return true;
    },
    'an unverified assertion must not outrank a genuinely different object');
  const { rows } = await db.query(`SELECT file_path FROM vehicle_evidence;`);
  assert.deepEqual(rows, [{ file_path: 'evidence/FILE-A.pdf' }], 'FILE-B refused loudly, never discarded');
  await db.close();
});

test('M1: a SERVER-COMPUTED inline checksum still outranks location', async () => {
  const db = await evidenceDb();
  const store = new Map();
  const a = await send(db, store, OP('evidence/A.pdf', 'SUM-1', CHECKSUM_SOURCES.SERVER_INLINE));
  const b = await send(db, store, OP('evidence/MOVED.pdf', 'SUM-1', CHECKSUM_SOURCES.SERVER_INLINE));
  assert.equal(b.deduped, true, 'content CarUp actually hashed settles it even if the object moved');
  assert.equal(a.evidenceId, b.evidenceId);
  await db.close();
});

test('M1: same remote reference + same asserted checksum still dedupes', async () => {
  const db = await evidenceDb();
  const store = new Map();
  const a = await send(db, store, OP('evidence/A.pdf', 'ASSERTED', CHECKSUM_SOURCES.CLIENT_ASSERTED));
  const b = await send(db, store, OP('evidence/A.pdf', 'ASSERTED', CHECKSUM_SOURCES.CLIENT_ASSERTED));
  assert.equal(b.deduped, true, 'nothing contradicts — a genuine retry must not be refused');
  assert.equal(a.evidenceId, b.evidenceId);
  await db.close();
});

test('M1: different remote reference with NO checksum is still a conflict', async () => {
  const db = await evidenceDb();
  const store = new Map();
  await send(db, store, OP('evidence/A.pdf'));
  await assert.rejects(() => send(db, store, OP('evidence/B.pdf')),
    (e) => e.details?.reason === IDEMPOTENCY_OPERATION_CONFLICT);
  await db.close();
});

test('M1: a mixed pair (asserted vs server-computed) is NOT treated as verified', async () => {
  const db = await evidenceDb();
  const store = new Map();
  await send(db, store, OP('evidence/A.pdf', 'SUM-1', CHECKSUM_SOURCES.CLIENT_ASSERTED));
  await assert.rejects(
    () => send(db, store, OP('evidence/B.pdf', 'SUM-1', CHECKSUM_SOURCES.SERVER_INLINE)),
    (e) => e.details?.field === 'remote_ref',
    'trust requires BOTH sides to be server-established');
  await db.close();
});

test('M1: a historical row with no provenance is treated as UNVERIFIED (conservative)', async () => {
  const db = await evidenceDb();
  await db.query(`INSERT INTO vehicle_evidence (id, vin, uploaded_by, evidence_class, evidence_subtype,
    evidence_type, checksum, storage_bucket, file_path, metadata, idempotency_key)
    VALUES ('old-1','VIN-A','u1','registration','registration_book','registration_book','SUM-1',
            'vehicle-images','evidence/OLD.pdf','{"idempotency_key":"K"}'::jsonb,'K');`);
  await assert.rejects(
    () => send(db, new Map(), OP('evidence/NEW.pdf', 'SUM-1', CHECKSUM_SOURCES.SERVER_INLINE)),
    (e) => e.details?.field === 'remote_ref',
    'a row that never recorded provenance cannot be trusted to outrank location');
  await db.close();
});

test('M1/P1: the route records provenance server-side, and only inline is server-computed', () => {
  const route = src('../routes/vehiclesRoutes.js');
  assert.match(route, /metadata\[PROVENANCE_KEY\] = buildProvenance\(\{ hasInlineBuffer: Boolean\(fileBuffer\)/,
    'provenance must be decided by whether the server held the bytes, in a namespace it owns');
  assert.match(route, /checksum = checksumForBuffer\(fileBuffer\)/,
    'and the only server-computed checksum remains the inline one');
});

/* ══ M2 — the locator rules ════════════════════════════════════════════════════════════ */

test('M2/P2: a re-signed storage URL on the CONFIGURED origin converges on the object key', () => {
  // P2 narrowed this: the path shape alone is not provenance, so the origin must be CarUp's own.
  const prev = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = 'https://p.supabase.co';
  try {
    const a = deriveRemoteReference({ file_url: 'https://p.supabase.co/storage/v1/object/sign/vehicle-images/ev/A.pdf?token=aaa&exp=1' });
    const b = deriveRemoteReference({ file_url: 'https://p.supabase.co/storage/v1/object/sign/vehicle-images/ev/A.pdf?token=bbb&exp=2' });
    assert.equal(a, b);
    assert.equal(a, 'vehicle-images/ev/A.pdf');
  } finally { process.env.SUPABASE_URL = prev; }
});

test('M2: DIFFERENT stable storage objects stay distinct', () => {
  const prev = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = 'https://p.supabase.co';
  try {
  assert.notEqual(
    deriveRemoteReference({ file_url: 'https://p.supabase.co/storage/v1/object/sign/vehicle-images/ev/A.pdf?token=x' }),
    deriveRemoteReference({ file_url: 'https://p.supabase.co/storage/v1/object/sign/vehicle-images/ev/B.pdf?token=x' }));
  } finally { process.env.SUPABASE_URL = prev; }
});

test('M2: an arbitrary EXTERNAL url keeps its identity-bearing query', async () => {
  const a = deriveRemoteReference({ file_url: 'https://example.test/document?id=A' });
  const b = deriveRemoteReference({ file_url: 'https://example.test/document?id=B' });
  assert.notEqual(a, b, 'the query may be the only thing naming the document');
  assert.equal(a, 'https://example.test/document?id=A', 'kept in full, not truncated');

  const db = await evidenceDb();
  const store = new Map();
  const ext = (url) => ({ ...OP(null), file_path: null, file_url: url, storage_bucket: null });
  const opA = ext('https://example.test/document?id=A');
  const opB = ext('https://example.test/document?id=B');
  await withUploadIdempotency('K', 'VIN-A', () => write(db)({ op: { ...opA, file_path: opA.file_url }, key: 'K' }),
    { store, supabase: clientOver(db), actorId: 'u1', operation: fp(opA) });
  await assert.rejects(
    () => withUploadIdempotency('K', 'VIN-A', () => write(db)({ op: { ...opB, file_path: opB.file_url }, key: 'K' }),
      { store, supabase: clientOver(db), actorId: 'u1', operation: fp(opB) }),
    (e) => e.details?.reason === IDEMPOTENCY_OPERATION_CONFLICT,
    'two different external documents must not collapse into one');
  await db.close();
});

test('M2: the FRAGMENT is dropped deliberately — it addresses a position, not a resource', () => {
  assert.equal(deriveRemoteReference({ file_url: 'https://example.test/doc.pdf#page=2' }), 'https://example.test/doc.pdf');
  assert.equal(deriveRemoteReference({ file_url: 'https://example.test/doc.pdf#page=9' }), 'https://example.test/doc.pdf');
});

test('M2: storage-relative object keys stay verbatim and CASE-SENSITIVE', () => {
  assert.equal(deriveRemoteReference({ storage_bucket: 'b', file_path: 'ev/FILE-A.pdf' }), 'b/ev/FILE-A.pdf');
  assert.notEqual(deriveRemoteReference({ storage_bucket: 'b', file_path: 'ev/FILE-A.pdf' }),
    deriveRemoteReference({ storage_bucket: 'b', file_path: 'ev/file-a.pdf' }));
});

test('M2: warm cache and cold durable lookup agree on the external-URL identity', async () => {
  for (const cold of [false, true]) {
    const db = await evidenceDb();
    const store = new Map();
    const mk = (url) => ({ ...OP(url), file_path: url, storage_bucket: null });
    await send(db, store, mk('https://example.test/d?id=A'));
    await assert.rejects(() => send(db, cold ? new Map() : store, mk('https://example.test/d?id=B')),
      (e) => e.details?.reason === IDEMPOTENCY_OPERATION_CONFLICT, `cold=${cold}`);
    await db.close();
  }
});

/* ══ M3 / M4 — the two surfaces, and the authority they must share ═════════════════════ */

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
  await db.query(`INSERT INTO tenant_users VALUES ($1,'u-admin','admin'), ($1,'u-mech','mechanic'),
    ($2,'u-garage','admin'), ($3,'u-import','admin'), ('tenant-dead','u-dead','admin'), ($1,'u-susp','admin');`,
  [DEALERSHIP, GARAGE, IMPORT]);
  await db.query(`INSERT INTO dealer_profiles VALUES ('dp','u-susp',NULL,'suspended');`);
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
          const k = Object.keys(f);
          const clause = k.length ? ' WHERE ' + k.map((c, i) => `${c} = $${i + 1}`).join(' AND ') : '';
          const { rows } = await db.query(`${sql}${clause} LIMIT 1;`, k.map((c) => f[c]));
          return { data: rows[0] || null, error: null };
        },
      };
      return chain;
    },
  }),
});

test('M3/M4: the shared authority answers every required control identically', async () => {
  const db = await authorityDb();
  const client = authClient(db);
  const vehicle = (t = DEALERSHIP) => ({ tenant_id: t, owner_id: 'other', current_seller_id: 'other' });
  const cases = [
    ['governed Dealer admin', { id: 'u-admin', role: 'dealer', tenantId: DEALERSHIP }, vehicle(), true],
    ['dealership MECHANIC', { id: 'u-mech', role: 'dealer', tenantId: DEALERSHIP }, vehicle(), false],
    ['garage admin', { id: 'u-garage', role: 'dealer', tenantId: GARAGE }, vehicle(GARAGE), false],
    ['import-tenant admin', { id: 'u-import', role: 'dealer', tenantId: IMPORT }, vehicle(IMPORT), false],
    ['inactive dealership', { id: 'u-dead', role: 'dealer', tenantId: 'tenant-dead' }, vehicle('tenant-dead'), false],
    ['withdrawn authority', { id: 'u-susp', role: 'dealer', tenantId: DEALERSHIP }, vehicle(), false],
  ];
  for (const [label, ctx, veh, expected] of cases) {
    assert.equal(await hasGovernedDealerVehicleAuthority(client, ctx, veh), expected, label);
  }
  await db.close();
});

test('M3: the link-event route composes the governed authority after owner/current-seller', () => {
  const code = src('../routes/vehiclesRoutes.js');
  const start = code.indexOf("router.patch('/api/vehicles/:vin/evidence/:evidenceId/link-event'");
  assert.ok(start > 0, 'the route must still exist');
  const body = code.slice(start, code.indexOf('\nrouter.', start + 10));
  assert.match(body, /hasGovernedDealerVehicleAuthority/, 'raw membership must not link evidence');
  assert.match(body, /!isOwner && !isCurrentSeller/, 'and the owner path must stay query-free');
  assert.match(body, /activeRole !== 'admin' && activeRole !== 'government'/,
    'Admin/Government behaviour is preserved exactly');
});

test('M4: the completeness read composes the governed authority', () => {
  const code = src('../server.js');
  const start = code.indexOf("app.get('/api/vehicles/:vin/completeness'");
  assert.ok(start > 0);
  const body = code.slice(start, code.indexOf('\napp.', start + 10));
  assert.match(body, /hasGovernedDealerVehicleAuthority/);
  assert.match(body, /!ownsVehicle && !isCurrentSeller/);
  assert.match(body, /'owner', 'dealer', 'admin', 'reviewer'/, 'Admin and Reviewer remain allowed roles');
});

/* ══ M5 — a register-driven invariant that sees aliasing, arrays, and server.js ════════ */

/**
 * The Seller / commerce / private-evidence surfaces. Each entry names the file and the exact
 * source anchor that opens the surface. The invariant: if a surface grants on a tenant
 * relationship AT ALL — however it is spelled — it must reach the canonical governed decision.
 *
 * The L tripwire failed twice: it never read `server.js`, and its regex only saw direct
 * `.tenantId` access, so `const activeTenantId = …; vehicle.tenant_id === activeTenantId` walked
 * straight past it. This looks for the tenant GRANT in any spelling instead of one syntax.
 *
 * P4 — THIS IS A COVERAGE CHECK, NOT THE PROOF OF AUTHORITY. It can only see that a surface
 * mentions the governed decision; it cannot see whether the result is USED. A mutation that
 * restores the raw grant while leaving the call present passes here and is caught by the
 * BEHAVIOURAL matrix in `o2-predictive-closure.test.js`, which asserts the status and the row
 * count instead of the spelling. Keep both: this one says WHICH surfaces must be tested.
 */
const SELLER_SURFACES = [
  ['../routes/vehiclesRoutes.js', "router.patch('/api/vehicles/:vin/status'", 'vehicle status'],
  ['../routes/vehiclesRoutes.js', 'async function loadScopedVehicle', 'publish / unpublish / price'],
  ['../routes/vehiclesRoutes.js', 'async function assertEvidenceOwnershipScope', 'evidence upload seller scope'],
  ['../routes/vehiclesRoutes.js', "router.patch('/api/vehicles/:vin/evidence/:evidenceId/link-event'", 'evidence link-event'],
  ['../routes/vehiclesRoutes.js', "router.get('/api/vehicles/:vin/evidence'", 'private evidence read'],
  ['../server.js', "app.get('/api/vehicles/:vin/completeness'", 'vehicle completeness'],
  ['../server.js', "app.patch('/api/vehicles/:vin/seller-draft'", 'seller draft'],
  // P3 — both governed in source but previously unregistered, so a regression in either was
  // invisible to this coverage check.
  ['../server.js', "app.post('/api/vehicles/add'", 'existing-Passport reuse'],
  ['../services/storage/mediaRouter.js', "router.post('/upload/document'", 'private document upload'],
  ['../services/storage/mediaRouter.js', "router.post('/upload/vehicle'", 'media upload'],
  ['../services/storage/mediaRouter.js', "router.get('/upload/signed-url'", 'media signed url'],
  ['../services/storage/mediaRouter.js', "router.get('/document/signed-url'", 'private document read'],
  ['../services/seller/sellerAuthorityService.js', 'export function hasExistingSellerRelationship', 'seller relationship recognition'],
];

/** Surfaces that legitimately keep their OWN tenant scope — a different authority entirely. */
const NOT_SELLER_AUTHORITY = [
  ['../server.js', 'async function mechanicIsAssignedToVehicle', 'Service Network assignment'],
  ['../server.js', "app.post('/api/partsentry/add'", 'PartSentry service authority'],
  ['../middleware/vehicleObjectAuthority.js', 'export async function resolveVehicleObjectAuthority', 'lender/insurer object authority'],
];

/** A tenant RELATIONSHIP grant, in any spelling: direct, aliased, or array membership. */
const TENANT_GRANT = /tenant_id\s*===|tenant_id\s*==[^=]|tenantIds?\s*\.\s*includes\s*\(|includes\(\s*[A-Za-z_$][\w$.?]*\.tenant_id/;

function surfaceBody(rel, anchor) {
  const code = src(rel).replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const start = code.indexOf(anchor);
  assert.ok(start > 0, `${rel}: anchor not found — "${anchor}". Update the register if it was renamed.`);
  const rest = code.slice(start + anchor.length);
  const end = rest.search(/\n(?:router|app)\.(?:get|post|patch|put|delete)\(|\n(?:export )?(?:async )?function /);
  return rest.slice(0, end === -1 ? rest.length : end);
}

test('M5 TRIPWIRE: every Seller surface that grants on a tenant must reach the governed decision', () => {
  const offenders = [];
  for (const [rel, anchor, label] of SELLER_SURFACES) {
    const body = surfaceBody(rel, anchor);
    if (!TENANT_GRANT.test(body)) continue;             // grants nothing on a tenant — fine
    const governed = /hasGovernedDealerVehicleAuthority|dealerTenantAuthorized/.test(body);
    if (!governed) offenders.push(`${label} (${rel})`);
  }
  assert.deepEqual(offenders, [],
    'these Seller surfaces grant on a tenant relationship without the canonical governed Dealer '
    + 'decision — route them through hasGovernedDealerVehicleAuthority');
});

test('M5: the register itself is honest — every anchor resolves', () => {
  for (const [rel, anchor] of [...SELLER_SURFACES, ...NOT_SELLER_AUTHORITY]) {
    assert.ok(surfaceBody(rel, anchor).length > 0, `${rel}: ${anchor}`);
  }
});

test('M5: Service Network, PartSentry and object authority keep their OWN scope', () => {
  for (const [rel, anchor, label] of NOT_SELLER_AUTHORITY) {
    const body = surfaceBody(rel, anchor);
    assert.equal(/hasGovernedDealerVehicleAuthority/.test(body), false,
      `${label} must NOT be routed through Dealer seller authority — servicing a car is not selling it`);
    assert.match(body, /tenant_id/, `${label} must still have its own tenant scope`);
  }
});
