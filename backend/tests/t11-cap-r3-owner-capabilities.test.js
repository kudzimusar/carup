/**
 * T11-CAP-LR01-R3 — the OWNER-ONLY `capabilities` block, as it is assembled and as it is attached.
 *
 * Three promises:
 *   1. AUDIENCE. The block exists only for a vehicle the viewer owns or sells, seen under a PROVEN identity.
 *      Everyone else gets nothing added — no empty block, no flag — so a response is byte-identical whether or
 *      not the vehicle has an import order or a listing.
 *   2. INDEPENDENCE. Marketplace and Trade & Imports are derived separately; neither moves when the other does.
 *   3. FAULTS. Each part fails alone. A failed import read is `unavailable`, never `none`; nothing fails the
 *      response it rides on.
 *
 * `withOwnerCapabilities` is executed from the SHIPPED source of server.js (the same technique the R2 header
 * tests use), so these tests are about the route's real code, not a copy of it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMockSupabase } from './helpers/mockSupabase.js';
import {
  CAPABILITY_VEHICLE_COLUMNS, buildOwnerCapabilities, isOwnerOrCurrentSeller, readOwnerCapabilitiesForVin,
} from '../services/vehicleCapabilityService.js';
import { actorForGovernedMedia } from '../services/evidence/governedVehicleMediaService.js';

const serverSrc = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

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

const ME = { id: 'u-owner', platformRole: 'member', role: 'owner' };
const STRANGER = { id: 'u-stranger', platformRole: 'member', role: 'owner' };
const ADMIN = { id: 'u-admin', platformRole: 'platform_admin', role: 'admin' };

const SERENA = {
  vin: 'GFC27-027051', owner_id: 'u-owner', current_seller_id: 'u-owner', publication_status: 'published', status: 'Available',
  import_source: 'import', price: 12800, currency: 'USD', seller_description: 'One owner.', seller_features: ['Camera'],
};
const VEZEL = {
  vin: 'RU3-1316558', owner_id: 'u-owner', current_seller_id: null, publication_status: 'draft', status: 'Pending',
  import_source: 'diaspora_import', price: 0, currency: null, seller_description: null, seller_features: [],
};
const VEZEL_ORDER = {
  id: 'ord-vezel', tenant_id: null, buyer_id: 'u-owner', created_by: 'u-owner', linked_vehicle_vin: 'RU3-1316558', deleted_at: null,
  status: 'DOCUMENTS_PENDING', created_at: '2026-10-25T00:00:00Z',
};

const noMedia = { state: 'none', items: [], unpublishable_count: 0 };
const mediaMap = (entries = {}) => new Map(Object.entries(entries));

function world(over = {}) {
  return createMockSupabase({
    vehicles: over.vehicles || [{ ...SERENA }, { ...VEZEL }],
    diaspora_import_orders: over.orders || [{ ...VEZEL_ORDER }],
    diaspora_import_order_participants: [],
  });
}

// ── isOwnerOrCurrentSeller ─────────────────────────────────────────────────────────────

test('R3-C1: owner or current seller — and nobody else', () => {
  assert.equal(isOwnerOrCurrentSeller({ owner_id: 'u1' }, 'u1'), true);
  assert.equal(isOwnerOrCurrentSeller({ owner_id: 'u2', current_seller_id: 'u1' }, 'u1'), true);
  assert.equal(isOwnerOrCurrentSeller({ owner_id: 'u2', current_seller_id: 'u3' }, 'u1'), false);
  assert.equal(isOwnerOrCurrentSeller({ owner_id: 'u1' }, null), false);
  assert.equal(isOwnerOrCurrentSeller({ owner_id: 'u1' }, ''), false);
  assert.equal(isOwnerOrCurrentSeller(null, 'u1'), false);
  assert.equal(isOwnerOrCurrentSeller({}, 'u1'), false);
});

// ── buildOwnerCapabilities ──────────────────────────────────────────────────────────────

test('R3-C2: the Serena and the Vezel, end to end — one is published with no import, the other is unlisted with one journey', async () => {
  const w = world();
  const caps = await buildOwnerCapabilities({
    client: w, vehicles: w._rows('vehicles'), userContext: ME,
    listingMedia: mediaMap({ [SERENA.vin]: { state: 'published', items: [{}], unpublishable_count: 0 }, [VEZEL.vin]: noMedia }),
  });
  assert.deepEqual(caps.get(SERENA.vin), { marketplace: { state: 'published' }, trade_import: { state: 'none' } });
  assert.deepEqual(caps.get(VEZEL.vin), { marketplace: { state: 'not_listed' }, trade_import: { state: 'single', order_id: 'ord-vezel' } });
});

test('R3-C3: only vehicles the viewer owns or sells get a block', async () => {
  const w = world({ vehicles: [{ ...SERENA }, { ...VEZEL, owner_id: 'u-stranger' }, { ...VEZEL, vin: 'SELLER-ONLY-1', owner_id: 'u-stranger', current_seller_id: 'u-owner' }] });
  const caps = await buildOwnerCapabilities({ client: w, vehicles: w._rows('vehicles'), userContext: ME, listingMedia: mediaMap() });
  assert.deepEqual([...caps.keys()].sort(), ['GFC27-027051', 'SELLER-ONLY-1']);
  const none = await buildOwnerCapabilities({ client: w, vehicles: w._rows('vehicles'), userContext: { id: 'u-nobody' }, listingMedia: mediaMap() });
  assert.equal(none.size, 0);
});

test('R3-C4: no vehicle of the viewer\'s -> no read is made at all', async () => {
  let called = 0;
  const caps = await buildOwnerCapabilities({
    client: world(), vehicles: [{ ...SERENA, owner_id: 'u-stranger', current_seller_id: 'u-stranger' }], userContext: ME,
    importCapabilities: async () => { called += 1; return new Map(); },
  });
  assert.equal(caps.size, 0);
  assert.equal(called, 0);
});

test('R3-C5: INDEPENDENCE — the import state never moves the listing state, and the listing state never moves the import state', async () => {
  const w = world();
  const media = mediaMap({ [VEZEL.vin]: noMedia });
  const importAs = (state) => async (vehicles) => new Map(vehicles.map((v) => [v.vin, { state }]));
  const marketplaceOf = async (importState, vehicle) => (await buildOwnerCapabilities({
    client: w, vehicles: [vehicle], userContext: ME, listingMedia: media, importCapabilities: importAs(importState),
  })).get(vehicle.vin).marketplace;
  const baseline = await marketplaceOf('none', VEZEL);
  for (const importState of ['single', 'multiple', 'unavailable']) {
    assert.deepEqual(await marketplaceOf(importState, VEZEL), baseline, `import=${importState} changed the listing state`);
  }
  const tradeOf = async (vehicle) => (await buildOwnerCapabilities({
    client: w, vehicles: [vehicle], userContext: ME, listingMedia: media,
  })).get(vehicle.vin).trade_import;
  const tradeBaseline = await tradeOf(VEZEL);
  for (const over of [{ publication_status: 'published' }, { status: 'Sold' }, { current_seller_id: 'u-owner', seller_description: 'x' }, { price: 9000, currency: 'USD' }]) {
    assert.deepEqual(await tradeOf({ ...VEZEL, ...over }), tradeBaseline, `${JSON.stringify(over)} changed the import state`);
  }
});

test('R3-C6: FAULTS — a failed import read is `unavailable` for the import part only', async () => {
  const w = world();
  const caps = await buildOwnerCapabilities({
    client: w, vehicles: [{ ...VEZEL }], userContext: ME, listingMedia: mediaMap({ [VEZEL.vin]: noMedia }),
    importCapabilities: async () => { throw new Error('orders table unreachable'); },
  });
  assert.deepEqual(caps.get(VEZEL.vin), { marketplace: { state: 'not_listed' }, trade_import: { state: 'unavailable' } });
});

test('R3-C7: FAULTS — an import map that omits a vehicle is `unavailable`, not `none`', async () => {
  const caps = await buildOwnerCapabilities({
    client: world(), vehicles: [{ ...VEZEL }], userContext: ME, listingMedia: mediaMap({ [VEZEL.vin]: noMedia }),
    importCapabilities: async () => new Map(),
  });
  assert.deepEqual(caps.get(VEZEL.vin).trade_import, { state: 'unavailable' });
  const garbage = await buildOwnerCapabilities({
    client: world(), vehicles: [{ ...VEZEL }], userContext: ME, listingMedia: mediaMap({ [VEZEL.vin]: noMedia }),
    importCapabilities: async () => null,
  });
  assert.deepEqual(garbage.get(VEZEL.vin).trade_import, { state: 'unavailable' });
});

test('R3-C8: FAULTS — a listing-media signal that was not read leaves an otherwise-empty vehicle `unavailable`, and a real signal still wins', async () => {
  const w = world();
  const unread = await buildOwnerCapabilities({ client: w, vehicles: [{ ...VEZEL }], userContext: ME, listingMedia: null });
  assert.deepEqual(unread.get(VEZEL.vin).marketplace, { state: 'unavailable' });
  const notLoaded = await buildOwnerCapabilities({
    client: w, vehicles: [{ ...VEZEL }], userContext: ME, listingMedia: mediaMap({ [VEZEL.vin]: { state: 'not_loaded', items: [], unpublishable_count: 0 } }),
  });
  assert.deepEqual(notLoaded.get(VEZEL.vin).marketplace, { state: 'unavailable' });
  const settled = await buildOwnerCapabilities({
    client: w, vehicles: [{ ...SERENA }], userContext: ME, listingMedia: null,
  });
  assert.deepEqual(settled.get(SERENA.vin).marketplace, { state: 'published' });
});

test('R3-C9: FAULTS — a throwing media lookup spoils only the listing part', async () => {
  const w = world();
  const hostile = { get() { throw new Error('boom'); } };
  const caps = await buildOwnerCapabilities({ client: w, vehicles: [{ ...VEZEL }], userContext: ME, listingMedia: hostile });
  assert.deepEqual(caps.get(VEZEL.vin), { marketplace: { state: 'unavailable' }, trade_import: { state: 'single', order_id: 'ord-vezel' } });
});

// ── The shipped `withOwnerCapabilities` ──────────────────────────────────────────────────

function attach({ w = world(), supabaseOverride, ownerListingMedia, warnings = [] } = {}) {
  const deps = {
    actorForGovernedMedia,
    supabase: supabaseOverride || w,
    ownerListingMedia: ownerListingMedia || (async (vins) => new Map(vins.map((vin) => [vin, vin === SERENA.vin ? { state: 'published', items: [{}], unpublishable_count: 0 } : noMedia]))),
    readOwnerCapabilitiesForVin,
    console: { warn: (...args) => warnings.push(args.join(' ')), log() {}, error() {} },
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('actorForGovernedMedia', 'supabase', 'ownerListingMedia', 'readOwnerCapabilitiesForVin', 'console',
    `return (${shippedFunction('async function withOwnerCapabilities')});`)(
    deps.actorForGovernedMedia, deps.supabase, deps.ownerListingMedia, deps.readOwnerCapabilitiesForVin, deps.console);
  return { fn, warnings, w };
}

const PASSPORT = () => ({ vehicle: { vin: 'RU3-1316558' }, trust: { score: 61 } });

test('R3-C10: the owner of a vehicle gets the block, and the rest of the passport is untouched', async () => {
  const { fn } = attach();
  const passport = PASSPORT();
  const out = await fn(passport, VEZEL.vin, { userContext: ME });
  assert.deepEqual(out.capabilities, { marketplace: { state: 'not_listed' }, trade_import: { state: 'single', order_id: 'ord-vezel' } });
  assert.deepEqual({ ...out, capabilities: undefined }, { ...passport, capabilities: undefined });
  assert.deepEqual(Object.keys(out.capabilities), ['marketplace', 'trade_import']);
});

test('R3-C11: the Serena\'s owner is told it is published and has no import journey', async () => {
  const { fn } = attach();
  const out = await fn({ vehicle: { vin: SERENA.vin } }, SERENA.vin, { userContext: ME });
  assert.deepEqual(out.capabilities, { marketplace: { state: 'published' }, trade_import: { state: 'none' } });
});

test('R3-C12: a current seller who does not own the vehicle is still entitled', async () => {
  const w = world({ vehicles: [{ ...VEZEL, owner_id: 'u-stranger', current_seller_id: 'u-owner' }] });
  const { fn } = attach({ w });
  const out = await fn(PASSPORT(), VEZEL.vin, { userContext: ME });
  assert.ok(out.capabilities);
});

test('R3-C13: AUDIENCE — anonymous and merely-asserted callers cost nothing and learn nothing: no query is issued', async () => {
  let queries = 0;
  const spy = { from() { queries += 1; throw new Error('must not be queried'); } };
  const { fn } = attach({ supabaseOverride: spy });
  for (const userContext of [undefined, null, {}, { id: null }, { id: 'u-owner', identityAsserted: true }]) {
    const passport = PASSPORT();
    const out = await fn(passport, VEZEL.vin, { userContext });
    assert.equal(out, passport, `a response was rebuilt for ${JSON.stringify(userContext)}`);
  }
  assert.equal(queries, 0);
});

test('R3-C14: AUDIENCE — a stranger and a platform admin who owns nothing get the SAME object back, byte for byte', async () => {
  const { fn } = attach();
  for (const who of [STRANGER, ADMIN]) {
    const passport = PASSPORT();
    const out = await fn(passport, VEZEL.vin, { userContext: who });
    assert.equal(out, passport, `${who.id} was handed a block`);
    assert.equal('capabilities' in out, false);
    assert.equal(JSON.stringify(out), JSON.stringify(PASSPORT()));
  }
});

test('R3-C15: a missing vehicle row adds nothing', async () => {
  const { fn } = attach({ w: world({ vehicles: [] }) });
  const passport = PASSPORT();
  assert.equal(await fn(passport, 'NOPE', { userContext: ME }), passport);
  assert.equal(await fn(null, 'NOPE', { userContext: ME }), null);
});

test('R3-C16: FAULTS — a failure never fails the passport; it is returned untouched and the fault is logged', async () => {
  const warnings = [];
  const broken = { from() { throw new Error('database down'); } };
  const { fn } = attach({ supabaseOverride: broken, warnings });
  const passport = PASSPORT();
  assert.equal(await fn(passport, VEZEL.vin, { userContext: ME }), passport);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /capabilities/);
});

// ── readOwnerCapabilitiesForVin: the one place the passport's vehicle is read ───────────────

test('R3-C16b: the vehicle is read with NAMED columns — never select(*) — and exactly the ones the derivation uses', async () => {
  assert.equal(CAPABILITY_VEHICLE_COLUMNS.includes('*'), false);
  assert.deepEqual(CAPABILITY_VEHICLE_COLUMNS.split(',').map((c) => c.trim()).sort(), [
    'current_seller_id', 'currency', 'owner_id', 'price', 'publication_status', 'seller_description', 'seller_features', 'status', 'vin',
  ].sort());
  const w = world();
  const selects = [];
  const spy = { _rows: w._rows, from(table) { const b = w.from(table); const orig = b.select.bind(b); b.select = (cols) => { selects.push([table, cols]); return orig(cols); }; return b; } };
  await readOwnerCapabilitiesForVin({ client: spy, vin: VEZEL.vin, userContext: ME, listingMediaFor: async () => mediaMap({ [VEZEL.vin]: noMedia }) });
  assert.deepEqual(selects.find(([table]) => table === 'vehicles'), ['vehicles', CAPABILITY_VEHICLE_COLUMNS]);
  assert.equal(selects.some(([table, cols]) => table === 'vehicles' && String(cols).includes('*')), false);
});

test('R3-C16c: a viewer who is not entitled, a missing vehicle and a missing viewer all yield null — and no viewer means no read at all', async () => {
  const w = world();
  assert.equal(await readOwnerCapabilitiesForVin({ client: w, vin: VEZEL.vin, userContext: STRANGER }), null);
  assert.equal(await readOwnerCapabilitiesForVin({ client: w, vin: VEZEL.vin, userContext: ADMIN }), null);
  assert.equal(await readOwnerCapabilitiesForVin({ client: w, vin: 'NOPE', userContext: ME }), null);
  let reads = 0;
  const spy = { from() { reads += 1; throw new Error('must not read'); } };
  assert.equal(await readOwnerCapabilitiesForVin({ client: spy, vin: VEZEL.vin, userContext: null }), null);
  assert.equal(await readOwnerCapabilitiesForVin({ client: spy, vin: '', userContext: ME }), null);
  assert.equal(reads, 0);
});

test('R3-C16c2: a viewer who is not entitled causes NO further reads — no listing-media lookup, no import lookup (second line of defence)', async () => {
  const w = world();
  let mediaAsked = 0;
  let importsAsked = 0;
  for (const who of [STRANGER, ADMIN]) {
    const out = await readOwnerCapabilitiesForVin({
      client: w, vin: VEZEL.vin, userContext: who,
      listingMediaFor: async () => { mediaAsked += 1; return mediaMap(); },
      importCapabilities: async () => { importsAsked += 1; return new Map(); },
    });
    assert.equal(out, null);
  }
  assert.equal(mediaAsked, 0, 'the listing-media signal was read for someone who is not entitled to the vehicle');
  assert.equal(importsAsked, 0, 'the import orders were read for someone who is not entitled to the vehicle');
  // …and the entitled viewer does cause both, once each.
  let media = 0;
  let imports = 0;
  await readOwnerCapabilitiesForVin({
    client: w, vin: VEZEL.vin, userContext: ME,
    listingMediaFor: async () => { media += 1; return mediaMap({ [VEZEL.vin]: noMedia }); },
    importCapabilities: async (vehicles) => { imports += 1; return new Map(vehicles.map((v) => [v.vin, { state: 'none' }])); },
  });
  assert.deepEqual([media, imports], [1, 1]);
});

test('R3-C16d: a failed vehicle read THROWS — the caller then adds nothing; it is never read as "not the owner"', async () => {
  const dead = { from: () => { const b = { select: () => b, eq: () => b, maybeSingle: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }; return b; } };
  await assert.rejects(() => readOwnerCapabilitiesForVin({ client: dead, vin: VEZEL.vin, userContext: ME }), /boom/);
});

test('R3-C16e: the passport route file makes NO vehicle read of its own for capabilities', () => {
  const shipped = shippedFunction('async function withOwnerCapabilities');
  assert.doesNotMatch(shipped, /\.from\(\s*['"`]vehicles['"`]\s*\)/);
  assert.doesNotMatch(shipped, /select\(\s*['"`]\*['"`]\s*\)/);
  assert.match(shipped, /readOwnerCapabilitiesForVin\(/);
});

// ── The garage list wiring ───────────────────────────────────────────────────────────────

test('R3-C17: the garage list attaches the block per vehicle, after the governed media, and marks the response private', () => {
  const start = serverSrc.indexOf("app.get('/api/vehicles/me'");
  assert.ok(start > -1);
  const garage = serverSrc.slice(start, serverSrc.indexOf("app.get('/api/vehicles/saved'", start));
  assert.match(garage, /buildOwnerCapabilities\(\{ client: supabase, vehicles: withTrust, listingMedia: media, userContext: req\.userContext \}\)/);
  assert.match(garage, /catch \(capabilityError\)/, 'a fault must be caught: the garage must never fail because of the block');
  const handler = garage.slice(garage.indexOf('catch (capabilityError) {'));
  const caught = handler.slice(0, handler.indexOf('}') + 1);
  assert.match(caught, /console\.warn\(/, 'the fault must be logged');
  assert.doesNotMatch(caught, /throw|res\.status|res\.json/, 'the fault must be swallowed, not rethrown or sent');
  assert.match(garage, /\.\.\.\(capabilities\.has\(vehicle\.vin\) \? \{ capabilities: capabilities\.get\(vehicle\.vin\) \} : \{\}\)/);
  assert.ok(garage.indexOf('governed_media: governed.get') < garage.indexOf('capabilities: capabilities.get'), 'the block is a third, key-disjoint addition after the media blocks');
  assert.match(garage, /if \(capabilities\.size > 0\) res\.set\('Cache-Control', 'private, no-store'\)/);
  assert.ok(garage.indexOf("if (capabilities.size > 0) res.set(") < garage.indexOf('res.json('), 'the header must be set before the body is sent');
});

test('R3-C18: both passport routes attach the block through the shipped helper, after the governed media', () => {
  const calls = [...serverSrc.matchAll(/await withOwnerCapabilities\(await withGovernedMedia\(passport, (vin|resolvedVin), req\), (vin|resolvedVin), req\)/g)];
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal(call[1], call[2], 'the helper was handed a different identifier than the media helper');
});
