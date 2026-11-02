/**
 * CARUP-PAY-04-LR01 — LOCAL GARAGE PAYMENT-PROVIDER SIMULATOR, for disposable environments only. NOT A REAL PROVIDER.
 *
 * It stands in for a garage's own merchant account at a payment provider so the whole provider-confirmed path —
 * checkout, signed webhook, fresh readback, idempotency, allocation, receipt, refund, partial-refund hold and
 * discrepancy handling — runs through the SAME canonical service, routes and database functions a real provider
 * adapter would use, with no real money and no real provider operation. It can never be mistaken for one:
 *   - gateway 'pay04_garage_provider_simulator'; ids gsim_co_ / sim_pi_gar_ / sim_re_gar_ / evt_gsim_;
 *   - the canonical database refuses that gateway unless a disposable database enables it (pay04_runtime_guard), and
 *     refuses simulator ids on any other gateway;
 *   - events are signed with a separate 'gsimsec_' secret and delivered to a separate simulator webhook route;
 *   - it refuses to start in production, and every page it serves says SIMULATED PROVIDER.
 * State is a local JSON file outside the repository.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { classifyPay01aRefundEvidence } from './pay01aContract.js';
import { Pay04Error, PAY04_SIMULATOR_GATEWAY, isPay04ProductionRuntime } from './pay04Contract.js';

const SIGNATURE_TOLERANCE_SECONDS = 300;

export function requirePay04Simulator(env = process.env) {
  const node = String(env.NODE_ENV || '').toLowerCase();
  const app = String(env.CARUP_ENV || env.APP_ENV || '').toLowerCase();
  if (env.CARUP_PAY04_ENABLED !== 'true' || env.CARUP_PAY04_PROVIDER_MODE !== 'local_simulator'
    || isPay04ProductionRuntime(env) || !['test', 'development'].includes(app || node)
    || !env.CARUP_PAY04_SIMULATOR_STATE_FILE || !path.isAbsolute(env.CARUP_PAY04_SIMULATOR_STATE_FILE)
    || !/^gsimsec_[A-Za-z0-9]{16,}$/.test(String(env.CARUP_PAY04_SIMULATOR_WEBHOOK_SECRET || ''))) {
    throw new Pay04Error('PAY04_SIMULATOR_REFUSED', 404);
  }
  return {
    stateFile: env.CARUP_PAY04_SIMULATOR_STATE_FILE,
    secret: env.CARUP_PAY04_SIMULATOR_WEBHOOK_SECRET,
    publicOrigin: String(env.CARUP_PAY04_SIMULATOR_PUBLIC_ORIGIN || `http://127.0.0.1:${env.PORT || 5031}`).replace(/\/$/, ''),
  };
}

function emptyState() {
  return { namespace: crypto.randomBytes(5).toString('hex'), seq: 0, checkouts: {}, checkoutKeys: {}, payments: {},
    refunds: {}, refundKeys: {}, faults: {} };
}

export class Pay04GarageSimulatorProvider {
  constructor({ env = process.env } = {}) {
    this.config = requirePay04Simulator(env);
  }

  get gateway() { return PAY04_SIMULATOR_GATEWAY; }
  get isSimulator() { return true; }

  load() {
    try { return JSON.parse(fs.readFileSync(this.config.stateFile, 'utf8')); }
    catch (err) { if (err.code === 'ENOENT') return emptyState(); throw new Pay04Error('PAY04_SIMULATOR_STATE_UNREADABLE', 503); }
  }

  save(state) {
    const tmp = `${this.config.stateFile}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
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

  event(state, type, payment) {
    return {
      id: this.id(state, 'evt_gsim'), object: 'event', type, created: Math.floor(Date.now() / 1000), livemode: false,
      gateway: PAY04_SIMULATOR_GATEWAY, merchant_reference: payment.merchantReference,
      data: { payment: { id: payment.id, checkout_id: payment.checkoutId, amount_minor: payment.amountMinor, currency: payment.currency,
        status: payment.status, metadata: { carup_collection_id: payment.collectionId } } },
    };
  }

  checkoutUrl(id) { return `${this.config.publicOrigin}/api/pay04/simulator/checkout/${id}`; }

  // ---------------------------------------------------------------- provider surface (the adapter interface)

  /** One checkout per CarUp collection: a retried request returns the same checkout and payment ids. */
  async createCheckout({ collectionId, merchantReference, amountMinor, currency, successUrl, cancelUrl }) {
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !/^[A-Z]{3}$/.test(String(currency))
      || !/^gsim_merchant_[A-Za-z0-9_]{4,64}$/.test(String(merchantReference)) || !collectionId) {
      throw new Pay04Error('PAY04_SIMULATOR_CHECKOUT_INVALID', 422);
    }
    return this.mutate((state) => {
      const existing = state.checkoutKeys[collectionId];
      if (existing) {
        const c = state.checkouts[existing];
        if (c.amountMinor !== amountMinor || c.currency !== currency || c.merchantReference !== merchantReference) {
          throw new Pay04Error('PAY04_SIMULATOR_CHECKOUT_CONFLICT', 409);
        }
        return { checkoutId: c.id, paymentId: c.paymentId, url: this.checkoutUrl(c.id) };
      }
      const checkoutId = this.id(state, 'gsim_co');
      const paymentId = this.id(state, 'sim_pi_gar');
      state.checkouts[checkoutId] = { id: checkoutId, collectionId, merchantReference, amountMinor, currency, status: 'open',
        paymentId, successUrl, cancelUrl, attempts: 0, createdAt: new Date().toISOString() };
      state.payments[paymentId] = { id: paymentId, checkoutId, collectionId, merchantReference, amountMinor, currency,
        status: 'requires_payment' };
      state.checkoutKeys[collectionId] = checkoutId;
      return { checkoutId, paymentId, url: this.checkoutUrl(checkoutId) };
    });
  }

  /** The simulated hosted page's model (no secrets; the amount, the merchant and the return URLs only). */
  checkoutPageModel(checkoutId) {
    const c = this.load().checkouts[checkoutId];
    if (!c) throw new Pay04Error('PAY04_SIMULATOR_CHECKOUT_NOT_FOUND', 404);
    return { id: c.id, status: c.status, amountMinor: c.amountMinor, currency: c.currency, merchantReference: c.merchantReference,
      successUrl: c.successUrl, cancelUrl: c.cancelUrl };
  }

  /** The customer acts on the simulated hosted page: pay, have the card declined, or abandon. */
  async completeCheckout(checkoutId, { outcome = 'success' } = {}) {
    return this.mutate((state) => {
      const c = state.checkouts[checkoutId];
      if (!c) throw new Pay04Error('PAY04_SIMULATOR_CHECKOUT_NOT_FOUND', 404);
      if (c.status !== 'open') return { events: [], status: c.status };
      const payment = state.payments[c.paymentId];
      if (outcome === 'decline') {
        c.attempts += 1;
        return { events: [], status: 'open', declined: true };
      }
      if (outcome === 'expire') {
        c.status = 'expired';
        payment.status = 'canceled';
        return { events: [this.event(state, 'payment.canceled', payment)], status: 'expired' };
      }
      c.status = 'complete';
      payment.status = 'succeeded';
      payment.succeededAt = new Date().toISOString();
      return { events: [this.event(state, 'payment.succeeded', payment)], status: 'complete' };
    });
  }

  /** CarUp (on behalf of the payer or the garage) stops an unpaid checkout. A paid one is never touched. */
  async cancelCheckout(checkoutId) {
    const page = this.checkoutPageModel(checkoutId);
    if (page.status !== 'open') return { checkoutId, status: page.status, events: [] };
    const result = await this.completeCheckout(checkoutId, { outcome: 'expire' });
    return { checkoutId, status: 'expired', events: result.events };
  }

  /** The garage's full refund through CarUp. Idempotent per key; never more than the payment. */
  async refund({ paymentId, amountMinor, idempotencyKey }) {
    return this.mutate((state) => {
      const payment = state.payments[paymentId];
      if (!payment || payment.status !== 'succeeded') throw new Pay04Error('PAY04_SIMULATOR_REFUND_REFUSED', 409);
      if (state.refundKeys[idempotencyKey]) {
        const r = state.refunds[state.refundKeys[idempotencyKey]];
        return { refundId: r.id, status: r.status, events: [] };
      }
      const already = Object.values(state.refunds).filter((r) => r.payment_intent === paymentId && r.status !== 'failed')
        .reduce((sum, r) => sum + r.amount, 0);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || already + amountMinor > payment.amountMinor) {
        throw new Pay04Error('PAY04_SIMULATOR_REFUND_REFUSED', 409);
      }
      const id = this.id(state, 'sim_re_gar');
      state.refunds[id] = { id, object: 'refund', payment_intent: paymentId, amount: amountMinor, currency: payment.currency.toLowerCase(),
        status: 'succeeded', created: state.seq, livemode: false };
      state.refundKeys[idempotencyKey] = id;
      return { refundId: id, status: 'succeeded', events: [this.event(state, 'payment.refunded', payment)] };
    });
  }

  /**
   * UAT only (administrator route): the garage refunds PART of a payment directly at the provider, outside CarUp —
   * the evidence that must put the payment on an F5 reconciliation hold. `pending` leaves the refund pending.
   */
  async createExternalRefund({ paymentId, amountMinor, pending = false }) {
    return this.mutate((state) => {
      const payment = state.payments[paymentId];
      if (!payment || payment.status !== 'succeeded' || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        throw new Pay04Error('PAY04_SIMULATOR_REFUND_REFUSED', 409);
      }
      const id = this.id(state, 'sim_re_gar');
      state.refunds[id] = { id, object: 'refund', payment_intent: paymentId, amount: amountMinor, currency: payment.currency.toLowerCase(),
        status: pending ? 'pending' : 'succeeded', created: state.seq, livemode: false };
      return { refundId: id, events: [this.event(state, 'payment.refund_updated', payment)] };
    });
  }

  /**
   * UAT only (administrator route): make the provider REPORT something untrue about a payment — another amount,
   * currency or merchant — so the discrepancy path can be exercised end to end, or make its read API UNAVAILABLE for
   * that payment (an outage while the money is taken). Cleared with `{}`.
   */
  async misreport({ paymentId, amountMinor = null, currency = null, merchantReference = null, unavailable = false }) {
    return this.mutate((state) => {
      const payment = state.payments[paymentId];
      if (!payment) throw new Pay04Error('PAY04_SIMULATOR_PAYMENT_NOT_FOUND', 404);
      const fault = {};
      if (amountMinor !== null) fault.amountMinor = Number(amountMinor);
      if (currency !== null) fault.currency = String(currency).toUpperCase();
      if (merchantReference !== null) fault.merchantReference = String(merchantReference);
      if (unavailable === true) fault.unavailable = true;
      if (Object.keys(fault).length) state.faults[paymentId] = fault; else delete state.faults[paymentId];
      return { paymentId, fault: state.faults[paymentId] || null, events: [this.event(state, 'payment.updated', payment)] };
    });
  }

  /**
   * Fresh provider truth for one payment: what the provider says it holds, refunds classified with the same pure
   * PAY-01A/F5 classifier every other CarUp provider path uses. Amount, currency and merchant are REPORTED (the
   * database decides whether they match), never assumed.
   */
  async getPaymentTruth({ paymentId }) {
    const state = this.load();
    const payment = state.payments[paymentId];
    if (!payment) throw new Pay04Error('PAY04_PROVIDER_RETRIEVAL_UNAVAILABLE', 502);
    const fault = state.faults[paymentId] || {};
    if (fault.unavailable) throw new Pay04Error('PAY04_PROVIDER_RETRIEVAL_UNAVAILABLE', 502);
    const reported = {
      amountMinor: fault.amountMinor ?? payment.amountMinor,
      currency: fault.currency ?? payment.currency,
      merchantReference: fault.merchantReference ?? payment.merchantReference,
    };
    if (payment.status !== 'succeeded') {
      return { paymentId, status: payment.status === 'canceled' ? 'cancelled' : 'pending', refundedMinor: null, pendingRefundMinor: null,
        refundIds: null, mismatch: null, refundId: null, ...reported };
    }
    const refunds = Object.values(state.refunds).filter((r) => r.payment_intent === paymentId);
    const evidence = classifyPay01aRefundEvidence({ intentId: paymentId, amountMinor: payment.amountMinor,
      currency: payment.currency.toLowerCase(), refunds });
    const succeeded = refunds.filter((r) => r.status === 'succeeded').sort((a, b) => a.created - b.created);
    return {
      paymentId, status: evidence.state,
      refundedMinor: evidence.state === 'reconciliation_hold' || evidence.state === 'refunded' ? evidence.refundedMinor : null,
      pendingRefundMinor: evidence.state === 'reconciliation_hold' ? evidence.pendingRefundMinor : null,
      refundIds: evidence.state === 'reconciliation_hold' ? evidence.refundIds : null,
      mismatch: evidence.mismatch || null,
      refundId: evidence.state === 'refunded' || evidence.state === 'refund_pending' ? (succeeded[0]?.id || refunds[0]?.id || null) : null,
      ...reported,
    };
  }

  // ---------------------------------------------------------------- simulator event signing (separate secret)
  signEvent(event) {
    const rawBody = Buffer.from(JSON.stringify(event));
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac('sha256', this.config.secret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
    return { rawBody, signature: `t=${t},v1=${v1}` };
  }

  verifyWebhook({ rawBody, signature }) {
    if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string') throw new Pay04Error('PAY04_SIMULATOR_SIGNATURE_INVALID', 400);
    const parts = Object.fromEntries(signature.split(',').map((kv) => kv.split('=')));
    const t = Number(parts.t);
    const expected = crypto.createHmac('sha256', this.config.secret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
    const given = Buffer.from(String(parts.v1 || ''), 'utf8');
    if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > SIGNATURE_TOLERANCE_SECONDS
      || given.length !== expected.length || !crypto.timingSafeEqual(given, Buffer.from(expected, 'utf8'))) {
      throw new Pay04Error('PAY04_SIMULATOR_SIGNATURE_INVALID', 400);
    }
    let event;
    try { event = JSON.parse(rawBody.toString('utf8')); } catch { throw new Pay04Error('PAY04_SIMULATOR_EVENT_REFUSED', 400); }
    if (event.livemode !== false || event.gateway !== PAY04_SIMULATOR_GATEWAY || !/^evt_gsim_[A-Za-z0-9_]+$/.test(String(event.id))
      || !/^sim_pi_gar_[A-Za-z0-9_]+$/.test(String(event.data?.payment?.id || ''))) {
      throw new Pay04Error('PAY04_SIMULATOR_EVENT_REFUSED', 400);
    }
    return event;
  }
}
