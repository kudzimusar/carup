/**
 * T11-CAP-04 — the READ side of shipment legs.
 *
 * Kept apart from the write service on purpose. The Journey projection is a read-only composition;
 * it should not have to import the T11 shipment service and the database singleton just to list
 * vessels. This module has no authority logic — the CALLER is responsible for having authorized the
 * read — and no write path at all.
 *
 * A leg is a DECLARED fact about a vessel and a route. Nothing here, and no column behind it, can say
 * a vessel sailed or arrived; movement is T11's alone.
 */
const LEGS = 'diaspora_shipment_legs';

/** The live legs of a shipment in journey order. */
export async function listLegsForShipment(shipmentId, client) {
  const { data } = await client.from(LEGS).select('*').eq('shipment_id', shipmentId).is('deleted_at', null);
  return (data || []).slice().sort((a, b) => a.leg_sequence - b.leg_sequence);
}

/** What a participant may be told about a leg. Never internals, never a claim that anything moved. */
export function projectLeg(leg) {
  return {
    sequence: leg.leg_sequence,
    carrier_name: leg.carrier_name ?? null,
    vessel_name: leg.vessel_name ?? null,
    voyage_ref: leg.voyage_ref ?? null,
    imo: leg.imo ?? null,
    mmsi: leg.mmsi ?? null,
    port_of_loading: leg.port_of_loading ?? null,
    port_of_discharge: leg.port_of_discharge ?? null,
    planned_departure: leg.planned_departure_date ?? null,
    estimated_arrival: leg.estimated_arrival_date ?? null,
    source: leg.source ?? null,
  };
}
