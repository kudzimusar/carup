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
import { ValidationError, ForbiddenError, DatabaseError, ConflictError, NotFoundError } from '../../utils/errors.js';
import { appendCriticalAudit, requestCorrelationId } from './diasporaServiceUtils.js';
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
const APPLY_OVERRIDE_RPC = 'diaspora_apply_entitlement_override_atomic';
const REVOKE_OVERRIDE_RPC = 'diaspora_revoke_entitlement_override_atomic';

/** Outcomes the override RPCs report, so callers can distinguish a re-grant from an edit. */
export const OVERRIDE_OUTCOMES = Object.freeze({
  GRANTED: 'GRANTED',
  REGRANTED: 'REGRANTED',
  UPDATED: 'UPDATED',
  UNCHANGED: 'UNCHANGED',
  REVOKED: 'REVOKED',
  ALREADY_REVOKED: 'ALREADY_REVOKED',
});

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

/**
 * Pull the entitlement map for a plan_key: prefer the DB catalog row, fall back to PLAN_CATALOG.
 *
 * This filtered `.is('deleted_at', null)`, and `diaspora_subscription_plans` HAS NO SUCH COLUMN.
 * Ledger #12 creates it with id / plan_key / name / tier / description / price_config / entitlements
 * / is_active / sort_order / metadata / created_at / updated_at, and no later migration adds one.
 * PostgREST compiles that filter straight into SQL, Postgres raises 42703, and the error branch below
 * was an empty `if` containing only a comment — so nothing threw, nothing logged, `data` was null, and
 * EVERY read fell through to the config catalog.
 *
 * The documented contract was therefore inverted: the DB catalog was unreachable and the
 * `source: 'db'` branch was dead code in production. An operator who edited a plan's entitlements in
 * the database — to raise a pilot tenant's allowance, say — would see the old limit enforced, the old
 * limit reported by GET /entitlements, and no error anywhere. Every guarded operation also paid a
 * failed round-trip per check.
 *
 * No test could catch it: mockSupabase's `.is(col, null)` matches rows whose value is nullish, and a
 * column that does not exist on a row reads as `undefined` — so the mock returned the seeded plan
 * where PostgREST returns a 400.
 *
 * `is_active` is the column that actually expresses "this plan is retired", so that is what is
 * filtered on now. A genuine DB fault is logged rather than swallowed: falling back to config is
 * still right (a catalog outage must not deny a paying tenant their plan), but doing it SILENTLY is
 * exactly how this survived.
 */
async function resolvePlanEntitlements(supabase, planKey) {
  const { data, error } = await supabase
    .from(PLANS_TABLE)
    .select('*')
    .eq('plan_key', planKey)
    .eq('is_active', true)
    .maybeSingle();
  // PGRST116 is "no rows", an ordinary answer. Anything else is a real fault that the fallback below
  // hides from the caller, so it must at least be visible in the logs.
  if (error && error.code && error.code !== 'PGRST116') {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({
      level: 'WARN',
      category: 'DIASPORA_ENTITLEMENT',
      message: 'plan.catalog.read_failed',
      planKey,
      code: error.code,
      detail: String(error.message || '').slice(0, 200),
      effect: 'falling back to the PLAN_CATALOG config for this check',
    }));
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

  // Ledger #25. This used to be a read-modify-write across two tables with no lock: read the
  // reservation, read the meter, write used_count = max(used - amount, 0), write the status. Two
  // releases of the SAME reservation racing each other both passed the status check (neither had
  // flipped it yet), both read the same used_count, and both wrote the same decrement — the meter
  // gave back `amount` once but was credited for it twice, INFLATING remaining quota so a tenant
  // could exceed their plan.
  //
  // The RPC does the whole sequence in one transaction under a row lock, so the second caller blocks
  // and then observes RELEASED as an idempotent no-op. The audit row is written inside that same
  // transaction, so a released reservation cannot exist without its record.
  const { data, error } = await supabase.rpc('diaspora_release_usage_atomic', {
    p_reservation_id: reservationId,
    p_actor_id: actor || null,
    p_correlation_id: requestCorrelationId(req),
  });

  if (error) {
    const message = String(error.message || '');
    if (message.includes('CANNOT_RELEASE_COMMITTED')) {
      throw new ValidationError('A committed reservation cannot be released');
    }
    if (message.includes('RESERVATION_NOT_FOUND')) {
      throw new ValidationError('Reservation not found');
    }
    throw new DatabaseError(`Failed to release reservation: ${message}`);
  }

  return {
    reservationId,
    status: 'RELEASED',
    idempotentReplay: Boolean(data?.idempotentReplay),
    reservation: data?.reservation ?? null,
    meterBefore: data?.meterBefore ?? null,
    meterAfter: data?.meterAfter ?? null,
  };
}

/**
 * Server-derived admin gate for every override mutation.
 *
 * The role is read from the ACTOR the caller assembled server-side, never from a request body or a
 * header, and a tenant admin is only an admin OF THEIR OWN TENANT — the tenantId compared here is the
 * one the operation will act on, so a tenant admin cannot grant themselves anything in another tenant.
 */
function assertOverrideAdmin(actor, tenantId) {
  if (!actor || !actor.id) {
    throw new ValidationError('A server-derived admin actor is required to override entitlements');
  }
  const role = String(actor.platformRole ?? actor.tenantRole ?? actor.role ?? '').toLowerCase();
  const isPlatformAdmin = ['admin', 'platform_admin', 'super_admin'].includes(role);
  const isTenantAdmin = ['admin', 'administrator', 'tenant_admin'].includes(role)
    && String(actor.tenantId ?? actor.tenant_id ?? '') === String(tenantId);
  if (!isPlatformAdmin && !isTenantAdmin) {
    throw new ForbiddenError('Only a platform or tenant admin may override entitlements');
  }
}

