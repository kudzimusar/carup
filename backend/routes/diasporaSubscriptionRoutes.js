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
import { BILLING_RECONCILIATION_TRIGGERS } from '../constants/diaspora/diasporaBillingConstants.js';
import {
  claimBillingEvent,
  markBillingEventApplied,
  markBillingEventFailed,
  listBillingEventDeadLetters,
  listSupersededEvents,
} from '../services/diaspora/billing/diasporaBillingEventLedgerService.js';
import {
  runBillingReconciliation,
  listReconciliationRuns,
  reconciliationFreshness,
} from '../services/diaspora/billing/diasporaBillingReconciliationService.js';
import { NORMALIZED_EVENTS } from '../services/diaspora/billing/billingProviderProfiles.js';
import {
  recordCheckoutOpened,
  markCheckoutCompleted,
  checkoutFunnelSummary,
} from '../services/diaspora/billing/diasporaBillingCheckoutSessionService.js';
// Extracted in Phase 2E so the scheduled retry of an unapplied provider event uses the SAME writer
// rather than a second copy of the only function that mutates subscription state.
import { syncSubscriptionFromSnapshot } from '../services/diaspora/billing/diasporaBillingSubscriptionSync.js';
import {
  newCorrelationId,
  webhookRejected,
  webhookDuplicate,
  webhookSuperseded,
  webhookApplied,
  webhookFailed,
} from '../services/diaspora/billing/diasporaBillingObservability.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// Same auth seam diasporaRoutes.js uses: any authenticated user, tenant context injected on req.userContext.
const auth = authorizeRole();

const SUBSCRIPTIONS_TABLE = ENTITLEMENT_TABLES.SUBSCRIPTIONS_TABLE;
// The billing event ledger is no longer touched from here: claiming, superseding and dead-lettering
// all live in diasporaBillingEventLedgerService, so the table name belongs there and nowhere else.

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
  const { supabase, billing } = await deps(req);
  const correlationId = req.correlationId || req.headers['x-correlation-id'] || newCorrelationId('chk');
  const session = await billing.createCheckoutSession({
    tenantId,
    planKey,
    successUrl: req.body?.successUrl || null,
    cancelUrl: req.body?.cancelUrl || null,
  });

  // Abandonment cannot be measured after the fact: a checkout that is never completed leaves no trace
  // anywhere unless the start was recorded. Best effort — a metrics row must never block a payment.
  await recordCheckoutOpened({
    tenantId,
    provider: billing.name,
    planKey,
    sessionRef: session.sessionId || null,
    initiatedBy: req.userContext?.id || null,
    correlationId,
    expiresAt: session.expiresAt || null,
    supabaseClient: supabase,
  });

  res.status(201).json({ data: { ...session, correlationId } });
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

// ── Reconciliation + billing health (operator-triggered; tenant-scoped) ────────────────────────

/**
 * POST /reconcile — an operator-triggered reconciliation pass for the caller's tenant.
 *
 * Scoped to the caller's own tenant and gated by the same trusted-manager check as the other
 * money-adjacent endpoints: a reconciliation run reads provider state for a tenant, so it is not a
 * public health check. Repair is NOT exposed here — the safe-direction repair is a deliberate
 * operational act, not something a tenant admin should trigger from a UI button.
 */
router.post('/reconcile', auth, asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req);
  assertCanManageSubscription(req.userContext, tenantId);
  const { supabase, billing } = await deps(req);
  const result = await runBillingReconciliation({
    trigger: BILLING_RECONCILIATION_TRIGGERS.OPERATOR,
    tenantId,
    initiatedBy: req.userContext?.id || null,
    correlationId: req.correlationId || req.headers['x-correlation-id'] || null,
    billingProvider: billing,
    supabaseClient: supabase,
    repair: false,
  });
  res.status(200).json({
    data: {
      runId: result.runId,
      state: result.state,
      trigger: result.trigger,
      checked: result.checked,
      mismatches: result.mismatches,
      findings: result.findings, // already sanitized: tenant + field + states only
      correlationId: result.correlationId,
    },
  });
}));

// GET /reconciliation-runs — the tenant's recent runs (sanitized findings).
router.get('/reconciliation-runs', auth, asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req);
  assertCanManageSubscription(req.userContext, tenantId);
  const { supabase } = await deps(req);
  const runs = await listReconciliationRuns({ tenantId, limit: 20, supabaseClient: supabase });
  res.json({ data: runs });
}));

