/**
 * CarUp Intelligence 1.0 — I2 activity ledger contract tests.
 *
 * These assert the properties the metric contract depends on, not the shape of the
 * code that happens to implement them:
 *
 *  - the taxonomy is identical in the service constants, the DB CHECK and the docs;
 *  - a client cannot manufacture a server-emitted business observation;
 *  - identity and tenant scope are SERVER-derived, and a client-supplied value is
 *    ignored rather than trusted;
 *  - scope follows the event's OBJECT (the listing's tenant), not the caller;
 *  - duplicates cannot inflate a metric;
 *  - metadata outside the per-type allowlist is dropped;
 *  - time discipline distinguishes a skewed clock from a genuinely late event;
 *  - the ingestion route is actually MOUNTED (a correct implementation that no
 *    request can reach is a dead path, which this codebase has been bitten by).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import {
  EVENT_TYPES,
  CLIENT_EMITTED,
  SERVER_EMITTED,
  RESERVED_EVENT_TYPES,
  PRIVACY_CLASS,
  METADATA_ALLOWLIST,
  ROLLUP_EXCLUDED_FLAGS,
  isClientEmittable,
  isServerEmitted,
} from '../services/intelligence/activityEventTypes.js';
import {
  validateClientEvent,
  projectMetadata,
  resolveClientTime,
  computeExclusionFlags,
  clientIdempotencyKey,
  ingestClientBatch,
  recordServerEvent,
  insertEvents,
  LATE_EVENT_WINDOW_MS,
} from '../services/intelligence/activityLedgerService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const MIGRATION = path.join(REPO, 'database/migrations/20260827120000_intelligence_activity_ledger.sql');

/**
 * Minimal Supabase-shaped fake. It records what the service actually sends, so the
 * assertions are about the ROW that would be persisted rather than about the
 * service's return value — the row is what a metric is later computed from.
 */
function createFakeClient({ vehicles = [], failInsert = false, duplicateKeys = new Set() } = {}) {
  const inserted = [];
  const stats = [];
  const client = {
    inserted,
    stats,
    from(table) {
      const api = {
        _table: table,
        _filters: {},
        select() { return api; },
        eq(column, value) { api._filters[column] = value; return api; },
        gte() { return api; },
        order() { return Promise.resolve({ data: [], error: null }); },
        maybeSingle() {
          if (table === 'vehicles') {
            const row = vehicles.find((v) => v.vin === api._filters.vin) || null;
            return Promise.resolve({ data: row, error: null });
          }
          if (table === 'intelligence_ingestion_stats') {
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        upsert(rows) {
          const list = Array.isArray(rows) ? rows : [rows];
          if (table === 'intelligence_ingestion_stats') {
            stats.push(...list);
            return Promise.resolve({ data: list, error: null });
          }
          if (failInsert) {
            const err = { data: null, error: { message: 'storage down' } };
            return { select: () => Promise.resolve(err), then: (r) => r(err) };
          }
          const accepted = list.filter((row) => !duplicateKeys.has(row.idempotency_key));
          inserted.push(...accepted);
          const result = { data: accepted.map((row) => ({ id: row.idempotency_key })), error: null };
          return { select: () => Promise.resolve(result), then: (r) => r(result) };
        },
      };
      return api;
    },
  };
  return client;
}

const VIN = 'JTDKB20U403001234';
const OWNER = 'user-seller-1';
const TENANT = 'tenant-alpha';
const vehiclesFixture = [{ vin: VIN, owner_id: OWNER, tenant_id: TENANT }];

function clientEvent(overrides = {}) {
  return {
    schema_version: 1,
    event_type: 'marketplace_listing_impression',
    listing_id: VIN,
    source_surface: 'marketplace_list',
    page_view_id: 'pageview-abcdefgh',
    ...overrides,
  };
}

// ── Taxonomy coherence across layers ────────────────────────────────────────

test('taxonomy is identical in the service constants and the database CHECK', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const block = sql.match(/mae_event_type_valid CHECK \(event_type IN \(([\s\S]*?)\)\)/);
  assert.ok(block, 'migration must declare the event_type CHECK');
  const dbTypes = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(dbTypes, [...EVENT_TYPES].sort(),
    'the DB CHECK and the service taxonomy must not drift apart');
});

test('every event type has a privacy class, an emitter and a metadata allowlist', () => {
  for (const type of EVENT_TYPES) {
    assert.ok(PRIVACY_CLASS[type], `${type} must have a privacy class`);
    assert.ok(
      isClientEmittable(type) !== isServerEmitted(type),
      `${type} must be exactly one of client- or server-emitted`,
    );
    assert.ok(Array.isArray(METADATA_ALLOWLIST[type]), `${type} must declare a metadata allowlist`);
  }
  assert.equal(
    Object.keys(CLIENT_EMITTED).length + Object.keys(SERVER_EMITTED).length,
    EVENT_TYPES.length,
  );
});

test('reserved names are not emittable and are rejected distinctly from unknown ones', () => {
  for (const reserved of RESERVED_EVENT_TYPES) {
    assert.ok(!EVENT_TYPES.includes(reserved), `${reserved} must stay reserved, not emittable`);
    const verdict = validateClientEvent(clientEvent({ event_type: reserved }));
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'reserved_event_type');
  }
  const unknown = validateClientEvent(clientEvent({ event_type: 'marketplace_totally_made_up' }));
  assert.equal(unknown.reason, 'unknown_event_type');
});

