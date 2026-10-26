/**
 * T11-CAP-LR01-R2 step F — GOVERNED MEDIA WIRING: the block reaches the surfaces it is for, and ONLY those.
 *
 * Three surfaces carry it — the full-gallery route, the two passport routes, and the garage list — and each has a way to go wrong that
 * a green unit suite would not notice:
 *
 *   · the passport gains the block for people who are not entitled to it (a leak), or loses the key's absence (an oracle);
 *   · the passport builder's closed collaborator list is disturbed (older certified harnesses pin it — see issue164-phase5);
 *   · the garage list starts failing, or starts showing a vehicle's photographs to someone who only SELLS it.
 *
 * As the Phase 5 wiring harness does, the SHIPPED SOURCE of `withGovernedMedia` and of the `/api/vehicles/me` handler is extracted from
 * server.js and executed over fakes. A copy would go on passing after the shipped function changed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import errorHandler from '../middleware/errorMiddleware.js';
import { createGovernedMediaRouter } from '../routes/governedMediaRoutes.js';
import { actorForGovernedMedia, readGovernedMedia, readGovernedMediaForVehicles } from '../services/evidence/governedVehicleMediaService.js';
import { findGovernedMediaLeaks } from '../utils/governedVehicleMedia.js';

const serverSrc = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

const VIN = 'RU3-1316558';
const OWNER = 'u_owner';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ── a tiny Supabase-shaped client over fixed rows ───────────────────────────────────────────────────────────────
function fakeClient({ vehicles = [], refs = [], evidence = [], failVehicles = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const f = { eq: [], in: null };
      const q = {
        select() { return q; },
        eq(col, val) { f.eq.push([col, val]); return q; },
        in(col, vals) { f.in = [col, vals]; return q; },
        is() { return q; },
        order() { return q; },
        maybeSingle() { return q.then((r) => ({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error })); },
        then(resolve, reject) {
          calls.push(table);
          if (table === 'vehicles' && failVehicles) return resolve({ data: null, error: { message: 'boom' } });
          let rows = table === 'vehicles' ? vehicles : table === 'vehicle_media_references' ? refs : table === 'vehicle_evidence' ? evidence : [];
          for (const [col, val] of f.eq) rows = rows.filter((r) => r[col] === val);
          if (f.in) rows = rows.filter((r) => f.in[1].includes(r[f.in[0]]));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}
const signer = { calls: [], async signMany(bucket, paths) { this.calls.push({ bucket, paths }); return new Map(paths.map((p) => [p, `https://signed.example/${encodeURIComponent(p)}?t=1`])); } };
const world = (count = 3) => ({
  vehicles: [{ vin: VIN, owner_id: OWNER }, { vin: 'GFC27-027051', owner_id: 'u_someone_else' }],
  refs: Array.from({ length: count }, (_, i) => ({ id: uuid(i + 1), vin: VIN, evidence_id: uuid(1001 + i), gallery_position: i + 1, is_primary: i === 0, primary_basis: i === 0 ? 'SOURCE_FIRST_IMAGE' : null, label: null, deleted_at: null })),
  evidence: Array.from({ length: count }, (_, i) => ({ id: uuid(1001 + i), vin: VIN, storage_bucket: 'ocr-documents', file_path: `${VIN}/p${i + 1}.jpg`, file_url: `${VIN}/p${i + 1}.jpg`, mime_type: 'image/jpeg', verification_status: 'pending' })),
});

// ═══════════════════════════ the route ═══════════════════════════

async function withApp(client, fn) {
  const app = express();
  app.use(express.json());
  const auth = (req, _res, next) => {
    const who = req.get('x-test-user');
    if (who) req.userContext = { id: who, role: req.get('x-test-role') || 'owner', identityAsserted: req.get('x-test-asserted') === '1' };
    next();
  };
  app.use(createGovernedMediaRouter({ client, signer, auth }));
  app.use(errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((resolve) => server.close(resolve)); }
}
const hit = (base, vin, headers = {}) => fetch(`${base}/api/vehicles/${encodeURIComponent(vin)}/governed-media`, { headers });

test('W1: the owner gets the gallery, privately cached nowhere, with no locator fields', async () => {
  await withApp(fakeClient(world()), async (base) => {
    const res = await hit(base, VIN, { 'x-test-user': OWNER });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const body = await res.json();
    assert.equal(body.data.state, 'available');
    assert.equal(body.data.items.length, 3);
    assert.deepEqual(findGovernedMediaLeaks(body.data), []);
    assert.equal(body.data.items[0].designated_primary, true);
  });
});

test('W2: EVERY refusal is the same 404 with the same body — anonymous, asserted, stranger, dealer, and a vehicle that does not exist', async () => {
  await withApp(fakeClient(world()), async (base) => {
    const refusals = [];
    for (const [vin, headers] of [
      [VIN, {}],
      [VIN, { 'x-test-user': OWNER, 'x-test-asserted': '1' }],
      [VIN, { 'x-test-user': 'u_stranger' }],
      [VIN, { 'x-test-user': 'u_dealer', 'x-test-role': 'dealer' }],
      ['NO-SUCH-VIN-1', { 'x-test-user': OWNER }],
      ['GFC27-027051', { 'x-test-user': OWNER }],   // a real vehicle that is somebody else's
    ]) {
      const res = await hit(base, vin, headers);
      refusals.push({ status: res.status, text: await res.text() });
    }
    assert.ok(refusals.every((r) => r.status === 404), JSON.stringify(refusals.map((r) => r.status)));
    assert.equal(new Set(refusals.map((r) => r.text)).size, 1, 'the refusals are distinguishable');
  });
});

test('W3: a privileged role may open any vehicle\'s gallery', async () => {
  await withApp(fakeClient(world()), async (base) => {
    for (const role of ['admin', 'government']) {
      const res = await hit(base, VIN, { 'x-test-user': `u_${role}`, 'x-test-role': role });
      assert.equal(res.status, 200, role);
    }
  });
});

test('W4: an infrastructure fault is a 500 from the shared error handler, not a refusal that looks like absence', async () => {
  await withApp(fakeClient({ ...world(), failVehicles: true }), async (base) => {
    const res = await hit(base, VIN, { 'x-test-user': OWNER });
    assert.equal(res.status, 500);
  });
});

test('W5: a media read that fails inside an authorised request is NOT_LOADED — never "none"', async () => {
  const client = fakeClient(world());
  const original = client.from.bind(client);
  client.from = (table) => {
    if (table !== 'vehicle_media_references') return original(table);
    const q = { select: () => q, in: () => q, is: () => q, order: () => q, then: (resolve) => resolve({ data: null, error: { message: 'down' } }) };
    return q;
  };
  await withApp(client, async (base) => {
    const body = await (await hit(base, VIN, { 'x-test-user': OWNER })).json();
    assert.equal(body.data.state, 'not_loaded');
    assert.equal(body.data.empty_statement, null);
  });
});

test('W6: the production router is mounted in server.js, once, with no locally-restated rule', () => {
  assert.equal([...serverSrc.matchAll(/app\.use\(createGovernedMediaRouter\(\)\)/g)].length, 1);
  assert.match(serverSrc, /from '\.\/routes\/governedMediaRoutes\.js'/);
  const routes = readFileSync(new URL('../routes/governedMediaRoutes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(routes, /\.post\(|\.put\(|\.patch\(|\.delete\(/, 'a read-only route');
  assert.doesNotMatch(routes, /owner_id\s*===|role\s*===/, 'authorisation lives in the service, not restated here');
});

// ═══════════════════════════ the shipped passport attachment ═══════════════════════════

function sliceBalanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error('unbalanced');
}
function shippedFunction(declaration) {
  const idx = serverSrc.indexOf(declaration);
  assert.ok(idx > -1, `${declaration} must still exist in server.js`);
  const brace = serverSrc.indexOf('{', serverSrc.indexOf(')', idx));
  return serverSrc.slice(idx, brace) + sliceBalanced(serverSrc, brace);
}
/** Instantiate the SHIPPED `withGovernedMedia` over fakes. */
function instantiateWithGovernedMedia({ supabase, readGovernedMediaFn, warn = () => {} }) {
  const source = shippedFunction('async function withGovernedMedia');
  // eslint-disable-next-line no-new-func
  return new Function('supabase', 'readGovernedMedia', 'actorForGovernedMedia', 'governedMediaSigner', 'console', `return (${source});`)(
    supabase, readGovernedMediaFn, actorForGovernedMedia, { signer: true }, { warn },
  );
}
const passport = Object.freeze({ vehicle: Object.freeze({ vin: VIN, make: 'Honda' }), listing_media: Object.freeze({ state: 'none' }) });

