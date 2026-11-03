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
const {
  PAYNOW_STATE_LABELS, confirms, paynowAuthEmailFor, paynowCollectionState, paynowReleaseBlock, paynowView, publicResultUrl, withCollectionState,
} = await import('../services/payment/pay05PaynowCollectionService.js');

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
  // R1 (ICR-W3): Paynow's word is Paynow's word; "counted" is said only by the collection's state
  assert.match(paynowView(tx('ecocash', 'paid')).provider_status_label, /^Paynow reports it paid$/);
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

// ───────────────── PAY-05-R1: every combination of what Paynow said and what CarUp did (ICR-W1, W2, W3, W7) ─────────────────

const WORDS = [null, 'created', 'sent', 'awaiting_delivery', 'delivered', 'paid', 'cancelled', 'failed', 'disputed', 'refunded', 'unrecognized'];
const MONEY = new Set(['awaiting_delivery', 'delivered', 'paid', 'disputed']);
const CANONICAL = ['pending', 'paid', 'cancelled', 'refunded'];
const METHODS = ['web', 'ecocash', 'innbucks', 'omari'];
const REVIEW_SETS = [[], ['unallocated_provider_money'], ['provider_disputed'], ['provider_status_unrecognized'], ['provider_paid_after_close'], ['provider_refund_unquantified']];
const FALSE_MONEY = /nothing (was|is) (paid|charged)|no money|never paid/i;

function* everyRow() {
  for (const word of WORDS) for (const canonical of CANONICAL) for (const method of METHODS) for (const reviews of REVIEW_SETS)
    for (const released of [false, true]) for (const settled of [false, true]) for (const stopped of [false, true]) for (const expired of [false, true])
      for (const counted of canonical === 'paid' ? [0, 25] : [0]) {
        const row = {
          method, initiation_state: 'attached', provider_status: word, browser_url: 'https://paynow.example/page', remote_otp_url: 'https://paynow.example/otp',
          authorization_code: 'ABC123', instructions: null, phone_masked: null, hold_released_at: released || settled ? '2026-11-03T00:00:00Z' : null,
          settled_off_platform_at: settled ? '2026-11-03T00:00:00Z' : null, provider_status_at: '2026-11-03T00:00:00Z',
        };
        const collection = { cancelled_at: stopped ? '2026-11-03T00:00:00Z' : null, cancelled_by: stopped ? 'p5-cust' : null,
          expires_at: expired ? '2020-01-01T00:00:00Z' : '2999-01-01T00:00:00Z' };
        const view = paynowView(row, { customer: true });
        const open = reviews.map((discrepancy_type) => ({ discrepancy_type }));
        const state = paynowCollectionState(collection, { status: canonical }, view, { openDiscrepancies: open, counted });
        const said = withCollectionState(view, state, { counted, currency: 'USD', customer: true });
        yield { word, canonical, method, reviews, released, settled, stopped, expired, counted, view, state, said, label: PAYNOW_STATE_LABELS[state] };
      }
}

test('R1: no state ever says nothing was paid or charged while Paynow reports money', () => {
  let n = 0;
  for (const r of everyRow()) {
    n += 1;
    if (!MONEY.has(r.word)) continue;
    assert.doesNotMatch(r.label ?? '', FALSE_MONEY, JSON.stringify([r.word, r.canonical, r.state]));
    assert.doesNotMatch(r.said.provider_status_label, FALSE_MONEY, JSON.stringify([r.word, r.canonical, r.state]));
  }
  assert.ok(n > 10000, `exhaustive: ${n}`);
});

test('R1: "Paid" and "counted" are said only when the money was counted', () => {
  for (const r of everyRow()) {
    const key = JSON.stringify([r.word, r.canonical, r.state, r.counted, r.reviews]);
    if (r.state === 'confirmed') assert.ok(r.counted > 0, key);
    if (r.counted === 0) {
      assert.notEqual(r.state, 'confirmed', key);
      assert.equal(r.said.facts.counted, false, key);
      assert.match(r.said.facts.allocation, /^Not counted/, key);
      assert.doesNotMatch(r.said.provider_status_label, /confirmed by paynow|^paid —/i, key);
    } else if (r.state === 'confirmed') {
      assert.equal(r.said.facts.counted, true, key);
      assert.match(r.said.facts.allocation, /^Counted on this invoice: 25\.00 USD$/, key);
    }
  }
});

