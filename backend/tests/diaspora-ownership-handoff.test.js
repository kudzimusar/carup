/**
 * Cross-border ownership/evidence handoff tests — service-level, in-memory mock Supabase.
 *
 * Covers the fail-closed preconditions (government docs, order status, verified import record,
 * VIN/chassis identity, authorization, tenant isolation, VIN conflicts), the three-way record
 * linkage, idempotent replay, and the safe-provenance evidence/timeline event.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const { IMPORT_ORDER_STATUSES } = await import('../constants/diaspora/diasporaStatuses.js');
const { GOVERNMENT_DOCUMENT_CATEGORIES } = await import('../constants/diaspora/diasporaDocumentTypes.js');
const handoff = await import('../services/diaspora/diasporaOwnershipHandoffService.js');

const VIN = 'JTDKR123456789012';
const CHASSIS = 'NHP10-1234567';
const ORDER_ID = 'order-1';
const RECORD_ID = 'vir-1';

const reviewer = { id: 'rev-1', userId: 'rev-1', role: 'reviewer', platformRole: 'reviewer', tenantId: null };
const tenantAdmin = { id: 'ta-1', userId: 'ta-1', role: 'admin', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-1' };
const otherTenantAdmin = { id: 'ta-2', userId: 'ta-2', role: 'admin', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-2' };
const buyer = { id: 'buyer-1', userId: 'buyer-1', role: 'buyer', platformRole: 'member', tenantId: null };

function orderRow(overrides = {}) {
  return {
    id: ORDER_ID,
    tenant_id: 'tenant-1',
    buyer_id: 'buyer-1',
    status: IMPORT_ORDER_STATUSES.ZIMBABWE_READY,
    origin_country: 'Japan',
    requested_make: 'Toyota',
    requested_model: 'Aqua',
    requested_year_min: 2019,
    requested_year_max: 2019,
    budget_currency: 'USD',
    linked_vehicle_vin: null,
    chassis_number: CHASSIS,
    metadata: {},
    created_by: 'buyer-1',
    updated_by: 'buyer-1',
    ...overrides,
  };
}

function importRecordRow(overrides = {}) {
  return {
    id: RECORD_ID,
    import_order_id: ORDER_ID,
    tenant_id: 'tenant-1',
    vehicle_vin: VIN,
    chassis_number: CHASSIS,
    origin_country: 'Japan',
    import_date: '2026-05-14',
    verification_status: 'VERIFIED',
    metadata: {},
    ...overrides,
  };
}

function governmentDocs(overrides = {}) {
  return GOVERNMENT_DOCUMENT_CATEGORIES.map((category, i) => ({
    id: `gov-${i + 1}`,
    import_order_id: ORDER_ID,
    tenant_id: 'tenant-1',
    document_category: category,
    verification_status: overrides[category] || 'VERIFIED',
  }));
}

function freshClient({ order = {}, record = {}, docs = {}, vehicles = [], events = [] } = {}) {
  return createMockSupabase(
    {
      diaspora_import_orders: [orderRow(order)],
      diaspora_import_order_participants: [
        { id: 'part-1', import_order_id: ORDER_ID, user_id: 'seller-1', participant_role: 'seller', verification_status: 'VERIFIED' },
      ],
      vehicle_import_records: [importRecordRow(record)],
      vehicle_government_documents: governmentDocs(docs),
      vehicles,
      blockchain_events: events,
      diaspora_import_audit_log: [],
      notification_queue: [],
      domain_events: [],
    },
    { rpc: DIASPORA_RPCS },
  );
}

// 1. Government documentation gate
test('handoff is blocked while any required government document is not VERIFIED', async () => {
  const client = freshClient({ docs: { CID_POLICE_CLEARANCE: 'PENDING_REVIEW' } });
  await assert.rejects(
    () => handoff.completeOwnershipHandoff(ORDER_ID, {}, reviewer, { supabaseClient: client }),
    (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.match(err.message, /government document/i);
      assert.deepEqual(err.details.missing, ['CID_POLICE_CLEARANCE']);
      return true;
    },
  );
  assert.equal(client._rows('vehicles').length, 0);
  assert.equal(client._rows('blockchain_events').length, 0);
});

// 2. Order status gate
test('handoff is blocked when the order is not ZIMBABWE_READY', async () => {
  const client = freshClient({ order: { status: IMPORT_ORDER_STATUSES.DUTY_PAID } });
  await assert.rejects(
    () => handoff.completeOwnershipHandoff(ORDER_ID, {}, reviewer, { supabaseClient: client }),
    (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.match(err.message, /ZIMBABWE_READY/);
      return true;
    },
  );
  assert.equal(client._rows('vehicles').length, 0);
});

// 3. Verified import record gate
test('handoff is blocked when the vehicle import record is not VERIFIED', async () => {
  const client = freshClient({ record: { verification_status: 'PENDING_REVIEW' } });
  await assert.rejects(
    () => handoff.completeOwnershipHandoff(ORDER_ID, {}, reviewer, { supabaseClient: client }),
    (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.match(err.message, /VERIFIED vehicle import record/i);
      return true;
    },
  );
  assert.equal(client._rows('vehicles').length, 0);
});

// 4. Identity gate
test('handoff is blocked when neither VIN nor chassis number is available', async () => {
  const client = freshClient({
    order: { linked_vehicle_vin: null, chassis_number: null },
    record: { vehicle_vin: null, chassis_number: null },
  });
  await assert.rejects(
    () => handoff.completeOwnershipHandoff(ORDER_ID, {}, reviewer, { supabaseClient: client }),
    (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.match(err.message, /VIN or chassis/i);
      return true;
    },
  );
  assert.equal(client._rows('vehicles').length, 0);
});

// 5. Successful handoff links vehicle + import record + order
test('successful handoff creates the vehicle and links all three records', async () => {
  const client = freshClient();
  const result = await handoff.completeOwnershipHandoff(ORDER_ID, {}, tenantAdmin, { supabaseClient: client });

  assert.equal(result.idempotentReplay, false);
  assert.equal(result.vehicle.vin, VIN);
  assert.equal(result.vehicle.tenant_id, 'tenant-1');

  const vehicles = client._rows('vehicles');
  assert.equal(vehicles.length, 1);
  assert.equal(vehicles[0].vin, VIN);
  assert.equal(vehicles[0].tenant_id, 'tenant-1');
  assert.equal(vehicles[0].make, 'Toyota');
  assert.equal(vehicles[0].import_source, 'diaspora_import');
  assert.equal(vehicles[0].publication_status, 'draft');

  const record = client._rows('vehicle_import_records')[0];
  assert.equal(record.vehicle_vin, VIN);

  const order = client._rows('diaspora_import_orders')[0];
  assert.equal(order.linked_vehicle_vin, VIN);
  assert.equal(order.metadata.ownershipHandoff.vehicleVin, VIN);
  assert.equal(order.metadata.ownershipHandoff.vehicleImportRecordId, RECORD_ID);

  // audit + notification/outbox written
  const audits = client._rows('diaspora_import_audit_log');
  assert.equal(audits.filter((a) => a.action === 'DIASPORA_OWNERSHIP_HANDOFF').length, 1);
  assert.ok(audits.every((a) => typeof a.cryptographic_seal === 'string' && a.cryptographic_seal.length === 64));
  assert.equal(client._rows('domain_events').filter((e) => e.event_type === 'DIASPORA_OWNERSHIP_HANDOFF').length, 1);
  const notifications = client._rows('notification_queue');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].recipient_id, 'buyer-1');
  assert.equal(notifications[0].type, 'DIASPORA_OWNERSHIP_HANDOFF');
});

// 6. Idempotent replay
test('a retried handoff is an idempotent replay and creates no duplicate rows', async () => {
  const client = freshClient();
  const first = await handoff.completeOwnershipHandoff(ORDER_ID, {}, reviewer, { supabaseClient: client });
  const counts = () => ({
    vehicles: client._rows('vehicles').length,
    events: client._rows('blockchain_events').length,
    audits: client._rows('diaspora_import_audit_log').length,
    notifications: client._rows('notification_queue').length,
    outbox: client._rows('domain_events').length,
  });
  const before = counts();

  const replay = await handoff.completeOwnershipHandoff(ORDER_ID, {}, reviewer, { supabaseClient: client });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.vehicle.vin, first.vehicle.vin);
  assert.deepEqual(counts(), before);
});

// 7. VIN conflict
test('handoff is rejected when the VIN already belongs to a different tenant/owner context', async () => {
  const client = freshClient({
    vehicles: [{ vin: VIN, make: 'Toyota', model: 'Aqua', year: 2019, mileage: 10, price: 5000, tenant_id: 'tenant-OTHER', owner_id: 'someone-else' }],
  });
  await assert.rejects(
    () => handoff.completeOwnershipHandoff(ORDER_ID, {}, reviewer, { supabaseClient: client }),
    (err) => {
      assert.equal(err.name, 'OwnershipHandoffConflictError');
      assert.equal(err.statusCode, 409);
      return true;
    },
  );
  // no writes of any kind
  assert.equal(client._rows('vehicles').length, 1);
  assert.equal(client._rows('blockchain_events').length, 0);
  assert.equal(client._rows('diaspora_import_audit_log').length, 0);
  const order = client._rows('diaspora_import_orders')[0];
  assert.equal(order.linked_vehicle_vin, null);
  assert.equal(order.metadata.ownershipHandoff, undefined);
});

// 8. Ordinary buyer blocked
test('the order buyer cannot complete the handoff', async () => {
  const client = freshClient();
  await assert.rejects(
    () => handoff.completeOwnershipHandoff(ORDER_ID, {}, buyer, { supabaseClient: client }),
    (err) => {
      assert.equal(err.name, 'ForbiddenError');
      return true;
    },
  );
  assert.equal(client._rows('vehicles').length, 0);
});

// 9. Cross-tenant admin blocked
test('a tenant admin of another tenant cannot complete the handoff', async () => {
  const client = freshClient();
  await assert.rejects(
    () => handoff.completeOwnershipHandoff(ORDER_ID, {}, otherTenantAdmin, { supabaseClient: client }),
    (err) => {
      assert.equal(err.name, 'ForbiddenError');
      return true;
    },
  );
  assert.equal(client._rows('vehicles').length, 0);
});

// 10. Evidence event with safe provenance
test('handoff writes a CROSS_BORDER_OWNERSHIP_HANDOFF evidence event with safe provenance only', async () => {
  const client = freshClient();
  await handoff.completeOwnershipHandoff(ORDER_ID, {}, reviewer, { supabaseClient: client });

  const events = client._rows('blockchain_events');
  assert.equal(events.length, 1);
  assert.equal(events[0].vin, VIN);
  assert.equal(events[0].event_type, 'CROSS_BORDER_OWNERSHIP_HANDOFF');

  const payload = JSON.parse(events[0].payload);
  assert.equal(payload.importOrderId, ORDER_ID);
  assert.equal(payload.vehicleImportRecordId, RECORD_ID);
  assert.equal(payload.originCountry, 'Japan');
  assert.equal(payload.importDate, '2026-05-14');
  assert.equal(payload.actorId, 'rev-1');
  assert.equal(payload.verifiedGovernmentDocuments.length, GOVERNMENT_DOCUMENT_CATEGORIES.length);
  assert.ok(payload.verifiedGovernmentDocuments.every((d) => d.id && d.category));
  assert.match(payload.statement, /does not assert legal title/i);

  // safe provenance: no storage paths/URLs anywhere in the event
  const serialized = JSON.stringify(events[0]);
  assert.doesNotMatch(serialized, /storage_path|storageBucket|storage_bucket|file_url|file_path|https?:\/\//i);
});

// 11. Timeline read helper exposes the verified import event to order participants
test('the vehicle timeline read helper exposes the handoff event to the order buyer', async () => {
  const client = freshClient();

  const before = await handoff.getOwnershipHandoffStatus(ORDER_ID, buyer, { supabaseClient: client });
  assert.equal(before.handedOff, false);
  assert.deepEqual(before.evidence, []);

  await handoff.completeOwnershipHandoff(ORDER_ID, {}, reviewer, { supabaseClient: client });

  const status = await handoff.getOwnershipHandoffStatus(ORDER_ID, buyer, { supabaseClient: client });
  assert.equal(status.handedOff, true);
  assert.equal(status.vehicleVin, VIN);
  assert.equal(status.evidence.length, 1);
  assert.equal(status.evidence[0].event_type, 'CROSS_BORDER_OWNERSHIP_HANDOFF');
  assert.equal(status.evidence[0].payload.importOrderId, ORDER_ID);
  assert.doesNotMatch(JSON.stringify(status.evidence), /storage|file_url|file_path|https?:\/\//i);
});

// Extra: same-tenant identity row is adopted, not duplicated
test('an existing vehicle in the same tenant context is adopted without a duplicate insert', async () => {
  const client = freshClient({
    vehicles: [{ vin: VIN, make: 'Toyota', model: 'Aqua', year: 2019, mileage: 42000, price: 8000, tenant_id: 'tenant-1', owner_id: null }],
  });
  const result = await handoff.completeOwnershipHandoff(ORDER_ID, {}, reviewer, { supabaseClient: client });
  assert.equal(result.idempotentReplay, false);
  assert.equal(client._rows('vehicles').length, 1);
  assert.equal(result.vehicle.mileage, 42000); // adopted row untouched
  assert.equal(client._rows('diaspora_import_orders')[0].linked_vehicle_vin, VIN);
});

// Extra: chassis-only imports use the chassis number as the canonical identity key
test('a chassis-only import keys the vehicle identity by chassis number', async () => {
  const client = freshClient({
    order: { linked_vehicle_vin: null },
    record: { vehicle_vin: null },
  });
  const result = await handoff.completeOwnershipHandoff(ORDER_ID, {}, reviewer, { supabaseClient: client });
  assert.equal(result.vehicle.vin, CHASSIS);
  assert.equal(client._rows('vehicle_import_records')[0].vehicle_vin, CHASSIS);
  const payload = JSON.parse(client._rows('blockchain_events')[0].payload);
  assert.equal(payload.identitySource, 'chassis_number');
});
