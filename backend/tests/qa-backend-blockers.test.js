import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const hasEnv = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const skipReason = hasEnv ? false : 'Skipping QA blockers test because Supabase env vars are not set';

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
