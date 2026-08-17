/**
 * Free-tier quota governance for Email providers (CARUP_EMAIL_1_0 directive §0A.4).
 *
 * Governing invariant:
 *
 *   NO provider may silently move CarUp from free usage into paid usage.
 *
 * This module is pure policy: it answers "given today's send count, may this send proceed?"
 * It never calls a provider, never buys capacity, and never escalates a plan. Enforcement is
 * the caller's responsibility (the delivery worker / campaign service).
 *
 * The provider ceilings below are TODAY'S free-tier allocations recorded as operational
 * configuration — deliberately NOT hardcoded business logic. Every value is overridable by
 * environment variable, because provider pricing changes and this file must not become the
 * reason CarUp is wrong about it.
 */

/** Today's documented free-tier ceilings. Operational configuration, not eternal architecture. */
export const PROVIDER_FREE_TIER_DAILY_CEILING = Object.freeze({
  resend: 100,
  brevo: 300,
});

/**
 * Defaults sit below the provider ceiling so CarUp reacts before the provider does.
 * Resend: warn at 70, protect at 90 of 100. Brevo: warn at 210, protect at 270 of 300.
 */
const DEFAULT_THRESHOLDS = Object.freeze({
  resend: { soft: 70, critical: 90 },
  brevo: { soft: 210, critical: 270 },
});

const ENV_KEYS = Object.freeze({
  resend: { soft: 'RESEND_DAILY_SOFT_LIMIT', critical: 'RESEND_DAILY_CRITICAL_LIMIT' },
  brevo: { soft: 'BREVO_DAILY_SOFT_LIMIT', critical: 'BREVO_DAILY_CRITICAL_LIMIT' },
});

/**
 * Email classes that must keep sending capacity at the critical threshold.
 * Mirrors the directive's provider routing: security/transactional/conversational are
 * protected; marketing is the first thing to pause.
 */
const CRITICAL_CLASSIFICATIONS = new Set(['security', 'transactional', 'conversational']);
const DEFERRABLE_CLASSIFICATIONS = new Set(['service']);
const MARKETING_CLASSIFICATIONS = new Set(['marketing']);

export const QUOTA_STATE = Object.freeze({
  OK: 'ok',
  SOFT: 'soft_threshold_reached',
  CRITICAL: 'critical_threshold_reached',
});

export const QUOTA_DECISION = Object.freeze({
  ALLOW: 'allow',
  DEFER: 'defer',
  SUPPRESS: 'suppress',
});

function positiveIntOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) return null;
  return parsed;
}

/**
 * Resolve configured thresholds for a provider.
 *
 * A misconfigured value (non-numeric, negative, or soft above critical) falls back to the safe
 * default rather than throwing — a bad env var must not disable quota protection entirely.
 */
export function resolveQuotaThresholds(provider, env = process.env) {
  const key = String(provider || '').toLowerCase();
  const defaults = DEFAULT_THRESHOLDS[key];
  if (!defaults) return null;

  const envKeys = ENV_KEYS[key];
  const soft = positiveIntOrNull(env[envKeys.soft]) ?? defaults.soft;
  const critical = positiveIntOrNull(env[envKeys.critical]) ?? defaults.critical;

  // An inverted configuration would make "critical" unreachable and silently weaken protection.
  if (soft > critical) return { ...defaults, provider: key, ceiling: PROVIDER_FREE_TIER_DAILY_CEILING[key], misconfigured: true };

  return { provider: key, soft, critical, ceiling: PROVIDER_FREE_TIER_DAILY_CEILING[key], misconfigured: false };
}

/** Current quota state for a provider given the number of sends already made today. */
export function evaluateQuotaState(provider, sentToday, env = process.env) {
  const thresholds = resolveQuotaThresholds(provider, env);
  if (!thresholds) return null;
  const count = Number(sentToday) || 0;
  const state = count >= thresholds.critical
    ? QUOTA_STATE.CRITICAL
    : count >= thresholds.soft
      ? QUOTA_STATE.SOFT
      : QUOTA_STATE.OK;
  return { ...thresholds, sentToday: count, state, remainingToCeiling: Math.max(0, thresholds.ceiling - count) };
}

/**
 * Decide whether one send may proceed.
 *
 * At the soft threshold everything still sends — the signal is a warning, not a brake.
 * At the critical threshold, capacity is reserved for security/transactional/conversational
 * Email: marketing is suppressed and service-class Email is deferred. Capacity is never bought.
 */
export function evaluateSendAllowance({ provider, classification, sentToday }, env = process.env) {
  const quota = evaluateQuotaState(provider, sentToday, env);
  if (!quota) {
    return { decision: QUOTA_DECISION.ALLOW, state: QUOTA_STATE.OK, reason: 'provider_not_quota_governed', warn: false, autoPurchase: false };
  }

  const cls = String(classification || '').toLowerCase();
  const base = { ...quota, autoPurchase: false };

  if (quota.state === QUOTA_STATE.CRITICAL) {
    if (MARKETING_CLASSIFICATIONS.has(cls)) {
      return { ...base, decision: QUOTA_DECISION.SUPPRESS, reason: 'quota_critical_marketing_suppressed', warn: true };
    }
    if (CRITICAL_CLASSIFICATIONS.has(cls)) {
      return { ...base, decision: QUOTA_DECISION.ALLOW, reason: 'quota_critical_capacity_reserved_for_critical_class', warn: true };
    }
    // Unknown/service classes are deferred rather than sent, protecting the remaining capacity.
    return { ...base, decision: QUOTA_DECISION.DEFER, reason: DEFERRABLE_CLASSIFICATIONS.has(cls) ? 'quota_critical_service_deferred' : 'quota_critical_unclassified_deferred', warn: true };
  }

  if (quota.state === QUOTA_STATE.SOFT) {
    return { ...base, decision: QUOTA_DECISION.ALLOW, reason: 'quota_soft_threshold_warning', warn: true };
  }

  return { ...base, decision: QUOTA_DECISION.ALLOW, reason: 'within_quota', warn: false };
}