/**
 * Translate an override-RPC error into the right HTTP shape.
 *
 * 23505 is the specific failure this whole path exists to eliminate, so it gets its own branch: if it
 * ever escapes the RPC's ON CONFLICT it means two writers genuinely collided, which is a 409 the
 * caller can retry — never the generic 500 the previous read-then-insert produced, whose message
 * named a constraint and told an operator nothing about what to do.
 */
function overrideRpcError(error, verb) {
  const message = String(error?.message || '');
  if (error?.code === '23505' || /duplicate key value|unique constraint/i.test(message)) {
    return new ConflictError(
      'This entitlement override was being changed concurrently. Retry the request.',
      { code: 'ENTITLEMENT_OVERRIDE_CONFLICT' },
    );
  }
  if (message.includes('OVERRIDE_NOT_FOUND')) {
    return new NotFoundError('No entitlement override exists for that tenant, user and feature');
  }
  if (message.includes('ACTOR_REQUIRED')) {
    return new ValidationError('A server-derived admin actor is required to override entitlements');
  }
  if (message.includes('TENANT_REQUIRED')) return new ValidationError('tenantId is required');
  if (message.includes('USER_REQUIRED')) return new ValidationError('userId is required');
  if (message.includes('FEATURE_REQUIRED')) return new ValidationError('featureKey is required');
  if (message.includes('VALUE_REQUIRED')) return new ValidationError('value is required');
  return new DatabaseError(`Failed to ${verb} entitlement override: ${message}`);
}

/**
 * applyAdminOverride — grant, update or RE-GRANT a per-user entitlement override.
 *
 * The re-grant case is why this goes through an RPC (ledger #26). Overrides are soft-deleted, but the
 * table's unique constraint on (tenant_id, user_id, feature_key) has no deleted_at predicate, so a
 * revoked override keeps its unique slot forever. The old implementation looked only at non-deleted
 * rows, could not see the tombstone, took the INSERT branch and hit 23505 — which surfaced as a 500.
 * A revoked capability could therefore never be granted again, by anyone, through any path.
 *
 * diaspora_apply_entitlement_override_atomic locks the logical row (soft-deleted included), upserts
 * ON CONFLICT clearing deleted_at, and writes the audit row in the SAME transaction, with a distinct
 * action per outcome so a re-grant is visible as a re-grant.
 *
 * tenantId / userId / featureKey are the caller's server-derived arguments and are used verbatim by
 * the RPC in both the lookup and the audit row; no row id is accepted, so no request can address
 * another tenant's override.
 */
export async function applyAdminOverride(supabase, {
  tenantId, userId, featureKey, value, actor, reason = null, req = null,
} = {}) {
  requireTenant(tenantId);
  requireFeatureKey(featureKey);
  if (!userId) throw new ValidationError('userId is required for an entitlement override');
  if (value === undefined) throw new ValidationError('value is required for an entitlement override');
  assertOverrideAdmin(actor, tenantId);

  const { data, error } = await supabase.rpc(APPLY_OVERRIDE_RPC, {
    p_tenant_id: String(tenantId),
    p_user_id: String(userId),
    p_feature_key: featureKey,
    p_value: value,
    p_actor_id: String(actor.id),
    p_reason: reason,
    p_correlation_id: requestCorrelationId(req),
  });
  if (error) throw overrideRpcError(error, 'write');

  const saved = data?.override ?? null;
  if (!saved) throw new DatabaseError('Entitlement override RPC returned no row');
  return { ...saved, outcome: data.outcome, action: data.action };
}

/**
 * revokeAdminOverride — withdraw a per-user entitlement override.
 *
 * This half simply did not exist: the service could grant but never take back, so every revoke came
 * from data fixes or support tooling stamping deleted_at directly — which is exactly how a row ends up
 * soft-deleted with nobody aware that the slot is now permanently blocked.
 *
 * Idempotent: revoking an already-revoked override is a no-op that does NOT rewrite deleted_at, so the
 * timestamp keeps saying when the capability was actually withdrawn.
 */
export async function revokeAdminOverride(supabase, {
  tenantId, userId, featureKey, actor, reason = null, req = null,
} = {}) {
  requireTenant(tenantId);
  requireFeatureKey(featureKey);
  if (!userId) throw new ValidationError('userId is required to revoke an entitlement override');
  assertOverrideAdmin(actor, tenantId);

  const { data, error } = await supabase.rpc(REVOKE_OVERRIDE_RPC, {
    p_tenant_id: String(tenantId),
    p_user_id: String(userId),
    p_feature_key: featureKey,
    p_actor_id: String(actor.id),
    p_reason: reason,
    p_correlation_id: requestCorrelationId(req),
  });
  if (error) throw overrideRpcError(error, 'revoke');

  const revoked = data?.override ?? null;
  return {
    ...(revoked || {}),
    outcome: data?.outcome ?? OVERRIDE_OUTCOMES.REVOKED,
    action: data?.action ?? 'ENTITLEMENT_OVERRIDE_REVOKED',
    idempotentReplay: Boolean(data?.idempotentReplay),
  };
}

export const ENTITLEMENT_TABLES = Object.freeze({
  PLANS_TABLE, SUBSCRIPTIONS_TABLE, OVERRIDES_TABLE, METERS_TABLE, RESERVATIONS_TABLE,
});
export { PLAN_CATALOG };
