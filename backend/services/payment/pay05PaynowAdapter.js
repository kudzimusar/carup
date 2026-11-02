/**
 * CARUP-PAY-05-LR01 — the Paynow merchant-API adapter for ONE garage integration (one currency).
 *
 * It implements the PAY-04 provider-adapter interface where Paynow genuinely supports it and says so where it does
 * not (PAY05_PAYNOW_CAPABILITIES): there is no cancel endpoint, no expiry, and no merchant refund API.
 *
 *   createCheckout   hosted (initiatetransaction) or express (remotetransaction: EcoCash, OneMoney, InnBucks, O'mari);
 *                    server-owned amount/currency/reference; a fresh merchant trace per attempt; the reply's hash is
 *                    verified before any URL in it is used, and every URL must pass the provider allowlist (SSRF).
 *   getPaymentTruth  an empty POST to the stored poll URL; the reply must verify with THIS integration's key.
 *   trace            recovery after a lost reply (by merchant trace) — never a second payment request.
 *   submitOtp        O'mari: the customer's OTP to the allowlisted remote OTP URL.
 *   verifyStatusUpdate  a resulturl POST is accepted only if its hash verifies with this integration's key.
 *   cancelCheckout   { status: 'unsupported_by_provider' } — makes no call and claims nothing.
 *   refund           refused: refunds happen in the merchant's Paynow dashboard.
 *
 * Error details carry an `outcome`: 'refused' (Paynow said no — nothing exists) or 'unknown' (a transaction may exist:
 * trace before anything else). Integration keys never appear in errors, logs or return values.
 */
import { isPay04ProductionRuntime } from './pay04Contract.js';
import {
  Pay05Error, PAY05_CURRENCIES, PAY05_METHODS, PAY05_PHONE_METHODS, PAY05_PAYNOW_CAPABILITIES, PAY05_GATEWAY,
} from './pay05Contract.js';
import {
  PAYNOW_ENDPOINTS, PAYNOW_REAL_ALLOWLIST, encodeForm, parseForm, signPairs, verifyPairs, classifyPaynowStatus,
  formatPaynowAmount, parsePaynowAmountMinor, assertProviderUrl, pollIdFor, normalizeZimbabweMobile, isPaynowAuthEmail,
} from './pay05PaynowProtocol.js';

/** Initiation waits as long as Paynow's own plugins do; reads (poll, trace, OTP) stay short (independent review P8). */
export const PAYNOW_TIMEOUTS = Object.freeze({ initiateMs: 45_000, readMs: 15_000 });
/** A refusal before anything was sent: nothing can exist at Paynow (independent review S8). */
const notSent = (error) => new Pay05Error(error?.code || 'PAY05_REQUEST_INVALID', error?.status || 422, { outcome: 'not_sent' });
const providerText = (value) => String(value ?? '').replace(/[^\x20-\x7e]/g, '').slice(0, 160);

export class PaynowAdapter {
  constructor({ integration, merchantReference, endpoints, allow, transport }) {
    if (!integration?.integrationId || !integration?.key || !PAY05_CURRENCIES.includes(integration.currency)) {
      throw new Pay05Error('PAY05_INTEGRATION_UNAVAILABLE', 503);
    }
    Object.defineProperty(this, 'key', { value: integration.key, enumerable: false });
    this.integration = Object.freeze({ integrationId: String(integration.integrationId), currency: integration.currency,
      methods: Object.freeze([...(integration.methods ?? [])]), mode: integration.mode ?? null });
    this.merchantReference = merchantReference;
    this.endpoints = Object.freeze({ ...endpoints });
    this.allow = allow;
    this.transport = transport;
    this.gateway = PAY05_GATEWAY;
    this.capabilities = PAY05_PAYNOW_CAPABILITIES;
  }

  toJSON() { return { gateway: this.gateway, integration: this.integration, merchantReference: this.merchantReference }; }

