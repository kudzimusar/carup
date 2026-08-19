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
