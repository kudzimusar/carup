/**
 * CARUP-MVP-STAB-01 F-002 — a retried Marketplace inquiry is recorded ONCE.
 *
 * POST /api/marketplace/inquiries was not idempotent: every submit minted `randomUUID()`, so a double tap,
 * a flaky network or a client that re-sent a timed-out request recorded a second inquiry — and with it a
 * second canonical conversation event, a second referral lead, a second Intelligence observation and a
 * second referral event.
 *
 * A caller may now send `client_request_id` (or an `Idempotency-Key` header). The inquiry id becomes the
 * RFC 4122 v5 UUID of (actor, key), so a retry collides on the primary key and is answered with the inquiry
 * already recorded — 200 `{ inquiry, idempotent_replay: true }`, every side effect untouched. The same key
 * carrying a different listing, type or message is a 409 INQUIRY_IDEMPOTENCY_MISMATCH. Without a key the
 * behaviour is exactly what it was.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const express = (await import('express')).default;
const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { supabase } = await import('../db/supabase.js');
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const marketplaceRouter = (await import('../routes/marketplaceRoutes.js')).default;
const { ConflictError, ValidationError, DatabaseError } = await import('../utils/errors.js');
const {
  createInquiry,
  uuidV5,
  INQUIRY_IDEMPOTENCY_NAMESPACE,
  inquiryIdempotencyActorKey,
  deterministicInquiryId,
} = await import('../services/marketplace/marketplaceInquiryService.js');

const VIN = 'GFC27-027051';
const OTHER_VIN = 'JTDKARFP0H3000731';
const PUBLIC_KEYS = ['created_at', 'id', 'inquiry_type', 'listing_id', 'referral_attributed', 'source_channel', 'status'];
const ACTIVITY_TABLE = 'marketplace_activity_events';

function seedWorld() {
  return createSupabaseWorld({
    vehicles: [
      { vin: VIN, current_seller_id: 'seller-1', tenant_id: null, status: 'Available', publication_status: 'published' },
      { vin: OTHER_VIN, current_seller_id: 'seller-2', tenant_id: null, status: 'Available', publication_status: 'published' },
    ],
    users: [{ id: 'buyer-1', name: 'Rudo Banda', email: 'rudo@example.com', phone: '+263772000001' }],
    marketplace_inquiries: [],
  });
}

/**
 * The world does not enforce primary keys; marketplace_inquiries.id is one. A second insert of the same id
 * answers exactly what PostgREST answers for a duplicate primary key.
 */
function withInquiryPrimaryKey(world) {
  return {
    ...world.client,
    from(table) {
      const query = world.client.from(table);
      if (table !== 'marketplace_inquiries') return query;
      const insert = query.insert;
      query.insert = (payload) => {
        const rows = Array.isArray(payload) ? payload : [payload];
        const clash = rows.find((row) => row.id && world.rows(table).some((existing) => existing.id === row.id));
        if (!clash) return insert(payload);
        const failure = {
          data: null,
          error: {
            code: '23505',
            message: 'duplicate key value violates unique constraint "marketplace_inquiries_pkey"',
            details: `Key (id)=(${clash.id}) already exists.`,
          },
        };
        const chain = {
          select: () => chain,
          single: async () => failure,
          maybeSingle: async () => failure,
          then: (resolve, reject) => Promise.resolve(failure).then(resolve, reject),
        };
        return chain;
      };
      return query;
    },
  };
}

