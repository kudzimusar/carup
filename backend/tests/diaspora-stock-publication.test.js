/**
 * Stock publication lifecycle tests — publish/unpublish state machine, required-field and ledger
 * gates, ownership/tenant/role authorization, idempotency, audit, and demand/supply matching
 * integration. Service-level tests with an in-memory mock Supabase client.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const stock = await import('../services/diaspora/diasporaStockService.js');
const supply = await import('../services/diaspora/diasporaSupplyDocumentService.js');
const buyer = await import('../services/diaspora/diasporaBuyerOrderService.js');

const seller = { id: 'seller-1', userId: 'seller-1', role: 'dealer', platformRole: 'dealer', tenantId: null };
const otherSeller = { id: 'seller-2', userId: 'seller-2', role: 'dealer', platformRole: 'dealer', tenantId: null };
const reviewer = { id: 'rev-1', userId: 'rev-1', role: 'reviewer', platformRole: 'reviewer', tenantId: null };
const buyerCtx = { id: 'buyer-1', userId: 'buyer-1', role: 'owner', platformRole: 'owner', tenantId: null };

function freshClient() {
  return createMockSupabase(
    {
      diaspora_stock_items: [],
      diaspora_stock_ledger: [],
      diaspora_supply_documents: [],
      diaspora_import_orders: [],
      diaspora_import_audit_log: [],
    },
    { rpc: DIASPORA_RPCS },
  );
}

/** A stock item that satisfies every publication gate (fields + available quantity). */
async function createPublishableItem(client, ctx = seller, overrides = {}) {
  return stock.createStockItem(
    {
      part_name: 'Camry front bumper',
      vehicle_make: 'Toyota',
      vehicle_model: 'Camry',
      condition: 'USED',
      unit_price: 150,
      currency: 'USD',
      initial_quantity: 5,
      ...overrides,
    },
    ctx,
    { supabaseClient: client },
  );
}

// 1. Happy path: the creating seller publishes a complete, in-stock item.
test('seller publishes their own valid supply', async () => {
  const client = freshClient();
  const item = await createPublishableItem(client);
  assert.equal(item.publication_status, 'PRIVATE'); // created private, no bypass on create

  const published = await stock.publishStockItem(item.id, {}, seller, { supabaseClient: client });
  assert.equal(published.publication_status, 'PUBLISHED');
  assert.equal(published.idempotentReplay, false);
  const stored = client._rows('diaspora_stock_items').find((r) => r.id === item.id);
  assert.equal(stored.publication_status, 'PUBLISHED');
  // Quantities untouched by publication.
  assert.equal(Number(stored.quantity_on_hand), 5);
  assert.equal(Number(stored.quantity_reserved), 0);
});

// 2. Ownership: another seller cannot publish someone else's supply.
test('a seller cannot publish another seller supply', async () => {
  const client = freshClient();
  const item = await createPublishableItem(client);
  await assert.rejects(
    () => stock.publishStockItem(item.id, {}, otherSeller, { supabaseClient: client }),
    /access/i,
  );
  assert.equal(client._rows('diaspora_stock_items')[0].publication_status, 'PRIVATE');
});

// 3. Tenant isolation: an actor in tenant-B cannot publish tenant-A stock — even the original
//    creator once their context belongs to a different tenant.
test('cross-tenant publication is denied', async () => {
  const client = freshClient();
  const tenantSeller = { ...seller, tenantId: 'tenant-A' };
  const item = await createPublishableItem(client, tenantSeller);
  assert.equal(item.tenant_id, 'tenant-A');

  const intruder = { id: 'intruder-1', userId: 'intruder-1', role: 'dealer', platformRole: 'dealer', tenantId: 'tenant-B' };
  await assert.rejects(
    () => stock.publishStockItem(item.id, {}, intruder, { supabaseClient: client }),
    /access/i,
  );

  // Creator whose server-resolved tenant no longer matches the item's tenant is also denied.
  const driftedCreator = { ...seller, tenantId: 'tenant-B' };
  await assert.rejects(
    () => stock.publishStockItem(item.id, {}, driftedCreator, { supabaseClient: client }),
    /access/i,
  );

  assert.equal(client._rows('diaspora_stock_items')[0].publication_status, 'PRIVATE');
});

