/**
 * CARUP-PAY-03B-LR01 Work Unit 04 — bounded interoperability layer between the PAY-02/PAY-03B commercial registry
 * and the EXISTING Diaspora subscription authority.
 *
 * Diaspora tenants keep public.diaspora_subscriptions as their only subscription authority, written only by the
 * existing writer (syncSubscriptionFromSnapshot) and read only by the existing resolver
 * (resolveEffectiveEntitlements). This bridge never creates a second Diaspora record; it only decides WHETHER a
 * verified provider state may be applied and WHAT the writer receives:
 *  - the governed plan must be a Diaspora-authority plan that is activatable (an approved free tier, or a
 *    sandbox-only plan; every paid Diaspora tariff is commercially blocked in this foundation, so paid Diaspora
 *    activation through PAY-03B is refused at the registry level until an Owner-approved plan version exists);
 *  - the provider snapshot must be complete (the legacy writer defaults a missing status to 'active' on first
 *    insert, so an incomplete snapshot is refused here and never reaches it);
 *  - paid access is bounded by PAID coverage: the period end the writer receives is the paid-through time, and a
 *    provider-active subscription with no paid period is written as 'incomplete' (no access).
 */
import { Pay03bError } from './pay03bContract.js';
import { syncSubscriptionFromSnapshot } from '../diaspora/billing/diasporaBillingSubscriptionSync.js';
import { resolveEffectiveEntitlements } from '../diaspora/diasporaEntitlementService.js';

const STATUS_MAP = Object.freeze({
  incomplete: 'incomplete', incomplete_expired: 'expired', trialing: 'trialing', active: 'active',
  past_due: 'past_due', unpaid: 'suspended', canceled: 'cancelled', paused: 'paused',
});

export function isDiasporaPlanActivatable(plan) {
  if (!plan || plan.subscription_authority !== 'diaspora_subscriptions' || !plan.authority_plan_key || plan.effective_to) return false;
  return (plan.pricing_kind === 'free' && plan.activation_status === 'approved')
    || (plan.pricing_kind === 'sandbox_fixture' && plan.activation_status === 'sandbox_only');
}

export async function applyVerifiedSubscriptionToDiaspora({
  db, tenantId, plan, snapshot, paidThrough = null, actorId = null, gateway, now = new Date(),
}) {
  if (!tenantId) throw new Pay03bError('PAY03B_DIASPORA_TENANT_REQUIRED', 400);
  if (!plan || plan.subscription_authority !== 'diaspora_subscriptions') {
    throw new Pay03bError('PAY03B_DIASPORA_AUTHORITY_MISMATCH', 409);
  }
  if (!isDiasporaPlanActivatable(plan)) throw new Pay03bError('PAY03B_DIASPORA_PLAN_NOT_ACTIVATABLE', 409);
  const mapped = STATUS_MAP[snapshot?.status];
  if (!mapped || !snapshot.id || !snapshot.customerId || !snapshot.currentPeriodStart || !snapshot.currentPeriodEnd
    || typeof snapshot.cancelAtPeriodEnd !== 'boolean' || !gateway) {
    throw new Pay03bError('PAY03B_DIASPORA_SNAPSHOT_INCOMPLETE', 409);
  }
  const paidUntil = paidThrough ? new Date(paidThrough) : null;
  const paidNow = Boolean(paidUntil && paidUntil > now);
  let status = mapped;
  let periodEnd = snapshot.currentPeriodEnd;
  if (['active', 'trialing'].includes(mapped)) {
    // Access in Diaspora = status in (active, trialing, grace_period) AND current_period_end in the future, so the
    // period end it sees is the PAID coverage, and unpaid "active" is written as incomplete.
    status = paidNow ? mapped : 'incomplete';
    periodEnd = paidNow ? paidUntil.toISOString() : null;
  }
  const row = await syncSubscriptionFromSnapshot(db, {
    tenantId,
    planKey: plan.authority_plan_key,
    status,
    currentPeriodStart: snapshot.currentPeriodStart,
    currentPeriodEnd: periodEnd,
    provider: gateway,
    providerCustomerRef: snapshot.customerId,
    providerSubscriptionRef: snapshot.id,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
  }, actorId);
  return { subscription: row, entitlements: await resolveEffectiveEntitlements(db, tenantId) };
}
