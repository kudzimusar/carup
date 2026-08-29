import crypto from 'node:crypto';

const CURVE_ORDER = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
const DEFAULT_VERSION = 'v1';
let testProcessSecret = null;
let testSystemSecret = null;

function toBase64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function masterSecret(explicit = null) {
  if (explicit) return Buffer.from(String(explicit), 'utf8');

  const configured = process.env.CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET;
  if (configured) return Buffer.from(configured, 'utf8');

  if (process.env.NODE_ENV === 'test') {
    if (!testProcessSecret) testProcessSecret = crypto.randomBytes(32);
    return testProcessSecret;
  }

  throw new Error(
    'CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET is required for stakeholder ledger signing. '
    + 'Private keys are not persisted in application tables.',
  );
}

export function custodyGeneration({ secret = null, version = null } = {}) {
  const keyVersion = String(version || process.env.CARUP_BLOCKCHAIN_KEY_VERSION || DEFAULT_VERSION);
  const commitment = crypto
    .createHmac('sha256', masterSecret(secret))
    .update(`carup:blockchain-custody-generation:${keyVersion}`)
    .digest('hex')
    .slice(0, 32);
  return `custody:${keyVersion}:${commitment}`;
}

function scalarFor(userId, { secret = null, version = null } = {}) {
  const id = String(userId || '').trim();
  if (!id) throw new Error('stakeholder userId is required for key derivation');

  const keyVersion = String(version || process.env.CARUP_BLOCKCHAIN_KEY_VERSION || DEFAULT_VERSION);
  const digest = crypto
    .createHmac('sha256', masterSecret(secret))
    .update(`carup:blockchain-signing:${keyVersion}:${id}`)
    .digest();

  const raw = BigInt(`0x${digest.toString('hex')}`);
  const scalar = (raw % (CURVE_ORDER - 1n)) + 1n;
  return {
    version: keyVersion,
    generation: custodyGeneration({ secret, version: keyVersion }),
    bytes: Buffer.from(scalar.toString(16).padStart(64, '0'), 'hex'),
  };
}

export function deriveStakeholderKey(userId, options = {}) {
  const derived = scalarFor(userId, options);
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(derived.bytes);
  const uncompressed = ecdh.getPublicKey(null, 'uncompressed');
  const x = uncompressed.subarray(1, 33);
  const y = uncompressed.subarray(33, 65);

  const jwk = {
    kty: 'EC',
    crv: 'secp256k1',
    x: toBase64Url(x),
    y: toBase64Url(y),
    d: toBase64Url(derived.bytes),
  };

  const privateKey = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const fingerprint = crypto.createHash('sha256').update(publicKeyPem).digest('hex');

  return {
    privateKey,
    publicKey,
    publicKeyPem,
    keyVersion: derived.version,
    custodyGeneration: derived.generation,
    keyRef: `derived:carup-blockchain:${derived.version}:${fingerprint.slice(0, 24)}`,
    custodyProvider: 'derived_master_secret',
    fingerprint,
  };
}

export function signLedgerHash(userId, hash, options = {}) {
  const key = deriveStakeholderKey(userId, options);
  const signature = crypto.sign('sha256', Buffer.from(String(hash), 'utf8'), key.privateKey);
  return {
    signatureHex: signature.toString('hex'),
    publicKeyPem: key.publicKeyPem,
    keyRef: key.keyRef,
    keyVersion: key.keyVersion,
    custodyGeneration: key.custodyGeneration,
    custodyProvider: key.custodyProvider,
    fingerprint: key.fingerprint,
  };
}

export function verifyLedgerHash(publicKeyPem, hash, signatureHex) {
  if (!publicKeyPem || !signatureHex) return false;
  return crypto.verify(
    'sha256',
    Buffer.from(String(hash), 'utf8'),
    publicKeyPem,
    Buffer.from(String(signatureHex), 'hex'),
  );
}

function currentSystemSecret() {
  const configured = process.env.CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'test') {
    if (!testSystemSecret) testSystemSecret = crypto.randomBytes(32).toString('hex');
    return testSystemSecret;
  }
  throw new Error('CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET is required for system ledger signing.');
}

export function signSystemLedgerHash(hash) {
  return crypto.createHmac('sha256', currentSystemSecret()).update(String(hash)).digest('hex');
}

export function verifySystemLedgerHash(hash, signatureHex) {
  if (!signatureHex) return false;
  const candidates = [
    currentSystemSecret(),
    ...(process.env.CARUP_BLOCKCHAIN_LEGACY_SYSTEM_HMAC_SECRETS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ];
  return candidates.some((secret) => {
    const expected = crypto.createHmac('sha256', secret).update(String(hash)).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(String(signatureHex), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

export default {
  custodyGeneration,
  deriveStakeholderKey,
  signLedgerHash,
  verifyLedgerHash,
  signSystemLedgerHash,
  verifySystemLedgerHash,
};
