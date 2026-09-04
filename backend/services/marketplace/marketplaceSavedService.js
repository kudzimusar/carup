/**
 * Marketplace saved-listings service. Reuses the existing `saved_vehicles` table (user_id, vin)
 * rather than creating a parallel store, and ALWAYS returns sanitized listing summaries (never raw
 * vehicles(*)). Authenticated users only.
 */

import { supabase } from '../../db/supabase.js';
import {
  LISTING_SELECT_COLUMNS,
  selectListingRows,
  buildMarketplaceListingSummary,
  fetchCanonicalTrustByVin,
  fetchListingRelatedRows,
  filterVisibleVehicles,
  listingImageRowsForVin,
} from './listingSummaryService.js';
import { ValidationError, ForbiddenError, DatabaseError } from '../../utils/errors.js';
import {
  emitListingSaved,
  emitListingUnsaved,
} from '../intelligence/marketplaceActivityEmitters.js';

const TABLE = 'saved_vehicles';

function requireUser(actor) {
  const userId = actor?.id || actor?.userId;
  if (!userId) throw new ForbiddenError('Authentication required to save listings.');
  return userId;
}

export async function saveListing(client, vin, actor, options = {}) {
  const userId = requireUser(actor);
  if (!vin) throw new ValidationError('vin is required.');
  try {
    const { data: existing } = await client.from(TABLE).select('id, user_id, vin, created_at').eq('user_id', userId).eq('vin', vin);
    // A re-save of an already-saved listing changes nothing, so it must also OBSERVE
    // nothing: the watchlist did not move, and a save metric that counted this would
    // report interest that never happened.
    if (Array.isArray(existing) && existing.length) return { saved: true, vin };
    const createdAt = new Date().toISOString();
    const { error } = await client.from(TABLE).insert({ user_id: userId, vin, created_at: createdAt });
    // saved_vehicles has UNIQUE(user_id, vin) (migration 010). A concurrent double-save races past the
    // existence check above; treat the unique violation (23505) as an idempotent success, not an error.
    if (error && error.code !== '23505') throw error;
    if (error && error.code === '23505') return { saved: true, vin };
    // Governed observation (Intelligence I3), keyed on the authority row's own
    // created_at so a retry cannot become a second save. Never blocks the save.
    emitListingSaved({ userId, vin, savedAt: createdAt, req: options.req || null, client }).catch(() => {});
    return { saved: true, vin };
  } catch (error) {
    if (error && error.code === '23505') return { saved: true, vin };
    throw new DatabaseError('Failed to save listing.', { reason: error.message });
  }
}

export async function unsaveListing(client, vin, actor, options = {}) {
  const userId = requireUser(actor);
  if (!vin) throw new ValidationError('vin is required.');
  try {
    // Delete-RETURNING rather than blind: once the row is gone there is nothing left
    // to reconcile against, so the deleted row's created_at is the only material that
    // can key the observation. A delete that matched nothing returns nothing, which
    // correctly produces no event.
    const { data, error } = await client.from(TABLE).delete().eq('user_id', userId).eq('vin', vin).select('vin, created_at');
    if (error) throw error;
    const removed = Array.isArray(data) ? data[0] : (data || null);
    if (removed) {
      emitListingUnsaved({
        userId, vin, savedAt: removed.created_at, req: options.req || null, client,
      }).catch(() => {});
    }
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

  const { data: vehicles, error } = await selectListingRows(client, (q) => q.in('vin', vins));
  if (error) throw error;
  const visible = filterVisibleVehicles(vehicles);
  const visibleVins = visible.map((v) => v.vin).filter(Boolean);
  const related = await fetchListingRelatedRows(client, visibleVins);
  const { evidenceByVin, partSentryByVin, ownershipByVin } = related;
  // A saved card must show the same trust position as the list it was saved from.
  const canonicalTrustByVin = await fetchCanonicalTrustByVin(client, visibleVins);

  const listings = visible.map((vehicle) =>
    buildMarketplaceListingSummary({
      vehicle,
      evidenceRows: evidenceByVin.get(vehicle.vin) || [],
      partSentryRows: partSentryByVin.get(vehicle.vin) || [],
      ownershipCount: (ownershipByVin.get(vehicle.vin) || []).length,
      imageRows: listingImageRowsForVin(related, vehicle.vin),
      canonicalTrust: canonicalTrustByVin.get(vehicle.vin) || null,
    })
  );
  return { listings, total: listings.length };
}
