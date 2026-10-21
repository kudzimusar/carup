/**
 * CARUP-MVP-STAB-01 F-022 — the one answer to "may this sailing take a NEW booking right now?".
 *
 * Before F-022 the only temporal rule anywhere was T3 discovery's deadline check. Every other surface
 * read the stored status alone, and nothing closes a sailing automatically, so a sailing whose cut-off
 * — or departure — had long passed stayed BOOKING_OPEN and kept taking requests. These tests pin the
 * pure rule every surface now shares: its precedence, its boundaries, its treatment of missing and
 * unreadable dates, T5's "Full" semantics, and the refusal shape the booking paths raise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const {
  containerBookingEligibility,
  assertContainerBookable,
  formatSailingDate,
  BOOKING_ELIGIBILITY_STATES,
  BOOKING_REFUSAL_CODES,
} = await import('../services/diaspora/containerBookingEligibility.js');
const { ValidationError } = await import('../utils/errors.js');

const NOW = new Date('2026-10-21T12:00:00.000Z');
const DAY = 24 * 3600 * 1000;
const at = (days) => new Date(NOW.getTime() + days * DAY).toISOString();

function sailing(overrides = {}) {
  return {
    id: 'sail-1', status: 'BOOKING_OPEN',
    booking_deadline: at(10), departure_date: at(20),
    total_capacity_volume: 60, used_capacity_volume: 0, available_capacity_volume: 60,
    metadata: {},
    ...overrides,
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// ── the states ──────────────────────────────────────────────────────────────

test('a BOOKING_OPEN sailing with its cut-off and departure ahead is open and bookable', () => {
  assert.deepEqual(containerBookingEligibility(sailing(), NOW), { state: 'open', bookable: true, reason: null });
});

test('every stored status other than BOOKING_OPEN is not_open — even with every date ahead', () => {
  for (const status of ['DRAFT', 'BOOKING_CLOSED', 'LOADING', 'SHIPPED', 'ARRIVED', 'COMPLETED', 'CANCELLED', undefined, 'booking_open']) {
    const result = containerBookingEligibility(sailing({ status }), NOW);
    assert.equal(result.state, 'not_open', `status ${status}`);
    assert.equal(result.bookable, false, `status ${status}`);
    assert.equal(result.reason, 'This sailing is not open for booking.');
  }
});

test('a missing sailing is not open', () => {
  for (const value of [null, undefined]) {
    assert.deepEqual(containerBookingEligibility(value, NOW), {
      state: 'not_open', bookable: false, reason: 'This sailing is not open for booking.',
    });
  }
});

test('a passed departure is departed — and departed outranks a passed cut-off', () => {
  const result = containerBookingEligibility(sailing({ booking_deadline: at(-10), departure_date: at(-5) }), NOW);
  assert.equal(result.state, 'departed');
  assert.equal(result.bookable, false);
  assert.equal(result.reason, 'This sailing departed on 16 Oct 2026 and no longer takes bookings.');
});

test('a passed cut-off with the departure still ahead is deadline_passed', () => {
  const result = containerBookingEligibility(sailing({ booking_deadline: at(-1), departure_date: at(5) }), NOW);
  assert.deepEqual(result, {
    state: 'deadline_passed', bookable: false, reason: 'Booking for this sailing closed on 20 Oct 2026.',
  });
});

test('the stored status outranks the dates: a closed, departed sailing is not_open', () => {
  const result = containerBookingEligibility(sailing({ status: 'BOOKING_CLOSED', booking_deadline: at(-10), departure_date: at(-5) }), NOW);
  assert.equal(result.state, 'not_open');
});

// ── boundaries ──────────────────────────────────────────────────────────────

test('the cut-off instant itself is still open; one millisecond later it has passed (the T3 discovery rule)', () => {
  // T3 discovery keeps a sailing while Date.parse(booking_deadline) >= now. Two surfaces that
  // disagreed by a millisecond would offer a sailing one of them then refuses.
  assert.equal(containerBookingEligibility(sailing({ booking_deadline: NOW.toISOString() }), NOW).state, 'open');
  assert.equal(containerBookingEligibility(sailing({ booking_deadline: new Date(NOW.getTime() - 1).toISOString() }), NOW).state, 'deadline_passed');
});

test('the departure instant itself has not departed; one millisecond later it has', () => {
  const base = { booking_deadline: at(-1) };
  assert.equal(containerBookingEligibility(sailing({ ...base, departure_date: NOW.toISOString() }), NOW).state, 'deadline_passed');
  assert.equal(containerBookingEligibility(sailing({ ...base, departure_date: new Date(NOW.getTime() - 1).toISOString() }), NOW).state, 'departed');
});

test('a NULL or absent date is "not recorded", which is not "passed" (the T3 discovery rule)', () => {
  for (const overrides of [
    { booking_deadline: null },
    { departure_date: null },
    { booking_deadline: null, departure_date: null },
    { booking_deadline: undefined, departure_date: undefined },
    { booking_deadline: '', departure_date: '' },
  ]) {
    assert.equal(containerBookingEligibility(sailing(overrides), NOW).state, 'open', JSON.stringify(overrides));
  }
  const { booking_deadline: _deadline, departure_date: _departure, ...undated } = sailing();
  assert.equal(containerBookingEligibility(undated, NOW).state, 'open');
});

test('a date that is present but unreadable is treated as passed, with copy that never prints "Invalid Date"', () => {
  const deadline = containerBookingEligibility(sailing({ booking_deadline: 'not-a-date' }), NOW);
  assert.equal(deadline.state, 'deadline_passed');
  assert.equal(deadline.bookable, false);
  assert.doesNotMatch(deadline.reason, /invalid date|NaN|undefined/i);
  assert.match(deadline.reason, /cut-off could not be read/i);

  const departure = containerBookingEligibility(sailing({ departure_date: 'garbage' }), NOW);
  assert.equal(departure.state, 'departed');
  assert.doesNotMatch(departure.reason, /invalid date|NaN|undefined/i);
  assert.match(departure.reason, /departure date could not be read/i);

  assert.equal(containerBookingEligibility(sailing({ booking_deadline: new Date('nope') }), NOW).state, 'deadline_passed');
});

test('a date-only value is that calendar day at 00:00 UTC — the moment the database stores', () => {
  // The operator form captures a calendar date; a TIMESTAMPTZ column stores it as midnight UTC.
  assert.equal(containerBookingEligibility(sailing({ booking_deadline: '2026-10-21', departure_date: '2026-11-01' }), NOW).state, 'deadline_passed');
  assert.equal(containerBookingEligibility(sailing({ booking_deadline: '2026-10-22', departure_date: '2026-11-01' }), NOW).state, 'open');
});

// ── capacity: T5's own "Full" semantics, nothing new ────────────────────────

test('full is the capacity T5 already recorded: metadata.capacity.full, or no available space recorded', () => {
  assert.equal(containerBookingEligibility(sailing({ metadata: { capacity: { fillPercent: 0.98, readyToClose: true, full: true } } }), NOW).state, 'full');
  for (const available of [0, '0', '0.000', -1]) {
    assert.equal(containerBookingEligibility(sailing({ available_capacity_volume: available }), NOW).state, 'full', `available ${available}`);
  }
  const full = containerBookingEligibility(sailing({ available_capacity_volume: 0 }), NOW);
  assert.equal(full.bookable, false);
  assert.equal(full.reason, 'This sailing is full and cannot take more bookings.');
});

test('"Ready to close" is not full, and an unrecorded available volume is not full', () => {
  assert.equal(containerBookingEligibility(sailing({ metadata: { capacity: { fillPercent: 0.9, readyToClose: true, full: false } }, available_capacity_volume: 6 }), NOW).state, 'open');
  for (const available of [null, undefined, '', 'unknown']) {
    assert.equal(containerBookingEligibility(sailing({ available_capacity_volume: available }), NOW).state, 'open', `available ${available}`);
  }
  assert.equal(containerBookingEligibility(sailing({ metadata: null }), NOW).state, 'open');
});

test('a passed cut-off outranks full — the earlier reason is the one a participant can act on', () => {
  assert.equal(containerBookingEligibility(sailing({ booking_deadline: at(-1), available_capacity_volume: 0 }), NOW).state, 'deadline_passed');
});

test('an authoritative capacity, when supplied, decides full instead of the cached row', () => {
  const cachedFull = sailing({ available_capacity_volume: 0, metadata: { capacity: { full: true } } });
  assert.equal(containerBookingEligibility(cachedFull, NOW, { capacity: { full: false, availableVolume: 20 } }).state, 'open',
    'a stale cache must not refuse a sailing the APPROVED reservations say has room');
  assert.equal(containerBookingEligibility(sailing(), NOW, { capacity: { full: true, availableVolume: 1 } }).state, 'full');
  assert.equal(containerBookingEligibility(sailing(), NOW, { capacity: { full: false, availableVolume: 0 } }).state, 'full');
  assert.equal(containerBookingEligibility(sailing({ booking_deadline: at(-1) }), NOW, { capacity: { full: false, availableVolume: 20 } }).state, 'deadline_passed',
    'capacity never re-opens a sailing whose cut-off has passed');
});

// ── purity and the clock ────────────────────────────────────────────────────

test('the rule never mutates the sailing — it reads the stored row, it does not change it', () => {
  const rows = [
    sailing(),
    sailing({ booking_deadline: at(-1), departure_date: at(5) }),
    sailing({ booking_deadline: at(-10), departure_date: at(-5) }),
    sailing({ status: 'DRAFT' }),
    sailing({ available_capacity_volume: 0, metadata: { capacity: { full: true } } }),
  ];
  for (const row of rows) {
    const before = JSON.stringify(row);
    deepFreeze(row);
    containerBookingEligibility(row, NOW);
    assert.equal(JSON.stringify(row), before);
    assert.equal(row.status, JSON.parse(before).status, 'stored status is untouched');
  }
});

test('`now` defaults to the clock and accepts a Date, an epoch or an ISO string; an unreadable now is a programming error', () => {
  const far = sailing({ booking_deadline: '2999-01-01T00:00:00Z', departure_date: '2999-02-01T00:00:00Z' });
  assert.equal(containerBookingEligibility(far).state, 'open');
  const expired = sailing({ booking_deadline: '2001-01-01T00:00:00Z', departure_date: '2999-02-01T00:00:00Z' });
  assert.equal(containerBookingEligibility(expired).state, 'deadline_passed', 'the default clock is the real one');
  assert.equal(containerBookingEligibility(expired, NOW.getTime()).state, 'deadline_passed');
  assert.equal(containerBookingEligibility(expired, NOW.toISOString()).state, 'deadline_passed');
  assert.equal(containerBookingEligibility(expired, new Date('2000-06-01T00:00:00Z')).state, 'open');
  assert.throws(() => containerBookingEligibility(far, 'not-a-time'), TypeError);
});

// ── vocabulary ──────────────────────────────────────────────────────────────

test('the state and refusal-code vocabularies are fixed', () => {
  assert.deepEqual(Object.values(BOOKING_ELIGIBILITY_STATES).sort(), ['deadline_passed', 'departed', 'full', 'not_open', 'open']);
  assert.ok(Object.isFrozen(BOOKING_ELIGIBILITY_STATES));
  assert.deepEqual(BOOKING_REFUSAL_CODES, {
    deadline_passed: 'DIASPORA_CONTAINER/BOOKING_DEADLINE_PASSED',
    departed: 'DIASPORA_CONTAINER/SAILING_DEPARTED',
    full: 'DIASPORA_CONTAINER/SAILING_FULL',
  });
  assert.ok(Object.isFrozen(BOOKING_REFUSAL_CODES));
});

test('dates are shown as a plain UTC calendar date', () => {
  assert.equal(formatSailingDate('2026-10-08T00:00:00Z'), '8 Oct 2026');
  assert.equal(formatSailingDate('2026-10-08'), '8 Oct 2026');
  assert.equal(formatSailingDate('2026-10-08T23:30:00Z'), '8 Oct 2026', 'the UTC calendar day, not the server zone');
  assert.equal(formatSailingDate(new Date('2026-12-25T10:00:00Z')), '25 Dec 2026');
  for (const value of [null, undefined, '', 'garbage']) assert.equal(formatSailingDate(value), null);
});

// ── the refusal the booking paths raise ─────────────────────────────────────

test('assertContainerBookable returns the eligibility of a bookable sailing', () => {
  assert.deepEqual(assertContainerBookable(sailing(), { now: NOW }), { state: 'open', bookable: true, reason: null });
});

test('assertContainerBookable refuses a passed cut-off with a stable code that is the ERROR code, not only a detail', () => {
  const row = sailing({ booking_deadline: '2026-10-20T00:00:00Z', departure_date: '2026-11-01T00:00:00Z' });
  assert.throws(() => assertContainerBookable(row, { now: NOW }), (err) => {
    assert.ok(err instanceof ValidationError);
    assert.equal(err.statusCode, 400);
    // errorMiddleware exposes `code` in every runtime but hides `details` in production-like ones.
    assert.equal(err.code, 'DIASPORA_CONTAINER/BOOKING_DEADLINE_PASSED');
    assert.equal(err.message, 'Booking for this sailing closed on 20 Oct 2026.');
    assert.deepEqual(err.details, {
      code: 'DIASPORA_CONTAINER/BOOKING_DEADLINE_PASSED',
      state: 'deadline_passed',
      booking_deadline: '2026-10-20T00:00:00Z',
      departure_date: '2026-11-01T00:00:00Z',
    });
    return true;
  });
});

test('assertContainerBookable refuses a departed sailing and a full one with their own codes', () => {
  assert.throws(() => assertContainerBookable(sailing({ booking_deadline: at(-10), departure_date: at(-5) }), { now: NOW }),
    (err) => err.code === 'DIASPORA_CONTAINER/SAILING_DEPARTED' && err.statusCode === 400
      && err.message === 'This sailing departed on 16 Oct 2026 and no longer takes bookings.');
  assert.throws(() => assertContainerBookable(sailing({ available_capacity_volume: 0 }), { now: NOW }),
    (err) => err.code === 'DIASPORA_CONTAINER/SAILING_FULL' && err.statusCode === 400);
});

test('assertContainerBookable keeps the existing not-open refusal exactly: caller message, generic code, no details', () => {
  assert.throws(() => assertContainerBookable(sailing({ status: 'BOOKING_CLOSED' }), { now: NOW, notOpenMessage: 'Container is not open for booking' }), (err) => {
    assert.ok(err instanceof ValidationError);
    assert.equal(err.message, 'Container is not open for booking');
    assert.equal(err.code, 'VALIDATION_FAILED');
    assert.equal(err.details, null);
    return true;
  });
  assert.throws(() => assertContainerBookable(sailing({ status: 'DRAFT' }), { now: NOW }), /This sailing is not open for booking\./);
});
