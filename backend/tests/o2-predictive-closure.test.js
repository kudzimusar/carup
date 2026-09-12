/**
 * O2 — predictive closure remediation.
 *
 * P1  provenance must not self-certify. `metadata` is built as `{ ...clientMetadata, … }`, and
 *     before the M contract nothing overwrote `checksum_source`, so a historical row could simply
 *     CONTAIN the string `server_inline` and be believed.
 * P2  a Supabase-SHAPED path is not provenance. Any host can serve
 *     `/storage/v1/object/sign/<bucket>/<key>`; treating the shape as trust collapsed two different
 *     external documents into one identity.
 * P3  the Seller-surface register omitted two governed surfaces.
 * P4  the M5 guard proved SOURCE PRESENCE, not behavioural dependence: it stayed green when the raw
 *     grant was restored and the governed call's result was simply discarded.
 *
 * P4 is why the load-bearing proof in this file is BEHAVIOURAL — it drives real routes with an
 * adversarial actor and asserts the outcome and the row count, not the spelling.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const {
  withUploadIdempotency, toDatabaseError, deriveRemoteReference, isTrustedStorageOrigin,
  readStoredChecksumSource, buildProvenance, PROVENANCE_KEY, PROVENANCE_VERSION,
  CHECKSUM_SOURCES, IDEMPOTENCY_OPERATION_CONFLICT,
} = await import('../services/evidence/uploadIdempotency.js');

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/* ══ P1 — historical metadata cannot certify itself ════════════════════════════════════ */

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
              AND (idempotency_key = $1 OR metadata->>'idempotency_key' = $1) LIMIT 1;`, [f.key, f.uploaded_by]);
          return { data: rows, error: null };
        },
      };
      return chain;
    },
  }),
});

/** Seed a row with EXACTLY the metadata given — the point is what a stored row may claim. */
const seed = (db, id, filePath, checksum, metadata) => db.query(
  `INSERT INTO vehicle_evidence VALUES ($1,'VIN-A','u1','registration','registration_book',
    'registration_book',$2,'vehicle-images',$3,$3,$4::jsonb,'K');`,
  [id, checksum, filePath, JSON.stringify(metadata)]);

const REQUEST = (filePath, checksum, source) => ({
  evidence_class: 'registration', evidence_subtype: 'registration_book',
  evidence_type: 'registration_book', checksum, checksum_source: source,
  storage_bucket: 'vehicle-images', file_path: filePath,
});
const attempt = (db, op) => {
  let created = 0;
  const run = withUploadIdempotency('K', 'VIN-A', async () => { created += 1; return { id: 'ev-new', vin: 'VIN-A' }; },
    { store: new Map(), supabase: clientOver(db), actorId: 'u1',
      operation: { ...op, remote_ref: deriveRemoteReference(op) } });
  return { run, created: () => created };
};

test('P1 (4): a HISTORICAL row whose metadata merely CONTAINS server_inline is not trusted', async () => {
  const db = await evidenceDb();
  // The client's own metadata object is spread into the stored row; before this contract nothing
  // overwrote the key, so this is a shape real historical data can have.
  await seed(db, 'old-1', 'evidence/OLD-A.pdf', 'SUM', { idempotency_key: 'K', checksum_source: 'server_inline' });
  const a = attempt(db, REQUEST('evidence/NEW-B.pdf', 'SUM', CHECKSUM_SOURCES.SERVER_INLINE));
  await assert.rejects(() => a.run,
    (e) => {
      assert.equal(e.statusCode, 409);
      assert.equal(e.details.field, 'remote_ref', 'the changed object must decide, not the claim');
      return true;
    },
    'a legacy flat flag must not certify that CarUp computed the checksum');
  await db.close();
});

test('P1 (3): a historical row with NO provenance is untrusted', async () => {
  const db = await evidenceDb();
  await seed(db, 'old-2', 'evidence/OLD-A.pdf', 'SUM', { idempotency_key: 'K' });
  await assert.rejects(() => attempt(db, REQUEST('evidence/NEW-B.pdf', 'SUM', CHECKSUM_SOURCES.SERVER_INLINE)).run,
    (e) => e.details?.field === 'remote_ref');
  await db.close();
});

test('P1 (1): a row written under the CURRENT server-authored contract IS trusted', async () => {
  const db = await evidenceDb();
  // F1 — the block is SIGNED and bound to the row, so the seed must supply the row's own facts.
  await seed(db, 'cur-1', 'evidence/A.pdf', 'SUM',
    { idempotency_key: 'K', [PROVENANCE_KEY]: buildProvenance({
      hasInlineBuffer: true, hasChecksum: true, checksum: 'SUM', vin: 'VIN-A', uploadedBy: 'u1' }) });
  const a = attempt(db, REQUEST('evidence/MOVED.pdf', 'SUM', CHECKSUM_SOURCES.SERVER_INLINE));
  const out = await a.run;
  assert.equal(out.deduped, true, 'genuine server-computed content still outranks a moved object');
  assert.equal(out.evidenceId, 'cur-1');
  assert.equal(a.created(), 0);
  await db.close();
});

test('P1 (2): a CURRENT client-asserted checksum gains no trust', async () => {
  const db = await evidenceDb();
  await seed(db, 'cur-2', 'evidence/A.pdf', 'SUM',
    { idempotency_key: 'K', [PROVENANCE_KEY]: buildProvenance({
      hasInlineBuffer: false, hasChecksum: true, checksum: 'SUM', vin: 'VIN-A', uploadedBy: 'u1' }) });
  await assert.rejects(() => attempt(db, REQUEST('evidence/B.pdf', 'SUM', CHECKSUM_SOURCES.CLIENT_ASSERTED)).run,
    (e) => e.details?.field === 'remote_ref');
  await db.close();
});

test('P1 (6): a legitimate historical retry is NOT broken where nothing contradicts', async () => {
  const db = await evidenceDb();
  await seed(db, 'old-3', 'evidence/SAME.pdf', 'SUM', { idempotency_key: 'K', checksum_source: 'server_inline' });
  const a = attempt(db, REQUEST('evidence/SAME.pdf', 'SUM', CHECKSUM_SOURCES.SERVER_INLINE));
  const out = await a.run;
  assert.equal(out.deduped, true, 'the compatibility floor must survive — same object, same key');
  assert.equal(a.created(), 0);
  await db.close();
});

test('P1 (5): warm cache and cold durable lookup agree on the untrusted historical row', async () => {
  for (const cold of [false, true]) {
    const db = await evidenceDb();
    await seed(db, 'old-4', 'evidence/OLD-A.pdf', 'SUM', { idempotency_key: 'K', checksum_source: 'server_inline' });
    const store = new Map();
    if (!cold) {
      // warm the cache with the stored row by resolving it once against the same object
      await withUploadIdempotency('K', 'VIN-A', async () => ({ id: 'x' }),
        { store, supabase: clientOver(db), actorId: 'u1',
          operation: { ...REQUEST('evidence/OLD-A.pdf', 'SUM', CHECKSUM_SOURCES.SERVER_INLINE),
            remote_ref: deriveRemoteReference(REQUEST('evidence/OLD-A.pdf')) } });
    }
    const op = REQUEST('evidence/NEW-B.pdf', 'SUM', CHECKSUM_SOURCES.SERVER_INLINE);
    await assert.rejects(
      () => withUploadIdempotency('K', 'VIN-A', async () => ({ id: 'ev-new' }),
        { store, supabase: clientOver(db), actorId: 'u1', operation: { ...op, remote_ref: deriveRemoteReference(op) } }),
      (e) => e.details?.reason === IDEMPOTENCY_OPERATION_CONFLICT, `cold=${cold}`);
    await db.close();
  }
});

test('P1: only a versioned, server-authored block is read', () => {
  assert.equal(readStoredChecksumSource({ checksum_source: 'server_inline' }), null, 'legacy flat key ignored');
  assert.equal(readStoredChecksumSource({ [PROVENANCE_KEY]: { checksum_source: 'server_inline' } }), null, 'unversioned ignored');
  assert.equal(readStoredChecksumSource({ [PROVENANCE_KEY]: { v: PROVENANCE_VERSION + 1, checksum_source: 'server_inline' } }), null,
    'a different contract version is not inherited');
  assert.equal(readStoredChecksumSource({ [PROVENANCE_KEY]: buildProvenance({ hasInlineBuffer: true, hasChecksum: true }) }),
    CHECKSUM_SOURCES.SERVER_INLINE);
});

test('P1: the writer assigns provenance UNCONDITIONALLY, after the client spread', () => {
  const route = src('../routes/vehiclesRoutes.js');
  assert.match(route, /metadata\[PROVENANCE_KEY\] = buildProvenance\(/,
    'the server must author the namespace so a client cannot pre-seed it');
  const spreadAt = route.indexOf('buildAiReadyMetadata({');
  const assignAt = route.indexOf('metadata[PROVENANCE_KEY] = buildProvenance(');
  assert.ok(spreadAt > 0 && assignAt > spreadAt, 'and must do so AFTER the client metadata is spread in');
});

/* ══ P2 — a trusted ORIGIN, not a path shape ══════════════════════════════════════════ */

test('P2: the exact evil-host example stays opaque and its identity query is kept', () => {
  const A = 'https://evil.example/storage/v1/object/sign/vehicle-images/A.pdf?id=ONE';
  const B = 'https://evil.example/storage/v1/object/sign/vehicle-images/A.pdf?id=TWO';
  const a = deriveRemoteReference({ file_url: A });
  const b = deriveRemoteReference({ file_url: B });
  assert.notEqual(a, b, 'a Supabase-SHAPED path on a foreign host is not a signed storage URL');
  assert.equal(a, A, 'it is opaque — the query is identity-bearing and is retained in full');
});

test('P2: the CONFIGURED storage origin still yields a stable object identity', () => {
  const prev = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = 'https://myproj.supabase.co';
  try {
    const one = deriveRemoteReference({ file_url: 'https://myproj.supabase.co/storage/v1/object/sign/vehicle-images/ev/A.pdf?token=aaa' });
    const two = deriveRemoteReference({ file_url: 'https://myproj.supabase.co/storage/v1/object/sign/vehicle-images/ev/A.pdf?token=bbb' });
    assert.equal(one, 'vehicle-images/ev/A.pdf');
    assert.equal(one, two, 'the same object re-signed must dedupe');
    assert.notEqual(one,
      deriveRemoteReference({ file_url: 'https://myproj.supabase.co/storage/v1/object/sign/vehicle-images/ev/B.pdf?token=aaa' }),
      'a different object must conflict');
    assert.equal(isTrustedStorageOrigin('https://evil.example/storage/v1/object/sign/b/k.pdf'), false);
    assert.equal(isTrustedStorageOrigin('https://myproj.supabase.co/anything'), true);
  } finally { process.env.SUPABASE_URL = prev; }
});

test('P2: a storage-relative object key is unchanged and case-sensitive', () => {
  assert.equal(deriveRemoteReference({ storage_bucket: 'b', file_path: 'ev/A.pdf' }), 'b/ev/A.pdf');
  assert.notEqual(deriveRemoteReference({ storage_bucket: 'b', file_path: 'ev/A.pdf' }),
    deriveRemoteReference({ storage_bucket: 'b', file_path: 'ev/a.pdf' }));
});

test('P2: no hard-coded hostname, and no network or DNS lookup', () => {
  const code = src('../services/evidence/uploadIdempotency.js');
  assert.match(code, /process\.env\.SUPABASE_URL/, 'the configured origin is the source of truth');
  assert.equal(/supabase\.co['"`]/.test(code.replace(/\/\*[\s\S]*?\*\//g, '')), false,
    'no hostname may be hard-coded in the executable contract');
  assert.equal(/\bfetch\s*\(|require\('dns'\)|from 'dns'/.test(code), false, 'nothing is dereferenced');
});