  async post(url, pairs, { timeoutMs = PAYNOW_TIMEOUTS.readMs } = {}) {
    const target = assertProviderUrl(url, this.allow);
    let reply;
    try {
      reply = await this.transport(target, { body: encodeForm(pairs), method: 'POST', timeoutMs });
    } catch {
      throw new Pay05Error('PAY05_PROVIDER_UNREACHABLE', 504, { outcome: 'unknown' });
    }
    if (!reply || reply.status < 200 || reply.status >= 300) {
      throw new Pay05Error('PAY05_PROVIDER_HTTP_ERROR', 502, { outcome: 'unknown', http_status: reply?.status ?? null });
    }
    try {
      return parseForm(String(reply.text ?? ''));
    } catch {
      throw new Pay05Error('PAY05_PROVIDER_MESSAGE_MALFORMED', 502, { outcome: 'unknown' });
    }
  }

  /** A reply is either Paynow's unsigned Error (refused) or a message signed with this integration's key. */
  async exchange(url, pairs, refusedCode, options = {}) {
    const reply = await this.post(url, pairs, options);
    const map = new Map(reply);
    if (String(map.get('status') ?? '').toLowerCase() === 'error') {
      throw new Pay05Error(refusedCode, refusedCode === 'PAY05_OTP_REJECTED' ? 422 : 502,
        { outcome: 'refused', provider_error: providerText(map.get('error')) });
    }
    const verified = verifyPairs(reply, this.key);
    if (!verified.valid) throw new Pay05Error('PAY05_PROVIDER_RESPONSE_UNAUTHENTICATED', 502, { outcome: 'unknown' });
    return verified.fields;
  }

  truthFrom(fields, polledUrl = null) {
    const status = classifyPaynowStatus(fields.get('status'));
    const echoed = fields.get('pollurl') ? assertProviderUrl(fields.get('pollurl'), this.allow) : null;
    const pollUrl = polledUrl ?? echoed;
    return {
      providerStatus: status.code,
      rawStatus: providerText(fields.get('status')),
      snapshot: status.snapshot,
      moneyReceived: status.moneyReceived,
      amount: fields.get('amount') ?? null,
      amountMinor: parsePaynowAmountMinor(fields.get('amount')),
      currency: this.integration.currency,
      reference: fields.get('reference') ?? null,
      paynowReference: fields.get('paynowreference') ? providerText(fields.get('paynowreference')) : null,
      pollUrl,
      echoedPollUrl: echoed,
      paymentId: pollUrl ? pollIdFor(pollUrl) : null,
      merchantReference: this.merchantReference,
      integrationId: this.integration.integrationId,
    };
  }

  async createCheckout({ reference, amountMinor, currency, method = 'web', phone = null, authEmail = null, returnUrl, resultUrl,
    additionalInfo = '', merchantTrace }) {
    // every check that can refuse locally runs before anything is sent, and says so (outcome 'not_sent')
    let express; let normalizedPhone; let amount;
    try {
      if (currency !== this.integration.currency) throw new Pay05Error('PAY05_CURRENCY_MISMATCH', 422);
      if (!PAY05_METHODS.includes(method) || !this.integration.methods.includes(method)
          || (method === 'innbucks' && currency !== 'USD')) {
        throw new Pay05Error('PAY05_METHOD_NOT_AVAILABLE', 422);
      }
      if (!/^[A-Za-z0-9]{8,32}$/.test(String(merchantTrace ?? ''))) throw new Pay05Error('PAY05_MERCHANT_TRACE_INVALID', 422);
      if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(String(reference ?? ''))) throw new Pay05Error('PAY05_REFERENCE_INVALID', 422);
      for (const u of [returnUrl, resultUrl]) {
        if (!/^https?:\/\/[^\s]+$/.test(String(u ?? ''))) throw new Pay05Error('PAY05_RETURN_URL_INVALID', 503);
      }
      express = method !== 'web';
      normalizedPhone = PAY05_PHONE_METHODS.includes(method) ? normalizeZimbabweMobile(phone) : null;
      if (express && !isPaynowAuthEmail(authEmail)) throw new Pay05Error('PAY05_AUTH_EMAIL_REQUIRED', 422);
      amount = formatPaynowAmount(amountMinor, currency);
    } catch (error) {
      throw notSent(error);
    }

