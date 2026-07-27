// Mounted by integrator at /api/diaspora/subscription
/**
 * Phase 8 (M2) — Diaspora subscription + billing API.
 *
 * Read endpoints (plans/status/entitlements/usage) are tenant-scoped to any authenticated user.
 * Mutating endpoints (checkout/portal/change-plan/cancel) drive the SANDBOX billing provider — no real
 * network is ever touched (the provider factory fails closed unless an approved live provider is wired).
 * The webhook verifies the provider signature, is idempotent on (provider, event_id), and is the ONLY
 * path that mutates subscription state — client-submitted status is never trusted.
 *
 * Testability: handlers resolve the supabase client and billing provider through the same injection
 * seam the services use (resolveClient / selectBillingProvider), so tests pass a mock client and a
 * sandbox provider without any network. The router is NOT mounted here; the integrator mounts it.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { ValidationError } from '../utils/errors.js';
import { resolveClient } from '../services/diaspora/diasporaServiceUtils.js';
import { assertCanManageSubscription } from '../services/diaspora/diasporaAuthorization.js';
import { selectBillingProvider } from '../services/diaspora/billing/billingProvider.js';
import {
  resolveSubscription,
  resolveEffectiveEntitlements,
  checkQuota,
  currentPeriodStart,
  ENTITLEMENT_TABLES,
} from '../services/diaspora/diasporaEntitlementService.js';
import {
  PLAN_CATALOG,
  PLAN_KEYS,
  METERED_FEATURE_KEYS,
  SUBSCRIPTION_STATES,
  isSubscriptionActiveState,
} from '../constants/diaspora/diasporaEntitlements.js';
import { BILLING_PROVIDERS } from '../constants/diaspora/diasporaBillingConstants.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// Same auth seam diasporaRoutes.js uses: any authenticated user, tenant context injected on req.userContext.
const auth = authorizeRole();

const SUBSCRIPTIONS_TABLE = ENTITLEMENT_TABLES.SUBSCRIPTIONS_TABLE;
const EVENTS_TABLE = 'diaspora_billing_provider_events';

/**
 * Per-request injection seam (tests set req.app.locals.diasporaTestDeps). Falls back to the real
 * service-role client and the (sandbox) provider factory. No network at import or selection time.
 */
async function deps(req) {
  const injected = req.app?.locals?.diasporaTestDeps || {};
  const supabase = await resolveClient({ supabaseClient: injected.supabaseClient });
  const billing = selectBillingProvider({ billingProvider: injected.billingProvider });
  return { supabase, billing };
}

/** The tenant a request is acting on. Subscriptions are tenant-scoped (PD-1); a tenant is required. */
function requireTenantId(req) {
  const tenantId = req.userContext?.tenantId || null;
  if (!tenantId) {
    throw new ValidationError('An x-tenant-id context is required for subscription operations');
  }
  return String(tenantId);
}

/** Public catalog projection (never leaks internal-only fields). */
function publicPlan(planKey) {
  const p = PLAN_CATALOG[planKey];
  return {
    planKey,
    name: p.name,
    tier: p.tier,
    sortOrder: p.sort_order,
    description: p.description,
    entitlements: p.entitlements,
  };
}

// ── Reads (tenant-scoped, any authenticated user) ──────────────────────────────────────────────

// GET /plans — the full plan catalog (public product info). 5 plans.
router.get('/plans', auth, asyncHandler(async (req, res) => {
  const plans = [...PLAN_KEYS]
    .sort((a, b) => (PLAN_CATALOG[a].sort_order ?? 0) - (PLAN_CATALOG[b].sort_order ?? 0))
    .map(publicPlan);
  res.json({ data: plans });
}));

// GET /status — the tenant's current subscription (synthetic Free when none).
router.get('/status', auth, asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req);
  const { supabase } = await deps(req);
  const sub = await resolveSubscription(supabase, tenantId);
  res.json({
    data: {
      tenantId,
      planKey: sub.plan_key,
      status: sub.status,
      synthetic: Boolean(sub.synthetic),
      currentPeriodStart: sub.current_period_start ?? null,
      currentPeriodEnd: sub.current_period_end ?? null,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      active: isSubscriptionActiveState(sub.status),
    },
  });
}));

