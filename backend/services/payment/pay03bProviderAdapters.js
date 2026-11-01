/**
 * CARUP-PAY-03B-LR01 Work Unit 05 — recurring billing provider adapters.
 *
 * The subscription service talks only to CarUp-shaped objects (ADR-001 §5: no provider vocabulary crosses the
 * adapter boundary). Adapters implement the existing Diaspora BillingProvider capability surface plus the
 * recurring-billing reads the canonical writers need.
 *
 *  - Pay03bStripeSandboxProvider: the official Stripe SDK on the PAY-01A CarUp Japan SANDBOX account only
 *    (test key, verified account id, non-production, explicit CARUP_PAY03B_ENABLED). Constructing it performs no
 *    network call; every operation verifies the account first.
 *  - The local UAT simulator lives in pay03bLocalSimulator.js and returns the same shapes.
 *
 * Stripe API versions: the SDK pins 2025-02-24.acacia (top-level subscription periods, invoice.subscription,
 * invoice.payment_intent). Newer versions move periods to subscription items and invoice links to
 * invoice.parent / invoice.payments. The normalizers accept both, so a webhook rendered in a newer account
 * version and an SDK read converge on the same CarUp snapshot.
 */
import { BillingProvider } from '../diaspora/billing/billingProviderBase.js';
import {
  PAY01A_ACCOUNT, classifyPay01aRefundEvidence, pay01aProviderId,
} from './pay01aContract.js';
import { Pay03bError, requirePay03bSandbox } from './pay03bContract.js';

export const PAY03B_STRIPE_GATEWAY = 'stripe_carup_japan_sandbox';
const SUBSCRIPTION_STATUSES = new Set(['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused']);
const INVOICE_STATUSES = new Set(['draft', 'open', 'paid', 'uncollectible', 'void']);
const BILLING_REASONS = new Set(['subscription_create', 'subscription_cycle', 'subscription_update', 'manual']);
const PENDING_INTENT_STATUSES = new Set(['processing', 'requires_payment_method', 'requires_confirmation', 'requires_action', 'requires_capture']);

function toIso(seconds) {
  if (seconds === null || seconds === undefined) return null;
  if (!Number.isFinite(Number(seconds))) throw new Pay03bError('PAY03B_PROVIDER_TIMESTAMP_INVALID', 502);
  return new Date(Number(seconds) * 1000).toISOString();
}

function requireTestObject(object) {
  if (!object || object.livemode !== false) throw new Pay03bError('PAY03B_PROVIDER_LIVE_OBJECT_REFUSED', 502);
}

export function normalizeStripeSubscription(sub) {
  requireTestObject(sub);
  if (!SUBSCRIPTION_STATUSES.has(sub.status)) throw new Pay03bError('PAY03B_PROVIDER_STATUS_UNKNOWN', 502);
  const items = sub.items?.data || [];
  if (items.length !== 1 || (items[0].quantity !== undefined && items[0].quantity !== 1)) {
    throw new Pay03bError('PAY03B_PROVIDER_SUBSCRIPTION_SHAPE_UNSUPPORTED', 502);
  }
  const [item] = items;
  const reference = sub.metadata?.carup_subscription_reference;
  return {
    id: sub.id,
    livemode: false,
    status: sub.status,
    customerId: pay01aProviderId(sub.customer),
    itemId: item.id,
    priceRef: pay01aProviderId(item.price) || null,
    currentPeriodStart: toIso(sub.current_period_start ?? item.current_period_start),
    currentPeriodEnd: toIso(sub.current_period_end ?? item.current_period_end),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    canceledAt: toIso(sub.canceled_at),
    endedAt: toIso(sub.ended_at),
    trialEnd: toIso(sub.trial_end),
    latestInvoiceId: pay01aProviderId(sub.latest_invoice) || null,
    pendingUpdate: Boolean(sub.pending_update),
    subscriptionReference: typeof reference === 'string' && /^pay03b_sub_[0-9a-f-]{36}$/.test(reference) ? reference : null,
  };
}

function linePrice(line) {
  return pay01aProviderId(line.price) || line.pricing?.price_details?.price || null;
}

function lineIsProration(line) {
  return Boolean(line.proration ?? line.parent?.subscription_item_details?.proration);
}

