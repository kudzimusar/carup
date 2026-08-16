/**
 * Backend CSRF + CORS flow tests for the Diaspora import-order submission path.
 *
 * Reproduces and locks down the production bug: a CSRF token must be BOUND to the same
 * (userId, sessionToken) the unsafe request carries. A guest-bound token fetched anonymously is
 * rejected once the authenticated POST presents the real user/session — which is exactly what
 * happened on https://carup.vercel.app/diaspora.
 *
 * Mounts the REAL csrfMiddleware + REAL cors(corsOptions) on a minimal app driven over HTTP.
 * Only Supabase is neutralized (the CSRF-failure audit path is fire-and-forget).
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-csrf-secret-key';

const express = (await import('express')).default;
const cors = (await import('cors')).default;
const { corsOptions } = await import('../config/corsOptions.js');
const { csrfMiddleware, generateCsrfToken, verifyCsrfToken } = await import('../middleware/securityMiddleware.js');
const { supabase } = await import('../db/supabase.js');

// Neutralize Supabase so the CSRF-failure audit logger never touches the network.
function makeStub() {
  const stub = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'is', 'in', 'order', 'range', 'limit', 'single', 'maybeSingle']) {
    stub[m] = () => stub;
  }
  stub.then = (resolve) => resolve({ data: null, error: null });
  return stub;
}
supabase.from = () => makeStub();

let server;
let baseUrl;

before(async () => {
  const app = express();
  // Mirror server.js wiring exactly.
  app.options(/.*/, cors(corsOptions), (req, res) => res.sendStatus(204));
  app.use(cors(corsOptions));
  app.use(express.json());

  // Mirror server.js GET /api/security/csrf-token (token bound to the caller's identity).
  app.get('/api/security/csrf-token', (req, res) => {
    const sessionToken = req.headers['x-session-token'] || req.headers['authorization']?.replace('Bearer ', '');
    const currentUserId = req.headers['x-user-id'] || 'guest';
    res.json({ csrfToken: generateCsrfToken(currentUserId, sessionToken) });
  });

  app.use(csrfMiddleware);
  app.post('/api/diaspora/import-orders', (req, res) => res.status(201).json({ id: 'dio-1001', status: 'IMPORT_REQUESTED' }));

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  supabase.from = () => makeStub();
});

const BUYER = { 'x-user-id': 'buyer-1', 'x-session-token': 'sess-1' };

async function getCsrfToken(identity = BUYER) {
  const res = await fetch(`${baseUrl}/api/security/csrf-token`, { headers: identity });
  assert.equal(res.ok, true);
  return (await res.json()).csrfToken;
}

async function createOrder(headers) {
  const res = await fetch(`${baseUrl}/api/diaspora/import-orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-verify-csrf': 'true', ...headers },
    body: JSON.stringify({ order_type: 'vehicle' }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// --- Token binding (root cause) ---------------------------------------------

test('a token is valid only for the identity it was bound to', () => {
  const token = generateCsrfToken('buyer-1', 'sess-1');
  assert.equal(verifyCsrfToken(token, 'buyer-1', 'sess-1'), true);
  // The production bug: a guest-bound token fails for an authenticated user.
  const guestToken = generateCsrfToken('guest', undefined);
  assert.equal(verifyCsrfToken(guestToken, 'buyer-1', 'sess-1'), false);
});

// --- Order creation through the middleware ----------------------------------

test('order creation FAILS (403) when the x-csrf-token header is absent', async () => {
  const { status, body } = await createOrder({ ...BUYER });
  assert.equal(status, 403);
  assert.match(body.error, /CSRF/i);
});

test('order creation FAILS (403) with a guest-bound token (reproduces the prod bug)', async () => {
  // Token fetched anonymously (guest) but the POST carries the authenticated identity.
  const guestToken = await getCsrfToken({});
  const { status, body } = await createOrder({ ...BUYER, 'x-csrf-token': guestToken });
  assert.equal(status, 403);
  assert.match(body.error, /CSRF/i);
});

test('order creation SUCCEEDS (201) when a correctly-bound token is present', async () => {
  // Fetch the token with the SAME identity headers the POST will send (the fix).
  const token = await getCsrfToken(BUYER);
  const { status, body } = await createOrder({ ...BUYER, 'x-csrf-token': token });
  assert.equal(status, 201);
  assert.equal(body.id, 'dio-1001');
});

// --- CORS preflight ---------------------------------------------------------

test('CORS preflight from carup.vercel.app allows x-csrf-token and the auth headers, with credentials', async () => {
  const requested = 'x-csrf-token,x-session-token,x-user-id,x-stakeholder-role,x-tenant-id';
  const res = await fetch(`${baseUrl}/api/diaspora/import-orders`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://carup.vercel.app',
      'access-control-request-method': 'POST',
      'access-control-request-headers': requested,
    },
  });

  assert.ok(res.status === 204 || res.status === 200, `preflight status ${res.status}`);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://carup.vercel.app');
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true');

  const allowHeaders = (res.headers.get('access-control-allow-headers') || '').toLowerCase();
  for (const h of ['x-csrf-token', 'x-session-token', 'x-user-id', 'x-stakeholder-role', 'x-tenant-id']) {
    assert.ok(allowHeaders.includes(h), `preflight must allow ${h} (got: ${allowHeaders})`);
  }
});

test('CORS preflight from the canonical carup.dev origin allows x-csrf-token and the auth headers, with credentials', async () => {
  const requested = 'x-csrf-token,x-session-token,x-user-id,x-stakeholder-role,x-tenant-id';
  const res = await fetch(`${baseUrl}/api/diaspora/import-orders`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://carup.dev',
      'access-control-request-method': 'POST',
      'access-control-request-headers': requested,
    },
  });

  assert.ok(res.status === 204 || res.status === 200, `preflight status ${res.status}`);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://carup.dev');
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true');

  const allowHeaders = (res.headers.get('access-control-allow-headers') || '').toLowerCase();
  for (const h of ['x-csrf-token', 'x-session-token', 'x-user-id', 'x-stakeholder-role', 'x-tenant-id']) {
    assert.ok(allowHeaders.includes(h), `preflight must allow ${h} (got: ${allowHeaders})`);
  }
});

test('CORS rejects a disallowed origin (no allow-origin header)', async () => {
  const res = await fetch(`${baseUrl}/api/security/csrf-token`, {
    headers: { origin: 'https://evil.example.com' },
  });
  // Request still completes, but no CORS grant is issued to the bad origin.
  assert.notEqual(res.headers.get('access-control-allow-origin'), 'https://evil.example.com');
});
