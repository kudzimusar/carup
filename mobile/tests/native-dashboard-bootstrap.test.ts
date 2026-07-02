/**
 * Native Dashboard cold-start bootstrap ordering tests.
 *
 * Pure, DB-free, import-only (no Expo/react-native runtime). Run with:
 *   npx tsx tests/native-dashboard-bootstrap.test.ts
 *
 * Proves the auth-bootstrap → confirmed-anonymous → role-boundary ordering of
 * `resolveDashboardGate` (consumed by app/(tabs)/index.tsx). The native auth
 * store starts loading:true while it restores a saved SecureStore session, so a
 * redirect must wait for bootstrap or an already-signed-in user is ejected on a
 * cold launch / direct Dashboard deep link.
 */
import { strict as assert } from 'node:assert';
import { resolveDashboardGate } from '../navigation/dashboardGate';

let PASSED = 0;
let FAILED = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    PASSED++;
    console.log(`[PASS] ${name}`);
  } catch (e) {
    FAILED++;
    console.log(`[FAIL] ${name}: ${(e as Error).message}`);
  }
}

test('loading=true + role=null does NOT redirect (renders loading)', () => {
  assert.equal(resolveDashboardGate({ loading: true, role: null }).kind, 'loading');
});

test('loading=true + saved session pending (role still null) → loading', () => {
  // SecureStore restore in flight: loading true, role not yet available.
  assert.equal(resolveDashboardGate({ loading: true, role: null }).kind, 'loading');
});

test('bootstrap wins: loading=true even with a momentary role → loading', () => {
  assert.equal(resolveDashboardGate({ loading: true, role: 'owner' }).kind, 'loading');
});

test('loading=false + role=null → redirect to /login', () => {
  const g = resolveDashboardGate({ loading: false, role: null });
  assert.equal(g.kind, 'redirect');
  assert.equal(g.kind === 'redirect' && g.to, '/login');
});

test('loading=false + owner role uses owner.overview', () => {
  const g = resolveDashboardGate({ loading: false, role: 'owner' });
  assert.equal(g.kind, 'boundary');
  assert.equal(g.kind === 'boundary' && g.featureId, 'owner.overview');
});

test('loading=false + dealer role uses dealer.overview', () => {
  const g = resolveDashboardGate({ loading: false, role: 'dealer' });
  assert.equal(g.kind, 'boundary');
  assert.equal(g.kind === 'boundary' && g.featureId, 'dealer.overview');
});

test('auth-loading guard executes BEFORE the anonymous redirect', () => {
  // loading=true + role=null must be 'loading' (guard first), never 'redirect' —
  // i.e. a cold-launch signed-in user is never ejected mid-restore.
  const g = resolveDashboardGate({ loading: true, role: null });
  assert.equal(g.kind, 'loading');
  assert.notEqual(g.kind, 'redirect');
});

test('role-owned boundary resolves a real manifest route', () => {
  const g = resolveDashboardGate({ loading: false, role: 'owner' });
  assert.equal(g.kind, 'boundary');
  assert.ok(g.kind === 'boundary' && typeof g.route === 'string' && g.route.length > 0);
});

console.log(`\n${PASSED} passed, ${FAILED} failed.`);
if (FAILED === 0) {
  console.log('ALL NATIVE DASHBOARD BOOTSTRAP TESTS PASSED');
} else {
  process.exit(1);
}