test('W7: the passport attachment — anonymous and asserted callers cost NOTHING: no query, the SAME object back', async () => {
  const supabase = fakeClient(world());
  const attach = instantiateWithGovernedMedia({ supabase, readGovernedMediaFn: async () => { throw new Error('must not be called'); } });
  for (const userContext of [undefined, null, {}, { id: OWNER, identityAsserted: true }]) {
    const out = await attach(passport, VIN, { userContext });
    assert.equal(out, passport, 'the very same object — a public passport is byte-identical whether or not the vehicle has media');
  }
  assert.equal(supabase.calls.length, 0);
});

test('W8: the passport attachment — the owner gains the block without mutating the builder\'s object; a stranger gains nothing', async () => {
  const supabase = fakeClient(world());
  const attach = instantiateWithGovernedMedia({
    supabase,
    readGovernedMediaFn: (input) => readGovernedMedia({ ...input, client: fakeClient(world()), signer }),
  });
  const owned = await attach(passport, VIN, { userContext: { id: OWNER, role: 'owner' } });
  assert.notEqual(owned, passport);
  assert.equal(owned.governed_media.state, 'available');
  assert.equal(owned.vehicle, passport.vehicle, 'everything else is carried through unchanged');
  assert.equal('governed_media' in passport, false, 'the builder\'s object was not mutated');
  const stranger = await attach(passport, VIN, { userContext: { id: 'u_stranger', role: 'owner' } });
  assert.equal(stranger, passport);
  assert.equal(JSON.stringify(stranger), JSON.stringify(passport));
  const missing = await attach(passport, 'NO-SUCH-VIN', { userContext: { id: OWNER, role: 'owner' } });
  assert.equal(missing, passport);
});

