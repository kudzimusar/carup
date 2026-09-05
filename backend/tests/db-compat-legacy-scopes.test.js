/**
 * Database-contract audit — legacy server.js endpoint scope/privacy pins.
 *
 * 1. GET /api/vehicles/:vin/completeness had NO ownership check: any owner-role
 *    session could enumerate any VIN's identity-document state. Non-admin/
 *    non-reviewer callers must now pass the same owner_id/tenant_id scope rule
 *    as vehiclesRoutes' loadScopedVehicle.
 * 2. GET /api/vehicles/saved embedded vehicles(*) — leaking engine/chassis/
 *    plate/owner_id of vehicles the caller does not own. The embed must use the
 *    sanitized PUBLIC_VEHICLE_COLUMNS projection.
 *
 * Source-contract assertions (the repo's established pattern for
 * infrastructure-coupled server.js guards).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serverSrc = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('completeness endpoint is ownership-scoped for non-admin/non-reviewer sessions', () => {
  const routeIdx = serverSrc.indexOf("app.get('/api/vehicles/:vin/completeness'");
  assert.ok(routeIdx > -1, 'completeness route must exist');
  const section = serverSrc.slice(routeIdx, serverSrc.indexOf('evaluateCompleteness(vin)', routeIdx));

  assert.match(
    section,
    /role !== 'admin' && req\.userContext\.role !== 'reviewer'/,
    'only admin/reviewer may read any VIN; everyone else is scope-checked',
  );
  assert.ok(
    section.includes("select('owner_id, current_seller_id, tenant_id')"),
    'the scope check must resolve VIN owner/current-seller/tenant authority',
  );
  assert.match(
    section,
    /owner_id === req\.userContext\.id/,
    'owner match must key on the session identity',
  );
  assert.match(
    section,
    /current_seller_id === req\.userContext\.id/,
    'current-seller match must key on the session identity',
  );
  assert.match(
    section,
    /tenant_id === req\.userContext\.tenantId/,
    'tenant match must key on the session tenant',
  );
  assert.match(
    section,
    /status\(403\)/,
    'out-of-scope reads must be rejected with 403',
  );
});

test('saved-vehicles list embeds only the sanitized public vehicle projection', () => {
  const routeIdx = serverSrc.indexOf("app.get('/api/vehicles/saved'");
  assert.ok(routeIdx > -1, 'saved-vehicles route must exist');
  const section = serverSrc.slice(routeIdx, serverSrc.indexOf("app.post('/api/vehicles/saved/add'"));

  assert.ok(
    section.includes('vehicles(${PUBLIC_VEHICLE_COLUMNS})'),
    'the embed must use the sanitized PUBLIC_VEHICLE_COLUMNS projection',
  );
  assert.ok(
    !section.includes('vehicles(*)'),
    'raw vehicles(*) embed leaks engine/chassis/plate/owner_id of other sellers',
  );
});
