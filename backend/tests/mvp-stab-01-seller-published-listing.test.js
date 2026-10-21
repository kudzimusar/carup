/**
 * CARUP-MVP-STAB-01 — F-007 / F-008: a PUBLISHED Seller listing changes only when its seller means
 * it to, and re-saving a listing never takes it off the Marketplace.
 *
 * Runtime proof that opened this (canonical staging, GFC27-027051):
 *   · PATCH /api/vehicles/GFC27-027051/seller-draft returned 200 while the listing was unpublished;
 *   · the owner published it;
 *   · the same PATCH then returned an UNCODED 409 and Seller Studio told the owner "Account autosave
 *     is unavailable right now" — about a listing that was simply live, with nothing actually broken.
 *
 * And the other half of the same defect: "Save as Draft" on that listing goes through
 * POST /api/vehicles/add with `reuse_existing_passport`, whose reuse branch wrote
 * `publication_status: 'draft'` — a silent unpublish, with the gallery replaced and the agency
 * columns rewritten, and no audit row anywhere.
 *
 * These tests drive the SHIPPED server.js handlers over HTTP with a recording Supabase double, and
 * assert the business outcome (status, structured code, what was written, what was audited) — never
 * the spelling of the source.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
for (const method of ['log', 'info', 'warn', 'error', 'debug']) console[method] = () => {};

const VIN = 'JTMHY7AJ2K4099001';
const OWNER = 'usr-mvp-owner';
const CURRENT_SELLER = 'usr-mvp-current-seller';
const ADMIN = 'usr-mvp-admin';
const TENANT = 'tenant-mvp-original';

const STORED_DESCRIPTION = 'One careful owner. Serviced on schedule at an approved garage in Harare.';

function baseVehicle(overrides = {}) {
  return {
    vin: VIN,
    owner_id: OWNER,
    current_seller_id: OWNER,
    current_seller_type: 'Private Owner',
    tenant_id: TENANT,
    publication_status: 'published',
    status: 'Available',
    price: 12800,
    currency: 'USD',
    seller_description: STORED_DESCRIPTION,
    seller_features: ['Air conditioning'],
    body_style: 'Minivan',
    seller_stated_condition: 'Good',
    listing_city: 'Harare',
    listing_province: 'Harare',
    listing_country: null,
    listing_location_visibility: 'province_only',
    public_seller_display_enabled: false,
    seller_accident_disclosure: null,
    seller_insurance_disclosure: null,
    seller_finance_disclosure: null,
    ...overrides,
  };
}

let world;
function resetWorld(vehicle = {}) {
  world = {
    vehicle: baseVehicle(vehicle),
    users: {
      [OWNER]: { id: OWNER, role: 'owner', is_verified: true },
      [CURRENT_SELLER]: { id: CURRENT_SELLER, role: 'owner', is_verified: true },
      [ADMIN]: { id: ADMIN, role: 'admin', is_verified: true },
    },
    revokedAuthority: new Set(),
    ops: [],
    /** Runs once, right after the first `vehicles` read — the race window between read and write. */
    afterFirstVehicleRead: null,
  };
}

const NO_ROWS = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' };

function resolveOp(op) {
  world.ops.push(op);
  if (op.table === 'users') {
    const user = world.users[op.filters.id];
    return user ? { data: user, error: null } : { data: null, error: NO_ROWS };
  }
  if (op.table === 'vehicles') {
    const row = world.vehicle;
    const matches = Object.entries(op.filters).every(([key, value]) => row[key] === value);
    if (op.action === 'select') {
      const data = matches ? { ...row } : null;
      if (world.afterFirstVehicleRead) {
        const hook = world.afterFirstVehicleRead;
        world.afterFirstVehicleRead = null;
        hook(world.vehicle);
      }
      if (op.single) return data || op.maybeSingle ? { data, error: null } : { data: null, error: NO_ROWS };
      return { data: data ? [data] : [], error: null };
    }
    if (op.action === 'update') {
      if (!matches) return op.single ? { data: null, error: NO_ROWS } : { data: null, error: null };
      Object.assign(world.vehicle, JSON.parse(JSON.stringify(op.payload)));
      return { data: op.single ? { ...world.vehicle } : null, error: null };
    }
    return { data: null, error: null };
  }
  if (op.table === 'vehicle_seller_authority') {
    return { data: world.revokedAuthority.has(op.filters.seller_user_id) ? { status: 'revoked' } : null, error: null };
  }
  if (op.table === 'vehicle_ownership_transfers') return { data: [], error: null };
  if (op.single) return { data: null, error: null };
  return { data: [], error: null };
}

