/**
 * Phase 8 — Diaspora entitlement service (foundation).
 *
 * Resolves a tenant's subscription + effective entitlements (plan merged with per-user overrides),
 * answers feature/quota checks with explainable denials, and reserves/commits/releases metered usage
 * through the atomic RPC diaspora_reserve_usage_atomic.
 *
 * Granularity (PD-1): subscriptions/quotas are TENANT-scoped; entitlements may be overridden per user.
 *
 * Conventions:
 *  - The supabase client is passed in as the first argument (injectable mock in tests), like the other
 *    diaspora services. No header-trusted roles — callers pass server-derived context only.
 *  - appendCriticalAudit (fail-loud) for the admin override and usage commit (domain-tied mutations);
 *    appendBestEffortAudit is reserved for telemetry/reads and is intentionally not spammed on checks.
 *  - Plan catalog is config-driven: the DB subscription row carries the plan_key; the entitlement
 *    values come from diaspora_subscription_plans when present, else the PLAN_CATALOG fallback.
 */
import { ValidationError, ForbiddenError, DatabaseError } from '../../utils/errors.js';
import { appendCriticalAudit } from './diasporaServiceUtils.js';
import {
  FEATURE_KEYS,
  ENTITLEMENT_TYPES,
  DEFAULT_PLAN_KEY,
  PLAN_CATALOG,
  planCatalogEntry,
  lowestPlanGranting,
  entitlementTypeFor,
  isMeteredFeature,
  isSubscriptionActiveState,
} from '../../constants/diaspora/diasporaEntitlements.js';

const PLANS_TABLE = 'diaspora_subscription_plans';
const SUBSCRIPTIONS_TABLE = 'diaspora_subscriptions';
const OVERRIDES_TABLE = 'diaspora_user_entitlement_overrides';
const METERS_TABLE = 'diaspora_usage_meters';
const RESERVATIONS_TABLE = 'diaspora_usage_reservations';
const RESERVE_RPC = 'diaspora_reserve_usage_atomic';

export const DENIAL_CODES = Object.freeze({
  NO_ACTIVE_SUBSCRIPTION: 'NO_ACTIVE_SUBSCRIPTION',
  FEATURE_NOT_IN_PLAN: 'FEATURE_NOT_IN_PLAN',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  UNKNOWN_FEATURE: 'UNKNOWN_FEATURE',
});

const KNOWN_FEATURE_KEYS = new Set(Object.values(FEATURE_KEYS));

function requireTenant(tenantId) {
  const id = tenantId == null ? null : String(tenantId);
  if (!id) throw new ValidationError('tenantId is required for an entitlement check');
  return id;
}

function requireFeatureKey(featureKey) {
  if (!featureKey || !KNOWN_FEATURE_KEYS.has(featureKey)) {
    throw new ValidationError(`Unknown entitlement feature key: ${featureKey}`);
  }
  return featureKey;
}

/** A synthetic Free subscription used when a tenant has no access-granting subscription row. */
function syntheticFreeSubscription(tenantId) {
  return {
    id: null,
    tenant_id: tenantId,
    plan_key: DEFAULT_PLAN_KEY,
    status: 'active', // synthetic Free is always "on" so download-tier features work for everyone
    synthetic: true,
    current_period_start: null,
    current_period_end: null,
  };
}

/** Pull the entitlement map for a plan_key: prefer the DB catalog row, fall back to PLAN_CATALOG. */
async function resolvePlanEntitlements(supabase, planKey) {
  const { data, error } = await supabase
    .from(PLANS_TABLE)
    .select('*')
    .eq('plan_key', planKey)
    .is('deleted_at', null)
    .maybeSingle();
  // A missing catalog table/row is non-fatal: the config catalog is the source of truth fallback.
  if (error && error.code && error.code !== 'PGRST116') {
    // surfaced only for genuine DB faults, not "no rows"
    if (!/not found/i.test(error.message || '')) {
      // fall through to config fallback rather than failing the whole check
    }
  }
  if (data && data.entitlements && typeof data.entitlements === 'object') {
    return { entitlements: data.entitlements, source: 'db', planName: data.name, tier: data.tier };
  }
  const entry = planCatalogEntry(planKey);
  return { entitlements: entry.entitlements, source: 'config', planName: entry.name, tier: entry.tier };
}

