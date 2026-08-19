import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function source(relative) {
  return fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
}

function captureRoute(text) {
  const start = text.indexOf("router.post('/api/escrow/:id/sandbox/capture'");
  const end = text.indexOf("router.post('/api/escrow/:id/payment/reconcile'", start);
  assert.ok(start >= 0 && end > start, 'sandbox capture route missing');
  return text.slice(start, end);
}

test('Phase 6: sandbox capture authority is buyer-owned consistently at router and service', () => {
  const routes = source('routes/escrowTrustRoutes.js');
  const route = captureRoute(routes);
  const service = source('services/transaction/marketplacePaymentService.js');
  const helperStart = service.indexOf('async function assertFreshSandboxCaptureAuthority');
  const helperEnd = service.indexOf('export async function captureMarketplaceSandboxDeposit', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'sandbox authority helper missing');
  const helper = service.slice(helperStart, helperEnd);

  assert.match(route, /authorizeRole\(\['buyer', 'owner'\]\)/);
  assert.equal(/['"]admin['"]|platform_admin|super_admin|privileged/.test(route), false,
    'sandbox capture route must not grant an admin UAT exception');
  assert.match(route, /current\.buyer_id !== actor\.id/);
  assert.match(helper, /session\.buyer_id !== id/);
  assert.match(helper, /Only the transaction buyer may advance the sandbox payment/);
});

test('Phase 6 mutation M30 — admin UAT convenience cannot regain sandbox payment authority', () => {
  const clean = source('routes/escrowTrustRoutes.js');
  const safe = (text) => {
    const route = captureRoute(text);
    return /authorizeRole\(\['buyer', 'owner'\]\)/.test(route)
      && !/['"]admin['"]|platform_admin|super_admin|privileged/.test(route)
      && /current\.buyer_id !== actor\.id/.test(route);
  };
  assert.equal(safe(clean), true);

  const mutant = clean.replace(
    "authorizeRole(['buyer', 'owner'])",
    "authorizeRole(['buyer', 'owner', 'admin'])",
  );
  assert.notEqual(mutant, clean, 'M30 mutation did not match');
  assert.equal(safe(mutant), false, 'M30 mutant survived: admin sandbox authority was not detected');
});