// GET /entitlements — effective entitlements (plan merged with per-user overrides) for the caller.
router.get('/entitlements', auth, asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req);
  const { supabase } = await deps(req);
  const effective = await resolveEffectiveEntitlements(supabase, tenantId, req.userContext.id);
  res.json({ data: effective });
}));

// GET /usage — point-in-time usage for each metered feature in the current period.
router.get('/usage', auth, asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req);
  const { supabase } = await deps(req);
  const periodStart = currentPeriodStart();
  const usage = [];
  for (const featureKey of METERED_FEATURE_KEYS) {
    // checkQuota reads the tenant meter; the mock cannot run SQL, so it reads the seeded meter rows.
    usage.push(await checkQuota(supabase, { tenantId, featureKey, userId: req.userContext.id, periodStart }));
  }
  res.json({ data: { tenantId, periodStart, usage } });
}));

// ── Billing actions (sandbox provider; never a real network) ───────────────────────────────────

// POST /checkout — create a checkout session for a target plan.
router.post('/checkout', auth, asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req);
  assertCanManageSubscription(req.userContext, tenantId); // Gate S8-A: trusted manager only
  const planKey = req.body?.planKey;
  if (!planKey || !PLAN_KEYS.includes(planKey)) throw new ValidationError('A valid planKey is required for checkout');
  const { billing } = await deps(req);
  const session = await billing.createCheckoutSession({
    tenantId,
    planKey,
    successUrl: req.body?.successUrl || null,
    cancelUrl: req.body?.cancelUrl || null,
  });
  res.status(201).json({ data: session });
}));

// POST /portal — create a billing portal session.
router.post('/portal', auth, asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req);
  assertCanManageSubscription(req.userContext, tenantId); // Gate S8-A: trusted manager only
  const { billing } = await deps(req);
  const session = await billing.createPortalSession({ tenantId, returnUrl: req.body?.returnUrl || null });
  res.status(201).json({ data: session });
}));

// POST /change-plan — request a plan change through the provider (state still flows back via webhook/sync).
router.post('/change-plan', auth, asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req);
  assertCanManageSubscription(req.userContext, tenantId); // Gate S8-A: trusted manager only
  const planKey = req.body?.planKey;
  if (!planKey || !PLAN_KEYS.includes(planKey)) throw new ValidationError('A valid planKey is required to change plan');
  const { supabase, billing } = await deps(req);
  const snapshot = await billing.changePlan({ tenantId, planKey });
  // Persist the provider's authoritative snapshot (never a client-submitted status).
  const persisted = await syncSubscriptionFromSnapshot(supabase, snapshot, req.userContext?.id || null);
  res.json({ data: persisted });
}));

// POST /cancel — cancel (at period end by default) through the provider.
router.post('/cancel', auth, asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req);
  assertCanManageSubscription(req.userContext, tenantId); // Gate S8-A: trusted manager only
  const atPeriodEnd = req.body?.atPeriodEnd !== false;
  const { supabase, billing } = await deps(req);
  const snapshot = await billing.cancelSubscription({ tenantId, atPeriodEnd });
  const persisted = await syncSubscriptionFromSnapshot(supabase, snapshot, req.userContext?.id || null);
  res.json({ data: persisted });
}));

// ── Webhook (provider-verified, idempotent, the only state-mutating sync path) ─────────────────

/**
 * POST /webhook — verify the provider signature, dedupe on (provider, event_id), and on a valid new
 * event sync the tenant subscription. Unverified signature -> 400. Duplicate event_id -> 200
 * {alreadyProcessed:true}. A replayed event never double-applies (the dedupe insert is the guard).
 *
 * No auth middleware: the provider signature is the authorization. Tenant + plan + status are read
 * ONLY from the verified provider payload — never from client-controlled fields.
 */