    const pairs = [['id', this.integration.integrationId], ['reference', reference], ['amount', amount]];
    if (additionalInfo) pairs.push(['additionalinfo', providerText(additionalInfo).slice(0, 120)]);
    pairs.push(['returnurl', returnUrl], ['resulturl', resultUrl]);
    if (express) pairs.push(['authemail', authEmail]);
    if (normalizedPhone) pairs.push(['phone', normalizedPhone]);
    if (express) pairs.push(['method', method]);
    pairs.push(['merchanttrace', merchantTrace], ['status', 'Message']);

    const fields = await this.exchange(express ? this.endpoints.remote : this.endpoints.initiate, signPairs(pairs, this.key),
      'PAY05_PROVIDER_REFUSED', { timeoutMs: PAYNOW_TIMEOUTS.initiateMs });
    if (String(fields.get('status') ?? '').toLowerCase() !== 'ok') {
      throw new Pay05Error('PAY05_PROVIDER_RESPONSE_UNEXPECTED', 502, { outcome: 'unknown' });
    }
    if (!fields.get('pollurl')) throw new Pay05Error('PAY05_PROVIDER_RESPONSE_UNEXPECTED', 502, { outcome: 'unknown' });
    // Paynow accepted the request: from here on a refusal means "a transaction may exist" — the caller traces.
    const providerUrl = (value) => {
      try { return assertProviderUrl(value, this.allow); } catch (error) {
        throw new Pay05Error(error.code, error.status, { outcome: 'unknown' });
      }
    };
    const pollUrl = providerUrl(fields.get('pollurl'));
    const browserUrl = express ? null : providerUrl(fields.get('browserurl'));
    const expressOut = express ? {
      method,
      instructions: fields.get('instructions') ? providerText(fields.get('instructions')) : null,
      authorizationCode: method === 'innbucks' && /^[A-Za-z0-9]{4,32}$/.test(fields.get('authorizationcode') ?? '')
        ? fields.get('authorizationcode') : null,
      authorizationExpires: method === 'innbucks' ? providerText(fields.get('authorizationexpires')) || null : null,
      otpReference: method === 'omari' ? providerText(fields.get('otpreference')) || null : null,
      remoteOtpUrl: method === 'omari' ? providerUrl(fields.get('remoteotpurl')) : null,
    } : null;
    return {
      checkoutId: `pn_trace_${merchantTrace}`,
      paymentId: pollIdFor(pollUrl),
      url: browserUrl,
      pollUrl,
      paynowReference: fields.get('paynowreference') ? providerText(fields.get('paynowreference')) : null,
      method,
      express: expressOut,
    };
  }

  async getPaymentTruth({ pollUrl }) {
    const url = assertProviderUrl(pollUrl, this.allow);
    const fields = await this.exchange(url, [], 'PAY05_PROVIDER_READ_FAILED');
    return this.truthFrom(fields, url);
  }

  async trace({ merchantTrace }) {
    if (!/^[A-Za-z0-9]{8,32}$/.test(String(merchantTrace ?? ''))) throw new Pay05Error('PAY05_MERCHANT_TRACE_INVALID', 422);
    const pairs = signPairs([['id', this.integration.integrationId], ['merchanttrace', merchantTrace], ['status', 'Message']], this.key);
    const fields = await this.exchange(this.endpoints.trace, pairs, 'PAY05_PROVIDER_TRACE_FAILED');
    if (String(fields.get('status') ?? '').toLowerCase() === 'notfound') return { found: false, authenticated: true };
    if (!fields.get('pollurl')) throw new Pay05Error('PAY05_PROVIDER_RESPONSE_UNEXPECTED', 502, { outcome: 'unknown' });
    return { found: true, authenticated: true, truth: this.truthFrom(fields) };
  }

  async submitOtp({ remoteOtpUrl, otp }) {
    const url = assertProviderUrl(remoteOtpUrl, this.allow);
    if (!/^\d{4,8}$/.test(String(otp ?? ''))) throw new Pay05Error('PAY05_OTP_INVALID', 422);
    const pairs = signPairs([['id', this.integration.integrationId], ['otp', String(otp)], ['status', 'Message']], this.key);
    const fields = await this.exchange(url, pairs, 'PAY05_OTP_REJECTED');
    return this.truthFrom(fields);
  }

  verifyStatusUpdate(rawBody) {
    const pairs = parseForm(String(rawBody ?? ''));
    const verified = verifyPairs(pairs, this.key);
    if (!verified.valid) throw new Pay05Error('PAY05_CALLBACK_SIGNATURE_INVALID', 401);
    return { pairs, fields: verified.fields, truth: this.truthFrom(verified.fields) };
  }

  async cancelCheckout() { return { status: 'unsupported_by_provider' }; }

  async refund() { throw new Pay05Error('PAY05_PROVIDER_REFUND_UNSUPPORTED', 409); }
}

