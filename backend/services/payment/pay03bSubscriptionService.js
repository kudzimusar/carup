/**
 * CARUP-PAY-03B-LR01 — Dealer & Business subscription service.
 *
 * Orchestrates the recurring lifecycle around the canonical database authority
 * (20261101130000_carup_pay03b_business_subscriptions.sql): every authority, money and entitlement decision is
 * made (or re-checked) by SECURITY DEFINER functions inside one database transaction; this module resolves request
 * context, calls the provider adapter, and feeds FRESH provider reads into those functions. A browser redirect,
 * a webhook payload or a provider 'active' flag is never payment proof.
 */
import crypto from 'node:crypto';
import { supabase } from '../../db/supabase.js';
import { logger } from '../../utils/logger.js';
import {
  Pay03bError, isPay03bProductionRuntime, isPay0xError, pay03bAuditSucceeded, pay03bRpcError, recordPay03bAudit, requireAdminActor,
} from './pay03bContract.js';
import { Pay03bStripeSandboxProvider } from './pay03bProviderAdapters.js';
import { Pay03bLocalSimulatorProvider } from './pay03bLocalSimulator.js';

export const PAY03B_DEALER_SCOPE = 'dealer_storefront';
export const PAY03B_LISTING_CAPACITY_KEY = 'dealer.inventory.published_listing_capacity';
export const PAY03B_TENANT_BILLING_ROLES = Object.freeze(['admin', 'administrator', 'tenant_admin']);
const SOURCE_OF_TRUTH = 'Money: public.payment_transactions (one canonical row per invoice). Agreement: '
  + 'public.pay03b_business_subscriptions. Access: pay03b_resolve_tenant_entitlements (paid periods only). '
  + 'Provider state is always re-read; redirects and webhook payloads are never payment proof.';
const SUBSCRIPTION_EVENT_PREFIXES = ['customer.subscription.', 'invoice.'];

export function resolvePay03bProvider({ env = process.env, stripe = null, provider = null } = {}) {
  if (provider) return provider;
  if (env.CARUP_PAY03B_PROVIDER_MODE === 'local_simulator') return new Pay03bLocalSimulatorProvider({ env });
  return new Pay03bStripeSandboxProvider({ env, stripe });
}

function hashKey(prefix, ...parts) {
  return `${prefix}_${crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)}`;
}

function validateRequestKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,96}$/.test(key)) throw new Pay03bError('PAY03B_IDEMPOTENCY_KEY_REQUIRED', 400);
  return key;
}

async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw pay03bRpcError(error);
  return data;
}

async function selectRows(query, code = 'PAY03B_READ_UNAVAILABLE') {
  const { data, error } = await query;
  if (error) throw new Pay03bError(code, 503);
  return data || [];
}

// --------------------------------------------------------------------------------------------- projections
function projectPlan(row, { sandboxRuntime }) {
  const purchasable = row.pricing_kind === 'sandbox_fixture' && row.activation_status === 'sandbox_only'
    && Boolean(row.provider_price_ref) && sandboxRuntime && !row.effective_to;
  return {
    id: row.id,
    planCode: row.plan_code,
    planVersion: row.plan_version,
    productCode: row.product_code,
    displayName: row.display_name,
    subscriptionScope: row.subscription_scope,
    tierRank: row.tier_rank,
    pricingKind: row.pricing_kind,
    activationStatus: row.activation_status,
    commercialStatus: row.pricing_kind === 'free' ? 'free'
      : row.pricing_kind === 'sandbox_fixture' ? 'sandbox_test_only_not_a_commercial_offer'
        : row.pricing_kind === 'contract_quotation' ? 'request_quote' : 'not_available',
    amountMinor: row.pricing_kind === 'sandbox_fixture' ? Number(row.amount_minor) : null,
    currency: row.pricing_kind === 'sandbox_fixture' ? row.currency : null,
    currencyScale: row.currency_scale,
    billingInterval: row.billing_interval,
    intervalCount: row.interval_count,
    jurisdiction: row.jurisdiction,
    merchantOfRecord: row.merchant_of_record,
    providerAllowlist: row.provider_allowlist || [],
    entitlements: row.entitlements || {},
    trialDays: row.trial_days,
    graceDays: row.grace_days,
    changePolicy: row.change_policy,
    cancellationPolicy: row.cancellation_policy,
    refundPolicy: row.refund_policy,
    blockerClass: row.blocker_class,
    blockerReason: row.blocker_reason,
    approvalEvidenceRef: row.approval_evidence_ref,
    approvedBy: row.approved_by,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    simulated: (row.provider_allowlist || []).includes('pay03b_local_provider_simulator'),
    purchasable,
  };
}

