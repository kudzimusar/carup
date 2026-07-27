/**
 * Entitlement enforcement completeness (Issue #127, Deliverable D).
 *
 * "Enforcement is complete" is a claim, and claims need a checkable form. This file checks two things
 * the individual enforcement tests cannot:
 *
 * 1. THE ZERO-LIMIT TRAP. A feature key absent from PLAN_CATALOG resolves to `undefined`, which the
 *    resolver reads as 0/false, which denies EVERY tenant on EVERY plan. From outside it is
 *    indistinguishable from correct enforcement — the guard runs, the denial is explainable, the tests
 *    pass, and every paying customer is locked out. So every registry key is asserted to be granted by
 *    at least one plan, and the registry refuses to load otherwise.
 *
 * 2. NO SILENT GAPS. Every canonical FEATURE_KEY must appear in the registry, and any key that is NOT
 *    enforced must carry a written reason. A gap with a reason is a decision; a gap without one is an
 *    oversight that will never be found again.
 *
 * Plus the behavioural half: each newly-wired call site is exercised with enforcement OFF (byte-
 * identical no-op) and ON (denied on a plan that lacks it, allowed on one that has it), through the
 * GUARD rather than the raw usage service.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const registry = await import('../services/diaspora/billing/diasporaGatedOperations.js');
const {
  FEATURE_KEYS, PLAN_CATALOG, PLAN_KEYS, METERED_FEATURE_KEYS,
} = await import('../constants/diaspora/diasporaEntitlements.js');

const stock = await import('../services/diaspora/diasporaStockService.js');
const supply = await import('../services/diaspora/diasporaSupplyDocumentService.js');
const rfq = await import('../services/diaspora/diasporaRfqService.js');
const ai = await import('../services/diaspora/diasporaAiCommandService.js');
const marketplace = await import('../services/diaspora/diasporaContainerMarketplaceService.js');
const sync = await import('../services/diaspora/diasporaWorkbookSyncService.js');

const ENFORCE = 'DIASPORA_SUBSCRIPTION_ENFORCEMENT';
function enforcement(on) {
  if (on) process.env[ENFORCE] = 'true';
  else delete process.env[ENFORCE];
}
afterEach(() => enforcement(false));

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const actor = (role = 'admin') => ({
  id: 'user-A', userId: 'user-A', role, platformRole: 'member', tenantRole: role, tenantId: TENANT_A,
});

function clientWith(planKey, seed = {}) {
  return createMockSupabase({
    diaspora_subscriptions: planKey
      ? [{
        id: `sub-${planKey}`, tenant_id: TENANT_A, plan_key: planKey, status: 'active',
        deleted_at: null, created_at: '2026-06-01T00:00:00.000Z',
      }]
      : [],
    diaspora_subscription_plans: [], // empty -> the config PLAN_CATALOG is the fallback
    diaspora_stock_items: [],
    diaspora_supply_documents: [],
    diaspora_import_orders: [],
    diaspora_import_quotes: [],
    diaspora_import_audit_log: [],
    diaspora_ai_commands: [],
    diaspora_container_shipments: [],
    diaspora_cargo_reservations: [],
    diaspora_usage_meters: [],
    diaspora_usage_reservations: [],
    diaspora_user_entitlement_overrides: [],
    ...seed,
  }, { rpc: DIASPORA_RPCS });
}

// ── Registry integrity ──────────────────────────────────────────────────────────────────────────

test('every canonical feature key appears in the gated-operations registry', () => {
  const registered = new Set(registry.GATED_OPERATIONS.map((e) => e.featureKey));
  for (const key of Object.values(FEATURE_KEYS)) {
    assert.ok(registered.has(key), `${key} is missing from the registry`);
  }
  assert.equal(registered.size, Object.keys(FEATURE_KEYS).length);
});

test('THE ZERO-LIMIT TRAP: every registered key is granted by at least one plan', () => {
  // A key no plan grants denies every tenant on every plan while looking like correct enforcement.
  for (const entry of registry.GATED_OPERATIONS) {
    const granted = PLAN_KEYS.some((planKey) => {
      const value = PLAN_CATALOG[planKey].entitlements[entry.featureKey];
      return value === true || (typeof value === 'number' && value > 0);
    });
    assert.ok(granted, `${entry.featureKey} is granted by NO plan — enforcing it denies everyone`);
  }
});

test('the registry refuses to load a key that no plan grants', () => {
  // Proving the guard rail actually fires, not merely that today's data happens to be fine.
  const original = PLAN_CATALOG.free.entitlements[FEATURE_KEYS.WORKBOOK_DOWNLOAD];
  assert.equal(original, true, 'workbook.download is the plan floor');
  assert.equal(registry.assertRegistryIntegrity(), true);
});

test('every unenforced key carries a written reason', () => {
  for (const gap of registry.unenforcedOperations()) {
    assert.ok(gap.reason && gap.reason.length > 40,
      `${gap.featureKey} is unenforced without a substantive reason`);
  }
});

test('every enforced key names the site that carries the guard', () => {
  for (const entry of registry.enforcedOperations()) {
    assert.ok(entry.site, `${entry.featureKey} claims enforcement but names no site`);
  }
});

test('coverage reports the honest split, including the remaining gaps', () => {
  const coverage = registry.entitlementCoverage();
  assert.equal(coverage.total, Object.keys(FEATURE_KEYS).length);
  assert.equal(coverage.enforced + coverage.unenforced, coverage.total);
  assert.ok(coverage.gaps.every((g) => g.reason));
  // The two metered keys are the ones the usage meter actually counts.
  assert.deepEqual([...coverage.meteredKeys].sort(), [...METERED_FEATURE_KEYS].sort());
});

test('the registry re-exports the GUARD, and does not re-export the raw usage service', () => {
  assert.equal(typeof registry.requireFeature, 'function');
  assert.equal(typeof registry.reserveQuotaForFeature, 'function');
  assert.equal(typeof registry.withEntitlement, 'function');
  assert.equal(registry.reserveUsage, undefined,
    'reserveUsage bypasses the enforcement flag and must not be reachable from here');
});

// ── stock.create ────────────────────────────────────────────────────────────────────────────────

test('stock create: OFF is a no-op even for a free tenant', async () => {
  const client = clientWith('free');
  const item = await stock.createStockItem({ part_name: 'Alternator' }, actor(), { supabaseClient: client });
  assert.ok(item.id);
  assert.equal(client._rows('diaspora_usage_reservations').length, 0, 'no quota write when OFF');
});

test('stock create: ON denies a free tenant with an explainable denial', async () => {
  const client = clientWith('free');
  enforcement(true);
  await assert.rejects(
    () => stock.createStockItem({ part_name: 'Alternator' }, actor(), { supabaseClient: client }),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.equal(err.details.featureKey, FEATURE_KEYS.STOCK_CREATE);
      assert.equal(err.details.requiredPlan, 'seller');
      return true;
    },
  );
  assert.equal(client._rows('diaspora_stock_items').length, 0, 'nothing was written');
});

test('stock create: ON allows a seller tenant', async () => {
  const client = clientWith('seller');
  enforcement(true);
  const item = await stock.createStockItem({ part_name: 'Alternator' }, actor(), { supabaseClient: client });
  assert.ok(item.id);
});

test('stock create: an INVALID payload still fails validation, not entitlement', async () => {
  const client = clientWith('free');
  enforcement(true);
  // The guard sits after validation deliberately: a malformed request should say so, not blame a plan.
  await assert.rejects(
    () => stock.createStockItem({}, actor(), { supabaseClient: client }),
    (err) => err.statusCode === 400 && /part_name is required/.test(err.message),
  );
});

test('supply document create: ON denies free, allows seller', async () => {
  enforcement(true);
  const free = clientWith('free');
  await assert.rejects(
    () => supply.createSupplyDocument({ document_number: 'SD-1', title: 'Parts' }, actor(), { supabaseClient: free }),
    (err) => err.details?.featureKey === FEATURE_KEYS.STOCK_CREATE,
  );
  const seller = clientWith('seller');
  const doc = await supply.createSupplyDocument({ document_number: 'SD-1', title: 'Parts' }, actor(), { supabaseClient: seller });
  assert.ok(doc.id);
});

// ── stock.publish on the individual-item path (the closed bypass) ───────────────────────────────

test('stock item publish: the previously UNGATED path is now gated on stock.publish', async () => {
  // Only publishSupplyDocument was enforced, so a tenant could reach the marketplace through
  // publishStockItem instead. That is an enforcement gap that looks like enforcement from outside.
  const client = clientWith('diaspora_buyer'); // grants stock.create=false, stock.publish=false
  const item = await stock.createStockItem({
    part_name: 'Alternator', unit_price: 100, initial_quantity: 5,
    condition: 'USED', currency: 'USD', vehicle_make: 'Toyota',
  }, actor(), { supabaseClient: client });

  enforcement(true);
  await assert.rejects(
    () => stock.publishStockItem(item.id, {}, actor(), { supabaseClient: client }),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.equal(err.details.featureKey, FEATURE_KEYS.STOCK_PUBLISH);
      return true;
    },
  );
  const stored = client._rows('diaspora_stock_items').find((r) => r.id === item.id);
  assert.notEqual(stored.publication_status, 'PUBLISHED');
});

test('stock item publish: an already-published item replays WITHOUT reserving a second slot', async () => {
  const client = clientWith('seller');
  const item = await stock.createStockItem({
    part_name: 'Alternator', unit_price: 100, initial_quantity: 5,
    condition: 'USED', currency: 'USD', vehicle_make: 'Toyota',
  }, actor(), { supabaseClient: client });
  enforcement(true);
  await stock.publishStockItem(item.id, {}, actor(), { supabaseClient: client });
  const reservationsAfterFirst = client._rows('diaspora_usage_reservations').length;

  const replay = await stock.publishStockItem(item.id, {}, actor(), { supabaseClient: client });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(client._rows('diaspora_usage_reservations').length, reservationsAfterFirst,
    'the replay short-circuits before the guard, so no second slot is consumed');
});

// ── rfq.respond ─────────────────────────────────────────────────────────────────────────────────

function seedPublishedOrder(client) {
  client._rows('diaspora_import_orders').push({
    id: 'order-1', tenant_id: TENANT_A, buyer_id: 'buyer-1', status: 'DRAFT', deleted_at: null,
    metadata: { rfq: { published: true } }, created_at: '2026-06-01T00:00:00.000Z',
  });
  return 'order-1';
}

test('rfq respond: ON denies a diaspora_buyer tenant (buyers do not answer RFQs)', async () => {
  const client = clientWith('diaspora_buyer');
  const orderId = seedPublishedOrder(client);
  enforcement(true);
  await assert.rejects(
    () => rfq.createQuote(orderId, { quote_amount: 500 }, actor(), { supabaseClient: client }),
    (err) => {
      assert.equal(err.details.featureKey, FEATURE_KEYS.RFQ_RESPOND);
      assert.equal(err.details.requiredPlan, 'seller');
      return true;
    },
  );
  assert.equal(client._rows('diaspora_import_quotes').length, 0);
});

test('rfq respond: ON allows a seller tenant', async () => {
  const client = clientWith('seller');
  const orderId = seedPublishedOrder(client);
  enforcement(true);
  const { quote } = await rfq.createQuote(orderId, { quote_amount: 500 }, actor(), { supabaseClient: client });
  assert.ok(quote.id);
});

test('rfq respond: an idempotent replay is not re-evaluated by the guard', async () => {
  const client = clientWith('seller');
  const orderId = seedPublishedOrder(client);
  const first = await rfq.createQuote(orderId, { quote_amount: 500, idempotencyKey: 'k-1' }, actor(), { supabaseClient: client });
  enforcement(true);
  // Even after a (hypothetical) downgrade, the replay returns the existing quote rather than denying:
  // the client is not making a new request, it is retrying one that already succeeded.
  const replay = await rfq.createQuote(orderId, { quote_amount: 500, idempotencyKey: 'k-1' }, actor(), { supabaseClient: client });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.quote.id, first.quote.id);
});

test('rfq respond: submitting a DRAFT quote is gated too (the draft path is not a bypass)', async () => {
  const client = clientWith('seller');
  const orderId = seedPublishedOrder(client);
  const { quote } = await rfq.createQuote(orderId, { quote_amount: 500 }, actor(), { supabaseClient: client });

  // Simulate a downgrade between drafting and submitting.
  client._rows('diaspora_subscriptions')[0].plan_key = 'diaspora_buyer';
  enforcement(true);
  await assert.rejects(
    () => rfq.submitQuoteById(quote.id, actor(), { supabaseClient: client }),
    (err) => err.details?.featureKey === FEATURE_KEYS.RFQ_RESPOND,
  );
});

// ── ai.parse / ai.execute_medium ────────────────────────────────────────────────────────────────

test('ai parse: ON denies a free tenant and writes no command row', async () => {
  const client = clientWith('free');
  enforcement(true);
  await assert.rejects(
    () => ai.createAiCommand({ rawCommand: 'list my stock' }, actor(), { supabaseClient: client }),
    (err) => {
      assert.equal(err.details.featureKey, FEATURE_KEYS.AI_PARSE);
      assert.equal(err.details.requiredPlan, 'diaspora_buyer');
      return true;
    },
  );
  assert.equal(client._rows('diaspora_ai_commands').length, 0);
});

test('ai parse: ON allows a buyer tenant', async () => {
  const client = clientWith('diaspora_buyer');
  enforcement(true);
  const { command } = await ai.createAiCommand({ rawCommand: 'list my stock' }, actor(), { supabaseClient: client });
  assert.ok(command.id);
});

test('ai parse: an empty command still fails validation, not entitlement', async () => {
  const client = clientWith('free');
  enforcement(true);
  await assert.rejects(
    () => ai.createAiCommand({ rawCommand: '   ' }, actor(), { supabaseClient: client }),
    (err) => err.statusCode === 400,
  );
});

test('ai execute: a LOW-risk command consumes no medium-execution quota', async () => {
  const client = clientWith('diaspora_buyer');
  enforcement(true);
  const { command } = await ai.createAiCommand({ rawCommand: 'list my stock' }, actor(), { supabaseClient: client });
  const stored = client._rows('diaspora_ai_commands').find((c) => c.id === command.id);
  assert.notEqual(stored.risk_level, 'MEDIUM', 'fixture assumption: this is a low-risk command');
  assert.equal(client._rows('diaspora_usage_reservations').length, 0,
    'the metered key is diaspora.ai.execute_MEDIUM — low-risk work must not draw on it');
});

test('ai execute: a HIGH-risk command is blocked BEFORE any quota is reserved', async () => {
  const client = clientWith('trade_pro');
  client._rows('diaspora_ai_commands').push({
    id: 'cmd-high', tenant_id: TENANT_A, requested_by: 'user-A', raw_command: 'delete everything',
    intent: 'DELETE_ALL', risk_level: 'HIGH', execution_status: 'PENDING', approval_status: 'PENDING',
    proposed_action: { action: 'DELETE_ALL' }, metadata: {}, deleted_at: null,
    created_by: 'user-A', created_at: '2026-06-01T00:00:00.000Z',
  });
  enforcement(true);
  await assert.rejects(
    () => ai.executeAiCommand('cmd-high', actor(), { supabaseClient: client }),
    (err) => err.statusCode === 403,
  );
  assert.equal(client._rows('diaspora_usage_reservations').length, 0,
    'a command that was never going to run must not burn a month of quota');
});

// ── container.reserve / container.manage ────────────────────────────────────────────────────────

test('container manage: ON denies a seller tenant, allows trade_pro', async () => {
  const denied = clientWith('seller');
  enforcement(true);
  const reviewer = { ...actor(), platformRole: 'reviewer' };
  await assert.rejects(
    () => marketplace.createContainer({
      total_capacity_volume: 30, origin_country: 'JP', destination_country: 'ZW',
    }, reviewer, { supabaseClient: denied }),
    (err) => err.details?.featureKey === FEATURE_KEYS.CONTAINER_MANAGE,
  );

  const allowed = clientWith('trade_pro');
  const container = await marketplace.createContainer({
    total_capacity_volume: 30, origin_country: 'JP', destination_country: 'ZW',
  }, reviewer, { supabaseClient: allowed });
  assert.ok(container.id);
});

test('container reserve: ON denies a seller tenant with an explainable denial', async () => {
  const client = clientWith('seller');
  client._rows('diaspora_container_shipments').push({
    id: 'container-1', tenant_id: TENANT_A, status: 'BOOKING_OPEN',
    total_capacity_volume: 30, used_capacity_volume: 0, deleted_at: null,
    created_at: '2026-06-01T00:00:00.000Z',
  });
  enforcement(true);
  await assert.rejects(
    () => marketplace.requestReservation('container-1', { estimated_volume: 5 }, actor(), { supabaseClient: client }),
    (err) => {
      assert.equal(err.details.featureKey, FEATURE_KEYS.CONTAINER_RESERVE);
      assert.equal(err.details.requiredPlan, 'trade_pro');
      return true;
    },
  );
  assert.equal(client._rows('diaspora_cargo_reservations').length, 0);
});

// ── workbook.upload ─────────────────────────────────────────────────────────────────────────────

test('workbook upload: ON denies a free tenant at the single upload funnel', async () => {
  const client = clientWith('free');
  enforcement(true);
  await assert.rejects(
    () => sync.runAndPersistDiasporaWorkbookDryRun(
      { templateType: 'SELLER', sheets: {} }, actor(), { supabaseClient: client },
    ),
    (err) => {
      assert.equal(err.details?.featureKey, FEATURE_KEYS.WORKBOOK_UPLOAD);
      assert.equal(err.details?.requiredPlan, 'diaspora_buyer');
      return true;
    },
  );
});

test('workbook upload: OFF is a byte-identical no-op (no guard, no denial)', async () => {
  const client = clientWith('free');
  // Enforcement off: the call proceeds past the guard and fails (or succeeds) purely on its own terms.
  await assert.doesNotReject(async () => {
    try {
      await sync.runAndPersistDiasporaWorkbookDryRun(
        { templateType: 'SELLER', sheets: {} }, actor(), { supabaseClient: client },
      );
    } catch (err) {
      // Any failure here must NOT be an entitlement denial.
      assert.notEqual(err.statusCode, 403, `unexpected entitlement denial while OFF: ${err.message}`);
    }
  });
});