test('the paused/archived lifecycle events stay reserved while the domain lacks those states', () => {
  // Gap G10: vehicles.publication_status has no paused/archived state. Emitting
  // these would mean Intelligence inventing a domain state it does not own.
  assert.ok(RESERVED_EVENT_TYPES.includes('marketplace_listing_paused'));
  assert.ok(RESERVED_EVENT_TYPES.includes('marketplace_listing_archived'));
  assert.ok(!EVENT_TYPES.includes('marketplace_listing_paused'));
  assert.ok(!EVENT_TYPES.includes('marketplace_listing_archived'));
});

// ── A client cannot manufacture business facts ──────────────────────────────

test('a client submitting a server-emitted type is rejected', () => {
  for (const type of Object.keys(SERVER_EMITTED)) {
    const verdict = validateClientEvent(clientEvent({ event_type: type }));
    assert.equal(verdict.ok, false, `${type} must not be client-submittable`);
    assert.equal(verdict.reason, 'server_emitted_type_rejected');
  }
});

test('a forged save posted by a client never reaches the ledger', async () => {
  const client = createFakeClient({ vehicles: vehiclesFixture });
  const summary = await ingestClientBatch({
    session_key: 'session-forgery1',
    events: [clientEvent({ event_type: 'marketplace_listing_saved' })],
  }, { req: { headers: {} }, client });
  assert.equal(summary.accepted, 0);
  assert.equal(summary.rejected, 1);
  assert.equal(client.inserted.length, 0);
});

// ── Server-derived privilege ────────────────────────────────────────────────

test('client-supplied identity and tenant scope are ignored; both are server-derived', async () => {
  const client = createFakeClient({ vehicles: vehiclesFixture });
  await ingestClientBatch({
    session_key: 'session-scope01',
    events: [clientEvent({
      // All three are hostile client claims. None may survive.
      authenticated_user_id: 'attacker-user',
      tenant_id: 'tenant-victim',
      organization_id: 'org-victim',
    })],
  }, {
    req: { headers: {}, userContext: { id: 'buyer-9', tenantId: 'tenant-buyer' } },
    client,
  });

  assert.equal(client.inserted.length, 1);
  const row = client.inserted[0];
  assert.equal(row.authenticated_user_id, 'buyer-9', 'identity comes from the session');
  assert.notEqual(row.authenticated_user_id, 'attacker-user');
  // Scope follows the OBJECT: the listing's owning tenant, never the caller's.
  assert.equal(row.tenant_id, TENANT);
  assert.notEqual(row.tenant_id, 'tenant-victim');
  assert.notEqual(row.tenant_id, 'tenant-buyer');
  assert.equal(row.actor_scope, 'authenticated');
});

