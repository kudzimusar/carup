/**
 * Eligibility webhook security — Workstream C.
 *
 * HMAC-SHA256 signature verification + anti-replay (5-min timestamp drift) + idempotency,
 * mirroring the production payment webhook (backend/services/payment/paymentRouter.js).
 * Pure verification helpers so they are unit-testable without a server.
 */
import crypto from 'crypto';
import { isProductionLikeRuntime } from '../../utils/runtimeEnvironment.js';

// A committed literal is a credential everyone who has read this file holds. It is usable ONLY
// in a local/CI runtime — never in ANY declared deployment (central classifier). Until
// OC-5R-PROV-01 B2 only production refused them, so staging and previews accepted webhooks signed
// with keys published in the repository. A deployment without its configured secret has NO
// usable secret, and verification fails closed (unknown_provider).
const LOCAL_LITERALS_ALLOWED = () => !isProductionLikeRuntime(process.env);

const PROVIDER_SECRETS = () => ({
  insurance_sandbox: process.env.INSURANCE_WEBHOOK_SECRET || (LOCAL_LITERALS_ALLOWED() ? 'insurance-sandbox-hmac-secret' : null),
  finance_sandbox: process.env.FINANCE_WEBHOOK_SECRET || (LOCAL_LITERALS_ALLOWED() ? 'finance-sandbox-hmac-secret' : null),
  // Trust-gated escrow webhook has its OWN secret — never share the finance secret across
  // capabilities (a finance-secret holder must not be able to forge escrow state transitions).
  escrow_trust_sandbox: process.env.ESCROW_TRUST_WEBHOOK_SECRET || (LOCAL_LITERALS_ALLOWED() ? 'escrow-trust-sandbox-hmac-secret' : null),
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
  // Dev bypass is opt-in only (WEBHOOK_DEV_BYPASS=1) and exists only in a local/CI runtime —
  // no declared deployment can be bypassed, whatever its flags say.
  if (LOCAL_LITERALS_ALLOWED() && process.env.WEBHOOK_DEV_BYPASS === '1' && signatureHeader === 'dev-bypass-sig') {
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

/**
 * OC-5R-PROV-01 B5 — verify against the route's SERVER-OWNED signing identity. Each webhook route
 * knows which provider identity (and so which secret) authenticates it; the caller never chooses.
 * Until B5 every route passed `req.headers['x-provider-id']` straight into verifyWebhook, so a
 * holder of ANY configured secret could name that provider and have its key accepted on a route it
 * was never meant for. A caller may still assert a provider id, but an assertion that differs from
 * the route's own identity is refused before any secret is consulted.
 */
export function verifyRouteWebhook(serverProviderId, assertedProviderId, payloadString, signatureHeader, timestampHeader, now = Date.now()) {
  if (!serverProviderId || !Object.prototype.hasOwnProperty.call(PROVIDER_SECRETS(), serverProviderId)) {
    return { valid: false, replay: false, reason: 'unknown_provider' };
  }
  const asserted = assertedProviderId == null ? '' : String(assertedProviderId).trim();
  if (asserted && asserted !== serverProviderId) return { valid: false, replay: false, reason: 'provider_mismatch' };
  return verifyWebhook(serverProviderId, payloadString, signatureHeader, timestampHeader, now);
}

export default { sign, verifyWebhook, verifyRouteWebhook, REPLAY_WINDOW_MS };