test('R1: a released or settled request is never waiting for the customer, never "still counts", and offers nothing to act on', () => {
  for (const r of everyRow()) {
    if (!r.released && !r.settled) continue;
    const key = JSON.stringify([r.word, r.canonical, r.state, r.method]);
    assert.doesNotMatch(r.said.provider_status_label, /waiting for you|still counts/i, key);
    assert.equal(r.view.checkout_url, null, key);
    assert.equal(r.view.authorization_code, null, key);
    assert.equal(r.view.needs_otp, false, key);
  }
});

test('R1: past CarUp\'s time or stopped, the link, code and form stay available while the money stays reserved and the request is still open', () => {
  for (const method of METHODS) {
    const row = { method, initiation_state: 'attached', provider_status: 'sent', browser_url: 'https://paynow.example/page', remote_otp_url: 'https://paynow.example/otp',
      authorization_code: 'ABC123', hold_released_at: null, settled_off_platform_at: null };
    const view = paynowView(row, { customer: true });
    if (method === 'innbucks') assert.equal(view.authorization_code, 'ABC123');
    if (method === 'omari') assert.equal(view.needs_otp, true);
    const web = paynowView({ ...row, provider_status: 'created' }, { customer: true });
    if (method === 'web') assert.equal(web.checkout_url, 'https://paynow.example/page');
    for (const collection of [{ cancelled_at: null, expires_at: '2020-01-01T00:00:00Z' }, { cancelled_at: '2026-11-03T00:00:00Z', cancelled_by: 'p5-cust', expires_at: '2999-01-01T00:00:00Z' }]) {
      const state = paynowCollectionState(collection, { status: 'pending' }, view);
      assert.ok(['expired', 'stopping'].includes(state));
      assert.match(PAYNOW_STATE_LABELS[state], /stays reserved/);
    }
  }
});

test('R1: escrow past CarUp\'s time is at Paynow, not expired (ICR-W1); late money closed by an operator is not "before payment"', () => {
  const view = { provider_status: 'delivered', hold_released: false, settled_outside: false };
  assert.equal(paynowCollectionState({ cancelled_at: null, expires_at: '2020-01-01T00:00:00Z' }, { status: 'pending' }, view), 'at_paynow');
  assert.equal(paynowCollectionState({ cancelled_at: '2026-11-03T00:00:00Z', expires_at: '2999-01-01T00:00:00Z' }, { status: 'pending' }, view), 'at_paynow');
  const late = paynowCollectionState({ cancelled_at: '2026-11-03T00:00:00Z', cancelled_by: 'provider:paynow_zimbabwe' }, { status: 'cancelled' }, { provider_status: 'paid' });
  assert.equal(late, 'closed_not_counted');
  assert.doesNotMatch(PAYNOW_STATE_LABELS[late], FALSE_MONEY);
});

test('R1: a canonical Paid CarUp does not count reads as what it is', () => {
  assert.equal(paynowCollectionState({}, { status: 'paid' }, { provider_status: 'cancelled' }, { counted: 0 }), 'not_counted');
  assert.equal(paynowCollectionState({}, { status: 'paid' }, { provider_status: 'paid', settled_outside: true, hold_released: true }, { counted: 0 }), 'settled_outside');
  assert.equal(paynowCollectionState({}, { status: 'paid' }, { provider_status: 'paid' }, { counted: 25 }), 'confirmed');
  assert.equal(paynowCollectionState({}, { status: 'paid' }, { provider_status: 'paid', settled_outside: true }, { counted: 15 }), 'confirmed', 'the part that still counts');
  assert.equal(paynowCollectionState({}, { status: 'paid' }, { provider_status: 'paid' }, { openDiscrepancies: [{ discrepancy_type: 'provider_paid_after_close' }], counted: 0 }), 'under_review');
});