function projectSubscription(row, plansById = new Map()) {
  if (!row) return null;
  const plan = plansById.get(row.plan_id);
  const paidPlan = plansById.get(row.paid_plan_id);
  return {
    id: row.id,
    subscriptionReference: row.subscription_reference,
    ownerTenantId: row.owner_tenant_id,
    ownerOrganizationId: row.owner_organization_id,
    status: row.status,
    providerStatus: row.provider_status || null,
    gateway: row.gateway,
    simulated: row.gateway === 'pay03b_local_provider_simulator',
    planId: row.plan_id,
    planCode: plan?.plan_code || null,
    paidPlanId: row.paid_plan_id || null,
    paidPlanCode: paidPlan?.plan_code || null,
    scheduledPlanChange: Boolean(row.paid_plan_id && row.plan_id !== row.paid_plan_id),
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    paidThrough: row.paid_through,
    graceUntil: row.grace_until,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    cancellationMode: row.cancellation_mode,
    canceledAt: row.canceled_at,
    endedAt: row.ended_at,
    suspendedReason: row.suspended_reason,
    providerSubscriptionId: row.provider_subscription_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function projectInvoice(row, paymentsByRef) {
  const payment = row.payment_reference ? paymentsByRef.get(row.payment_reference) : null;
  return {
    id: row.id,
    providerInvoiceId: row.provider_invoice_id,
    billingReason: row.billing_reason,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    currency: row.currency,
    amountDueMinor: Number(row.amount_due_minor),
    amountPaidMinor: Number(row.amount_paid_minor),
    providerStatus: row.provider_status,
    anomaly: row.anomaly,
    attemptCount: row.attempt_count,
    paymentReference: row.payment_reference,
    paymentStatus: payment?.status || null,
    paymentRefundId: payment?.pay01a_refund_id || null,
  };
}

function sandboxRuntime(env) {
  return env.CARUP_PAY03B_ENABLED === 'true' && !isPay03bProductionRuntime(env);
}

// --------------------------------------------------------------------------------------------- catalogue
async function loadCurrentPlans(db) {
  return selectRows(db.from('pay03b_subscription_plans').select('*').order('tier_rank', { ascending: true }), 'PAY03B_CATALOGUE_UNAVAILABLE')
    .then((rows) => rows.filter((row) => !row.effective_to));
}

/** Public, read-only, every environment: commercial status only. Sandbox fixtures are never shown as offers. */
export async function getPay03bPublicCatalogue({ db = supabase } = {}) {
  const plans = await loadCurrentPlans(db);
  const products = await selectRows(db.from('pay02_commercial_products').select('product_code, title, jurisdiction, activation_state'),
    'PAY03B_CATALOGUE_UNAVAILABLE');
  const titles = new Map(products.map((p) => [p.product_code, p]));
  const governance = plans.filter((p) => p.pricing_kind !== 'sandbox_fixture' && p.activation_status !== 'sandbox_only');
  return {
    products: [...new Set(governance.map((p) => p.product_code))].map((code) => ({
      productCode: code,
      title: titles.get(code)?.title || code,
      plans: governance.filter((p) => p.product_code === code).map((p) => {
        const projected = projectPlan(p, { sandboxRuntime: false });
        return { planCode: projected.planCode, displayName: projected.displayName, pricingKind: projected.pricingKind,
          commercialStatus: projected.commercialStatus, billingInterval: projected.billingInterval,
          blockerClass: projected.blockerClass, blockerReason: projected.blockerReason, amountMinor: null, currency: null };
      }),
    })),
    pricingAuthority: 'pay03b_subscription_plans (governed registry). No paid plan is commercially approved.',
  };
}

export async function getPay03bAdminCatalogue({ db = supabase, env = process.env } = {}) {
  const all = await selectRows(db.from('pay03b_subscription_plans').select('*').order('plan_code', { ascending: true }),
    'PAY03B_CATALOGUE_UNAVAILABLE');
  return { plans: all.map((row) => projectPlan(row, { sandboxRuntime: sandboxRuntime(env) })), sourceOfTruth: SOURCE_OF_TRUTH };
}

// --------------------------------------------------------------------------------------------- dealer context
export async function resolvePay03bDealerContext({ db = supabase, actorId, tenantId }) {
  if (!actorId) throw new Pay03bError('PAY03B_AUTHENTICATION_REQUIRED', 401);
  if (typeof tenantId !== 'string' || !/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Pay03bError('PAY03B_TENANT_CONTEXT_REQUIRED', 400);
  const memberships = await selectRows(db.from('tenant_users').select('role').eq('tenant_id', tenantId).eq('user_id', actorId));
  if (memberships.length !== 1) throw new Pay03bError('PAY03B_TENANT_MEMBERSHIP_REQUIRED', 403);
  const orgs = (await selectRows(db.from('organizations').select('id, name, type, status, tenant_id').eq('tenant_id', tenantId)))
    .filter((o) => o.type === 'dealership' && (o.status || 'active') === 'active');
  if (orgs.length === 0) throw new Pay03bError('PAY03B_NO_LEGAL_ORGANIZATION_BOUND', 409);
  if (orgs.length > 1) throw new Pay03bError('PAY03B_ORGANIZATION_AMBIGUOUS', 409);
  const role = String(memberships[0].role || '').toLowerCase();
  return {
    tenantId,
    tenantRole: role,
    billingAuthority: PAY03B_TENANT_BILLING_ROLES.includes(role),
    organization: { id: orgs[0].id, name: orgs[0].name, type: orgs[0].type, status: orgs[0].status || 'active' },
  };
}

async function loadTenantSubscriptions(db, tenantId) {
  return selectRows(db.from('pay03b_business_subscriptions').select('*').eq('owner_tenant_id', tenantId)
    .eq('subscription_scope', PAY03B_DEALER_SCOPE).order('created_at', { ascending: false }));
}

async function loadInvoices(db, subscriptionId) {
  const invoices = await selectRows(db.from('pay03b_subscription_invoices').select('*').eq('subscription_id', subscriptionId)
    .order('period_start', { ascending: false }));
  const refs = invoices.map((i) => i.payment_reference).filter(Boolean);
  const payments = refs.length
    ? await selectRows(db.from('payment_transactions').select('reference, status, amount, currency, pay01a_refund_id').in('reference', refs))
    : [];
  const paymentsByRef = new Map(payments.map((p) => [p.reference, p]));
  return invoices.map((row) => projectInvoice(row, paymentsByRef));
}

export async function getPay03bTenantEntitlements({ db = supabase, tenantId }) {
  const ent = await rpc(db, 'pay03b_resolve_tenant_entitlements', { p_tenant_id: tenantId, p_subscription_scope: PAY03B_DEALER_SCOPE });
  const baseline = ent?.baseline_entitlements || {};
  const subscribed = ent?.access ? (ent.subscription_entitlements || {}) : {};
  const capacity = [baseline[PAY03B_LISTING_CAPACITY_KEY], subscribed[PAY03B_LISTING_CAPACITY_KEY]]
    .filter((v) => Number.isInteger(v)).reduce((max, v) => (max === null || v > max ? v : max), null);
  return {
    access: Boolean(ent?.access),
    reason: ent?.reason || 'no_subscription',
    status: ent?.status || null,
    planCode: ent?.plan_code || null,
    paidThrough: ent?.paid_through || null,
    graceUntil: ent?.grace_until || null,
    baselineEntitlements: baseline,
    subscriptionEntitlements: subscribed,
    effective: { [PAY03B_LISTING_CAPACITY_KEY]: capacity },
  };
}

export async function getPay03bDealerOverview({ db = supabase, env = process.env, actorId, tenantId }) {
  const ctx = await resolvePay03bDealerContext({ db, actorId, tenantId });
  const plans = (await loadCurrentPlans(db)).filter((p) => p.subscription_scope === PAY03B_DEALER_SCOPE);
  const visiblePlans = plans.filter((p) => p.pricing_kind !== 'sandbox_fixture' || sandboxRuntime(env));
  const allPlans = await selectRows(db.from('pay03b_subscription_plans').select('id, plan_code, plan_version'));
  const plansById = new Map(allPlans.map((p) => [p.id, p]));
  const subscriptions = await loadTenantSubscriptions(db, tenantId);
  const current = subscriptions[0] || null;
  const invoices = current ? await loadInvoices(db, current.id) : [];
  return {
    organization: ctx.organization,
    tenantRole: ctx.tenantRole,
    billingAuthority: ctx.billingAuthority,
    plans: visiblePlans.map((p) => projectPlan(p, { sandboxRuntime: sandboxRuntime(env) })),
    subscription: projectSubscription(current, plansById),
    history: subscriptions.slice(1).map((s) => projectSubscription(s, plansById)),
    entitlements: await getPay03bTenantEntitlements({ db, tenantId }),
    invoices,
    enforcementActive: env.CARUP_PAY03B_ENTITLEMENT_ENFORCEMENT === 'true',
    providerMode: env.CARUP_PAY03B_PROVIDER_MODE === 'local_simulator' ? 'local_simulator' : 'stripe_sandbox',
    sourceOfTruth: SOURCE_OF_TRUTH,
  };
}

// --------------------------------------------------------------------------------------------- provider sync
async function billingCustomerFor(db, row) {
  if (!row.billing_customer_id) return null;
  const rows = await selectRows(db.from('pay03b_billing_customers').select('provider_customer_id').eq('id', row.billing_customer_id));
  return rows[0]?.provider_customer_id || null;
}

/**
 * A deterministic CarUp refusal (4xx) of one invoice is quarantined as a provider-sync exception; anything else
 * (provider or database unavailable, an unexpected error) is transient and makes the delivery fail so it is retried.
 */
function isTransientSyncFailure(err) {
  return !(isPay0xError(err) && Number(err.status) < 500);
}

/** Observation time is taken BEFORE the provider read it describes, so a slower, older read can never win. */
const observationStamp = () => new Date().toISOString();

async function openSyncExceptionInvoiceIds(db, subscriptionId) {
  const rows = await selectRows(db.from('pay03b_subscription_sync_exceptions').select('provider_invoice_id')
    .eq('subscription_id', subscriptionId).eq('status', 'open'));
  return new Set(rows.map((r) => r.provider_invoice_id));
}

function alertOperators(message, detail) {
  logger.warn('PAYMENTS', message, { alert: message, programme: 'PAY-03B', ...detail });
}

async function recordInvoiceFromProvider({ db, provider, subscriptionRow, snapshot, invoice, observedAt, eventId }) {
  if (invoice.rejected) throw new Pay03bError(invoice.errorCode || 'PAY03B_INVOICE_SHAPE_UNSUPPORTED', 409);
  if (invoice.subscriptionId !== snapshot.id) throw new Pay03bError('PAY03B_PROVIDER_INVOICE_SUBSCRIPTION_MISMATCH', 409);
  let truth = null;
  if (invoice.paymentIntentId && invoice.amountDueMinor > 0) {
    truth = await provider.getPaymentTruth({ paymentIntentId: invoice.paymentIntentId, amountMinor: invoice.amountDueMinor,
      currency: invoice.currency });
    // A succeeded payment whose invoice the provider has not yet marked paid is recorded on the next read.
    if (['paid', 'refund_pending', 'refunded', 'reconciliation_hold'].includes(truth.status)
      && (invoice.status !== 'paid' || invoice.amountPaidMinor !== invoice.amountDueMinor)) {
      truth = null;
    }
  }
  const recorded = await rpc(db, 'pay03b_record_subscription_invoice', {
    p_subscription_id: subscriptionRow.id, p_provider_invoice_id: invoice.id, p_billing_reason: invoice.billingReason,
    p_price_ref: invoice.priceRef, p_period_start: invoice.periodStart, p_period_end: invoice.periodEnd,
    p_currency: invoice.currency, p_amount_due_minor: invoice.amountDueMinor, p_amount_paid_minor: invoice.amountPaidMinor,
    p_amount_remaining_minor: invoice.amountRemainingMinor, p_provider_status: invoice.status,
    p_payment_intent_id: invoice.paymentIntentId, p_attempt_count: invoice.attemptCount,
    p_next_payment_attempt: invoice.nextPaymentAttempt, p_observed_at: observedAt,
    p_payment_status: truth?.status ?? null,
    p_refund_id: truth?.status === 'refunded' ? truth.oldestSucceededRefundId : null,
    p_refunded_minor: truth ? truth.refundedMinor : null,
    p_pending_refund_minor: truth ? truth.pendingRefundMinor : null,
    p_refund_ids: truth ? truth.refundIds : null,
    p_mismatch: truth?.status === 'reconciliation_hold' ? truth.mismatch : null,
    p_detected_via: eventId ? 'signed_webhook' : 'provider_readback',
    p_event_id: null, p_event_type: null,
  });
  if (recorded?.reconciliation_exception_event === 'opened') {
    alertOperators('PAY03B_PAYMENT_RECONCILIATION_HOLD_OPENED', {
      subscriptionId: subscriptionRow.id, ownerTenantId: subscriptionRow.owner_tenant_id, providerInvoiceId: invoice.id,
      paymentReference: recorded.payment?.reference || null, reconciliationExceptionId: recorded.reconciliation_exception_id || null,
      providerRefundedMinor: truth?.refundedMinor ?? null, providerPendingRefundMinor: truth?.pendingRefundMinor ?? null,
    });
  }
  return recorded;
}

/**
 * Fresh provider read -> canonical writers. Idempotent and order-independent: the database ignores stale
 * observations and never lets an invoice extend access unless it is paid in full, at the governed price, through a
 * canonical 'paid' payment. A redelivered event is never treated as "already done" (the work after its receipt may
 * not have completed); each invoice is recorded independently, so one invoice that cannot be recorded never blocks
 * the others: a deterministic refusal becomes a durable provider-sync exception (which suspends paid access until it
 * clears), a transient failure is rethrown after the others so the event is retried.
 */
export async function syncPay03bSubscriptionFromProvider({ db = supabase, provider, subscriptionRow, eventId = null, eventType = null }) {
  if (!subscriptionRow) throw new Pay03bError('PAY03B_SUBSCRIPTION_NOT_FOUND', 404);
  if (subscriptionRow.gateway !== provider.gateway) throw new Pay03bError('PAY03B_PROVIDER_GATEWAY_MISMATCH', 409);
  await provider.verifyAccount();
  let providerSubscriptionId = subscriptionRow.provider_subscription_id;
  if (!providerSubscriptionId) {
    if (!subscriptionRow.provider_checkout_id) return { state: 'awaiting_checkout', duplicateEvent: false };
    const checkoutObservedAt = observationStamp();
    const checkout = await provider.getCheckout(subscriptionRow.provider_checkout_id);
    if (checkout.clientReference !== subscriptionRow.subscription_reference || checkout.mode !== 'subscription') {
      throw new Pay03bError('PAY03B_CHECKOUT_REFERENCE_MISMATCH', 409);
    }
    if (checkout.status === 'expired' || !checkout.subscriptionId) {
      const applied = await rpc(db, 'pay03b_apply_subscription_snapshot', {
        p_subscription_id: subscriptionRow.id, p_provider_subscription_id: null, p_provider_status: null, p_price_ref: null,
        p_current_period_start: null, p_current_period_end: null, p_cancel_at_period_end: null, p_canceled_at: null,
        p_ended_at: null, p_trial_end: null, p_observed_at: checkoutObservedAt, p_event_id: eventId, p_event_type: eventType,
        p_checkout_status: checkout.status,
      });
      return { state: checkout.status === 'expired' ? 'checkout_expired' : 'awaiting_payment', duplicateEvent: Boolean(applied?.duplicate_event) };
    }
    providerSubscriptionId = checkout.subscriptionId;
  }
  const subscriptionObservedAt = observationStamp();
  const snapshot = await provider.getSubscription(providerSubscriptionId);
  if (snapshot.subscriptionReference && snapshot.subscriptionReference !== subscriptionRow.subscription_reference) {
    throw new Pay03bError('PAY03B_PROVIDER_SUBSCRIPTION_REFERENCE_MISMATCH', 409);
  }
  const boundCustomer = await billingCustomerFor(db, subscriptionRow);
  if (boundCustomer && snapshot.customerId !== boundCustomer) throw new Pay03bError('PAY03B_PROVIDER_CUSTOMER_MISMATCH', 409);
  const applied = await rpc(db, 'pay03b_apply_subscription_snapshot', {
    p_subscription_id: subscriptionRow.id, p_provider_subscription_id: snapshot.id, p_provider_status: snapshot.status,
    p_price_ref: snapshot.priceRef, p_current_period_start: snapshot.currentPeriodStart,
    p_current_period_end: snapshot.currentPeriodEnd, p_cancel_at_period_end: snapshot.cancelAtPeriodEnd,
    p_canceled_at: snapshot.canceledAt, p_ended_at: snapshot.endedAt, p_trial_end: snapshot.trialEnd,
    p_observed_at: subscriptionObservedAt, p_event_id: eventId, p_event_type: eventType, p_checkout_status: null,
  });
  const duplicateEvent = Boolean(applied?.duplicate_event);

  const invoicesObservedAt = observationStamp();
  const listing = await provider.listSubscriptionInvoices(snapshot.id);
  const openExceptions = await openSyncExceptionInvoiceIds(db, subscriptionRow.id);
  const ordered = [...listing].sort((a, b) => (Date.parse(a.periodStart) || 0) - (Date.parse(b.periodStart) || 0));
  let synced = 0;
  const syncExceptions = [];
  const transientFailures = [];
  for (const invoice of ordered) {
    try {
      await recordInvoiceFromProvider({ db, provider, subscriptionRow, snapshot, invoice, observedAt: invoicesObservedAt, eventId });
      synced += 1;
      if (openExceptions.has(invoice.id)) {
        await rpc(db, 'pay03b_clear_sync_exceptions', { p_subscription_id: subscriptionRow.id, p_provider_invoice_id: invoice.id });
      }
    } catch (err) {
      if (isTransientSyncFailure(err) || !invoice.id) { transientFailures.push(err); continue; }
      try {
        await rpc(db, 'pay03b_record_sync_exception', { p_subscription_id: subscriptionRow.id, p_provider_invoice_id: invoice.id,
          p_error_code: err.code });
      } catch (recordErr) { transientFailures.push(recordErr); continue; }
      syncExceptions.push({ providerInvoiceId: invoice.id, code: err.code });
      alertOperators('PAY03B_SUBSCRIPTION_SYNC_EXCEPTION', { subscriptionId: subscriptionRow.id,
        ownerTenantId: subscriptionRow.owner_tenant_id, providerInvoiceId: invoice.id, errorCode: err.code });
    }
  }
  // The listing is complete (or the adapter failed closed), so an exception for an invoice the provider no longer
  // has (a deleted draft) is cleared.
  const listedIds = new Set(listing.map((i) => i.id).filter(Boolean));
  for (const invoiceId of openExceptions) {
    if (!listedIds.has(invoiceId)) {
      await rpc(db, 'pay03b_clear_sync_exceptions', { p_subscription_id: subscriptionRow.id, p_provider_invoice_id: invoiceId });
    }
  }
  if (transientFailures.length) throw transientFailures[0];
  return { state: 'synchronized', duplicateEvent, invoicesSynced: synced, syncExceptions };
}

async function findSubscriptionRow(db, column, value) {
  if (!value) return null;
  const rows = await selectRows(db.from('pay03b_business_subscriptions').select('*').eq(column, value));
  return rows[0] || null;
}

export function isPay03bProviderEvent(event) {
  const type = String(event?.type || '');
  if (SUBSCRIPTION_EVENT_PREFIXES.some((prefix) => type.startsWith(prefix))) return true;
  return type.startsWith('checkout.session.') && event?.data?.object?.mode === 'subscription';
}

/** A verified provider event (signature, account and mode already checked by the caller) re-reads the provider. */
export async function processPay03bProviderEvent({ db = supabase, provider, event }) {
  const object = event?.data?.object || {};
  let row = null;
  if (String(event.type).startsWith('checkout.session.')) {
    row = await findSubscriptionRow(db, 'subscription_reference', object.client_reference_id);
    if (row?.provider_checkout_id && row.provider_checkout_id !== object.id) throw new Pay03bError('PAY03B_EVENT_REFERENCE_MISMATCH', 400);
  } else if (String(event.type).startsWith('customer.subscription.')) {
    row = await findSubscriptionRow(db, 'provider_subscription_id', object.id)
      || await findSubscriptionRow(db, 'subscription_reference', object.metadata?.carup_subscription_reference);
    if (row?.provider_subscription_id && row.provider_subscription_id !== object.id) throw new Pay03bError('PAY03B_EVENT_REFERENCE_MISMATCH', 400);
  } else if (String(event.type).startsWith('invoice.')) {
    const subscriptionId = typeof object.subscription === 'string' ? object.subscription
      : object.subscription?.id || object.parent?.subscription_details?.subscription || null;
    row = await findSubscriptionRow(db, 'provider_subscription_id', subscriptionId);
  } else {
    // Refund / charge / payment events: bound through the canonical invoice payment's PaymentIntent.
    const intentId = object.object === 'payment_intent' ? object.id
      : (typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent?.id);
    if (intentId) {
      const invoices = await selectRows(db.from('pay03b_subscription_invoices').select('subscription_id')
        .eq('provider_payment_intent_id', intentId));
      row = invoices[0] ? await findSubscriptionRow(db, 'id', invoices[0].subscription_id) : null;
    }
  }
  if (!row) return { ignored: true, reason: 'unmatched_provider_object', live: false };
  const result = await syncPay03bSubscriptionFromProvider({ db, provider, subscriptionRow: row, eventId: event.id, eventType: event.type });
  return { ...result, subscriptionId: row.id, live: false, simulated: provider.isSimulator === true };
}

// --------------------------------------------------------------------------------------------- dealer actions
function returnUrls(provider, env) {
  const origin = provider.returnOrigin || String(env.CARUP_PAY01A_RETURN_ORIGIN || '').replace(/\/$/, '');
  if (!origin) throw new Pay03bError('PAY03B_RETURN_ORIGIN_REQUIRED', 503);
  return {
    successUrl: `${origin}/dealer/subscription?pay03b=returned`,
    cancelUrl: `${origin}/dealer/subscription?pay03b=cancelled`,
  };
}

function assertTermsAcknowledged(plan, terms) {
  const t = terms || {};
  if (Number(t.planVersion) !== Number(plan.plan_version) || Number(t.amountMinor) !== Number(plan.amount_minor)
    || String(t.currency || '').toUpperCase() !== plan.currency || t.billingInterval !== plan.billing_interval
    || Number(t.intervalCount) !== Number(plan.interval_count)) {
    throw new Pay03bError('PAY03B_TERMS_CHANGED', 409);
  }
}

function checkoutMatchesPlan(checkout, plan) {
  return Number.isSafeInteger(checkout?.amountTotalMinor) && checkout.amountTotalMinor === Number(plan.amount_minor)
    && checkout.currency === plan.currency;
}

/**
 * The provider's own statement of the charge must equal the governed plan before a Checkout URL is handed to a buyer.
 * A drifted session (a mis-provisioned price, a provider-side change) is expired at the provider, the agreement is
 * re-read into incomplete_expired (so nothing is left stuck), the refusal is audited, and the buyer gets no URL.
 */
async function refuseDriftedCheckout({ db, provider, subscriptionId, checkout, plan, actorId, actorRole, tenantId, requestContext }) {
  if (checkout.status === undefined || checkout.status === 'open') {
    try { await provider.expireCheckout(checkout.checkoutId || checkout.id); } catch { /* the re-read below decides */ }
  }
  const [row] = await selectRows(db.from('pay03b_business_subscriptions').select('*').eq('id', subscriptionId));
  if (row) await syncPay03bSubscriptionFromProvider({ db, provider, subscriptionRow: row });
  await recordPay03bAudit(db, {
    eventType: 'PAY03B_SUBSCRIPTION_CHECKOUT_REFUSED_AMOUNT_MISMATCH', actorId, actorRole, tenantId,
    sourceRoute: '/api/pay03b/dealer/subscription/checkout', requestContext,
    reason: 'The provider checkout amount or currency differed from the governed plan; the session was expired unused.',
    subject: { subscriptionId, planCode: plan.plan_code, planVersion: plan.plan_version, governedAmountMinor: Number(plan.amount_minor),
      governedCurrency: plan.currency, providerAmountMinor: checkout.amountTotalMinor ?? null, providerCurrency: checkout.currency ?? null,
      gateway: provider.gateway },
  });
  throw new Pay03bError('PAY03B_CHECKOUT_AMOUNT_MISMATCH', 502);
}

export async function createPay03bDealerCheckout({
  db = supabase, env = process.env, stripe = null, provider: injected = null, actorId, tenantId, planId, acknowledgedTerms,
  requestKey, requestContext = null,
}) {
  const provider = resolvePay03bProvider({ env, stripe, provider: injected });
  const ctx = await resolvePay03bDealerContext({ db, actorId, tenantId });
  if (!ctx.billingAuthority) throw new Pay03bError('PAY03B_BILLING_AUTHORITY_REFUSED', 403);
  validateRequestKey(requestKey);
  const plans = await selectRows(db.from('pay03b_subscription_plans').select('*').eq('id', planId));
  if (plans.length !== 1) throw new Pay03bError('PAY03B_PLAN_NOT_FOUND', 404);
  const [plan] = plans;
  if (plan.pricing_kind === 'sandbox_fixture') assertTermsAcknowledged(plan, acknowledgedTerms);
  let claim;
  try {
    claim = await rpc(db, 'pay03b_claim_business_subscription_checkout', {
      p_owner_tenant_id: tenantId, p_owner_organization_id: ctx.organization.id, p_actor_id: actorId,
      p_plan_id: planId, p_request_key: requestKey, p_gateway: provider.gateway,
    });
  } catch (err) {
    // A checkout for the SAME plan that is still open (for example after a reload lost the idempotency key) is
    // resumed, never duplicated. Anything else stays refused until it completes or is explicitly abandoned.
    if (err?.code !== 'PAY03B_SUBSCRIPTION_ALREADY_EXISTS') throw err;
    const live = (await loadTenantSubscriptions(db, tenantId)).find((r) => !['incomplete_expired', 'cancelled', 'expired'].includes(r.status));
    if (live?.status === 'incomplete' && live.plan_id === planId && live.provider_checkout_id && live.gateway === provider.gateway) {
      await provider.verifyAccount();
      const existing = await provider.getCheckout(live.provider_checkout_id);
      if (existing.status === 'open' && !checkoutMatchesPlan(existing, plan)) {
        await refuseDriftedCheckout({ db, provider, subscriptionId: live.id, checkout: existing, plan, actorId,
          actorRole: ctx.tenantRole, tenantId, requestContext });
      }
      if (existing.status === 'open' && existing.url) {
        return { subscriptionId: live.id, checkoutId: existing.id, checkoutUrl: existing.url, checkoutStatus: 'open',
          idempotentReplay: true, resumed: true, gateway: provider.gateway, simulated: provider.isSimulator === true,
          amountMinor: Number(plan.amount_minor), currency: plan.currency, live: false };
      }
    }
    throw err;
  }
  const sub = claim.subscription;
  await provider.verifyAccount();
  if (sub.provider_checkout_id) {
    const existing = await provider.getCheckout(sub.provider_checkout_id);
    if (existing.status === 'open' && !checkoutMatchesPlan(existing, plan)) {
      await refuseDriftedCheckout({ db, provider, subscriptionId: sub.id, checkout: existing, plan, actorId,
        actorRole: ctx.tenantRole, tenantId, requestContext });
    }
    return { subscriptionId: sub.id, checkoutId: existing.id, checkoutUrl: existing.status === 'open' ? existing.url || null : null,
      checkoutStatus: existing.status, idempotentReplay: true, gateway: provider.gateway, simulated: provider.isSimulator === true,
      amountMinor: Number(plan.amount_minor), currency: plan.currency, live: false };
  }
  let customerId = claim.provider_customer_id;
  if (!customerId) {
    ({ customerId } = await provider.ensureCustomer({
      organizationId: ctx.organization.id, tenantId, displayName: ctx.organization.name,
      idempotencyKey: hashKey('carup_pay03b_customer', provider.gateway, ctx.organization.id),
    }));
    await rpc(db, 'pay03b_bind_billing_customer', {
      p_owner_tenant_id: tenantId, p_owner_organization_id: ctx.organization.id, p_gateway: provider.gateway,
      p_provider_customer_id: customerId, p_actor_id: actorId,
    });
  }
  const { successUrl, cancelUrl } = returnUrls(provider, env);
  const checkout = await provider.createSubscriptionCheckout({
    customerId, priceRef: plan.provider_price_ref, amountMinor: Number(plan.amount_minor), currency: plan.currency,
    subscriptionReference: sub.subscription_reference,
    metadata: { carup_owner_tenant_id: tenantId, carup_owner_organization_id: ctx.organization.id,
      carup_plan_code: plan.plan_code, carup_plan_version: String(plan.plan_version) },
    successUrl, cancelUrl, idempotencyKey: hashKey('carup_pay03b_checkout', sub.id),
  });
  await rpc(db, 'pay03b_attach_subscription_checkout', {
    p_subscription_id: sub.id, p_checkout_id: checkout.checkoutId, p_provider_customer_id: customerId,
  });
  if (!checkoutMatchesPlan(checkout, plan)) {
    await refuseDriftedCheckout({ db, provider, subscriptionId: sub.id, checkout: { ...checkout, status: 'open' }, plan, actorId,
      actorRole: ctx.tenantRole, tenantId, requestContext });
  }
  await recordPay03bAudit(db, {
    eventType: 'PAY03B_SUBSCRIPTION_CHECKOUT_CREATED', actorId, actorRole: ctx.tenantRole, tenantId,
    sourceRoute: '/api/pay03b/dealer/subscription/checkout', requestContext,
    reason: 'Tenant billing administrator started a sandbox subscription checkout.',
    subject: { subscriptionId: sub.id, organizationId: ctx.organization.id, planCode: plan.plan_code,
      planVersion: plan.plan_version, amountMinor: Number(plan.amount_minor), currency: plan.currency, gateway: provider.gateway },
  });
  return { subscriptionId: sub.id, checkoutId: checkout.checkoutId, checkoutUrl: checkout.url, checkoutStatus: 'open',
    idempotentReplay: false, gateway: provider.gateway, simulated: provider.isSimulator === true,
    amountMinor: Number(plan.amount_minor), currency: plan.currency, live: false };
}

/** Explicitly abandon an open, unpaid checkout: the provider expires it and the agreement becomes incomplete_expired. */
export async function abandonPay03bDealerCheckout({ db = supabase, env = process.env, stripe = null, provider: injected = null,
  actorId, tenantId, requestContext = null }) {
  const provider = resolvePay03bProvider({ env, stripe, provider: injected });
  const ctx = await resolvePay03bDealerContext({ db, actorId, tenantId });
  if (!ctx.billingAuthority) throw new Pay03bError('PAY03B_BILLING_AUTHORITY_REFUSED', 403);
  const live = (await loadTenantSubscriptions(db, tenantId)).find((r) => r.status === 'incomplete' && r.provider_checkout_id);
  if (!live || live.gateway !== provider.gateway) throw new Pay03bError('PAY03B_NO_OPEN_CHECKOUT', 409);
  await provider.verifyAccount();
  const checkout = await provider.getCheckout(live.provider_checkout_id);
  if (checkout.status === 'open') await provider.expireCheckout(live.provider_checkout_id);
  await syncPay03bSubscriptionFromProvider({ db, provider, subscriptionRow: live });
  await recordPay03bAudit(db, { eventType: 'PAY03B_SUBSCRIPTION_CHECKOUT_ABANDONED', actorId, actorRole: ctx.tenantRole, tenantId,
    sourceRoute: '/api/pay03b/dealer/subscription/checkout/abandon', requestContext,
    reason: 'Tenant billing administrator abandoned an unpaid subscription checkout.', subject: { subscriptionId: live.id } });
  return getPay03bDealerOverview({ db, env, actorId, tenantId });
}

export async function verifyPay03bDealerSubscription({ db = supabase, env = process.env, stripe = null, provider: injected = null, actorId, tenantId }) {
  await resolvePay03bDealerContext({ db, actorId, tenantId });
  const [row] = await loadTenantSubscriptions(db, tenantId);
  if (row && ['incomplete', 'trialing', 'active', 'past_due', 'grace_period', 'paused', 'suspended'].includes(row.status)) {
    const provider = resolvePay03bProvider({ env, stripe, provider: injected });
    await syncPay03bSubscriptionFromProvider({ db, provider, subscriptionRow: row });
  }
  return getPay03bDealerOverview({ db, env, actorId, tenantId });
}

async function liveSubscriptionFor(db, tenantId) {
  const rows = await loadTenantSubscriptions(db, tenantId);
  const live = rows.find((r) => !['incomplete_expired', 'cancelled', 'expired'].includes(r.status));
  if (!live) throw new Pay03bError('PAY03B_NO_LIVE_SUBSCRIPTION', 404);
  return live;
}

async function performChange({ db, provider, row, actorId, changeType, targetPlanId = null, requestKey, reason, apply }) {
  const requested = await rpc(db, 'pay03b_request_subscription_change', {
    p_subscription_id: row.id, p_actor_id: actorId, p_change_type: changeType, p_target_plan_id: targetPlanId,
    p_request_key: validateRequestKey(requestKey), p_reason: reason || null,
  });
  if (requested.replay && requested.request.status !== 'requested') {
    return { requestId: requested.request.id, status: requested.request.status, replay: true };
  }
  try {
    await apply(requested);
    await rpc(db, 'pay03b_complete_subscription_change', { p_request_id: requested.request.id, p_status: 'provider_confirmed',
      p_outcome_code: 'provider_accepted' });
  } catch (err) {
    await db.rpc('pay03b_complete_subscription_change', { p_request_id: requested.request.id, p_status: 'failed',
      p_outcome_code: String(err?.code || 'PROVIDER_FAILED').slice(0, 80) });
    throw err;
  }
  const [fresh] = await selectRows(db.from('pay03b_business_subscriptions').select('*').eq('id', row.id));
  await syncPay03bSubscriptionFromProvider({ db, provider, subscriptionRow: fresh });
  return { requestId: requested.request.id, status: 'provider_confirmed', replay: false };
}

export async function changePay03bDealerPlan({ db = supabase, env = process.env, stripe = null, provider: injected = null,
  actorId, tenantId, targetPlanId, mode, requestKey }) {
  if (!['period_end', 'immediate'].includes(mode)) throw new Pay03bError('PAY03B_PLAN_CHANGE_MODE_INVALID', 400);
  const provider = resolvePay03bProvider({ env, stripe, provider: injected });
  await resolvePay03bDealerContext({ db, actorId, tenantId });
  const row = await liveSubscriptionFor(db, tenantId);
  const result = await performChange({ db, provider, row, actorId, requestKey,
    changeType: mode === 'immediate' ? 'plan_change_immediate' : 'plan_change_period_end', targetPlanId,
    apply: async (requested) => {
      const snapshot = await provider.getSubscription(row.provider_subscription_id);
      await provider.changePlan({ subscriptionId: row.provider_subscription_id, itemId: snapshot.itemId,
        priceRef: requested.target_plan.provider_price_ref, amountMinor: Number(requested.target_plan.amount_minor), mode,
        idempotencyKey: hashKey('carup_pay03b_change', requested.request.id) });
    } });
  return { ...result, overview: await getPay03bDealerOverview({ db, env, actorId, tenantId }) };
}

export async function previewPay03bDealerPlanChange({ db = supabase, env = process.env, stripe = null, provider: injected = null,
  actorId, tenantId, targetPlanId, mode }) {
  if (!['period_end', 'immediate'].includes(mode)) throw new Pay03bError('PAY03B_PLAN_CHANGE_MODE_INVALID', 400);
  const provider = resolvePay03bProvider({ env, stripe, provider: injected });
  const ctx = await resolvePay03bDealerContext({ db, actorId, tenantId });
  if (!ctx.billingAuthority) throw new Pay03bError('PAY03B_BILLING_AUTHORITY_REFUSED', 403);
  const row = await liveSubscriptionFor(db, tenantId);
  const [target] = await selectRows(db.from('pay03b_subscription_plans').select('*').eq('id', targetPlanId));
  // Same rule as pay03b_request_subscription_change, checked BEFORE any provider call: a plan the subscription's
  // gateway cannot bill is refused here, so another gateway's price reference never reaches the provider (F-L2-01).
  if (!target || target.subscription_scope !== PAY03B_DEALER_SCOPE || !target.provider_price_ref
    || !(target.provider_allowlist || []).includes(row.gateway)) {
    throw new Pay03bError('PAY03B_TARGET_PLAN_NOT_PURCHASABLE', 409);
  }
  const snapshot = await provider.getSubscription(row.provider_subscription_id);
  const preview = await provider.previewPlanChange({ customerId: snapshot.customerId, subscriptionId: snapshot.id,
    itemId: snapshot.itemId, priceRef: target.provider_price_ref, amountMinor: Number(target.amount_minor), mode });
  return { mode, targetPlanCode: target.plan_code, chargeNowMinor: preview.amountDueMinor, currency: preview.currency,
    effectiveFrom: mode === 'period_end' ? snapshot.currentPeriodEnd : 'on_successful_payment', lines: preview.lines,
    providerBacked: true, simulated: provider.isSimulator === true };
}

export async function cancelPay03bDealerSubscription({ db = supabase, env = process.env, stripe = null, provider: injected = null,
  actorId, tenantId, mode, requestKey, reason }) {
  if (!['period_end', 'immediate', 'resume'].includes(mode)) throw new Pay03bError('PAY03B_CANCELLATION_MODE_INVALID', 400);
  const provider = resolvePay03bProvider({ env, stripe, provider: injected });
  await resolvePay03bDealerContext({ db, actorId, tenantId });
  const row = await liveSubscriptionFor(db, tenantId);
  const changeType = mode === 'period_end' ? 'cancel_at_period_end' : mode === 'immediate' ? 'cancel_immediately' : 'resume';
  const result = await performChange({ db, provider, row, actorId, requestKey, changeType, reason,
    apply: async (requested) => {
      const idempotencyKey = hashKey('carup_pay03b_cancel', requested.request.id);
      if (mode === 'immediate') await provider.cancelSubscription({ subscriptionId: row.provider_subscription_id, idempotencyKey });
      else await provider.setCancelAtPeriodEnd({ subscriptionId: row.provider_subscription_id, cancelAtPeriodEnd: mode === 'period_end', idempotencyKey });
    } });
  return { ...result, overview: await getPay03bDealerOverview({ db, env, actorId, tenantId }) };
}

export async function createPay03bPaymentMethodUpdate({ db = supabase, env = process.env, stripe = null, provider: injected = null,
  actorId, tenantId }) {
  const provider = resolvePay03bProvider({ env, stripe, provider: injected });
  const ctx = await resolvePay03bDealerContext({ db, actorId, tenantId });
  if (!ctx.billingAuthority) throw new Pay03bError('PAY03B_BILLING_AUTHORITY_REFUSED', 403);
  const row = await liveSubscriptionFor(db, tenantId);
  const customerId = await billingCustomerFor(db, row);
  if (!customerId) throw new Pay03bError('PAY03B_BILLING_CUSTOMER_MISSING', 409);
  const { successUrl } = returnUrls(provider, env);
  return provider.createPaymentMethodUpdateSession({ customerId, subscriptionId: row.provider_subscription_id, returnUrl: successUrl,
    idempotencyKey: hashKey('carup_pay03b_pm_update', row.id, new Date().toISOString().slice(0, 13)) });
}

export async function getPay03bInvoicePaymentLink({ db = supabase, env = process.env, stripe = null, provider: injected = null,
  actorId, tenantId, invoiceId }) {
  const provider = resolvePay03bProvider({ env, stripe, provider: injected });
  const ctx = await resolvePay03bDealerContext({ db, actorId, tenantId });
  if (!ctx.billingAuthority) throw new Pay03bError('PAY03B_BILLING_AUTHORITY_REFUSED', 403);
  const [invoice] = await selectRows(db.from('pay03b_subscription_invoices').select('*').eq('id', invoiceId));
  if (!invoice || invoice.owner_tenant_id !== tenantId) throw new Pay03bError('PAY03B_INVOICE_NOT_FOUND', 404);
  if (invoice.provider_status !== 'open') throw new Pay03bError('PAY03B_INVOICE_NOT_PAYABLE', 409);
  return provider.getInvoicePaymentLink(invoice.provider_invoice_id);
}

// --------------------------------------------------------------------------------------------- administrator
export async function listPay03bAdminSubscriptions({ db = supabase } = {}) {
  const rows = await selectRows(db.from('pay03b_business_subscriptions').select('*').order('updated_at', { ascending: false }).limit(100));
  const plans = await selectRows(db.from('pay03b_subscription_plans').select('id, plan_code, plan_version'));
  const plansById = new Map(plans.map((p) => [p.id, p]));
  const orgIds = [...new Set(rows.map((r) => r.owner_organization_id))];
  const orgs = orgIds.length ? await selectRows(db.from('organizations').select('id, name, type').in('id', orgIds)) : [];
  const orgsById = new Map(orgs.map((o) => [o.id, o]));
  const subscriptions = [];
  for (const row of rows) {
    const ent = await rpc(db, 'pay03b_resolve_tenant_entitlements', { p_tenant_id: row.owner_tenant_id, p_subscription_scope: row.subscription_scope });
    subscriptions.push({ ...projectSubscription(row, plansById), organizationName: orgsById.get(row.owner_organization_id)?.name || null,
      access: ent?.subscription_id === row.id ? Boolean(ent.access) : false, accessReason: ent?.subscription_id === row.id ? ent.reason : 'not_current' });
  }
  return { subscriptions, sourceOfTruth: SOURCE_OF_TRUTH };
}

export async function readPay03bAdminSubscription({ db = supabase, subscriptionId }) {
  const [row] = await selectRows(db.from('pay03b_business_subscriptions').select('*').eq('id', subscriptionId));
  if (!row) throw new Pay03bError('PAY03B_SUBSCRIPTION_NOT_FOUND', 404);
  const plans = await selectRows(db.from('pay03b_subscription_plans').select('id, plan_code, plan_version'));
  const plansById = new Map(plans.map((p) => [p.id, p]));
  return {
    subscription: projectSubscription(row, plansById),
    invoices: await loadInvoices(db, row.id),
    transitions: await selectRows(db.from('pay03b_subscription_transitions').select('*').eq('subscription_id', row.id)
      .order('recorded_at', { ascending: false }).limit(100)),
    changeRequests: await selectRows(db.from('pay03b_subscription_change_requests').select('*').eq('subscription_id', row.id)
      .order('requested_at', { ascending: false }).limit(100)),
    syncExceptions: (await selectRows(db.from('pay03b_subscription_sync_exceptions').select('*').eq('subscription_id', row.id)
      .order('last_seen_at', { ascending: false }).limit(100))).map((x) => ({
      id: x.id, providerInvoiceId: x.provider_invoice_id, errorCode: x.error_code, status: x.status,
      observationCount: x.observation_count, firstSeenAt: x.first_seen_at, lastSeenAt: x.last_seen_at, clearedAt: x.cleared_at || null,
    })),
    entitlements: await getPay03bTenantEntitlements({ db, tenantId: row.owner_tenant_id }),
    sourceOfTruth: SOURCE_OF_TRUTH,
  };
}

export async function reconcilePay03bAdminSubscription({ db = supabase, env = process.env, stripe = null, provider: injected = null,
  subscriptionId, adminActorId, adminActorRole = 'admin', requestContext = null }) {
  const admin = requireAdminActor(adminActorId);
  const [row] = await selectRows(db.from('pay03b_business_subscriptions').select('*').eq('id', subscriptionId));
  if (!row) throw new Pay03bError('PAY03B_SUBSCRIPTION_NOT_FOUND', 404);
  const provider = resolvePay03bProvider({ env, stripe, provider: injected });
  const result = await syncPay03bSubscriptionFromProvider({ db, provider, subscriptionRow: row });
  await recordPay03bAudit(db, { eventType: 'PAY03B_ADMIN_SUBSCRIPTION_RECONCILED', actorId: admin, actorRole: adminActorRole,
    tenantId: row.owner_tenant_id, sourceRoute: '/api/pay03b/admin/subscriptions/reconcile', requestContext,
    reason: 'Administrator re-read provider state into the canonical subscription authority.',
    subject: { subscriptionId, state: result.state, invoicesSynced: result.invoicesSynced || 0 } });
  return { result, ...(await readPay03bAdminSubscription({ db, subscriptionId })) };
}

export async function setPay03bAdminSuspension({ db = supabase, subscriptionId, adminActorId, adminActorRole = 'admin', action,
  reason, requestKey, requestContext = null }) {
  const admin = requireAdminActor(adminActorId);
  const out = await rpc(db, 'pay03b_admin_set_subscription_suspension', {
    p_subscription_id: subscriptionId, p_actor_id: admin, p_action: action, p_reason: reason, p_request_key: validateRequestKey(requestKey),
  });
  await recordPay03bAudit(db, { eventType: action === 'suspend' ? 'PAY03B_ADMIN_SUBSCRIPTION_SUSPENDED' : 'PAY03B_ADMIN_SUBSCRIPTION_RESUMED',
    actorId: admin, actorRole: adminActorRole, tenantId: out.subscription?.owner_tenant_id || null,
    sourceRoute: '/api/pay03b/admin/subscriptions/suspension', requestContext, reason,
    subject: { subscriptionId, replay: Boolean(out.replay), resultingStatus: out.subscription?.status } });
  return readPay03bAdminSubscription({ db, subscriptionId });
}

/** Governed full refund of one invoice payment (audited before any provider call; fails closed). */
export async function refundPay03bAdminInvoice({ db = supabase, env = process.env, stripe = null, provider: injected = null,
  subscriptionId, invoiceId, adminActorId, adminActorRole = 'admin', reason, requestContext = null }) {
  const admin = requireAdminActor(adminActorId);
  if (typeof reason !== 'string' || reason.trim().length < 10) throw new Pay03bError('PAY03B_ADMIN_REASON_REQUIRED', 400);
  const [row] = await selectRows(db.from('pay03b_business_subscriptions').select('*').eq('id', subscriptionId));
  const [invoice] = await selectRows(db.from('pay03b_subscription_invoices').select('*').eq('id', invoiceId));
  if (!row || !invoice || invoice.subscription_id !== row.id) throw new Pay03bError('PAY03B_INVOICE_NOT_FOUND', 404);
  if (!invoice.payment_reference || invoice.provider_status !== 'paid') throw new Pay03bError('PAY03B_INVOICE_NOT_REFUNDABLE', 409);
  const [payment] = await selectRows(db.from('payment_transactions').select('reference, status').eq('reference', invoice.payment_reference));
  if (payment?.status !== 'paid') throw new Pay03bError('PAY03B_INVOICE_NOT_REFUNDABLE', 409);
  const provider = resolvePay03bProvider({ env, stripe, provider: injected });
  const subject = { subscriptionId, invoiceId, paymentReference: invoice.payment_reference,
    amountMinor: Number(invoice.amount_due_minor), currency: invoice.currency, gateway: row.gateway };
  const requested = await recordPay03bAudit(db, { eventType: 'PAY03B_ADMIN_INVOICE_REFUND_REQUESTED', actorId: admin,
    actorRole: adminActorRole, tenantId: row.owner_tenant_id, sourceRoute: '/api/pay03b/admin/invoices/refund', requestContext,
    reason: reason.trim(), subject });
  if (!pay03bAuditSucceeded(requested)) throw new Pay03bError('PAY03B_REFUND_AUDIT_UNAVAILABLE', 503);
  try {
    const refund = await provider.refundInvoicePayment({ paymentIntentId: invoice.provider_payment_intent_id,
      amountMinor: Number(invoice.amount_due_minor), idempotencyKey: hashKey('carup_pay03b_invoice_refund', invoice.id),
      metadata: { carup_invoice_id: invoice.id } });
    await syncPay03bSubscriptionFromProvider({ db, provider, subscriptionRow: row });
    await recordPay03bAudit(db, { eventType: 'PAY03B_ADMIN_INVOICE_REFUND_RESULT', actorId: admin, actorRole: adminActorRole,
      tenantId: row.owner_tenant_id, sourceRoute: '/api/pay03b/admin/invoices/refund', requestContext, reason: reason.trim(),
      subject: { ...subject, outcome: refund.status, refundId: refund.refundId } });
  } catch (err) {
    await recordPay03bAudit(db, { eventType: 'PAY03B_ADMIN_INVOICE_REFUND_RESULT', actorId: admin, actorRole: adminActorRole,
      tenantId: row.owner_tenant_id, sourceRoute: '/api/pay03b/admin/invoices/refund', requestContext, reason: reason.trim(),
      subject: { ...subject, outcome: 'failed', errorCode: err?.code || 'PAY03B_REFUND_FAILED' } });
    throw err;
  }
  return readPay03bAdminSubscription({ db, subscriptionId });
}

// --------------------------------------------------------------------------------------------- entitlement guard
/**
 * Backend domain-operation guard for the dealer listing-capacity entitlement. Inert unless
 * CARUP_PAY03B_ENTITLEMENT_ENFORCEMENT is explicitly 'true' (the capacity values are sandbox fixtures; retail values
 * are an Owner decision), so existing dealers are unaffected outside a governed sandbox. Fails closed on read errors.
 */
export async function assertPay03bListingCapacity({ db = supabase, env = process.env, tenantId, vehicleId = null }) {
  if (env.CARUP_PAY03B_ENTITLEMENT_ENFORCEMENT !== 'true' || !tenantId) return { enforced: false };
  let entitlements;
  try { entitlements = await getPay03bTenantEntitlements({ db, tenantId }); }
  catch { throw new Pay03bError('PAY03B_ENTITLEMENT_UNAVAILABLE', 503); }
  const capacity = entitlements.effective[PAY03B_LISTING_CAPACITY_KEY];
  // Enforcement without any governed capacity (no baseline plan, no paid plan) would be "unlimited": refuse instead.
  if (!Number.isInteger(capacity)) throw new Pay03bError('PAY03B_ENTITLEMENT_BASELINE_MISSING', 503);
  const published = (await selectRows(db.from('vehicles').select('vin, publication_status').eq('tenant_id', tenantId)
    .eq('publication_status', 'published'), 'PAY03B_ENTITLEMENT_UNAVAILABLE'))
    .filter((v) => String(v.vin) !== String(vehicleId)).length;
  if (published >= capacity) {
    throw new Pay03bError('PAY03B_LISTING_CAPACITY_REACHED', 403, {
      capacity, published, subscriptionAccess: entitlements.access, accessReason: entitlements.reason,
    });
  }
  return { enforced: true, capacity, published };
}
