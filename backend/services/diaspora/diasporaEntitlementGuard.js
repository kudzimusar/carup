/**
 * Phase 8 (M2) — Entitlement enforcement guard.
 *
 * A thin, flag-gated wrapper over diasporaEntitlementService that domain services call to enforce
 * feature/quota access on real operations. Enforcement is OFF by default
 * (isSubscriptionEnforcementEnabled()): when off, every guard call is a byte-identical no-op so
 * existing flows are never altered. When on, a denied feature throws the existing access-denied error
 * (ForbiddenError) carrying a structured, explainable denial (code, message, requiredPlan, featureKey),
 * and quota is reserved/committed/released through the atomic usage RPC.
 *
 * Conventions (match the rest of the diaspora services):
 *  - The supabase client is the first argument (injectable mock in tests).
 *  - Server-derived tenantId/userId only; never a client-trusted role.
 *  - ForbiddenError is the canonical access-denied 403 used across diaspora services.
 */
import { ForbiddenError } from '../../utils/errors.js';
import { isSubscriptionEnforcementEnabled } from '../../constants/diaspora/diasporaBillingConstants.js';
import {
  checkFeature,
  reserveUsage,
  commitUsage,
  releaseUsage,
  explainDenial,
  DENIAL_CODES,
} from './diasporaEntitlementService.js';

/**
 * requireFeature — assert a tenant/user may use a feature. No-op (returns {allowed,enforced:false})
 * when enforcement is off. When on and the feature is denied, throws ForbiddenError with the structured
 * denial as `.details` (code, message, requiredPlan, featureKey).
 */
export async function requireFeature(supabase, { tenantId, userId = null, featureKey } = {}) {
  if (!isSubscriptionEnforcementEnabled()) {
    return { allowed: true, enforced: false };
  }
  const result = await checkFeature(supabase, { tenantId, userId, featureKey });
  if (!result.allowed) {
    const denial = result.reason || explainDenial({
      code: DENIAL_CODES.FEATURE_NOT_IN_PLAN,
      message: `Feature ${featureKey} is not available on the current plan`,
      featureKey,
      requiredPlan: result.requiredPlan ?? null,
    });
    throw new ForbiddenError(denial.message, denial);
  }
  return { allowed: true, enforced: true, planKey: result.planKey, value: result.value };
}

/**
 * reserveQuotaForFeature — reserve `amount` of a metered/quota feature and return a handle whose
 * commit() finalizes consumption and release() frees it. When enforcement is off this is a no-op handle
 * (enforced:false) so callers can unconditionally commit()/release() without side effects.
 *
 * Idempotent via idempotencyKey: a replay returns the prior reservation without double counting.
 */
export async function reserveQuotaForFeature(supabase, {
  tenantId, userId = null, featureKey, amount = 1, idempotencyKey,
} = {}) {
  if (!isSubscriptionEnforcementEnabled()) {
    return {
      enforced: false,
      reservationId: null,
      async commit() { return { enforced: false, status: 'NOOP' }; },
      async release() { return { enforced: false, status: 'NOOP' }; },
    };
  }

  const reservation = await reserveUsage(supabase, { tenantId, userId, featureKey, amount, idempotencyKey });
  const reservationId = reservation?.reservationId ?? null;
  let settled = false;

  return {
    enforced: true,
    reservationId,
    reservation,
    async commit({ actor = userId ?? null, req = null } = {}) {
      if (settled || !reservationId) return { enforced: true, status: 'NOOP' };
      settled = true;
      return commitUsage(supabase, { reservationId, actor, req });
    },
    async release({ actor = userId ?? null, req = null } = {}) {
      if (settled || !reservationId) return { enforced: true, status: 'NOOP' };
      settled = true;
      return releaseUsage(supabase, { reservationId, actor, req });
    },
  };
}

/**
 * withEntitlement — convenience that (1) requires the feature, (2) reserves quota, (3) runs the async
 * domain fn, (4) commits on success / releases on throw. The domain fn receives the reservation handle.
 *
 * When enforcement is off this simply runs the domain fn (no feature check, no quota write) so behavior
 * is byte-identical to today. Idempotent via idempotencyKey on the reservation.
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string|null} [opts.userId]
 * @param {string} opts.featureKey         feature to require (boolean gate)
 * @param {string} [opts.quotaFeatureKey]  quota feature to reserve (defaults to featureKey)
 * @param {number} [opts.amount=1]
 * @param {string} opts.idempotencyKey
 * @param {object|null} [opts.req]         request, for audit metadata
 * @param {(handle)=>Promise<any>} fn      the domain operation
 */
export async function withEntitlement(supabase, {
  tenantId, userId = null, featureKey, quotaFeatureKey = null, amount = 1, idempotencyKey, req = null,
} = {}, fn) {
  if (typeof fn !== 'function') {
    throw new TypeError('withEntitlement requires an async domain function');
  }

  if (!isSubscriptionEnforcementEnabled()) {
    // No-op fast path: no feature check, no quota write — identical to pre-enforcement behavior.
    return fn({ enforced: false, reservationId: null });
  }

  await requireFeature(supabase, { tenantId, userId, featureKey });

  const handle = await reserveQuotaForFeature(supabase, {
    tenantId,
    userId,
    featureKey: quotaFeatureKey || featureKey,
    amount,
    idempotencyKey,
  });

  try {
    const out = await fn(handle);
    await handle.commit({ actor: userId ?? null, req });
    return out;
  } catch (err) {
    // Free the reserved quota so a failed domain op never permanently consumes it.
    try {
      await handle.release({ actor: userId ?? null, req });
    } catch {
      // Release is best-effort on the failure path; never mask the original domain error.
    }
    throw err;
  }
}