test('R1: each Paynow row carries its truth in separate parts, for the customer and for the garage', () => {
  const row = { method: 'ecocash', initiation_state: 'attached', provider_status: 'paid', provider_status_at: '2026-11-03T00:00:00Z' };
  const facts = withCollectionState(paynowView(row), 'under_review', { counted: 0, currency: 'USD' }).facts;
  assert.deepEqual(Object.keys(facts).sort(), ['allocation', 'counted', 'last_read_at', 'next_step', 'provider', 'review']);
  assert.equal(facts.provider, 'Paid');
  assert.match(facts.review, /reviewing/);
  assert.equal(facts.last_read_at, '2026-11-03T00:00:00Z');
  const customer = withCollectionState(paynowView(row, { customer: true }), 'under_review', { customer: true }).facts.next_step;
  assert.match(customer, /Do not pay again/);
  assert.notEqual(customer, facts.next_step);
});

test('R1: a request recovered without an address for the code says so instead of offering a form that would be refused (ICR-P4)', () => {
  const view = paynowView({ method: 'omari', initiation_state: 'attached', provider_status: 'sent', remote_otp_url: null }, { customer: true });
  assert.equal(view.needs_otp, false);
  assert.equal(view.otp_unavailable, true);
});

test('R1: the operator release is offered only when the database would allow it (ICR-W6)', () => {
  const open = { provider_status: 'sent', hold_released_at: null };
  assert.equal(paynowReleaseBlock({ tx: open, paymentStatus: 'pending' }), null);
  for (const word of ['cancelled', 'failed', null, 'created']) assert.equal(paynowReleaseBlock({ tx: { ...open, provider_status: word }, paymentStatus: 'pending' }), null);
  for (const word of ['paid', 'delivered', 'awaiting_delivery', 'disputed', 'refunded', 'unrecognized']) {
    assert.match(paynowReleaseBlock({ tx: { ...open, provider_status: word }, paymentStatus: 'pending' }), /money/, word);
  }
  assert.match(paynowReleaseBlock({ tx: open, paymentStatus: 'paid' }), /no longer waiting/);
  assert.match(paynowReleaseBlock({ tx: open, paymentStatus: 'pending', reviews: [{}] }), /review/);
  assert.match(paynowReleaseBlock({ tx: { ...open, hold_released_at: 'x' }, paymentStatus: 'pending' }), /Already/);
});

test('R1: what confirms a status update: the same word, or a word further along', () => {
  assert.equal(confirms('paid', 'paid'), true);
  assert.equal(confirms('delivered', 'paid'), true);
  assert.equal(confirms('paid', 'disputed'), true);
  assert.equal(confirms('paid', 'sent'), false);
  assert.equal(confirms('paid', 'delivered'), false);
  assert.equal(confirms('disputed', 'paid'), false, 'a lagging poll does not end Paynow\'s retries');
  assert.equal(confirms('cancelled', 'sent'), false);
  assert.equal(confirms('unrecognized', 'paid'), false);
});

test('R1: test mode authenticates with the merchant\'s login, live with the payer; a missing login e-mail is never replaced (ICR-P2)', () => {
  assert.equal(paynowAuthEmailFor({ mode: 'paynow_test', test_auth_email: 'merchant@example.invalid' }, 'payer@example.invalid'), 'merchant@example.invalid');
  assert.equal(paynowAuthEmailFor({ mode: 'paynow_test', test_auth_email: null }, 'payer@example.invalid'), null);
  assert.equal(paynowAuthEmailFor({ mode: 'paynow_live', test_auth_email: null }, 'payer@example.invalid'), 'payer@example.invalid');
  assert.equal(paynowAuthEmailFor({ mode: 'simulator', test_auth_email: null }, 'payer@example.invalid'), 'payer@example.invalid');
});

test('R1: a plain-http result URL is only ever the local simulator\'s (ICR-S1)', () => {
  const id = '00000000-0000-0000-0000-000000000001';
  assert.match(publicResultUrl({ CARUP_PAY05_RESULT_ORIGIN: 'http://127.0.0.1:5051' }, id, 'simulator'), /^http:/);
  assert.throws(() => publicResultUrl({ CARUP_PAY05_RESULT_ORIGIN: 'http://carup.example' }, id, 'paynow_live'), /PAY05_RESULT_ORIGIN_INVALID/);
  assert.throws(() => publicResultUrl({ CARUP_PAY05_RESULT_ORIGIN: 'http://carup.example' }, id, 'paynow_test'), /PAY05_RESULT_ORIGIN_INVALID/);
  assert.match(publicResultUrl({ CARUP_PAY05_RESULT_ORIGIN: 'https://carup.example' }, id, 'paynow_live'), /^https:/);
});
