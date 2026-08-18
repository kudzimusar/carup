import assert from 'node:assert/strict';
import test from 'node:test';

import { isVerifiedEdgeRequest, resolveClientIp, edgeClientIpMiddleware } from '../middleware/edgeClientIp.js';

/**
 * CP1 — client-IP trust once Cloudflare proxies api-staging.carup.dev.
 *
 * The threat this guards against: the Vercel origin stays publicly reachable after proxying, so a
 * direct caller can forge CF-Connecting-IP and choose (or poison) a rate-limit bucket. The header
 * is therefore only believed on a request that provably transited our zone.
 */

const SECRET = 'edge-secret-for-tests-0123456789';
const ENV = { CARUP_EDGE_SHARED_SECRET: SECRET };

const req = (headers = {}, extra = {}) => ({
  headers, ip: '10.0.0.1', socket: { remoteAddress: '10.0.0.1' }, ...extra,
});

test('a verified edge request yields the real client IP', () => {
  const r = req({ 'x-carup-edge-secret': SECRET, 'cf-connecting-ip': '203.0.113.9' });
  assert.equal(isVerifiedEdgeRequest(r, ENV), true);
  assert.equal(resolveClientIp(r, ENV), '203.0.113.9');
});

test('a FORGED CF-Connecting-IP sent directly to the origin is ignored', () => {
  // No edge secret: this is someone bypassing Cloudflare and hitting Vercel directly.
  const r = req({ 'cf-connecting-ip': '203.0.113.9' });
  assert.equal(isVerifiedEdgeRequest(r, ENV), false);
  assert.equal(resolveClientIp(r, ENV), '10.0.0.1', 'must fall back, never trust the header');
});

test('a WRONG edge secret is rejected', () => {
  const r = req({ 'x-carup-edge-secret': 'not-the-secret', 'cf-connecting-ip': '203.0.113.9' });
  assert.equal(isVerifiedEdgeRequest(r, ENV), false);
  assert.equal(resolveClientIp(r, ENV), '10.0.0.1');
});

test('with no secret configured, nothing is ever treated as edge-verified', () => {
  const r = req({ 'x-carup-edge-secret': SECRET, 'cf-connecting-ip': '203.0.113.9' });
  assert.equal(isVerifiedEdgeRequest(r, {}), false);
  assert.equal(resolveClientIp(r, {}), '10.0.0.1');
});

test('an empty secret cannot be matched by an empty header', () => {
  const r = req({ 'x-carup-edge-secret': '', 'cf-connecting-ip': '203.0.113.9' });
  assert.equal(isVerifiedEdgeRequest(r, { CARUP_EDGE_SHARED_SECRET: '' }), false);
});

test('behaviour is unchanged when Cloudflare is not in front (pre-proxy parity)', () => {
  const r = req({});
  assert.equal(resolveClientIp(r, ENV), '10.0.0.1');
  assert.equal(resolveClientIp(r, {}), '10.0.0.1');
});

test('the middleware exposes one agreed value for rate limiting and audit', () => {
  const r = req({ 'x-carup-edge-secret': SECRET, 'cf-connecting-ip': '198.51.100.7' });
  let called = false;
  edgeClientIpMiddleware(ENV)(r, {}, () => { called = true; });
  assert.equal(called, true);
  assert.equal(r.carupClientIp, '198.51.100.7');
  assert.equal(r.carupViaVerifiedEdge, true);
});

test('rate limiting and audit would key on the same resolved value', async () => {
  const { readFileSync } = await import('node:fs');
  const sec = readFileSync(new URL('../middleware/securityMiddleware.js', import.meta.url), 'utf8');
  const auth = readFileSync(new URL('../routes/authRecoveryRoutes.js', import.meta.url), 'utf8');
  assert.match(sec, /req\.carupClientIp \|\|/, 'rate limiter must prefer the resolved client IP');
  assert.match(auth, /req\.carupClientIp \|\|/, 'auth audit must record the resolved client IP');
});

test('a comma-separated or array header still yields a single address', () => {
  const arr = req({ 'x-carup-edge-secret': SECRET, 'cf-connecting-ip': ['203.0.113.9', '10.1.1.1'] });
  assert.equal(resolveClientIp(arr, ENV), '203.0.113.9');
});
