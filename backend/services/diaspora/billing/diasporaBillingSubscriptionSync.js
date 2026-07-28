/**
 * Diaspora GTM — apply an authoritative provider snapshot to the subscription ledger.
 *
 * Extracted, byte-for-byte in behaviour, from `diasporaSubscriptionRoutes.js` (Phase 2E). It moved
 * because it now has a second caller: the scheduled retry of a provider event that was claimed but
 * never applied. Leaving it in the route would have meant either a service importing a route — a
 * dependency in the wrong direction, and an import cycle waiting to happen — or a second copy of the
 * only function that writes subscription state, which is exactly the code that must not be duplicated.
 *
 * The discipline it enforces is unchanged and is the reason it is a single function:
 *   · status / plan / period come ONLY from a provider-verified snapshot, never from a client;
 *   · one non-deleted subscription row per tenant — update in place, else insert;
 *   · `undefined` keys are dropped, so a partial snapshot never NULLs a column it did not carry. A
 *     payment-succeeded event that mentions no plan must not erase the plan.
 */
import { ValidationError } from '../../../utils/errors.js';
import { BILLING_PROVIDERS } from '../../../constants/diaspora/diasporaBillingConstants.js';
import { SUBSCRIPTION_STATES } from '../../../constants/diaspora/diasporaEntitlements.js';

export const SUBSCRIPTIONS_TABLE = 'diaspora_subscriptions';

/**
 * Upsert the tenant's subscription from an authoritative provider snapshot.
 *
 * @param {object} supabase service-role (or mock) client
 * @param {{tenantId:string, planKey?:string, status?:string, currentPeriodStart?:string,
 *          currentPeriodEnd?:string, provider?:string, providerCustomerRef?:string,
 *          providerSubscriptionRef?:string, cancelAtPeriodEnd?:boolean}} snapshot
 * @param {string|null} actorId
 */
export async function syncSubscriptionFromSnapshot(supabase, snapshot, actorId = null) {
  const tenantId = snapshot.tenantId;
  if (!tenantId) throw new ValidationError('A tenantId is required to sync a subscription');

  const update = {
    plan_key: snapshot.planKey || undefined,
    status: snapshot.status || undefined,
    current_period_start: snapshot.currentPeriodStart ?? undefined,
    current_period_end: snapshot.currentPeriodEnd ?? undefined,
    provider: snapshot.provider || BILLING_PROVIDERS.SANDBOX,
    provider_customer_ref: snapshot.providerCustomerRef ?? undefined,
    provider_subscription_ref: snapshot.providerSubscriptionRef ?? undefined,
    cancel_at_period_end: snapshot.cancelAtPeriodEnd ?? undefined,
    updated_by: actorId || undefined,
    updated_at: new Date().toISOString(),
  };
  // Drop undefined keys so we never null out columns the snapshot did not carry.
  for (const k of Object.keys(update)) if (update[k] === undefined) delete update[k];

  const { data: existingList } = await supabase
    .from(SUBSCRIPTIONS_TABLE)
    .select('*')
    .eq('tenant_id', String(tenantId))
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  const existing = (Array.isArray(existingList) ? existingList : (existingList ? [existingList] : []))[0];

  if (existing) {
    const { data, error } = await supabase
      .from(SUBSCRIPTIONS_TABLE)
      .update(update)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw new ValidationError(`Failed to update subscription: ${error.message}`);
    return data;
  }

  const insertRow = {
    tenant_id: String(tenantId),
    plan_key: snapshot.planKey || 'free',
    status: snapshot.status || SUBSCRIPTION_STATES.ACTIVE,
    current_period_start: snapshot.currentPeriodStart ?? null,
    current_period_end: snapshot.currentPeriodEnd ?? null,
    provider: snapshot.provider || BILLING_PROVIDERS.SANDBOX,
    provider_customer_ref: snapshot.providerCustomerRef ?? null,
    provider_subscription_ref: snapshot.providerSubscriptionRef ?? null,
    cancel_at_period_end: snapshot.cancelAtPeriodEnd ?? false,
    created_by: actorId || null,
    updated_by: actorId || null,
  };
  const { data, error } = await supabase
    .from(SUBSCRIPTIONS_TABLE)
    .insert(insertRow)
    .select()
    .single();
  if (error) throw new ValidationError(`Failed to create subscription: ${error.message}`);
  return data;
}