/**
 * GET /billing-health — the operator view of the four required signals for this tenant.
 *
 * Reconciliation FRESHNESS is included deliberately: the most dangerous failure is not a mismatch, it
 * is a scheduler that quietly stopped, which looks exactly like "no problems found".
 */
router.get('/billing-health', auth, asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req);
  assertCanManageSubscription(req.userContext, tenantId);
  const { supabase } = await deps(req);
  const [deadLetters, superseded, freshness, funnel] = await Promise.all([
    listBillingEventDeadLetters({ tenantId, limit: 20, supabaseClient: supabase }),
    listSupersededEvents({ tenantId, limit: 20, supabaseClient: supabase }),
    reconciliationFreshness({ supabaseClient: supabase }),
    checkoutFunnelSummary({ tenantId, supabaseClient: supabase }),
  ]);
  res.json({
    data: {
      tenantId,
      failedWebhooks: { count: deadLetters.length, events: deadLetters },
      supersededWebhooks: { count: superseded.length, events: superseded },
      reconciliation: freshness,
      checkout: funnel,
    },
  });
}));

// ── Webhook (provider-verified, durable, out-of-order safe) ────────────────────────────────────

/**
 * Normalize a verification result into one shape.
 *
 * The test-mode adapter already returns a normalized event (its profile did the work). The in-memory
 * sandbox returns the legacy `{verified,eventId,eventType,payload}` shape, so its payload is mapped
 * here. Doing it in one place means the handler below never branches on which provider it is talking
 * to — which is the same neutrality rule the adapter follows (ADR-001 §5).
 */
function normalizeVerification(verification) {
  if (verification.normalized) return verification.normalized;
  const payload = verification.payload || {};
  const data = payload.data || payload;
  return {
    eventId: verification.eventId || null,
    eventType: verification.eventType || payload.type || payload.event_type || null,
    providerEventType: payload.type || payload.event_type || null,
    tenantId: data.tenantId || data.tenant_id || payload.tenantId || null,
    planKey: data.planKey || data.plan_key || null,
    status: data.status || null,
    currentPeriodStart: data.currentPeriodStart || data.current_period_start || null,
    currentPeriodEnd: data.currentPeriodEnd || data.current_period_end || null,
    cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? data.cancel_at_period_end ?? null,
    providerCustomerRef: data.providerCustomerRef || data.provider_customer_ref || null,
    providerSubscriptionRef: data.providerSubscriptionRef || data.provider_subscription_ref || null,
    sessionRef: data.sessionRef || data.session_ref || null,
    occurredAt: payload.occurred_at ?? payload.occurredAt ?? payload.created ?? null,
    providerSequence: payload.sequence ?? payload.provider_sequence ?? null,
  };
}

/** Does this event carry authoritative subscription state? Payment-only events do not. */
function carriesSubscriptionState(normalized) {
  return Boolean(normalized.status || normalized.planKey);
}

/**
 * POST /webhook — the only state-mutating sync path.
 *
 * Discipline, in order:
 *   1. RAW body only. The signature covers the exact bytes the provider sent; re-serializing a parsed
 *      body changes them. A missing raw body is a 400, not a fallback — a fallback here silently
 *      degrades signature verification into signature theatre.
 *   2. Signature verified before anything is read from the payload.
 *   3. The event is CLAIMED in the durable ledger, where UNIQUE (provider, event_id) makes the INSERT
 *      itself the de-duplication. The previous SELECT-then-INSERT was a race: two concurrent
 *      deliveries could both observe "no existing row" and both apply.
 *   4. An event older than one already applied for the tenant is recorded and SUPERSEDED, never
 *      applied — otherwise a retry that overtakes a newer event resurrects a cancelled subscription.
 *   5. Only then is the subscription synced, and only from the verified payload.
 *   6. A handler failure marks the ledger row failed (visible, retryable) instead of vanishing.
 *
 * No auth middleware: the provider signature IS the authorization.
 */
