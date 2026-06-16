/**
 * Marketplace admin moderation service.
 *
 * Governs public visibility: approve / reject / suppress / request-evidence / flag-risk / clear-risk.
 * Maps decisions onto the vehicle status (reusing the existing quarantine model) and writes an
 * immutable trust_audit_events row (reused governance audit sink). Admin/reviewer only.
 *
 * Privacy: admin listing/projection still derives from buildMarketplaceListingSummary (never raw
 * vehicles(*)); decision reason/notes live only in the service-role audit table, never public.
 */

import { supabase } from '../../db/supabase.js';
import {
  LISTING_SELECT_COLUMNS,
  buildMarketplaceListingSummary,
  fetchListingRelatedRows,
  shouldShowFixtures,
} from './listingSummaryService.js';
import { getFixtureExclusion } from './marketplaceClassificationRules.js';
import { deriveSuspicionLevel } from './marketplaceTrustSummaryService.js';
import { normalizeVehicleStatus, isVehicleQuarantinedStatus } from '../../utils/vehicleStatus.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../../utils/errors.js';

const MODERATOR_ROLES = ['admin', 'platform_admin', 'super_admin', 'reviewer', 'operator', 'government'];

/** action -> { targetStatus (null = no status change), event } */
const MODERATION_ACTIONS = {
  approve: { targetStatus: 'Available', event: 'MARKETPLACE_LISTING_APPROVED' },
  reject: { targetStatus: 'Banned', event: 'MARKETPLACE_LISTING_REJECTED' },
  suppress: { targetStatus: 'Suspended', event: 'MARKETPLACE_LISTING_SUPPRESSED' },
  flag_risk: { targetStatus: 'Flagged', event: 'MARKETPLACE_LISTING_FLAGGED' },
  clear_risk: { targetStatus: 'Available', event: 'MARKETPLACE_LISTING_RISK_CLEARED' },
  request_evidence: { targetStatus: null, event: 'MARKETPLACE_EVIDENCE_REQUESTED' },
};

export function assertModerator(actor) {
  const role = String(actor?.role || actor?.platformRole || '').toLowerCase();
  if (!MODERATOR_ROLES.includes(role)) {
    throw new ForbiddenError('Admin or reviewer role required for marketplace moderation.');
  }
}

/** Map a raw vehicle status to the marketplace public_status enum. */
export function deriveListingPublicStatus(status) {
  const norm = normalizeVehicleStatus(status);
  if (norm === 'Available' || norm === 'Reserved') return 'public';
  if (norm === 'Suspended' || norm === 'Flagged') return 'suppressed';
  if (norm === 'Banned') return 'rejected';
  if (norm === 'Archived' || norm === 'Sold') return 'archived';
  if (norm === 'Pending') return 'pending_review';
  return 'pending_review';
}

async function writeModerationAudit(client, { vin, event, previous, next, reason, notes, actor }) {
  const row = {
    event_type: event,
    vin,
    trust_fact: 'marketplace_public_status',
    previous_value: previous ?? null,
    new_value: next ?? null,
    actor_role: actor?.role || actor?.platformRole || null,
    actor_type: 'admin',
    source_route: 'marketplace_moderation',
    reason: reason || null,
    decision_notes: notes || null,
    created_at: new Date().toISOString(),
  };
  try {
    const { error } = await client.from('trust_audit_events').insert(row);
    if (error) throw error;
    return true;
  } catch (error) {
    // Audit is best-effort at the application layer; surface a warning but do not silently lose the decision.
    console.warn('[marketplace-moderation] audit write failed:', error.message);
    return false;
  }
}

/**
 * Apply a moderation action to a listing.
 * @param {object} client
 * @param {string} vin
 * @param {string} action one of MODERATION_ACTIONS
 * @param {{ reason?: string, notes?: string }} body
 * @param {object} actor req.userContext
 */
