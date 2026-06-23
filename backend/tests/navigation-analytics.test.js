process.env.NODE_ENV = 'test';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  ingestBatch,
  projectEvent,
  sanitizeRoutePattern,
  coarseRole,
  getNavigationAggregates,
  MAX_EVENTS_PER_BATCH,
  _resetDedupe,
  _resetAllowlist,
} from '../services/navigationAnalytics/navigationAnalyticsService.js';
import navigationAnalyticsRouter from '../routes/navigationAnalyticsRoutes.js';

// ── In-memory fake Supabase client (mirrors feature-governance.test.js, plus
//    gte/lte support for the aggregate window read) ──────────────────────────
function makeFakeClient(seed = {}, opts = {}) {
  const tables = { trust_audit_events: [] };
  for (const [k, v] of Object.entries(seed)) tables[k] = [...(v || [])];
  if (!tables.navigation_analytics_events) tables.navigation_analytics_events = [];
  // Sessions/users so resolveRequestContext can derive a trusted role.
  if (!tables.user_sessions) tables.user_sessions = [];
  if (!tables.users) tables.users = [];
  if (!tables.tenant_users) tables.tenant_users = [];
  let idSeq = 1;
  function from(table) {
    if (!tables[table]) tables[table] = [];
    const rows = tables[table];
    const ctx = { filters: [], ranges: [], op: null, payload: null };
    const match = (r) => ctx.filters.every(([c, v]) => r[c] === v)
      && ctx.ranges.every(([c, kind, v]) => kind === 'gte' ? r[c] >= v : r[c] <= v);
    const execute = () => {
      if (opts.failTable === table && opts.failOp === (ctx.op || 'select')) {
        return { data: null, error: { message: 'simulated storage failure' } };
      }
      if (ctx.op === 'insert') {
        const payloads = Array.isArray(ctx.payload) ? ctx.payload : [ctx.payload];
        const inserted = payloads.map((p) => ({ id: `row-${idSeq++}`, created_at: new Date().toISOString(), ...p }));
        rows.push(...inserted);
        return { data: inserted, error: null };
      }
      let result = rows.filter(match);
      if (ctx.limit != null) result = result.slice(0, ctx.limit);
      return { data: result, error: null };
    };
    const builder = {
      select() { return builder; },
      eq(col, val) { ctx.filters.push([col, val]); return builder; },
      gte(col, val) { ctx.ranges.push([col, 'gte', val]); return builder; },
      lte(col, val) { ctx.ranges.push([col, 'lte', val]); return builder; },
      order() { return builder; },
      limit(n) { ctx.limit = n; return builder; },
      single() { ctx.limit = 1; const r = execute(); return Promise.resolve({ data: (r.data || [])[0] || null, error: r.error }); },
      insert(p) { ctx.op = 'insert'; ctx.payload = p; return builder; },
      then(resolve) { resolve(execute()); },
    };
    return builder;
  }
  return { from, _tables: tables };
}

// Allowed stored columns — the projection MUST never emit anything outside this.
const ALLOWED_COLUMNS = new Set([
  'schema_version', 'event_type', 'feature_id', 'node_id', 'surface',
  'source_route_pattern', 'destination_route_pattern', 'platform',
  'role_category', 'lifecycle_or_reason_code', 'build_version', 'occurred_at',
]);
const PII_COLUMNS = ['name', 'email', 'phone', 'vin', 'token', 'tokens', 'url', 'ip', 'ip_address', 'device_id', 'tenant_id'];

const sessionReq = (token) => ({ headers: token ? { 'x-session-token': token } : {} });

// The same generated allowlist the service consumes — used to assert the
// privacy invariant (stored node_id values ⊆ allowlist ∪ {null}).
const navNodesPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../shared/navigation/navigation-nodes.json',
);