test('an anonymous shopper is stored as anonymous with no user id', async () => {
  const client = createFakeClient({ vehicles: vehiclesFixture });
  await ingestClientBatch({
    session_key: 'session-anon001',
    events: [clientEvent()],
  }, { req: { headers: {} }, client });
  const row = client.inserted[0];
  assert.equal(row.actor_scope, 'anonymous');
  assert.equal(row.authenticated_user_id, null);
  assert.equal(row.pseudonymous_session_key, 'session-anon001');
});

test('an event on an unknown object is rejected rather than stored with a guessed scope', async () => {
  const client = createFakeClient({ vehicles: vehiclesFixture });
  const summary = await ingestClientBatch({
    session_key: 'session-unknown1',
    events: [clientEvent({ listing_id: 'VINDOESNOTEXIST01' })],
  }, { req: { headers: {} }, client });
  assert.equal(summary.accepted, 0);
  assert.equal(summary.reasons.unknown_object, 1);
  assert.equal(client.inserted.length, 0);
});

// ── Duplicates ──────────────────────────────────────────────────────────────

test('the same action twice in one batch yields one idempotency key', async () => {
  const client = createFakeClient({ vehicles: vehiclesFixture });
  const event = clientEvent();
  await ingestClientBatch({
    session_key: 'session-dupe0001',
    events: [event, { ...event }],
  }, { req: { headers: {} }, client });
  const keys = new Set(client.inserted.map((r) => r.idempotency_key));
  assert.equal(keys.size, 1, 'identical impressions must collapse to one key');
});

test('a duplicate is counted, not silently dropped', async () => {
  const key = clientIdempotencyKey(
    { event_type: 'marketplace_listing_impression', listing_id: VIN, source_surface: 'marketplace_list' },
    { sessionKey: 'session-dupe0002', pageViewId: 'pageview-abcdefgh' },
  );
  const client = createFakeClient({ vehicles: vehiclesFixture, duplicateKeys: new Set([key]) });
  const summary = await ingestClientBatch({
    session_key: 'session-dupe0002',
    events: [clientEvent()],
  }, { req: { headers: {} }, client });
  assert.equal(summary.accepted, 0);
  assert.equal(summary.duplicates, 1);
});

test('a distinct page view is a distinct view; a retry within one page view is not', () => {
  const base = { event_type: 'marketplace_listing_impression', listing_id: VIN, source_surface: 'marketplace_list' };
  const a = clientIdempotencyKey(base, { sessionKey: 's-1234567', pageViewId: 'pv-aaaaaaaa' });
  const again = clientIdempotencyKey(base, { sessionKey: 's-1234567', pageViewId: 'pv-aaaaaaaa' });
  const other = clientIdempotencyKey(base, { sessionKey: 's-1234567', pageViewId: 'pv-bbbbbbbb' });
  assert.equal(a, again);
  assert.notEqual(a, other);
});

// ── Metadata allowlist ──────────────────────────────────────────────────────

test('metadata outside the per-type allowlist is dropped, including smuggled identifiers', () => {
  const projected = projectMetadata('marketplace_listing_shared', {
    share_resolution: 'confirmed',
    share_channel: 'whatsapp',
    email: 'buyer@example.com',
    phone: '+263771234567',
    notes: 'free text that must never be stored',
  });
  assert.deepEqual(projected, { share_resolution: 'confirmed', share_channel: 'whatsapp' });
});

test('a metadata enum value outside its declared set is dropped', () => {
  const projected = projectMetadata('marketplace_listing_shared', { share_resolution: 'definitely_sold' });
  assert.deepEqual(projected, {});
});

test('share resolution keeps confirmed and initiated distinguishable', () => {
  assert.equal(projectMetadata('marketplace_listing_shared', { share_resolution: 'confirmed' }).share_resolution, 'confirmed');
  assert.equal(projectMetadata('marketplace_listing_shared', { share_resolution: 'initiated' }).share_resolution, 'initiated');
});

// ── Time discipline ─────────────────────────────────────────────────────────

