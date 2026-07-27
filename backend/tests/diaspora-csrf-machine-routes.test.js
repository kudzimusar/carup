/**
 * Machine-to-machine Diaspora routes must survive CSRF in PRODUCTION (Issue #127).
 *
 * This defect has now occurred twice in this program, in lanes written months apart:
 *
 *   · both Diaspora provider webhooks were CSRF-blocked in every non-test environment, so no
 *     provider delivery ever reached its handler;
 *   · the Phase 2E scheduler dispatch endpoint was blocked the same way, so the cron would have gone
 *     red on every tick and not one of the five scheduled jobs would ever have run.
 *
 * Both passed the entire suite. `csrfMiddleware` short-circuits on `NODE_ENV === 'test'` BEFORE it
 * consults the exemption list, so no ordinary test can observe the production behaviour at all — the
 * tests were structurally incapable of catching it.
 *
 * These tests therefore drive the middleware with NODE_ENV set to 'production' and 'staging'
 * explicitly, which is the only way the list is reached. They assert on BEHAVIOUR (did the request
 * reach `next()`?) rather than on the source text, so a refactor that changes how the list is
 * expressed cannot make them pass vacuously.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { csrfMiddleware } = await import('../middleware/securityMiddleware.js');

/** Every Diaspora route a machine calls, and which cannot present a CSRF token. */
const MACHINE_ROUTES = [
  ['subscription provider webhook', '/api/diaspora/subscription/webhook'],
  ['SafeTrade payment webhook', '/api/diaspora/safetrade/payment-webhook'],
  ['scheduler dispatch (Phase 2E)', '/api/diaspora/scheduler/internal/run'],
];

/** A browser-facing route that must STILL be protected — the control for the whole file. */
const BROWSER_ROUTE = '/api/diaspora/subscription/checkout';

/**
 * Run csrfMiddleware for one request under an explicit NODE_ENV and report whether it passed.
 *
 * Returns `{ passed, status }`: `passed` is true when the middleware called `next()`, meaning the
 * request reached its handler.
 */
function runCsrf(url, nodeEnv, { method = 'POST', headers = {} } = {}) {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  try {
    const req = { originalUrl: url, url, method, headers, path: url };
    let status = null;
    let passed = false;
    const res = {
      status(code) { status = code; return this; },
      json() { return this; },
      send() { return this; },
      setHeader() { return this; },
    };
    csrfMiddleware(req, res, () => { passed = true; });
    return { passed, status };
  } finally {
    process.env.NODE_ENV = original;
  }
}

describe('CSRF exemptions for Diaspora machine routes', () => {
  test('CONTROL: the middleware really blocks an unprotected browser POST in production', () => {
    // If this ever stops blocking, every assertion below is meaningless — they would all "pass"
    // because the middleware lets everything through, not because the exemptions are right.
    const { passed } = runCsrf(BROWSER_ROUTE, 'production');
    assert.equal(
      passed,
      false,
      'csrfMiddleware allowed a browser POST with no CSRF token in production — the middleware is ' +
        'not enforcing at all, so the exemption assertions below prove nothing',
    );
  });

  test('CONTROL: the NODE_ENV=test bypass is what hid both defects', () => {
    // Named explicitly so the reason these tests set NODE_ENV by hand is not lost to a later reader
    // who "simplifies" them back into the ordinary suite.
    const { passed } = runCsrf(BROWSER_ROUTE, 'test');
    assert.equal(
      passed,
      true,
      'expected the test-environment bypass to let everything through; if this changed, these tests ' +
        'no longer need to set NODE_ENV and the comment above should be corrected',
    );
  });

  for (const [label, url] of MACHINE_ROUTES) {
    for (const env of ['production', 'staging']) {
      test(`${label} is NOT CSRF-blocked in ${env}`, () => {
        const { passed, status } = runCsrf(url, env, {
          headers: { 'x-diaspora-scheduler-secret': 'irrelevant-to-this-check' },
        });
        assert.equal(
          passed,
          true,
          `${url} was rejected by CSRF in ${env} (status ${status}). A machine caller has no browser ` +
            'session and cannot present a CSRF token, so the request never reaches its handler and ' +
            'the feature is silently dead in every environment except the test suite.',
        );
      });
    }
  }

  test('a near-miss path is NOT exempted — the patterns are anchored, not substrings', () => {
    // `/api/diaspora/scheduler/internal/run` is exempt; `/api/diaspora/scheduler/jobs/x/run` is an
    // operator route behind a session and must stay protected. A sloppy `startsWith` or an
    // unanchored regex would exempt both.
    for (const url of [
      '/api/diaspora/scheduler/jobs/billing_reconciliation/run',
      '/api/diaspora/scheduler/health',
      '/api/diaspora/subscription/webhooks-admin',
    ]) {
      const { passed } = runCsrf(url, 'production');
      assert.equal(passed, false, `${url} was exempted from CSRF but is not a machine route`);
    }
  });

  test('the exemption survives a query string and a trailing slash', () => {
    // Vercel and some cron providers append both. An exact-equality check would silently stop
    // matching and the failure would look like an auth problem rather than a routing one.
    for (const url of [
      '/api/diaspora/scheduler/internal/run?source=cron',
      '/api/diaspora/scheduler/internal/run/',
    ]) {
      const { passed } = runCsrf(url, 'production');
      assert.equal(passed, true, `${url} was CSRF-blocked; the pattern does not tolerate this suffix`);
    }
  });
});
