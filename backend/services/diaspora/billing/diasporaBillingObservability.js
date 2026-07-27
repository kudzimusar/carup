/**
 * Billing observability (Issue #127, Deliverable D).
 *
 * Four signals are required, and each one is required because it is otherwise INVISIBLE:
 *
 *   FAILED WEBHOOKS       — a webhook whose handler throws leaves a row indistinguishable from one
 *                           that was never delivered. Silence looks identical to health.
 *   RECONCILIATION MISMATCH — provider state and our ledger drifting apart is the single failure that
 *                           costs real money in both directions (billing a cancelled tenant, serving a
 *                           tenant who stopped paying), and neither side reports it.
 *   QUOTA ANOMALIES       — a tenant that suddenly consumes a period's quota in minutes is either
 *                           abuse or a retry loop. Both are urgent; neither raises an error.
 *   CHECKOUT ABANDONMENT  — the only one of the four with NO trace at all unless it is recorded up
 *                           front, which is why `diaspora_billing_checkout_sessions` exists (ledger #24).
 *
 * Every emission carries a correlation id and passes through redaction. The shared logger already
 * redacts keys containing password/token/secret/key/credential/auth/signature; this module adds a
 * billing-specific pass because the fields that matter here — customer email, card last4, provider
 * customer refs — do not contain any of those substrings and would sail straight through.
 *
 * Emitting is BEST EFFORT and never throws into a caller: an observability failure must not fail a
 * webhook or a reconciliation run. That is a deliberate asymmetry — the signal is less important than
 * the operation it observes.
 */
import crypto from 'crypto';
import { logger } from '../../../utils/logger.js';

export const BILLING_LOG_CATEGORY = 'DIASPORA_BILLING';

export const BILLING_EVENTS = Object.freeze({
  WEBHOOK_REJECTED: 'billing.webhook.rejected',
  WEBHOOK_FAILED: 'billing.webhook.failed',
  WEBHOOK_SUPERSEDED: 'billing.webhook.superseded',
  WEBHOOK_DUPLICATE: 'billing.webhook.duplicate',
  WEBHOOK_APPLIED: 'billing.webhook.applied',
  RECONCILIATION_STARTED: 'billing.reconciliation.started',
  RECONCILIATION_MISMATCH: 'billing.reconciliation.mismatch',
  RECONCILIATION_COMPLETED: 'billing.reconciliation.completed',
  RECONCILIATION_FAILED: 'billing.reconciliation.failed',
  QUOTA_ANOMALY: 'billing.quota.anomaly',
  CHECKOUT_OPENED: 'billing.checkout.opened',
  CHECKOUT_COMPLETED: 'billing.checkout.completed',
  CHECKOUT_ABANDONED: 'billing.checkout.abandoned',
});

/**
 * Billing-specific PII/secret redaction.
 *
 * An ALLOWLIST of shapes would be too rigid for a diagnostic payload, so this is a targeted denylist of
 * the field names that actually appear in provider objects, applied recursively and case-insensitively.
 * Provider customer/subscription refs are fingerprinted rather than dropped: an operator needs to
 * correlate "the same customer" across log lines without the log becoming a customer database.
 */
const PII_KEYS = Object.freeze([
  'email', 'phone', 'name', 'address', 'line1', 'line2', 'postal', 'postcode',
  'card', 'last4', 'fingerprint', 'iban', 'account_number', 'msisdn', 'authemail',
]);

const FINGERPRINT_KEYS = Object.freeze([
  'providercustomerref', 'provider_customer_ref', 'customer',
  'providersubscriptionref', 'provider_subscription_ref', 'subscription',
  'sessionref', 'session_ref', 'pollurl', 'reference',
]);

/** Stable, non-reversible short fingerprint. Same input -> same value, so correlation still works. */
export function fingerprint(value) {
  if (value == null || value === '') return null;
  return `fp_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}`;
}

export function redactBillingMeta(value, depth = 0) {
  if (value == null || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => redactBillingMeta(v, depth + 1));
  if (typeof value !== 'object') return value;

  const out = {};
  for (const [key, v] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (PII_KEYS.some((k) => lower.includes(k))) {
      out[key] = '[REDACTED]';
    } else if (FINGERPRINT_KEYS.includes(lower)) {
      out[key] = fingerprint(v);
    } else if (typeof v === 'object' && v !== null) {
      out[key] = redactBillingMeta(v, depth + 1);
    } else {
      out[key] = v;
    }
  }
  return out;
}

/** Collected in-memory for assertions and for a future metrics sink. Bounded so it cannot leak memory. */
const RECENT_LIMIT = 200;
const recent = [];

export function recentBillingSignals(eventName = null) {
  return eventName ? recent.filter((r) => r.event === eventName) : [...recent];
}

export function clearBillingSignals() {
  recent.length = 0;
}

/**
 * Emit a billing signal. Never throws.
 *
 * @param {string} event    one of BILLING_EVENTS
 * @param {object} meta     diagnostic payload (redacted before it leaves this function)
 * @param {'info'|'warn'|'error'} level
 */
export function emitBillingSignal(event, meta = {}, level = 'info') {
  const record = {
    event,
    at: new Date().toISOString(),
    ...redactBillingMeta(meta),
  };
  try {
    recent.push(record);
    if (recent.length > RECENT_LIMIT) recent.splice(0, recent.length - RECENT_LIMIT);
    const emit = logger[level] || logger.info;
    emit(BILLING_LOG_CATEGORY, event, record);
  } catch {
    // An observability failure must never fail the operation being observed.
  }
  return record;
}