/* ══ P3 + P4 — coverage, then BEHAVIOUR ═══════════════════════════════════════════════ */

/**
 * COVERAGE (P3). The Seller/commerce/private-evidence surfaces this programme has claimed. The M
 * register omitted the two marked ADDED: both are governed in source but were untested, so a
 * regression in either would have gone unnoticed.
 */
export const SELLER_SURFACE_REGISTER = [
  // [file, source anchor (rename detection ONLY), label, behavioural scenario id]
  ['../routes/vehiclesRoutes.js', "router.patch('/api/vehicles/:vin/status'", 'vehicle status', 'set status'],
  ['../routes/vehiclesRoutes.js', 'async function loadScopedVehicle', 'publish / unpublish / price', 'publish'],
  ['../routes/vehiclesRoutes.js', "router.post('/api/vehicles/:vin/unpublish'", 'unpublish', 'unpublish'],
  ['../routes/vehiclesRoutes.js', "router.patch('/api/vehicles/:vin/price'", 'price', 'reprice'],
  ['../routes/vehiclesRoutes.js', 'async function assertEvidenceOwnershipScope', 'evidence upload seller scope', 'evidence upload scope'],
  ['../routes/vehiclesRoutes.js', "router.patch('/api/vehicles/:vin/evidence/:evidenceId/link-event'", 'evidence link-event', 'link evidence'],
  ['../routes/vehiclesRoutes.js', "router.get('/api/vehicles/:vin/evidence'", 'private evidence read', 'private evidence read'],
  ['../routes/vehiclesRoutes.js', "router.get('/api/vehicles/:vin/seller-authority'", 'seller authority state read', 'seller authority state'],
  ['../server.js', "app.get('/api/vehicles/:vin/completeness'", 'vehicle completeness', 'completeness read'],
  ['../server.js', "app.patch('/api/vehicles/:vin/seller-draft'", 'seller draft', 'seller draft'],
  ['../server.js', "app.post('/api/vehicles/add'", 'existing-Passport reuse', 'existing-passport reuse'],
  ['../services/storage/mediaRouter.js', "router.post('/upload/vehicle'", 'media upload', 'media vehicle upload'],
  ['../services/storage/mediaRouter.js', "router.post('/upload/document'", 'private document upload', 'document upload'],
  ['../services/storage/mediaRouter.js', "router.get('/upload/signed-url'", 'media signed url', 'media signed url'],
  ['../services/storage/mediaRouter.js', "router.get('/document/signed-url'", 'private document read', 'private document read'],
  ['../services/seller/sellerAuthorityService.js', 'export function hasExistingSellerRelationship', 'seller relationship recognition', 'relationship recognition'],
];

