/**
 * Service Network — adversarial authentication.
 *
 * The threat is concrete and has happened here before: `x-user-id` is a plain request header, and
 * `authorizeRole()` accepts it as an identity whenever `isUserIdFallbackAllowed()` says so. CarUp
 * has already run NODE_ENV=test inside a Vercel PRODUCTION environment, which turned that header
 * into a working identity — including admin. One mis-set variable was enough.
 *
 * `authorizeSessionRole()` is `authorizeRole(roles, { allowUserIdFallback: false })`: it refuses the
 * header outright, whatever the environment says. Every consequential Service Network route must
 * compose it, so a private garage workspace does not depend on one variable being right.
 *
 * These tests run the REAL middleware against the REAL mounted routes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const { app } = await import('../server.js');
const { authorizeSessionRole, authorizeRole, isUserIdFallbackAllowed } = await import('../middleware/authMiddleware.js');

/** Every consequential Service Network endpoint, as mounted. */
const CONSEQUENTIAL = [
  // case creation and actions
  ['post', '/api/service-cases'],
  ['get', '/api/service-cases/mine'],
  ['get', '/api/service-cases/:caseId'],
  ['post', '/api/service-cases/:caseId/accept'],
  ['post', '/api/service-cases/:caseId/decline'],
  ['post', '/api/service-cases/:caseId/start'],
  ['post', '/api/service-cases/:caseId/complete'],
  ['post', '/api/service-cases/:caseId/cancel'],
  // garage private queue and customer records
  ['get', '/api/garage/queue'],
  ['get', '/api/garage/customers'],
  ['get', '/api/garage/mechanics'],
  ['get', '/api/garage/service-cases'],
  // mechanic assignment and work-order status
  ['post', '/api/service-cases/:caseId/work-order'],
  ['get', '/api/service-work-orders/:workOrderId/assignment'],
  ['post', '/api/service-work-orders/:workOrderId/assign'],
  ['post', '/api/service-work-orders/:workOrderId/unassign'],
  ['patch', '/api/service-work-orders/:workOrderId/status'],
  // service records
  ['post', '/api/service-work-orders/:workOrderId/records'],
  ['get', '/api/service-records/:recordId'],
  ['post', '/api/service-records/:recordId/mileage'],
  ['post', '/api/service-records/:recordId/parts'],
  ['post', '/api/service-records/:recordId/evidence'],
  // capability grant / redeem / revoke, and minting a permanent public address
  ['post', '/api/service-links'],
  ['post', '/api/service-capabilities'],
  ['post', '/api/service-capabilities/redeem'],
  ['delete', '/api/service-capabilities/:grantId'],
  // private garage profile mutations
  ['get', '/api/garage/profile'],
  ['put', '/api/garage/profile'],
  ['post', '/api/garage/profile/publish'],
  ['post', '/api/garage/profile/unpublish'],
  ['post', '/api/garage/branches'],
  ['delete', '/api/garage/branches/:branchId'],
];

/** Genuinely public surfaces that must STAY reachable without a session. */
const PUBLIC_SURFACES = [
  ['get', '/api/garage-directory'],
  ['get', '/api/garage-directory/:slug'],
  ['get', '/api/service-links/:publicToken'],
];

/**
 * Find a route in the LIVE stack, recursing into mounted sub-routers.
 *
 * Service Network routers are mounted with `app.use(router)` and declare absolute paths, so the
 * route lives one level down from the app stack rather than on it.
 */
function findRoute(method, path) {
  const search = (stack) => {
    for (const layer of stack || []) {
      if (layer.route?.path === path && layer.route.methods?.[method]) return layer.route;
      if (layer.name === 'router' && layer.handle?.stack) {
        const found = search(layer.handle.stack);
        if (found) return found;
      }
    }
    return null;
  };
  return search(app._router?.stack || app.router?.stack);
}

/** Run a route's middleware chain (excluding its final handler) and capture the outcome. */
async function runGate(route, req) {
  const captured = { statusCode: null, body: null, reachedHandler: false };
  const res = {
    status(code) { captured.statusCode = code; return res; },
    json(payload) { captured.body = payload; return res; },
  };
  const middlewares = route.stack.slice(0, -1).map((l) => l.handle);
  for (const middleware of middlewares) {
    let advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const next = () => { advanced = true; resolve(); };
      const maybe = middleware(req, res, next);
      if (maybe && typeof maybe.then === 'function') maybe.then(resolve, resolve);
      else if (!advanced) setImmediate(resolve);
    });
    if (captured.statusCode !== null) return captured;
    if (!advanced) return captured;
  }
  captured.reachedHandler = true;
  return captured;
}

const forgedRequest = (over = {}) => ({
  headers: { 'x-user-id': 'attacker-user-id', ...(over.headers || {}) },
  params: {},
  query: {},
  body: {},
  ...over,
});

test('adversarial: the x-user-id fallback IS open in this environment — the tests below are meaningful', () => {
  // If the fallback were closed here, every assertion in this file would pass vacuously.
  assert.equal(isUserIdFallbackAllowed({ NODE_ENV: 'test' }), true,
    'NODE_ENV=test opens the header fallback, which is exactly the condition these routes must survive');
  // And it is genuinely closed in a production deployment, whatever NODE_ENV says.
  assert.equal(isUserIdFallbackAllowed({ NODE_ENV: 'test', VERCEL_ENV: 'production' }), false);
});

