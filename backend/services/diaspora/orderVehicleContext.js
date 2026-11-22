/**
 * T11-CAP-LR01-R3 — "which vehicle is this import order about?", for the person entitled to know.
 *
 * Until now an import order answered that question with a UUID: the order list titled each row
 * "Import <uuid>", the detail page said "Vehicle request", and the documents page said "PURCHASE 3E2B66A0".
 * The order is linked to a vehicle by `linked_vehicle_vin`; nothing read it. This attaches a minimal
 * `linked_vehicle: { vin, title }` to an order — and only when the viewer is the vehicle's owner or current
 * seller, the same standing that opens its Vehicle Passport.
 *
 *   - Minimal. VIN and a display title. No owner, colour, mileage, chassis or price.
 *   - Audience-bound. A participant who is not the owner (a seller, a logistics provider, a reviewer) is sent
 *     the order exactly as before — byte for byte — so the response cannot be used to learn which vehicle an
 *     order concerns, or whether one is linked at all.
 *   - Additive and fault-isolated. A failed vehicle read returns the orders unchanged: the page falls back
 *     to its existing titles. It never fails the order response and never invents a title.
 *   - Read-only. One vehicles read per 100 linked VINs, however many orders.
 */
import { supabase } from '../../db/supabase.js';
import { isOwnerOrCurrentSeller } from '../vehicleCapabilityService.js';

const CHUNK = 100;

/** "2018 Honda Vezel". Null when the vehicle row names none of year, make or model. */
export function vehicleTitle(vehicle) {
  const parts = [vehicle?.year, vehicle?.make, vehicle?.model]
    .map((part) => (part === null || part === undefined ? '' : String(part).trim()))
    .filter((part) => part !== '' && part !== '0');
  return parts.length ? parts.join(' ') : null;
}

export async function attachLinkedVehicles(orders, userContext, { client = supabase } = {}) {
  const list = Array.isArray(orders) ? orders : [];
  // An asserted (unproven) identity is not an owner. Neither is no identity.
  if (!userContext?.id || userContext.identityAsserted === true) return list;
  const vins = [...new Set(list.map((order) => order?.linked_vehicle_vin).filter(Boolean))];
  if (vins.length === 0) return list;

  const rows = [];
  try {
    for (let i = 0; i < vins.length; i += CHUNK) {
      const { data, error } = await client
        .from('vehicles')
        .select('vin, make, model, year, owner_id, current_seller_id')
        .in('vin', vins.slice(i, i + CHUNK));
      if (error) throw new Error(error.message || 'vehicles read failed');
      rows.push(...(data || []));
    }
  } catch (error) {
    console.warn('[order-vehicle] linked vehicles could not be read:', error?.message);
    return list;
  }

  const byVin = new Map(rows.map((row) => [row.vin, row]));
  return list.map((order) => {
    const vehicle = order?.linked_vehicle_vin ? byVin.get(order.linked_vehicle_vin) : null;
    if (!vehicle || !isOwnerOrCurrentSeller(vehicle, userContext.id)) return order;
    return { ...order, linked_vehicle: { vin: vehicle.vin, title: vehicleTitle(vehicle) } };
  });
}

export async function attachLinkedVehicle(order, userContext, options) {
  if (!order || typeof order !== 'object') return order;
  const [out] = await attachLinkedVehicles([order], userContext, options);
  return out;
}
