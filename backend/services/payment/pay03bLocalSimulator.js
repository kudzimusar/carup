/**
 * CARUP-PAY-03B-LR01 — LOCAL PROVIDER SIMULATOR for disposable UAT only. NOT STRIPE.
 *
 * Purpose: Level-1 physical UAT (authenticated HTTP + real Chromium) of the full recurring lifecycle, without any
 * real provider operation. It returns exactly the CarUp-shaped objects the Stripe sandbox adapter returns, so the
 * same canonical service, webhook and database paths run. It can never be mistaken for Stripe:
 *   - gateway 'pay03b_local_provider_simulator', account 'acct_pay03b_local_simulator', ids 'sim_*';
 *   - the canonical database refuses that gateway unless a disposable database explicitly enables it
 *     (public.pay03b_runtime_guard), and refuses simulator ids on Stripe rows and vice versa;
 *   - events are signed with a separate 'simsec_' secret and delivered to a separate simulator webhook route;
 *   - every page it serves says SIMULATED PROVIDER — NOT STRIPE.
 * Billing periods are accelerated (CARUP_PAY03B_SIMULATOR_PERIOD_SECONDS) so renewal and expiry are observable,
 * the same idea as a provider test clock. State is persisted to a local JSON file outside the repository.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BillingProvider } from '../diaspora/billing/billingProviderBase.js';
import { classifyPay01aRefundEvidence } from './pay01aContract.js';
import { Pay03bError, isPay03bProductionRuntime } from './pay03bContract.js';

export const PAY03B_SIMULATOR_GATEWAY = 'pay03b_local_provider_simulator';
export const PAY03B_SIMULATOR_ACCOUNT = 'acct_pay03b_local_simulator';
const SIGNATURE_TOLERANCE_SECONDS = 300;

export function requirePay03bSimulator(env = process.env) {
  const node = String(env.NODE_ENV || '').toLowerCase();
  const app = String(env.CARUP_ENV || env.APP_ENV || '').toLowerCase();
  if (env.CARUP_PAY03B_ENABLED !== 'true' || env.CARUP_PAY03B_PROVIDER_MODE !== 'local_simulator'
    || isPay03bProductionRuntime(env) || node === 'production'
    || !['test', 'development'].includes(app || node)
    || !env.CARUP_PAY03B_SIMULATOR_STATE_FILE || !path.isAbsolute(env.CARUP_PAY03B_SIMULATOR_STATE_FILE)
    || !/^simsec_[A-Za-z0-9]{16,}$/.test(String(env.CARUP_PAY03B_SIMULATOR_WEBHOOK_SECRET || ''))) {
    throw new Pay03bError('PAY03B_SIMULATOR_REFUSED', 404);
  }
  const periodSeconds = Number(env.CARUP_PAY03B_SIMULATOR_PERIOD_SECONDS || 2592000);
  if (!Number.isInteger(periodSeconds) || periodSeconds < 60 || periodSeconds > 31_622_400) {
    throw new Pay03bError('PAY03B_SIMULATOR_REFUSED', 404);
  }
  return {
    stateFile: env.CARUP_PAY03B_SIMULATOR_STATE_FILE,
    secret: env.CARUP_PAY03B_SIMULATOR_WEBHOOK_SECRET,
    periodSeconds,
    publicOrigin: String(env.CARUP_PAY03B_SIMULATOR_PUBLIC_ORIGIN || `http://127.0.0.1:${env.PORT || 5031}`).replace(/\/$/, ''),
  };
}

function emptyState() {
  // Provider identifiers are globally unique (like a real provider's): a random namespace per simulator state.
  return { namespace: crypto.randomBytes(5).toString('hex'), seq: 0, customers: {}, customerKeys: {}, checkouts: {},
    checkoutKeys: {}, subscriptions: {}, invoices: {}, intents: {}, refunds: {}, refundKeys: {}, mutationKeys: {} };
}

export class Pay03bLocalSimulatorProvider extends BillingProvider {
  constructor({ env = process.env } = {}) {
    super();
    this.config = requirePay03bSimulator(env);
  }

  get name() { return PAY03B_SIMULATOR_GATEWAY; }
  get gateway() { return PAY03B_SIMULATOR_GATEWAY; }
  get accountId() { return PAY03B_SIMULATOR_ACCOUNT; }
  get isSimulator() { return true; }

  async verifyAccount() { return this.accountId; }

  load() {
    try { return JSON.parse(fs.readFileSync(this.config.stateFile, 'utf8')); }
    catch (err) { if (err.code === 'ENOENT') return emptyState(); throw new Pay03bError('PAY03B_SIMULATOR_STATE_UNREADABLE', 503); }
  }

  save(state) {
    const tmp = `${this.config.stateFile}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(this.config.stateFile), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.config.stateFile);
  }

  mutate(fn) {
    const state = this.load();
    const result = fn(state);
    this.save(state);
    return result;
  }

  id(state, prefix) {
    state.seq += 1;
    return `${prefix}_${state.namespace}_${String(state.seq).padStart(6, '0')}`;
  }

  event(state, type, object) {
    return { id: this.id(state, 'sim_evt'), object: 'event', type, created: Math.floor(Date.now() / 1000), livemode: false,
      account: this.accountId, data: { object } };
  }

  // ---------------------------------------------------------------- CarUp-shaped provider surface
  async ensureCustomer({ organizationId, tenantId, displayName, idempotencyKey }) {
    return this.mutate((state) => {
      if (state.customerKeys[idempotencyKey]) return { customerId: state.customerKeys[idempotencyKey] };
      const id = this.id(state, 'sim_cus');
      state.customers[id] = { id, organizationId, tenantId, displayName: String(displayName || '').slice(0, 120) };
      state.customerKeys[idempotencyKey] = id;
      return { customerId: id };
    });
  }

  async createSubscriptionCheckout({ customerId, priceRef, amountMinor, currency, subscriptionReference, metadata = {},
    successUrl, cancelUrl, idempotencyKey }) {
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !/^[A-Z]{3}$/.test(String(currency))) {
      throw new Pay03bError('PAY03B_SIMULATOR_PRICE_INVALID', 400);
    }
    return this.mutate((state) => {
      if (!state.customers[customerId]) throw new Pay03bError('PAY03B_CHECKOUT_PROVIDER_MISMATCH', 502);
      if (state.checkoutKeys[idempotencyKey]) {
        const existing = state.checkouts[state.checkoutKeys[idempotencyKey]];
        return { checkoutId: existing.id, url: `${this.config.publicOrigin}/api/pay03b/simulator/checkout/${existing.id}`,
          amountTotalMinor: existing.amountMinor, currency: existing.currency };
      }
      const id = this.id(state, 'sim_cs');
      state.checkouts[id] = { id, mode: 'subscription', status: 'open', customerId, priceRef, amountMinor, currency,
        clientReference: subscriptionReference, metadata: { ...metadata, carup_subscription_reference: subscriptionReference },
        successUrl, cancelUrl, subscriptionId: null, createdAt: new Date().toISOString() };
      state.checkoutKeys[idempotencyKey] = id;
      return { checkoutId: id, url: `${this.config.publicOrigin}/api/pay03b/simulator/checkout/${id}`, amountTotalMinor: amountMinor, currency };
    });
  }

  async getCheckout(checkoutId) {
    const c = this.load().checkouts[checkoutId];
    if (!c) throw new Pay03bError('PAY03B_PROVIDER_RETRIEVAL_UNAVAILABLE', 502);
    return { id: c.id, livemode: false, mode: 'subscription', status: c.status, paymentStatus: c.status === 'complete' ? 'paid' : 'unpaid',
      customerId: c.customerId, subscriptionId: c.subscriptionId, clientReference: c.clientReference, metadata: c.metadata,
      url: c.status === 'open' ? `${this.config.publicOrigin}/api/pay03b/simulator/checkout/${c.id}` : null,
      amountTotalMinor: c.amountMinor, currency: c.currency };
  }

  /** The checkout page record for the simulator page (no secrets; amounts and the return URLs only). */
  checkoutPageModel(checkoutId) {
    const c = this.load().checkouts[checkoutId];
    if (!c) throw new Pay03bError('PAY03B_SIMULATOR_CHECKOUT_NOT_FOUND', 404);
    return { id: c.id, status: c.status, amountMinor: c.amountMinor, currency: c.currency, priceRef: c.priceRef,
      successUrl: c.successUrl, cancelUrl: c.cancelUrl };
  }

  snapshot(sub) {
    return { id: sub.id, livemode: false, status: sub.status, customerId: sub.customerId, itemId: sub.itemId, priceRef: sub.priceRef,
      currentPeriodStart: sub.currentPeriodStart, currentPeriodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      canceledAt: sub.canceledAt, endedAt: sub.endedAt, trialEnd: null, latestInvoiceId: sub.latestInvoiceId,
      pendingUpdate: false, subscriptionReference: sub.subscriptionReference };
  }

  invoiceView(inv) {
    return { id: inv.id, livemode: false, status: inv.status, billingReason: inv.billingReason, customerId: inv.customerId,
      subscriptionId: inv.subscriptionId, currency: inv.currency, amountDueMinor: inv.amountDueMinor, amountPaidMinor: inv.amountPaidMinor,
      amountRemainingMinor: inv.amountDueMinor - inv.amountPaidMinor, paymentIntentId: inv.paymentIntentId, attemptCount: inv.attemptCount,
      nextPaymentAttempt: null, periodStart: inv.periodStart, periodEnd: inv.periodEnd, priceRef: inv.priceRef,
      hostedInvoiceUrl: inv.status === 'open' ? `${this.config.publicOrigin}/api/pay03b/simulator/invoice/${inv.id}` : null };
  }

  async expireCheckout(checkoutId) {
    const result = await this.completeCheckout(checkoutId, { outcome: 'expire' });
    return { checkoutId, status: 'expired', events: result.events };
  }

  async getSubscription(subscriptionId) {
    const sub = this.load().subscriptions[subscriptionId];
    if (!sub) throw new Pay03bError('PAY03B_PROVIDER_RETRIEVAL_UNAVAILABLE', 502);
    return this.snapshot(sub);
  }

  async getInvoice(invoiceId) {
    const inv = this.load().invoices[invoiceId];
    if (!inv) throw new Pay03bError('PAY03B_PROVIDER_RETRIEVAL_UNAVAILABLE', 502);
    return this.invoiceView(inv);
  }

  async listSubscriptionInvoices(subscriptionId) {
    return Object.values(this.load().invoices).filter((i) => i.subscriptionId === subscriptionId)
      .sort((a, b) => Date.parse(b.periodStart) - Date.parse(a.periodStart) || (b.id > a.id ? 1 : -1))
      .map((inv) => this.invoiceView(inv));
  }

  async getPaymentTruth({ paymentIntentId, amountMinor, currency }) {
    const state = this.load();
    const intent = state.intents[paymentIntentId];
    if (!intent) throw new Pay03bError('PAY03B_PROVIDER_RETRIEVAL_UNAVAILABLE', 502);
    if (intent.amountMinor !== Number(amountMinor) || intent.currency !== String(currency).toUpperCase()) {
      throw new Pay03bError('PAY03B_PROVIDER_PAYMENT_AMOUNT_MISMATCH', 409);
    }
    if (intent.status !== 'succeeded') {
      return { status: intent.status === 'canceled' ? 'cancelled' : 'pending', intentId: intent.id, refundedMinor: 0,
        pendingRefundMinor: 0, refundIds: [], mismatch: null, oldestSucceededRefundId: null };
    }
    const refunds = Object.values(state.refunds).filter((r) => r.payment_intent === paymentIntentId);
    const evidence = classifyPay01aRefundEvidence({ intentId: paymentIntentId, amountMinor: intent.amountMinor,
      currency: intent.currency.toLowerCase(), refunds: refunds.map((r) => ({ ...r, livemode: false })) });
    return { status: evidence.state, intentId: intent.id, refundedMinor: evidence.refundedMinor,
      pendingRefundMinor: evidence.pendingRefundMinor, refundIds: evidence.refundIds, mismatch: evidence.mismatch || null,
      oldestSucceededRefundId: refunds.filter((r) => r.status === 'succeeded').sort((a, b) => a.created - b.created)[0]?.id || null };
  }

  newInvoice(state, sub, { billingReason, periodStart, periodEnd, amountMinor, outcome }) {
    const invoiceId = this.id(state, 'sim_in');
    const intentId = this.id(state, 'sim_pi');
    const paid = outcome === 'success';
    state.intents[intentId] = { id: intentId, amountMinor, currency: sub.currency, status: paid ? 'succeeded' : 'requires_payment_method' };
    state.invoices[invoiceId] = { id: invoiceId, status: paid ? 'paid' : 'open', billingReason, customerId: sub.customerId,
      subscriptionId: sub.id, currency: sub.currency, amountDueMinor: amountMinor, amountPaidMinor: paid ? amountMinor : 0,
      paymentIntentId: intentId, attemptCount: 1, periodStart, periodEnd, priceRef: sub.priceRef };
    sub.latestInvoiceId = invoiceId;
    return state.invoices[invoiceId];
  }

  // ---------------------------------------------------------------- simulator controls (UAT pages / harness)
  async completeCheckout(checkoutId, { outcome = 'success' } = {}) {
    if (!['success', 'decline', 'expire'].includes(outcome)) throw new Pay03bError('PAY03B_SIMULATOR_OUTCOME_INVALID', 400);
    return this.mutate((state) => {
      const c = state.checkouts[checkoutId];
      if (!c) throw new Pay03bError('PAY03B_SIMULATOR_CHECKOUT_NOT_FOUND', 404);
      if (c.status !== 'open') throw new Pay03bError('PAY03B_SIMULATOR_CHECKOUT_CLOSED', 409);
      if (outcome === 'decline') return { events: [], subscriptionId: null, declined: true };
      if (outcome === 'expire') {
        c.status = 'expired';
        return { events: [this.event(state, 'checkout.session.expired', { id: c.id, object: 'checkout.session', mode: 'subscription',
          client_reference_id: c.clientReference })], subscriptionId: null };
      }
      const now = Date.now();
      const sub = { id: this.id(state, 'sim_sub'), status: 'active', customerId: c.customerId, itemId: null, priceRef: c.priceRef,
        amountMinor: c.amountMinor, currency: c.currency, currentPeriodStart: new Date(now).toISOString(),
        currentPeriodEnd: new Date(now + this.config.periodSeconds * 1000).toISOString(), cancelAtPeriodEnd: false,
        canceledAt: null, endedAt: null, latestInvoiceId: null, subscriptionReference: c.clientReference };
      sub.itemId = this.id(state, 'sim_si');
      state.subscriptions[sub.id] = sub;
      const invoice = this.newInvoice(state, sub, { billingReason: 'subscription_create', periodStart: sub.currentPeriodStart,
        periodEnd: sub.currentPeriodEnd, amountMinor: c.amountMinor, outcome: 'success' });
      c.status = 'complete';
      c.subscriptionId = sub.id;
      return {
        subscriptionId: sub.id,
        events: [
          this.event(state, 'checkout.session.completed', { id: c.id, object: 'checkout.session', mode: 'subscription',
            client_reference_id: c.clientReference, subscription: sub.id }),
          this.event(state, 'customer.subscription.created', { id: sub.id, object: 'subscription',
            metadata: { carup_subscription_reference: c.clientReference } }),
          this.event(state, 'invoice.paid', { id: invoice.id, object: 'invoice', subscription: sub.id }),
        ],
      };
    });
  }

  async advanceToNextPeriod(subscriptionId, { outcome = 'success' } = {}) {
    if (!['success', 'failure'].includes(outcome)) throw new Pay03bError('PAY03B_SIMULATOR_OUTCOME_INVALID', 400);
    return this.mutate((state) => {
      const sub = state.subscriptions[subscriptionId];
      if (!sub || !['active', 'past_due'].includes(sub.status)) throw new Pay03bError('PAY03B_SIMULATOR_SUBSCRIPTION_NOT_RENEWABLE', 409);
      if (sub.cancelAtPeriodEnd) {
        sub.status = 'canceled';
        sub.endedAt = sub.currentPeriodEnd;
        sub.canceledAt = sub.canceledAt || new Date().toISOString();
        return { events: [this.event(state, 'customer.subscription.deleted', { id: sub.id, object: 'subscription',
          metadata: { carup_subscription_reference: sub.subscriptionReference } })] };
      }
      const start = sub.currentPeriodEnd;
      const end = new Date(Date.parse(start) + this.config.periodSeconds * 1000).toISOString();
      sub.currentPeriodStart = start;
      sub.currentPeriodEnd = end;
      const invoice = this.newInvoice(state, sub, { billingReason: 'subscription_cycle', periodStart: start, periodEnd: end,
        amountMinor: sub.amountMinor, outcome });
      sub.status = outcome === 'success' ? 'active' : 'past_due';
      return { events: [
        this.event(state, outcome === 'success' ? 'invoice.paid' : 'invoice.payment_failed', { id: invoice.id, object: 'invoice', subscription: sub.id }),
        this.event(state, 'customer.subscription.updated', { id: sub.id, object: 'subscription',
          metadata: { carup_subscription_reference: sub.subscriptionReference } }),
      ] };
    });
  }

  async payOpenInvoice(invoiceId) {
    return this.mutate((state) => {
      const inv = state.invoices[invoiceId];
      if (!inv || inv.status !== 'open') throw new Pay03bError('PAY03B_INVOICE_NOT_PAYABLE', 409);
      inv.status = 'paid';
      inv.amountPaidMinor = inv.amountDueMinor;
      inv.attemptCount += 1;
      state.intents[inv.paymentIntentId].status = 'succeeded';
      const sub = state.subscriptions[inv.subscriptionId];
      if (sub.status === 'past_due') sub.status = 'active';
      return { events: [
        this.event(state, 'invoice.paid', { id: inv.id, object: 'invoice', subscription: sub.id }),
        this.event(state, 'customer.subscription.updated', { id: sub.id, object: 'subscription',
          metadata: { carup_subscription_reference: sub.subscriptionReference } }),
      ] };
    });
  }

  /** A refund created outside CarUp (the F5 scenario): no CarUp metadata, any amount. */
  async createExternalRefund({ paymentIntentId, amountMinor }) {
    return this.mutate((state) => {
      const intent = state.intents[paymentIntentId];
      if (!intent || intent.status !== 'succeeded') throw new Pay03bError('PAY03B_SIMULATOR_INTENT_NOT_REFUNDABLE', 409);
      const id = this.id(state, 'sim_re');
      state.refunds[id] = { id, payment_intent: paymentIntentId, amount: amountMinor, currency: intent.currency.toLowerCase(),
        status: 'succeeded', created: state.seq, metadata: {} };
      return { refundId: id, events: [this.event(state, 'charge.refunded', { id: this.id(state, 'sim_ch'), object: 'charge',
        payment_intent: paymentIntentId, metadata: {} })] };
    });
  }

  async setCancelAtPeriodEnd({ subscriptionId, cancelAtPeriodEnd }) {
    return this.mutate((state) => {
      const sub = state.subscriptions[subscriptionId];
      if (!sub || sub.status === 'canceled') throw new Pay03bError('PAY03B_SUBSCRIPTION_PROVIDER_UNAVAILABLE', 502);
      sub.cancelAtPeriodEnd = Boolean(cancelAtPeriodEnd);
      return this.snapshot(sub);
    });
  }

  async cancelSubscription({ subscriptionId }) {
    return this.mutate((state) => {
      const sub = state.subscriptions[subscriptionId];
      if (!sub) throw new Pay03bError('PAY03B_SUBSCRIPTION_PROVIDER_UNAVAILABLE', 502);
      if (sub.status !== 'canceled') {
        sub.status = 'canceled';
        sub.canceledAt = new Date().toISOString();
        sub.endedAt = sub.canceledAt;
      }
      return this.snapshot(sub);
    });
  }

  async changePlan({ subscriptionId, priceRef, amountMinor, mode }) {
    if (!['period_end', 'immediate'].includes(mode)) throw new Pay03bError('PAY03B_PLAN_CHANGE_MODE_INVALID', 400);
    return this.mutate((state) => {
      const sub = state.subscriptions[subscriptionId];
      if (!sub || sub.status === 'canceled') throw new Pay03bError('PAY03B_SUBSCRIPTION_PROVIDER_UNAVAILABLE', 502);
      if (mode === 'immediate') {
        const difference = Number(amountMinor) - sub.amountMinor;
        if (difference > 0) {
          this.newInvoice(state, { ...sub, priceRef }, { billingReason: 'subscription_update', periodStart: new Date().toISOString(),
            periodEnd: sub.currentPeriodEnd, amountMinor: difference, outcome: 'success' });
        }
      }
      sub.priceRef = priceRef;
      sub.amountMinor = Number(amountMinor);
      return this.snapshot(sub);
    });
  }

  async previewPlanChange({ subscriptionId, priceRef, amountMinor, mode }) {
    const sub = this.load().subscriptions[subscriptionId];
    if (!sub) throw new Pay03bError('PAY03B_PREVIEW_PROVIDER_UNAVAILABLE', 502);
    const now = mode === 'immediate' ? Math.max(Number(amountMinor) - sub.amountMinor, 0) : 0;
    return { currency: sub.currency, amountDueMinor: now, lines: [{ amountMinor: Number(amountMinor), proration: false, priceRef,
      periodStart: sub.currentPeriodEnd, periodEnd: null }] };
  }

  async createPaymentMethodUpdateSession({ customerId }) {
    if (!this.load().customers[customerId]) throw new Pay03bError('PAY03B_PORTAL_PROVIDER_UNAVAILABLE', 502);
    return { url: `${this.config.publicOrigin}/api/pay03b/simulator/payment-method/${customerId}` };
  }

  async getInvoicePaymentLink(invoiceId) {
    const inv = await this.getInvoice(invoiceId);
    if (inv.status !== 'open') throw new Pay03bError('PAY03B_INVOICE_NOT_PAYABLE', 409);
    return { url: inv.hostedInvoiceUrl };
  }

  async refundInvoicePayment({ paymentIntentId, amountMinor, idempotencyKey }) {
    return this.mutate((state) => {
      if (state.refundKeys[idempotencyKey]) return { refundId: state.refundKeys[idempotencyKey], status: 'succeeded', events: [] };
      const intent = state.intents[paymentIntentId];
      if (!intent || intent.status !== 'succeeded') throw new Pay03bError('PAY03B_REFUND_PROVIDER_MISMATCH', 502);
      const id = this.id(state, 'sim_re');
      state.refunds[id] = { id, payment_intent: paymentIntentId, amount: Number(amountMinor), currency: intent.currency.toLowerCase(),
        status: 'succeeded', created: state.seq, metadata: { carup_programme: 'PAY-03B' } };
      state.refundKeys[idempotencyKey] = id;
      return { refundId: id, status: 'succeeded', events: [this.event(state, 'charge.refunded', { id: this.id(state, 'sim_ch'),
        object: 'charge', payment_intent: paymentIntentId, metadata: {} })] };
    });
  }

  // ---------------------------------------------------------------- simulator event signing (separate secret)
  signEvent(event) {
    const rawBody = Buffer.from(JSON.stringify(event));
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac('sha256', this.config.secret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
    return { rawBody, signature: `t=${t},v1=${v1}` };
  }

  verifyWebhook({ rawBody, signature }) {
    if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string') throw new Pay03bError('PAY03B_SIMULATOR_SIGNATURE_INVALID', 400);
    const parts = Object.fromEntries(signature.split(',').map((kv) => kv.split('=')));
    const t = Number(parts.t);
    const expected = crypto.createHmac('sha256', this.config.secret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
    const given = Buffer.from(String(parts.v1 || ''), 'utf8');
    if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > SIGNATURE_TOLERANCE_SECONDS
      || given.length !== expected.length || !crypto.timingSafeEqual(given, Buffer.from(expected, 'utf8'))) {
      throw new Pay03bError('PAY03B_SIMULATOR_SIGNATURE_INVALID', 400);
    }
    const event = JSON.parse(rawBody.toString('utf8'));
    if (event.livemode !== false || event.account !== this.accountId || !/^sim_evt_[A-Za-z0-9_]+$/.test(String(event.id))) {
      throw new Pay03bError('PAY03B_SIMULATOR_EVENT_REFUSED', 400);
    }
    return event;
  }
}
