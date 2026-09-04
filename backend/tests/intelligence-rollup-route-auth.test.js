/**
 * The rollup trigger's authorization, and the defect that hid inside it.
 *
 * `POST /api/internal/intelligence/rollup` accepts either a worker secret or a
 * platform administrator. The admin half was **dead by construction**: nothing on
 * that route populated `req.userContext`, so `adminAuthorized()` could never
 * return true. With `INTELLIGENCE_WORKER_SECRET` unset — as it is in every
 * deployed environment — the endpoint was a guaranteed 403 for everybody, and the
 * ledger→rollup→projection chain could not be exercised at all.
 *
 * That is the same shape as the `optionalAuth`-passed-uncalled defect the I6
 * review found: a path that looks implemented, passes its unit tests, and is
 * unreachable in production.
 *
 * Fixing it introduced a second question immediately. `optionalAuth` will populate
 * `userContext` from the spoofable `x-user-id` fallback wherever that fallback is
 * enabled, flagging it `identityAsserted`. A merely ASSERTED identity must not be
 * able to trigger a platform-wide recompute, so the admin gate requires a proven
 * one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROUTES = read('backend/routes/intelligenceRollupRoutes.js');
const CODE = codeOnly(ROUTES);

test('the rollup trigger populates a user context, so the admin path is reachable', () => {
  const block = CODE.split("'/api/internal/intelligence/rollup'")[1].split('router.get')[0];
  assert.ok(
    /optionalAuth\(\)/.test(block),
    'without a context-populating middleware the admin branch can never be true',
  );
  // The factory must be INVOKED. Passed uncalled, Express treats the factory as
  // the middleware, never calls next(), and every request hangs.
  assert.ok(!/optionalAuth\s*,/.test(block), 'optionalAuth is a factory and must be called');
});

test('the admin gate refuses an identity that was asserted rather than proven', () => {
  const gate = CODE.split('function adminAuthorized')[1].split('\n}')[0];
  assert.ok(
    /identityAsserted\s*===\s*true/.test(gate),
    'a spoofable x-user-id identity must not be able to trigger a platform-wide recompute',
  );
});

test('the worker-secret path is unchanged and still constant-time', () => {
  const gate = CODE.split('function workerAuthorized')[1].split('\n}')[0];
  assert.ok(/timingSafeEqual/.test(gate));
  assert.ok(/INTELLIGENCE_WORKER_SECRET/.test(gate));
  // An unset secret must never authorize.
  assert.ok(/if \(!secret/.test(gate));
});

// ── The gate's own logic, exercised directly ──────────────────────────────

/** A faithful re-implementation is not the goal; the real module is loaded. */
const loadGate = async () => {
  const mod = await import('../routes/intelligenceRollupRoutes.js');
  return mod;
};

test('the route module loads without a worker secret configured', async () => {
  delete process.env.INTELLIGENCE_WORKER_SECRET;
  const mod = await loadGate();
  assert.ok(mod.default, 'the router must still mount when no secret is configured');
});

test('an anonymous caller is refused, and refusal is the default', () => {
  // With no context and no secret, both branches are false — the endpoint fails
  // closed rather than open. Asserted on the source because the two helpers are
  // module-private by design.
  const block = CODE.split("'/api/internal/intelligence/rollup'")[1].split('router.get')[0];
  assert.ok(/if \(!workerAuthorized\(req\) && !adminAuthorized\(req\)\)/.test(block));
  assert.ok(/status\(403\)/.test(block));
});

test('the admin STATUS route stays role-gated in its own right', () => {
  const block = CODE.split("'/api/admin/intelligence/rollup-status'")[1].split('export default')[0];
  assert.match(block, /authorizeRole\(\['admin'\]\)/);
});
