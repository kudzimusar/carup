/**
 * Phase 8 (M2) — entitlement ENFORCEMENT on real operations.
 *
 * Proves the flag-gated guard behaves correctly on the two wired domain actions:
 *   - stock PUBLISH  (publishSupplyDocument): require diaspora.stock.publish + reserve diaspora.stock.max_items
 *   - RFQ CREATE     (publishRfq):            require diaspora.rfq.create   + reserve diaspora.rfq.max_open
 *
 * Key invariants under test:
 *   - enforcement OFF  -> identical behavior to today (no denial, no quota meter row written);
 *   - enforcement ON   -> a free-plan tenant is denied with an explainable denial (requiredPlan, featureKey);
 *   - enforcement ON   -> quota reserved+committed on success; released (freed, not consumed) when the
 *                         domain op throws.
 *
 * Approach: the in-memory mock Supabase + the diaspora_reserve_usage_atomic JS reference (the mock
 * cannot run SQL). The plan catalog falls back to config (PLAN_CATALOG) when no diaspora_subscription_plans
 * row is seeded, so seeding a diaspora_subscriptions row with plan_key='seller' yields the seller plan's
 * entitlements (stock.publish=true, stock.max_items=250, rfq.create=false). For an RFQ-allowed tenant we
 * seed plan_key='diaspora_buyer' (rfq.create=true, rfq.max_open=10).
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const supply = await import('../services/diaspora/diasporaSupplyDocumentService.js');
const buyer = await import('../services/diaspora/diasporaBuyerOrderService.js');
const { FEATURE_KEYS } = await import('../constants/diaspora/diasporaEntitlements.js');

const ENFORCE = 'DIASPORA_SUBSCRIPTION_ENFORCEMENT';
function enforcement(on) {
  if (on) process.env[ENFORCE] = 'true';
  else delete process.env[ENFORCE];
}
afterEach(() => enforcement(false));

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

// A seller (tenant-admin) acting inside TENANT_A: owns rows by tenant, so stock/rfq ownership passes.
const sellerA = { id: 'seller-A', userId: 'seller-A', role: 'admin', platformRole: 'member', tenantRole: 'admin', tenantId: TENANT_A };
const buyerA = { id: 'buyer-A', userId: 'buyer-A', role: 'admin', platformRole: 'member', tenantRole: 'admin', tenantId: TENANT_A };

function clientWith(seed = {}) {
  return createMockSupabase({
    diaspora_supply_documents: [],
    diaspora_import_orders: [],
    diaspora_import_quotes: [],
    diaspora_import_audit_log: [],
    diaspora_subscriptions: [],
    diaspora_subscription_plans: [], // empty -> service falls back to PLAN_CATALOG config
    diaspora_usage_meters: [],
    diaspora_usage_reservations: [],
    ...seed,
  }, { rpc: DIASPORA_RPCS });
}

function seedSubscription(tenantId, planKey) {
  return { id: `sub-${planKey}-${tenantId}`, tenant_id: tenantId, plan_key: planKey, status: 'active', deleted_at: null, created_at: new Date(2026, 5, 1).toISOString() };
}

async function makePublishableDoc(client) {
  // origin_country is the publish-required field; create then it is publishable immediately.
  const doc = await supply.createSupplyDocument(
    { document_number: 'SD-ENF-1', title: 'Used parts', origin_country: 'Japan' },
    sellerA,
    { supabaseClient: client },
  );
  return doc;
}

async function makePublishableOrder(client) {
  const order = await buyer.createBuyerOrder(
    { order_type: 'parts', origin_country: 'Japan', destination_country: 'Zimbabwe' },
    buyerA,
    { supabaseClient: client },
  );
  return order;
}

// ── enforcement OFF: byte-identical to today (no denial, no quota write) ───────────────────────

test('OFF: free-plan tenant can still publish stock; no usage meter/reservation written', async () => {
  enforcement(false);
  const client = clientWith({ diaspora_subscriptions: [seedSubscription(TENANT_A, 'free')] });
  const doc = await makePublishableDoc(client);
  const published = await supply.publishSupplyDocument(doc.id, sellerA, { supabaseClient: client });
  assert.equal(published.status, 'PUBLISHED');
  assert.equal(published.publication_status, 'PUBLISHED');
  assert.equal(client._rows('diaspora_usage_meters').length, 0);
  assert.equal(client._rows('diaspora_usage_reservations').length, 0);
});

test('OFF: free-plan tenant can still publish an RFQ; no usage meter/reservation written', async () => {
  enforcement(false);
  const client = clientWith({ diaspora_subscriptions: [seedSubscription(TENANT_A, 'free')] });
  const order = await makePublishableOrder(client);
  const published = await buyer.publishRfq(order.id, buyerA, { supabaseClient: client });
  assert.equal(published.metadata.rfq.published, true);
  assert.equal(client._rows('diaspora_usage_meters').length, 0);
  assert.equal(client._rows('diaspora_usage_reservations').length, 0);
});

// ── enforcement ON: free-plan denied with explainable denial ───────────────────────────────────

test('ON: free-plan tenant denied stock publish with explainable denial (requiredPlan + featureKey)', async () => {
  enforcement(true);
  const client = clientWith({ diaspora_subscriptions: [seedSubscription(TENANT_A, 'free')] });
  const doc = await makePublishableDoc(client);
  await assert.rejects(
    () => supply.publishSupplyDocument(doc.id, sellerA, { supabaseClient: client }),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.ok(err.details, 'denial details present');
      assert.equal(err.details.featureKey, FEATURE_KEYS.STOCK_PUBLISH);
      assert.equal(err.details.requiredPlan, 'seller'); // lowest plan granting stock.publish
      assert.ok(/not (included|available)/i.test(err.details.message));
      return true;
    },
  );
  // Denied before any state change: doc stays DRAFT, no meter/reservation rows.
  const stored = client._rows('diaspora_supply_documents').find((d) => d.id === doc.id);
  assert.equal(stored.status, 'DRAFT');
  assert.equal(client._rows('diaspora_usage_meters').length, 0);
});

test('ON: free-plan tenant denied RFQ publish with explainable denial (requiredPlan + featureKey)', async () => {
  enforcement(true);
  const client = clientWith({ diaspora_subscriptions: [seedSubscription(TENANT_A, 'free')] });
  const order = await makePublishableOrder(client);
  await assert.rejects(
    () => buyer.publishRfq(order.id, buyerA, { supabaseClient: client }),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.equal(err.details.featureKey, FEATURE_KEYS.RFQ_CREATE);
      assert.equal(err.details.requiredPlan, 'diaspora_buyer'); // lowest plan granting rfq.create
      return true;
    },
  );
  const stored = client._rows('diaspora_import_orders').find((o) => o.id === order.id);
  assert.notEqual(stored.metadata?.rfq?.published, true);
});

// ── enforcement ON: allowed plan reserves + commits on success ────────────────────────────────

test('ON: seller-plan tenant publishes stock; quota reserved and COMMITTED on success', async () => {
  enforcement(true);
  const client = clientWith({ diaspora_subscriptions: [seedSubscription(TENANT_A, 'seller')] });
  const doc = await makePublishableDoc(client);
  const published = await supply.publishSupplyDocument(doc.id, sellerA, { supabaseClient: client });
  assert.equal(published.status, 'PUBLISHED');

  const reservations = client._rows('diaspora_usage_reservations');
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].feature_key, FEATURE_KEYS.STOCK_MAX_ITEMS);
  assert.equal(reservations[0].status, 'COMMITTED'); // committed on success
  const meters = client._rows('diaspora_usage_meters');
  assert.equal(meters.length, 1);
  assert.equal(Number(meters[0].used_count), 1); // one slot consumed
});

test('ON: buyer-plan tenant publishes RFQ; quota reserved and COMMITTED on success', async () => {
  enforcement(true);
  const client = clientWith({ diaspora_subscriptions: [seedSubscription(TENANT_A, 'diaspora_buyer')] });
  const order = await makePublishableOrder(client);
  const published = await buyer.publishRfq(order.id, buyerA, { supabaseClient: client });
  assert.equal(published.metadata.rfq.published, true);

  const reservations = client._rows('diaspora_usage_reservations');
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].feature_key, FEATURE_KEYS.RFQ_MAX_OPEN);
  assert.equal(reservations[0].status, 'COMMITTED');
});

// ── enforcement ON: a failing domain op RELEASES the reserved quota (not permanently consumed) ──

test('ON: when the publish DB write fails, the reserved slot is RELEASED (freed), not consumed', async () => {
  enforcement(true);
  const client = clientWith({ diaspora_subscriptions: [seedSubscription(TENANT_A, 'seller')] });
  const doc = await makePublishableDoc(client);

  // Force the domain update to FAIL after the quota reservation: replace the publish UPDATE's terminal
  // with a thenable that resolves to a DB error, so publishSupplyDocument throws inside withEntitlement
  // and the guard's release() path runs. The error-returning builder is a fully self-contained thenable
  // (no partial .then patching) so the event loop never hangs.
  const realFrom = client.from.bind(client);
  let failOnce = true;
  const erroringChain = () => {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      single() { return chain; },
      maybeSingle() { return chain; },
      then(resolve) { return Promise.resolve({ data: null, error: { message: 'simulated publish write failure' } }).then(resolve); },
    };
    return chain;
  };
  client.from = (table) => {
    const builder = realFrom(table);
    if (table === 'diaspora_supply_documents') {
      const origUpdate = builder.update.bind(builder);
      builder.update = (payload) => {
        if (payload && payload.status === 'PUBLISHED' && failOnce) {
          failOnce = false;
          return erroringChain();
        }
        return origUpdate(payload);
      };
    }
    return builder;
  };

  await assert.rejects(
    () => supply.publishSupplyDocument(doc.id, sellerA, { supabaseClient: client }),
    /Failed to publish supply document|simulated/i,
  );
  client.from = realFrom;

  const reservations = client._rows('diaspora_usage_reservations');
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].status, 'RELEASED'); // freed on failure
  const meters = client._rows('diaspora_usage_meters');
  // The meter was decremented back to 0 by releaseUsage -> the slot is NOT permanently consumed.
  assert.equal(Number(meters[0].used_count), 0);
});

// ── enforcement ON: replay of an already-published action does not double-consume ──────────────

test('ON: re-publishing an already-open RFQ is idempotent and does not reserve a second slot', async () => {
  enforcement(true);
  const client = clientWith({ diaspora_subscriptions: [seedSubscription(TENANT_A, 'diaspora_buyer')] });
  const order = await makePublishableOrder(client);
  await buyer.publishRfq(order.id, buyerA, { supabaseClient: client });
  await buyer.publishRfq(order.id, buyerA, { supabaseClient: client }); // idempotent early-return
  const reservations = client._rows('diaspora_usage_reservations');
  assert.equal(reservations.length, 1); // exactly one slot, not two
});