function sideEffects() {
  const calls = { events: [], leads: [], referralEvents: [] };
  return {
    calls,
    deps: {
      emitDomainEvent: async (_pgClient, eventType, payload, tenantId) => {
        calls.events.push({ eventType, payload, tenantId });
        return { id: `evt-${calls.events.length}`, event_type: eventType };
      },
      referralBridge: {
        bridgeInquiryToReferralLead: async ({ inquiry }) => {
          calls.leads.push(inquiry.id);
          return { bridged: true, lead_event_id: `lead-${inquiry.id}`, validation: null };
        },
        emitMarketplaceReferralEvent: async (args) => {
          calls.referralEvents.push(args);
          return { recorded: true, referral_attributed: Boolean(args.referralCode) };
        },
      },
    },
  };
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const activityWrites = (world) => world.writes.filter((write) => write.table === ACTIVITY_TABLE).length;

/** The Intelligence observation is fire-and-forget; wait until it lands (or give up and let the assertion say so). */
async function waitForActivityWrites(world, expected, timeoutMs = 3000) {
  const started = Date.now();
  while (activityWrites(world) < expected && Date.now() - started < timeoutMs) await sleep(5);
  return Date.now() - started;
}

const purchase = (overrides = {}) => ({
  inquiry_type: 'vehicle_purchase_interest',
  listing_id: VIN,
  message: 'Is the Serena still available?',
  ...overrides,
});

// ── The deterministic id ─────────────────────────────────────────────────────────────────────────────

test('uuidV5 is RFC 4122 v5: it reproduces the published reference vector', () => {
  // uuid.uuid5(uuid.NAMESPACE_DNS, 'python.org') — the example in the Python standard library documentation.
  assert.equal(uuidV5('python.org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'), '886313e1-3b8a-5372-9b90-0c9aee199e5d');
});

test('the inquiry id is the v5 UUID of (actor, client_request_id) in the fixed CarUp namespace', () => {
  assert.equal(INQUIRY_IDEMPOTENCY_NAMESPACE, 'fbe7f49d-9616-4066-98dd-ce0a630201a6');
  // Golden values computed independently with Python's uuid.uuid5 for this namespace.
  assert.equal(inquiryIdempotencyActorKey({ buyerId: 'buyer-1', guestEmail: 'ignored@example.com' }), 'user:buyer-1');
  assert.equal(deterministicInquiryId('user:buyer-1', 'retry-key-0001'), '61811882-1382-5379-8ef1-fb07d5c997cd');
  assert.equal(inquiryIdempotencyActorKey({ guestEmail: 'Buyer@Example.COM', guestPhone: '+263 77 123 4567' }), 'guest:buyer@example.com');
  assert.equal(deterministicInquiryId('guest:buyer@example.com', 'retry-key-0001'), '3b4ce1ff-4aae-531b-bf5e-6ef0f9e5b1d3');
  assert.equal(inquiryIdempotencyActorKey({ guestPhone: '+263 (77) 123-4567' }), 'guest:263771234567');
  assert.equal(deterministicInquiryId('guest:263771234567', 'retry-key-0002'), '36cb4110-b10b-5df3-bd3d-ecd3f58f7a7a');
});

// ── Replay ──────────────────────────────────────────────────────────────────────────────────────────

test('a signed-in buyer\'s retry returns the inquiry already recorded, and every side effect ran exactly once', async () => {
  const world = seedWorld();
  const client = withInquiryPrimaryKey(world);
  const { calls, deps } = sideEffects();
  const payload = purchase({ client_request_id: 'retry-key-0001', referral_code: 'CARUP-X' });

  const first = await createInquiry(client, payload, { id: 'buyer-1' }, deps);
  assert.equal(first.id, '61811882-1382-5379-8ef1-fb07d5c997cd', 'the id is derived from (actor, key)');
  assert.equal('idempotent_replay' in first, false, 'a new inquiry is reported exactly as before');
  const firstWriteTook = await waitForActivityWrites(world, 1);
  assert.equal(activityWrites(world), 1, 'the Intelligence observation of the new inquiry landed');

  const second = await createInquiry(client, payload, { id: 'buyer-1' }, deps);
  assert.equal(second.idempotent_replay, true);
  assert.equal(second.inquiry.id, first.id);
  assert.deepEqual(Object.keys(second.inquiry).sort(), PUBLIC_KEYS, 'a replay answers with the PUBLIC projection only');
  assert.equal(second.inquiry.referral_attributed, true);
  await sleep(Math.max(100, firstWriteTook * 5));

  assert.equal(world.rows('marketplace_inquiries').length, 1, 'one inquiry row');
  assert.equal(calls.events.filter((e) => e.eventType === 'marketplace.inquiry.created').length, 1, 'one canonical conversation event');
  assert.equal(calls.events.filter((e) => e.eventType === 'marketplace.inquiry.referral_bridge_requested').length, 1, 'one referral bridge request');
  assert.deepEqual(calls.leads, [first.id], 'one referral lead');
  assert.equal(calls.referralEvents.length, 1, 'one referral event');
  assert.equal(activityWrites(world), 1, 'one Intelligence observation');
});

test('a retry that changes the listing, the type or the message is refused 409 INQUIRY_IDEMPOTENCY_MISMATCH and records nothing', async () => {
  const world = seedWorld();
  const client = withInquiryPrimaryKey(world);
  const { calls, deps } = sideEffects();
  const original = purchase({ client_request_id: 'retry-key-0001' });
  await createInquiry(client, original, { id: 'buyer-1' }, deps);

  for (const changed of [
    { message: 'A different question' },
    { listing_id: OTHER_VIN },
    { inquiry_type: 'vehicle_inspection_request' },
  ]) {
    await assert.rejects(
      () => createInquiry(client, { ...original, ...changed }, { id: 'buyer-1' }, deps),
      (error) => {
        assert.ok(error instanceof ConflictError, 'a ConflictError');
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, 'INQUIRY_IDEMPOTENCY_MISMATCH', 'the specific code is the error\'s OWN code, not a detail');
        return true;
      },
      `changed ${Object.keys(changed)[0]}`,
    );
  }
  assert.equal(world.rows('marketplace_inquiries').length, 1);
  assert.equal(world.rows('marketplace_inquiries')[0].message, original.message, 'the recorded inquiry is untouched');
  assert.equal(calls.events.length, 1, 'no second event of any kind');
  assert.equal(calls.referralEvents.length, 1);
});

