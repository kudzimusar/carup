/**
 * Provider WIRE PROFILES (ADR-001 §5) — the only module in the codebase that knows provider vocabulary.
 *
 * A profile owns four things and nothing else:
 *   1. how a request is shaped   (path, method, content type, body encoding);
 *   2. how a response is parsed  (JSON vs form-encoded vs whatever the provider chose);
 *   3. how a webhook is verified (which header, which algorithm, over which bytes);
 *   4. how a provider event name maps into CarUp's normalized event vocabulary.
 *
 * Everything above this line — the adapter, the ledger, reconciliation, routes, entitlements — deals
 * only in CarUp-shaped objects. Adding a provider means adding a profile. If it ever requires touching
 * anything else, the abstraction has failed and that is a defect, not a cost of doing business.
 *
 * TWO profiles ship, deliberately chosen to be as dissimilar as possible:
 *
 *   `stripe`  — JSON responses, form-encoded request bodies, `t=…,v1=…` HMAC-SHA256 over
 *               `timestamp.rawBody`, stable `evt_…` event ids, a monotonic-ish `created` timestamp.
 *   `paynow`  — form-encoded BOTH ways, SHA-512 hash over concatenated field values plus an integration
 *               key, and **no event ids and no ordering signal at all**.
 *
 * The second one is the important one. A ledger written against a provider that always supplies an
 * event id and an ordering key looks correct right up until it meets a provider that supplies neither.
 * Paynow forces the synthesised-idempotency-key path (`deriveEventId`) to be real code with real tests
 * rather than a comment promising it would work.
 *
 * NOTHING here performs I/O. Profiles build request descriptions and parse strings; the transport moves
 * bytes. That is what makes the wire contract assertable offline.
 */
import crypto from 'crypto';
import { BILLING_PROVIDERS, BILLING_TEST_PROFILES } from '../../../constants/diaspora/diasporaBillingConstants.js';
import { SUBSCRIPTION_STATES } from '../../../constants/diaspora/diasporaEntitlements.js';

/**
 * CarUp's normalized billing event vocabulary. Providers map INTO this; nothing downstream ever sees a
 * provider's own event name.
 */
export const NORMALIZED_EVENTS = Object.freeze({
  SUBSCRIPTION_ACTIVATED: 'subscription.activated',
  SUBSCRIPTION_UPDATED: 'subscription.updated',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
  SUBSCRIPTION_PAST_DUE: 'subscription.past_due',
  TRIAL_STARTED: 'subscription.trial_started',
  PAYMENT_SUCCEEDED: 'payment.succeeded',
  PAYMENT_FAILED: 'payment.failed',
  CHECKOUT_COMPLETED: 'checkout.completed',
  CHECKOUT_EXPIRED: 'checkout.expired',
  REFUND_ISSUED: 'refund.issued',
  DISPUTE_OPENED: 'dispute.opened',
  UNKNOWN: 'unknown',
});

/** Events that must not be applied to the subscription row without an explicit tenant in the payload. */
export const TENANT_REQUIRED_EVENTS = Object.freeze([
  NORMALIZED_EVENTS.SUBSCRIPTION_ACTIVATED,
  NORMALIZED_EVENTS.SUBSCRIPTION_UPDATED,
  NORMALIZED_EVENTS.SUBSCRIPTION_CANCELLED,
  NORMALIZED_EVENTS.SUBSCRIPTION_PAST_DUE,
  NORMALIZED_EVENTS.TRIAL_STARTED,
]);

function formEncode(obj = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    params.append(k, String(v));
  }
  return params.toString();
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function formDecode(text) {
  const out = {};
  for (const [k, v] of new URLSearchParams(String(text || ''))) out[k] = v;
  return out;
}

/** Constant-time compare that tolerates different lengths without throwing. */
function timingSafeEqualHex(a, b) {
  const A = Buffer.from(String(a || ''), 'utf8');
  const B = Buffer.from(String(b || ''), 'utf8');
  if (A.length !== B.length || A.length === 0) return false;
  return crypto.timingSafeEqual(A, B);
}