/** The line that states which governed price, and which period, the invoice actually bills. */
function selectBilledLine(lines, billingReason) {
  const candidates = lines.filter((line) => linePrice(line) && line.period?.start && line.period?.end);
  if (billingReason === 'subscription_update') {
    return candidates.find((line) => lineIsProration(line) && Number(line.amount) > 0) || null;
  }
  return candidates.find((line) => !lineIsProration(line)) || null;
}

export function normalizeStripeInvoice(inv) {
  requireTestObject(inv);
  if (!BILLING_REASONS.has(inv.billing_reason)) throw new Pay03bError('PAY03B_INVOICE_BILLING_REASON_UNSUPPORTED', 409);
  if (!INVOICE_STATUSES.has(inv.status)) throw new Pay03bError('PAY03B_PROVIDER_STATUS_UNKNOWN', 502);
  const line = selectBilledLine(inv.lines?.data || [], inv.billing_reason);
  if (!line) throw new Pay03bError('PAY03B_INVOICE_LINE_UNSUPPORTED', 502);
  const paymentIntentId = pay01aProviderId(inv.payment_intent)
    || (inv.payments?.data || []).map((p) => pay01aProviderId(p.payment?.payment_intent)).find(Boolean) || null;
  return {
    id: inv.id,
    livemode: false,
    status: inv.status,
    billingReason: inv.billing_reason,
    customerId: pay01aProviderId(inv.customer),
    subscriptionId: pay01aProviderId(inv.subscription) || inv.parent?.subscription_details?.subscription || null,
    currency: String(inv.currency || '').toUpperCase(),
    amountDueMinor: Number(inv.amount_due),
    amountPaidMinor: Number(inv.amount_paid),
    amountRemainingMinor: Number(inv.amount_remaining),
    paymentIntentId,
    attemptCount: Number(inv.attempt_count || 0),
    nextPaymentAttempt: toIso(inv.next_payment_attempt),
    periodStart: toIso(line.period.start),
    periodEnd: toIso(line.period.end),
    priceRef: linePrice(line),
    hostedInvoiceUrl: inv.status === 'open' ? (inv.hosted_invoice_url || null) : null,
  };
}

export function normalizeStripeCheckout(session) {
  requireTestObject(session);
  return {
    id: session.id,
    livemode: false,
    mode: session.mode,
    status: session.status,
    paymentStatus: session.payment_status || null,
    customerId: pay01aProviderId(session.customer),
    subscriptionId: pay01aProviderId(session.subscription) || null,
    clientReference: session.client_reference_id || null,
    metadata: session.metadata || {},
    url: session.status === 'open' ? (session.url || null) : null,
  };
}

/**
 * Provider money truth for one invoice PaymentIntent. A failed collection attempt is 'pending' (never 'paid');
 * refunds are classified by the same F5 classifier as PAY-01A, so a partial refund holds the payment.
 */
export function paymentTruthFromProvider({ intent, refunds = [], amountMinor, currency }) {
  requireTestObject(intent);
  if (String(intent.currency || '').toUpperCase() !== String(currency).toUpperCase() || Number(intent.amount) !== Number(amountMinor)) {
    throw new Pay03bError('PAY03B_PROVIDER_PAYMENT_AMOUNT_MISMATCH', 409);
  }
  if (intent.status === 'succeeded') {
    if (Number(intent.amount_received) !== Number(amountMinor)) throw new Pay03bError('PAY03B_PROVIDER_PAYMENT_AMOUNT_MISMATCH', 409);
    const evidence = classifyPay01aRefundEvidence({
      intentId: intent.id, amountMinor: Number(amountMinor), currency: String(currency).toLowerCase(), refunds,
    });
    return {
      status: evidence.state, intentId: intent.id, refundedMinor: evidence.refundedMinor,
      pendingRefundMinor: evidence.pendingRefundMinor, refundIds: evidence.refundIds, mismatch: evidence.mismatch || null,
      oldestSucceededRefundId: refunds.filter((r) => r.status === 'succeeded')
        .sort((a, b) => (Number(a.created) || 0) - (Number(b.created) || 0))[0]?.id || null,
    };
  }
  if (PENDING_INTENT_STATUSES.has(intent.status)) {
    return { status: 'pending', intentId: intent.id, refundedMinor: 0, pendingRefundMinor: 0, refundIds: [], mismatch: null, oldestSucceededRefundId: null };
  }
  if (intent.status === 'canceled') {
    return { status: 'cancelled', intentId: intent.id, refundedMinor: 0, pendingRefundMinor: 0, refundIds: [], mismatch: null, oldestSucceededRefundId: null };
  }
  throw new Pay03bError('PAY03B_PROVIDER_PAYMENT_STATUS_UNKNOWN', 502);
}

