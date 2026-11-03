/**
 * CARUP-PAY-05-LR01 — the Paynow adapter (production code path) against the local protocol simulator.
 * Every request the adapter sends is verified by the simulator with the integration key; every reply the adapter
 * accepts is verified by the adapter. No network beyond the in-process simulator transport, no database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PaynowProtocolSimulator, simulatorTransport } from '../services/payment/pay05PaynowSimulator.js';
import http from 'node:http';
import { PaynowAdapter, createPaynowAdapter, httpTransport, PAYNOW_TIMEOUTS } from '../services/payment/pay05PaynowAdapter.js';
import { PAYNOW_ENDPOINTS, newMerchantTrace } from '../services/payment/pay05PaynowProtocol.js';

const ORIGIN = 'http://127.0.0.1:5061';
const env = { NODE_ENV: 'test', CARUP_ENV: 'test' };

function world({ currency = 'USD', methods = ['web', 'ecocash', 'onemoney', 'innbucks', 'omari'], escrow = false } = {}) {
  let clock = Date.parse('2026-11-02T10:00:00Z');
  const delivered = [];
  const sim = new PaynowProtocolSimulator({ origin: ORIGIN, env, now: () => clock, deliver: async (url, body) => { delivered.push({ url, body }); return 200; } });
  const issued = sim.issueIntegration({ currency, methods, escrow });
  const calls = [];
  const transport = simulatorTransport(sim);
  const counting = async (url, opts) => { calls.push(url); return transport(url, opts); };
  const adapter = new PaynowAdapter({
    integration: { integrationId: issued.integrationId, key: issued.key, currency, methods: issued.methods, mode: 'simulator' },
    merchantReference: 'pnm_garage_alpha',
    endpoints: { initiate: `${ORIGIN}/interface/initiatetransaction`, remote: `${ORIGIN}/interface/remotetransaction`, trace: `${ORIGIN}/interface/trace` },
    allow: { origins: [ORIGIN] },
    transport: counting,
  });
  return { sim, adapter, issued, delivered, calls, advance: async (ms) => { clock += ms; await sim.runDue(); } };
}

const checkout = (over = {}) => ({
  reference: 'pay04_gar_11111111-2222-3333-4444-555555555555', amountMinor: 2500, currency: 'USD', method: 'web',
  returnUrl: 'http://127.0.0.1:5203/dashboard/service-requests?invoice=i1&collection=c1&pay04=returned',
  resultUrl: 'http://127.0.0.1:5051/api/payments/pay05/paynow/result/c1',
  additionalInfo: 'Invoice INV-0001 — Alpha Garage', merchantTrace: newMerchantTrace(), ...over,
});

async function rejects(promise, code) {
  try { await promise; } catch (err) { assert.equal(err?.code, code, `expected ${code}, got ${err?.code}: ${err?.message}`); return err; }
  assert.fail(`expected ${code}`);
}

test('hosted checkout: a signed request, a verified reply, a Paynow URL to redirect to, and nothing counted yet', async () => {
  const w = world();
  const out = await w.adapter.createCheckout(checkout());
  assert.match(out.checkoutId, /^pn_trace_[A-Za-z0-9]{32}$/);
  assert.match(out.paymentId, /^pn_poll_[0-9a-f]{40}$/);
  assert.ok(out.url.startsWith(`${ORIGIN}/Payment/ConfirmPayment/`));
  const [tx] = w.sim.list();
  assert.deepEqual([tx.amount, tx.reference, tx.method, tx.status], ['25.00', 'pay04_gar_11111111-2222-3333-4444-555555555555', 'web', 'Created']);
  assert.equal(tx.authEmail, null, 'no customer e-mail is sent for a hosted checkout');
  const truth = await w.adapter.getPaymentTruth({ pollUrl: out.pollUrl });
  assert.deepEqual([truth.providerStatus, truth.snapshot, truth.moneyReceived, truth.amountMinor], ['created', 'pending', false, 2500]);
  assert.equal(truth.merchantReference, 'pnm_garage_alpha');
  assert.equal(truth.currency, 'USD', 'currency is the integration\'s: Paynow carries none');
  await w.sim.handle({ method: 'POST', path: new URL(out.url).pathname, body: 'outcome=pay' });
  const paid = await w.adapter.getPaymentTruth({ pollUrl: out.pollUrl });
  assert.deepEqual([paid.providerStatus, paid.snapshot, paid.moneyReceived, paid.paymentId], ['paid', 'paid', true, out.paymentId]);
  assert.equal(w.delivered.length, 1, 'Paynow posted a status update to the resulturl');
  const update = w.adapter.verifyStatusUpdate(w.delivered[0].body);
  assert.equal(update.truth.providerStatus, 'paid');
});

test('express EcoCash with Paynow\'s documented test numbers: success after 5 s, user-cancelled as FAILED, insufficient balance refused', async () => {
  const w = world();
  const ok = await w.adapter.createCheckout(checkout({ method: 'ecocash', phone: '+263771111111', authEmail: 'payer@example.invalid' }));
  assert.equal(ok.url, null);
  assert.match(ok.express.instructions, /EcoCash/);
  assert.equal(w.sim.list()[0].phone, '0771111111', 'normalised before sending');
  assert.equal((await w.adapter.getPaymentTruth({ pollUrl: ok.pollUrl })).providerStatus, 'sent');
  await w.advance(5_000);
  assert.equal((await w.adapter.getPaymentTruth({ pollUrl: ok.pollUrl })).snapshot, 'paid');

  const cancelled = await w.adapter.createCheckout(checkout({ method: 'ecocash', phone: '0773333333', authEmail: 'payer@example.invalid' }));
  await w.advance(30_000);
  const failed = await w.adapter.getPaymentTruth({ pollUrl: cancelled.pollUrl });
  assert.deepEqual([failed.providerStatus, failed.snapshot], ['failed', 'cancelled']);

  const refused = await rejects(w.adapter.createCheckout(checkout({ method: 'ecocash', phone: '0774444444', authEmail: 'payer@example.invalid' })),
    'PAY05_PROVIDER_REFUSED');
  assert.equal(refused.details.outcome, 'refused');
  assert.equal(refused.details.provider_error, 'Insufficient balance');
});

test('express needs the payer e-mail and a valid phone; methods the integration has not enabled are never sent', async () => {
  const w = world({ methods: ['web', 'ecocash'] });
  await rejects(w.adapter.createCheckout(checkout({ method: 'ecocash', phone: '0771111111' })), 'PAY05_AUTH_EMAIL_REQUIRED');
  await rejects(w.adapter.createCheckout(checkout({ method: 'ecocash', phone: '12345', authEmail: 'p@example.invalid' })), 'PAY05_PHONE_INVALID');
  await rejects(w.adapter.createCheckout(checkout({ method: 'onemoney', phone: '0711234567', authEmail: 'p@example.invalid' })), 'PAY05_METHOD_NOT_AVAILABLE');
  await rejects(w.adapter.createCheckout(checkout({ method: 'vmc' })), 'PAY05_METHOD_NOT_AVAILABLE');
  await rejects(w.adapter.createCheckout(checkout({ currency: 'ZWG' })), 'PAY05_CURRENCY_MISMATCH');
  await rejects(w.adapter.createCheckout(checkout({ merchantTrace: 'x'.repeat(33) })), 'PAY05_MERCHANT_TRACE_INVALID');
  await rejects(w.adapter.createCheckout(checkout({ method: 'ecocash', phone: '0771111111', authEmail: 'p@xn--p1ai' })), 'PAY05_AUTH_EMAIL_REQUIRED');
  assert.equal(w.calls.length, 0, 'every refusal happened before any provider call');
  // independent review S8: a local refusal says so — nothing was sent, so nothing can exist at Paynow
  const err = await rejects(w.adapter.createCheckout(checkout({ method: 'ecocash', phone: '12345', authEmail: 'p@example.invalid' })), 'PAY05_PHONE_INVALID');
  assert.equal(err.details?.outcome, 'not_sent');
});

test('InnBucks returns an authorization code and expiry to show the customer — USD only', async () => {
  const w = world();
  // independent review P8: Paynow's Express checkout takes the payer's phone for every mobile-money method, InnBucks too
  await rejects(w.adapter.createCheckout(checkout({ method: 'innbucks', authEmail: 'p@example.invalid' })), 'PAY05_PHONE_INVALID');
  const out = await w.adapter.createCheckout(checkout({ method: 'innbucks', phone: '0771234567', authEmail: 'p@example.invalid' }));
  assert.equal(w.sim.list().at(-1).phone, '0771234567', 'the phone is sent');
  assert.match(out.express.authorizationCode, /^\d{9}$/);
  assert.match(out.express.authorizationExpires, /^\d{1,2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2}$/);
  const zwg = world({ currency: 'ZWG' });
  await rejects(zwg.adapter.createCheckout(checkout({ currency: 'ZWG', method: 'innbucks', phone: '0771234567', authEmail: 'p@example.invalid' })), 'PAY05_METHOD_NOT_AVAILABLE');
  assert.equal(zwg.calls.length, 0);
});

test('O\'mari: a wrong OTP is refused by Paynow, the right one completes the payment through the allowlisted OTP URL', async () => {
  const w = world();
  const out = await w.adapter.createCheckout(checkout({ method: 'omari', phone: '0712345678', authEmail: 'p@example.invalid' }));
  assert.match(out.express.otpReference, /^OTP\d+$/);
  await rejects(w.adapter.submitOtp({ remoteOtpUrl: out.express.remoteOtpUrl, otp: '000000' }), 'PAY05_OTP_REJECTED');
  await rejects(w.adapter.submitOtp({ remoteOtpUrl: out.express.remoteOtpUrl, otp: 'abc' }), 'PAY05_OTP_INVALID');
  await rejects(w.adapter.submitOtp({ remoteOtpUrl: 'https://attacker.example/Interface/RemoteOTP/?guid=x', otp: '123456' }), 'PAY05_PROVIDER_URL_REFUSED');
  const { otp } = w.sim.otpOutbox.at(-1);
  const truth = await w.adapter.submitOtp({ remoteOtpUrl: out.express.remoteOtpUrl, otp });
  assert.equal(truth.snapshot, 'paid');
});

test('status updates: a forged or tampered signature is refused; a resend is byte-identical (same event)', async () => {
  const w = world();
  const out = await w.adapter.createCheckout(checkout());
  const guid = new URL(out.url).pathname.split('/').at(-1);
  assert.throws(() => w.adapter.verifyStatusUpdate(w.sim.forgedStatusMessage(guid)), /PAY05_CALLBACK_SIGNATURE_INVALID/);
  assert.throws(() => w.adapter.verifyStatusUpdate(w.sim.forgedStatusMessage(guid, { key: w.issued.key, tamper: true })),
    /PAY05_CALLBACK_SIGNATURE_INVALID/);
  assert.throws(() => w.adapter.verifyStatusUpdate('status=Paid&amount=25.00'), /PAY05_CALLBACK_SIGNATURE_INVALID/);
  assert.throws(() => w.adapter.verifyStatusUpdate(''), /PAY05_PROVIDER_MESSAGE_MALFORMED/);
  await w.sim.setStatus(guid, 'Paid');
  await w.sim.resend(guid);
  assert.equal(w.delivered.length, 2);
  assert.equal(w.delivered[0].body, w.delivered[1].body);
});

test('unauthenticated or hostile replies never become provider truth', async () => {
  const w = world();
  w.sim.inject('initiate', { kind: 'unsigned_ok' });
  const unsigned = await rejects(w.adapter.createCheckout(checkout()), 'PAY05_PROVIDER_RESPONSE_UNAUTHENTICATED');
  assert.equal(unsigned.details.outcome, 'unknown', 'a transaction may exist: the caller must trace, not retry blindly');
  w.sim.inject('initiate', { kind: 'wrong_hash' });
  await rejects(w.adapter.createCheckout(checkout()), 'PAY05_PROVIDER_RESPONSE_UNAUTHENTICATED');
  w.sim.inject('initiate', { kind: 'foreign_pollurl' });
  const before = w.calls.length;
  const hostile = await rejects(w.adapter.createCheckout(checkout()), 'PAY05_PROVIDER_URL_REFUSED');
  assert.equal(w.calls.length, before + 1, 'the hostile poll URL was refused, never requested');
  assert.equal(hostile.details?.outcome, 'unknown', 'Paynow accepted the request: a transaction may exist, so the caller traces');
  const out = await w.adapter.createCheckout(checkout());
  w.sim.inject('poll', { kind: 'unsigned' });
  await rejects(w.adapter.getPaymentTruth({ pollUrl: out.pollUrl }), 'PAY05_PROVIDER_RESPONSE_UNAUTHENTICATED');
  w.sim.inject('poll', { kind: 'error' });
  await rejects(w.adapter.getPaymentTruth({ pollUrl: out.pollUrl }), 'PAY05_PROVIDER_READ_FAILED');
  await rejects(w.adapter.getPaymentTruth({ pollUrl: 'http://169.254.169.254/latest/meta-data/' }), 'PAY05_PROVIDER_URL_REFUSED');
});

test('a lost initiation reply is recovered by merchant trace — never by sending the payment again', async () => {
  const w = world();
  const trace = newMerchantTrace();
  w.sim.inject('initiate', { kind: 'drop_response' });
  const lost = await rejects(w.adapter.createCheckout(checkout({ merchantTrace: trace })), 'PAY05_PROVIDER_UNREACHABLE');
  assert.equal(lost.details.outcome, 'unknown');
  assert.equal(w.sim.list().length, 1, 'Paynow did create it');
  const found = await w.adapter.trace({ merchantTrace: trace });
  assert.equal(found.found, true);
  assert.equal(found.truth.providerStatus, 'created');
  assert.match(found.truth.paymentId, /^pn_poll_[0-9a-f]{40}$/);
  const absent = await w.adapter.trace({ merchantTrace: newMerchantTrace() });
  assert.deepEqual([absent.found, absent.authenticated], [false, true]);
  w.sim.inject('trace', { kind: 'error' });
  await rejects(w.adapter.trace({ merchantTrace: trace }), 'PAY05_PROVIDER_TRACE_FAILED');
});

test('no cancel and no refund API exists: the adapter says so and makes no call', async () => {
  const w = world();
  const out = await w.adapter.createCheckout(checkout());
  const before = w.calls.length;
  assert.deepEqual(await w.adapter.cancelCheckout(out.checkoutId), { status: 'unsupported_by_provider' });
  await rejects(w.adapter.refund({ paymentId: out.paymentId, amountMinor: 2500, idempotencyKey: 'refund-key-1' }), 'PAY05_PROVIDER_REFUND_UNSUPPORTED');
  assert.equal(w.calls.length, before);
  assert.equal(w.adapter.capabilities.cancelCheckout, false);
  assert.equal(w.adapter.capabilities.refund, false);
  assert.equal(w.adapter.capabilities.enforcesExpiry, false);
});

test('the factory: simulator credentials only reach the loopback simulator; real Paynow is refused without provider authorization', () => {
  const integration = { integrationId: '20001', key: '3e9fed89-60e1-4ce5-ab6e-6b1eb2d4f977', currency: 'USD', methods: ['web'] };
  const simEnv = { ...env, CARUP_PAY05_PAYNOW_SIMULATOR_ORIGIN: ORIGIN };
  const sim = createPaynowAdapter({ integration: { ...integration, mode: 'simulator' }, merchantReference: 'pnm_x', env: simEnv });
  assert.equal(sim.endpoints.initiate, `${ORIGIN}/interface/initiatetransaction`);
  assert.throws(() => createPaynowAdapter({ integration: { ...integration, mode: 'simulator' }, merchantReference: 'pnm_x', env }),
    /PAY05_SIMULATOR_ORIGIN_INVALID/);
  assert.throws(() => createPaynowAdapter({ integration: { ...integration, mode: 'simulator' }, merchantReference: 'pnm_x',
    env: { ...env, CARUP_PAY05_PAYNOW_SIMULATOR_ORIGIN: 'https://www.paynow.co.zw' } }), /PAY05_SIMULATOR_ORIGIN_INVALID/);
  for (const mode of ['paynow_test', 'paynow_live']) {
    assert.throws(() => createPaynowAdapter({ integration: { ...integration, mode }, merchantReference: 'pnm_x', env: simEnv }),
      /PAY05_REAL_PROVIDER_NOT_AUTHORIZED/, mode);
  }
  assert.throws(() => createPaynowAdapter({ integration: { ...integration, mode: 'simulator' }, merchantReference: 'pnm_x',
    env: { ...simEnv, NODE_ENV: 'production' } }), /PAY05_SIMULATOR_REFUSED|PAY05_DISABLED/);
  assert.equal(PAYNOW_ENDPOINTS.initiate.startsWith('https://www.paynow.co.zw/'), true);
});

test('the simulator itself refuses production and non-loopback origins', () => {
  assert.throws(() => new PaynowProtocolSimulator({ origin: ORIGIN, env: { NODE_ENV: 'production' } }), /PAY05_SIMULATOR_REFUSED/);
  assert.throws(() => new PaynowProtocolSimulator({ origin: 'https://www.paynow.co.zw', env }), /PAY05_SIMULATOR_REFUSED/);
});

// ── independent review P6 / P8 (2026-11-02) ──

test('initiation waits as long as Paynow\'s own plugins (45 s); reads keep a short timeout', async () => {
  assert.deepEqual(PAYNOW_TIMEOUTS, { initiateMs: 45_000, readMs: 15_000 });
  const w = world();
  const seen = [];
  const inner = w.adapter.transport;
  w.adapter.transport = async (url, opts) => { seen.push([new URL(url).pathname.toLowerCase(), opts.timeoutMs]); return inner(url, opts); };
  const out = await w.adapter.createCheckout(checkout({ method: 'ecocash', phone: '0771111111', authEmail: 'p@example.invalid' }));
  await w.adapter.getPaymentTruth({ pollUrl: out.pollUrl });
  assert.deepEqual(seen, [['/interface/remotetransaction', 45_000], ['/interface/checkpayment/', 15_000]]);
});

test('the HTTP transport refuses an oversized reply without buffering it (declared length or streamed bytes)', async () => {
  const big = 'x'.repeat(70 * 1024);
  const server = http.createServer((req, res) => {
    if (req.url === '/declared') { res.writeHead(200, { 'content-length': String(big.length) }); res.end(big); return; }
    res.writeHead(200); res.write(big.slice(0, 40 * 1024)); res.write(big.slice(40 * 1024)); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const transport = httpTransport();
    await assert.rejects(transport(`http://127.0.0.1:${port}/declared`, { body: '' }), /reply too large/);
    await assert.rejects(transport(`http://127.0.0.1:${port}/streamed`, { body: '' }), /reply too large/);
    server.closeAllConnections?.();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the simulator\'s amount control: Paynow reporting a DIFFERENT amount reaches CarUp as that amount (UAT amount-mismatch case)', async () => {
  const w = world();
  const out = await w.adapter.createCheckout(checkout({ method: 'ecocash', phone: '0779000001', authEmail: 'p@example.invalid' }));
  const guid = new URL(out.pollUrl).searchParams.get('guid');
  await w.sim.setStatus(guid, 'Paid', { notify: false, amount: '1.00' });
  const truth = await w.adapter.getPaymentTruth({ pollUrl: out.pollUrl });
  assert.deepEqual([truth.providerStatus, truth.amountMinor], ['paid', 100]);
  await assert.rejects(w.sim.setStatus(guid, 'Paid', { notify: false, amount: '1' }), /amount/i, 'only Paynow\'s two-decimal format');
});

test('the simulator server listens where fetch may reach it: never a WHATWG "bad port" such as 5061 (SIP)', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../../scripts/uat/pay05-paynow-simulator-server.mjs', import.meta.url), 'utf8');
  assert.match(src, /\?\? 5071\)/);
  assert.doesNotMatch(src, /\?\? 5061\)|--port 5061/);
});

// ───────────────── PAY-05-R1: what the simulator used to hide (ICR-P2, P3, P4) ─────────────────

test('R1 (ICR-P2): in test mode Paynow takes only the merchant\'s own login e-mail on an express request', async () => {
  const sim = new PaynowProtocolSimulator({ origin: ORIGIN, env });
  const issued = sim.issueIntegration({ currency: 'USD', methods: ['ecocash'], testModeAuthEmail: 'merchant@example.invalid' });
  const adapter = new PaynowAdapter({ integration: { integrationId: issued.integrationId, key: issued.key, currency: 'USD', methods: ['ecocash'], mode: 'simulator' },
    merchantReference: 'pnm_x', endpoints: { initiate: `${ORIGIN}/interface/initiatetransaction`, remote: `${ORIGIN}/interface/remotetransaction`, trace: `${ORIGIN}/interface/trace` },
    allow: { origins: [ORIGIN] }, transport: simulatorTransport(sim) });
  const request = (authEmail) => adapter.createCheckout({ reference: `pay04_gar_${newMerchantTrace().slice(0, 12)}`, amountMinor: 1000, currency: 'USD', method: 'ecocash', phone: '0771234567', authEmail,
    returnUrl: 'https://carup.example/back', resultUrl: 'https://carup.example/result', merchantTrace: newMerchantTrace() });
  await assert.rejects(request('payer@example.invalid'), (e) => e.code === 'PAY05_PROVIDER_REFUSED' && /authemail/.test(e.details.provider_error));
  const accepted = await request('merchant@example.invalid');
  assert.ok(accepted.pollUrl);
});

test('R1 (ICR-P4): a Paynow reply naming a host outside the allowlist is never followed, and the request is treated as possibly existing', async () => {
  const { sim, adapter } = world();
  sim.inject('initiate', { kind: 'foreign_pollurl' });
  await assert.rejects(adapter.createCheckout(checkout({ method: 'ecocash', phone: '0771234567', authEmail: 'payer@example.invalid' })),
    (e) => e.code === 'PAY05_PROVIDER_URL_REFUSED' && e.details?.outcome === 'unknown');
});

test('R1 (ICR-P6): padding a value still verifies, as Paynow\'s published vector requires, and identity collapses it (see the protocol tests)', async () => {
  const { signPairs, verifyPairs } = await import('../services/payment/pay05PaynowProtocol.js');
  const key = '11111111-2222-3333-4444-555555555555';
  const signed = signPairs([['reference', 'R1'], ['status', 'Paid']], key);
  const padded = signed.map(([k, v]) => (k === 'status' ? [k, `${v} `] : [k, v]));
  assert.equal(verifyPairs(padded, key).valid, true);
});