function isoOrNull(value) {
  if (value == null) return null;
  const d = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile 1 — Stripe-shaped wire contract.
// ─────────────────────────────────────────────────────────────────────────────

// Provider status vocabulary -> CarUp subscription state. Anything unrecognised maps to INCOMPLETE,
// which is NOT access-granting: an unknown provider status must never accidentally grant a plan.
const STRIPE_STATUS_MAP = Object.freeze({
  trialing: SUBSCRIPTION_STATES.TRIALING,
  active: SUBSCRIPTION_STATES.ACTIVE,
  past_due: SUBSCRIPTION_STATES.PAST_DUE,
  paused: SUBSCRIPTION_STATES.PAUSED,
  canceled: SUBSCRIPTION_STATES.CANCELLED,
  cancelled: SUBSCRIPTION_STATES.CANCELLED,
  unpaid: SUBSCRIPTION_STATES.SUSPENDED,
  incomplete: SUBSCRIPTION_STATES.INCOMPLETE,
  incomplete_expired: SUBSCRIPTION_STATES.EXPIRED,
});

const STRIPE_EVENT_MAP = Object.freeze({
  'customer.subscription.created': NORMALIZED_EVENTS.SUBSCRIPTION_ACTIVATED,
  'customer.subscription.updated': NORMALIZED_EVENTS.SUBSCRIPTION_UPDATED,
  'customer.subscription.deleted': NORMALIZED_EVENTS.SUBSCRIPTION_CANCELLED,
  'customer.subscription.trial_will_end': NORMALIZED_EVENTS.TRIAL_STARTED,
  'invoice.payment_succeeded': NORMALIZED_EVENTS.PAYMENT_SUCCEEDED,
  'invoice.payment_failed': NORMALIZED_EVENTS.PAYMENT_FAILED,
  'checkout.session.completed': NORMALIZED_EVENTS.CHECKOUT_COMPLETED,
  'checkout.session.expired': NORMALIZED_EVENTS.CHECKOUT_EXPIRED,
  'charge.refunded': NORMALIZED_EVENTS.REFUND_ISSUED,
  'charge.dispute.created': NORMALIZED_EVENTS.DISPUTE_OPENED,
});

export const stripeProfile = Object.freeze({
  key: BILLING_TEST_PROFILES.STRIPE,
  providerName: BILLING_PROVIDERS.STRIPE,
  /** Provider supplies stable event ids — no synthesis needed. */
  suppliesEventIds: true,
  /** Provider supplies an ordering signal (a creation timestamp). */
  suppliesOrdering: true,

  authHeaders(apiKey) {
    return {
      // Bearer auth + form bodies is the actual Stripe contract; getting this wrong is exactly the
      // class of bug test mode exists to catch before a merchant account exists.
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': '', // filled per-request by the adapter
    };
  },

  buildCheckoutSession({ tenantId, planKey, priceRef, successUrl, cancelUrl, idempotencyKey }) {
    return {
      method: 'POST',
      path: '/v1/checkout/sessions',
      body: formEncode({
        mode: 'subscription',
        'line_items[0][price]': priceRef || `price_${planKey}`,
        'line_items[0][quantity]': 1,
        success_url: successUrl || 'https://carup.example/billing/success',
        cancel_url: cancelUrl || 'https://carup.example/billing/cancel',
        client_reference_id: tenantId,
        'metadata[tenantId]': tenantId,
        'metadata[planKey]': planKey,
      }),
      idempotencyKey,
    };
  },

  parseCheckoutSession(text) {
    const json = safeJsonParse(text) || {};
    return {
      sessionId: json.id || null,
      url: json.url || null,
      expiresAt: isoOrNull(json.expires_at),
      status: json.status || null,
    };
  },

  buildPortalSession({ customerRef, returnUrl, idempotencyKey }) {
    return {
      method: 'POST',
      path: '/v1/billing_portal/sessions',
      body: formEncode({
        customer: customerRef,
        return_url: returnUrl || 'https://carup.example/billing',
      }),
      idempotencyKey,
    };
  },

  parsePortalSession(text) {
    const json = safeJsonParse(text) || {};
    return { sessionId: json.id || null, url: json.url || null };
  },

  buildGetSubscription({ subscriptionRef }) {
    return { method: 'GET', path: `/v1/subscriptions/${encodeURIComponent(subscriptionRef)}`, body: null };
  },

  buildCancelSubscription({ subscriptionRef, atPeriodEnd, idempotencyKey }) {
    return atPeriodEnd
      ? {
        method: 'POST',
        path: `/v1/subscriptions/${encodeURIComponent(subscriptionRef)}`,
        body: formEncode({ cancel_at_period_end: 'true' }),
        idempotencyKey,
      }
      : {
        method: 'DELETE',
        path: `/v1/subscriptions/${encodeURIComponent(subscriptionRef)}`,
        body: null,
        idempotencyKey,
      };
  },

  buildChangePlan({ subscriptionRef, itemRef, priceRef, planKey, idempotencyKey }) {
    return {
      method: 'POST',
      path: `/v1/subscriptions/${encodeURIComponent(subscriptionRef)}`,
      body: formEncode({
        'items[0][id]': itemRef || 'si_current',
        'items[0][price]': priceRef || `price_${planKey}`,
        proration_behavior: 'create_prorations',
        'metadata[planKey]': planKey,
      }),
      idempotencyKey,
    };
  },

  buildGetInvoice({ subscriptionRef }) {
    return {
      method: 'GET',
      path: '/v1/invoices',
      query: { subscription: subscriptionRef, limit: '1' },
      body: null,
    };
  },

  parseInvoice(text) {
    const json = safeJsonParse(text) || {};
    const inv = Array.isArray(json.data) ? json.data[0] : json;
    if (!inv) return { status: null, amountDue: 0, currency: null, invoiceRef: null };
    return {
      invoiceRef: inv.id || null,
      status: inv.status || null,
      // Provider amounts are in minor units. Normalizing here keeps "cents vs dollars" from leaking.
      amountDue: Number(inv.amount_due || 0) / 100,
      currency: (inv.currency || null) && String(inv.currency).toUpperCase(),
      hostedInvoiceUrl: inv.hosted_invoice_url || null,
    };
  },

  /** Provider subscription object -> CarUp snapshot. The ONLY place provider field names are read. */
  parseSubscription(text) {
    const s = safeJsonParse(text) || {};
    const meta = s.metadata || {};
    return {
      providerSubscriptionRef: s.id || null,
      providerCustomerRef: s.customer || null,
      status: STRIPE_STATUS_MAP[String(s.status || '').toLowerCase()] || SUBSCRIPTION_STATES.INCOMPLETE,
      planKey: meta.planKey || meta.plan_key || null,
      tenantId: meta.tenantId || meta.tenant_id || null,
      currentPeriodStart: isoOrNull(s.current_period_start),
      currentPeriodEnd: isoOrNull(s.current_period_end),
      cancelAtPeriodEnd: Boolean(s.cancel_at_period_end),
      trialEnd: isoOrNull(s.trial_end),
    };
  },

  /**
   * Signature over `${timestamp}.${rawBody}`, read from the `stripe-signature`-style header. The RAW
   * body is mandatory: re-serializing the parsed JSON produces different bytes and would either fail
   * every time or, worse, tempt someone into "fixing" it by canonicalizing — which is how signature
   * verification quietly stops verifying anything.
   */
  verifySignature({ rawBody, headers = {}, signature = null, secret, toleranceSeconds = 300, now = null }) {
    const header = signature || headers['x-billing-signature'] || headers['stripe-signature'] || '';
    const parts = String(header).split(',').reduce((acc, kv) => {
      const [k, v] = kv.split('=');
      if (k && v) acc[k.trim()] = v.trim();
      return acc;
    }, {});
    const timestamp = parts.t;
    const provided = parts.v1;
    if (!timestamp || !provided) return { verified: false, reason: 'MALFORMED_SIGNATURE' };

    const clock = now == null ? Date.now() : Number(now);
    const drift = Math.abs(clock - Number(timestamp) * 1000);
    if (!Number.isFinite(drift) || drift > toleranceSeconds * 1000) {
      return { verified: false, reason: 'TIMESTAMP_OUT_OF_TOLERANCE' };
    }

    const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    if (!timingSafeEqualHex(provided, expected)) return { verified: false, reason: 'SIGNATURE_MISMATCH' };
    return { verified: true, reason: null };
  },

  /** Build a signature header for a body — used by tests and by the recording transport's fixtures. */
  signPayload({ rawBody, secret, timestampSeconds }) {
    const t = timestampSeconds ?? Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
    return `t=${t},v1=${v1}`;
  },

  parseWebhookBody(rawBody) {
    return safeJsonParse(rawBody) || {};
  },

  normalizeEvent(payload = {}) {
    const object = payload?.data?.object || {};
    const meta = object.metadata || {};
    return {
      eventId: payload.id || null,
      eventType: STRIPE_EVENT_MAP[payload.type] || NORMALIZED_EVENTS.UNKNOWN,
      providerEventType: payload.type || null,
      occurredAt: isoOrNull(payload.created),
      // Stripe has no strict per-object sequence number; `created` is the ordering signal.
      providerSequence: null,
      tenantId: meta.tenantId || meta.tenant_id || object.client_reference_id || null,
      planKey: meta.planKey || meta.plan_key || null,
      status: STRIPE_STATUS_MAP[String(object.status || '').toLowerCase()] || null,
      currentPeriodStart: isoOrNull(object.current_period_start),
      currentPeriodEnd: isoOrNull(object.current_period_end),
      cancelAtPeriodEnd: object.cancel_at_period_end === undefined ? null : Boolean(object.cancel_at_period_end),
      providerSubscriptionRef: object.subscription || (String(object.object || '') === 'subscription' ? object.id : null),
      providerCustomerRef: object.customer || null,
      sessionRef: String(object.object || '') === 'checkout.session' ? object.id : null,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Profile 2 — Paynow-shaped wire contract (Zimbabwe local rail, ADR-001 §3E).
//
// Form-encoded both ways, SHA-512 hash over concatenated values + integration key, NO event ids, NO
// ordering signal, and a callback that is explicitly documented as a hint rather than a guarantee.
// ─────────────────────────────────────────────────────────────────────────────

const PAYNOW_STATUS_MAP = Object.freeze({
  paid: SUBSCRIPTION_STATES.ACTIVE,
  awaiting: SUBSCRIPTION_STATES.INCOMPLETE,
  'awaiting delivery': SUBSCRIPTION_STATES.ACTIVE,
  delivered: SUBSCRIPTION_STATES.ACTIVE,
  created: SUBSCRIPTION_STATES.INCOMPLETE,
  sent: SUBSCRIPTION_STATES.INCOMPLETE,
  cancelled: SUBSCRIPTION_STATES.CANCELLED,
  refunded: SUBSCRIPTION_STATES.CANCELLED,
  failed: SUBSCRIPTION_STATES.PAST_DUE,
  disputed: SUBSCRIPTION_STATES.SUSPENDED,
});

const PAYNOW_EVENT_MAP = Object.freeze({
  paid: NORMALIZED_EVENTS.PAYMENT_SUCCEEDED,
  'awaiting delivery': NORMALIZED_EVENTS.PAYMENT_SUCCEEDED,
  delivered: NORMALIZED_EVENTS.PAYMENT_SUCCEEDED,
  cancelled: NORMALIZED_EVENTS.SUBSCRIPTION_CANCELLED,
  failed: NORMALIZED_EVENTS.PAYMENT_FAILED,
  refunded: NORMALIZED_EVENTS.REFUND_ISSUED,
  disputed: NORMALIZED_EVENTS.DISPUTE_OPENED,
});

// The provider hashes the concatenation of these fields, in this order, followed by the integration
// key. Field ORDER is part of the contract — a wrong order verifies nothing and fails silently open if
// anyone ever "simplifies" this to a sorted object walk.
const PAYNOW_HASH_FIELDS = Object.freeze([
  'reference', 'paynowreference', 'amount', 'status', 'pollurl',
]);

export const paynowProfile = Object.freeze({
  key: BILLING_TEST_PROFILES.PAYNOW,
  providerName: BILLING_PROVIDERS.PAYNOW,
  /** No event ids at all — the ledger must synthesise one. This is the case that breaks naive code. */
  suppliesEventIds: false,
  /** No sequence and no event timestamp — ordering must come from a poll, not from the callback. */
  suppliesOrdering: false,

  authHeaders() {
    // Credentials travel in the BODY for this provider, not a header. Encoding that difference here is
    // the whole point of the profile boundary.
    return { 'content-type': 'application/x-www-form-urlencoded' };
  },

  buildCheckoutSession({ tenantId, planKey, priceRef, successUrl, cancelUrl, idempotencyKey, apiKey, integrationId }) {
    const fields = {
      id: integrationId || 'test-integration',
      reference: idempotencyKey,
      amount: priceRef || '0.00',
      additionalinfo: `CarUp ${planKey}`,
      returnurl: successUrl || 'https://carup.example/billing/success',
      resulturl: cancelUrl || 'https://carup.example/api/diaspora/subscription/webhook',
      authemail: '',
      status: 'Message',
    };
    return {
      method: 'POST',
      path: '/interface/initiatetransaction',
      body: formEncode({ ...fields, hash: paynowHash(fields, Object.keys(fields), apiKey) }),
      idempotencyKey,
      // Carried for reconciliation: this provider's "session" is a reference we chose, not one it minted.
      localReference: idempotencyKey,
      tenantId,
    };
  },

  parseCheckoutSession(text) {
    const form = formDecode(text);
    return {
      sessionId: form.pollurl || null, // the poll URL IS the durable handle on this rail
      url: form.browserurl || null,
      expiresAt: null,
      status: form.status || null,
    };
  },

  buildPortalSession() {
    // No hosted portal exists on this rail. Returning a description the adapter can refuse honestly is
    // better than inventing a URL that would 404 for a customer.
    return { unsupported: 'PORTAL_NOT_SUPPORTED' };
  },

  parsePortalSession() {
    return { sessionId: null, url: null };
  },

  buildGetSubscription({ subscriptionRef }) {
    // "Poll the status URL for truth" is the provider's own documented pattern (ADR-001 §3E).
    return { method: 'POST', path: '/interface/pollurl', body: formEncode({ pollurl: subscriptionRef }) };
  },

  buildCancelSubscription({ subscriptionRef }) {
    // No subscription object exists to cancel; cancellation is simply not scheduling the next charge.
    return { unsupported: 'CANCEL_IS_LOCAL', subscriptionRef };
  },

  buildChangePlan() {
    return { unsupported: 'PLAN_CHANGE_IS_LOCAL' };
  },

  buildGetInvoice({ subscriptionRef }) {
    return { method: 'POST', path: '/interface/pollurl', body: formEncode({ pollurl: subscriptionRef }) };
  },

  parseInvoice(text) {
    const form = formDecode(text);
    return {
      invoiceRef: form.paynowreference || null,
      status: String(form.status || '').toLowerCase() === 'paid' ? 'paid' : 'open',
      amountDue: Number(form.amount || 0),
      currency: 'USD',
      hostedInvoiceUrl: null,
    };
  },

  parseSubscription(text) {
    const form = formDecode(text);
    return {
      providerSubscriptionRef: form.pollurl || null,
      providerCustomerRef: form.reference || null,
      status: PAYNOW_STATUS_MAP[String(form.status || '').toLowerCase()] || SUBSCRIPTION_STATES.INCOMPLETE,
      planKey: null,       // this rail carries no plan; the CarUp row is authoritative (ADR-001 §4.2)
      tenantId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEnd: null,
    };
  },

  verifySignature({ rawBody, headers = {}, signature = null, secret }) {
    const form = formDecode(rawBody);
    const provided = signature || form.hash || headers['x-billing-signature'] || '';
    if (!provided) return { verified: false, reason: 'MALFORMED_SIGNATURE' };
    const expected = paynowHash(form, PAYNOW_HASH_FIELDS, secret);
    if (!timingSafeEqualHex(String(provided).toUpperCase(), expected)) {
      return { verified: false, reason: 'SIGNATURE_MISMATCH' };
    }
    // No timestamp exists in this contract, so there is NO drift check available. The anti-replay
    // guarantee therefore rests entirely on the durable ledger's unique claim — which is precisely why
    // that claim is in Postgres and not in process memory.
    return { verified: true, reason: null };
  },

  signPayload({ rawBody, secret }) {
    return paynowHash(formDecode(rawBody), PAYNOW_HASH_FIELDS, secret);
  },

  parseWebhookBody(rawBody) {
    return formDecode(rawBody);
  },

  normalizeEvent(payload = {}) {
    const status = String(payload.status || '').toLowerCase();
    return {
      // No event id on the wire. deriveEventId() synthesises a stable one from the payload so the
      // unique (provider, event_id) claim still de-duplicates retries.
      eventId: null,
      eventType: PAYNOW_EVENT_MAP[status] || NORMALIZED_EVENTS.UNKNOWN,
      providerEventType: status || null,
      occurredAt: null,
      providerSequence: null,
      tenantId: payload.tenantid || payload.tenantId || null,
      planKey: payload.plankey || payload.planKey || null,
      status: PAYNOW_STATUS_MAP[status] || null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: null,
      providerSubscriptionRef: payload.pollurl || null,
      providerCustomerRef: payload.reference || null,
      sessionRef: payload.reference || null,
    };
  },
});

/** SHA-512 over the concatenation of the listed fields in order, followed by the integration key. */
function paynowHash(fields = {}, order = PAYNOW_HASH_FIELDS, key = '') {
  const concat = order.map((f) => {
    const v = fields[f] ?? fields[String(f).toLowerCase()] ?? '';
    return String(v);
  }).join('');
  return crypto.createHash('sha512').update(`${concat}${key}`).digest('hex').toUpperCase();
}

const PROFILES = Object.freeze({
  [BILLING_TEST_PROFILES.STRIPE]: stripeProfile,
  [BILLING_TEST_PROFILES.PAYNOW]: paynowProfile,
});

export function getBillingProfile(key) {
  const profile = PROFILES[String(key || '').toLowerCase()];
  if (!profile) {
    // Fail loud. Silently defaulting would mean signing with one scheme and verifying with another.
    throw new Error(`Unknown billing provider profile: ${key}`);
  }
  return profile;
}

export function listBillingProfiles() {
  return Object.keys(PROFILES);
}

/**
 * A stable event id for providers that do not supply one.
 *
 * The id must be identical for a retry of the same event and different for a genuinely new one, using
 * only fields the provider actually sends. A hash of the normalized identity fields satisfies both: a
 * retry hashes identically (so the unique claim de-duplicates it), and a state change hashes
 * differently (so it is processed). A random id would break de-duplication entirely; a
 * reference-only id would collapse every state change of one payment into a single event.
 */
export function deriveEventId(profile, payload = {}, normalized = {}) {
  if (normalized.eventId) return String(normalized.eventId);
  const identity = [
    profile.providerName,
    normalized.providerCustomerRef || '',
    normalized.providerSubscriptionRef || '',
    normalized.providerEventType || '',
    payload.amount ?? '',
    payload.paynowreference ?? '',
  ].join('|');
  return `derived_${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}