router.post('/webhook', asyncHandler(async (req, res) => {
  const { supabase, billing } = await deps(req);
  const correlationId = req.correlationId || req.headers['x-correlation-id'] || newCorrelationId();
  const signature = req.headers['x-billing-signature']
    || req.headers['stripe-signature']
    || req.headers['x-webhook-signature']
    || null;

  // The provider identity comes from the ADAPTER, never from the payload: a payload-declared provider
  // would let a signed event choose its own de-duplication namespace.
  const provider = billing.name || BILLING_PROVIDERS.SANDBOX;

  const rawBody = typeof req.rawBody === 'string' ? req.rawBody : null;
  if (rawBody == null) {
    webhookRejected({ correlationId, reason: 'RAW_BODY_UNAVAILABLE', provider });
    return res.status(400).json({ error: 'Webhook raw body unavailable; signature cannot be verified' });
  }

  const verification = await billing.verifyWebhook({ rawBody, signature, headers: req.headers });
  if (!verification.verified) {
    webhookRejected({ correlationId, reason: verification.reason || 'SIGNATURE_INVALID', provider });
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  const normalized = normalizeVerification(verification);
  const eventId = normalized.eventId || verification.eventId;
  if (!eventId) throw new ValidationError('Webhook payload is missing an event id');
  const tenantId = normalized.tenantId || null;

  // Claim the event by INSERT — the unique constraint IS the de-duplication, with no
  // SELECT-then-INSERT window for two concurrent deliveries to both pass.
  //
  // Idempotency keys on COMPLETED work, not on row existence. The row is written before the state is
  // applied and `processed_at` is stamped after, so a failure in between — a status the DB CHECK
  // rejects (providers emit 'canceled'; the CHECK accepts 'cancelled'), an unknown plan_key hitting
  // the FK, a concurrent-delivery collision — leaves a claimed row that was never processed.
  // claimBillingEvent hands such a row back as CLAIMED for reprocessing rather than as a duplicate;
  // answering every retry "already processed" would blackhole the event permanently, and a
  // cancellation lost that way leaves a tenant on a paid plan forever.
  const claim = await claimBillingEvent({
    provider,
    eventId,
    eventType: normalized.eventType,
    providerEventType: normalized.providerEventType,
    tenantId,
    occurredAt: normalized.occurredAt,
    providerSequence: normalized.providerSequence,
    payload: verification.payload || {},
    signatureVerified: true,
    correlationId,
    supabaseClient: supabase,
  });

  if (claim.duplicate) {
    webhookDuplicate({ correlationId, provider, eventId });
    return res.status(200).json({ received: true, alreadyProcessed: true, eventId, correlationId });
  }

  if (claim.superseded) {
    webhookSuperseded({ correlationId, provider, eventId, tenantId, supersededBy: claim.supersededBy });
    return res.status(200).json({
      received: true,
      alreadyProcessed: false,
      applied: false,
      superseded: true,
      eventId,
      correlationId,
    });
  }

  try {
    let synced = null;
    if (tenantId && carriesSubscriptionState(normalized)) {
      synced = await syncSubscriptionFromSnapshot(supabase, {
        tenantId,
        planKey: normalized.planKey,
        status: normalized.status,
        currentPeriodStart: normalized.currentPeriodStart,
        currentPeriodEnd: normalized.currentPeriodEnd,
        provider,
        providerCustomerRef: normalized.providerCustomerRef,
        providerSubscriptionRef: normalized.providerSubscriptionRef,
        cancelAtPeriodEnd: normalized.cancelAtPeriodEnd ?? undefined,
      }, null);
    }

    // A completed checkout closes the funnel record; best effort, never blocks the webhook.
    if (normalized.eventType === NORMALIZED_EVENTS.CHECKOUT_COMPLETED
      || normalized.eventType === NORMALIZED_EVENTS.SUBSCRIPTION_ACTIVATED
      || normalized.eventType === NORMALIZED_EVENTS.PAYMENT_SUCCEEDED) {
      try {
        await markCheckoutCompleted({
          tenantId, provider, sessionRef: normalized.sessionRef, correlationId, supabaseClient: supabase,
        });
      } catch { /* funnel metrics must never fail a billing webhook */ }
    }

    await markBillingEventApplied(claim.event?.id, { supabaseClient: supabase });
    webhookApplied({ correlationId, provider, eventId, tenantId, eventType: normalized.eventType });

    return res.status(200).json({
      received: true,
      alreadyProcessed: false,
      applied: true,
      eventId,
      correlationId,
      synced: synced ? { planKey: synced.plan_key, status: synced.status } : null,
    });
  } catch (err) {
    // The event stays visible as unfinished work rather than disappearing with the request.
    await markBillingEventFailed(claim.event?.id, err?.message, { supabaseClient: supabase })
      .catch(() => { /* the original error is what matters */ });
    webhookFailed({ correlationId, provider, eventId, tenantId, reason: err?.message });
    throw err;
  }
}));

export default router;