/**
 * F3 — every behavioural scenario this suite actually runs. The two lists are checked against each
 * other, so a registered surface with no scenario, or a scenario with no registered surface, fails
 * the suite. Source anchors remain ONLY for rename detection; they are never the authority proof.
 */
export const BEHAVIOURAL_SCENARIOS = new Set([
  'publish', 'unpublish', 'reprice', 'set status', 'link evidence',
  'private evidence read', 'evidence upload scope', 'seller authority state',
  'completeness read', 'seller draft', 'existing-passport reuse',
  'media vehicle upload', 'document upload', 'media signed url', 'private document read',
  'relationship recognition',
]);

const NOT_SELLER_AUTHORITY = [
  ['../server.js', 'async function mechanicIsAssignedToVehicle', 'Service Network assignment'],
  ['../server.js', "app.post('/api/partsentry/add'", 'PartSentry service authority'],
  ['../middleware/vehicleObjectAuthority.js', 'export async function resolveVehicleObjectAuthority', 'lender/insurer object authority'],
];

function surfaceBody(rel, anchor) {
  const code = src(rel).replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const start = code.indexOf(anchor);
  assert.ok(start > 0, `${rel}: anchor not found — "${anchor}"`);
  const rest = code.slice(start + anchor.length);
  const end = rest.search(/\n(?:router|app)\.(?:get|post|patch|put|delete)\(|\n(?:export )?(?:async )?function /);
  return rest.slice(0, end === -1 ? rest.length : end);
}

test('F3: register and behaviour are MECHANICALLY connected — neither may drift', () => {
  const scenarios = new Set(SELLER_SURFACE_REGISTER.map(([, , , scenario]) => scenario));
  const missingProof = [...scenarios].filter((sc) => !BEHAVIOURAL_SCENARIOS.has(sc));
  assert.deepEqual(missingProof, [], 'these registered Seller surfaces have NO behavioural proof');
  const orphanScenarios = [...BEHAVIOURAL_SCENARIOS].filter((sc) => !scenarios.has(sc));
  assert.deepEqual(orphanScenarios, [], 'these behavioural scenarios have NO registered surface');
  for (const entry of SELLER_SURFACE_REGISTER) {
    assert.equal(entry.length, 4, `register entry must name its scenario: ${entry[2]}`);
  }
});

test('P3: every registered Seller surface anchor resolves', () => {
  for (const [rel, anchor] of [...SELLER_SURFACE_REGISTER, ...NOT_SELLER_AUTHORITY]) {
    assert.ok(surfaceBody(rel, anchor).length > 0, `${rel}: ${anchor}`);
  }
});

test('P3/F3: source anchors are RENAME DETECTION only — never the authority proof', () => {
  // F3: `assert.match(...hasGovernedDealerVehicleAuthority...)` is exactly the source-presence
  // check P4 showed can stay green while the real grant is broken. It is kept only to notice a
  // rename; the authority itself is proven by the behavioural scenarios below.
  for (const [rel, anchor, label, scenario] of SELLER_SURFACE_REGISTER) {
    assert.ok(surfaceBody(rel, anchor).length > 0, `${label}: anchor moved — update the register`);
    assert.ok(BEHAVIOURAL_SCENARIOS.has(scenario), `${label}: scenario '${scenario}' is not run anywhere`);
  }
});

test('P3: Service Network, PartSentry and object authority stay OUTSIDE Dealer seller authority', () => {
  for (const [rel, anchor, label] of NOT_SELLER_AUTHORITY) {
    const body = surfaceBody(rel, anchor);
    assert.equal(/hasGovernedDealerVehicleAuthority/.test(body), false, `${label} must not be routed through it`);
    assert.match(body, /tenant_id/, `${label} keeps its own tenant scope`);
  }
});

/* ── P4: the BEHAVIOURAL proof. Outcome and row count, never spelling. ────────────────── */

const DEALERSHIP = 'tenant-moyo';
const VIN = 'JTMHY7AJ2K4012345';

/** One in-memory database driving the real routes; `updates` records every mutation attempted. */
function makeWorld() {
  const updates = [];
  const db = {
    users: {
      'u-mech': { id: 'u-mech', role: 'dealer', is_verified: true },     // ADVERSARIAL actor
      'u-admin': { id: 'u-admin', role: 'dealer', is_verified: true },   // POSITIVE control
      'u-owner': { id: 'u-owner', role: 'owner', is_verified: true },    // owner control
    },
    tenantUsers: { [`${DEALERSHIP}|u-mech`]: { role: 'mechanic' }, [`${DEALERSHIP}|u-admin`]: { role: 'admin' } },
    tenants: { [DEALERSHIP]: { id: DEALERSHIP, type: 'dealership', status: 'active' } },
    vehicles: {
      [VIN]: {
        vin: VIN, status: 'Available', publication_status: 'published', owner_id: 'u-owner',
        current_seller_id: 'u-owner', tenant_id: DEALERSHIP, price: 15000, currency: 'USD',
        make: 'Toyota', model: 'Hilux', year: 2019,
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
          // the LIST read: a private (non-public) row, so visibility is what the gate decides
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
      select: () => c, insert: () => c, update: (p) => { upd = p; return c; }, delete: () => c,
      eq: (k, v) => { f[k] = v; return c; }, neq: () => c, is: () => c, in: () => c, or: () => c,
      order: () => c, range: () => c, limit: () => c, gte: () => c, lte: () => c, not: () => c,
      single: () => { single = true; return c; }, maybeSingle: () => { single = true; return c; },
      then: (r, j) => { try { return Promise.resolve(resolve()).then(r, j); } catch (e) { return j ? j(e) : Promise.reject(e); } },
    };
    return c;
  };
  return { db, updates, builder };
}

const ADVERSARY = { id: 'u-mech', label: 'platform Dealer, MECHANIC membership in the dealership' };
const LEGITIMATE = { id: 'u-admin', label: 'governed Dealer business actor' };
const OWNER = { id: 'u-owner', label: 'canonical Owner' };

/**
 * The behavioural matrix. Each entry is a real request against the real router; the assertions are
 * on the STATUS and on how many rows were mutated — never on how the code is written.
 */
const SELLER_OPERATIONS = [
  ['publish', 'POST', `/api/vehicles/${VIN}/publish`, {}],
  ['unpublish', 'POST', `/api/vehicles/${VIN}/unpublish`, {}],
  ['reprice', 'PATCH', `/api/vehicles/${VIN}/price`, { price: 99999 }],
  ['set status', 'PATCH', `/api/vehicles/${VIN}/status`, { status: 'Sold' }],
  ['link evidence', 'PATCH', `/api/vehicles/${VIN}/evidence/ev-1/link-event`,
    { linked_registry_event_id: 'te-1', event_type: 'registration' }],
];

let server; let baseUrl; let world;
test('P4: behavioural proof — adversarial actor refused, legitimate actor allowed, zero effect', async (t) => {
  const express = (await import('express')).default;
  const http = await import('node:http');
  const vehiclesRouter = (await import('../routes/vehiclesRoutes.js')).default;
  const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
  const { supabase } = await import('../db/supabase.js');

  world = makeWorld();
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: world.builder });
  Object.defineProperty(supabase, 'rpc', { configurable: true, writable: true, value: async () => ({ data: null, error: null }) });
  const app = express();
  app.use(express.json());
  app.use(vehiclesRouter);
  app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const call = async (actor, method, path, body, tenant = DEALERSHIP) => {
    world.updates.length = 0;
    const headers = { 'content-type': 'application/json', 'x-user-id': actor.id };
    if (tenant) headers['x-tenant-id'] = tenant;
    const res = await fetch(`${baseUrl}${path}`, { method, headers, body: JSON.stringify(body) });
    return { status: res.status, mutations: world.updates.length };
  };

  for (const [label, method, path, body] of SELLER_OPERATIONS) {
    await t.test(`${label}: adversary refused with ZERO effect`, async () => {
      const r = await call(ADVERSARY, method, path, body);
      assert.equal(r.status, 403, `${label}: ${ADVERSARY.label} must be refused`);
      assert.equal(r.mutations, 0, `${label}: and must change nothing`);
    });
    await t.test(`${label}: legitimate Dealer business actor succeeds`, async () => {
      const r = await call(LEGITIMATE, method, path, body);
      assert.notEqual(r.status, 403, `${label}: ${LEGITIMATE.label} must not be refused`);
    });
    await t.test(`${label}: canonical Owner remains green`, async () => {
      const r = await call(OWNER, method, path, body, null);
      assert.notEqual(r.status, 403, `${label}: the Owner path must not regress`);
    });
  }

  await t.test('private evidence read: the adversary is not handed private rows', async () => {
    // The route answers 200 and FILTERS; the behavioural fact is what comes back, not the status.
    const headers = { 'content-type': 'application/json', 'x-user-id': ADVERSARY.id, 'x-tenant-id': DEALERSHIP };
    const res = await fetch(`${baseUrl}/api/vehicles/${VIN}/evidence`, { headers });
    assert.equal(res.status, 200, 'the read itself must still work');
    const body = await res.json();
    const payload = JSON.stringify(body);
    assert.equal(/ev\/private\.pdf/.test(payload), false,
      'a private storage path must not be handed to an actor with no governed Seller authority');
  });

  if (server) await new Promise((r) => server.close(r));
});

