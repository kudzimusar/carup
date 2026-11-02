/**
 * CARUP-PAY-05-LR01 — LOCAL Paynow protocol simulator (Level 1 only; refuses any production runtime).
 *
 * It speaks Paynow's documented merchant protocol so that CarUp's REAL adapter code (pay05PaynowAdapter.js) can be
 * certified end to end without a provider: form-encoded messages, the SHA-512 integration-key hash on every request and
 * every signed reply, initiatetransaction / remotetransaction / trace / poll / O'mari remote OTP, status updates POSTed
 * to the merchant's resulturl and resent on HTTP errors (up to ten times), the test-mode mobile numbers, a hosted
 * payment page, and Paynow's status vocabulary. Where Paynow's real behaviour is undocumented (expiry, duplicate
 * references, refunds) the simulator does NOT invent it: those operations exist only as explicit test controls
 * (`setStatus`, `inject…`), never as an API a merchant could call.
 *
 * Simulated integrations are issued by the simulator itself (mode 'simulator'); they never match a real Paynow ID.
 */
import crypto from 'node:crypto';
import { isPay04ProductionRuntime } from './pay04Contract.js';
import { Pay05Error, PAY05_CURRENCIES, PAY05_METHODS } from './pay05Contract.js';
import { encodeForm, parseForm, signPairs, verifyPairs, parsePaynowAmountMinor } from './pay05PaynowProtocol.js';

