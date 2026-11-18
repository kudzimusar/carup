import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { CarUpError, ValidationError } from '../../../utils/errors.js';

export const VERIFF_TEST_WEBHOOK = '/api/identity/veriff-test/webhook';
const MAX_METADATA_BYTES = 32_768;
const FIXTURE_ORIGIN = 'https://veriff-fixture.invalid';
const STATUS_CODES = new Map([
  ['approved', 9001], ['declined', 9102], ['resubmission_requested', 9103],
  ['expired', 9104], ['abandoned', 9104], ['review', 9121],
]);
const CLOCK_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;
export const VERIFF_UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;

function unavailable() {
  return new CarUpError('The Veriff test integration is unavailable.', 503, 'VERIFF_TEST_UNAVAILABLE');
}

function digest(value) {
  return createHash('sha256').update(value).digest();
}

function sign(secret, value) {
  return createHmac('sha256', secret).update(value).digest();
}

function authenticated(config, bytes, client, signature) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_METADATA_BYTES ||
      typeof client !== 'string' || client.length > 256 ||
      typeof signature !== 'string' || !/^[0-9a-f]{64}$/iu.test(signature)) return false;
  const clientMatches = timingSafeEqual(digest(config.client), digest(client));
  const signatureMatches = timingSafeEqual(sign(config.secret, bytes), Buffer.from(signature, 'hex'));
  return clientMatches && signatureMatches;
}

function decoded(bytes) {
  try {
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (payload?.status === 'success' && Object.hasOwn(payload, 'verification')) return payload.verification;
  } catch {
    // Provider content is never included in an exception.
  }
  throw new ValidationError('Invalid Veriff test metadata.');
}

function validDecisionTime(value) {
  if (typeof value !== 'string' || !CLOCK_FORMAT.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const calendarDay = value.slice(0, 10);
  const day = new Date(calendarDay);
  return Number.isFinite(day.valueOf()) && day.toISOString().startsWith(calendarDay);
}

function normalizeDecision(verification) {
  if (verification === null) return null;
  const { id, vendorData, attemptId, status, code, decisionTime } = verification ?? {};
  if (![id, vendorData, attemptId].every(value => typeof value === 'string' && VERIFF_UUID.test(value)) ||
      !STATUS_CODES.has(status) || STATUS_CODES.get(status) !== code ||
      !validDecisionTime(decisionTime)) {
    throw new ValidationError('Invalid Veriff test decision.');
  }
  return {
    providerSession: id.toLowerCase(), binding: vendorData.toLowerCase(), providerAttempt: attemptId.toLowerCase(),
    status, decisionAt: decisionTime,
  };
}

async function responseBytes(response) {
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const chunks = [];
  let count = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return Buffer.concat(chunks, count);
    count += value.byteLength;
    if (count > MAX_METADATA_BYTES) {
      await reader.cancel();
      throw unavailable();
    }
    chunks.push(value);
  }
}

export function veriffTestEnabled(env = process.env) {
  return env.NODE_ENV === 'test' && env.CARUP_IDV_TEST_BIOMETRIC_CONTRACT === 'yes' && env.CARUP_IDV_TEST_VERIFF === 'yes';
}

export function getVeriffTestTransport(env = process.env, http = globalThis.fetch) {
  if (!veriffTestEnabled(env)) throw unavailable();

  const client = env.CARUP_IDV_TEST_VERIFF_CLIENT;
  const secret = env.CARUP_IDV_TEST_VERIFF_SECRET;
  if (!/^[\x21-\x7e]{1,256}$/u.test(client || '') ||
      typeof secret !== 'string' || secret.length < 16 || secret.length > 512) throw unavailable();

  let url;
  try { url = new URL(env.CARUP_IDV_TEST_VERIFF_ORIGIN); } catch { throw unavailable(); }
  const vendorOrigin = /^https:\/\/[a-z0-9.-]+\.veriff\.(?:com|me)$/u.test(url.origin);
  const externalConfirmed = env.CARUP_IDV_TEST_VERIFF_VENDOR_CONFIRMED === 'yes';
  if (url.href !== url.origin + '/' || (url.origin !== FIXTURE_ORIGIN && !(vendorOrigin && externalConfirmed))) {
    throw unavailable();
  }
  const config = { client, secret };

  async function request(path, { binding, providerSession }) {
    const headers = { 'Content-Type': 'application/json', 'X-AUTH-CLIENT': client };
    // One opaque server-generated identifier is the entire outbound payload.
    const body = binding ? JSON.stringify({ verification: { vendorData: binding } }) : undefined;
    if (providerSession) headers['X-HMAC-SIGNATURE'] = sign(secret, providerSession).toString('hex');
    try {
      const response = await http(url.origin + path, {
        method: binding ? 'POST' : 'GET', headers, body, redirect: 'error', signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok || !/^application\/json(?:;|$)/iu.test(response.headers.get('content-type') || '')) {
        await response.body?.cancel();
        throw unavailable();
      }
      const bytes = await responseBytes(response);
      if (!authenticated(config, bytes, response.headers.get('x-auth-client'), response.headers.get('x-hmac-signature'))) {
        throw unavailable();
      }
      return decoded(bytes);
    } catch {
      throw unavailable();
    }
  }

  return {
    async create(binding) {
      if (typeof binding !== 'string' || !VERIFF_UUID.test(binding)) throw unavailable();
      const verification = await request('/v1/sessions', { binding });
      if (typeof verification?.id !== 'string' || !VERIFF_UUID.test(verification.id) ||
          verification.vendorData != null && verification.vendorData !== binding) throw unavailable();
      return verification.id.toLowerCase();
    },
    async lookup(providerSession) {
      if (typeof providerSession !== 'string' || !VERIFF_UUID.test(providerSession)) throw unavailable();
      const verification = await request('/v1/sessions/' + providerSession + '/decision', { providerSession });
      try { return normalizeDecision(verification); } catch { throw unavailable(); }
    },
    receive(bytes, clientHeader, signatureHeader) {
      if (!authenticated(config, bytes, clientHeader, signatureHeader)) {
        throw new CarUpError('Veriff test webhook authentication failed.', 401, 'VERIFF_TEST_UNAUTHENTICATED');
      }
      return normalizeDecision(decoded(bytes));
    },
  };
}