// 4. Roles come from the server context: a client-tampered `role` grants nothing; a genuine
//    platformRole reviewer may publish.
test('spoofed client role cannot publish; genuine reviewer can', async () => {
  const client = freshClient();
  const item = await createPublishableItem(client);

  // Ordinary buyer with a client-side tampered role: platformRole (server-derived) stays 'owner'.
  const spoofed = { id: 'buyer-1', userId: 'buyer-1', role: 'platform_admin', platformRole: 'owner', tenantId: null };
  await assert.rejects(
    () => stock.publishStockItem(item.id, {}, spoofed, { supabaseClient: client }),
    /access/i,
  );
  assert.equal(client._rows('diaspora_stock_items')[0].publication_status, 'PRIVATE');

  // A real reviewer (server-derived platformRole) is a privileged publisher.
  const published = await stock.publishStockItem(item.id, {}, reviewer, { supabaseClient: client });
  assert.equal(published.publication_status, 'PUBLISHED');
});

// 5. Publication gates: required fields and ledger availability.
test('incomplete or unavailable supply cannot be published', async () => {
  const client = freshClient();

  // Missing price and every compatibility field.
  const bare = await stock.createStockItem({ part_name: 'Bare part', initial_quantity: 3 }, seller, { supabaseClient: client });
  await assert.rejects(
    () => stock.publishStockItem(bare.id, {}, seller, { supabaseClient: client }),
    (err) => {
      assert.match(err.message, /missing required fields/i);
      assert.match(err.message, /unit_price/);
      assert.match(err.message, /vehicle_make\/part_number\/oem_number/);
      return true;
    },
  );

  // Missing condition (seeded raw — createStockItem defaults it, the gate must still hold).
  client._rows('diaspora_stock_items').push({
    id: 'raw-1', part_name: 'Raw part', condition: null, unit_price: 50, currency: 'USD',
    vehicle_make: 'Toyota', quantity_on_hand: 4, quantity_reserved: 0,
    publication_status: 'PRIVATE', created_by: 'seller-1', updated_by: 'seller-1', tenant_id: null,
  });
  await assert.rejects(
    () => stock.publishStockItem('raw-1', {}, seller, { supabaseClient: client }),
    /missing required fields.*condition/i,
  );

  // Zero on-hand quantity.
  const empty = await createPublishableItem(client, seller, { initial_quantity: 0 });
  await assert.rejects(
    () => stock.publishStockItem(empty.id, {}, seller, { supabaseClient: client }),
    /zero available/i,
  );

  // Fully reserved: on_hand - reserved must stay > 0 (read from the row, not client input).
  const reservedOut = await createPublishableItem(client, seller, { initial_quantity: 2 });
  await stock.reserveStock(reservedOut.id, { quantity: 2 }, seller, { supabaseClient: client });
  await assert.rejects(
    () => stock.publishStockItem(reservedOut.id, {}, seller, { supabaseClient: client }),
    /zero available/i,
  );
});

// 6. The PATCH path still cannot overwrite server-owned columns.
test('direct overwrite of quantity and publication_status stays blocked on update', async () => {
  const client = freshClient();
  const item = await createPublishableItem(client);
  await assert.rejects(
    () => stock.updateStockItem(item.id, { quantity_on_hand: 999 }, seller, { supabaseClient: client }),
    /cannot be set directly/i,
  );
  await assert.rejects(
    () => stock.updateStockItem(item.id, { publication_status: 'PUBLISHED' }, seller, { supabaseClient: client }),
    /publication_status is protected/i,
  );
  const stored = client._rows('diaspora_stock_items').find((r) => r.id === item.id);
  assert.equal(stored.publication_status, 'PRIVATE');
  assert.equal(Number(stored.quantity_on_hand), 5);
});

// 7. Published supply becomes visible to demand/supply matching.
test('published supply enters matching for a buyer order', async () => {
  const client = freshClient();
  const order = await buyer.createBuyerOrder(
    { order_type: 'parts', origin_country: 'Japan', requested_make: 'Toyota', requested_model: 'Camry' },
    buyerCtx,
    { supabaseClient: client },
  );
  const item = await createPublishableItem(client);
  await stock.publishStockItem(item.id, {}, seller, { supabaseClient: client });

  const matches = await buyer.getOrderMatches(order.id, buyerCtx, { supabaseClient: client });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].stockItemId, item.id);
  assert.ok(matches[0].reasons.some((r) => /Make matches/i.test(r)));
  assert.ok(matches[0].score > 0);
});

// 8. Private supply is invisible to matching.
test('private supply does not enter matching', async () => {
  const client = freshClient();
  const order = await buyer.createBuyerOrder(
    { order_type: 'parts', origin_country: 'Japan', requested_make: 'Toyota', requested_model: 'Camry' },
    buyerCtx,
    { supabaseClient: client },
  );
  await createPublishableItem(client); // never published
  const matches = await buyer.getOrderMatches(order.id, buyerCtx, { supabaseClient: client });
  assert.equal(matches.length, 0);
});

