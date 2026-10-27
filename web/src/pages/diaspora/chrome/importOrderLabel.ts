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