test('W9: the passport attachment — a fault never fails the passport and never changes it', async () => {
  const warnings = [];
  const throwing = instantiateWithGovernedMedia({ supabase: fakeClient(world()), readGovernedMediaFn: async () => { throw new Error('storage exploded'); }, warn: (...a) => warnings.push(a.join(' ')) });
  assert.equal(await throwing(passport, VIN, { userContext: { id: OWNER, role: 'owner' } }), passport);
  assert.equal(warnings.length, 1);
  assert.ok(!warnings[0].includes(VIN), 'the log line does not name the vehicle');
  assert.equal(await throwing(null, VIN, { userContext: { id: OWNER } }), null);
});

test('W10: both passport routes wrap their response with the SAME attachment, passing the VIN they actually resolved', () => {
  const sites = [...serverSrc.matchAll(/res\.json\(await withGovernedMedia\(passport, (\w+), req\)\)/g)].map((m) => m[1]);
  assert.deepEqual(sites.sort(), ['resolvedVin', 'vin']);
  assert.equal([...serverSrc.matchAll(/res\.json\(passport\)/g)].length, 0, 'no passport response bypasses the attachment');
  // the builder is untouched: it takes no governed-media collaborator and never learned of the block
  const builder = shippedFunction('async function buildVehiclePassport');
  assert.doesNotMatch(builder, /governed_media|governedMedia|readGovernedMedia|withGovernedMedia/);
});

// ═══════════════════════════ the shipped garage handler ═══════════════════════════

