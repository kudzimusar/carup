/**
 * CARUP-PAY-05-LR01 — Paynow integration-key custody. A garage's integration key is stored only as AES-256-GCM
 * ciphertext bound (AAD) to its own merchant, currency, integration ID and mode; the key-encryption key comes from the
 * runtime environment, never the database or the repository. No network, no database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  sealIntegrationKey,
  openIntegrationKey,
  integrationKeyAad,
  integrationKeyFingerprint,
  loadCredentialKek,
} from '../services/payment/pay05CredentialVault.js';

const KEK = crypto.randomBytes(32).toString('base64');
const env = { CARUP_PAY05_CREDENTIAL_KEK: KEK, CARUP_PAY05_CREDENTIAL_KEK_VERSION: '3' };
const KEY = '3e9fed89-60e1-4ce5-ab6e-6b1eb2d4f977';
const binding = { tenantId: 't-1', merchantAccountId: 'm-1', currency: 'USD', integrationId: '1201', mode: 'simulator' };

test('sealing round-trips only under the same binding, and the stored form never contains the key', () => {
  const aad = integrationKeyAad(binding);
  const sealed = sealIntegrationKey(KEY, { aad, env });
  assert.deepEqual(Object.keys(sealed).sort(), ['ciphertext', 'fingerprint', 'iv', 'keyVersion', 'tag']);
  assert.equal(sealed.keyVersion, 3);
  for (const part of [sealed.ciphertext, sealed.iv, sealed.tag]) assert.match(part, /^[A-Za-z0-9+/]+={0,2}$/);
  const stored = JSON.stringify(sealed);
  assert.ok(!stored.includes(KEY) && !stored.includes(KEY.replace(/-/g, '')) && !stored.includes(KEY.slice(0, 8)));
  assert.equal(openIntegrationKey(sealed, { aad, env }), KEY);
  const again = sealIntegrationKey(KEY, { aad, env });
  assert.notEqual(again.ciphertext, sealed.ciphertext, 'a fresh IV per seal');
  assert.equal(again.fingerprint, sealed.fingerprint, 'the fingerprint identifies the key, not the seal');
});

test('a ciphertext moved to another merchant, currency, integration or mode does not open', () => {
  const sealed = sealIntegrationKey(KEY, { aad: integrationKeyAad(binding), env });
  for (const change of [{ tenantId: 't-2' }, { merchantAccountId: 'm-2' }, { currency: 'ZWG' }, { integrationId: '1202' }, { mode: 'paynow_live' }]) {
    assert.throws(() => openIntegrationKey(sealed, { aad: integrationKeyAad({ ...binding, ...change }), env }),
      /PAY05_CREDENTIAL_UNAVAILABLE/, JSON.stringify(change));
  }
});

test('tampering with ciphertext, IV or tag, or opening under another KEK or KEK version, fails closed', () => {
  const aad = integrationKeyAad(binding);
  const sealed = sealIntegrationKey(KEY, { aad, env });
  const flip = (b64) => { const buf = Buffer.from(b64, 'base64'); buf[0] ^= 1; return buf.toString('base64'); };
  for (const field of ['ciphertext', 'iv', 'tag']) {
    assert.throws(() => openIntegrationKey({ ...sealed, [field]: flip(sealed[field]) }, { aad, env }), /PAY05_CREDENTIAL_UNAVAILABLE/, field);
  }
  const otherKek = { ...env, CARUP_PAY05_CREDENTIAL_KEK: crypto.randomBytes(32).toString('base64') };
  assert.throws(() => openIntegrationKey(sealed, { aad, env: otherKek }), /PAY05_CREDENTIAL_UNAVAILABLE/);
  assert.throws(() => openIntegrationKey(sealed, { aad, env: { ...env, CARUP_PAY05_CREDENTIAL_KEK_VERSION: '4' } }),
    /PAY05_CREDENTIAL_KEK_VERSION_MISMATCH/);
});

test('no usable key-encryption key: refused, never a fallback', () => {
  for (const bad of [{}, { CARUP_PAY05_CREDENTIAL_KEK: '' }, { CARUP_PAY05_CREDENTIAL_KEK: Buffer.alloc(16).toString('base64') },
    { CARUP_PAY05_CREDENTIAL_KEK: 'not base64 at all!!' }, { CARUP_PAY05_CREDENTIAL_KEK: Buffer.alloc(32).toString('base64') }]) {
    assert.throws(() => loadCredentialKek(bad), /PAY05_CREDENTIAL_KEK_UNAVAILABLE/, JSON.stringify(bad));
  }
  assert.equal(loadCredentialKek({ CARUP_PAY05_CREDENTIAL_KEK: KEK }).version, 1, 'version defaults to 1');
  assert.throws(() => loadCredentialKek({ CARUP_PAY05_CREDENTIAL_KEK: KEK, CARUP_PAY05_CREDENTIAL_KEK_VERSION: '0' }),
    /PAY05_CREDENTIAL_KEK_UNAVAILABLE/);
});

test('only plausible integration keys are accepted, and the fingerprint is a short one-way digest', () => {
  const aad = integrationKeyAad(binding);
  for (const bad of ['', 'short', ' 3e9fed89-60e1-4ce5-ab6e-6b1eb2d4f977', 'has space inside key value!', 'x'.repeat(129), null]) {
    assert.throws(() => sealIntegrationKey(bad, { aad, env }), /PAY05_INTEGRATION_KEY_INVALID/, String(bad));
  }
  const fp = integrationKeyFingerprint(KEY);
  assert.match(fp, /^[0-9a-f]{16}$/);
  assert.ok(!KEY.includes(fp));
  assert.throws(() => integrationKeyAad({ ...binding, currency: 'ZIG' }), /PAY05_CURRENCY_NOT_SUPPORTED/);
  assert.throws(() => integrationKeyAad({ ...binding, mode: 'prod' }), /PAY05_MODE_INVALID/);
});
