import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '..');

function source(relative) {
  return fs.readFileSync(path.resolve(BACKEND, relative), 'utf8');
}

function routeBlock(routes, routePath) {
  const marker = `router.post('${routePath}'`;
  const start = routes.indexOf(marker);
  assert.ok(start >= 0, `missing route ${routePath}`);
  const next = routes.indexOf('\nrouter.', start + marker.length);
  return routes.slice(start, next >= 0 ? next : routes.length);
}

const GOVERNANCE_ROUTES = [
  '/api/escrow/:id/release/approve',
  '/api/escrow/:id/release',
  '/api/escrow/:id/release/recover',
  '/api/escrow/:id/refund',
];

function wrapperFailsClosed(text) {
  return /export function authorizeSessionRole\(allowedRoles = \[\]\)\s*\{\s*return authorizeRole\(allowedRoles, \{ allowUserIdFallback: false \}\);\s*\}/s.test(text);
}

function routeRequiresSession(block) {
  return /authorizeSessionRole\(\['admin', 'reviewer'\]\)/.test(block)
    && !/authorizeRole\(\['admin', 'reviewer'\]\)/.test(block);
}

test('Phase 6 consequential financial governance rejects x-user-id fallback by construction', () => {
  const auth = source('middleware/authMiddleware.js');
  const routes = source('routes/escrowTrustRoutes.js');

  assert.equal(wrapperFailsClosed(auth), true, 'session-only wrapper must pin x-user-id fallback off');
  for (const routePath of GOVERNANCE_ROUTES) {
    assert.equal(
      routeRequiresSession(routeBlock(routes, routePath)),
      true,
      `${routePath} must require a validated session`,
    );
  }
});

test('Phase 6 mutation M29 — release governance cannot fall back to generic x-user-id-capable auth', () => {
  const auth = source('middleware/authMiddleware.js');
  const authMutant = auth.replace(
    'return authorizeRole(allowedRoles, { allowUserIdFallback: false });',
    'return authorizeRole(allowedRoles, { allowUserIdFallback: true });',
  );
  assert.notEqual(authMutant, auth, 'M29a mutation did not match session wrapper');
  assert.equal(wrapperFailsClosed(auth), true);
  assert.equal(wrapperFailsClosed(authMutant), false, 'M29a mutant survived');

  const routes = source('routes/escrowTrustRoutes.js');
  for (const routePath of GOVERNANCE_ROUTES) {
    const originalBlock = routeBlock(routes, routePath);
    const mutantBlock = originalBlock.replace('authorizeSessionRole(', 'authorizeRole(');
    assert.notEqual(mutantBlock, originalBlock, `M29b mutation did not match ${routePath}`);
    assert.equal(routeRequiresSession(originalBlock), true);
    assert.equal(routeRequiresSession(mutantBlock), false, `M29b mutant survived for ${routePath}`);
  }
});
