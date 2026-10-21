/**
 * CARUP-MVP-STAB-01 F-022 / TRD-002 — may this sailing take a NEW booking right now?
 *
 * One answer for every surface that lists or books a co-loaded sailing. Before this, the only
 * temporal rule anywhere was T3 discovery's cut-off check. The marketplace list, the marketplace
 * reservation, the RFQ request-space path and the legacy reservation route all read the stored
 * status alone — and nothing closes a sailing automatically — so a sailing whose cut-off, or even
 * its departure, had long passed stayed BOOKING_OPEN and kept taking requests (staging, 2026-10-21:
 * 36 of 68 open sailings had departed; 24 reservations were made after their sailing's cut-off).
 *
 * The rule is a READ over the stored row. It never writes and it never changes the stored status:
 * closing a sailing remains the operator's audited act (closeBooking). Precedence:
 *
 *   1. the stored status is not BOOKING_OPEN       → not_open
 *   2. the departure date has passed               → departed
 *   3. the booking cut-off has passed              → deadline_passed
 *   4. the capacity T5 already recorded says full  → full
 *   otherwise                                      → open
 *
 * Dates. A NULL/absent date is "not recorded", which is not "passed" — the rule T3 discovery
 * applies, so the two surfaces can never disagree about the same row. (The columns are NOT NULL;
 * this only matters for partial projections.) A date that is present but unreadable is treated as
 * passed, as T3 discovery also does: a cut-off nobody can read cannot prove a sailing is still open.
 * The cut-off instant itself is still open (`deadline >= now`), exactly T3's comparison.
 *
 * Capacity. "Full" is T5's own semantics and nothing new: `metadata.capacity.full` (approved fill
 * ≥ 98%) or no available volume recorded on the row. A caller that has the authoritative capacity
 * (computeCapacity over the APPROVED reservations) passes it, and then that decides instead — so a
 * stale cached figure can never refuse a sailing that actually has room.
 */
import { CONTAINER_STATUSES } from '../../constants/diaspora/diasporaStatuses.js';
import { ValidationError } from '../../utils/errors.js';

export const BOOKING_ELIGIBILITY_STATES = Object.freeze({
  OPEN: 'open',
  NOT_OPEN: 'not_open',
  DEPARTED: 'departed',
  DEADLINE_PASSED: 'deadline_passed',
  FULL: 'full',
});

/**
 * Stable refusal codes. They are carried as the ERROR's own `code`, which errorMiddleware returns
 * as `error.code` in every runtime — `details` is hidden in production-like ones, so a code that
 * lived only there would never reach a deployed client. `not_open` deliberately has none: that
 * refusal predates F-022 and keeps its exact existing shape.
 */
export const BOOKING_REFUSAL_CODES = Object.freeze({
  [BOOKING_ELIGIBILITY_STATES.DEADLINE_PASSED]: 'DIASPORA_CONTAINER/BOOKING_DEADLINE_PASSED',
  [BOOKING_ELIGIBILITY_STATES.DEPARTED]: 'DIASPORA_CONTAINER/SAILING_DEPARTED',
  [BOOKING_ELIGIBILITY_STATES.FULL]: 'DIASPORA_CONTAINER/SAILING_FULL',
});

const NOT_OPEN_REASON = 'This sailing is not open for booking.';

// A plain calendar date in UTC — the same calendar day the ISO value names, wherever this runs.
const SAILING_DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
});

/** null when absent; NaN when present but unreadable; otherwise epoch milliseconds. */
function instantOf(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return Date.parse(String(value));
}

function nowMsOf(now) {
  const ms = instantOf(now ?? new Date());
  if (!Number.isFinite(ms)) throw new TypeError('containerBookingEligibility: `now` must be a valid date');
  return ms;
}

/** "8 Oct 2026" — or null when there is no readable date. */
export function formatSailingDate(value) {
  const ms = instantOf(value);
  return Number.isFinite(ms) ? SAILING_DATE_FORMAT.format(new Date(ms)) : null;
}

/** Present-and-passed, or present-and-unreadable. Absent is never passed. */
function hasPassed(value, nowMs) {
  const ms = instantOf(value);
  if (ms === null) return false;
  if (!Number.isFinite(ms)) return true;
  return ms < nowMs;
}

function recordedFull(container, capacity) {
  if (capacity) {
    const available = Number(capacity.availableVolume);
    return capacity.full === true || (Number.isFinite(available) && available <= 0);
  }
  if (container?.metadata?.capacity?.full === true) return true;
  const raw = container?.available_capacity_volume;
  if (raw === null || raw === undefined || raw === '') return false;
  const available = Number(raw);
  return Number.isFinite(available) && available <= 0;
}

function refusal(state, reason) {
  return { state, bookable: false, reason };
}

/**
 * @param {object|null} container  the stored sailing row
 * @param {Date|number|string} [now]
 * @param {{ capacity?: { full?: boolean, availableVolume?: number } }} [options]
 * @returns {{ state: 'open'|'not_open'|'departed'|'deadline_passed'|'full', bookable: boolean, reason: string|null }}
 */
export function containerBookingEligibility(container, now = new Date(), { capacity = null } = {}) {
  const nowMs = nowMsOf(now);
  if (!container || container.status !== CONTAINER_STATUSES.BOOKING_OPEN) {
    return refusal(BOOKING_ELIGIBILITY_STATES.NOT_OPEN, NOT_OPEN_REASON);
  }
  if (hasPassed(container.departure_date, nowMs)) {
    const date = formatSailingDate(container.departure_date);
    return refusal(BOOKING_ELIGIBILITY_STATES.DEPARTED, date
      ? `This sailing departed on ${date} and no longer takes bookings.`
      : 'This sailing\'s departure date could not be read, so it cannot take bookings.');
  }
  if (hasPassed(container.booking_deadline, nowMs)) {
    const date = formatSailingDate(container.booking_deadline);
    return refusal(BOOKING_ELIGIBILITY_STATES.DEADLINE_PASSED, date
      ? `Booking for this sailing closed on ${date}.`
      : 'Booking for this sailing is closed: its booking cut-off could not be read.');
  }
  if (recordedFull(container, capacity)) {
    return refusal(BOOKING_ELIGIBILITY_STATES.FULL, 'This sailing is full and cannot take more bookings.');
  }
  return { state: BOOKING_ELIGIBILITY_STATES.OPEN, bookable: true, reason: null };
}

/**
 * Refuse a NEW booking on a sailing that cannot take one — before any write. Returns the
 * eligibility when the sailing is bookable.
 *
 * `notOpenMessage` keeps each caller's pre-F-022 not-open refusal byte-for-byte (its message, the
 * generic VALIDATION_FAILED code and no details); only the refusals F-022 introduces carry codes.
 */
export function assertContainerBookable(container, { now = new Date(), capacity = null, notOpenMessage = NOT_OPEN_REASON } = {}) {
  const eligibility = containerBookingEligibility(container, now, { capacity });
  if (eligibility.bookable) return eligibility;
  if (eligibility.state === BOOKING_ELIGIBILITY_STATES.NOT_OPEN) throw new ValidationError(notOpenMessage);
  const code = BOOKING_REFUSAL_CODES[eligibility.state];
  const error = new ValidationError(eligibility.reason, {
    code,
    state: eligibility.state,
    booking_deadline: container?.booking_deadline ?? null,
    departure_date: container?.departure_date ?? null,
  });
  error.code = code;
  throw error;
}