test('a skewed clock is adjusted but still counted; a genuinely late event is flagged out', () => {
  const received = new Date('2026-08-27T12:00:00.000Z');

  const future = resolveClientTime(new Date(received.getTime() + 60_000).toISOString(), received);
  assert.deepEqual(future.flags, ['clock_skew_adjusted']);
  assert.ok(!ROLLUP_EXCLUDED_FLAGS.includes('clock_skew_adjusted'),
    'a wrong phone clock must not erase a real shopper from the numbers');

  const late = resolveClientTime(new Date(received.getTime() - LATE_EVENT_WINDOW_MS - 60_000).toISOString(), received);
  assert.deepEqual(late.flags, ['late_beyond_window']);
  assert.ok(ROLLUP_EXCLUDED_FLAGS.includes('late_beyond_window'));
  // The raw client time survives, so true lateness stays computable after clamping.
  assert.equal(late.occurredAtClient.toISOString(), new Date(received.getTime() - LATE_EVENT_WINDOW_MS - 60_000).toISOString());
  assert.ok(late.occurredAt.getTime() > late.occurredAtClient.getTime());

  const normal = resolveClientTime(new Date(received.getTime() - 5_000).toISOString(), received);
  assert.deepEqual(normal.flags, []);
});

test('occurred_at is never after received_at (the DB CHECK would reject it)', async () => {
  const client = createFakeClient({ vehicles: vehiclesFixture });
  await ingestClientBatch({
    session_key: 'session-future01',
    events: [clientEvent({ occurred_at: new Date(Date.now() + 3_600_000).toISOString() })],
  }, { req: { headers: {} }, client });
  const row = client.inserted[0];
  assert.ok(new Date(row.occurred_at) <= new Date(row.received_at));
});

// ── Exclusion flags ─────────────────────────────────────────────────────────

test('a seller viewing their own listing is flagged as self-traffic', () => {
  const flags = computeExclusionFlags({
    actorUserId: OWNER, objectOwnerUserId: OWNER, userAgent: 'Mozilla/5.0',
  });
  assert.ok(flags.includes('self_traffic'));
});

test('anyone in the owning tenant counts as self-traffic', () => {
  const flags = computeExclusionFlags({
    actorUserId: 'colleague-2', actorTenantId: TENANT, objectTenantId: TENANT, userAgent: 'Mozilla/5.0',
  });
  assert.ok(flags.includes('self_traffic'));
});

test('a bot user agent is flagged, not rejected', () => {
  const flags = computeExclusionFlags({ userAgent: 'python-requests/2.31.0' });
  assert.ok(flags.includes('bot_suspect'));
});

test('an unauthorized caller cannot declare its events synthetic', () => {
  const unauthorized = computeExclusionFlags({ declaredSynthetic: true, syntheticAuthorized: false });
  assert.ok(!unauthorized.includes('synthetic'),
    'certification counts depend on synthetic being un-spoofable');
  const authorized = computeExclusionFlags({ declaredSynthetic: true, syntheticAuthorized: true });
  assert.ok(authorized.includes('synthetic'));
});

test('self-traffic is excluded from seller-facing counts but not from the base rollup set', () => {
  assert.ok(!ROLLUP_EXCLUDED_FLAGS.includes('self_traffic'));
});

// ── Server-emitted events ───────────────────────────────────────────────────

test('a server event refuses to write without authority-derived idempotency material', async () => {
  const client = createFakeClient({ vehicles: vehiclesFixture });
  const result = await recordServerEvent({
    eventType: 'marketplace_listing_saved', vin: VIN, client,
  });
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'missing_idempotency_material');
  assert.equal(client.inserted.length, 0);
});

test('a server event rejects a client-emittable type (emitters do not overlap)', async () => {
  const client = createFakeClient({ vehicles: vehiclesFixture });
  const result = await recordServerEvent({
    eventType: 'marketplace_listing_impression', vin: VIN,
    idempotencyMaterial: ['x'], client,
  });
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'not_a_server_emitted_type');
});

test('the same authority row recorded twice produces one key', async () => {
  const client = createFakeClient({ vehicles: vehiclesFixture });
  const args = {
    eventType: 'marketplace_inquiry_created', vin: VIN,
    objectType: 'inquiry', objectId: 'inq-1',
    idempotencyMaterial: ['inq-1'], client,
  };
  await recordServerEvent(args);
  const keys = new Set(client.inserted.map((r) => r.idempotency_key));
  await recordServerEvent({ ...args });
  const keysAfter = new Set(client.inserted.map((r) => r.idempotency_key));
  assert.equal(keys.size, 1);
  assert.equal(keysAfter.size, 1, 'a replayed authority row must not create a second observation');
});

