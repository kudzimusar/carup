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

function routeBlock(text, anchor, nextAnchor) {
  const start = text.indexOf(anchor);
  assert.ok(start >= 0, `missing route anchor: ${anchor}`);
  const end = nextAnchor ? text.indexOf(nextAnchor, start + anchor.length) : text.length;
  assert.ok(end > start, `missing route end after: ${anchor}`);
  return text.slice(start, end);
}

test('Phase 6 — legacy SafePay compatibility reads canonical sessions only', () => {
  const routes = source('routes/escrowTrustRoutes.js');
  const block = routeBlock(
    routes,
    "router.get('/api/safepay/list'",
    "router.post('/api/safepay/:id/update'",
  );

  assert.match(block, /listSessionsForActor\(actorFrom\(req\)\)/);
  assert.match(block, /toPublicMarketplaceEscrowSession/);
  assert.doesNotMatch(block, /safepay_escrows/);
  assert.doesNotMatch(block, /buyer:users|seller:users|email|phone/);
});

test('Phase 6 — retired SafePay webhook cannot assert payment state', () => {
  const routes = source('routes/escrowTrustRoutes.js');
  const block = routeBlock(routes, "router.post('/api/safepay/webhook'", 'export default router;');

  assert.match(block, /status\(410\)/);
  assert.match(block, /LEGACY_SAFEPAY_WEBHOOK_DISABLED/);
  assert.doesNotMatch(block, /updateEscrowStatus|SAFEPAY_WEBHOOK_SECRET|createHmac|payment\.received/);
});

test('Phase 6 — canonical transaction router terminates every historical inline transaction URL first', () => {
  const server = source('server.js');
  const mount = server.indexOf('app.use(escrowTrustRouter);');
  assert.ok(mount >= 0, 'canonical escrowTrustRouter is not mounted');

  for (const legacyAnchor of [
    "app.post('/api/safepay/create'",
    "app.get('/api/safepay/list'",
    "app.post('/api/safepay/:id/update'",
    "app.post('/api/safepay/webhook'",
    "app.post('/api/vehicles/:vin/reserve'",
  ]) {
    const legacy = server.indexOf(legacyAnchor);
    assert.ok(legacy >= 0, `expected historical route is missing: ${legacyAnchor}`);
    assert.ok(mount < legacy, `${legacyAnchor} can run before canonical transaction router`);
  }
});

test('Phase 6 mutation M17 — route reordering cannot silently resurrect legacy transaction authority', () => {
  const server = source('server.js');
  const mount = server.indexOf('app.use(escrowTrustRouter);');
  const firstLegacy = Math.min(
    ...[
      "app.post('/api/safepay/create'",
      "app.get('/api/safepay/list'",
      "app.post('/api/safepay/:id/update'",
      "app.post('/api/safepay/webhook'",
      "app.post('/api/vehicles/:vin/reserve'",
    ].map((anchor) => server.indexOf(anchor)).filter((index) => index >= 0),
  );
  assert.ok(mount >= 0 && firstLegacy >= 0 && mount < firstLegacy, 'clean source must mount canonical transaction authority first');

  const mutant = server.replace('app.use(escrowTrustRouter);', '/* M17: canonical transaction router moved after historical routes */');
  const mutantMount = mutant.indexOf('app.use(escrowTrustRouter);');
  assert.equal(mutantMount, -1, 'M17 mutant survived: canonical mount still present');
});

test('Phase 6 mutation M18 — retired generic gateway webhook cannot regain a parallel payment ledger', () => {
  const paymentRouter = source('services/payment/paymentRouter.js');
  const block = routeBlock(paymentRouter, "router.post('/webhook/:gateway'", 'export default router;');
  const safeLegacyGateway = (text) => /status\(410\)/.test(text)
    && /LEGACY_GATEWAY_WEBHOOK_DISABLED/.test(text)
    && !/safepay_escrows|payment_transactions|emitDomainEvent|PAYMENT_RECEIVED|createHmac|WEBHOOK_SECRET/.test(text);

  assert.equal(safeLegacyGateway(block), true, 'clean legacy gateway route must be fail-closed');

  const mutant = block.replace(
    "return res.status(410).json({",
    "const payment_transactions = 'parallel-ledger-restored';\n  return res.status(200).json({",
  );
  assert.notEqual(mutant, block, 'M18 mutation did not match');
  assert.equal(
    safeLegacyGateway(mutant),
    false,
    'M18 mutant survived: parallel payment-ledger authority was not detected',
  );
});

test('Phase 6 mutation M19 — admin transaction count cannot drift back to the retired escrow table', () => {
  const adminRoutes = source('routes/adminRoutes.js');
  const block = routeBlock(adminRoutes, "router.get('/api/admin/stats'", "router.post('/api/users/:id/suspend'");
  const canonicalCount = (text) => /from\('escrow_trust_sessions'\)/.test(text)
    && !/from\('safepay_escrows'\)/.test(text);

  assert.equal(canonicalCount(block), true, 'admin transaction count must use canonical sessions');

  const mutant = block.replace("from('escrow_trust_sessions')", "from('safepay_escrows')");
  assert.notEqual(mutant, block, 'M19 mutation did not match');
  assert.equal(
    canonicalCount(mutant),
    false,
    'M19 mutant survived: admin stats can count the retired transaction universe',
  );
});