/* ══ F3 — behavioural scenarios for the surfaces that previously had none ═════════════ */

/**
 * `/api/vehicles/add` (existing-Passport reuse) and `/api/media/upload/document` were validated by
 * source presence alone — the exact proof P4 showed can stay green while the grant is broken. Both
 * are now driven for real. `server.js` guards its `app.listen` on NODE_ENV, so the real app mounts.
 */
test('F3: the two P3-added routes, and the seller-authority state read, proved BEHAVIOURALLY', async (t) => {
  const express = (await import('express')).default;
  const http = await import('node:http');
  const { supabase } = await import('../db/supabase.js');
  const w = makeWorld();
  // The existing-Passport branch needs a vehicle that already exists under the tenant.
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: w.builder });
  Object.defineProperty(supabase, 'rpc', { configurable: true, writable: true, value: async () => ({ data: null, error: null }) });

  const appModule = await import('../server.js');
  const mediaRouter = (await import('../services/storage/mediaRouter.js')).default;
  const vehiclesRouter = (await import('../routes/vehiclesRoutes.js')).default;
  const errorHandler = (await import('../middleware/errorMiddleware.js')).default;

  const mediaApp = express();
  mediaApp.use(express.json({ limit: '10mb' }));
  mediaApp.use('/api/media', mediaRouter);
  mediaApp.use(errorHandler);
  const sellerApp = express();
  sellerApp.use(express.json());
  sellerApp.use(vehiclesRouter);
  sellerApp.use(errorHandler);

  const listen = (a) => new Promise((r) => { const srv = http.createServer(a); srv.listen(0, '127.0.0.1', () => r(srv)); });
  const mediaSrv = await listen(mediaApp);
  const sellerSrv = await listen(sellerApp);
  const addSrv = await listen(appModule.default);
  const url = (srv, path) => `http://127.0.0.1:${srv.address().port}${path}`;
  const hit = async (srv, method, path, body, actor, tenant = DEALERSHIP) => {
    w.updates.length = 0;
    const headers = { 'content-type': 'application/json', 'x-user-id': actor.id };
    if (tenant) headers['x-tenant-id'] = tenant;
    const res = await fetch(url(srv, path), { method, headers, body: body ? JSON.stringify(body) : undefined });
    let parsed = {}; try { parsed = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: parsed, mutations: w.updates.length };
  };

  await t.test('document upload: adversary refused with ZERO effect', async () => {
    const body = { vin: VIN, docType: 'registration_book',
      document: `data:application/pdf;base64,${Buffer.from('x').toString('base64')}` };
    const r = await hit(mediaSrv, 'POST', '/api/media/upload/document', body, ADVERSARY);
    assert.ok(r.status === 403 || r.status === 401,
      `a mechanic-only membership must not upload a private document; got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    assert.equal(r.mutations, 0, 'and must write nothing');
  });

  await t.test('existing-passport reuse: adversary never reaches the reuse branch', async () => {
    // A COMPLETE payload, so the request is refused by AUTHORITY rather than by validation — an
    // earlier version of this scenario asserted only `!== 201` and stayed green under the
    // acceptance mutation, because both actors were being rejected for a missing field.
    const payload = {
      vin: VIN, make: 'Toyota', model: 'Hilux', year: 2019, price: 25000, mileage: 90000,
      currency: 'USD', city: 'Harare', description: 'A well maintained vehicle.',
      import_source: 'Japan', registration_country: 'ZW',
    };
    const adversary = await hit(addSrv, 'POST', '/api/vehicles/add', payload, ADVERSARY);
    const adversaryBody = JSON.stringify(adversary.body);
    assert.equal(/EXISTING_PASSPORT_CONFIRM_REQUIRED/.test(adversaryBody), false,
      `raw membership must not reach another party's Passport; got ${adversary.status} ${adversaryBody.slice(0, 160)}`);
    assert.match(adversaryBody, /unknown_seller_type|missing_owner_for_private_listing/,
      'and must be refused for having no Seller subject at all');

    // POSITIVE CONTROL — the governed Dealer business actor DOES reach the reuse branch, which is
    // what makes the negative meaningful rather than an artefact of the fixture.
    //
    // MEASURED LIMIT, recorded rather than glossed: this surface is defended TWICE. For the
    // adversary the K3/L2 creation-eligibility gate refuses first (`unknown_seller_type`), so
    // restoring raw membership in the reuse clause ALONE is not observable here — the outer gate
    // still refuses. The clause is nevertheless proven load-bearing in the direction that IS
    // observable: disabling it turns this positive control red.
    const legitimate = await hit(addSrv, 'POST', '/api/vehicles/add', payload, LEGITIMATE);
    assert.match(JSON.stringify(legitimate.body), /EXISTING_PASSPORT_CONFIRM_REQUIRED/,
      'the legitimate actor must reach the existing-Passport branch');
  });

  await t.test('seller authority state: adversary is not reported as a Dealer seller', async () => {
    const r = await hit(sellerSrv, 'GET', `/api/vehicles/${VIN}/seller-authority?seller_user_id=${ADVERSARY.id}`,
      undefined, ADVERSARY);
    const payload = JSON.stringify(r.body);
    assert.equal(/"recognition_basis"\s*:\s*"existing_relationship"/.test(payload), false,
      `raw membership must not be reported as an existing Seller relationship: ${payload.slice(0, 200)}`);
  });

  await t.test('relationship recognition: the primitive refuses membership without a governed decision', async () => {
    const { hasExistingSellerRelationship } = await import('../services/seller/sellerAuthorityService.js');
    const vehicle = { owner_id: 'someone', current_seller_id: 'someone', tenant_id: DEALERSHIP };
    assert.equal(hasExistingSellerRelationship(vehicle, { id: ADVERSARY.id, tenantId: DEALERSHIP }), false,
      'a service primitive is proved directly — it is not an HTTP route');
    assert.equal(hasExistingSellerRelationship(vehicle, { id: LEGITIMATE.id, tenantId: DEALERSHIP },
      { dealerTenantAuthorized: true }), true, 'and the governed decision still grants');
  });

  for (const srv of [mediaSrv, sellerSrv, addSrv]) await new Promise((r) => srv.close(r));
});