test('a server event derives tenant scope from the object, not from the actor', async () => {
  const client = createFakeClient({ vehicles: vehiclesFixture });
  await recordServerEvent({
    eventType: 'marketplace_listing_saved', vin: VIN,
    idempotencyMaterial: [OWNER, VIN, 'saved', '2026-08-27T00:00:00Z'],
    actor: { userId: 'buyer-77', tenantId: 'tenant-buyer' },
    client,
  });
  const row = client.inserted[0];
  assert.equal(row.tenant_id, TENANT);
  assert.equal(row.authenticated_user_id, 'buyer-77');
  assert.equal(row.privacy_class, 'P2');
});

// ── Failure posture ─────────────────────────────────────────────────────────

test('a storage failure is counted, never thrown, and never reported as acceptance', async () => {
  const client = createFakeClient({ vehicles: vehiclesFixture, failInsert: true });
  const summary = await ingestClientBatch({
    session_key: 'session-fail0001',
    events: [clientEvent()],
  }, { req: { headers: {} }, client });
  assert.equal(summary.accepted, 0);
  assert.equal(summary.storage_failures, 1);
});

test('insertEvents reports failures rather than pretending rows landed', async () => {
  const client = createFakeClient({ failInsert: true });
  const result = await insertEvents(client, [{ idempotency_key: 'k'.repeat(16) }]);
  assert.equal(result.inserted, 0);
  assert.equal(result.failures, 1);
});

// ── Wiring: the path must be reachable, not merely correct ──────────────────

test('the ingestion route is mounted in the server (not implemented-but-dead)', () => {
  const server = fs.readFileSync(path.join(REPO, 'backend/server.js'), 'utf8');
  assert.match(server, /import intelligenceActivityRouter from '\.\/routes\/intelligenceActivityRoutes\.js'/);
  assert.match(server, /app\.use\(intelligenceActivityRouter\)/);
});

test('the route declares the public ingestion and admin health endpoints', () => {
  const routes = fs.readFileSync(path.join(REPO, 'backend/routes/intelligenceActivityRoutes.js'), 'utf8');
  assert.match(routes, /'\/api\/intelligence\/activity'/);
  assert.match(routes, /'\/api\/admin\/intelligence\/ingestion-health'/);
  assert.match(routes, /authorizeRole\(\['admin'\]\)/);
});

// ── Migration governance ────────────────────────────────────────────────────

test('the ledger table is service-role only with RLS forced and no client grants', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  assert.match(sql, /ALTER TABLE marketplace_activity_events ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE marketplace_activity_events FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE marketplace_activity_events FROM anon/);
  assert.match(sql, /REVOKE ALL ON TABLE marketplace_activity_events FROM authenticated/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE marketplace_activity_events TO service_role/);
  assert.ok(!/CREATE POLICY/.test(sql), 'zero policies: default-deny for every client role');
});

test('duplicate suppression is a database guarantee, not an application convention', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_mae_idempotency_key/);
});

test('retention and erasure ship with the ledger and refuse unsafe input', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  assert.match(sql, /CREATE OR REPLACE FUNCTION intelligence_purge_activity_events/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION intelligence_erase_actor/);
  // A mis-scheduled purge must not be able to delete inside the retention window.
  assert.match(sql, /refusing to purge inside the 24-month retention window/);
  // SECURITY DEFINER functions must pin search_path.
  const definerCount = (sql.match(/SECURITY DEFINER/g) || []).length;
  const searchPathCount = (sql.match(/SET search_path = public, pg_temp/g) || []).length;
  assert.equal(definerCount, searchPathCount, 'every SECURITY DEFINER function must pin search_path');
});

test('the migration does not weaken any existing table', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  assert.ok(!/DROP TABLE(?!.*--)/i.test(sql.split('-- ── Rollback')[0]), 'no live DROP TABLE');
  assert.ok(!/GRANT .* TO anon/i.test(sql), 'nothing is granted to anon');
  assert.ok(!/GRANT .* TO authenticated/i.test(sql), 'nothing is granted to authenticated');
});
