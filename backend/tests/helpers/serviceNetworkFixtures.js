import assert from 'node:assert/strict';

/**
 * OC-5D — the vehicle custodian's decision on a work order (OC-5A): POST /api/vehicles/:vin/work-orders/
 * :id/authorization runs mechanic_work_order_decide_authorization, which records exactly these three
 * columns (that RPC is proven on PGlite in the OC-5A suites). Until it is made, no service can be recorded
 * against the work order — Service Network adds no second way to authorize one.
 */
export function ownerAuthorizes(client, workOrderId, ownerId = 'u-owner') {
  const row = client._tables.mechanic_work_orders.find((w) => w.id === workOrderId);
  assert.ok(row, `no work order ${workOrderId}`);
  assert.equal(row.owner_authorization, 'pending', 'a case-born work order starts awaiting the owner');
  Object.assign(row, { owner_authorization: 'authorized', owner_authorized_by: ownerId, owner_authorized_at: new Date().toISOString() });
}

/** PartSentry's attested record of a work order (OC-5A binds partsentry_logs.work_order_id at write time). */
export function attestPartOnWorkOrder(client, partsentryLogId, workOrderId) {
  const log = client._tables.partsentry_logs.find((l) => l.id === partsentryLogId);
  assert.ok(log, `no PartSentry record ${partsentryLogId}`);
  log.work_order_id = workOrderId;
}