/** The SHIPPED `/api/vehicles/me` handler, executed over fakes. */
function instantiateGarageHandler({ vehicles, governed, throwGoverned = false }) {
  const routeIdx = serverSrc.indexOf("app.get('/api/vehicles/me'");
  assert.ok(routeIdx > -1);
  const arrowIdx = serverSrc.indexOf('async (req, res) =>', routeIdx);
  const brace = serverSrc.indexOf('{', arrowIdx);
  const handlerSource = `${serverSrc.slice(arrowIdx, brace)}${sliceBalanced(serverSrc, brace)}`;
  const supabase = { from: () => ({ select: () => ({ or: async () => ({ data: vehicles, error: null }) }) }) };
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'supabase', 'withCanonicalTrust', 'ownerGarageCounts', 'ownerListingMedia', 'toListingMediaBlock', 'readGovernedMediaForVehicles', 'actorForGovernedMedia', 'governedMediaSigner', 'console',
    `return (${handlerSource});`,
  );
  const seen = {};
  const handler = factory(
    supabase,
    async (rows) => rows,
    async () => new Map(),
    async () => new Map(),
    (rows) => ({ state: rows === null ? 'not_loaded' : 'none', items: [] }),
    async (input) => { seen.input = input; if (throwGoverned) throw new Error('governed exploded'); return governed(input); },
    actorForGovernedMedia,
    { signer: true },
    { warn: () => {}, error: () => {} },
  );
  return { handler, seen };
}
const runHandler = async (handler, userContext) => {
  const out = {};
  await handler({ userContext }, { json: (body) => { out.body = body; return out; }, status: (code) => ({ json: (body) => { out.status = code; out.body = body; } }) });
  return out;
};

test('W11: the garage list adds each vehicle\'s hero beside — never instead of — listing_media, for the vehicles the user may view', async () => {
  const vehicles = [{ vin: VIN, owner_id: OWNER }, { vin: 'GFC27-027051', owner_id: OWNER }, { vin: 'CONSIGN-0001', owner_id: 'u_other', current_seller_id: OWNER }];
  const { handler, seen } = instantiateGarageHandler({
    vehicles,
    governed: ({ vehicles: asked }) => new Map(asked.filter((v) => v.owner_id === OWNER).map((v) => [v.vin, { state: 'available', items: [{ gallery_rank: 1 }], total_count: 1 }])),
  });
  const { body } = await runHandler(handler, { id: OWNER, role: 'owner' });
  assert.equal(body.length, 3);
  assert.ok(body.every((v) => v.listing_media), 'listing_media is untouched');
  assert.deepEqual(body.map((v) => 'governed_media' in v), [true, true, false], 'a vehicle the user only SELLS carries no governed media');
  assert.equal(seen.input.limit, 1, 'a list asks for the hero, not the gallery');
  assert.deepEqual(seen.input.actor, { id: OWNER, role: 'owner', identityAsserted: false });
});

test('W12: a fault in governed media NEVER fails the garage — the vehicles come back without the key', async () => {
  const { handler } = instantiateGarageHandler({ vehicles: [{ vin: VIN, owner_id: OWNER }], governed: () => new Map(), throwGoverned: true });
  const out = await runHandler(handler, { id: OWNER, role: 'owner' });
  assert.equal(out.status, undefined);
  assert.equal(out.body.length, 1);
  assert.equal('governed_media' in out.body[0], false);
  assert.ok(out.body[0].listing_media);
});

test('W13: the service is the single place that decides who may view — the garage asks it, with the actor from the auth context', () => {
  const garage = serverSrc.slice(serverSrc.indexOf("app.get('/api/vehicles/me'"), serverSrc.indexOf('// GET /api/vehicles/saved'));
  assert.match(garage, /readGovernedMediaForVehicles\(/);
  assert.match(garage, /actorForGovernedMedia\(req\.userContext\)/);
  assert.doesNotMatch(garage, /owner_id\s*===/, 'the garage restates no entitlement rule of its own');
  assert.ok(typeof readGovernedMediaForVehicles === 'function');
});
