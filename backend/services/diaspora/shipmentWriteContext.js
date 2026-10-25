/**
 * Who may write a fact ABOUT a shipment — one loader, shared by every writer that annotates a shipment
 * without being the shipment authority (vessel legs, estimate revisions).
 *
 * Authority is T11's own rule, reused verbatim: `assertMayMoveShipment` — a platform admin or reviewer,
 * the record's tenant admin, or the operator of the container the shipment sails on. A buyer does not
 * declare facts about their own purchase's movement.
 *
 * Authority is checked BEFORE anything else is validated, so a caller who may not write learns nothing
 * about what would have been accepted.
 */
import { NotFoundError } from '../../utils/errors.js';
import { assertMayMoveShipment } from './diasporaShipmentService.js';

const SHIPMENTS = 'diaspora_shipments';
const ORDERS = 'diaspora_import_orders';

export async function loadShipmentWriteContext(client, shipmentId, context) {
  const { data: shipment } = await client.from(SHIPMENTS).select('*').eq('id', shipmentId).is('deleted_at', null).maybeSingle();
  if (!shipment) throw new NotFoundError('Shipment not found');
  const { data: order } = await client.from(ORDERS).select('*').eq('id', shipment.import_order_id).is('deleted_at', null).maybeSingle();
  if (!order) throw new NotFoundError('Import order not found');
  await assertMayMoveShipment(order, shipment.container_id || null, context, client);
  return { shipment, order };
}
