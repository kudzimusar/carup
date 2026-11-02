/**
 * CARUP-PAY-05-LR01 — what a person reads about a Paynow request. No database.
 *
 * Found in the physical rehearsal (HTTP case E1): right after an EcoCash request CarUp has not read Paynow's status yet,
 * and the view said "Waiting for you to pay on Paynow" — the hosted-page words — to a customer who must approve the
 * payment on their phone. A request Paynow accepted but has not reported on is described by HOW the customer pays; real
 * Express polling may also report Created before Sent (independent review P8), which reads the same way.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';
const { paynowView } = await import('../services/payment/pay05PaynowCollectionService.js');

const tx = (method, status = null, extra = {}) => ({
  method, initiation_state: 'attached', provider_status: status, browser_url: 'http://127.0.0.1:5071/Payment/ConfirmPayment/x',
  instructions: null, authorization_code: method === 'innbucks' ? '123456789' : null, authorization_expires: null,
  otp_reference: method === 'omari' ? 'OTP1' : null, phone_masked: '077*****11', hold_released_at: null, paynow_reference: '9510',
  provider_error: null, ...extra,
});

test('a request Paynow accepted but has not reported on is described by how the customer pays', () => {
  for (const [method, words] of [['ecocash', /approve the payment on your phone/], ['onemoney', /approve the payment on your phone/],
    ['innbucks', /InnBucks code/], ['omari', /one-time code/], ['web', /^Waiting for you to pay on Paynow$/]]) {
    assert.match(paynowView(tx(method)).provider_status_label, words, method);
  }
});

test('Express requests that Paynow reports as Created read the same way; the hosted page keeps its own words', () => {
  assert.match(paynowView(tx('ecocash', 'created')).provider_status_label, /approve the payment on your phone/);
  assert.match(paynowView(tx('innbucks', 'created')).provider_status_label, /InnBucks code/);
  assert.equal(paynowView(tx('web', 'created')).provider_status_label, 'Waiting for you to pay on Paynow');
});

test('every reported status keeps its own words, and nothing here ever claims money', () => {
  assert.match(paynowView(tx('ecocash', 'sent')).provider_status_label, /approve the payment on your phone/);
  assert.match(paynowView(tx('ecocash', 'paid')).provider_status_label, /^Paid — confirmed by Paynow$/);
  assert.match(paynowView(tx('ecocash', 'awaiting_delivery')).provider_status_label, /not yet counted/);
  for (const method of ['ecocash', 'onemoney', 'innbucks', 'omari', 'web']) {
    assert.doesNotMatch(paynowView(tx(method)).provider_status_label, /\bpaid\b|confirmed/i, method);
  }
});

// physical rehearsal (browser, EcoCash pending): every Paynow row — still waiting, or confirmed — carries the channel
// line. "Paid through …" on a row still waiting for Paynow claimed money nobody had confirmed. The line names the
// channel only, in PAY-04's own words for its provider channel.
test('the Paynow channel line never claims a payment; it reads like PAY-04\'s provider channel', async () => {
  const { PAY05_LABELS } = await import('../services/payment/pay05Contract.js');
  const { PAY04_LABELS } = await import('../services/payment/pay04Contract.js');
  assert.doesNotMatch(PAY05_LABELS.paynowChannel, /^paid\b/i);
  assert.equal(PAY05_LABELS.paynowChannel, 'Through the garage’s own Paynow account. Money paid this way goes to the garage, not to CarUp.');
  assert.equal(PAY04_LABELS.providerChannel, 'Through the garage’s own payment provider. Money paid this way goes to the garage, not to CarUp.');
});
