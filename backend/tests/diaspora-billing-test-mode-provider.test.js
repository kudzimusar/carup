/**
 * Provider TEST-MODE adapter — wire contract, provider neutrality, fail-closed posture (Issue #127, D).
 *
 * What makes these assertions worth writing: a sandbox test proves the entitlement flow, but it cannot
 * fail when the integration is wrong, because there is no integration. These tests assert the BYTES —
 * path, method, content type, auth header, body encoding, idempotency header, signature scheme — that
 * the adapter would put on the wire against a real provider. The transport is a recording fake, so the
 * suite is deterministic and offline; swap in the fetch transport and the same code talks to the
 * provider's sandbox unchanged.
 *
 * Provider neutrality is tested by driving TWO deliberately dissimilar wire contracts (JSON+bearer vs
 * form-encoded+body-credentials, HMAC-SHA256-over-timestamp.body vs SHA-512-over-concatenated-fields,
 * stable event ids vs NO event ids) through the SAME adapter and asserting one normalized result. A
 * neutrality claim tested against one provider is not tested at all.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_BILLING_WEBHOOK_SECRET = 'diaspora-billing-dev-webhook-secret';

const { TestModeBillingProvider } = await import('../services/diaspora/billing/testModeBillingProvider.js');
const { RecordingTransport, FetchBillingTransport, selectBillingTransport } = await import('../services/diaspora/billing/billingHttpTransport.js');
const { stripeProfile, paynowProfile, NORMALIZED_EVENTS, deriveEventId } = await import('../services/diaspora/billing/billingProviderProfiles.js');
const { selectBillingProvider, SandboxBillingProvider } = await import('../services/diaspora/billing/billingProvider.js');
const constants = await import('../constants/diaspora/diasporaBillingConstants.js');

const TENANT = '11111111-1111-1111-1111-111111111111';
const SECRET = 'diaspora-billing-dev-webhook-secret';
const API_BASE = 'https://provider-test.invalid';

const TEST_MODE = 'DIASPORA_BILLING_TEST_MODE';
const TEST_PROFILE = 'DIASPORA_BILLING_TEST_PROFILE';
const TEST_KEY = 'DIASPORA_BILLING_TEST_API_KEY';
const LIVE = 'DIASPORA_BILLING_LIVE';

afterEach(() => {
  delete process.env[TEST_MODE];
  delete process.env[TEST_PROFILE];
  delete process.env[TEST_KEY];
  delete process.env[LIVE];
});

// ── Fixtures: what each provider actually puts on the wire ──────────────────────────────────────

function stripeSubscriptionBody({ status = 'active', planKey = 'seller' } = {}) {
  return JSON.stringify({
    id: 'sub_test_1',
    object: 'subscription',
    customer: 'cus_test_1',
    status,
    current_period_start: 1780876800, // 2026-06-08T00:00:00Z
    current_period_end: 1783468800,
    cancel_at_period_end: false,
    trial_end: null,
    metadata: { tenantId: TENANT, planKey },
  });
}

function stripeTransport(extra = {}) {
  return new RecordingTransport({
    'POST /v1/checkout/sessions': {
      status: 200,
      body: JSON.stringify({
        id: 'cs_test_1', url: 'https://checkout.provider-test.invalid/c/cs_test_1',
        status: 'open', expires_at: 1780880400,
      }),
    },
    'POST /v1/billing_portal/sessions': {
      status: 200,
      body: JSON.stringify({ id: 'bps_test_1', url: 'https://billing.provider-test.invalid/p/bps_test_1' }),
    },
    'GET /v1/subscriptions/sub_test_1': { status: 200, body: stripeSubscriptionBody() },
    'POST /v1/subscriptions/sub_test_1': { status: 200, body: stripeSubscriptionBody({ planKey: 'trade_pro' }) },
    'GET /v1/invoices': {
      status: 200,
      body: JSON.stringify({ data: [{ id: 'in_1', status: 'paid', amount_due: 4900, currency: 'usd' }] }),
    },
    ...extra,
  });
}

function paynowTransport(extra = {}) {
  return new RecordingTransport({
    'POST /interface/initiatetransaction': {
      status: 200,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        status: 'Ok',
        browserurl: 'https://pay.provider-test.invalid/redirect/abc',
        pollurl: 'https://provider-test.invalid/interface/pollurl/abc',
      }).toString(),
    },
    'POST /interface/pollurl': {
      status: 200,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        reference: 'carup_checkout_abc',
        paynowreference: '1234567',
        amount: '49.00',
        status: 'Paid',
        pollurl: 'https://provider-test.invalid/interface/pollurl/abc',
      }).toString(),
    },
    ...extra,
  });
}

function stripeAdapter(transport = stripeTransport()) {
  return new TestModeBillingProvider({
    transport, profileKey: 'stripe', apiBase: API_BASE, apiKey: 'sk_test_fixture', webhookSecret: SECRET,
  });
}

function paynowAdapter(transport = paynowTransport()) {
  return new TestModeBillingProvider({
    transport, profileKey: 'paynow', apiBase: API_BASE, apiKey: 'test-integration-key', webhookSecret: SECRET,
  });
}

// ── The wire contract is genuinely exercised ────────────────────────────────────────────────────

test('checkout: the adapter sends a real provider-shaped POST (path, method, auth, encoding)', async () => {
  const transport = stripeTransport();
  const provider = stripeAdapter(transport);

  const session = await provider.createCheckoutSession({ tenantId: TENANT, planKey: 'seller' });

  const sent = transport.requestsFor('POST', '/v1/checkout/sessions');
  assert.equal(sent.length, 1, 'exactly one provider call');
  const req = sent[0];
  assert.equal(req.url, `${API_BASE}/v1/checkout/sessions`);
  assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(req.headers.authorization, 'Bearer sk_test_fixture');

  // The BODY is form-encoded with the provider's own field names — this is the assertion a sandbox
  // provider can never make, because a sandbox has no body.
  const body = new URLSearchParams(req.body);
  assert.equal(body.get('mode'), 'subscription');
  assert.equal(body.get('line_items[0][price]'), 'price_seller');
  assert.equal(body.get('client_reference_id'), TENANT);
  assert.equal(body.get('metadata[tenantId]'), TENANT);
  assert.equal(body.get('metadata[planKey]'), 'seller');

  // And the response is parsed into a CarUp-shaped object with no provider field names in it.
  assert.equal(session.sessionId, 'cs_test_1');
  assert.equal(session.url, 'https://checkout.provider-test.invalid/c/cs_test_1');
  assert.equal(session.live, false);
  assert.equal(session.tenantId, TENANT);
});

test('checkout: a mutating call carries a deterministic idempotency key header', async () => {
  const transport = stripeTransport();
  const provider = stripeAdapter(transport);

  await provider.createCheckoutSession({ tenantId: TENANT, planKey: 'seller' });
  await provider.createCheckoutSession({ tenantId: TENANT, planKey: 'seller' });

  const [a, b] = transport.requestsFor('POST', '/v1/checkout/sessions');
  assert.ok(a.headers['idempotency-key'], 'an idempotency key is sent');
  assert.equal(a.headers['idempotency-key'], b.headers['idempotency-key'],
    'the same (tenant, operation, plan) yields the same key, so a retry cannot double-charge');

  const other = await provider.createCheckoutSession({ tenantId: TENANT, planKey: 'trade_pro' });
  assert.ok(other.idempotencyKey !== a.headers['idempotency-key'], 'a different plan is a different key');
});

test('reads never carry an idempotency header (it would be meaningless and is not sent)', async () => {
  const transport = stripeTransport();
  const provider = stripeAdapter(transport);
  await provider.getSubscription({ tenantId: TENANT, subscriptionRef: 'sub_test_1' });
  const req = transport.requestsFor('GET', '/v1/subscriptions/sub_test_1')[0];
  assert.equal('idempotency-key' in req.headers, false);
});

test('subscription read normalizes provider status vocabulary into CarUp states', async () => {
  const provider = stripeAdapter(stripeTransport({
    'GET /v1/subscriptions/sub_test_1': { status: 200, body: stripeSubscriptionBody({ status: 'past_due' }) },
  }));
  const snapshot = await provider.getSubscription({ tenantId: TENANT, subscriptionRef: 'sub_test_1' });
  assert.equal(snapshot.status, 'past_due');
  assert.equal(snapshot.planKey, 'seller');
  assert.equal(snapshot.currentPeriodEnd, '2026-07-08T00:00:00.000Z');
  assert.equal(snapshot.live, false);
});

test('an UNKNOWN provider status maps to incomplete, never to an access-granting state', async () => {
  const provider = stripeAdapter(stripeTransport({
    'GET /v1/subscriptions/sub_test_1': {
      status: 200,
      body: stripeSubscriptionBody({ status: 'some_future_status_we_have_never_seen' }),
    },
  }));
  const snapshot = await provider.getSubscription({ tenantId: TENANT, subscriptionRef: 'sub_test_1' });
  // The dangerous default would be to pass the string through and let a truthy check grant access.
  assert.equal(snapshot.status, 'incomplete');
});

test('invoice amounts are normalized out of provider minor units', async () => {
  const provider = stripeAdapter();
  const invoice = await provider.getInvoiceState({ tenantId: TENANT, subscriptionRef: 'sub_test_1' });
  assert.equal(invoice.amountDue, 49);       // 4900 minor units
  assert.equal(invoice.currency, 'USD');
  assert.equal(invoice.status, 'paid');
});

test('a provider error status becomes a sanitized adapter error (no body echoed)', async () => {
  const provider = stripeAdapter(stripeTransport({
    'POST /v1/checkout/sessions': { status: 402, body: JSON.stringify({ error: { message: 'card declined for sk_test_fixture' } }) },
  }));
  await assert.rejects(
    () => provider.createCheckoutSession({ tenantId: TENANT, planKey: 'seller' }),
    (err) => {
      assert.equal(err.code, 'PROVIDER_REQUEST_REJECTED');
      assert.ok(!/sk_test/.test(err.message), 'the credential must not leak through an error message');
      return true;
    },
  );
});

test('a rate-limited provider is distinguishable from a rejection (retryable vs not)', async () => {
  const provider = stripeAdapter(stripeTransport({
    'POST /v1/checkout/sessions': { status: 429, body: '{}' },
  }));
  await assert.rejects(
    () => provider.createCheckoutSession({ tenantId: TENANT, planKey: 'seller' }),
    (err) => err.code === 'PROVIDER_RATE_LIMITED',
  );
});

// ── Signature verification against the RAW body ─────────────────────────────────────────────────

test('webhook: a correct signature over the RAW bytes verifies', async () => {
  const provider = stripeAdapter();
  const rawBody = JSON.stringify({
    id: 'evt_1',
    type: 'customer.subscription.updated',
    created: 1780876800,
    data: { object: { object: 'subscription', id: 'sub_test_1', customer: 'cus_test_1', status: 'active', metadata: { tenantId: TENANT, planKey: 'seller' } } },
  });
  const signature = provider.signPayload(rawBody, { timestampSeconds: Math.floor(Date.now() / 1000) });

  const result = await provider.verifyWebhook({ rawBody, signature });
  assert.equal(result.verified, true);
  assert.equal(result.eventId, 'evt_1');
  assert.equal(result.eventType, NORMALIZED_EVENTS.SUBSCRIPTION_UPDATED);
  assert.equal(result.normalized.tenantId, TENANT);
});

test('webhook: re-serializing the body breaks the signature — raw bytes are the contract', async () => {
  const provider = stripeAdapter();
  const payload = { id: 'evt_2', type: 'customer.subscription.updated', created: Math.floor(Date.now() / 1000), data: { object: {} } };
  const rawBody = JSON.stringify(payload);
  const signature = provider.signPayload(rawBody, { timestampSeconds: Math.floor(Date.now() / 1000) });

  // A re-serialization with a different key order is byte-different and MUST fail. If this ever passes,
  // something has started canonicalizing before verifying and the signature has stopped meaning anything.
  const reserialized = JSON.stringify({ type: payload.type, id: payload.id, created: payload.created, data: payload.data });
  assert.notEqual(reserialized, rawBody);
  const result = await provider.verifyWebhook({ rawBody: reserialized, signature });
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'SIGNATURE_MISMATCH');
});

test('webhook: a non-string rawBody is REFUSED rather than helpfully stringified', async () => {
  const provider = stripeAdapter();
  await assert.rejects(
    () => provider.verifyWebhook({ rawBody: { id: 'evt_3' }, signature: 'x' }),
    (err) => err.code === 'RAW_BODY_REQUIRED',
  );
});

test('webhook: a stale timestamp is rejected even with a valid HMAC (anti-replay)', async () => {
  const provider = stripeAdapter();
  const rawBody = JSON.stringify({ id: 'evt_4', type: 'customer.subscription.updated', data: { object: {} } });
  const stale = Math.floor(Date.now() / 1000) - 3600;
  const signature = provider.signPayload(rawBody, { timestampSeconds: stale });
  const result = await provider.verifyWebhook({ rawBody, signature });
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'TIMESTAMP_OUT_OF_TOLERANCE');
});

test('webhook: a malformed signature header is rejected without throwing', async () => {
  const provider = stripeAdapter();
  const result = await provider.verifyWebhook({ rawBody: '{}', signature: 'garbage' });
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'MALFORMED_SIGNATURE');
});

test('webhook: signature comparison length mismatch does not throw (timingSafeEqual guard)', async () => {
  const provider = stripeAdapter();
  const t = Math.floor(Date.now() / 1000);
  const result = await provider.verifyWebhook({ rawBody: '{}', signature: `t=${t},v1=abc` });
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'SIGNATURE_MISMATCH');
});

// ── Provider neutrality: a second, deliberately dissimilar wire contract ────────────────────────

test('neutrality: the SAME adapter speaks a form-encoded provider with body credentials', async () => {
  const transport = paynowTransport();
  const provider = paynowAdapter(transport);

  const session = await provider.createCheckoutSession({ tenantId: TENANT, planKey: 'seller', priceRef: '49.00' });

  const req = transport.requestsFor('POST', '/interface/initiatetransaction')[0];
  assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal('authorization' in req.headers, false, 'this rail carries credentials in the body, not a header');
  const body = new URLSearchParams(req.body);
  assert.equal(body.get('amount'), '49.00');
  assert.ok(body.get('hash'), 'the request body itself is hashed on this rail');

  // Same CarUp-shaped result as the other provider, despite nothing about the wire being alike.
  assert.equal(session.live, false);
  assert.equal(session.tenantId, TENANT);
  assert.equal(session.url, 'https://pay.provider-test.invalid/redirect/abc');
  assert.equal(session.sessionId, 'https://provider-test.invalid/interface/pollurl/abc');
});

test('neutrality: the second provider verifies a SHA-512 concatenated-field hash', async () => {
  const provider = paynowAdapter();
  const fields = {
    reference: 'carup_checkout_abc',
    paynowreference: '1234567',
    amount: '49.00',
    status: 'Paid',
    pollurl: 'https://provider-test.invalid/interface/pollurl/abc',
  };
  const rawBody = new URLSearchParams(fields).toString();
  const hash = provider.signPayload(rawBody);
  const signed = new URLSearchParams({ ...fields, hash }).toString();

  const result = await provider.verifyWebhook({ rawBody: signed });
  assert.equal(result.verified, true);
  assert.equal(result.eventType, NORMALIZED_EVENTS.PAYMENT_SUCCEEDED);
});

test('neutrality: a provider with NO event id gets a stable derived one (retries still de-duplicate)', async () => {
  const provider = paynowAdapter();
  const fields = {
    reference: 'carup_checkout_abc', paynowreference: '1234567', amount: '49.00',
    status: 'Paid', pollurl: 'https://provider-test.invalid/interface/pollurl/abc',
  };
  const rawBody = new URLSearchParams(fields).toString();
  const signed = new URLSearchParams({ ...fields, hash: provider.signPayload(rawBody) }).toString();

  const first = await provider.verifyWebhook({ rawBody: signed });
  const retry = await provider.verifyWebhook({ rawBody: signed });
  assert.equal(first.derivedEventId, true, 'the id was synthesised, not supplied');
  assert.equal(first.eventId, retry.eventId, 'a retry derives the SAME id, so the unique claim dedupes it');

  // A genuine state change must derive a DIFFERENT id, or every event after the first would be
  // swallowed as a duplicate — the failure mode a reference-only id would produce.
  const changed = { ...fields, status: 'Refunded' };
  const changedRaw = new URLSearchParams(changed).toString();
  const changedSigned = new URLSearchParams({ ...changed, hash: provider.signPayload(changedRaw) }).toString();
  const second = await provider.verifyWebhook({ rawBody: changedSigned });
  assert.notEqual(second.eventId, first.eventId);
  assert.equal(second.eventType, NORMALIZED_EVENTS.REFUND_ISSUED);
});

test('neutrality: a capability the provider genuinely lacks is refused honestly, not faked', async () => {
  const provider = paynowAdapter();
  await assert.rejects(
    () => provider.createPortalSession({ tenantId: TENANT }),
    (err) => {
      assert.equal(err.code, 'PROVIDER_CAPABILITY_UNSUPPORTED');
      return true;
    },
  );
});

test('neutrality: both profiles expose the same capability surface and normalized vocabulary', () => {
  const surface = [
    'buildCheckoutSession', 'parseCheckoutSession', 'buildPortalSession', 'parsePortalSession',
    'buildGetSubscription', 'buildCancelSubscription', 'buildChangePlan', 'buildGetInvoice',
    'parseInvoice', 'parseSubscription', 'verifySignature', 'signPayload', 'parseWebhookBody',
    'normalizeEvent', 'authHeaders',
  ];
  for (const method of surface) {
    assert.equal(typeof stripeProfile[method], 'function', `stripe profile implements ${method}`);
    assert.equal(typeof paynowProfile[method], 'function', `paynow profile implements ${method}`);
  }
  // Every normalized event a profile can emit must be in the shared vocabulary.
  const vocabulary = new Set(Object.values(NORMALIZED_EVENTS));
  for (const profile of [stripeProfile, paynowProfile]) {
    const emitted = profile.normalizeEvent({ type: 'nonsense', status: 'nonsense' }).eventType;
    assert.ok(vocabulary.has(emitted));
  }
});

test('neutrality: deriveEventId prefers a provider-supplied id when one exists', () => {
  const id = deriveEventId(stripeProfile, {}, { eventId: 'evt_supplied' });
  assert.equal(id, 'evt_supplied');
});

// ── Transport discipline ────────────────────────────────────────────────────────────────────────

test('transport: an unrouted call is a hard error, never a silent empty 200', async () => {
  const provider = stripeAdapter(new RecordingTransport({})); // no routes at all
  await assert.rejects(
    () => provider.createCheckoutSession({ tenantId: TENANT, planKey: 'seller' }),
    (err) => err.code === 'TRANSPORT_ROUTE_MISSING',
  );
});

test('transport: the real fetch transport REFUSES to be constructed under NODE_ENV=test', () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.throws(() => new FetchBillingTransport(), (err) => err.code === 'TRANSPORT_FORBIDDEN_IN_TEST');
});

test('transport: selection under NODE_ENV=test is offline even when the opt-in env is set', () => {
  process.env.DIASPORA_BILLING_TEST_HTTP = 'sandbox';
  try {
    const transport = selectBillingTransport();
    assert.ok(transport instanceof RecordingTransport, 'no configuration reaches a network under node --test');
  } finally {
    delete process.env.DIASPORA_BILLING_TEST_HTTP;
  }
});

test('transport: a route handler sees the request it was given (fixtures can assert and vary)', async () => {
  let seen = null;
  const transport = stripeTransport({
    'POST /v1/checkout/sessions': (req) => {
      seen = req;
      return { status: 200, body: JSON.stringify({ id: 'cs_dynamic', url: 'https://x.invalid/cs_dynamic' }) };
    },
  });
  const session = await stripeAdapter(transport).createCheckoutSession({ tenantId: TENANT, planKey: 'enterprise' });
  assert.equal(session.sessionId, 'cs_dynamic');
  assert.ok(seen.body.includes('price_enterprise'));
});

// ── Fail-closed posture ─────────────────────────────────────────────────────────────────────────

test('the approved-live-provider list is still empty (no live provider may be selected)', () => {
  assert.deepEqual([...constants.APPROVED_LIVE_PROVIDERS], []);
});

test('test mode and live mode are mutually exclusive and the conflict is loud', () => {
  process.env[TEST_MODE] = 'true';
  process.env[LIVE] = 'true';
  assert.throws(() => constants.assertBillingTestModeSafety(), /mutually exclusive/);
});

test('a test-mode credential that does not look like a test credential is refused', () => {
  process.env[TEST_KEY] = 'sk_live_realmerchantkey';
  assert.throws(() => constants.billingTestApiKey(), /does not look like a test credential/);
  process.env[TEST_KEY] = 'sk_test_fixture';
  assert.equal(constants.billingTestApiKey(), 'sk_test_fixture');
});

test('test mode is refused in production (a prod process must never reach a provider sandbox)', () => {
  process.env[TEST_MODE] = 'true';
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => constants.assertBillingTestModeSafety(), /must not be enabled in production/);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('the factory returns the SANDBOX by default and the TEST-MODE adapter only when asked', () => {
  const byDefault = selectBillingProvider();
  assert.ok(byDefault instanceof SandboxBillingProvider);
  assert.equal(byDefault.name, 'sandbox');

  process.env[TEST_MODE] = 'true';
  process.env[TEST_PROFILE] = 'stripe';
  const testMode = selectBillingProvider({ billingTransport: stripeTransport() });
  assert.ok(testMode instanceof TestModeBillingProvider);
  assert.equal(testMode.name, 'stripe_test', 'the name marks it as non-live in every ledger row it writes');
});

test('an unknown profile key fails loud rather than silently defaulting to another signature scheme', () => {
  assert.throws(
    () => new TestModeBillingProvider({ transport: new RecordingTransport({}), profileKey: 'not-a-provider' }),
    /Unknown billing provider profile/,
  );
});

test('every adapter response carries live:false', async () => {
  const provider = stripeAdapter();
  const results = [
    await provider.createCheckoutSession({ tenantId: TENANT, planKey: 'seller' }),
    await provider.createPortalSession({ tenantId: TENANT }),
    await provider.getSubscription({ tenantId: TENANT, subscriptionRef: 'sub_test_1' }),
    await provider.changePlan({ tenantId: TENANT, planKey: 'trade_pro', subscriptionRef: 'sub_test_1' }),
    await provider.getInvoiceState({ tenantId: TENANT, subscriptionRef: 'sub_test_1' }),
    await provider.syncSubscription({ tenantId: TENANT }),
  ];
  for (const r of results) assert.equal(r.live, false);
});

test('syncSubscription without a provider handle reports incomplete rather than inventing "active"', async () => {
  const snapshot = await stripeAdapter().syncSubscription({ tenantId: TENANT });
  assert.equal(snapshot.status, 'incomplete');
  assert.equal(snapshot.providerSubscriptionRef, null);
});

test('the sandbox provider exposes getSubscription and answers null for an unknown tenant', async () => {
  const sandbox = new SandboxBillingProvider();
  assert.equal(await sandbox.getSubscription({ tenantId: TENANT }), null);
  await sandbox.syncSubscription({ tenantId: TENANT, planKey: 'seller' });
  const snapshot = await sandbox.getSubscription({ tenantId: TENANT });
  assert.equal(snapshot.planKey, 'seller');
});

test('the signature scheme is per-profile: one provider cannot verify the other\'s signature', async () => {
  const stripe = stripeAdapter();
  const paynow = paynowAdapter();
  const rawBody = new URLSearchParams({ reference: 'r', paynowreference: 'p', amount: '1.00', status: 'Paid', pollurl: 'u' }).toString();
  const paynowHash = paynow.signPayload(rawBody);
  const crossResult = await stripe.verifyWebhook({ rawBody, signature: paynowHash });
  assert.equal(crossResult.verified, false);
});

test('the recording transport records requests even when the route throws', async () => {
  const transport = new RecordingTransport({
    'POST /v1/checkout/sessions': () => { throw new Error('boom'); },
  });
  await assert.rejects(() => stripeAdapter(transport).createCheckoutSession({ tenantId: TENANT, planKey: 'seller' }));
  assert.equal(transport.requestsFor('POST', '/v1/checkout/sessions').length, 1);
});

test('required inputs are validated before any wire call is made', async () => {
  const transport = stripeTransport();
  const provider = stripeAdapter(transport);
  await assert.rejects(() => provider.createCheckoutSession({ planKey: 'seller' }), /tenantId is required/);
  await assert.rejects(() => provider.createCheckoutSession({ tenantId: TENANT }), /planKey is required/);
  await assert.rejects(() => provider.getSubscription({ tenantId: TENANT }), /subscriptionRef is required/);
  assert.equal(transport.requests.length, 0, 'nothing reached the wire');
});

test('the HMAC helper matches an independently computed digest (no bespoke crypto)', () => {
  const rawBody = '{"a":1}';
  const t = 1780876800;
  const header = stripeProfile.signPayload({ rawBody, secret: SECRET, timestampSeconds: t });
  const expected = crypto.createHmac('sha256', SECRET).update(`${t}.${rawBody}`).digest('hex');
  assert.equal(header, `t=${t},v1=${expected}`);
});