/** fetch with a hard timeout, no redirects followed, and a reply-size cap enforced while reading (never buffered first). */
export function httpTransport({ timeoutMs = PAYNOW_TIMEOUTS.readMs, maxBytes = 65_536 } = {}) {
  return async (url, { body = '', method = 'POST', timeoutMs: callTimeoutMs } = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), callTimeoutMs ?? timeoutMs);
    try {
      const res = await fetch(url, {
        method, body, redirect: 'manual', signal: controller.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) { controller.abort(); throw new Error('reply too large'); }
      const chunks = [];
      let size = 0;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) { controller.abort(); throw new Error('reply too large'); }
          chunks.push(value);
        }
      }
      return { status: res.status, text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8') };
    } finally {
      clearTimeout(timer);
    }
  };
}

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;

/**
 * The adapter for one integration. 'simulator' credentials only ever reach the configured loopback simulator; real
 * Paynow ('paynow_test' / 'paynow_live') needs a provider authorization that Level 1 does not have.
 */
export function createPaynowAdapter({ integration, merchantReference, env = process.env, transport = null }) {
  if (integration?.mode === 'simulator') {
    if (isPay04ProductionRuntime(env)) throw new Pay05Error('PAY05_SIMULATOR_REFUSED', 503);
    const origin = String(env.CARUP_PAY05_PAYNOW_SIMULATOR_ORIGIN ?? '').replace(/\/$/, '');
    if (!LOOPBACK.test(origin)) throw new Pay05Error('PAY05_SIMULATOR_ORIGIN_INVALID', 503);
    return new PaynowAdapter({
      integration, merchantReference,
      endpoints: { initiate: `${origin}/interface/initiatetransaction`, remote: `${origin}/interface/remotetransaction`, trace: `${origin}/interface/trace` },
      allow: { origins: [origin] },
      transport: transport ?? httpTransport(),
    });
  }
  if (integration?.mode === 'paynow_test' || integration?.mode === 'paynow_live') {
    // Level 1: no Owner + provider authorization exists for any real Paynow call (issue #252, Checkpoint G).
    if (env.CARUP_PAY05_REAL_PROVIDER_AUTHORIZED !== 'true') throw new Pay05Error('PAY05_REAL_PROVIDER_NOT_AUTHORIZED', 503);
    return new PaynowAdapter({ integration, merchantReference, endpoints: PAYNOW_ENDPOINTS, allow: PAYNOW_REAL_ALLOWLIST,
      transport: transport ?? httpTransport() });
  }
  throw new Pay05Error('PAY05_MODE_INVALID', 503);
}