/**
 * resolveSubscription — the tenant's access-granting subscription, or a synthetic Free default.
 * Returns the most recent non-deleted subscription whose status grants access; otherwise Free.
 */
export async function resolveSubscription(supabase, tenantId) {
  const id = requireTenant(tenantId);
  const { data, error } = await supabase
    .from(SUBSCRIPTIONS_TABLE)
    .select('*')
    .eq('tenant_id', id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error && error.code && error.code !== 'PGRST116') {
    throw new DatabaseError(`Failed to resolve subscription: ${error.message}`);
  }
  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  const active = rows.find((row) => grantsAccessNow(row));
  if (active) return active;
  // No access-granting subscription: callers still get Free-tier capabilities.
  return syntheticFreeSubscription(id);
}

/**
 * Does this subscription row grant access *right now*?
 *
 * Status alone is not sufficient, and treating it as sufficient made cancellation and expiry no-ops.
 * Nothing in this system ever transitions a row out of 'active': there is no scheduler or job, and
 * the provider deliberately KEEPS status 'active' for an at-period-end cancellation — that is what
 * "cancel at period end" means. So a tenant who cancelled, and was told "access continues until the
 * period ends", kept the full paid entitlement set permanently; so did a tenant whose billing period
 * simply lapsed. The subscription could never end.
 *
 * The period end is therefore authoritative alongside status. A row with no period end retains the
 * previous status-only behaviour, which is what the synthetic Free subscription and any open-ended
 * row depend on.
 */
export function grantsAccessNow(row, now = new Date()) {
  if (!row || !isSubscriptionActiveState(row.status)) return false;
  const periodEnd = row.current_period_end ? new Date(row.current_period_end) : null;
  if (!periodEnd || Number.isNaN(periodEnd.getTime())) return true;
  return periodEnd.getTime() > now.getTime();
}

/** Per-user overrides for a tenant/user, as a feature_key -> value map. */
async function resolveOverrides(supabase, tenantId, userId) {
  if (!userId) return {};
  const { data, error } = await supabase
    .from(OVERRIDES_TABLE)
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('user_id', String(userId))
    .is('deleted_at', null);
  if (error && error.code && error.code !== 'PGRST116') {
    throw new DatabaseError(`Failed to resolve entitlement overrides: ${error.message}`);
  }
  const map = {};
  for (const row of data || []) {
    // value is stored as JSONB; unwrap a primitive-wrapped shape if present.
    map[row.feature_key] = unwrapValue(row.value);
  }
  return map;
}

/** Overrides store JSONB; accept either a raw primitive or a {value:...} envelope. */
function unwrapValue(value) {
  if (value !== null && typeof value === 'object' && 'value' in value && Object.keys(value).length === 1) {
    return value.value;
  }
  return value;
}

/**
 * resolveEffectiveEntitlements — plan entitlements merged with per-user overrides.
 * Returns { planKey, status, source, entitlements } where entitlements is the merged feature map.
 */
export async function resolveEffectiveEntitlements(supabase, tenantId, userId = null) {
  const subscription = await resolveSubscription(supabase, tenantId);
  const { entitlements: planEntitlements, source, planName, tier } = await resolvePlanEntitlements(supabase, subscription.plan_key);
  const overrides = await resolveOverrides(supabase, tenantId, userId);
  const merged = { ...planEntitlements, ...overrides };
  return {
    tenantId: String(tenantId),
    userId: userId == null ? null : String(userId),
    planKey: subscription.plan_key,
    planName,
    tier,
    status: subscription.status,
    source,
    synthetic: Boolean(subscription.synthetic),
    entitlements: merged,
    overrides,
  };
}

/** Structured, explainable denial. */
export function explainDenial({ code, message, featureKey = null, requiredPlan = null, details = null }) {
  return { code, message, featureKey, requiredPlan, details };
}

/**
 * checkFeature — boolean access decision for a feature key.
 * Returns { allowed, reason, requiredPlan, featureKey, value }.
 */
