/**
 * Eligibility webhook security — Workstream C.
 *
 * HMAC-SHA256 signature verification + anti-replay (5-min timestamp drift) + idempotency,
 * mirroring the production payment webhook (backend/services/payment/paymentRouter.js).
 * Pure verification helpers so they are unit-testable without a server.
 */
import crypto from 'crypto';

const IS_PRODUCTION = () => process.env.NODE_ENV === 'production' || process.env.CARUP_ENV === 'production';

// Fail-closed: in production a missing secret yields NO usable secret (null), so signature
// verification can never succeed against a committed literal. Outside production a stable
// dev secret is used so sandbox/staging webhook tests are reproducible.
const PROVIDER_SECRETS = () => ({
  insurance_sandbox: process.env.INSURANCE_WEBHOOK_SECRET || (IS_PRODUCTION() ? null : 'insurance-sandbox-hmac-secret'),
  finance_sandbox: process.env.FINANCE_WEBHOOK_SECRET || (IS_PRODUCTION() ? null : 'finance-sandbox-hmac-secret'),
});

export const REPLAY_WINDOW_MS = 5 * 60 * 1000;

/** Compute the signature a valid provider would send for a payload+timestamp. */
export function sign(providerId, payloadString, timestamp) {
  const secret = PROVIDER_SECRETS()[providerId];
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${payloadString}`).digest('hex');
}

/** Verify signature + timestamp drift. Returns { valid, replay, reason }. */
export function verifyWebhook(providerId, payloadString, signatureHeader, timestampHeader, now = Date.now()) {
  // Dev bypass is opt-in only (WEBHOOK_DEV_BYPASS=1) and never available in production —
  // so neither production nor an un-flagged staging can be bypassed.
  if (!IS_PRODUCTION() && process.env.WEBHOOK_DEV_BYPASS === '1' && signatureHeader === 'dev-bypass-sig') {
    return { valid: true, replay: false, reason: 'dev_bypass' };
  }
  if (!signatureHeader) return { valid: false, replay: false, reason: 'missing_signature' };
  if (!timestampHeader) return { valid: false, replay: false, reason: 'missing_timestamp' };
  const drift = Math.abs(now - Number(timestampHeader));
  if (Number.isNaN(drift) || drift > REPLAY_WINDOW_MS) return { valid: false, replay: true, reason: 'timestamp_drift' };
  const expected = sign(providerId, payloadString, timestampHeader);
  if (!expected) return { valid: false, replay: false, reason: 'unknown_provider' };
  try {
    const ok = crypto.timingSafeEqual(Buffer.from(signatureHeader, 'hex'), Buffer.from(expected, 'hex'));
    return { valid: ok, replay: false, reason: ok ? 'ok' : 'bad_signature' };
  } catch {
    return { valid: false, replay: false, reason: 'bad_signature_format' };
  }
}

export default { sign, verifyWebhook, REPLAY_WINDOW_MS };
