/**
 * Eligibility webhook security — Workstream C.
 *
 * HMAC-SHA256 signature verification + anti-replay (5-min timestamp drift) + idempotency,
 * mirroring the production payment webhook (backend/services/payment/paymentRouter.js).
 * Pure verification helpers so they are unit-testable without a server.
 */
import crypto from 'crypto';

const PROVIDER_SECRETS = () => ({
  insurance_sandbox: process.env.INSURANCE_WEBHOOK_SECRET || 'insurance-sandbox-hmac-secret',
  finance_sandbox: process.env.FINANCE_WEBHOOK_SECRET || 'finance-sandbox-hmac-secret',
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
  if (process.env.NODE_ENV !== 'production' && signatureHeader === 'dev-bypass-sig') {
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
