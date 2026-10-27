/**
 * T11-CAP-LR01-R3 — the OWNER-ONLY `capabilities` block of a vehicle: what it can currently DO.
 *
 *   marketplace   published | in_progress | sold | not_listed | unavailable      (see marketplaceCapability.js)
 *   trade_import  none | single (+order_id) | multiple (+count) | unavailable   (see journeyProjectionService.js)
 *
 * The two are derived INDEPENDENTLY and neither reads the other: publication never changes the import
 * capability and an import order never changes the listing (`VEHICLE != MARKETPLACE LISTING != IMPORT ORDER`).
 *
 * Audience. The block is built only for a vehicle the viewer owns or sells. For anyone else nothing is built
 * and nothing is added to the response — no empty block, no count, no flag — so a response is byte-identical
 * whether or not the vehicle has an import order or a listing.
 *
 * Faults. Every part is isolated. A failure reading imports marks `trade_import` `unavailable`; a failure
 * deriving the listing state marks `marketplace` `unavailable`. Neither is ever worded as the benign answer
 * ("none", "not_listed"), and neither fails the response it is attached to.
 */
import { deriveMarketplaceCapability, listingMediaCountFromBlock } from '../utils/marketplaceCapability.js';
import { getVehiclesImportCapabilities } from './diaspora/journeyProjectionService.js';
import { normalizeId } from './diaspora/diasporaAuthorization.js';

/** The same standing `getVehicleJourney` gives a vehicle's owner or current seller. */
export function isOwnerOrCurrentSeller(vehicle, userId) {
  const me = normalizeId(userId);
  if (!me || !vehicle) return false;
  return [vehicle.owner_id, vehicle.current_seller_id].map(normalizeId).filter(Boolean).includes(me);
}

/** The columns the derivation reads, and no others. (A named list, never `select('*')`.) */
export const CAPABILITY_VEHICLE_COLUMNS = 'vin, owner_id, current_seller_id, publication_status, status, seller_description, seller_features, price, currency';

/**
 * The capabilities of ONE vehicle for ONE viewer, or null when the viewer is not its owner or seller (or it does not exist).
 * Reads the vehicle itself, so a route needs no vehicle read of its own — this is what the Vehicle Passport route calls.
 * A failed vehicle read THROWS: the caller then adds nothing, which is "not sent", never a claim.
 *
 * @param listingMediaFor async (vins) => Map<vin, listing-media block>; omitted = the listing-media signal is unread
 */
export async function readOwnerCapabilitiesForVin({
  client,
  vin,
  userContext,
  listingMediaFor = null,
  importCapabilities,
}) {
  if (!vin || !userContext?.id) return null;
  const { data: vehicle, error } = await client.from('vehicles').select(CAPABILITY_VEHICLE_COLUMNS).eq('vin', vin).maybeSingle();
  if (error) throw new Error(error.message || 'the vehicle could not be read');
  if (!vehicle || !isOwnerOrCurrentSeller(vehicle, userContext.id)) return null;
  const listingMedia = typeof listingMediaFor === 'function' ? await listingMediaFor([vehicle.vin]) : null;
  const built = await buildOwnerCapabilities({
    client, vehicles: [vehicle], listingMedia, userContext, ...(importCapabilities ? { importCapabilities } : {}),
  });
  return built.get(vehicle.vin) || null;
}

/**
 * @param vehicles      `vehicles` rows carrying the Seller columns the derivation reads (the owner list passes whole rows)
 * @param listingMedia  Map<vin, toListingMediaBlock(...)>; absent = the listing-media signal is unread
 * @returns Map<vin, { marketplace, trade_import }> for the vehicles the viewer owns or sells
 */
export async function buildOwnerCapabilities({
  client,
  vehicles,
  listingMedia = null,
  userContext,
  importCapabilities = getVehiclesImportCapabilities,
}) {
  const mine = (vehicles || []).filter((vehicle) => vehicle && vehicle.vin && isOwnerOrCurrentSeller(vehicle, userContext?.id));
  const result = new Map();
  if (mine.length === 0) return result;

  let trade = null;
  try {
    trade = await importCapabilities(mine, userContext, { supabaseClient: client });
  } catch (error) {
    console.warn('[capabilities] import capability unavailable:', error?.message);
  }

  for (const vehicle of mine) {
    let marketplace;
    try {
      marketplace = deriveMarketplaceCapability(vehicle, {
        listingMediaCount: listingMediaCountFromBlock(listingMedia && typeof listingMedia.get === 'function' ? listingMedia.get(vehicle.vin) : null),
      });
    } catch (error) {
      console.warn('[capabilities] marketplace capability unavailable:', error?.message);
      marketplace = { state: 'unavailable' };
    }
    result.set(vehicle.vin, {
      marketplace,
      trade_import: (trade && typeof trade.get === 'function' && trade.get(vehicle.vin)) || { state: 'unavailable' },
    });
  }
  return result;
}