function providerFailure(err, code) {
  if (err instanceof Pay03bError) return err;
  return new Pay03bError(code, 502);
}

export class Pay03bStripeSandboxProvider extends BillingProvider {
  constructor({ env = process.env, stripe = null } = {}) {
    super();
    this.config = requirePay03bSandbox(env);
    this.env = env;
    this.injected = stripe;
    this.client = stripe;
    this.verified = false;
  }

  get name() { return PAY03B_STRIPE_GATEWAY; }
  get gateway() { return PAY03B_STRIPE_GATEWAY; }
  get accountId() { return PAY01A_ACCOUNT; }
  get returnOrigin() { return this.config.origin; }

  async api() {
    if (!this.client) {
      const { default: Stripe } = await import('stripe');
      this.client = new Stripe(this.env.CARUP_PAY01A_STRIPE_SECRET_KEY);
    }
    return this.client;
  }

  /** A real account read, not a claim inferred from a sandbox-looking key. */
  async verifyAccount() {
    if (this.verified) return this.accountId;
    const api = await this.api();
    let account;
    try { account = await api.accounts.retrieve(); } catch { throw new Pay03bError('PAY03B_ACCOUNT_VERIFICATION_UNAVAILABLE', 503); }
    if (account?.id !== PAY01A_ACCOUNT) throw new Pay03bError('PAY03B_STRIPE_ACCOUNT_REFUSED', 503);
    this.verified = true;
    return this.accountId;
  }

  assertReturnUrl(url) {
    if (typeof url !== 'string' || !url.startsWith(this.config.origin + '/')) {
      throw new Pay03bError('PAY03B_RETURN_URL_REFUSED', 400);
    }
  }

  async ensureCustomer({ organizationId, tenantId, displayName, idempotencyKey }) {
    await this.verifyAccount();
    const api = await this.api();
    // Level 2 (Owner-authorized rehearsal only): the customer is created ON the authorized test clock so renewals
    // can be simulated by advancing that clock. Without it, no test clock is involved.
    const testClock = this.env.CARUP_PAY03B_STRIPE_TEST_CLOCK_ID || null;
    if (testClock && !/^clock_[A-Za-z0-9]+$/.test(testClock)) throw new Pay03bError('PAY03B_TEST_CLOCK_INVALID', 503);
    let customer;
    try {
      customer = await api.customers.create({
        name: String(displayName || '').slice(0, 120) || undefined,
        ...(testClock ? { test_clock: testClock } : {}),
        metadata: {
          carup_owner_organization_id: organizationId, carup_owner_tenant_id: tenantId,
          carup_environment: 'sandbox', carup_programme: 'PAY-03B',
        },
      }, { idempotencyKey });
    } catch (err) { throw providerFailure(err, 'PAY03B_CUSTOMER_PROVIDER_UNAVAILABLE'); }
    if (!customer?.id || !/^cus_/.test(customer.id) || customer.livemode !== false) {
      throw new Pay03bError('PAY03B_CUSTOMER_PROVIDER_MISMATCH', 502);
    }
    return { customerId: customer.id };
  }

