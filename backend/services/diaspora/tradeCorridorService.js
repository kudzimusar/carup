/**
 * Trade OS T5 — corridor reference authority (route composition ONLY).
 *
 * A corridor is a reusable ordered-leg route pattern from an origin market to a FINAL destination
 * market. It exists to make one statement possible that country-equality never could:
 *
 *     "Your destination is Harare, Zimbabwe. This sailing is the Yokohama → Beira ocean leg of
 *      the Japan → Beira → Zimbabwe corridor. Onward inland/transit legs remain."
 *
 * What this module deliberately does NOT do:
 *   - own rates, customs/tax rules, shipment state or reputation (T6/T11/T12/T14);
 *   - rank, score or prefer corridors — `planning_status` is provenance, never preference;
 *   - book anything: a corridor/leg match is route knowledge, not a booking, an approval, an
 *     inland-transport arrangement or a customs eligibility claim;
 *   - fabricate the onward legs as services — they are listed as ROUTE COMPOSITION, and every
 *     caller must present them as "still required", never as arranged.
 */
import { ValidationError } from '../../utils/errors.js';
import { resolveClient } from './diasporaServiceUtils.js';

const CORRIDORS = 'diaspora_trade_corridors';
const LEGS = 'diaspora_trade_corridor_legs';

const norm = (value) => String(value || '').trim().toLowerCase();

/**
 * Marketplace-safe corridor projection. Everything here is reference data — there is no private
 * fact on a corridor — but the allow-list is still explicit so a future admin-only column
 * (say, negotiated terms) stays invisible until deliberately named.
 */
export const MARKETPLACE_SAFE_CORRIDOR_FIELDS = Object.freeze([
  'id', 'code', 'display_name', 'origin_country', 'destination_country', 'planning_status',
]);
export const MARKETPLACE_SAFE_LEG_FIELDS = Object.freeze([
  'id', 'sequence', 'origin_country', 'origin_locality', 'destination_country',
  'destination_locality', 'mode_options', 'jurisdiction_country',
]);

const pick = (row, fields) => Object.fromEntries(fields.map((f) => [f, row[f] ?? null]));

export function projectCorridorForMarketplace(corridor, legs = []) {
  return {
    ...pick(corridor, MARKETPLACE_SAFE_CORRIDOR_FIELDS),
    legs: [...legs]
      .sort((a, b) => Number(a.sequence) - Number(b.sequence))
      .map((leg) => pick(leg, MARKETPLACE_SAFE_LEG_FIELDS)),
  };
}

/** All active corridors with their ordered legs, projected. Order is by CODE — never preference. */
export async function listActiveCorridors(options = {}) {
  const client = await resolveClient(options);
  const { data: corridors, error } = await client.from(CORRIDORS)
    .select('*').eq('active', true).is('deleted_at', null).order('code', { ascending: true });
  if (error) throw new ValidationError(`Could not list trade corridors: ${error.message}`);
  const rows = corridors || [];
  if (!rows.length) return [];
  const { data: legs, error: legError } = await client.from(LEGS)
    .select('*').in('corridor_id', rows.map((c) => c.id)).is('deleted_at', null);
  if (legError) throw new ValidationError(`Could not list corridor legs: ${legError.message}`);
  const legsByCorridor = new Map();
  for (const leg of legs || []) {
    const list = legsByCorridor.get(leg.corridor_id) || [];
    list.push(leg);
    legsByCorridor.set(leg.corridor_id, list);
  }
  return rows.map((c) => projectCorridorForMarketplace(c, legsByCorridor.get(c.id) || []));
}

/**
 * Which of these corridors serve a request's origin market → FINAL destination market?
 * Pure over the projected corridors — no I/O, so matching logic is unit-testable exactly.
 */
export function corridorsServingRoute(corridors, originCountry, destinationCountry) {
  return (corridors || []).filter((corridor) =>
    norm(corridor.origin_country) === norm(originCountry)
    && norm(corridor.destination_country) === norm(destinationCountry));
}

/**
 * The single decision T5.4 replaces country-equality with.
 *
 * A sailing serves a request when EITHER:
 *   direct  — the sailing's endpoints equal the request's endpoints (the pre-T5 behaviour,
 *             still perfectly valid for a genuinely direct route); OR
 *   gateway — an applicable corridor (request origin → request FINAL destination) contains a leg
 *             whose country pair equals the sailing's country pair. The sailing covers THAT LEG
 *             and nothing more. Matching is by GEOGRAPHY, never by label: an operator's declared
 *             corridor_leg_id is corroborating metadata and cannot widen eligibility — only
 *             corridors that actually serve the request's route are consulted at all.
 *
 * Returns null (no match) or an object naming exactly what matched:
 *   { route_kind: 'direct' } or
 *   { route_kind: 'gateway', corridor, sailing_leg, onward_legs }
 *
 * `onward_legs` are the corridor legs AFTER the matched one — route composition the customer
 * still needs, listed so the UI can say "then: Beira → Harare inland/transit required". They are
 * never bookings and this module never invents providers for them.
 */
export function sailingRouteMatch(container, request, corridors) {
  const cOrigin = norm(container.origin_country);
  const cDest = norm(container.destination_country);
  if (cOrigin === norm(request.origin_country) && cDest === norm(request.destination_country)) {
    return { route_kind: 'direct' };
  }
  const applicable = corridorsServingRoute(corridors, request.origin_country, request.destination_country);
  for (const corridor of applicable) {
    const legs = corridor.legs || [];
    for (let i = 0; i < legs.length; i += 1) {
      const leg = legs[i];
      const shapeMatches = norm(leg.origin_country) === cOrigin && norm(leg.destination_country) === cDest;
      if (shapeMatches) {
        return {
          route_kind: 'gateway',
          corridor: { id: corridor.id, code: corridor.code, display_name: corridor.display_name, planning_status: corridor.planning_status },
          sailing_leg: {
            sequence: leg.sequence,
            origin_country: leg.origin_country,
            origin_locality: leg.origin_locality || null,
            destination_country: leg.destination_country,
            destination_locality: leg.destination_locality || null,
          },
          onward_legs: legs.slice(i + 1).map((onward) => ({
            sequence: onward.sequence,
            origin_country: onward.origin_country,
            origin_locality: onward.origin_locality || null,
            destination_country: onward.destination_country,
            destination_locality: onward.destination_locality || null,
            mode_options: onward.mode_options || [],
          })),
        };
      }
    }
  }
  return null;
}
