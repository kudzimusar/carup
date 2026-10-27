/**
 * T11-CAP-LR01-R2 — a response that carries the owner's short-lived photograph links is a capability for that viewer alone.
 *
 * It must never be stored by a browser or a shared cache (a stored copy would outlive the person it was minted for, and a shared one could be handed to someone
 * else). Three sites carry such links: the Journey, the two passport routes (only when the block is attached) and the garage list (only when heroes are attached).
 * A public passport is sent exactly as before — no new header, no behavioural difference an observer could use to tell that a vehicle has media.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import errorHandler from '../middleware/errorMiddleware.js';
import { createJourneyRouter } from '../routes/diasporaJourneyRoutes.js';

const serverSrc = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

function sliceBalanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error('unbalanced');
}
function shippedFunction(declaration) {
  const idx = serverSrc.indexOf(declaration);
  assert.ok(idx > -1, `${declaration} must still exist in server.js`);
  const brace = serverSrc.indexOf('{', serverSrc.indexOf(')', idx));
  return serverSrc.slice(idx, brace) + sliceBalanced(serverSrc, brace);
}

test('H1: the Journey is never stored by a browser or a shared cache', async () => {
  const app = express();
  const router = createJourneyRouter({ auth: (req, _res, next) => { req.userContext = { id: 'u1' }; next(); }, getJourneyFn: async () => ({ asset: { media: { state: 'available' } } }) });
  app.use('/api/diaspora', router);
  app.use(errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/diaspora/journeys/vehicle/V1`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await res.json(), { data: { asset: { media: { state: 'available' } } } });
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('H2: the shipped passport sender adds the header ONLY when the body carries the block, and otherwise sends exactly as before', () => {
  // eslint-disable-next-line no-new-func
  const sendPassportBody = new Function(`return (${shippedFunction('function sendPassportBody')});`)();
  const fake = () => { const headers = {}; return { headers, set(k, v) { headers[k] = v; return this; }, json(b) { this.body = b; return this; } }; };
  const withBlock = fake();
  sendPassportBody(withBlock, { vehicle: {}, governed_media: { state: 'available' } });
  assert.deepEqual(withBlock.headers, { 'Cache-Control': 'private, no-store' });
  for (const body of [{ vehicle: {} }, { vehicle: {}, governed_media: null }, null, undefined]) {
    const plain = fake();
    sendPassportBody(plain, body);
    assert.deepEqual(plain.headers, {}, `a body without the block gained a header: ${JSON.stringify(body)}`);
    assert.equal(plain.body, body);
  }
});

test('H2b (R3): a body that carries the owner\'s capabilities is just as private as one that carries photograph links', () => {
  // eslint-disable-next-line no-new-func
  const sendPassportBody = new Function(`return (${shippedFunction('function sendPassportBody')});`)();
  const fake = () => { const headers = {}; return { headers, set(k, v) { headers[k] = v; return this; }, json(b) { this.body = b; return this; } }; };
  const withCapabilities = fake();
  sendPassportBody(withCapabilities, { vehicle: {}, capabilities: { marketplace: { state: 'not_listed' }, trade_import: { state: 'none' } } });
  assert.deepEqual(withCapabilities.headers, { 'Cache-Control': 'private, no-store' });
  // …and the absence of both blocks is still byte-for-byte the old behaviour (H2 covers the plain bodies).
  for (const body of [{ vehicle: {}, capabilities: null }, { vehicle: {}, capabilities: undefined }]) {
    const plain = fake();
    sendPassportBody(plain, body);
    assert.deepEqual(plain.headers, {}, `a body without capabilities gained a header: ${JSON.stringify(body)}`);
  }
});

test('H3: both passport routes send through that helper, and the garage list sets the header when heroes are attached', () => {
  // R3 composes the owner-only capabilities AFTER the governed media, still through the one sender. Both routes, exactly twice.
  assert.equal([...serverSrc.matchAll(/return sendPassportBody\(res, await withOwnerCapabilities\(await withGovernedMedia\(passport, (vin|resolvedVin), req\), (vin|resolvedVin), req\)\)/g)].length, 2);
  assert.doesNotMatch(serverSrc, /res\.json\(await withGovernedMedia\(/, 'a passport route still sends the block without the header');
  const garage = serverSrc.slice(serverSrc.indexOf("console.warn('[governed-media] garage heroes unavailable:'"), serverSrc.indexOf('Error fetching owned vehicles:'));
  assert.match(garage, /if \(governed\.size > 0\) res\.set\('Cache-Control', 'private, no-store'\)/);
  assert.ok(garage.indexOf("res.set('Cache-Control'") < garage.indexOf('res.json('), 'the header must be set before the body is sent');
});