  async createSubscriptionCheckout({ customerId, priceRef, subscriptionReference, metadata = {}, successUrl, cancelUrl, idempotencyKey }) {
    await this.verifyAccount();
    this.assertReturnUrl(successUrl);
    this.assertReturnUrl(cancelUrl);
    const api = await this.api();
    const carupMetadata = {
      ...metadata, carup_subscription_reference: subscriptionReference, carup_environment: 'sandbox', carup_programme: 'PAY-03B',
    };
    let session;
    try {
      session = await api.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: subscriptionReference,
        line_items: [{ price: priceRef, quantity: 1 }],
        metadata: carupMetadata,
        subscription_data: { metadata: carupMetadata },
        success_url: successUrl,
        cancel_url: cancelUrl,
      }, { idempotencyKey });
    } catch (err) { throw providerFailure(err, 'PAY03B_CHECKOUT_PROVIDER_UNAVAILABLE'); }
    if (!session?.id || !/^cs_test_/.test(session.id) || session.livemode !== false || session.mode !== 'subscription'
      || pay01aProviderId(session.customer) !== customerId || session.client_reference_id !== subscriptionReference || !session.url) {
      throw new Pay03bError('PAY03B_CHECKOUT_PROVIDER_MISMATCH', 502);
    }
    return { checkoutId: session.id, url: session.url };
  }

  async getCheckout(checkoutId) {
    await this.verifyAccount();
    const api = await this.api();
    try { return normalizeStripeCheckout(await api.checkout.sessions.retrieve(checkoutId)); }
    catch (err) { throw providerFailure(err, 'PAY03B_PROVIDER_RETRIEVAL_UNAVAILABLE'); }
  }

  /** Expire an open, unpaid Checkout session (no money moves). */
  async expireCheckout(checkoutId) {
    await this.verifyAccount();
    const api = await this.api();
    let session;
    try { session = await api.checkout.sessions.expire(checkoutId); }
    catch (err) { throw providerFailure(err, 'PAY03B_CHECKOUT_PROVIDER_UNAVAILABLE'); }
    if (session?.id !== checkoutId || session.livemode !== false || session.status !== 'expired') {
      throw new Pay03bError('PAY03B_CHECKOUT_PROVIDER_MISMATCH', 502);
    }
    return { checkoutId, status: 'expired' };
  }

  async getSubscription(subscriptionId) {
    await this.verifyAccount();
    const api = await this.api();
    try { return normalizeStripeSubscription(await api.subscriptions.retrieve(subscriptionId)); }
    catch (err) { throw providerFailure(err, 'PAY03B_PROVIDER_RETRIEVAL_UNAVAILABLE'); }
  }

  async getInvoice(invoiceId) {
    await this.verifyAccount();
    const api = await this.api();
    try { return normalizeStripeInvoice(await api.invoices.retrieve(invoiceId)); }
    catch (err) { throw providerFailure(err, 'PAY03B_PROVIDER_RETRIEVAL_UNAVAILABLE'); }
  }

  async listSubscriptionInvoices(subscriptionId) {
    await this.verifyAccount();
    const api = await this.api();
    let page;
    try { page = await api.invoices.list({ subscription: subscriptionId, limit: 24 }); }
    catch (err) { throw providerFailure(err, 'PAY03B_PROVIDER_RETRIEVAL_UNAVAILABLE'); }
    if (page?.has_more) throw new Pay03bError('PAY03B_INVOICE_EVIDENCE_INCOMPLETE', 502);
    return (page?.data || []).map(normalizeStripeInvoice);
  }

  async getPaymentTruth({ paymentIntentId, amountMinor, currency }) {
    await this.verifyAccount();
    const api = await this.api();
    let intent;
    let refunds;
    try {
      intent = await api.paymentIntents.retrieve(paymentIntentId);
      const listed = await api.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
      if (listed.has_more) throw new Pay03bError('PAY03B_REFUND_EVIDENCE_INCOMPLETE', 502);
      refunds = listed.data || [];
    } catch (err) { throw providerFailure(err, 'PAY03B_PROVIDER_RETRIEVAL_UNAVAILABLE'); }
    if (intent?.id !== paymentIntentId) throw new Pay03bError('PAY03B_PROVIDER_PAYMENT_REFERENCE_MISMATCH', 502);
    return paymentTruthFromProvider({ intent, refunds, amountMinor, currency });
  }

  async setCancelAtPeriodEnd({ subscriptionId, cancelAtPeriodEnd, idempotencyKey }) {
    await this.verifyAccount();
    const api = await this.api();
    try {
      return normalizeStripeSubscription(await api.subscriptions.update(subscriptionId,
        { cancel_at_period_end: Boolean(cancelAtPeriodEnd) }, { idempotencyKey }));
    } catch (err) { throw providerFailure(err, 'PAY03B_SUBSCRIPTION_PROVIDER_UNAVAILABLE'); }
  }

  async cancelSubscription({ subscriptionId, idempotencyKey }) {
    await this.verifyAccount();
    const api = await this.api();
    try {
      // No automatic proration credit or final invoice: refunds are a separate, governed admin action.
      return normalizeStripeSubscription(await api.subscriptions.cancel(subscriptionId,
        { prorate: false, invoice_now: false }, { idempotencyKey }));
    } catch (err) { throw providerFailure(err, 'PAY03B_SUBSCRIPTION_PROVIDER_UNAVAILABLE'); }
  }

  /**
   * period_end: the new price bills from the next renewal; nothing is charged now (proration none).
   * immediate: prorated invoice now, and the change applies ONLY if that invoice is paid (pending_if_incomplete).
   */
  async changePlan({ subscriptionId, itemId, priceRef, mode, idempotencyKey }) {
    if (!['period_end', 'immediate'].includes(mode)) throw new Pay03bError('PAY03B_PLAN_CHANGE_MODE_INVALID', 400);
    await this.verifyAccount();
    const api = await this.api();
    const params = {
      items: [{ id: itemId, price: priceRef }],
      proration_behavior: mode === 'immediate' ? 'always_invoice' : 'none',
      ...(mode === 'immediate' ? { payment_behavior: 'pending_if_incomplete' } : {}),
    };
    try { return normalizeStripeSubscription(await api.subscriptions.update(subscriptionId, params, { idempotencyKey })); }
    catch (err) { throw providerFailure(err, 'PAY03B_SUBSCRIPTION_PROVIDER_UNAVAILABLE'); }
  }

  async previewPlanChange({ customerId, subscriptionId, itemId, priceRef, mode }) {
    if (!['period_end', 'immediate'].includes(mode)) throw new Pay03bError('PAY03B_PLAN_CHANGE_MODE_INVALID', 400);
    await this.verifyAccount();
    const api = await this.api();
    let preview;
    try {
      preview = await api.invoices.createPreview({
        customer: customerId,
        subscription: subscriptionId,
        subscription_details: {
          items: [{ id: itemId, price: priceRef }],
          proration_behavior: mode === 'immediate' ? 'always_invoice' : 'none',
        },
      });
    } catch (err) { throw providerFailure(err, 'PAY03B_PREVIEW_PROVIDER_UNAVAILABLE'); }
    return {
      currency: String(preview.currency || '').toUpperCase(),
      amountDueMinor: Number(preview.amount_due),
      lines: (preview.lines?.data || []).map((l) => ({
        amountMinor: Number(l.amount), proration: lineIsProration(l), priceRef: linePrice(l),
        periodStart: toIso(l.period?.start), periodEnd: toIso(l.period?.end),
      })),
    };
  }

  async createPaymentMethodUpdateSession({ customerId, returnUrl, idempotencyKey }) {
    const configuration = this.env.CARUP_PAY03B_STRIPE_PORTAL_CONFIGURATION_ID;
    if (!configuration || !/^bpc_[A-Za-z0-9]+$/.test(configuration)) {
      throw new Pay03bError('PAY03B_PAYMENT_METHOD_UPDATE_NOT_CONFIGURED', 503);
    }
    this.assertReturnUrl(returnUrl);
    await this.verifyAccount();
    const api = await this.api();
    try {
      const session = await api.billingPortal.sessions.create({
        customer: customerId, configuration, return_url: returnUrl, flow_data: { type: 'payment_method_update' },
      }, { idempotencyKey });
      return { url: session.url };
    } catch (err) { throw providerFailure(err, 'PAY03B_PORTAL_PROVIDER_UNAVAILABLE'); }
  }

  async getInvoicePaymentLink(invoiceId) {
    const invoice = await this.getInvoice(invoiceId);
    if (invoice.status !== 'open' || !invoice.hostedInvoiceUrl) throw new Pay03bError('PAY03B_INVOICE_NOT_PAYABLE', 409);
    return { url: invoice.hostedInvoiceUrl };
  }

  async refundInvoicePayment({ paymentIntentId, amountMinor, idempotencyKey, metadata = {} }) {
    await this.verifyAccount();
    const api = await this.api();
    let refund;
    try {
      refund = await api.refunds.create({ payment_intent: paymentIntentId, amount: amountMinor,
        metadata: { ...metadata, carup_programme: 'PAY-03B', carup_environment: 'sandbox' } }, { idempotencyKey });
    } catch (err) { throw providerFailure(err, 'PAY03B_REFUND_PROVIDER_UNAVAILABLE'); }
    if (pay01aProviderId(refund?.payment_intent) !== paymentIntentId || Number(refund?.amount) !== Number(amountMinor)
      || refund?.livemode === true) {
      throw new Pay03bError('PAY03B_REFUND_PROVIDER_MISMATCH', 502);
    }
    return { refundId: refund.id, status: refund.status };
  }
}
