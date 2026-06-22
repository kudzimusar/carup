/**
 * Gate T10 — Trade Graph route-isolation / no-shadowing regression.
 *
 * Repeats the SafeTrade route-shadowing lesson: the Trade Graph router carries a blanket
 * `router.use()` feature-gate that 404s when DIASPORA_TRADE_GRAPH is off (the default). It is
 * mounted UNDER the '/trade-graph' prefix in diasporaRoutes.js, so that gate is scoped to the
 * '/trade-graph' surface and MUST NOT shadow sibling diaspora routes. This test drives the REAL
 * diaspora router over HTTP with the gate OFF and proves every named sibling feature still reaches
 * its own handler (never the Trade Graph "not enabled" 404), while /trade-graph/* is correctly inert.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
// Both feature gates remain OFF (default). The Trade Graph 404 body is the discriminator below.
delete process.env.DIASPORA_TRADE_GRAPH;
delete process.env.DIASPORA_SAFETRADE_ENABLED;

const express = (await import('express')).default;
const diasporaRouter = (await import('../routes/diasporaRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');

// Minimal Supabase mock so the auth middleware behaves normally (no real DB).
function makeBuilder(table) {
  const state = { table, single: false, filters: {} };
  const chain = {
    select() { return chain }, insert() { return chain }, update() { return chain }, delete() { return chain },
    eq(k, v) { state.filters[k] = v; return chain }, neq() { return chain }, is() { return chain },
    in() { return chain }, or() { return chain }, order() { return chain }, range() { return chain },
    limit() { return chain }, gte() { return chain }, lte() { return chain }, not() { return chain },
    single() { state.single = true; return chain }, maybeSingle() { state.single = true; return chain },
    then(resolve, reject) {
      try { return Promise.resolve(resolve_(state)).then(resolve, reject) } catch (e) { return reject ? reject(e) : Promise.reject(e) }
    },
  };
  return chain;
}
function resolve_(state) {
  const missing = (msg) => ({ data: null, error: { message: msg, code: 'PGRST116' } });
  if (state.table === 'user_sessions') return missing('no session (test uses x-user-id fallback)');
  if (state.table === 'users') return missing('user not found'); // unauthenticated probes only
  if (state.table === 'tenant_users') return missing('no membership');
  return state.single ? { data: { id: 'mock' }, error: null } : { data: [], error: null };
}

let server; let baseUrl;
before(async () => {
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => makeBuilder(t) });
  Object.defineProperty(supabase, 'rpc', { configurable: true, writable: true, value: async () => ({ data: null, error: { message: 'DIASPORA_TEST/GATE_PASSED' } }) });
  const app = express();
  app.use(express.json());
  app.use('/api/diaspora', diasporaRouter);
  app.use(errorHandler);
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

async function req(method, path) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: { 'content-type': 'application/json' } });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}
const TRADE_GRAPH_DISABLED = 'Trade Graph is not enabled';
const notShadowed = (r) => !(r.status === 404 && r.body && r.body.error === TRADE_GRAPH_DISABLED);

// Representative route per named sibling feature (unauthenticated → reaches its own handler/gate).
const SIBLINGS = [
  ['stock', 'POST', '/api/diaspora/stock'],
  ['rfq', 'GET', '/api/diaspora/rfqs'],
  ['buyer-orders', 'GET', '/api/diaspora/buyer-orders'],
  ['ai-commands', 'POST', '/api/diaspora/ai-commands'],
  ['containers', 'GET', '/api/diaspora/container-marketplace/containers'],
  ['reservations', 'GET', '/api/diaspora/container-marketplace/reservations'],
  ['shipments', 'GET', '/api/diaspora/shipments'],
  ['ocr/documents', 'GET', '/api/diaspora/trade-documents'],
  ['subscription', 'GET', '/api/diaspora/subscription/plans'],
  ['workbook', 'GET', '/api/diaspora/workbook/template-schema'],
];

for (const [name, method, path] of SIBLINGS) {
  test(`Trade-Graph-OFF does not shadow sibling: ${name} (${method} ${path})`, async () => {
    const r = await req(method, path);
    assert.ok(notShadowed(r), `${name} was shadowed by the Trade Graph gate (got 404 "${TRADE_GRAPH_DISABLED}")`);
  });
}

test('Trade-Graph-OFF does not shadow SafeTrade (its OWN gate answers, not Trade Graph)', async () => {
  const r = await req('GET', '/api/diaspora/safetrade');
  assert.ok(notShadowed(r), 'SafeTrade was shadowed by the Trade Graph gate');
  // SafeTrade is also disabled by default → its own gate returns 404 with its OWN message.
  if (r.status === 404 && r.body && r.body.error) {
    assert.notEqual(r.body.error, TRADE_GRAPH_DISABLED);
  }
});

test('Trade Graph gate is correctly inert (scoped) when DIASPORA_TRADE_GRAPH is off', async () => {
  const r = await req('GET', '/api/diaspora/trade-graph/risk/exposure');
  assert.equal(r.status, 404);
  assert.equal(r.body && r.body.error, TRADE_GRAPH_DISABLED);
});
