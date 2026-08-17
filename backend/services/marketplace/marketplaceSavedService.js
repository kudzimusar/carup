/**
 * Marketplace saved-listings service. Reuses the existing `saved_vehicles` table (user_id, vin)
 * rather than creating a parallel store, and ALWAYS returns sanitized listing summaries (never raw
 * vehicles(*)). Authenticated users only.
 */

import { supabase } from '../../db/supabase.js';
import {
  LISTING_SELECT_COLUMNS,
  buildMarketplaceListingSummary,
  fetchCanonicalTrustByVin,
  fetchListingRelatedRows,
  filterVisibleVehicles,
} from './listingSummaryService.js';
import { ValidationError, ForbiddenError, DatabaseError } from '../../utils/errors.js';

const TABLE = 'saved_vehicles';

function requireUser(actor) {
  const userId = actor?.id || actor?.userId;
  if (!userId) throw new ForbiddenError('Authentication required to save listings.');
  return userId;
}

export async function saveListing(client, vin, actor) {
  const userId = requireUser(actor);
  if (!vin) throw new ValidationError('vin is required.');
  try {
    const { data: existing } = await client.from(TABLE).select('id, user_id, vin').eq('user_id', userId).eq('vin', vin);
    if (Array.isArray(existing) && existing.length) return { saved: true, vin };
    const { error } = await client.from(TABLE).insert({ user_id: userId, vin, created_at: new Date().toISOString() });
    // saved_vehicles has UNIQUE(user_id, vin) (migration 010). A concurrent double-save races past the
    // existence check above; treat the unique violation (23505) as an idempotent success, not an error.
    if (error && error.code !== '23505') throw error;
    return { saved: true, vin };
  } catch (error) {
    if (error && error.code === '23505') return { saved: true, vin };
    throw new DatabaseError('Failed to save listing.', { reason: error.message });
  }
}

export async function unsaveListing(client, vin, actor) {
  const userId = requireUser(actor);
  if (!vin) throw new ValidationError('vin is required.');
  try {
    const { error } = await client.from(TABLE).delete().eq('user_id', userId).eq('vin', vin);
    if (error) throw error;
    return { saved: false, vin };
  } catch (error) {
    throw new DatabaseError('Failed to remove saved listing.', { reason: error.message });
  }
}

export async function listSavedListings(client, actor) {
  const userId = requireUser(actor);
  let savedRows;
  try {
    const { data, error } = await client.from(TABLE).select('vin').eq('user_id', userId);
    if (error) throw error;
    savedRows = data || [];
  } catch (error) {
    throw new DatabaseError('Failed to read saved listings.', { reason: error.message });
  }
  const vins = savedRows.map((r) => r.vin).filter(Boolean);
  if (!vins.length) return { listings: [], total: 0 };

  const { data: vehicles, error } = await client.from('vehicles').select(LISTING_SELECT_COLUMNS).in('vin', vins);
  if (error) throw error;
  const visible = filterVisibleVehicles(vehicles);
  const visibleVins = visible.map((v) => v.vin).filter(Boolean);
  const { evidenceByVin, partSentryByVin, ownershipByVin, imagesByVin } = await fetchListingRelatedRows(client, visibleVins);
  // A saved card must show the same trust position as the list it was saved from.
  const canonicalTrustByVin = await fetchCanonicalTrustByVin(client, visibleVins);

  const listings = visible.map((vehicle) =>
    buildMarketplaceListingSummary({
      vehicle,
      evidenceRows: evidenceByVin.get(vehicle.vin) || [],
      partSentryRows: partSentryByVin.get(vehicle.vin) || [],
      ownershipCount: (ownershipByVin.get(vehicle.vin) || []).length,
      imageRows: imagesByVin.get(vehicle.vin) || [],
      canonicalTrust: canonicalTrustByVin.get(vehicle.vin) || null,
    })
  );
  return { listings, total: listings.length };
}
