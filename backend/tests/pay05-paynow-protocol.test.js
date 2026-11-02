/**
 * CARUP-PAY-05-LR01 — the Paynow merchant-API wire protocol, pinned to Paynow's own published examples.
 *
 * Sources (read-only, 2026-11-02; copies and SHA-256s in the PAY-05 evidence custody):
 *   https://developers.paynow.co.zw/docs/paynow/generating_hash/   (outbound vector 2A033FC3…)
 *   https://developers.paynow.co.zw/docs/paynow/validating_hash/   (inbound vector 750DD0B0…)
 *   https://developers.paynow.co.zw/docs/paynow/status_update/     (status vocabulary)
 *   https://developers.paynow.co.zw/docs/paynow/test_mode/         ("FAILED" = the user cancelled)
 * No network, no database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYNOW_ENDPOINTS,
  paynowHash,
  encodeForm,
  parseForm,
  signPairs,
  verifyPairs,
  classifyPaynowStatus,
  formatPaynowAmount,
  parsePaynowAmountMinor,
  assertProviderUrl,
  pollIdFor,
  newMerchantTrace,
  eventIdFor,
  normalizeZimbabweMobile,
  normalizeIntegrationKey,
  isPaynowAuthEmail,
} from '../services/payment/pay05PaynowProtocol.js';

const DOC_KEY = '3e9fed89-60e1-4ce5-ab6e-6b1eb2d4f977';
const REAL = { hosts: ['www.paynow.co.zw'] };

test('outbound hash: Paynow\'s published generating-hash vector', () => {
  const values = ['1201', 'TEST REF', '99.99', 'A test ticket transaction', 'http://www.google.com/search?q=returnurl',
    'http://www.google.com/search?q=resulturl', 'Message'];
  assert.equal(paynowHash(values, DOC_KEY),
    '2A033FC38798D913D42ECB786B9B19645ADEDBDE788862032F1BD82CF3B92DEF84F316385D5B40DBB35F1A4FD7D5BFE73835174136463CDD48C9366B0749C689');
});

test('inbound validation: Paynow\'s published validating-hash message verifies, in message order, URL-decoded', () => {
  const body = 'status=Ok&browserurl=https%3a%2f%2fstaging.paynow.co.zw%2fPayment%2fConfirmPayment%2f9510&pollurl=https%3a%2f%2fstaging.paynow.co.zw%2fInterface%2fCheckPayment%2f%3fguid%3dc7ed41da-0159-46da-b428-69549f770413&paynowreference=9510&hash=750DD0B0DF374678707BB5AF915AF81C228B9058AD57BB7120569EC68BBB9C2EFC1B26C6375D2BC562AC909B3CD6B2AF1D42E1A5E479FFAC8F4FB3FDCE71DF4D';
  const verified = verifyPairs(parseForm(body), DOC_KEY);
  assert.equal(verified.valid, true);
  assert.equal(verified.fields.get('pollurl'), 'https://staging.paynow.co.zw/Interface/CheckPayment/?guid=c7ed41da-0159-46da-b428-69549f770413');
  assert.equal(verified.fields.get('paynowreference'), '9510');
});

test('inbound validation refuses: a wrong key, a tampered value, a reordered message, a missing hash, a lowercase-forged hash of other data', () => {
  const body = 'status=Ok&browserurl=https%3a%2f%2fstaging.paynow.co.zw%2fPayment%2fConfirmPayment%2f9510&pollurl=https%3a%2f%2fstaging.paynow.co.zw%2fInterface%2fCheckPayment%2f%3fguid%3dc7ed41da-0159-46da-b428-69549f770413&paynowreference=9510&hash=750DD0B0DF374678707BB5AF915AF81C228B9058AD57BB7120569EC68BBB9C2EFC1B26C6375D2BC562AC909B3CD6B2AF1D42E1A5E479FFAC8F4FB3FDCE71DF4D';
  const pairs = parseForm(body);
  assert.equal(verifyPairs(pairs, `${DOC_KEY.slice(0, -1)}8`).valid, false, 'wrong key');
  const tampered = pairs.map(([k, v]) => (k === 'paynowreference' ? [k, '9511'] : [k, v]));
  assert.equal(verifyPairs(tampered, DOC_KEY).valid, false, 'tampered value');
  const reordered = [pairs[1], pairs[0], ...pairs.slice(2)];
  assert.equal(verifyPairs(reordered, DOC_KEY).valid, false, 'message order is part of the signature');
  assert.equal(verifyPairs(pairs.filter(([k]) => k !== 'hash'), DOC_KEY).valid, false, 'no hash');
  const forged = signPairs([['status', 'Paid'], ['amount', '1.00']], 'not-the-key');
  assert.equal(verifyPairs(forged, DOC_KEY).valid, false, 'signed with another key');
  // the comparison accepts Paynow's hex in either case, but only for the right digest
  const lower = pairs.map(([k, v]) => (k === 'hash' ? [k, v.toLowerCase()] : [k, v]));
  assert.equal(verifyPairs(lower, DOC_KEY).valid, true);
});

test('form codec: order preserved, + and %20 both decode to space, duplicate keys and junk are refused', () => {
  assert.deepEqual(parseForm('Status=Ok&BrowserUrl=a%20b&PollUrl=c+d'), [['status', 'Ok'], ['browserurl', 'a b'], ['pollurl', 'c d']]);
  assert.throws(() => parseForm('status=Ok&status=Paid'), /PAY05_PROVIDER_MESSAGE_MALFORMED/);
  assert.throws(() => parseForm(''), /PAY05_PROVIDER_MESSAGE_MALFORMED/);
  assert.throws(() => parseForm('x'.repeat(70_000)), /PAY05_PROVIDER_MESSAGE_MALFORMED/);
  const encoded = encodeForm([['id', '1201'], ['reference', 'TEST REF'], ['returnurl', 'http://x/y?a=1&b=2']]);
  assert.equal(encoded, 'id=1201&reference=TEST+REF&returnurl=http%3A%2F%2Fx%2Fy%3Fa%3D1%26b%3D2');
  // signing hashes the raw (decoded) values in the order sent
  const signed = signPairs([['id', '1201'], ['reference', 'TEST REF'], ['amount', '99.99'], ['additionalinfo', 'A test ticket transaction'],
    ['returnurl', 'http://www.google.com/search?q=returnurl'], ['resulturl', 'http://www.google.com/search?q=resulturl'], ['status', 'Message']], DOC_KEY);
  assert.equal(signed.at(-1)[1].slice(0, 8), '2A033FC3');
  assert.equal(verifyPairs(parseForm(encodeForm(signed)), DOC_KEY).valid, true, 'what we send verifies after the round trip');
});

test('status vocabulary: each documented status keeps its own meaning; only Paid counts; unknown words never move money', () => {
  const c = (s) => classifyPaynowStatus(s);
  assert.deepEqual([c('Paid').code, c('Paid').snapshot, c('Paid').moneyReceived], ['paid', 'paid', true]);
  assert.deepEqual([c('Awaiting Delivery').code, c('Awaiting Delivery').snapshot, c('Awaiting Delivery').moneyReceived], ['awaiting_delivery', 'pending', true]);
  assert.deepEqual([c('Delivered').code, c('Delivered').snapshot, c('Delivered').moneyReceived], ['delivered', 'pending', true]);
  assert.deepEqual([c('Created').code, c('Created').snapshot, c('Created').moneyReceived], ['created', 'pending', false]);
  assert.deepEqual([c('Sent').code, c('Sent').snapshot], ['sent', 'pending']);
  assert.deepEqual([c('Cancelled').code, c('Cancelled').snapshot], ['cancelled', 'cancelled']);
  assert.deepEqual([c('Failed').code, c('Failed').snapshot], ['failed', 'cancelled'], 'test mode documents FAILED as the user cancelling');
  assert.deepEqual([c('Disputed').code, c('Disputed').snapshot, c('Disputed').moneyReceived], ['disputed', null, true]);
  assert.deepEqual([c('Refunded').code, c('Refunded').snapshot], ['refunded', 'refunded']);
  // ('Awaiting Redirect' / 'Created but not paid' are Paynow SDK words for an unpaid request: pinned as pending below)
  for (const odd of ['PAID!', 'Paid out', '', null, 'Ok', 'NotFound', 'Error']) {
    assert.deepEqual([c(odd).code, c(odd).snapshot], ['unrecognized', null], String(odd));
  }
  assert.equal(c('awaiting delivery').code, 'awaiting_delivery', 'case and spacing as Paynow sends them (Awaiting+Delivery)');
  assert.equal(c(' Paid ').code, 'paid');
});

test('amounts: two-decimal major units out; strict two-decimal parse in; only two-decimal currencies', () => {
  assert.equal(formatPaynowAmount(2500, 'USD'), '25.00');
  assert.equal(formatPaynowAmount(1, 'ZWG'), '0.01');
  assert.equal(formatPaynowAmount(123456789, 'USD'), '1234567.89');
  assert.throws(() => formatPaynowAmount(100, 'JPY'), /PAY05_CURRENCY_NOT_SUPPORTED/);
  assert.throws(() => formatPaynowAmount(100, 'ZIG'), /PAY05_CURRENCY_NOT_SUPPORTED/, 'ZIG is not an ISO 4217 code');
  assert.throws(() => formatPaynowAmount(0, 'USD'), /PAY05_AMOUNT_INVALID/);
  assert.throws(() => formatPaynowAmount(1.5, 'USD'), /PAY05_AMOUNT_INVALID/);
  assert.equal(parsePaynowAmountMinor('25.00'), 2500);
  assert.equal(parsePaynowAmountMinor('0.01'), 1);
  for (const bad of ['25', '25.0', '25.001', '-1.00', '1,00', '$1.00', '1e2', '', null, ' 1.00']) {
    assert.equal(parsePaynowAmountMinor(bad), null, String(bad));
  }
});

test('outbound URL allowlist: https, exact Paynow host, default port, no credentials — anything else is refused', () => {
  const ok = 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=9f24be04-f4a6-4dff-8ab5-455263ba7b6b';
  assert.equal(assertProviderUrl(ok, REAL), ok);
  for (const bad of [
    'http://www.paynow.co.zw/Interface/CheckPayment/?guid=x',                 // not https
    'https://www.paynow.co.zw:7106/Interface/CheckPayment/?guid=x',           // non-default port (a published example!)
    'https://staging.paynow.co.zw/Interface/CheckPayment/?guid=x',            // another host (a published example!)
    'https://www.paynow.co.zw.evil.example/Interface/CheckPayment/',          // suffix attack
    'https://evil.example/?u=https://www.paynow.co.zw/',                      // host elsewhere
    'https://user:pw@www.paynow.co.zw/Interface/CheckPayment/',               // credentials
    'https://169.254.169.254/latest/meta-data/',                              // cloud metadata
    'https://127.0.0.1/Interface/CheckPayment/',                              // loopback
    'file:///etc/passwd', 'javascript:alert(1)', '', null, 'not a url',
  ]) {
    assert.throws(() => assertProviderUrl(bad, REAL), /PAY05_PROVIDER_URL_REFUSED/, String(bad));
  }
  // The local protocol simulator is a separately named origin, honoured only when explicitly configured.
  const sim = { origins: ['http://127.0.0.1:5061'] };
  assert.equal(assertProviderUrl('http://127.0.0.1:5061/Interface/CheckPayment/?guid=x', sim), 'http://127.0.0.1:5061/Interface/CheckPayment/?guid=x');
  assert.throws(() => assertProviderUrl('http://127.0.0.1:5062/Interface/CheckPayment/', sim), /PAY05_PROVIDER_URL_REFUSED/);
  assert.throws(() => assertProviderUrl(ok, sim), /PAY05_PROVIDER_URL_REFUSED/, 'a simulator runtime never calls the real Paynow');
  assert.ok(PAYNOW_ENDPOINTS.initiate === 'https://www.paynow.co.zw/interface/initiatetransaction');
  assert.ok(PAYNOW_ENDPOINTS.remote === 'https://www.paynow.co.zw/interface/remotetransaction');
  assert.ok(PAYNOW_ENDPOINTS.trace === 'https://www.paynow.co.zw/interface/trace');
});

test('identifiers: a poll URL maps to one stable opaque id; merchant traces are unique, ≤32 chars; event ids are content-addressed', () => {
  const poll = 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=9f24be04-f4a6-4dff-8ab5-455263ba7b6b';
  assert.match(pollIdFor(poll), /^pn_poll_[0-9a-f]{40}$/);
  assert.equal(pollIdFor(poll), pollIdFor(poll));
  assert.notEqual(pollIdFor(poll), pollIdFor(poll.replace('6b', '6c')));
  const traces = new Set(Array.from({ length: 500 }, () => newMerchantTrace()));
  assert.equal(traces.size, 500);
  for (const t of traces) assert.match(t, /^[A-Za-z0-9]{32}$/);
  const pairs = [['reference', 'pay04_gar_x'], ['status', 'Paid'], ['hash', 'AB']];
  assert.match(eventIdFor('c1', pairs, 'sent'), /^evt_pn_[0-9a-f]{40}$/);
  assert.equal(eventIdFor('c1', pairs, 'sent'), eventIdFor('c1', pairs, 'sent'), 'a resent status update is the same event');
  assert.notEqual(eventIdFor('c1', pairs, 'sent'), eventIdFor('c2', pairs, 'sent'), 'bound to its collection');
  assert.notEqual(eventIdFor('c1', pairs, 'sent'), eventIdFor('c1', [['reference', 'pay04_gar_x'], ['status', 'Disputed'], ['hash', 'AB']], 'sent'));
  // Paynow's messages carry no sequence: "Paid" after a dispute is byte-identical to the first "Paid". It is a NEW event
  // because CarUp's state changed in between — a content-only identity would silently drop it.
  assert.notEqual(eventIdFor('c1', pairs, 'sent'), eventIdFor('c1', pairs, 'disputed'));
});

test('Zimbabwe mobile numbers normalise to the 07XXXXXXXX form Paynow documents; anything else is refused', () => {
  assert.equal(normalizeZimbabweMobile('0771111111'), '0771111111');
  assert.equal(normalizeZimbabweMobile('+263 77 111 1111'), '0771111111');
  assert.equal(normalizeZimbabweMobile('263711234567'), '0711234567');
  for (const bad of ['077111111', '07711111111', '0871111111', '+27771111111', 'abc', '', null, '0701111111']) {
    assert.throws(() => normalizeZimbabweMobile(bad), /PAY05_PHONE_INVALID/, String(bad));
  }
});

// ── independent review P5 / P8 (2026-11-02) ──

test('values are trimmed before hashing, as Paynow\'s own example does: the published message EXACTLY as printed matches 2A033FC3…', () => {
  // generating_hash prints "returnurl= http://www.google.com/search?q=returnurl" (a leading space) and its C# example
  // trims every value: the published hash matches only the trimmed text
  const asPrinted = ['1201', 'TEST REF', '99.99', 'A test ticket transaction', ' http://www.google.com/search?q=returnurl',
    'http://www.google.com/search?q=resulturl', 'Message'];
  assert.equal(paynowHash(asPrinted, DOC_KEY),
    '2A033FC38798D913D42ECB786B9B19645ADEDBDE788862032F1BD82CF3B92DEF84F316385D5B40DBB35F1A4FD7D5BFE73835174136463CDD48C9366B0749C689');
});

test('signPairs sends exactly what it signs: trimmed values (a trailing space can never make Paynow refuse the hash)', () => {
  const signed = signPairs([['id', ' 1201 '], ['additionalinfo', 'Harare Auto ']], DOC_KEY);
  assert.deepEqual(signed.slice(0, 2), [['id', '1201'], ['additionalinfo', 'Harare Auto']]);
  assert.equal(verifyPairs(signed, DOC_KEY).valid, true);
});

test('statuses Paynow\'s SDK and plugins use for a request not yet paid are pending, never money', () => {
  for (const raw of ['Created but not paid', 'Awaiting Redirect', 'awaiting  redirect']) {
    const s = classifyPaynowStatus(raw);
    assert.deepEqual([s.code, s.snapshot, s.moneyReceived], ['created', 'pending', false], raw);
  }
});

test('an integration key is normalised the way Paynow renders a GUID (trimmed, lower-case); other keys only trimmed', () => {
  assert.equal(normalizeIntegrationKey('  3E9FED89-60E1-4CE5-AB6E-6B1EB2D4F977 '), DOC_KEY);
  assert.equal(normalizeIntegrationKey(' NotAGuid-Key_Keep-Case '), 'NotAGuid-Key_Keep-Case');
  assert.equal(normalizeIntegrationKey(undefined), '');
});

test('the payer e-mail Paynow takes for express checkout', () => {
  for (const ok of ['payer@example.co.zw', 'a.b+c@mail.example.com']) assert.equal(isPaynowAuthEmail(ok), true, ok);
  for (const bad of ['', 'payer', 'payer@host', 'pay er@example.com', 'p@xn--p1ai', `${'a'.repeat(65)}@example.com`]) {
    assert.equal(isPaynowAuthEmail(bad), false, bad);
  }
});