const writesTo = (table) => world.ops.filter((op) => op.table === table && op.action !== 'select');
const vehicleWrites = () => writesTo('vehicles');
const auditRows = () => writesTo('trust_audit_events').map((op) => op.payload);

describe('CARUP-MVP-STAB-01 — published Seller listings over the shipped handlers', () => {
  let server;
  let baseUrl;
  let originalFrom;
  let supabaseClient;

  before(async () => {
    resetWorld();
    const { app } = await import('../server.js');
    ({ supabase: supabaseClient } = await import('../db/supabase.js'));
    originalFrom = supabaseClient.from;
    supabaseClient.from = (table) => {
      const op = { table, action: 'select', filters: {}, payload: null, single: false, maybeSingle: false };
      const declared = {
        select() { return proxy; },
        insert(payload) { op.action = 'insert'; op.payload = payload; return proxy; },
        upsert(payload) { op.action = 'upsert'; op.payload = payload; return proxy; },
        update(payload) { op.action = 'update'; op.payload = payload; return proxy; },
        delete() { op.action = 'delete'; return proxy; },
        eq(key, value) { op.filters[key] = value; return proxy; },
        maybeSingle() { op.single = true; op.maybeSingle = true; return proxy; },
        single() { op.single = true; return proxy; },
        then(onFulfilled, onRejected) { return Promise.resolve(resolveOp(op)).then(onFulfilled, onRejected); },
      };
      const proxy = new Proxy(declared, {
        get(target, property) {
          if (property in target) return target[property];
          if (typeof property === 'symbol') return undefined;
          return () => proxy;
        },
      });
      return proxy;
    };
    await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (supabaseClient && originalFrom) supabaseClient.from = originalFrom;
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => resetWorld());

  async function call(actor, method, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-user-id': actor, 'x-bypass-rate-limit': 'true' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }

  const patchDraft = (actor, body) => call(actor, 'PATCH', `/api/vehicles/${VIN}/seller-draft`, body);
  // Exactly what Seller Studio sends: the full commercial payload, unchanged except for what the
  // seller edited.
  const studioPayload = (overrides = {}) => ({
    description: STORED_DESCRIPTION,
    features: ['Air conditioning'],
    body_style: 'Minivan',
    seller_stated_condition: 'Good',
    price: 12800,
    currency: 'USD',
    location: 'Harare',
    province: 'Harare',
    location_visibility: 'province_only',
    public_seller_display_enabled: false,
    ...overrides,
  });

  // ── The refusals are structured, so a client can tell "live" from "broken" ──────────────────────

  it('refuses an autosave on a PUBLISHED listing with a structured code — and writes nothing', async () => {
    const { status, body } = await patchDraft(OWNER, studioPayload({ description: `${STORED_DESCRIPTION} Edited.` }));

    assert.equal(status, 409, JSON.stringify(body));
    assert.equal(body.code, 'SELLER_LISTING_PUBLISHED_EXPLICIT_SAVE_REQUIRED');
    assert.equal(body.publication_status, 'published');
    assert.equal(body.error, 'Only an unpublished active Seller draft can be autosaved',
      'the pre-existing message text stays available to older clients');
    assert.equal(vehicleWrites().length, 0, 'an unscoped autosave must not touch a live listing');
    assert.equal(auditRows().length, 0);
    assert.equal(world.vehicle.seller_description, STORED_DESCRIPTION);
  });

  it('refuses every write to a SOLD listing as read-only — with or without an explicit edit scope', async () => {
    for (const vehicle of [
      { status: 'Sold', publication_status: 'published' },
      { status: 'sold', publication_status: 'publishable' },
    ]) {
      for (const scope of [{}, { edit_scope: 'published_listing' }]) {
        resetWorld(vehicle);
        const { status, body } = await patchDraft(OWNER, studioPayload({ description: `${STORED_DESCRIPTION} Edited.`, ...scope }));
        const label = `${JSON.stringify(vehicle)} ${JSON.stringify(scope)}`;
        assert.equal(status, 409, `${label}: ${JSON.stringify(body)}`);
        assert.equal(body.code, 'SELLER_LISTING_SOLD_READ_ONLY', label);
        assert.equal(body.error, 'Only an unpublished active Seller draft can be autosaved', label);
        assert.equal(vehicleWrites().length, 0, `${label}: a closed sale is never edited`);
        assert.equal(auditRows().length, 0, label);
      }
    }
  });

  // ── The explicit published-listing save ─────────────────────────────────────────────────────────

  it('saves an explicit edit to a published listing, keeps it published and agency untouched, and audits field NAMES only', async () => {
    const editedDescription = `${STORED_DESCRIPTION} New tyres fitted in September.`;
    const { status, body } = await patchDraft(OWNER, studioPayload({
      description: editedDescription,
      features: ['Air conditioning', 'Reverse camera'],
      edit_scope: 'published_listing',
    }));

    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.success, true);
    assert.equal(body.publication_status, 'published');
    assert.equal(body.draft.description, editedDescription, 'the receipt echoes what is now stored');
    assert.deepEqual(body.draft.features, ['Air conditioning', 'Reverse camera']);
    assert.deepEqual(body.changed_fields, ['description', 'features']);

    const writes = vehicleWrites();
    assert.equal(writes.length, 1, 'exactly one write: the seller-commercial patch');
    for (const forbidden of ['publication_status', 'owner_id', 'current_seller_id', 'current_seller_type', 'tenant_id', 'trust_score']) {
      assert.equal(Object.prototype.hasOwnProperty.call(writes[0].payload, forbidden), false,
        `a published-listing edit must not write ${forbidden}`);
    }
    assert.equal(writes[0].filters.publication_status, 'published',
      'the write is conditional on the listing still being published');
    assert.equal(world.vehicle.publication_status, 'published');
    assert.equal(world.vehicle.owner_id, OWNER);
    assert.equal(world.vehicle.current_seller_id, OWNER);
    assert.equal(world.vehicle.current_seller_type, 'Private Owner');
    assert.equal(world.vehicle.tenant_id, TENANT);

    const audits = auditRows();
    assert.equal(audits.length, 1, 'one audit row for one public edit');
    assert.equal(audits[0].event_type, 'VEHICLE_PUBLISHED_LISTING_EDITED');
    assert.equal(audits[0].vin, VIN);
    assert.equal(audits[0].actor_user_id, OWNER);
    assert.deepEqual(audits[0].new_value, { changed_fields: ['description', 'features'] });
    const serialized = JSON.stringify(audits[0]);
    assert.equal(serialized.includes('New tyres'), false, 'the audit names fields; it never copies their values');
    assert.equal(serialized.includes('Reverse camera'), false);
  });

  it('a published-listing save that changes nothing writes no audit row', async () => {
    const { status, body } = await patchDraft(OWNER, studioPayload({ edit_scope: 'published_listing' }));
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(body.changed_fields, []);
    assert.equal(auditRows().length, 0);
    assert.equal(world.vehicle.publication_status, 'published');
  });

  it('enforces the same effective-denial check publish/unpublish use, for a non-owner current seller', async () => {
    resetWorld({ current_seller_id: CURRENT_SELLER });
    world.revokedAuthority.add(CURRENT_SELLER);
    const denied = await patchDraft(CURRENT_SELLER, studioPayload({ description: `${STORED_DESCRIPTION} Edited.`, edit_scope: 'published_listing' }));
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    assert.equal(vehicleWrites().length, 0, 'a revoked seller changes nothing on the public listing');
    assert.equal(auditRows().length, 0);

    // Positive control: the same current seller, not revoked, passes the gate.
    resetWorld({ current_seller_id: CURRENT_SELLER });
    const allowed = await patchDraft(CURRENT_SELLER, studioPayload({ description: `${STORED_DESCRIPTION} Edited.`, edit_scope: 'published_listing' }));
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
    assert.equal(world.vehicle.current_seller_id, CURRENT_SELLER);
    assert.equal(world.vehicle.owner_id, OWNER);
  });

  it('refuses an explicit published-listing save on a listing that is not published', async () => {
    resetWorld({ publication_status: 'publishable' });
    const { status, body } = await patchDraft(OWNER, studioPayload({ description: `${STORED_DESCRIPTION} Edited.`, edit_scope: 'published_listing' }));
    assert.equal(status, 409, JSON.stringify(body));
    assert.equal(body.code, 'SELLER_LISTING_NOT_PUBLISHED');
    assert.equal(body.publication_status, 'publishable');
    assert.equal(vehicleWrites().length, 0);
  });

  it('refuses the write when the listing leaves the Marketplace between the read and the write', async () => {
    world.afterFirstVehicleRead = (row) => { row.publication_status = 'publishable'; };
    const { status, body } = await patchDraft(OWNER, studioPayload({ description: `${STORED_DESCRIPTION} Edited.`, edit_scope: 'published_listing' }));
    assert.equal(status, 409, JSON.stringify(body));
    assert.equal(body.code, 'SELLER_LISTING_NOT_PUBLISHED');
    assert.equal(world.vehicle.seller_description, STORED_DESCRIPTION, 'nothing landed on the unpublished row');
    assert.equal(auditRows().length, 0);
  });

  it('refuses an unknown edit scope instead of guessing what it means', async () => {
    const { status, body } = await patchDraft(OWNER, studioPayload({ edit_scope: 'everything' }));
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(body.code, 'SELLER_EDIT_SCOPE_INVALID');
    assert.equal(vehicleWrites().length, 0);
  });

  it('leaves the draft autosave path unchanged: no scope, no audit, publication untouched', async () => {
    resetWorld({ publication_status: 'publishable' });
    const { status, body } = await patchDraft(OWNER, studioPayload({ description: `${STORED_DESCRIPTION} Edited.` }));
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.publication_status, 'publishable');
    assert.equal(body.draft.description, `${STORED_DESCRIPTION} Edited.`);
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'changed_fields'), false);
    assert.equal(vehicleWrites().length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(vehicleWrites()[0].filters, 'publication_status'), false);
    assert.equal(auditRows().length, 0);
    assert.equal(world.vehicle.publication_status, 'publishable');
  });

  // ── F-008: /api/vehicles/add never silently unpublishes ────────────────────────────────────────

  const resaveBody = (overrides = {}) => ({
    vin: VIN,
    make: 'Toyota',
    model: 'Hilux',
    year: 2019,
    color: 'White',
    mileage: 90000,
    price: 12800,
    currency: 'USD',
    description: STORED_DESCRIPTION,
    features: ['Air conditioning'],
    body_style: 'Minivan',
    seller_stated_condition: 'Good',
    location: 'Harare',
    province: 'Harare',
    location_visibility: 'province_only',
    public_seller_display_enabled: false,
    images: [{ url: 'https://cdn.carup.dev/replacement.jpg', is_primary: true }],
    reuse_existing_passport: true,
    ...overrides,
  });

  it('refuses to re-save a PUBLISHED listing through /api/vehicles/add — no demotion, no agency rewrite, no gallery replacement', async () => {
    const { status, body } = await call(OWNER, 'POST', '/api/vehicles/add', resaveBody());

    assert.equal(status, 409, JSON.stringify(body));
    assert.equal(body.code, 'SELLER_LISTING_PUBLISHED_USE_EXPLICIT_SAVE');
    assert.equal(body.publication_status, 'published');
    assert.equal(vehicleWrites().length, 0, 'the vehicle row is not written at all');
    assert.equal(writesTo('listing_images').length, 0, 'the public gallery is neither replaced nor deleted');
    assert.equal(writesTo('vehicle_ownership_history').length, 0);
    assert.equal(world.vehicle.publication_status, 'published');
    assert.equal(world.vehicle.current_seller_id, OWNER);
    assert.equal(world.vehicle.tenant_id, TENANT);
  });

  it('still re-saves a not-yet-published listing as a draft (the reuse path is otherwise unchanged)', async () => {
    resetWorld({ publication_status: 'publishable' });
    const { status, body } = await call(OWNER, 'POST', '/api/vehicles/add', resaveBody());

    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.reused_existing_passport, true);
    const writes = vehicleWrites();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].action, 'update');
    assert.equal(writes[0].payload.publication_status, 'draft');
  });
});
