import crypto from 'crypto';

const SCRYPT_KEYLEN = 64;
const MIN_PASSWORD_LENGTH = 8;

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Email-only (passwordless) login is a local development shortcut for
 * accounts created before password storage existed. It must never
 * authenticate users in production: allowed only under an explicit env
 * flag or a non-production NODE_ENV, mirroring isUserIdFallbackAllowed
 * in middleware/authMiddleware.js.
 */
export function isPasswordlessLoginAllowed(env = process.env) {
  return env.CARUP_ALLOW_PASSWORDLESS_LOGIN === 'true' ||
    env.NODE_ENV === 'test' ||
    env.NODE_ENV === 'development' ||
    env.NODE_ENV === 'local';
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    const error = new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    error.statusCode = 400;
    throw error;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || !password || typeof storedHash !== 'string') {
    return false;
  }
  const [scheme, salt, hex] = storedHash.split(':');
  if (scheme !== 'scrypt' || !salt || !hex) {
    return false;
  }
  const derived = await scryptAsync(password, salt);
  const expected = Buffer.from(hex, 'hex');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

/**
 * Decide whether a login attempt is authenticated.
 * - Users with a stored password_hash must present the matching password.
 * - Users without one (legacy/dev accounts) authenticate only where
 *   passwordless login is explicitly allowed (never in production).
 */
export async function evaluateLoginCredentials({ user, password, env = process.env }) {
  if (!user) {
    return { ok: false, reason: 'unknown_user' };
  }
  if (user.password_hash) {
    const valid = await verifyPassword(password, user.password_hash);
    return valid
      ? { ok: true, method: 'password' }
      : { ok: false, reason: 'invalid_password' };
  }
  if (isPasswordlessLoginAllowed(env)) {
    return { ok: true, method: 'legacy_passwordless' };
  }
  return { ok: false, reason: 'password_not_set' };
}
