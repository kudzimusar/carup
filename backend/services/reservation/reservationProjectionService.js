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

function reservationEnvelope(state, reserved, reservedAt, expiresAt, reason) {
  return Object.freeze({
    state,
    reserved,
    reserved_at: reservedAt || null,
    expires_at: expiresAt || null,
    reason: reason || null,
  });
}

function unavailableEnvelope(reason = 'reservation_read_unavailable') {
  return reservationEnvelope(
    RESERVATION_PROJECTION_STATES.UNAVAILABLE,
    null,
    null,
    null,
    reason,
  );
}

/**
 * Pure projection for one VIN.
 *
 * Important distinctions:
 * - active + future expiry => ACTIVE;
 * - active + elapsed expiry + NO provider intent => EXPIRED;
 * - active + elapsed expiry + provider intent / unresolved transaction => INCONSISTENT, never free;
 * - no canonical row => NONE only when the canonical table was actually read successfully;
 * - duplicate live rows / malformed expiry => INCONSISTENT;
 * - read failure => UNAVAILABLE, never NONE.
 *
 * `_transaction` is an internal enrichment attached by the read functions; it is consumed only to
 * decide whether an elapsed clock can safely release the public reservation view. Nothing from it is
 * copied into the public envelope.
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
    return reservationEnvelope(
      RESERVATION_PROJECTION_STATES.INCONSISTENT,
      null,
      null,
      null,
      'multiple_live_reservations',
    );
  }

  if (live.length === 1) {
    return reservationEnvelope(
      RESERVATION_PROJECTION_STATES.ACTIVE,
      true,
      safeIso(live[0].reserved_at),
      safeIso(live[0].expires_at),
      null,
    );
  }

  const expiredActive = activeLabelled
    .filter((row) => {
      const expiry = asTime(row?.expires_at);
      return expiry !== null && expiry <= clock;
    })
    .sort((a, b) => (asTime(b.expires_at) || 0) - (asTime(a.expires_at) || 0));

  if (expiredActive.length) {
    const latest = expiredActive[0];
    const tx = latest._transaction;
    // Clock expiry is safe to publish only for a pre-payment transaction. Once a provider intent
    // exists, releasing availability requires provider cancellation/reconciliation too. Missing
    // transaction context is also not proof that no payment exists.
    if (!tx) {
      return reservationEnvelope(
        RESERVATION_PROJECTION_STATES.INCONSISTENT,
        null,
        null,
        null,
        'expired_reservation_transaction_unresolved',
      );
    }
    if (tx.payment_intent_id) {
      return reservationEnvelope(
        RESERVATION_PROJECTION_STATES.INCONSISTENT,
        null,
        safeIso(latest.reserved_at),
        safeIso(latest.expires_at),
        'expired_reservation_has_payment_intent',
      );
    }
    if (!['eligible', 'cancelled', 'failed'].includes(String(tx.status || '').toLowerCase())) {
      return reservationEnvelope(
        RESERVATION_PROJECTION_STATES.INCONSISTENT,
        null,
        safeIso(latest.reserved_at),
        safeIso(latest.expires_at),
        'expired_reservation_transaction_state_unresolved',
      );
    }
    return reservationEnvelope(
      RESERVATION_PROJECTION_STATES.EXPIRED,
      false,
      safeIso(latest.reserved_at),
      safeIso(latest.expires_at),
      'reservation_expired',
    );
  }

  if (activeLabelled.some((row) => asTime(row?.expires_at) === null)) {
    return reservationEnvelope(
      RESERVATION_PROJECTION_STATES.INCONSISTENT,
      null,
      null,
      null,
      'active_reservation_missing_valid_expiry',
    );
  }

  const latestExpired = [...list]
    .filter((row) => row?.status === 'expired')
    .sort((a, b) => (asTime(b.expires_at) || asTime(b.updated_at) || 0) - (asTime(a.expires_at) || asTime(a.updated_at) || 0))[0];

  if (latestExpired) {
    return reservationEnvelope(
      RESERVATION_PROJECTION_STATES.EXPIRED,
      false,
      safeIso(latestExpired.reserved_at),
      safeIso(latestExpired.expires_at),
      'reservation_expired',
    );
  }

  return reservationEnvelope(RESERVATION_PROJECTION_STATES.NONE, false, null, null, null);
}

async function enrichElapsedActiveReservations(client, rows, now) {
  const clock = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const expiredActive = (rows || []).filter((row) => {
    if (row?.status !== 'active') return false;
    const expiry = asTime(row.expires_at);
    return expiry !== null && expiry <= (Number.isFinite(clock) ? clock : Date.now());
  });
  if (!expiredActive.length) return rows || [];

  const ids = [...new Set(expiredActive.map((row) => row.transaction_intent_id).filter(Boolean))];
  if (!ids.length) return rows || [];

  const { data, error } = await client
    .from('escrow_trust_sessions')
    .select('id, status, payment_intent_id, payment_state')
    .in('id', ids);
  if (error) throw error;
  const byId = new Map((data || []).map((row) => [row.id, row]));
  return (rows || []).map((row) => row?.status === 'active' && asTime(row.expires_at) !== null
    ? { ...row, _transaction: byId.get(row.transaction_intent_id) || null }
    : row);
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
  if (!key) return unavailableEnvelope('invalid_vin');

  try {
    const { data, error } = await client
      .from('vehicle_reservations')
      .select(RESERVATION_SELECT)
      .eq('vin', key)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const enriched = await enrichElapsedActiveReservations(client, data || [], now);
    return projectReservationRows(enriched, { now });
  } catch {
    return unavailableEnvelope();
  }
}

/**
 * Batch public projection for Marketplace list/search surfaces. Exactly one reservation query plus,
 * only when elapsed active rows exist, one transaction-enrichment query for the whole page. Every
 * requested VIN gets an entry; read failure marks the whole batch UNAVAILABLE instead of silently
 * turning an infrastructure failure into "none reserved".
 */
export async function getPublicReservationProjectionBatch(vins, {
  client = supabase,
  now = new Date(),
} = {}) {
  const wanted = [];
  const seen = new Set();
  for (const raw of Array.isArray(vins) ? vins : []) {
    const key = String(raw || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    wanted.push(key);
  }
  const out = new Map();
  if (!wanted.length) return out;

  try {
    const { data, error } = await client
      .from('vehicle_reservations')
      .select(RESERVATION_SELECT)
      .in('vin', wanted)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const enriched = await enrichElapsedActiveReservations(client, data || [], now);
    const byVin = new Map(wanted.map((vin) => [vin, []]));
    for (const row of enriched) {
      const key = String(row?.vin || '').trim();
      if (byVin.has(key)) byVin.get(key).push(row);
    }
    for (const vin of wanted) out.set(vin, projectReservationRows(byVin.get(vin), { now }));
    return out;
  } catch {
    for (const vin of wanted) out.set(vin, unavailableEnvelope());
    return out;
  }
}

/**
 * The listing-status view used by public marketplace surfaces. Only the reservation overlay is
 * resolved here; all other lifecycle states remain whatever the canonical listing row records.
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
  getPublicReservationProjectionBatch,
  projectListingStatusWithReservation,
};