// ── Named emitters (so a caller cannot mistype an event name) ───────────────────────────────────

export function webhookRejected({ correlationId, reason, provider = null }) {
  // WARN, not ERROR: a rejected signature is usually a misconfigured endpoint or a scanner, not an
  // outage. Logging it at ERROR would train operators to ignore billing errors.
  return emitBillingSignal(BILLING_EVENTS.WEBHOOK_REJECTED, { correlationId, reason, provider }, 'warn');
}

export function webhookFailed({ correlationId, provider, eventId, tenantId, reason, deadLettered = false }) {
  return emitBillingSignal(
    BILLING_EVENTS.WEBHOOK_FAILED,
    { correlationId, provider, eventId, tenantId, reason, deadLettered },
    'error',
  );
}

export function webhookSuperseded({ correlationId, provider, eventId, tenantId, supersededBy }) {
  return emitBillingSignal(
    BILLING_EVENTS.WEBHOOK_SUPERSEDED,
    { correlationId, provider, eventId, tenantId, supersededBy },
    'warn',
  );
}

export function webhookDuplicate({ correlationId, provider, eventId }) {
  return emitBillingSignal(BILLING_EVENTS.WEBHOOK_DUPLICATE, { correlationId, provider, eventId });
}

export function webhookApplied({ correlationId, provider, eventId, tenantId, eventType }) {
  return emitBillingSignal(BILLING_EVENTS.WEBHOOK_APPLIED, { correlationId, provider, eventId, tenantId, eventType });
}

export function reconciliationMismatch({ correlationId, runId, tenantId, field, expected, actual, kind }) {
  return emitBillingSignal(
    BILLING_EVENTS.RECONCILIATION_MISMATCH,
    { correlationId, runId, tenantId, field, expected, actual, kind },
    'error',
  );
}

export function reconciliationCompleted({ correlationId, runId, provider, checked, mismatches, trigger }) {
  return emitBillingSignal(
    BILLING_EVENTS.RECONCILIATION_COMPLETED,
    { correlationId, runId, provider, checked, mismatches, trigger },
    mismatches > 0 ? 'warn' : 'info',
  );
}

export function reconciliationFailed({ correlationId, runId, provider, reason }) {
  return emitBillingSignal(BILLING_EVENTS.RECONCILIATION_FAILED, { correlationId, runId, provider, reason }, 'error');
}

export function checkoutOpened({ correlationId, tenantId, planKey, provider, sessionRef }) {
  return emitBillingSignal(BILLING_EVENTS.CHECKOUT_OPENED, { correlationId, tenantId, planKey, provider, sessionRef });
}

export function checkoutCompleted({ correlationId, tenantId, planKey, provider, sessionRef, openMinutes }) {
  return emitBillingSignal(
    BILLING_EVENTS.CHECKOUT_COMPLETED,
    { correlationId, tenantId, planKey, provider, sessionRef, openMinutes },
  );
}

export function checkoutAbandoned({ correlationId, tenantId, planKey, provider, sessionRef, openMinutes }) {
  return emitBillingSignal(
    BILLING_EVENTS.CHECKOUT_ABANDONED,
    { correlationId, tenantId, planKey, provider, sessionRef, openMinutes },
    'warn',
  );
}

/**
 * Quota anomaly detection.
 *
 * Two distinct shapes, because they mean different things:
 *   BURST     — a large fraction of a period's quota consumed inside a short window. Usually a retry
 *               loop or a script, and it will exhaust the tenant's plan long before the period ends.
 *   EXHAUSTED — the quota is spent. Not an error (the guard already denies correctly), but it is the
 *               single most useful upgrade signal the system produces, and today nobody sees it.
 *
 * Returns the emitted signals (possibly empty). Pure with respect to the caller: detection never
 * changes a quota decision — enforcement stays entirely in the entitlement guard.
 */
export function detectQuotaAnomaly({
  correlationId = null, tenantId, featureKey, limit, used, reservedNow = 0,
  windowMinutes = null, burstFraction = 0.5,
}) {
  const signals = [];
  const numericLimit = Number(limit) || 0;
  const numericUsed = Number(used) || 0;
  if (numericLimit <= 0) return signals;

  if (windowMinutes != null && reservedNow > 0 && reservedNow >= numericLimit * burstFraction) {
    signals.push(emitBillingSignal(BILLING_EVENTS.QUOTA_ANOMALY, {
      correlationId, tenantId, featureKey, kind: 'BURST',
      limit: numericLimit, used: numericUsed, reservedNow, windowMinutes,
    }, 'warn'));
  }

  if (numericUsed >= numericLimit) {
    signals.push(emitBillingSignal(BILLING_EVENTS.QUOTA_ANOMALY, {
      correlationId, tenantId, featureKey, kind: 'EXHAUSTED',
      limit: numericLimit, used: numericUsed,
    }, 'warn'));
  }
  return signals;
}

/** A correlation id for a request that did not arrive with one (webhooks rarely do). */
export function newCorrelationId(prefix = 'blg') {
  return `${prefix}_${crypto.randomUUID()}`;
}
