import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { getVeriffTestTransport } from '../services/identity/biometrics/veriffTestTransport.js';

const env = {
  NODE_ENV: 'test', CARUP_IDV_TEST_VERIFF: 'yes', CARUP_IDV_TEST_BIOMETRIC_CONTRACT: 'yes',
  CARUP_IDV_TEST_VERIFF_ORIGIN: 'https://veriff-fixture.invalid',
  CARUP_IDV_TEST_VERIFF_CLIENT: 'offline-unit-test-client',
  CARUP_IDV_TEST_VERIFF_SECRET: 'offline-unit-test-only-secret',
};
const client = env.CARUP_IDV_TEST_VERIFF_CLIENT;
function sign(content) {
  return createHmac('sha256', env.CARUP_IDV_TEST_VERIFF_SECRET).update(content).digest('hex');
}
function reply(bytes, headers = {}) {
  return new Response(bytes, { headers: { 'Content-Type': 'application/json', 'X-AUTH-CLIENT': client,
    'X-HMAC-SIGNATURE': sign(bytes), ...headers } });
}

test('Veriff transport is gated in production and for unconfirmed vendor origins', () => {
  const refused = variants => assert.throws(
    () => getVeriffTestTransport({ ...env, ...variants }), { code: 'VERIFF_TEST_UNAVAILABLE' },
  );
  refused({ NODE_ENV: 'production' });
  refused({ CARUP_IDV_TEST_BIOMETRIC_CONTRACT: '' });
  refused({ CARUP_IDV_TEST_VERIFF: '' });
  refused({ CARUP_IDV_TEST_VERIFF_ORIGIN: 'https://api.veriff.me' });
  refused({ CARUP_IDV_TEST_VERIFF_ORIGIN: 'https://api.veriff.me:8443', CARUP_IDV_TEST_VERIFF_VENDOR_CONFIRMED: 'yes' });
  refused({ CARUP_IDV_TEST_VERIFF_ORIGIN: 'https://api.veriff.me.attacker.invalid', CARUP_IDV_TEST_VERIFF_VENDOR_CONFIRMED: 'yes' });
  refused({ CARUP_IDV_TEST_VERIFF_ORIGIN: 'https://user@veriff-fixture.invalid' });
});

test('signed transport sends an opaque reference only and signs lookups with the exact session ID', async () => {
  const providerSession = randomUUID(), binding = randomUUID(), providerAttempt = randomUUID();
  const decisionAt = new Date().toISOString();
  let called = 0;
  const transport = getVeriffTestTransport(env, async (url, request) => {
    assert.equal(request.redirect, 'error');
    assert.ok(request.signal instanceof AbortSignal);
    assert.equal(request.headers['X-AUTH-CLIENT'], client);
    called++;
    if (request.method === 'POST') {
      assert.equal(url, env.CARUP_IDV_TEST_VERIFF_ORIGIN + '/v1/sessions');
      assert.equal(request.headers['X-HMAC-SIGNATURE'], undefined);
      assert.deepEqual(JSON.parse(request.body), { verification: { vendorData: binding } });
      return reply(JSON.stringify({ status: 'success', verification: { id: providerSession, url: 'private-test-url' } }));
    }
    assert.equal(url, env.CARUP_IDV_TEST_VERIFF_ORIGIN + '/v1/sessions/' + providerSession + '/decision');
    assert.equal(request.headers['X-HMAC-SIGNATURE'], sign(providerSession));
    assert.equal(request.body, undefined);
    return reply(JSON.stringify({ status: 'success', verification: {
      id: providerSession, vendorData: binding, attemptId: providerAttempt, status: 'approved', code: 9001,
      decisionTime: decisionAt, person: { firstName: 'Discard fixture' },
    } }));
  });
  assert.equal(await transport.create(binding), providerSession);
  assert.deepEqual(await transport.lookup(providerSession), { binding, providerSession, providerAttempt, status: 'approved', decisionAt });
  assert.equal(called, 2);
});

test('invalid UTF-8, unauthentic or oversized metadata is rejected without leaking metadata', async () => {
  const transport = getVeriffTestTransport(env);
  const invalid = Buffer.from([0xc3, 0x28]);
  assert.throws(() => transport.receive(invalid, client, sign(invalid)), { statusCode: 400 });
  const valid = Buffer.from('{"status":"success","verification":null}');
  assert.equal(transport.receive(valid, client, sign(valid)), null);
  assert.throws(() => transport.receive(valid, client, ''), { statusCode: 401 });
  const over = 'x'.repeat(32_769);
  for (const response of [reply(over), reply(valid, { 'X-HMAC-SIGNATURE': '0'.repeat(64) }),
    reply(valid, { 'X-AUTH-CLIENT': 'wrong-client' })]) {
    const invalidTransport = getVeriffTestTransport(env, async () => response);
    await assert.rejects(() => invalidTransport.lookup(randomUUID()), { code: 'VERIFF_TEST_UNAVAILABLE' });
  }
});