const PHONE_METHODS = new Set(['ecocash', 'onemoney', 'omari']);
const TEST_NUMBERS = Object.freeze({
  '0771111111': { after: 5_000, status: 'Paid' },
  '0772222222': { after: 30_000, status: 'Paid' },
  '0773333333': { after: 30_000, status: 'Failed' },
});
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const errorReply = (message) => ({ status: 200, body: encodeForm([['status', 'Error'], ['error', message]]) });
const html = (body) => ({ status: 200, body, contentType: 'text/html; charset=utf-8' });
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class PaynowProtocolSimulator {
  /**
   * @param origin   the simulator's own origin, e.g. http://127.0.0.1:5061 (all returned URLs use it)
   * @param deliver  async (url, body) => httpStatus — posts a status update to a merchant resulturl
   * @param now      clock (ms)
   */
  constructor({ origin, deliver = null, now = () => Date.now(), env = process.env, rejectDuplicateMerchantTrace = true } = {}) {
    if (isPay04ProductionRuntime(env)) throw new Pay05Error('PAY05_SIMULATOR_REFUSED', 503);
    const url = new URL(String(origin));
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Pay05Error('PAY05_SIMULATOR_REFUSED', 503);
    this.origin = url.origin;
    this.deliver = deliver;
    this.now = now;
    this.rejectDuplicateMerchantTrace = rejectDuplicateMerchantTrace;
    this.integrations = new Map();
    this.transactions = new Map();
    this.byTrace = new Map();
    this.scheduled = [];
    this.faults = { initiate: [], poll: [], trace: [] };
    this.deliveries = [];
    this.otpOutbox = [];
    this.nextPaynowReference = 1000 + crypto.randomInt(9000);
  }

  // ── simulated merchant onboarding (what Paynow would issue the garage) ──────────────────────────────────────

  issueIntegration({ currency, methods, escrow = false, name = 'Simulated garage integration' }) {
    if (!PAY05_CURRENCIES.includes(currency)) throw new Pay05Error('PAY05_CURRENCY_NOT_SUPPORTED', 422);
    const enabled = [...new Set(methods)].filter((m) => PAY05_METHODS.includes(m));
    if (!enabled.length) throw new Pay05Error('PAY05_METHODS_INVALID', 422);
    let integrationId;
    do integrationId = String(20000 + crypto.randomInt(70000)); while (this.integrations.has(integrationId));
    const key = crypto.randomUUID();
    this.integrations.set(integrationId, { integrationId, key, currency, methods: enabled, escrow, name });
    return { integrationId, key, currency, methods: enabled, escrow };
  }

  // ── the protocol ────────────────────────────────────────────────────────────────────────────────────────────

  async handle({ method = 'POST', path, body = '' }) {
    const url = new URL(path, this.origin);
    const route = url.pathname.toLowerCase();
    if (method === 'POST' && route === '/interface/initiatetransaction') return this.initiate(body, { express: false });
    if (method === 'POST' && route === '/interface/remotetransaction') return this.initiate(body, { express: true });
    if (method === 'POST' && route === '/interface/trace') return this.trace(body);
    if (method === 'POST' && route === '/interface/checkpayment/') return this.poll(url.searchParams.get('guid'));
    if (method === 'POST' && route === '/interface/remoteotp/') return this.remoteOtp(url.searchParams.get('guid'), body);
    const hosted = /^\/payment\/confirmpayment\/([0-9a-f-]{36})$/.exec(route);
    if (hosted && method === 'GET') return this.hostedPage(hosted[1]);
    if (hosted && method === 'POST') return this.hostedAction(hosted[1], body);
    return { status: 404, body: 'Not found' };
  }

  authenticate(body, required) {
    let pairs;
    try { pairs = parseForm(body); } catch { return { error: 'Invalid request' }; }
    const fields = new Map(pairs);
    const integration = this.integrations.get(String(fields.get('id') ?? ''));
    if (!integration) return { error: 'Invalid Id.' };
    if (!verifyPairs(pairs, integration.key).valid) return { error: 'Invalid Hash' };
    if (fields.get('status') !== 'Message') return { error: 'Invalid status' };
    for (const field of required) if (!fields.get(field)) return { error: `Missing ${field}` };
    return { integration, fields };
  }

  initiate(body, { express }) {
    const auth = this.authenticate(body, express ? ['reference', 'amount', 'resulturl', 'returnurl', 'method', 'authemail']
      : ['reference', 'amount', 'resulturl', 'returnurl']);
    if (auth.error) return errorReply(auth.error);
    const { integration, fields } = auth;
    const amountMinor = parsePaynowAmountMinor(fields.get('amount'));
    if (!amountMinor || amountMinor <= 0) return errorReply('Invalid amount field');
    const method = express ? fields.get('method') : 'web';
    if (express && (!PAY05_METHODS.includes(method) || method === 'web')) return errorReply('Invalid method');
    if (!integration.methods.includes(method)) return errorReply('Payment method not enabled for this integration');
    if (method === 'innbucks' && integration.currency !== 'USD') return errorReply('InnBucks is a USD only payment option');
    const phone = fields.get('phone') || null;
    if (express && PHONE_METHODS.has(method) && !/^07\d{8}$/.test(phone || '')) return errorReply('Invalid phone number');
    if (phone === '0774444444') return errorReply('Insufficient balance');
    const trace = fields.get('merchanttrace') || null;
    if (trace && (trace.length > 32 || !/^[A-Za-z0-9_-]+$/.test(trace))) return errorReply('Invalid merchanttrace');
    const traceKey = trace ? `${integration.integrationId}:${trace}` : null;
    if (traceKey && this.byTrace.has(traceKey) && this.rejectDuplicateMerchantTrace) return errorReply('Duplicate merchanttrace');

    const guid = crypto.randomUUID();
    const tx = {
      guid, integrationId: integration.integrationId, reference: fields.get('reference'), amount: fields.get('amount'),
      amountMinor, method, phone, merchantTrace: trace, resultUrl: fields.get('resulturl'), returnUrl: fields.get('returnurl'),
      authEmail: fields.get('authemail') || null, status: express ? 'Sent' : 'Created',
      paynowReference: String(this.nextPaynowReference++), createdAt: this.now(), otp: null, otpAttempts: 0,
      history: [],
    };
    tx.history.push({ at: tx.createdAt, status: tx.status, via: 'initiation' });
    this.transactions.set(guid, tx);
    if (traceKey) this.byTrace.set(traceKey, guid);

    const fault = this.faults.initiate.shift() ?? null;
    if (fault?.kind === 'drop_response') throw new Error('simulated network failure after the transaction was created');
    if (fault?.kind === 'error') return errorReply(fault.message ?? 'Simulated provider error');

    const pollUrl = fault?.kind === 'foreign_pollurl' ? `https://attacker.example/Interface/CheckPayment/?guid=${guid}` : this.pollUrl(guid);
    const reply = [['status', 'Ok']];
    if (!express) reply.push(['browserurl', `${this.origin}/Payment/ConfirmPayment/${guid}`]);
    else reply.push(['instructions', this.instructionsFor(method, integration)]);
    reply.push(['pollurl', pollUrl], ['paynowreference', tx.paynowReference]);
    if (method === 'innbucks') {
      tx.authorizationCode = String(100000000 + crypto.randomInt(900000000));
      const expires = new Date(this.now() + 30 * 60_000);
      reply.push(['authorizationcode', tx.authorizationCode],
        ['authorizationexpires', `${expires.getUTCDate()}-${MONTHS[expires.getUTCMonth()]}-${expires.getUTCFullYear()} ${String(expires.getUTCHours()).padStart(2, '0')}:${String(expires.getUTCMinutes()).padStart(2, '0')}`]);
    }
    if (method === 'omari') {
      tx.otp = String(100000 + crypto.randomInt(900000));
      tx.otpReference = `OTP${tx.paynowReference}`;
      this.otpOutbox.push({ phone, otp: tx.otp, otpReference: tx.otpReference, guid });
      reply.push(['otpreference', tx.otpReference], ['remoteotpurl', `${this.origin}/Interface/RemoteOTP/?guid=${guid}`]);
    }
    if (express && TEST_NUMBERS[phone]) this.schedule(guid, TEST_NUMBERS[phone].after, TEST_NUMBERS[phone].status);
    if (fault?.kind === 'unsigned_ok') return { status: 200, body: encodeForm(reply) };
    const signingKey = fault?.kind === 'wrong_hash' ? crypto.randomUUID() : integration.key;
    return { status: 200, body: encodeForm(signPairs(reply, signingKey)) };
  }

  instructionsFor(method, integration) {
    if (method === 'ecocash') return 'Dial *151*2*4# and enter your EcoCash PIN to approve the payment request sent to your phone.';
    if (method === 'onemoney') return 'Approve the OneMoney payment request sent to your phone with your OneMoney PIN.';
    if (method === 'innbucks') return `Pay with the InnBucks app using the authorization code, ${integration.currency} only.`;
    if (method === 'omari') return 'Enter the one-time password O\'mari sent to your phone by SMS.';
    return 'Complete the payment on Paynow.';
  }

  pollUrl(guid) { return `${this.origin}/Interface/CheckPayment/?guid=${guid}`; }

  statusMessage(tx) {
    const integration = this.integrations.get(tx.integrationId);
    return encodeForm(signPairs([['reference', tx.reference], ['paynowreference', tx.paynowReference], ['amount', tx.amount],
      ['status', tx.status], ['pollurl', this.pollUrl(tx.guid)]], integration.key));
  }

  poll(guid) {
    const fault = this.faults.poll.shift() ?? null;
    if (fault?.kind === 'drop_response') throw new Error('simulated poll network failure');
    if (fault?.kind === 'error') return errorReply('Simulated poll error');
    const tx = this.transactions.get(String(guid ?? ''));
    if (!tx) return errorReply('Invalid transaction');
    if (fault?.kind === 'unsigned') return { status: 200, body: encodeForm([['reference', tx.reference], ['amount', tx.amount], ['status', 'Paid']]) };
    return { status: 200, body: this.statusMessage(tx) };
  }

  trace(body) {
    const auth = this.authenticate(body, ['merchanttrace']);
    if (auth.error) return errorReply(auth.error);
    const fault = this.faults.trace.shift() ?? null;
    if (fault?.kind === 'error') return errorReply('Trace failed');
    const guid = this.byTrace.get(`${auth.integration.integrationId}:${auth.fields.get('merchanttrace')}`);
    if (!guid) return { status: 200, body: encodeForm(signPairs([['status', 'NotFound']], auth.integration.key)) };
    return { status: 200, body: this.statusMessage(this.transactions.get(guid)) };
  }

  remoteOtp(guid, body) {
    const tx = this.transactions.get(String(guid ?? ''));
    const auth = this.authenticate(body, ['otp']);
    if (auth.error) return errorReply(auth.error);
    if (!tx || tx.method !== 'omari' || auth.integration.integrationId !== tx.integrationId) return errorReply('Invalid transaction');
    if (tx.status !== 'Sent') return errorReply('Transaction is not awaiting an OTP');
    if (auth.fields.get('otp') !== tx.otp) {
      tx.otpAttempts += 1;
      if (tx.otpAttempts >= 5) this.transition(tx, 'Cancelled', 'otp_attempts_exhausted');
      return errorReply('Invalid OTP');
    }
    this.transition(tx, this.integrations.get(tx.integrationId).escrow ? 'Awaiting Delivery' : 'Paid', 'otp');
    return { status: 200, body: this.statusMessage(tx) };
  }

  hostedPage(guid) {
    const tx = this.transactions.get(guid);
    if (!tx) return { status: 404, body: 'Unknown payment' };
    const integration = this.integrations.get(tx.integrationId);
    return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simulated Paynow — ${escapeHtml(tx.reference)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;color:#111}
.banner{background:#7c2d12;color:#fff;padding:.75rem 1rem;border-radius:.5rem;font-weight:600}
button{font-size:1rem;min-height:44px;padding:.5rem 1rem;margin:.25rem .5rem .25rem 0;border-radius:.5rem;border:2px solid #111;background:#fff;color:#111}
button.pay{background:#14532d;color:#fff;border-color:#14532d}</style></head>
<body><p class="banner" role="note">SIMULATED PAYNOW — local test environment. No real money moves.</p>
<h1>Pay ${escapeHtml(integration.currency)} ${escapeHtml(tx.amount)}</h1>
<p>To: ${escapeHtml(integration.name)} (integration ${escapeHtml(tx.integrationId)})</p>
<p>Reference: <code>${escapeHtml(tx.reference)}</code> · Paynow reference ${escapeHtml(tx.paynowReference)}</p>
<p>Status: <strong data-testid="simulated-paynow-status">${escapeHtml(tx.status)}</strong></p>
<form method="post"><button class="pay" name="outcome" value="pay" type="submit">Pay (simulated card)</button>
<button name="outcome" value="cancel" type="submit">Cancel</button></form></body></html>`);
  }

  async hostedAction(guid, body) {
    const tx = this.transactions.get(guid);
    if (!tx) return { status: 404, body: 'Unknown payment' };
    let outcome = '';
    try { outcome = new Map(parseForm(body)).get('outcome'); } catch { /* none */ }
    if (tx.status === 'Created') {
      if (outcome === 'pay') this.transition(tx, this.integrations.get(tx.integrationId).escrow ? 'Awaiting Delivery' : 'Paid', 'hosted_page');
      else if (outcome === 'cancel') this.transition(tx, 'Cancelled', 'hosted_page');
      await this.notify(tx);
    }
    return { status: 302, location: tx.returnUrl, body: '' };
  }

  // ── status changes and delivery (resent on HTTP errors up to ten times, as documented) ─────────────────────────

  transition(tx, status, via) {
    tx.status = status;
    tx.history.push({ at: this.now(), status, via });
  }

  async notify(tx, { body = null, attempts = 10 } = {}) {
    if (!this.deliver) return { delivered: false, reason: 'no_deliverer' };
    const message = body ?? this.statusMessage(tx);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let status = 0;
      try { status = await this.deliver(tx.resultUrl, message); } catch { status = 0; }
      this.deliveries.push({ guid: tx.guid, attempt, status, at: this.now(), body: message });
      if (status >= 200 && status < 300) return { delivered: true, attempt, status };
    }
    return { delivered: false, attempts };
  }

  schedule(guid, afterMs, status) { this.scheduled.push({ guid, due: this.now() + afterMs, status }); }

  /** Apply every scheduled change that is due (the HTTP wrapper calls this on a timer; tests call it directly). */
  async runDue() {
    const due = this.scheduled.filter((s) => s.due <= this.now());
    this.scheduled = this.scheduled.filter((s) => s.due > this.now());
    for (const s of due) {
      const tx = this.transactions.get(s.guid);
      if (tx && ['Created', 'Sent'].includes(tx.status)) {
        const integration = this.integrations.get(tx.integrationId);
        this.transition(tx, s.status === 'Paid' && integration.escrow ? 'Awaiting Delivery' : s.status, 'scheduled');
        await this.notify(tx);
      }
    }
    return due.length;
  }

  // ── explicit TEST controls (never part of the merchant API) ─────────────────────────────────────────────────

  async setStatus(guid, status, { notify = true } = {}) {
    const tx = this.transactions.get(guid);
    if (!tx) throw new Pay05Error('PAY05_SIMULATOR_TRANSACTION_UNKNOWN', 404);
    this.transition(tx, status, 'control');
    return notify ? this.notify(tx) : { delivered: false, reason: 'not_requested' };
  }

  /** A status update signed with the WRONG key (or tampered after signing) — for forgery tests. */
  forgedStatusMessage(guid, { status = 'Paid', amount = null, key = crypto.randomUUID(), tamper = false } = {}) {
    const tx = this.transactions.get(guid);
    const pairs = signPairs([['reference', tx.reference], ['paynowreference', tx.paynowReference], ['amount', amount ?? tx.amount],
      ['status', status], ['pollurl', this.pollUrl(tx.guid)]], key);
    if (tamper) pairs[2] = ['amount', '0.01'];
    return encodeForm(pairs);
  }

  /** Re-send the current, correctly signed status update (Paynow's duplicate delivery). */
  async resend(guid) { return this.notify(this.transactions.get(guid), { attempts: 1 }); }

  inject(kind, fault) { this.faults[kind].push(fault); }

  transaction(guid) { const tx = this.transactions.get(guid); return tx ? structuredClone(tx) : null; }

  list() { return [...this.transactions.values()].map((tx) => structuredClone(tx)); }
}

/** The adapter's transport, routed in-process to a simulator (tests): anything off the simulator origin is unreachable. */
export function simulatorTransport(simulator) {
  return async (url, { body = '', method = 'POST' } = {}) => {
    const target = new URL(url);
    if (target.origin !== simulator.origin) throw new Error(`ECONNREFUSED ${target.origin}`);
    const reply = await simulator.handle({ method, path: `${target.pathname}${target.search}`, body });
    return { status: reply.status, text: reply.body, location: reply.location ?? null };
  };
}