export async function checkFeature(supabase, { tenantId, userId = null, featureKey } = {}) {
  requireTenant(tenantId);
  requireFeatureKey(featureKey);
  const effective = await resolveEffectiveEntitlements(supabase, tenantId, userId);
  const value = effective.entitlements[featureKey];
  const type = entitlementTypeFor(featureKey);

  const granted = type === ENTITLEMENT_TYPES.BOOLEAN
    ? value === true
    : (typeof value === 'number' && value > 0); // integer/date features are "available" when > 0

  if (granted) {
    return { allowed: true, reason: null, requiredPlan: null, featureKey, value, planKey: effective.planKey };
  }
  return {
    allowed: false,
    reason: explainDenial({
      code: DENIAL_CODES.FEATURE_NOT_IN_PLAN,
      message: `Feature ${featureKey} is not included in plan ${effective.planKey}`,
      featureKey,
      requiredPlan: lowestPlanGranting(featureKey),
    }),
    requiredPlan: lowestPlanGranting(featureKey),
    featureKey,
    value,
    planKey: effective.planKey,
  };
}

/**
 * checkQuota — point-in-time quota usage for a metered/integer feature.
 * Returns { limit, used, remaining, featureKey, planKey }.
 */
export async function checkQuota(supabase, { tenantId, featureKey, userId = null, periodStart = null } = {}) {
  requireTenant(tenantId);
  requireFeatureKey(featureKey);
  const effective = await resolveEffectiveEntitlements(supabase, tenantId, userId);
  const limit = Number(effective.entitlements[featureKey]) || 0;
  const period = periodStart || currentPeriodStart();

  let used = 0;
  if (isMeteredFeature(featureKey)) {
    const { data, error } = await supabase
      .from(METERS_TABLE)
      .select('*')
      .eq('tenant_id', String(tenantId))
      .eq('feature_key', featureKey)
      .eq('period_start', period)
      .maybeSingle();
    if (error && error.code && error.code !== 'PGRST116') {
      throw new DatabaseError(`Failed to read usage meter: ${error.message}`);
    }
    used = Number(data?.used_count) || 0;
  }
  return {
    featureKey,
    planKey: effective.planKey,
    limit,
    used,
    remaining: Math.max(limit - used, 0),
    metered: isMeteredFeature(featureKey),
    periodStart: period,
  };
}