// ── projection / privacy ─────────────────────────────────────────────────────
test('valid event projects to ONLY the allowed columns (no PII keys)', () => {
  const row = projectEvent({
    event_type: 'navigation_item_selected',
    surface: 'mega_menu',
    platform: 'web',
    feature_id: 'admin.ai',
    node_id: 'n-1',
    // hostile extras that must be DROPPED:
    name: 'Jane Doe', email: 'j@x.com', phone: '+263', vin: 'WVW123', token: 'secret',
    url: 'https://x.com/private?token=abc', ip: '1.2.3.4', device_id: 'd-9', tenant_id: 't-1',
    role: 'admin', // client role must be ignored
  }, { roleCategory: 'owner' });

  for (const k of Object.keys(row)) assert.ok(ALLOWED_COLUMNS.has(k), `unexpected column ${k}`);
  for (const k of PII_COLUMNS) assert.equal(row[k], undefined, `PII column ${k} leaked`);
  assert.equal(row.role_category, 'owner'); // trusted, not the client 'admin'
  assert.equal(row.feature_id, 'admin.ai');
});

test('unknown event_type → null (dropped)', () => {
  assert.equal(projectEvent({ event_type: 'totally_made_up', surface: 'mega_menu', platform: 'web' }), null);
});

test('missing/invalid platform → dropped; invalid surface → unknown', () => {
  assert.equal(projectEvent({ event_type: 'navigation_error', surface: 'mega_menu' }), null); // no platform
  const r = projectEvent({ event_type: 'navigation_error', surface: 'evil_surface', platform: 'ios' });
  assert.equal(r.surface, 'unknown');
});

test('non-allowlisted feature_id is nulled (never stored raw)', () => {
  const r = projectEvent({ event_type: 'navigation_item_impression', surface: 'sidebar', platform: 'web', feature_id: 'not.a.real.feature' });
  assert.equal(r.feature_id, null);
});

// ── node_id allowlist (P2 privacy: only a real nav node id is persisted) ──────
const proj = (node_id) => projectEvent({
  event_type: 'navigation_item_selected', surface: 'mega_menu', platform: 'web', node_id,
});

test('KNOWN navigation node id is preserved (allowlisted from NAVIGATION_MANIFEST)', () => {
  _resetAllowlist();
  assert.equal(proj('buy.shop-all').node_id, 'buy.shop-all');
  assert.equal(proj('sell.your-car').node_id, 'sell.your-car');
});

test('UNKNOWN node id is nulled (not a registered nav node)', () => {
  _resetAllowlist();
  assert.equal(proj('totally.made.up.node').node_id, null);
  // A FEATURE id is NOT a nav node id — it must not pass the node_id allowlist.
  assert.equal(proj('product.marketplace').node_id, null);
});

test('PII-looking node_id values are nulled, never persisted', () => {
  _resetAllowlist();
  assert.equal(proj('a@b.com').node_id, null, 'email leaked');
  assert.equal(proj('1HGCM82633A004352').node_id, null, 'VIN leaked');       // 17 alphanum VIN
  assert.equal(proj('+263771234567').node_id, null, 'phone leaked');
  assert.equal(proj('John Doe, 12 Main St').node_id, null, 'free text leaked');
});

test('oversized / malformed node_id is nulled', () => {
  _resetAllowlist();
  assert.equal(proj('x'.repeat(5000)).node_id, null);            // oversized
  assert.equal(proj('   ').node_id, null);                       // whitespace only
  assert.equal(proj(12345).node_id, null);                       // non-string
  assert.equal(proj({ id: 'buy.shop-all' }).node_id, null);      // object
  // An oversized string that merely STARTS with a real id must still be nulled
  // (bounded BEFORE allowlist lookup; the trailing PII can never sneak through).
  assert.equal(proj('buy.shop-all' + 'x'.repeat(5000)).node_id, null);
});

test('valid route-level event with NO node_id persists with node_id null', () => {
  _resetAllowlist();
  const r = projectEvent({ event_type: 'navigation_destination_rendered', surface: 'route_guard', platform: 'web' });
  assert.ok(r, 'event should still be accepted');
  assert.equal(r.node_id, null);
});

// ── route sanitization ───────────────────────────────────────────────────────
test('route sanitization: registered route preserved, raw URL → unregistered', () => {
  assert.equal(sanitizeRoutePattern('/admin/ai'), '/admin/ai'); // registered manifest route
  assert.equal(sanitizeRoutePattern('https://evil.com/steal?token=abc'), 'unregistered');
  assert.equal(sanitizeRoutePattern('/admin/ai?x=1#frag'), '/admin/ai'); // path-prefix match
  assert.equal(sanitizeRoutePattern('/totally/unknown'), 'unregistered');
  assert.equal(sanitizeRoutePattern(null), null);
});