router.post('/webhook', asyncHandler(async (req, res) => {
  const { supabase, billing } = await deps(req);
  const signature = req.headers['x-billing-signature'] || req.headers['x-webhook-signature'] || req.body?.signature || null;
  // Prefer the exact raw body when available (req.rawBody) so the HMAC matches the provider's bytes.
  const rawBody = req.rawBody != null ? req.rawBody : JSON.stringify(req.body ?? {});

  const verification = await billing.verifyWebhook({ rawBody, signature });
  if (!verification.verified) {
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }
  const provider = verification.payload?.provider || billing.name || BILLING_PROVIDERS.SANDBOX;
  const eventId = verification.eventId;
  if (!eventId) throw new ValidationError('Webhook payload is missing an event id');

  // Idempotency keys on COMPLETED work, not on row existence.
  //
  // The event row is written before the state is applied, and `processed_at` is stamped after. This
  // check previously returned alreadyProcessed on the mere presence of the row, so any failure
  // between those two writes — a status the DB CHECK rejects (providers emit 'canceled'; the CHECK
  // only accepts 'cancelled'), an unknown plan_key hitting the FK, or the partial-unique collision
  // between two concurrent deliveries — permanently blackholed the event: the route 4xx'd, the
  // provider retried, and every retry was answered 200 "already processed" while `processed_at`
  // stayed NULL and nothing scanned for it. A cancellation lost that way leaves the tenant on a paid
  // plan forever.
  //
  // Re-processing an unfinished event is safe: applying the same authoritative snapshot twice is
  // idempotent by construction, and the row is claimed rather than re-inserted.
  const existing = await findEvent(supabase, provider, eventId);
  if (existing?.processed_at) {
    return res.status(200).json({ received: true, alreadyProcessed: true, eventId });
  }

  // Record the event before applying anything (the unique constraint is the dedupe guard against
  // concurrent replays). On a retry of an event whose apply previously failed, the row already
  // exists and is claimed rather than re-inserted — inserting again would violate
  // uq_diaspora_billing_event and turn a legitimate retry into a 400.
  const eventRow = existing || await insertEvent(supabase, {
    provider,
    eventId,
    eventType: verification.eventType,
    payload: verification.payload || {},
    tenantId: verification.payload?.data?.tenantId || verification.payload?.tenantId || null,
  });

  // Apply state from the VERIFIED payload only.
  const data = verification.payload?.data || verification.payload || {};
  const tenantId = data.tenantId || verification.payload?.tenantId || null;
  let synced = null;
  if (tenantId) {
    synced = await syncSubscriptionFromSnapshot(supabase, {
      tenantId,
      planKey: data.planKey || data.plan_key || null,
      status: data.status || null,
      currentPeriodStart: data.currentPeriodStart || data.current_period_start || null,
      currentPeriodEnd: data.currentPeriodEnd || data.current_period_end || null,
      provider,
      providerCustomerRef: data.providerCustomerRef || null,
      providerSubscriptionRef: data.providerSubscriptionRef || null,
      cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
    }, null);
  }

  await markEventProcessed(supabase, eventRow?.id);
  return res.status(200).json({ received: true, alreadyProcessed: false, eventId, synced: synced ? { planKey: synced.plan_key, status: synced.status } : null });
}));

// ── Persistence helpers (tenant-scoped subscription sync; service-role / mock client) ──────────

async function findEvent(supabase, provider, eventId) {
  const { data, error } = await supabase
    .from(EVENTS_TABLE)
    .select('*')
    .eq('provider', provider)
    .eq('event_id', String(eventId))
    .maybeSingle();
  if (error && error.code && error.code !== 'PGRST116') {
    throw new ValidationError(`Failed to read billing event: ${error.message}`);
  }
  return data || null;
}

async function insertEvent(supabase, { provider, eventId, eventType, payload, tenantId }) {
  const { data, error } = await supabase
    .from(EVENTS_TABLE)
    .insert({
      provider,
      event_id: String(eventId),
      event_type: eventType || null,
      payload: payload || {},
      signature_verified: true,
      tenant_id: tenantId || null,
    })
    .select()
    .single();
  if (error) throw new ValidationError(`Failed to record billing event: ${error.message}`);
  return data;
}

async function markEventProcessed(supabase, eventRowId) {
  if (!eventRowId) return;
  await supabase
    .from(EVENTS_TABLE)
    .update({ processed_at: new Date().toISOString() })
    .eq('id', eventRowId);
}

/**
 * Upsert the tenant's subscription from an authoritative provider snapshot. Status/plan/period come
 * ONLY from the snapshot (provider-verified) — never from a client. One active subscription per tenant:
 * update the existing non-deleted row in place, else insert.
 */
async function syncSubscriptionFromSnapshot(supabase, snapshot, actorId = null) {
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

export default router;