// 9. Idempotency: re-publishing replays without error and without a duplicate audit row.
test('duplicate publication is idempotent with a single audit row', async () => {
  const client = freshClient();
  const item = await createPublishableItem(client);
  const first = await stock.publishStockItem(item.id, {}, seller, { supabaseClient: client });
  assert.equal(first.idempotentReplay, false);
  const replay = await stock.publishStockItem(item.id, {}, seller, { supabaseClient: client });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.publication_status, 'PUBLISHED');
  const publishAudits = client._rows('diaspora_import_audit_log').filter((a) => a.action === 'STOCK_ITEM_PUBLISHED');
  assert.equal(publishAudits.length, 1);
});

// 10. Unpublish removes supply from matching; the state machine allows re-publication.
test('unpublish removes supply from matching', async () => {
  const client = freshClient();
  const order = await buyer.createBuyerOrder(
    { order_type: 'parts', origin_country: 'Japan', requested_make: 'Toyota', requested_model: 'Camry' },
    buyerCtx,
    { supabaseClient: client },
  );
  const item = await createPublishableItem(client);

  // A PRIVATE (never published) item cannot be unpublished — invalid transition.
  await assert.rejects(
    () => stock.unpublishStockItem(item.id, {}, seller, { supabaseClient: client }),
    /Cannot transition/i,
  );

  await stock.publishStockItem(item.id, {}, seller, { supabaseClient: client });
  assert.equal((await buyer.getOrderMatches(order.id, buyerCtx, { supabaseClient: client })).length, 1);

  const unpublished = await stock.unpublishStockItem(item.id, {}, seller, { supabaseClient: client });
  assert.equal(unpublished.publication_status, 'UNPUBLISHED');
  assert.equal((await buyer.getOrderMatches(order.id, buyerCtx, { supabaseClient: client })).length, 0);
  assert.ok(client._rows('diaspora_import_audit_log').some((a) => a.action === 'STOCK_ITEM_UNPUBLISHED'));

  // Unpublish replay is idempotent.
  const replay = await stock.unpublishStockItem(item.id, {}, seller, { supabaseClient: client });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(client._rows('diaspora_import_audit_log').filter((a) => a.action === 'STOCK_ITEM_UNPUBLISHED').length, 1);

  // UNPUBLISHED -> PUBLISHED is allowed and restores matching visibility.
  await stock.publishStockItem(item.id, {}, seller, { supabaseClient: client });
  assert.equal((await buyer.getOrderMatches(order.id, buyerCtx, { supabaseClient: client })).length, 1);
});

// 11. Publication writes a sealed audit row that records the actor.
test('publish writes a STOCK_ITEM_PUBLISHED audit row with the actor', async () => {
  const client = freshClient();
  const item = await createPublishableItem(client);
  await stock.publishStockItem(item.id, {}, seller, { supabaseClient: client });

  const audit = client._rows('diaspora_import_audit_log').find((a) => a.action === 'STOCK_ITEM_PUBLISHED');
  assert.ok(audit, 'expected a STOCK_ITEM_PUBLISHED audit row');
  assert.equal(audit.actor_id, 'seller-1');
  assert.equal(audit.resource_type, 'diaspora_stock_item');
  assert.equal(audit.resource_id, item.id);
  assert.equal(audit.previous_state.publication_status, 'PRIVATE');
  assert.equal(audit.new_state.publication_status, 'PUBLISHED');
  assert.ok(typeof audit.cryptographic_seal === 'string' && audit.cryptographic_seal.length === 64);
});

// 12. Stock linked to a supply document may only go public once the document itself is published.
test('stock linked to an unpublished supply document cannot be published', async () => {
  const client = freshClient();
  const doc = await supply.createSupplyDocument(
    { document_number: 'SD-9', title: 'Japan parts consignment', origin_country: 'Japan' },
    seller,
    { supabaseClient: client },
  );
  const item = await createPublishableItem(client, seller, { supply_document_id: doc.id });

  await assert.rejects(
    () => stock.publishStockItem(item.id, {}, seller, { supabaseClient: client }),
    /supply document is DRAFT/i,
  );

  await supply.publishSupplyDocument(doc.id, seller, { supabaseClient: client });
  const published = await stock.publishStockItem(item.id, {}, seller, { supabaseClient: client });
  assert.equal(published.publication_status, 'PUBLISHED');
});
