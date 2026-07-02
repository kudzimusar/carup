import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// These are LIVE-Supabase smoke checks (they assert a real query does not 500). Mere PRESENCE
// of env vars is not enough: db/supabase.js requires SUPABASE_URL + SERVICE_ROLE_KEY to import,
// so CI/test runners set placeholder values — which previously fooled this guard into running
// against a non-existent DB. Run only against REAL infra (explicit opt-in, or a non-local /
// non-"test" URL + key). Otherwise skip. This masks nothing: the checks still run wherever a
// live Supabase is configured (e.g. locally with real creds, or RUN_SUPABASE_SMOKE=true).
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const liveSupabase = process.env.RUN_SUPABASE_SMOKE === 'true'
  || (Boolean(supabaseUrl) && Boolean(supabaseKey)
      && !/localhost|127\.0\.0\.1|test/i.test(supabaseUrl)
      && !/^test[-_]?/i.test(supabaseKey));
const skipReason = liveSupabase
  ? false
  : 'Skipping QA backend-blockers smoke test: no live Supabase configured (set RUN_SUPABASE_SMOKE=true with real creds).';

let server;
let port;

test('setup', { skip: skipReason }, async () => {
  const { default: app } = await import('../server.js');
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  port = server.address().port;
});

test('GET /api/vehicles/:vin/details does not 500 on tenants.phone column', { skip: skipReason }, async () => {
  const res = await fetch(`http://localhost:${port}/api/vehicles/TESTVIN123/details`);
  const status = res.status;
  const body = await res.json().catch(() => ({}));
  assert.notEqual(body.error, 'column tenants.phone does not exist');
});

test('GET /api/evidence/review does not 500 on multiple relationships', { skip: skipReason }, async () => {
  const res = await fetch(`http://localhost:${port}/api/evidence/review`, {
    headers: {
      'x-user-id': 'u_auth_admin',
      'x-stakeholder-role': 'admin'
    }
  });
  const status = res.status;
  const body = await res.json().catch(() => ({}));
  assert.equal(status, 200, `Expected 200, got ${status} with body ${JSON.stringify(body)}`);
});

test('teardown', { skip: skipReason }, async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});