/**
 * The refusal that proves the header was REJECTED rather than merely unresolvable.
 *
 * A 401 alone is not evidence here. With no reachable database `authorizeRole` also answers 401 —
 * but with "User record not found", because it ACCEPTED the forged header as an identity and only
 * failed looking that user up. Against a real database and a real user id it would have succeeded.
 * `authorizeSessionRole` never gets that far, and says so. Asserting the message is what makes this
 * test able to fail: a mutation reverting one route to `authorizeRole` passes a status-only check.
 */
const SESSION_REQUIRED = /requires an authenticated session/i;

test('adversarial: a forged x-user-id cannot perform ANY consequential Service Network action', async () => {
  const breached = [];
  for (const [method, path] of CONSEQUENTIAL) {
    const route = findRoute(method, path);
    assert.ok(route, `${method.toUpperCase()} ${path} is not mounted`);
    // eslint-disable-next-line no-await-in-loop
    const outcome = await runGate(route, forgedRequest());
    const refusedTheHeader = outcome.statusCode === 401 && SESSION_REQUIRED.test(String(outcome.body?.error || ''));
    if (!refusedTheHeader) {
      breached.push(`${method.toUpperCase()} ${path} -> ${outcome.statusCode ?? (outcome.reachedHandler ? 'REACHED HANDLER' : 'no decision')}: ${outcome.body?.error || '(no message)'}`);
    }
  }
  assert.deepEqual(breached, [],
    `these consequential routes did not REFUSE the spoofable header outright:\n  ${breached.join('\n  ')}`);
});

test('adversarial: a forged x-user-id claiming an elevated role is still refused', async () => {
  const breached = [];
  for (const [method, path] of CONSEQUENTIAL) {
    const route = findRoute(method, path);
    // eslint-disable-next-line no-await-in-loop
    const outcome = await runGate(route, forgedRequest({
      headers: { 'x-user-id': 'attacker', 'x-stakeholder-role': 'admin', 'x-tenant-id': 'victim-tenant' },
    }));
    if (!(outcome.statusCode === 401 && SESSION_REQUIRED.test(String(outcome.body?.error || '')))) {
      breached.push(`${method.toUpperCase()} ${path} -> ${outcome.statusCode}: ${outcome.body?.error || ''}`);
    }
  }
  assert.deepEqual(breached, [], `role/tenant headers were honoured without a session:\n  ${breached.join('\n  ')}`);
});

test('adversarial: no session at all is refused on every consequential route', async () => {
  const breached = [];
  for (const [method, path] of CONSEQUENTIAL) {
    const route = findRoute(method, path);
    // eslint-disable-next-line no-await-in-loop
    const outcome = await runGate(route, { headers: {}, params: {}, query: {}, body: {} });
    if (outcome.statusCode !== 401) breached.push(`${method.toUpperCase()} ${path} -> ${outcome.statusCode}`);
  }
  assert.deepEqual(breached, [], `anonymous callers reached:\n  ${breached.join('\n  ')}`);
});

test('adversarial: genuinely public surfaces stay public', async () => {
  for (const [method, path] of PUBLIC_SURFACES) {
    const route = findRoute(method, path);
    assert.ok(route, `${method.toUpperCase()} ${path} is not mounted`);
    // eslint-disable-next-line no-await-in-loop
    const outcome = await runGate(route, { headers: {}, params: {}, query: {}, body: {} });
    assert.notEqual(outcome.statusCode, 401,
      `${path} must not require a login — scanning a sticker and browsing the directory are open`);
  }
});

test('adversarial: every consequential route composes authorizeSessionRole in source', () => {
  // The runtime checks above prove the behaviour; this pins the mechanism, so a future refactor
  // that reintroduces authorizeRole on a private route fails here with a readable reason.
  const ROUTE_FILES = [
    'garageDirectoryRoutes', 'serviceCaseRoutes', 'serviceWorkOrderRoutes',
    'serviceRecordRoutes', 'serviceLinkRoutes', 'garageQueueRoutes',
  ];
  for (const file of ROUTE_FILES) {
    const source = readFileSync(new URL(`../routes/${file}.js`, import.meta.url), 'utf8');
    // No CALL to authorizeRole( may remain — comments naming it are fine and are excluded.
    const code = source.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code, /[^a-zA-Z]authorizeRole\s*\(/,
      `${file} still calls authorizeRole; consequential Service Network routes use authorizeSessionRole`);
  }
});

test('adversarial: authorizeSessionRole genuinely refuses the fallback that authorizeRole allows', async () => {
  // The two differ by exactly one option. Prove the difference is real rather than assumed.
  const permissive = authorizeRole(['admin']);
  const strict = authorizeSessionRole(['admin']);

  const runOne = async (middleware) => {
    const captured = { statusCode: null, body: null };
    const res = { status(c) { captured.statusCode = c; return res; }, json(b) { captured.body = b; return res; } };
    await middleware(forgedRequest(), res, () => {});
    return captured;
  };

  const strictOutcome = await runOne(strict);
  assert.equal(strictOutcome.statusCode, 401);
  assert.match(String(strictOutcome.body?.error || ''), /requires an authenticated session/i);

  // The permissive one gets FURTHER — it accepts the header as an identity and fails later, on the
  // user lookup. That is the gap; it is why the strict variant is required on these routes.
  const permissiveOutcome = await runOne(permissive);
  assert.notEqual(
    String(permissiveOutcome.body?.error || ''),
    String(strictOutcome.body?.error || ''),
    'authorizeRole and authorizeSessionRole must not behave identically, or the hardening is a no-op',
  );
});