test('coarseRole maps admin variants and ignores unknowns', () => {
  assert.equal(coarseRole('platform_admin'), 'admin');
  assert.equal(coarseRole('owner'), 'owner');
  assert.equal(coarseRole('not_a_role'), 'anonymous');
  assert.equal(coarseRole(null), 'anonymous');
});

// ── ingestBatch ──────────────────────────────────────────────────────────────
test('valid batch ingested: only allowed columns stored, no PII columns', async () => {
  _resetDedupe();
  const client = makeFakeClient();
  const summary = await ingestBatch({
    schemaVersion: 1,
    events: [
      { event_type: 'navigation_surface_opened', surface: 'mega_menu', platform: 'web', email: 'x@y.com' },
      { event_type: 'navigation_item_selected', surface: 'mega_menu', platform: 'web', feature_id: 'admin.ai', vin: 'ABC' },
    ],
  }, { client, req: sessionReq(null) });

  assert.equal(summary.accepted, 2);
  assert.equal(summary.stored, true);
  const stored = client._tables.navigation_analytics_events;
  assert.equal(stored.length, 2);
  for (const row of stored) {
    for (const k of Object.keys(row)) {
      if (k === 'id' || k === 'created_at') continue;
      assert.ok(ALLOWED_COLUMNS.has(k), `stored unexpected column ${k}`);
    }
    for (const p of PII_COLUMNS) assert.equal(row[p], undefined, `PII ${p} stored`);
    assert.equal(row.role_category, 'anonymous'); // no session → anonymous
  }
});

test('MIXED batch: valid node ids persisted, bad/PII node ids nulled; node_id ⊆ allowlist ∪ {null}', async () => {
  _resetDedupe();
  _resetAllowlist();
  const client = makeFakeClient();
  const summary = await ingestBatch({
    schemaVersion: 1,
    events: [
      { event_type: 'navigation_item_selected', surface: 'mega_menu', platform: 'web', node_id: 'buy.shop-all' },     // known → kept
      { event_type: 'navigation_item_selected', surface: 'mega_menu', platform: 'web', node_id: 'sell.your-car' },     // known → kept
      { event_type: 'navigation_item_impression', surface: 'mega_menu', platform: 'web', node_id: 'a@b.com' },         // email → null
      { event_type: 'navigation_item_impression', surface: 'mega_menu', platform: 'web', node_id: '1HGCM82633A004352' }, // VIN → null
      { event_type: 'navigation_item_impression', surface: 'mega_menu', platform: 'web', node_id: '+263771234567' },   // phone → null
      { event_type: 'navigation_item_impression', surface: 'mega_menu', platform: 'web', node_id: 'not.a.node' },      // unknown → null
      { event_type: 'navigation_destination_rendered', surface: 'route_guard', platform: 'web' },                      // no node_id → null
    ],
  }, { client, req: sessionReq(null) });

  assert.equal(summary.accepted, 7);  // every event persists (only node_id is sanitized, not the row)
  assert.equal(summary.stored, true);

  const stored = client._tables.navigation_analytics_events;
  assert.equal(stored.length, 7);

  // Exactly the two known ids survive as node_id; everything else is null.
  const keptNodeIds = stored.map((r) => r.node_id).filter(Boolean).sort();
  assert.deepEqual(keptNodeIds, ['buy.shop-all', 'sell.your-car']);

  // Invariant: every stored node_id is a member of the allowlist OR null —
  // never an arbitrary/PII caller value.
  const allowlist = new Set(JSON.parse(fs.readFileSync(navNodesPath, 'utf8')));
  for (const row of stored) {
    assert.ok(row.node_id === null || allowlist.has(row.node_id), `node_id escaped allowlist: ${row.node_id}`);
  }

  // And no smuggled PII value appears ANYWHERE in the stored rows.
  const blob = JSON.stringify(stored);
  for (const pii of ['a@b.com', '1HGCM82633A004352', '+263771234567', 'not.a.node']) {
    assert.ok(!blob.includes(pii), `PII value ${pii} leaked into stored rows`);
  }
});

