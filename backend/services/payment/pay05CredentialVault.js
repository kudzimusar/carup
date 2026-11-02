/**
 * CARUP-PAY-05-LR01 — custody of a merchant's Paynow integration key.
 *
 * The key a garage pastes once is sealed with AES-256-GCM before it reaches the database, under a key-encryption key
 * (KEK) that exists only in the runtime environment (CARUP_PAY05_CREDENTIAL_KEK, 32 random bytes, base64; a managed
 * secret in any shared environment). The additional authenticated data binds the ciphertext to its tenant, merchant,
 * currency, integration ID and mode, so a sealed key copied to another row never opens. The API never returns a key;
 * logs never see one. Production custody (a managed KEK, rotation) is an activation prerequisite, not a Level 1 claim.
 */
import crypto from 'node:crypto';
import { Pay05Error, PAY05_CURRENCIES, PAY05_MODES } from './pay05Contract.js';

const unavailable = () => new Pay05Error('PAY05_CREDENTIAL_UNAVAILABLE', 503);

export function loadCredentialKek(env = process.env) {
  const refuse = () => new Pay05Error('PAY05_CREDENTIAL_KEK_UNAVAILABLE', 503);
  const raw = String(env.CARUP_PAY05_CREDENTIAL_KEK ?? '');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw refuse();
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.every((b) => b === key[0])) throw refuse();
  const versionText = String(env.CARUP_PAY05_CREDENTIAL_KEK_VERSION ?? '1');
  if (!/^[1-9]\d{0,3}$/.test(versionText)) throw refuse();
  return { key, version: Number(versionText) };
}

export function integrationKeyAad({ tenantId, merchantAccountId, currency, integrationId, mode }) {
  if (!PAY05_CURRENCIES.includes(currency)) throw new Pay05Error('PAY05_CURRENCY_NOT_SUPPORTED', 422);
  if (!PAY05_MODES.includes(mode)) throw new Pay05Error('PAY05_MODE_INVALID', 422);
  for (const part of [tenantId, merchantAccountId, integrationId]) {
    if (!part || /[\s|]/.test(String(part))) throw new Pay05Error('PAY05_CREDENTIAL_BINDING_INVALID', 422);
  }
  return `carup:pay05:paynow-integration-key:v1|${tenantId}|${merchantAccountId}|${currency}|${integrationId}|${mode}`;
}

function requirePlausibleKey(plaintext) {
  if (typeof plaintext !== 'string' || !/^[\x21-\x7e]{16,128}$/.test(plaintext)) {
    throw new Pay05Error('PAY05_INTEGRATION_KEY_INVALID', 422);
  }
}

/** A one-way, short identifier for the key (so an operator can tell two keys apart without seeing either). */
export function integrationKeyFingerprint(plaintext) {
  requirePlausibleKey(plaintext);
  return crypto.createHash('sha256').update(`carup:pay05:key-fingerprint|${plaintext}`, 'utf8').digest('hex').slice(0, 16);
}

export function sealIntegrationKey(plaintext, { aad, env = process.env }) {
  requirePlausibleKey(plaintext);
  const { key, version } = loadCredentialKek(env);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    keyVersion: version,
    fingerprint: integrationKeyFingerprint(plaintext),
  };
}

export function openIntegrationKey(sealed, { aad, env = process.env }) {
  const { key, version } = loadCredentialKek(env);
  if (Number(sealed?.keyVersion) !== version) throw new Pay05Error('PAY05_CREDENTIAL_KEK_VERSION_MISMATCH', 503);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(sealed.iv), 'base64'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(String(sealed.tag), 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(String(sealed.ciphertext), 'base64')), decipher.final()]).toString('utf8');
    requirePlausibleKey(plaintext);
    return plaintext;
  } catch {
    throw unavailable();
  }
}