/** First day of the current UTC month (billing-period boundary) as an ISO string. */
export function currentPeriodStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** First day of the next UTC month as an ISO string. */
export function currentPeriodEnd(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

/**
 * reserveUsage — atomically reserve `amount` of a metered feature's quota via the RPC.
 * Idempotent on idempotencyKey: a replay returns the prior reservation without double counting.
 * Rejects with an explainable denial when the quota would be exceeded.
 *
 * Returns { reserved, used, remaining, reservationId, status, idempotentReplay }.
 */
export async function reserveUsage(supabase, {
  tenantId, userId = null, featureKey, amount = 1, idempotencyKey, periodStart = null, periodEnd = null,
} = {}) {
  requireTenant(tenantId);
  requireFeatureKey(featureKey);
  if (!idempotencyKey) throw new ValidationError('idempotencyKey is required to reserve usage');
  if (!(Number(amount) > 0)) throw new ValidationError('amount must be a positive integer');

  const quota = await checkQuota(supabase, { tenantId, featureKey, userId, periodStart });
  if (quota.limit <= 0) {
    const requiredPlan = lowestPlanGranting(featureKey);
    throw new ForbiddenError(
      `Quota for ${featureKey} is not available on plan ${quota.planKey}`,
      explainDenial({
        code: DENIAL_CODES.FEATURE_NOT_IN_PLAN,
        message: `Feature ${featureKey} has no quota on plan ${quota.planKey}`,
        featureKey,
        requiredPlan,
      }),
    );
  }

  const pStart = periodStart || quota.periodStart;
  const pEnd = periodEnd || currentPeriodEnd();

  const { data, error } = await supabase.rpc(RESERVE_RPC, {
    p_tenant_id: String(tenantId),
    p_user_id: userId == null ? null : String(userId),
    p_feature_key: featureKey,
    p_amount: Number(amount),
    p_quota_limit: quota.limit,
    p_period_start: pStart,
    p_period_end: pEnd,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    if (/QUOTA_EXCEEDED/i.test(error.message || '')) {
      throw new ForbiddenError(
        `Usage quota exceeded for ${featureKey}`,
        explainDenial({
          code: DENIAL_CODES.QUOTA_EXCEEDED,
          message: `Reserving ${amount} would exceed the ${quota.limit} quota for ${featureKey}`,
          featureKey,
          requiredPlan: lowestPlanGranting(featureKey),
          details: { limit: quota.limit, used: quota.used },
        }),
      );
    }
    throw new DatabaseError(`Usage reservation failed: ${error.message}`);
  }
  return data;
}

/** Load a reservation row (helper for commit/release). */
async function loadReservation(supabase, reservationId) {
  const { data, error } = await supabase
    .from(RESERVATIONS_TABLE)
    .select('*')
    .eq('id', reservationId)
    .maybeSingle();
  if (error && error.code && error.code !== 'PGRST116') {
    throw new DatabaseError(`Failed to load reservation: ${error.message}`);
  }
  if (!data) throw new ValidationError(`Reservation ${reservationId} not found`);
  return data;
}

/**
 * commitUsage — transition a RESERVED reservation to COMMITTED. Idempotent: committing an already
 * COMMITTED reservation is a no-op success. Writes a CRITICAL audit row (domain-tied consumption).
 */
export async function commitUsage(supabase, { reservationId, actor = null, req = null } = {}) {
  if (!reservationId) throw new ValidationError('reservationId is required to commit usage');
  const reservation = await loadReservation(supabase, reservationId);
  if (reservation.status === 'COMMITTED') {
    return { reservationId, status: 'COMMITTED', idempotentReplay: true };
  }
  if (reservation.status === 'RELEASED') {
    throw new ValidationError('A released reservation cannot be committed');
  }

  const { data, error } = await supabase
    .from(RESERVATIONS_TABLE)
    .update({ status: 'COMMITTED', updated_at: new Date().toISOString() })
    .eq('id', reservationId)
    .select()
    .single();
  if (error) throw new DatabaseError(`Failed to commit reservation: ${error.message}`);

  await appendCriticalAudit(supabase, {
    actorId: actor || reservation.user_id || null,
    tenantId: reservation.tenant_id,
    action: 'ENTITLEMENT_USAGE_COMMITTED',
    resourceType: 'diaspora_usage_reservation',
    resourceId: String(reservationId),
    previousState: { status: reservation.status },
    newState: { status: 'COMMITTED' },
    metadata: { featureKey: reservation.feature_key, amount: reservation.amount },
    req,
  });
  return { reservationId, status: 'COMMITTED', idempotentReplay: false, reservation: data };
}

/**
 * releaseUsage — transition a RESERVED reservation to RELEASED and DECREMENT the meter, freeing the
 * quota (used after a failed domain operation). Idempotent: releasing an already RELEASED reservation
 * is a no-op and does NOT decrement the meter twice. A COMMITTED reservation cannot be released.
 */
export async function releaseUsage(supabase, { reservationId, actor = null, req = null } = {}) {
  if (!reservationId) throw new ValidationError('reservationId is required to release usage');
  const reservation = await loadReservation(supabase, reservationId);
  if (reservation.status === 'RELEASED') {
    return { reservationId, status: 'RELEASED', idempotentReplay: true };
  }
  if (reservation.status === 'COMMITTED') {
    throw new ValidationError('A committed reservation cannot be released');
  }

  // Decrement the meter for this period by the reserved amount (never below zero).
  const { data: meter, error: meterError } = await supabase
    .from(METERS_TABLE)
    .select('*')
    .eq('tenant_id', reservation.tenant_id)
    .eq('feature_key', reservation.feature_key)
    .eq('period_start', reservation.period_start)
    .maybeSingle();
  if (meterError && meterError.code && meterError.code !== 'PGRST116') {
    throw new DatabaseError(`Failed to read meter on release: ${meterError.message}`);
  }
  if (meter) {
    const newUsed = Math.max(Number(meter.used_count || 0) - Number(reservation.amount || 0), 0);
    const { error: updErr } = await supabase
      .from(METERS_TABLE)
      .update({ used_count: newUsed, updated_at: new Date().toISOString() })
      .eq('id', meter.id)
      .select()
      .single();
    if (updErr) throw new DatabaseError(`Failed to decrement meter on release: ${updErr.message}`);
  }

  const { data, error } = await supabase
    .from(RESERVATIONS_TABLE)
    .update({ status: 'RELEASED', updated_at: new Date().toISOString() })
    .eq('id', reservationId)
    .select()
    .single();
  if (error) throw new DatabaseError(`Failed to release reservation: ${error.message}`);

  await appendCriticalAudit(supabase, {
    actorId: actor || reservation.user_id || null,
    tenantId: reservation.tenant_id,
    action: 'ENTITLEMENT_USAGE_RELEASED',
    resourceType: 'diaspora_usage_reservation',
    resourceId: String(reservationId),
    previousState: { status: reservation.status },
    newState: { status: 'RELEASED' },
    metadata: { featureKey: reservation.feature_key, amount: reservation.amount },
    req,
  });
  return { reservationId, status: 'RELEASED', idempotentReplay: false, reservation: data };
}

/**
 * applyAdminOverride — write/replace a per-user entitlement override. Restricted to a server-derived
 * platform/tenant admin (the caller passes `actor`; roles are never read from client headers here).
 * Writes a CRITICAL audit row (fail-loud) because an override changes a security decision.
 */
export async function applyAdminOverride(supabase, {
  tenantId, userId, featureKey, value, actor, reason = null, req = null,
} = {}) {
  requireTenant(tenantId);
  requireFeatureKey(featureKey);
  if (!userId) throw new ValidationError('userId is required for an entitlement override');
  if (value === undefined) throw new ValidationError('value is required for an entitlement override');
  if (!actor || !actor.id) throw new ValidationError('A server-derived admin actor is required to override entitlements');
  const role = String(actor.platformRole ?? actor.tenantRole ?? actor.role ?? '').toLowerCase();
  const isPlatformAdmin = ['admin', 'platform_admin', 'super_admin'].includes(role);
  const isTenantAdmin = ['admin', 'administrator', 'tenant_admin'].includes(role)
    && String(actor.tenantId ?? actor.tenant_id ?? '') === String(tenantId);
  if (!isPlatformAdmin && !isTenantAdmin) {
    throw new ForbiddenError('Only a platform or tenant admin may override entitlements');
  }

  const row = {
    tenant_id: String(tenantId),
    user_id: String(userId),
    feature_key: featureKey,
    value, // JSONB; stored as-is
    reason,
    created_by: actor.id,
    updated_by: actor.id,
  };

  // Upsert-on-conflict semantics: replace any existing non-deleted override for this triple.
  const { data: existingList } = await supabase
    .from(OVERRIDES_TABLE)
    .select('*')
    .eq('tenant_id', String(tenantId))
    .eq('user_id', String(userId))
    .eq('feature_key', featureKey)
    .is('deleted_at', null);
  const existing = (existingList || [])[0];

  let saved;
  if (existing) {
    const { data, error } = await supabase
      .from(OVERRIDES_TABLE)
      .update({ value, reason, updated_by: actor.id, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw new DatabaseError(`Failed to update entitlement override: ${error.message}`);
    saved = data;
  } else {
    const { data, error } = await supabase.from(OVERRIDES_TABLE).insert(row).select().single();
    if (error) throw new DatabaseError(`Failed to write entitlement override: ${error.message}`);
    saved = data;
  }

  await appendCriticalAudit(supabase, {
    actorId: actor.id,
    tenantId: String(tenantId),
    action: 'ENTITLEMENT_OVERRIDE_APPLIED',
    resourceType: 'diaspora_user_entitlement_override',
    resourceId: String(saved.id),
    previousState: existing ? { value: existing.value } : null,
    newState: { value },
    metadata: { featureKey, userId: String(userId), reason },
    req,
  });
  return saved;
}

export const ENTITLEMENT_TABLES = Object.freeze({
  PLANS_TABLE, SUBSCRIPTIONS_TABLE, OVERRIDES_TABLE, METERS_TABLE, RESERVATIONS_TABLE,
});
export { PLAN_CATALOG };
