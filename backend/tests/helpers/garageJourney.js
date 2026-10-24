import { completeJob, startServiceCase } from '../../services/serviceNetwork/serviceCaseService.js';
import { recordService } from '../../services/serviceNetwork/serviceRecordService.js';
import { assignMechanic, createWorkOrderForCase } from '../../services/serviceNetwork/workOrderAssignmentService.js';
import { createEstimateForCase, decideMyEstimate, sendEstimate } from '../../services/garageOperations/garageEstimateService.js';
import { consumeForService, createPart } from '../../services/garageOperations/garageStockService.js';
import { issueInvoice, recordPayment } from '../../services/garageOperations/garageInvoiceService.js';

/**
 * Drive the REAL services through a Garage job so higher-level tests (operations summary, golden
 * journeys) stand on genuine state rather than hand-written rows.
 */
export const noEmit = { emitDomainEvent: async () => ({}) };
export const garageActor = (id, tenant, role = 'admin') => ({ id, role: 'owner', activeTenant: { id: tenant, type: 'garage', role } });
export const person = (id) => ({ id, role: 'owner', activeTenant: null });

let seq = 0;

/**
 * @param {object} o
 * @param {object} o.world  from createGarageFinalWorld
 * @param {object} o.client supabase client over the world's database
 * @param {'a'|'b'} [o.garage]
 * @param {number} [o.estimateTotal] unit price of a single estimate line (null = no estimate)
 * @param {string} [o.currency]
 * @param {number|null} [o.actualCost] recorded service cost (null = not recorded)
 * @param {'decline'|'complete'|'stop-after-authorize'|'invoice'|'pay-partial'|'pay-full'} [o.until]
 * @param {number} [o.partQty] units of a stock part used
 */
export async function runGarageJob({
  world, client, garage = 'a', estimateTotal = 100, currency = 'USD', actualCost = 100, until = 'complete', partQty = 0,
  requester = null, mechanic = null, vin = null,
}) {
  const { db } = world;
  const tenant = world.T[garage];
  const admin = garageActor(`admin-${garage}`, tenant);
  const mechUser = mechanic || (garage === 'a' ? 'mech-a' : 'mech-c');
  const mech = garageActor(mechUser, tenant, 'mechanic');
  const owner = garage === 'a' ? 'customer-a' : 'customer-b';
  const caseVin = vin || (garage === 'a' ? world.V.a : world.V.b);
  const { rows: [c] } = await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status,accepted_at,requested_at) VALUES ($1,$2,$3,$4,'accepted',now() - interval '3 hours',now() - interval '4 hours') RETURNING id",
    [caseVin, tenant, world.B[garage + '1'], requester || owner]);
  const { workOrder } = await createWorkOrderForCase(client, admin, c.id, {});
  const out = { caseId: c.id, workOrderId: workOrder.id, tenant, admin, mech, owner, estimate: null, invoice: null, payments: [] };

  if (estimateTotal !== null) {
    out.estimate = await createEstimateForCase(client, admin, c.id, {
      currency, lines: [{ category: 'labour', description: 'Service', quantity: 1, unit_price: estimateTotal }] });
    await sendEstimate(client, admin, out.estimate.id, noEmit);
    await decideMyEstimate(client, person(owner), out.estimate.id, { decision: until === 'decline' ? 'decline' : 'accept' });
    if (until === 'decline') return out;
  } else {
    await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,$3,'owner',NULL,'owner','authorized',NULL)", [workOrder.id, caseVin, owner]);
  }
  if (until === 'stop-after-authorize') return out;

  await assignMechanic(client, admin, workOrder.id, { mechanic_user_id: mechUser });
  await startServiceCase(client, admin, c.id, noEmit);
  const body = { work_performed: 'Completed the service' };
  if (actualCost !== null) { body.total_cost = actualCost; body.currency = currency; }
  const { record } = await recordService(client, mech, workOrder.id, body);
  out.record = record;
  if (partQty > 0) {
    const part = (await createPart(client, admin, {
      name: `Part ${++seq}`, sku: `JRN-${Date.now()}-${seq}`, opening_quantity: partQty + 2, unit_cost: 10, sell_price: 20, price_currency: currency })).part;
    await consumeForService(client, mech, record.id, { part_id: part.id, quantity: partQty });
    out.part = part;
  }
  await completeJob(client, mech, c.id, noEmit);
  if (until === 'complete') return out;

  const lines = [{ category: 'labour', description: 'Service', quantity: 1, unit_price: actualCost ?? 100 }];
  out.invoice = await issueInvoice(client, admin, c.id, { currency, lines }, noEmit);
  if (until === 'invoice') return out;
  const total = Number(out.invoice.total_amount);
  const first = until === 'pay-partial' ? total / 2 : total;
  out.payments.push(await recordPayment(client, admin, out.invoice.id, { amount: first, method: 'cash' }, noEmit));
  return out;
}

export default { runGarageJob, noEmit, garageActor, person };