export async function moderateListing(client, vin, action, body = {}, actor = {}) {
  assertModerator(actor);
  if (!vin) throw new ValidationError('vin is required.');
  const spec = MODERATION_ACTIONS[action];
  if (!spec) throw new ValidationError('Unsupported moderation action.', { action });
  if ((action === 'reject' || action === 'suppress' || action === 'flag_risk') && !body.reason) {
    throw new ValidationError('A reason is required for this moderation action.');
  }

  const { data: rows, error } = await client.from('vehicles').select('vin, status').eq('vin', vin);
  if (error) throw error;
  const vehicle = Array.isArray(rows) ? rows[0] : rows;
  if (!vehicle) throw new NotFoundError('Listing not found.');

  const previousStatus = normalizeVehicleStatus(vehicle.status);
  let nextStatus = previousStatus;

  if (spec.targetStatus) {
    nextStatus = spec.targetStatus;
    const { error: updErr } = await client
      .from('vehicles')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('vin', vin);
    if (updErr) throw updErr;
  }

  const audited = await writeModerationAudit(client, {
    vin,
    event: spec.event,
    previous: previousStatus,
    next: nextStatus,
    reason: body.reason,
    notes: body.notes,
    actor,
  });

  return {
    vin,
    action,
    previous_status: previousStatus,
    status: nextStatus,
    public_status: deriveListingPublicStatus(nextStatus),
    audited,
  };
}

// Named convenience wrappers (route-friendly).
export const approveListing = (c, vin, b, a) => moderateListing(c, vin, 'approve', b, a);
export const rejectListing = (c, vin, b, a) => moderateListing(c, vin, 'reject', b, a);
export const suppressListing = (c, vin, b, a) => moderateListing(c, vin, 'suppress', b, a);
export const requestListingEvidence = (c, vin, b, a) => moderateListing(c, vin, 'request_evidence', b, a);
export const flagListingRisk = (c, vin, b, a) => moderateListing(c, vin, 'flag_risk', b, a);
export const clearListingRisk = (c, vin, b, a) => moderateListing(c, vin, 'clear_risk', b, a);

/**
 * Admin listing view — includes non-public listings (pending/suppressed/rejected). Still sanitized
 * (no owner_id/tenant_id) and fixture-excluded by default.
 * @param {object} client
 * @param {{ public_status?: string, risk_status?: string }} filters
 */
export async function listListingsForAdmin(client, filters = {}) {
  assertModerator(filters.actor || {});
  const { data: vehicles, error } = await client.from('vehicles').select(LISTING_SELECT_COLUMNS);
  if (error) throw error;
  const showFixtures = shouldShowFixtures();
  const candidates = (vehicles || []).filter((v) => showFixtures || getFixtureExclusion(v) === null);
  const vins = candidates.map((v) => v.vin).filter(Boolean);
  const { evidenceByVin, partSentryByVin, ownershipByVin, imagesByVin } = await fetchListingRelatedRows(client, vins);

  const rows = candidates.map((vehicle) => {
    const partSentryRows = partSentryByVin.get(vehicle.vin) || [];
    const summary = buildMarketplaceListingSummary({
      vehicle,
      evidenceRows: evidenceByVin.get(vehicle.vin) || [],
      partSentryRows,
      ownershipCount: (ownershipByVin.get(vehicle.vin) || []).length,
      imageRows: imagesByVin.get(vehicle.vin) || [],
    });
    const public_status = deriveListingPublicStatus(vehicle.status);
    const suspicion = deriveSuspicionLevel(partSentryRows);
    let risk_status = 'clear';
    if (isVehicleQuarantinedStatus(vehicle.status)) risk_status = 'blocked';
    else if (suspicion === 'flagged') risk_status = 'flagged';
    else if (suspicion === 'watch') risk_status = 'watch';
    return { ...summary, public_status, risk_status };
  });

  let filtered = rows;
  if (filters.public_status) filtered = filtered.filter((r) => r.public_status === filters.public_status);
  if (filters.risk_status) filtered = filtered.filter((r) => r.risk_status === filters.risk_status);
  return { listings: filtered, total: filtered.length };
}
