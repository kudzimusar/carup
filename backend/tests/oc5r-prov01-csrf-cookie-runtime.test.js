/**
 * OC-5R-PROV-01 B1 — the CSRF cookie's transport flags follow the central deployed-runtime
 * classifier, not NODE_ENV. With NODE_ENV=test inside a deployment the cookie used to be issued
 * without `Secure` and with `SameSite=Lax`; every deployment now gets `Secure; SameSite=None`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { app } = await import('../server.js');

async function csrfCookie(env) {
  const saved = { CARUP_ENV: process.env.CARUP_ENV, VERCEL_ENV: process.env.VERCEL_ENV };
  delete process.env.CARUP_ENV;
  delete process.env.VERCEL_ENV;
  Object.assign(process.env, env);
  const server = http.createServer(app).listen(0);
  try {
    await new Promise((r) => server.once('listening', r));
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/security/csrf-token`);
    return String(res.headers.get('set-cookie') || '');
  } finally {
    await new Promise((r) => server.close(r));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('B1: every deployment issues the CSRF cookie Secure + SameSite=None, whatever NODE_ENV says', async () => {
  for (const env of [{ CARUP_ENV: 'staging' }, { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'production' }]) {
    const cookie = await csrfCookie(env);
    assert.match(cookie, /csrf-token=/, JSON.stringify(env));
    assert.match(cookie, /;\s*Secure/i, `${JSON.stringify(env)}: ${cookie}`);
    assert.match(cookie, /SameSite=None/i, `${JSON.stringify(env)}: ${cookie}`);
  }
});

test('B1: the local/CI runtime keeps the development cookie flags', async () => {
  const cookie = await csrfCookie({});
  assert.match(cookie, /SameSite=Lax/i);
  assert.doesNotMatch(cookie, /;\s*Secure/i);
});