test('unknown event_type events are dropped within a batch', async () => {
  _resetDedupe();
  const client = makeFakeClient();
  const summary = await ingestBatch({
    schemaVersion: 1,
    events: [
      { event_type: 'navigation_item_impression', surface: 'sidebar', platform: 'web' },
      { event_type: 'bogus_event', surface: 'sidebar', platform: 'web' },
    ],
  }, { client, req: sessionReq(null) });
  assert.equal(summary.accepted, 1);
  assert.equal(summary.dropped, 1);
  assert.equal(client._tables.navigation_analytics_events.length, 1);
});

test('oversized batch (> MAX) is truncated, not silently accepted whole', async () => {
  _resetDedupe();
  const client = makeFakeClient();
  const events = Array.from({ length: MAX_EVENTS_PER_BATCH + 25 }, () => ({
    event_type: 'navigation_item_impression', surface: 'mega_menu', platform: 'web',
  }));
  const summary = await ingestBatch({ schemaVersion: 1, events }, { client, req: sessionReq(null) });
  assert.equal(summary.tooLarge, true);
  assert.equal(summary.accepted, MAX_EVENTS_PER_BATCH);
  assert.equal(client._tables.navigation_analytics_events.length, MAX_EVENTS_PER_BATCH);
});

test('unknown schemaVersion is rejected (nothing stored)', async () => {
  _resetDedupe();
  const client = makeFakeClient();
  const summary = await ingestBatch({ schemaVersion: 99, events: [{ event_type: 'navigation_error', surface: 'unknown', platform: 'web' }] }, { client, req: sessionReq(null) });
  assert.equal(summary.schemaVersionRejected, true);
  assert.equal(client._tables.navigation_analytics_events.length, 0);
});

test('duplicate dedupe_key handled (skipped within batch + recent window)', async () => {
  _resetDedupe();
  const client = makeFakeClient();
  const summary = await ingestBatch({
    schemaVersion: 1,
    events: [
      { event_type: 'navigation_item_selected', surface: 'mega_menu', platform: 'web', dedupe_key: 'k1' },
      { event_type: 'navigation_item_selected', surface: 'mega_menu', platform: 'web', dedupe_key: 'k1' },
    ],
  }, { client, req: sessionReq(null) });
  assert.equal(summary.accepted, 1);
  assert.equal(summary.duplicates, 1);

  // Same key again in a later batch → duplicate (recent window).
  const second = await ingestBatch({
    schemaVersion: 1,
    events: [{ event_type: 'navigation_item_selected', surface: 'mega_menu', platform: 'web', dedupe_key: 'k1' }],
  }, { client, req: sessionReq(null) });
  assert.equal(second.duplicates, 1);
  assert.equal(second.accepted, 0);
});

test('route-pattern sanitization in ingest: unregistered route stored as "unregistered", never the raw URL', async () => {
  _resetDedupe();
  const client = makeFakeClient();
  await ingestBatch({
    schemaVersion: 1,
    events: [{
      event_type: 'navigation_destination_rendered', surface: 'route_guard', platform: 'web',
      source_route_pattern: 'https://evil.example.com/leak?token=abc',
      destination_route_pattern: '/admin/ai',
    }],
  }, { client, req: sessionReq(null) });
  const row = client._tables.navigation_analytics_events[0];
  assert.equal(row.source_route_pattern, 'unregistered');
  assert.equal(row.destination_route_pattern, '/admin/ai');
  assert.ok(!JSON.stringify(row).includes('evil.example.com'), 'raw URL leaked into stored row');
});

test('role_category derived from trusted session, NOT a client header', async () => {
  _resetDedupe();
  const client = makeFakeClient({
    user_sessions: [{ token: 'tok', user_id: 'u1', active_role: null, active_organization_id: null, is_valid: true, expires_at: new Date(Date.now() + 3600_000).toISOString() }],
    users: [{ id: 'u1', role: 'dealer' }],
  });
  // Client tries to spoof role=admin via the event body; must be ignored.
  await ingestBatch({
    schemaVersion: 1,
    events: [{ event_type: 'navigation_item_selected', surface: 'mega_menu', platform: 'web', role: 'admin', role_category: 'admin' }],
  }, { client, req: { headers: { 'x-session-token': 'tok', 'x-stakeholder-role': 'admin' } } });
  const row = client._tables.navigation_analytics_events[0];
  assert.equal(row.role_category, 'dealer'); // trusted base role, not spoofed admin
});

