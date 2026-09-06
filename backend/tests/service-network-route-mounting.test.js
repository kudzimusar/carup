/**
 * Service Network — RUNTIME route-mounting gate.
 *
 * Why this file exists
 * --------------------
 * The post-#194 reconciliation resolved backend/server.js by taking main's side wholesale. That
 * silently deleted six `app.use(...)` mounts. The server still booted; all 34 Service Network
 * endpoints simply returned 404. Meanwhile the entire Service Network suite stayed green — 184/184
 * — because every one of its 21 files imports services DIRECTLY. Not one booted the app.
 *
 * A test that imports a service proves the service works. It proves nothing about whether the
 * running application can reach it. This file closes that gap by booting the REAL Express app and
 * walking its LIVE router stack. It asserts registration, never source text: commenting a mount out
 * while leaving the import in place must fail here.
 *
 * NODE_ENV=test suppresses server.js's listener, so importing it binds no port.
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

/** Walk the live Express router stack and return every registered "METHOD /path". */
function mountedRoutes(application) {
  const found = new Set();
  const walk = (stack, prefix = '') => {
    for (const layer of stack || []) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods || {}).filter((m) => layer.route.methods[m]);
        for (const method of methods) found.add(`${method.toUpperCase()} ${prefix}${layer.route.path}`);
      } else if (layer.name === 'router' && layer.handle?.stack) {
        let mount = '';
        if (layer.regexp && !layer.regexp.fast_slash) {
          mount = layer.regexp.source
            .replace('^\\/', '/')
            .replace('\\/?(?=\\/|$)', '')
            .replace(/\\\//g, '/')
            .replace(/\$$/, '')
            .replace(/\?\(\?=\/\|\$\)/g, '');
        }
        walk(layer.handle.stack, prefix + mount);
      }
    }
  };
  walk(application._router?.stack || application.router?.stack);
  return found;
}

const MOUNTED = mountedRoutes(app);

/**
 * The declared surface is derived from the route files themselves rather than hard-coded, so a new
 * endpoint that is never mounted fails here the day it is added. The explicit per-family
 * expectations below then keep the failure legible when a whole router disappears.
 */
const ROUTER_FILES = [
  'garageDirectoryRoutes',
  'serviceCaseRoutes',
  'serviceWorkOrderRoutes',
  'serviceRecordRoutes',
  'serviceLinkRoutes',
  'garageQueueRoutes',
];

function declaredIn(routerFile) {
  const source = readFileSync(new URL(`../routes/${routerFile}.js`, import.meta.url), 'utf8');
  const declarations = /router\.(get|post|put|patch|delete)\(\s*[`'"]([^`'"]+)[`'"]/g;
  const routes = [];
  let match;
  while ((match = declarations.exec(source))) routes.push(`${match[1].toUpperCase()} ${match[2]}`);
  return routes;
}

test('runtime: the Service Network surface is actually mounted, not merely declared', () => {
  const declared = ROUTER_FILES.flatMap(declaredIn);
  declared.push('GET /api/service-history/me'); // S6 owner projection, mounted in server.js itself

  assert.ok(declared.length >= 34, `expected the full declared surface, found ${declared.length}`);

  const missing = declared.filter((route) => !MOUNTED.has(route));
  assert.deepEqual(missing, [], `Service Network endpoints declared but NOT mounted:\n  ${missing.join('\n  ')}`);

  // The headline number the reconciliation audit reported as 0.
  const serviceNetworkMounted = declared.filter((route) => MOUNTED.has(route));
  assert.ok(serviceNetworkMounted.length > 0, 'SERVICE NETWORK mounted paths must be > 0');
  assert.equal(serviceNetworkMounted.length, declared.length);
});

test('runtime: every Service Network router family is represented in the live stack', () => {
  // One representative per family. If server.js takes main's side again, each of these fails with
  // the family name in the message rather than a single opaque count mismatch.
  const REPRESENTATIVES = {
    'garage directory': 'GET /api/garage-directory',
    'garage profile (private)': 'PUT /api/garage/profile',
    'garage queue': 'GET /api/garage/queue',
    'garage customers': 'GET /api/garage/customers',
    'garage members': 'GET /api/garage/mechanics',
    'service case': 'POST /api/service-cases',
    'service case lifecycle': 'POST /api/service-cases/:caseId/accept',
    'service work order': 'POST /api/service-work-orders/:workOrderId/assign',
    'work order status': 'PATCH /api/service-work-orders/:workOrderId/status',
    'service record': 'POST /api/service-work-orders/:workOrderId/records',
    'service record parts': 'POST /api/service-records/:recordId/parts',
    'service link': 'POST /api/service-links',
    'service link public resolve': 'GET /api/service-links/:publicToken',
    'service capability grant': 'POST /api/service-capabilities',
    'service capability redeem': 'POST /api/service-capabilities/redeem',
    'service capability revoke': 'DELETE /api/service-capabilities/:grantId',
    'owner service history': 'GET /api/service-history/me',
  };

  const unmounted = Object.entries(REPRESENTATIVES)
    .filter(([, route]) => !MOUNTED.has(route))
    .map(([family, route]) => `${family} -> ${route}`);

  assert.deepEqual(unmounted, [], `Service Network router families NOT mounted:\n  ${unmounted.join('\n  ')}`);
});

test('runtime: mounting the Service Network did not displace the post-#194 surface', () => {
  // The converse failure: restoring #197 by taking ITS side of server.js wholesale would unmount
  // everything main added. Both directions of the same merge mistake are guarded here.
  const POST_194_SURFACE = [
    'GET /api/service-history/me',
    'POST /api/vehicles/:vin/evidence',
    'GET /api/marketplace/listings',
  ];
  for (const route of POST_194_SURFACE) {
    if (MOUNTED.has(route)) continue;
    // Only assert on routes that genuinely exist in this tree, so the guard cannot rot into a
    // false failure if an unrelated lane legitimately renames one.
    assert.ok(
      [...MOUNTED].some((mounted) => mounted.split(' ')[1] === route.split(' ')[1]),
      `post-#194 route disappeared from the live stack: ${route}`,
    );
  }

  // A blunt but effective floor: the reconciled app carries both sides' routers.
  assert.ok(MOUNTED.size > 600, `expected the full merged route surface, found ${MOUNTED.size}`);
});
