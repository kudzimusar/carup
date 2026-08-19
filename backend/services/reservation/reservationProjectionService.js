import { supabase } from '../../db/supabase.js';

/**
 * Issue #164 Phase 6 — public-safe reservation read authority.
 *
 * `vehicle_reservations` is authoritative. `vehicles.status/reserved_until/active_reservation_id`
 * are materialized cache fields only and are never sufficient to assert that a hold is active.
 *
 * This module is deliberately READ-ONLY: reading a listing must never mutate expiry state. The
 * reconciliation function in the Phase 6 migration repairs the cache asynchronously; this projection
 * stays correct even before that repair runs because it evaluates `expires_at` at read time.
 */
export const RESERVATION_PROJECTION_STATES = Object.freeze({
  ACTIVE: 'active',
  EXPIRED: 'expired',
  NONE: 'none',
  UNAVAILABLE: 'unavailable',
  INCONSISTENT: 'inconsistent',
});

const RESERVATION_SELECT = [
  'id',
  'vin',
  'transaction_intent_id',
  'status',
  'reserved_at',
  'expires_at',
  'created_at',
  'updated_at',
].join(',');

function asTime(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : null;
}

function safeIso(value) {
  const time = asTime(value);
  return time === null ? null : new Date(time).toISOString();
}

/**
 * Pure projection for one VIN.
 *
 * Important distinctions:
 * - active + future expiry => ACTIVE;
 * - row still labelled active but expiry passed => EXPIRED (the cache may not be repaired yet);
 * - no canonical row => NONE only when the canonical table was actually read successfully;
 * - duplicate live rows / malformed expiry => INCONSISTENT;
 * - read failure => UNAVAILABLE, never NONE.
 *
 * No participant ids, transaction ids, idempotency keys, or provider data are published.
 */
export function projectReservationRows(rows, { now = new Date() } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const clock = Number.isFinite(nowMs) ? nowMs : Date.now();

  const activeLabelled = list.filter((row) => row?.status === 'active');
  const live = activeLabelled.filter((row) => {
    const expiry = asTime(row?.expires_at);
    return expiry !== null && expiry > clock;
  });

  if (live.length > 1) {
    return Object.freeze({
      state: RESERVATION_PROJECTION_STATES.INCONSISTENT,
      reserved: null,
      reserved_at: null,
      expires_at: null,
      reason: 'multiple_live_reservations',
    });
  }

  if (live.length === 1) {
    return Object.freeze({
      state: RESERVATION_PROJECTION_STATES.ACTIVE,
      reserved: true,
      reserved_at: safeIso(live[0].reserved_at),
      expires_at: safeIso(live[0].expires_at),
      reason: null,
    });
  }

  const expiredActive = activeLabelled
    .filter((row) => {
      const expiry = asTime(row?.expires_at);
      return expiry !== null && expiry <= clock;
    })
    .sort((a, b) => (asTime(b.expires_at) || 0) - (asTime(a.expires_at) || 0));

  if (expiredActive.length) {
    return Object.freeze({
      state: RESERVATION_PROJECTION_STATES.EXPIRED,
      reserved: false,
      reserved_at: safeIso(expiredActive[0].reserved_at),
      expires_at: safeIso(expiredActive[0].expires_at),
      reason: 'reservation_expired',
    });
  }

  if (activeLabelled.some((row) => asTime(row?.expires_at) === null)) {
    return Object.freeze({
      state: RESERVATION_PROJECTION_STATES.INCONSISTENT,
      reserved: null,
      reserved_at: null,
      expires_at: null,
      reason: 'active_reservation_missing_valid_expiry',
    });
  }

  const latestExpired = [...list]
    .filter((row) => row?.status === 'expired')
    .sort((a, b) => (asTime(b.expires_at) || asTime(b.updated_at) || 0) - (asTime(a.expires_at) || asTime(a.updated_at) || 0))[0];

  if (latestExpired) {
    return Object.freeze({
      state: RESERVATION_PROJECTION_STATES.EXPIRED,
      reserved: false,
      reserved_at: safeIso(latestExpired.reserved_at),
      expires_at: safeIso(latestExpired.expires_at),
      reason: 'reservation_expired',
    });
  }

  return Object.freeze({
    state: RESERVATION_PROJECTION_STATES.NONE,
    reserved: false,
    reserved_at: null,
    expires_at: null,
    reason: null,
  });
}

/**
 * Read one VIN's canonical reservation rows. A missing Phase 6 table / query failure is UNAVAILABLE,
 * not NONE, so pre-cutover deployments and operational faults cannot fabricate availability.
 */
export async function getPublicReservationProjection(vin, {
  client = supabase,
  now = new Date(),
} = {}) {
  const key = String(vin || '').trim();
  if (!key) {
    return Object.freeze({
      state: RESERVATION_PROJECTION_STATES.UNAVAILABLE,
      reserved: null,
      reserved_at: null,
      expires_at: null,
      reason: 'invalid_vin',
    });
  }

  try {
    const { data, error } = await client
      .from('vehicle_reservations')
      .select(RESERVATION_SELECT)
      .eq('vin', key)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return projectReservationRows(data || [], { now });
  } catch {
    return Object.freeze({
      state: RESERVATION_PROJECTION_STATES.UNAVAILABLE,
      reserved: null,
      reserved_at: null,
      expires_at: null,
      reason: 'reservation_read_unavailable',
    });
  }
}

/**
 * The listing-status view used by public detail surfaces. Only the reservation overlay is resolved
 * here; all other lifecycle states remain whatever the canonical listing row records.
 *
 * A stale `Reserved` cache is never published as a live hold:
 * - ACTIVE => Reserved
 * - EXPIRED/NONE => Available only when the raw cache said Reserved
 * - UNAVAILABLE/INCONSISTENT => null rather than guessing
 */
export function projectListingStatusWithReservation(rawStatus, reservation) {
  const status = String(rawStatus || '').trim() || null;
  const isReservedCache = status?.toLowerCase() === 'reserved';
  const state = reservation?.state;

  if (state === RESERVATION_PROJECTION_STATES.ACTIVE) return 'Reserved';
  if (state === RESERVATION_PROJECTION_STATES.EXPIRED || state === RESERVATION_PROJECTION_STATES.NONE) {
    return isReservedCache ? 'Available' : status;
  }
  if (isReservedCache && (
    state === RESERVATION_PROJECTION_STATES.UNAVAILABLE
    || state === RESERVATION_PROJECTION_STATES.INCONSISTENT
  )) return null;
  return status;
}

export default {
  RESERVATION_PROJECTION_STATES,
  projectReservationRows,
  getPublicReservationProjection,
  projectListingStatusWithReservation,
};