test('a guest retry is recognised by the lowercased email; another guest or a signed-in buyer with the same key is a different inquiry', async () => {
  const world = seedWorld();
  const client = withInquiryPrimaryKey(world);
  const { calls, deps } = sideEffects();
  const key = 'retry-key-0001';

  const guest = await createInquiry(client, purchase({ guest_email: 'Buyer@Example.COM', client_request_id: key }), null, deps);
  assert.equal(guest.id, '3b4ce1ff-4aae-531b-bf5e-6ef0f9e5b1d3');
  const retry = await createInquiry(client, purchase({ guest_email: 'buyer@example.com', client_request_id: key }), null, deps);
  assert.equal(retry.idempotent_replay, true, 'the same guest, whatever the case of the address');
  assert.equal(retry.inquiry.id, guest.id);

  const otherGuest = await createInquiry(client, purchase({ guest_email: 'other@example.com', client_request_id: key }), null, deps);
  const signedIn = await createInquiry(client, purchase({ client_request_id: key }), { id: 'buyer-1' }, deps);
  assert.equal('idempotent_replay' in otherGuest, false);
  assert.equal('idempotent_replay' in signedIn, false);
  assert.equal(new Set([guest.id, otherGuest.id, signedIn.id]).size, 3, 'the key is namespaced by its actor');
  assert.equal(world.rows('marketplace_inquiries').length, 3);
  assert.equal(calls.events.filter((e) => e.eventType === 'marketplace.inquiry.created').length, 3);
});

test('a phone-only guest is keyed by the digits of the phone, however it is formatted', async () => {
  const world = seedWorld();
  const client = withInquiryPrimaryKey(world);
  const { deps } = sideEffects();
  const first = await createInquiry(client, purchase({ guest_phone: '+263 77 123 4567', client_request_id: 'retry-key-0002' }), null, deps);
  assert.equal(first.id, '36cb4110-b10b-5df3-bd3d-ecd3f58f7a7a');
  const retry = await createInquiry(client, purchase({ guest_phone: '263 (77) 123-4567', client_request_id: 'retry-key-0002' }), null, deps);
  assert.equal(retry.idempotent_replay, true);
  assert.equal(retry.inquiry.id, first.id);
  assert.equal(world.rows('marketplace_inquiries').length, 1);
});

// ── Validation and the unchanged keyless path ─────────────────────────────────────────────────────────

test('an unusable client_request_id is refused 400 INQUIRY_CLIENT_REQUEST_ID_INVALID before anything is written', async () => {
  const world = seedWorld();
  const client = withInquiryPrimaryKey(world);
  const { calls, deps } = sideEffects();
  for (const bad of ['', 'short77', 'x'.repeat(101), 'has space key', 'semi;colon-key', 'ünïcode-key', 12345678, { id: 'x' }, ['retry-key-0001']]) {
    await assert.rejects(
      () => createInquiry(client, purchase({ client_request_id: bad }), { id: 'buyer-1' }, deps),
      (error) => {
        assert.ok(error instanceof ValidationError, `${JSON.stringify(bad)} is a ValidationError`);
        assert.equal(error.statusCode, 400);
        assert.equal(error.code, 'INQUIRY_CLIENT_REQUEST_ID_INVALID');
        return true;
      },
      JSON.stringify(bad),
    );
  }
  assert.equal(world.rows('marketplace_inquiries').length, 0);
  assert.equal(calls.events.length, 0);

  // The bounds themselves are accepted.
  const eight = await createInquiry(client, purchase({ client_request_id: 'abcd_-12' }), { id: 'buyer-1' }, deps);
  const hundred = await createInquiry(client, purchase({ client_request_id: 'k'.repeat(100) }), { id: 'buyer-1' }, deps);
  assert.notEqual(eight.id, hundred.id);
});

test('without a client_request_id nothing changes: every submit records a new inquiry under a random id', async () => {
  const world = seedWorld();
  const client = withInquiryPrimaryKey(world);
  const { calls, deps } = sideEffects();
  const a = await createInquiry(client, purchase(), { id: 'buyer-1' }, deps);
  const b = await createInquiry(client, purchase({ client_request_id: null }), { id: 'buyer-1' }, deps);
  const c = await createInquiry(client, purchase({ client_request_id: undefined }), { id: 'buyer-1' }, deps);
  assert.equal(new Set([a.id, b.id, c.id]).size, 3);
  for (const out of [a, b, c]) {
    assert.match(out.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'a random v4 id, as before');
    assert.deepEqual(Object.keys(out).sort(), [...PUBLIC_KEYS, 'referral_lead_event_id'].sort(), 'the response shape is unchanged');
  }
  assert.equal(world.rows('marketplace_inquiries').length, 3);
  assert.equal(calls.events.filter((e) => e.eventType === 'marketplace.inquiry.created').length, 3);
});

