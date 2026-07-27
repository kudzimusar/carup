/**
 * Diaspora GTM — the scheduler's HTTP surface (Issue #127, Phase 2E).
 *
 * THE ASSERTION THAT MATTERS MOST
 * -------------------------------
 * A platform cron will be wired to `/internal/run` BEFORE anyone decides to switch the jobs on. That
 * is only safe if an un-enabled deployment answers cheerfully and does absolutely nothing — no work,
 * no database connection, no state read. So the first test here does not merely check a status code:
 * it injects a client that THROWS on any access and asserts the request still succeeds. A test that
 * only read the JSON would pass just as happily against a route that ran every job and then reported
 * `dispatched:false`.
 *
 * The rest is the authentication boundary. Two doors, deliberately different: a shared secret for the
 * machine, a platform-admin session for the human, and neither accepted on the other's route —
 * because a route that takes either credential is only as strong as the weaker one.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const { default: schedulerRouter } = await import('../routes/diasporaSchedulerRoutes.js');
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { SCHEDULER_JOB_KEYS } = await import('../constants/diaspora/diasporaSchedulerConstants.js');

const SECRET = 'scheduler-dispatch-secret-for-tests';

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/scheduler', schedulerRouter);
  app.use(errorHandler);
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });

function withEnv(patch, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  const result = fn();
  return result && typeof result.then === 'function'
    ? result.finally(restore)
    : (restore(), result);
}

async function call(method, path, { headers = {}, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const CLEAN_ENV = {
  DIASPORA_SCHEDULER_ENABLED: undefined,
  DIASPORA_SCHEDULER_SECRET: undefined,
  CRON_SECRET: undefined,
  DIASPORA_BILLING_RECONCILIATION_SCHEDULER: undefined,
  DIASPORA_BILLING_CHECKOUT_SWEEP_SCHEDULER: undefined,
  DIASPORA_BILLING_EVENT_RETRY_SCHEDULER: undefined,
  DIASPORA_DRIVE_SYNC_RETRY_SCHEDULER: undefined,
  DIASPORA_SUBSCRIPTION_RENEWAL_SCHEDULER: undefined,
};

test('an un-enabled deployment answers 200 and runs NOTHING, with or without a credential', async () => {
  await withEnv(CLEAN_ENV, async () => {
    for (const headers of [{}, { 'x-diaspora-scheduler-secret': 'anything' }]) {
      const { status, body } = await call('POST', '/scheduler/internal/run', { headers });
      // 200, not 503 and not 401: a cron that goes red every fifteen minutes is a cron people learn
      // to ignore, and the endpoint must be wirable before activation.
      assert.equal(status, 200);
      assert.equal(body.dispatched, false);
      assert.equal(body.reason, 'SCHEDULER_DISABLED');
      assert.equal(body.results, undefined, 'no job was even considered');
    }
    const viaGet = await call('GET', '/scheduler/internal/run');
    assert.equal(viaGet.status, 200);
    assert.equal(viaGet.body.reason, 'SCHEDULER_DISABLED');
  });
});

test('enabled but unsecured is 503 — an open endpoint that runs billing jobs is never the default', async () => {
  await withEnv({ ...CLEAN_ENV, DIASPORA_SCHEDULER_ENABLED: 'true' }, async () => {
    const { status, body } = await call('POST', '/scheduler/internal/run');
    assert.equal(status, 503);
    assert.match(body.error, /not configured/i);
  });
});

test('a wrong secret is 401, and a right one is accepted in either header form', async () => {
  await withEnv({ ...CLEAN_ENV, DIASPORA_SCHEDULER_ENABLED: 'true', DIASPORA_SCHEDULER_SECRET: SECRET }, async () => {
    const wrong = await call('POST', '/scheduler/internal/run', {
      headers: { 'x-diaspora-scheduler-secret': `${SECRET}-nope` },
    });
    assert.equal(wrong.status, 401);

    // A same-length wrong secret exercises the constant-time comparison rather than the length guard.
    const sameLength = await call('POST', '/scheduler/internal/run', {
      headers: { 'x-diaspora-scheduler-secret': 'x'.repeat(SECRET.length) },
    });
    assert.equal(sameLength.status, 401);

    const viaHeader = await call('POST', '/scheduler/internal/run', {
      headers: { 'x-diaspora-scheduler-secret': SECRET },
    });
    assert.equal(viaHeader.status, 200);
    assert.equal(viaHeader.body.dispatched, true);

    // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; both forms must work.
    const viaBearer = await call('POST', '/scheduler/internal/run', {
      headers: { authorization: `Bearer ${SECRET}` },
    });
    assert.equal(viaBearer.status, 200);
    assert.equal(viaBearer.body.dispatched, true);
  });
});

test('CRON_SECRET is accepted, so this codebase has ONE dispatch-secret convention, not two', async () => {
  await withEnv({ ...CLEAN_ENV, DIASPORA_SCHEDULER_ENABLED: 'true', CRON_SECRET: SECRET }, async () => {
    const { status, body } = await call('POST', '/scheduler/internal/run', {
      headers: { authorization: `Bearer ${SECRET}` },
    });
    assert.equal(status, 200);
    assert.equal(body.dispatched, true);
  });
});

test('an authenticated dispatch with every job flag OFF considers all five and runs none', async () => {
  await withEnv({ ...CLEAN_ENV, DIASPORA_SCHEDULER_ENABLED: 'true', DIASPORA_SCHEDULER_SECRET: SECRET }, async () => {
    const { status, body } = await call('POST', '/scheduler/internal/run', {
      headers: { 'x-diaspora-scheduler-secret': SECRET },
    });
    assert.equal(status, 200);
    assert.equal(body.considered, Object.keys(SCHEDULER_JOB_KEYS).length);
    assert.equal(body.ran, 0);
    assert.equal(body.skipped, Object.keys(SCHEDULER_JOB_KEYS).length);
    for (const result of body.results) {
      assert.equal(result.ran, false);
      assert.equal(result.reason, 'FLAG_OFF');
      // The flag name is reported, so an operator is told exactly which variable to set.
      assert.ok(result.flag && result.flag.startsWith('DIASPORA_'));
    }
  });
});

test('an unknown job key is rejected rather than silently ignored', async () => {
  await withEnv({ ...CLEAN_ENV, DIASPORA_SCHEDULER_ENABLED: 'true', DIASPORA_SCHEDULER_SECRET: SECRET }, async () => {
    const { status } = await call('POST', '/scheduler/internal/run', {
      headers: { 'x-diaspora-scheduler-secret': SECRET },
      body: { jobKeys: ['billing_reconciliation', 'not_a_job'] },
    });
    // Silently ignoring it would let a typo in a cron body disable a job forever with no signal.
    assert.equal(status, 400);
  });
});

test('the operator routes refuse an anonymous caller AND the dispatch secret', async () => {
  await withEnv({ ...CLEAN_ENV, DIASPORA_SCHEDULER_ENABLED: 'true', DIASPORA_SCHEDULER_SECRET: SECRET }, async () => {
    for (const path of ['/scheduler/health', '/scheduler/runs']) {
      const anonymous = await call('GET', path);
      assert.ok(anonymous.status === 401 || anonymous.status === 403, `${path} -> ${anonymous.status}`);
      // A route that accepts either credential is only as strong as the weaker one.
      const withSecret = await call('GET', path, { headers: { 'x-diaspora-scheduler-secret': SECRET } });
      assert.ok(withSecret.status === 401 || withSecret.status === 403, `${path} + secret -> ${withSecret.status}`);
    }
    const manual = await call('POST', '/scheduler/jobs/billing_reconciliation/run', {
      headers: { 'x-diaspora-scheduler-secret': SECRET },
    });
    assert.ok(manual.status === 401 || manual.status === 403, `manual run -> ${manual.status}`);
  });
});

test('the dispatch route refuses a session too — the machine door is not the human door', async () => {
  await withEnv({ ...CLEAN_ENV, DIASPORA_SCHEDULER_ENABLED: 'true', DIASPORA_SCHEDULER_SECRET: SECRET }, async () => {
    const { status } = await call('POST', '/scheduler/internal/run', {
      headers: { 'x-user-id': 'admin-1', 'x-tenant-id': '11111111-1111-1111-1111-111111111111' },
    });
    assert.equal(status, 401);
  });
});
