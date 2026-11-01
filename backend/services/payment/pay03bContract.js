/**
 * CARUP-PAY-03B — shared contract for first-party Dealer & Business subscriptions and the F5 payment
 * reconciliation operator surface.
 *
 * Authority boundaries (see docs/payments/CARUP_PAY_03B_DEALER_BUSINESS_SUBSCRIPTIONS.md):
 *  - public.payment_transactions is the ONLY money ledger; PAY-03B never writes money state except through the
 *    canonical SECURITY DEFINER functions.
 *  - Provider operations run only on the PAY-01A CarUp Japan Stripe SANDBOX account, only with a test key, only
 *    outside production, and only when CARUP_PAY03B_ENABLED is explicitly 'true'.
 *  - No price, tariff, tax, merchant or entitlement value is invented here: commercial values come from the
 *    governed plan registry, where every unapproved value is NULL and blocks activation.
 */
import { logAuditEvent } from '../auditLogger.js';
import { Pay01aError, requirePay01aSandbox } from './pay01aContract.js';

export class Pay03bError extends Error {
  constructor(code, status = 409, details = null) {
    super(code);
    this.name = 'Pay03bError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Provider-touching PAY-03B operations: explicit opt-in on top of the PAY-01A sandbox contract. */
export function requirePay03bSandbox(env = process.env, options = {}) {
  if (env.CARUP_PAY03B_ENABLED !== 'true') throw new Pay03bError('PAY03B_SANDBOX_DISABLED', 404);
  return requirePay01aSandbox(env, options);
}

/** Read-only governance/catalogue views never require provider credentials and never activate anything. */
export function isPay03bProductionRuntime(env = process.env) {
  const deployment = String(env.VERCEL_ENV || '').toLowerCase();
  const app = String(env.CARUP_ENV || env.APP_ENV || '').toLowerCase();
  return deployment === 'production' || app === 'production';
}

export function requireAdminActor(adminActorId) {
  if (typeof adminActorId !== 'string' || !adminActorId.trim()) {
    throw new Pay03bError('PAY03B_ADMIN_ACTOR_REQUIRED', 401);
  }
  return adminActorId.trim();
}

/** `logAuditEvent` never throws; a legacy-mirror-only write (warning) is not an authoritative audit record. */
export function pay03bAuditSucceeded(result) {
  return Boolean(result && result.success === true && !result.warning);
}

export function recordPay03bAudit(db, {
  eventType, actorId, actorRole, tenantId = null, sourceRoute = null, requestContext = null, reason, subject = {},
}) {
  return logAuditEvent(db, {
    event_type: eventType,
    actor_user_id: actorId,
    actor_role: actorRole || null,
    actor_tenant_id: tenantId,
    actor_type: 'user',
    source_dashboard: 'admin.commercial-foundation',
    source_route: sourceRoute,
    reason,
    new_value: subject,
    request_id: requestContext?.requestId || null,
    ip_address: requestContext?.ipAddress || null,
    user_agent: requestContext?.userAgent || null,
  });
}

const RPC_ERROR_STATUS = Object.freeze({
  AUTHORITY_REFUSED: 403,
  SELF_DEALING_REFUSED: 403,
  NOT_FOUND: 404,
});

/**
 * Map a canonical RPC failure to a curated error. Only codes raised by CarUp's own SQL (PAY0x_/PAY03B_ prefixes)
 * cross the API boundary; anything else (driver/network/raw SQL text) becomes an opaque 503.
 */
export function pay03bRpcError(error, fallbackCode = 'PAY03B_CANONICAL_RPC_UNAVAILABLE') {
  const message = String(error?.message || '');
  const match = message.match(/\b(PAY0[0-9][A-Z0-9]*_[A-Z0-9_]+)\b/);
  if (!match) return new Pay03bError(fallbackCode, 503);
  const code = match[1];
  const statusKey = Object.keys(RPC_ERROR_STATUS).find((suffix) => code.endsWith(suffix));
  return new Pay03bError(code, statusKey ? RPC_ERROR_STATUS[statusKey] : 409);
}

export function isPay0xError(err) {
  return err instanceof Pay03bError || err instanceof Pay01aError;
}
