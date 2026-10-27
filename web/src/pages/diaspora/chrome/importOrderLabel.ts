import { shortRef } from '../trackingDisplay'

type OrderNameParts = {
  id: string
  requested_make?: string | null
  requested_model?: string | null
  linked_vehicle?: { title?: string | null } | null
}

/**
 * What an import order is CALLED, from the most to the least specific thing the viewer is entitled to know:
 *
 *   1. the vehicle it carries ("2018 Honda Vezel") — present only for the vehicle's own owner or current seller;
 *   2. what the buyer asked for ("Honda Vezel"), when the order was raised as a request;
 *   3. "Import order 3E2B66A0" — a short reference, never the whole id and never "Vehicle request".
 *
 * An order nobody described is still an order; it is not a vehicle, and it is not named after a UUID.
 */
export function importOrderLabel(order: OrderNameParts): string {
  const linked = typeof order.linked_vehicle?.title === 'string' ? order.linked_vehicle.title.trim() : ''
  if (linked) return linked
  const requested = [order.requested_make, order.requested_model]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ')
  if (requested) return requested
  return `Import order ${shortRef(order.id)}`
}

/** What an order is called while the read that would name it has not answered: the kind of thing it is, never its reference. */
export const PENDING_ORDER_LABEL = 'Import order'

/**
 * The order's name once the read that names it has answered, and `PENDING_ORDER_LABEL` until then. Found by the physical UAT:
 * naming a still-loading order by its fallback put "Import order 3E2B66A0" in the trail for two to three seconds on every
 * visit, before it changed to "2018 Honda Vezel" — the same order called two things. A read that FAILED has answered, so
 * it gets the fallback, which is the honest name for an order nothing else is known about.
 */
export function settledOrderLabel(order: OrderNameParts, settled: boolean): string {
  return settled ? importOrderLabel(order) : PENDING_ORDER_LABEL
}
