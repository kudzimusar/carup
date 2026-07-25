/**
 * Phase 3 backend tests — stock ledger integrity, idempotency, tenant isolation, supply-document
 * publication gating. Service-level tests with an in-memory mock Supabase client.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const stock = await import('../services/diaspora/diasporaStockService.js');
const ledger = await import('../services/diaspora/diasporaStockLedgerService.js');
const supply = await import('../services/diaspora/diasporaSupplyDocumentService.js');

const seller = { id: 'seller-1', userId: 'seller-1', role: 'dealer', platformRole: 'dealer', tenantId: null };
const otherSeller = { id: 'seller-2', userId: 'seller-2', role: 'dealer', platformRole: 'dealer', tenantId: null };
const reviewer = { id: 'rev-1', userId: 'rev-1', role: 'reviewer', platformRole: 'reviewer', tenantId: null };

function freshClient() {
  return createMockSupabase(
    { diaspora_stock_items: [], diaspora_stock_ledger: [], diaspora_supply_documents: [], diaspora_import_audit_log: [] },
    { rpc: DIASPORA_RPCS },
  );
}

test('seller can create draft stock and an opening balance seeds via the ledger', async () => {
  const client = freshClient();
  const item = await stock.createStockItem({ part_name: 'Brake pad', initial_quantity: 10 }, seller, { supabaseClient: client });
  assert.equal(item.part_name, 'Brake pad');
  assert.equal(Number(item.quantity_on_hand), 10);
  assert.equal(Number(item.quantity_reserved), 0);
  const rows = client._rows('diaspora_stock_ledger');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action_type, 'ADD');
  assert.equal(Number(rows[0].quantity_after), 10);
});

test('direct quantity overwrite is rejected on update', async () => {
  const client = freshClient();
  const item = await stock.createStockItem({ part_name: 'Filter' }, seller, { supabaseClient: client });
  await assert.rejects(
    () => stock.updateStockItem(item.id, { quantity_on_hand: 999 }, seller, { supabaseClient: client }),
    /cannot be set directly/i,
  );
});

test('ledger movements compute quantities and reservations correctly', async () => {
  const client = freshClient();
  const item = await stock.createStockItem({ part_name: 'Alternator', initial_quantity: 20 }, seller, { supabaseClient: client });
  await ledger.appendStockMovement(item.id, { action: 'RESERVE', quantity: 5 }, seller, { supabaseClient: client });
  let current = await stock.getStockItem(item.id, seller, { supabaseClient: client });
  assert.equal(current.balances.available, 15);
  assert.equal(current.balances.reserved, 5);
  await ledger.appendStockMovement(item.id, { action: 'RELEASE_RESERVATION', quantity: 2 }, seller, { supabaseClient: client });
  current = await stock.getStockItem(item.id, seller, { supabaseClient: client });
  assert.equal(current.balances.reserved, 3);
  assert.equal(current.balances.available, 17);
  await ledger.appendStockMovement(item.id, { action: 'REMOVE', quantity: 4 }, seller, { supabaseClient: client });
  current = await stock.getStockItem(item.id, seller, { supabaseClient: client });
  assert.equal(current.balances.onHand, 16);
  assert.equal(current.balances.available, 13);
});

test('reservation cannot exceed availability and removal cannot go negative', async () => {
  const client = freshClient();
  const item = await stock.createStockItem({ part_name: 'Gearbox', initial_quantity: 3 }, seller, { supabaseClient: client });
  await assert.rejects(() => stock.reserveStock(item.id, { quantity: 5 }, seller, { supabaseClient: client }), /exceeds available/i);
  await assert.rejects(() => ledger.appendStockMovement(item.id, { action: 'REMOVE', quantity: 10 }, seller, { supabaseClient: client }), /exceeds available/i);
});

test('release cannot exceed reserved', async () => {
  const client = freshClient();
  const item = await stock.createStockItem({ part_name: 'Clutch', initial_quantity: 5 }, seller, { supabaseClient: client });
  await assert.rejects(() => stock.releaseReservation(item.id, { quantity: 2 }, seller, { supabaseClient: client }), /exceeds reserved/i);
});

test('duplicate idempotency key does not double-apply a movement', async () => {
  const client = freshClient();
  const item = await stock.createStockItem({ part_name: 'Shock', initial_quantity: 10 }, seller, { supabaseClient: client });
  const first = await ledger.appendStockMovement(item.id, { action: 'RESERVE', quantity: 4, idempotencyKey: 'k-1' }, seller, { supabaseClient: client });
  const replay = await ledger.appendStockMovement(item.id, { action: 'RESERVE', quantity: 4, idempotencyKey: 'k-1' }, seller, { supabaseClient: client });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(first.ledgerEntry.id, replay.ledgerEntry.id);
  const current = await stock.getStockItem(item.id, seller, { supabaseClient: client });
  assert.equal(current.balances.reserved, 4); // applied once, not twice
});

test('ADJUST_WITH_APPROVAL requires approval metadata and reviewer role', async () => {
  const client = freshClient();
  const item = await stock.createStockItem({ part_name: 'Mirror', initial_quantity: 5 }, seller, { supabaseClient: client });
  await assert.rejects(
    () => ledger.appendStockMovement(item.id, { action: 'ADJUST_WITH_APPROVAL', quantity: -2 }, reviewer, { supabaseClient: client }),
    /requires approval/i,
  );
  // seller cannot adjust even with approval block — needs reviewer/admin
  await assert.rejects(
    () => ledger.appendStockMovement(item.id, { action: 'ADJUST_WITH_APPROVAL', quantity: -2, approval: { approvedBy: 'rev-1' } }, seller, { supabaseClient: client }),
    /reviewer or admin/i,
  );
  const ok = await ledger.appendStockMovement(item.id, { action: 'ADJUST_WITH_APPROVAL', quantity: -2, approval: { approvedBy: 'rev-1' } }, reviewer, { supabaseClient: client });
  assert.equal(Number(ok.stockItem.quantity_on_hand), 3);
});

test('a seller cannot access another seller stock item', async () => {
  const client = freshClient();
  const item = await stock.createStockItem({ part_name: 'Belt', initial_quantity: 1 }, seller, { supabaseClient: client });
  await assert.rejects(() => stock.getStockItem(item.id, otherSeller, { supabaseClient: client }), /access/i);
});

test('list is scoped to the seller own items', async () => {
  const client = freshClient();
  await stock.createStockItem({ part_name: 'A' }, seller, { supabaseClient: client });
  await stock.createStockItem({ part_name: 'B' }, otherSeller, { supabaseClient: client });
  const sellerList = await stock.listStockItems({}, seller, { supabaseClient: client });
  assert.equal(sellerList.length, 1);
  assert.equal(sellerList[0].part_name, 'A');
  const reviewerList = await stock.listStockItems({}, reviewer, { supabaseClient: client });
  assert.equal(reviewerList.length, 2); // reviewer sees all
});

test('audit metadata is written for stock movements', async () => {
  const client = freshClient();
  const item = await stock.createStockItem({ part_name: 'Hose', initial_quantity: 2 }, seller, { supabaseClient: client });
  await ledger.appendStockMovement(item.id, { action: 'RESERVE', quantity: 1 }, seller, { supabaseClient: client });
  const audits = client._rows('diaspora_import_audit_log');
  assert.ok(audits.some((a) => a.action === 'STOCK_RESERVE'));
  assert.ok(audits.every((a) => typeof a.cryptographic_seal === 'string' && a.cryptographic_seal.length === 64));
});

test('supply document publish is blocked until required fields exist', async () => {
  const client = freshClient();
  const doc = await supply.createSupplyDocument({ document_number: 'SD-1', title: 'Used Toyota parts' }, seller, { supabaseClient: client });
  assert.equal(doc.status, 'DRAFT');
  await assert.rejects(() => supply.publishSupplyDocument(doc.id, seller, { supabaseClient: client }), /missing required fields/i);
  await supply.updateSupplyDocument(doc.id, { origin_country: 'Japan' }, seller, { supabaseClient: client });
  const published = await supply.publishSupplyDocument(doc.id, seller, { supabaseClient: client });
  assert.equal(published.status, 'PUBLISHED');
  assert.equal(published.publication_status, 'PUBLISHED');
});

test('supply document cannot transition published -> published (invalid transition)', async () => {
  const client = freshClient();
  const doc = await supply.createSupplyDocument({ document_number: 'SD-2', title: 'Spares', origin_country: 'UAE' }, seller, { supabaseClient: client });
  await supply.publishSupplyDocument(doc.id, seller, { supabaseClient: client });
  await assert.rejects(() => supply.publishSupplyDocument(doc.id, seller, { supabaseClient: client }), /Cannot transition/i);
  const unpub = await supply.unpublishSupplyDocument(doc.id, seller, { supabaseClient: client });
  assert.equal(unpub.status, 'UNPUBLISHED');
});

// ── H1: atomic stock movement contract (via diaspora_append_stock_movement_atomic) ──

test('H1: same idempotency key with a conflicting payload is rejected', async () => {
  const client = freshClient();
  const item = await stock.createStockItem({ part_name: 'Rotor', initial_quantity: 20 }, seller, { supabaseClient: client });
  await ledger.appendStockMovement(item.id, { action: 'RESERVE', quantity: 4, idempotencyKey: 'dup' }, seller, { supabaseClient: client });
  await assert.rejects(
    () => ledger.appendStockMovement(item.id, { action: 'RESERVE', quantity: 9, idempotencyKey: 'dup' }, seller, { supabaseClient: client }),
    /reused with a different movement/i,
  );
});

test('H1: simulated audit failure rolls back the whole movement (no ledger row, no balance change)', async () => {
  const client = freshClient();
  const item = await stock.createStockItem({ part_name: 'Caliper', initial_quantity: 10 }, seller, { supabaseClient: client });
  const ledgerCountBefore = client._rows('diaspora_stock_ledger').length;
  client.setFault('failAudit');
  await assert.rejects(() => ledger.appendStockMovement(item.id, { action: 'RESERVE', quantity: 3 }, seller, { supabaseClient: client }), /could not be applied|audit/i);
  client.clearFaults();
  assert.equal(client._rows('diaspora_stock_ledger').length, ledgerCountBefore); // no partial ledger row
  const current = await stock.getStockItem(item.id, seller, { supabaseClient: client });
  assert.equal(current.balances.reserved, 0); // balances unchanged
  assert.equal(current.balances.onHand, 10);
});

test('H1: simulated balance-update failure leaves no ledger row', async () => {
  const client = freshClient();
  const item = await stock.createStockItem({ part_name: 'Pump', initial_quantity: 6 }, seller, { supabaseClient: client });
  const before = client._rows('diaspora_stock_ledger').length;
  client.setFault('failItemUpdate');
  await assert.rejects(() => ledger.appendStockMovement(item.id, { action: 'ADD', quantity: 2 }, seller, { supabaseClient: client }));
  client.clearFaults();
  assert.equal(client._rows('diaspora_stock_ledger').length, before);
});

test('H1: cross-tenant actor without ownership is denied by the RPC', async () => {
  const client = freshClient();
  const tenantItem = await stock.createStockItem({ part_name: 'Tenant part' }, { ...seller, tenantId: 'tenantA' }, { supabaseClient: client });
  // a different user in a different tenant, non-privileged
  const intruder = { id: 'intruder', userId: 'intruder', role: 'dealer', platformRole: 'dealer', tenantId: 'tenantB' };
  await assert.rejects(
    () => ledger.appendStockMovement(tenantItem.id, { action: 'ADD', quantity: 1 }, intruder, { supabaseClient: client }),
    /access to this stock item/i,
  );
});