test('storage failure → ingestion returns success-ish and does NOT throw (nav unaffected)', async () => {
  _resetDedupe();
  const client = makeFakeClient({}, { failTable: 'navigation_analytics_events', failOp: 'insert' });
  let summary;
  await assert.doesNotReject(async () => {
    summary = await ingestBatch({
      schemaVersion: 1,
      events: [{ event_type: 'navigation_item_impression', surface: 'mega_menu', platform: 'web' }],
    }, { client, req: sessionReq(null) });
  });
  assert.equal(summary.accepted, 1);
  assert.equal(summary.stored, false); // storage failed, but we did not throw.
});

// ── aggregates ───────────────────────────────────────────────────────────────
test('getNavigationAggregates computes funnel + zero-selection discovery', async () => {
  const now = new Date().toISOString();
  const client = makeFakeClient({
    navigation_analytics_events: [
      { event_type: 'navigation_item_impression', feature_id: 'admin.ai', surface: 'mega_menu', platform: 'web', role_category: 'admin', occurred_at: now },
      { event_type: 'navigation_item_impression', feature_id: 'admin.evidence', surface: 'mega_menu', platform: 'web', role_category: 'admin', occurred_at: now },
      { event_type: 'navigation_item_selected', feature_id: 'admin.ai', surface: 'mega_menu', platform: 'web', role_category: 'admin', occurred_at: now },
      { event_type: 'navigation_destination_rendered', feature_id: 'admin.ai', surface: 'route_guard', platform: 'web', role_category: 'admin', occurred_at: now },
      { event_type: 'navigation_destination_blocked', feature_id: 'admin.evidence', surface: 'route_guard', platform: 'ios', role_category: 'anonymous', occurred_at: now },
    ],
  });
  const agg = await getNavigationAggregates({ client, from: new Date(Date.now() - 86400000).toISOString(), to: new Date(Date.now() + 86400000).toISOString() });
  assert.equal(agg.ok, true);
  assert.equal(agg.totals.impressions, 2);
  assert.equal(agg.totals.selections, 1);
  assert.equal(agg.totals.destinationRenders, 1);
  assert.equal(agg.totals.blocked, 1);
  assert.equal(agg.selectionThroughRate, 0.5);
  assert.deepEqual(agg.zeroSelectionItems, ['admin.evidence']); // impressed but never selected
  assert.equal(agg.platformSplit.web, 4);
  assert.equal(agg.platformSplit.ios, 1);
});

// ── HTTP routes (express, fake client via DI is service-level; routes use the
//    real supabase, so here we only assert auth guard + fast non-throwing 202) ─
function appWith(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

async function call(app, method, path, { headers = {}, body } = {}) {
  const { createServer } = await import('node:http');
  const server = createServer(app);
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-bypass-rate-limit': 'true', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json };
  } finally {
    server.close();
  }
}

test('POST ingestion returns 202 fast and never errors (nav unaffected)', async () => {
  const app = appWith(navigationAnalyticsRouter);
  const res = await call(app, 'POST', '/api/analytics/navigation', {
    body: { schemaVersion: 1, events: [{ event_type: 'navigation_surface_opened', surface: 'mega_menu', platform: 'web' }] },
  });
  assert.equal(res.status, 202);
  assert.equal(res.json.ok, true);
});

test('POST ingestion rejects unsupported schema version with 400', async () => {
  const app = appWith(navigationAnalyticsRouter);
  const res = await call(app, 'POST', '/api/analytics/navigation', { body: { schemaVersion: 7, events: [] } });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'unsupported_schema_version');
});

test('rate limit returns 429 after N (without bypass header)', async () => {
  const app = appWith(navigationAnalyticsRouter);
  let got429 = false;
  // limiter is max:120/min — fire 130 without the bypass header.
  for (let i = 0; i < 130; i++) {
    const res = await call(app, 'POST', '/api/analytics/navigation', {
      headers: { 'x-bypass-rate-limit': 'false' },
      body: { schemaVersion: 1, events: [] },
    });
    if (res.status === 429) { got429 = true; break; }
  }
  assert.equal(got429, true);
});

test('admin aggregate endpoint denies a non-admin caller', async () => {
  const app = appWith(navigationAnalyticsRouter);
  // No session token → authorizeRole returns 401 (unauthorized, not admin).
  const res = await call(app, 'GET', '/api/admin/analytics/navigation');
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});