test('a unique violation that is not this key\'s replay remains a database failure', async () => {
  const failing = {
    from(table) {
      if (table === 'vehicles') {
        return { select: () => ({ eq: async () => ({ data: [{ vin: VIN, current_seller_id: 'seller-1', tenant_id: null }], error: null }) }) };
      }
      if (table === 'users') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      // Every insert collides, but no row with the derived id exists: some OTHER constraint fired.
      const chain = {
        insert: () => chain,
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "some_other_index"' } }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  };
  const { deps } = sideEffects();
  for (const payload of [purchase({ client_request_id: 'retry-key-0001' }), purchase()]) {
    await assert.rejects(
      () => createInquiry(failing, payload, { id: 'buyer-1' }, deps),
      (error) => error instanceof DatabaseError && error.statusCode === 500,
    );
  }
});

// ── The route ───────────────────────────────────────────────────────────────────────────────────────

const routeWorld = seedWorld();
const restoreWorld = installSupabaseWorld(supabase, routeWorld);
// The shipped route uses the shared client; it gets the same primary key the table has.
const routeClient = withInquiryPrimaryKey(routeWorld);
supabase.from = (table) => routeClient.from(table);
const app = express();
app.use(express.json());
app.use(marketplaceRouter);
app.use(errorHandler);
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
after(() => { server.close(); restoreWorld(); });

function post(body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path: '/api/marketplace/inquiries',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers },
    }, (res) => {
      let buf = '';
      res.on('data', (chunk) => { buf += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch { parsed = { _raw: buf }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const BYPASS = { 'x-bypass-rate-limit': 'true' };
const canonicalEventsFor = (id) => routeWorld.rows('domain_events')
  .filter((row) => row.event_type === 'marketplace.inquiry.created' && row.payload?.inquiryId === id);

test('the route answers 201 for a new keyed inquiry and 200 { inquiry, idempotent_replay } for its retry; the header and the body key are one key', async () => {
  const guest = { guest_email: 'route.buyer@example.com' };
  const created = await post(purchase(guest), { ...BYPASS, 'Idempotency-Key': 'route-key-0001' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = deterministicInquiryId('guest:route.buyer@example.com', 'route-key-0001');
  assert.equal(created.body.inquiry.id, id, 'the Idempotency-Key header reached the service');
  assert.equal('idempotent_replay' in created.body, false);

  const replay = await post(purchase({ ...guest, client_request_id: 'route-key-0001' }), BYPASS);
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.deepEqual(Object.keys(replay.body).sort(), ['idempotent_replay', 'inquiry']);
  assert.equal(replay.body.idempotent_replay, true);
  assert.equal(replay.body.inquiry.id, id);
  assert.equal(routeWorld.rows('marketplace_inquiries').filter((row) => row.id === id).length, 1);
  assert.equal(canonicalEventsFor(id).length, 1, 'the retry wrote no second outbox event');

  const disagree = await post(purchase({ ...guest, client_request_id: 'route-key-0001' }), { ...BYPASS, 'Idempotency-Key': 'route-key-0002' });
  assert.equal(disagree.status, 400);
  assert.equal(disagree.body.error.code, 'INQUIRY_CLIENT_REQUEST_ID_INVALID');

  const keyless = await post(purchase(guest), BYPASS);
  assert.equal(keyless.status, 201);
  assert.notEqual(keyless.body.inquiry.id, id);
  assert.equal('idempotent_replay' in keyless.body, false);
});

test('on a production-like runtime the client still receives the specific error codes (details are hidden there, codes are not)', async () => {
  const saved = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'preview';
  try {
    const guest = { guest_email: 'preview.buyer@example.com', client_request_id: 'preview-key-0001' };
    const first = await post(purchase(guest));
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const mismatch = await post(purchase({ ...guest, message: 'Something else entirely' }));
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.error.code, 'INQUIRY_IDEMPOTENCY_MISMATCH');
    assert.match(mismatch.body.error.message, /client_request_id/);
    assert.equal(mismatch.body.error.details, undefined, 'a production-like runtime hides details — the code must not live there');

    const invalid = await post(purchase({ ...guest, client_request_id: 'bad key!' }));
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'INQUIRY_CLIENT_REQUEST_ID_INVALID');
    assert.equal(invalid.body.error.details, undefined);
  } finally {
    if (saved === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = saved;
  }
});
