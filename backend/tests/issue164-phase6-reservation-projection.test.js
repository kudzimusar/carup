import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const reservation = await import('../services/reservation/reservationProjectionService.js');
const NOW = new Date('2026-08-19T09:00:00.000Z');

function row(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    vin: 'VIN-P6-PROJECTION-1',
    transaction_intent_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status: 'active',
    reserved_at: '2026-08-19T08:00:00.000Z',
    expires_at: '2026-08-19T10:00:00.000Z',
    created_at: '2026-08-19T08:00:00.000Z',
    updated_at: '2026-08-19T08:00:00.000Z',
    _transaction: { status: 'eligible', payment_intent_id: null, payment_state: 'not_started' },
    ...overrides,
  };
}

test('Phase 6 reservation projection: future active hold is authoritative Reserved truth', () => {
  const projected = reservation.projectReservationRows([row()], { now: NOW });
  assert.deepEqual(projected, {
    state: 'active',
    reserved: true,
    reserved_at: '2026-08-19T08:00:00.000Z',
    expires_at: '2026-08-19T10:00:00.000Z',
    reason: null,
  });
  assert.equal(reservation.projectListingStatusWithReservation('Available', projected), 'Reserved');
});

test('Phase 6 reservation projection: elapsed pre-payment hold becomes expired, not stale Reserved', () => {
  const projected = reservation.projectReservationRows([
    row({ expires_at: '2026-08-19T08:30:00.000Z' }),
  ], { now: NOW });
  assert.equal(projected.state, 'expired');
  assert.equal(projected.reserved, false);
  assert.equal(projected.reason, 'reservation_expired');
  assert.equal(reservation.projectListingStatusWithReservation('Reserved', projected), 'Available');
});

test('Phase 6 reservation projection: payment-linked elapsed hold fails closed and never becomes Available', () => {
  const projected = reservation.projectReservationRows([
    row({
      expires_at: '2026-08-19T08:30:00.000Z',
      _transaction: {
        status: 'initiated',
        payment_intent_id: 'provider-intent-private',
        payment_state: 'authorized',
      },
    }),
  ], { now: NOW });
  assert.equal(projected.state, 'inconsistent');
  assert.equal(projected.reserved, null);
  assert.equal(projected.reason, 'expired_reservation_has_payment_intent');
  assert.equal(reservation.projectListingStatusWithReservation('Reserved', projected), null);
  assert.equal(JSON.stringify(projected).includes('provider-intent-private'), false);
});

test('Phase 6 reservation projection: elapsed hold with unresolved transaction is unknown, not free', () => {
  const { _transaction: _discard, ...unresolved } = row({ expires_at: '2026-08-19T08:30:00.000Z' });
  const projected = reservation.projectReservationRows([unresolved], { now: NOW });
  assert.equal(projected.state, 'inconsistent');
  assert.equal(projected.reserved, null);
  assert.equal(projected.reason, 'expired_reservation_transaction_unresolved');
  assert.equal(reservation.projectListingStatusWithReservation('Reserved', projected), null);
});

test('Phase 6 reservation projection: duplicate live holds and invalid expiry fail closed', () => {
  const duplicate = reservation.projectReservationRows([
    row(),
    row({ id: '22222222-2222-4222-8222-222222222222' }),
  ], { now: NOW });
  assert.equal(duplicate.state, 'inconsistent');
  assert.equal(duplicate.reason, 'multiple_live_reservations');

  const invalid = reservation.projectReservationRows([row({ expires_at: 'not-a-time' })], { now: NOW });
  assert.equal(invalid.state, 'inconsistent');
  assert.equal(invalid.reason, 'active_reservation_missing_valid_expiry');
});

test('Phase 6 reservation projection: a successful canonical read with no rows means none', () => {
  const projected = reservation.projectReservationRows([], { now: NOW });
  assert.deepEqual(projected, {
    state: 'none',
    reserved: false,
    reserved_at: null,
    expires_at: null,
    reason: null,
  });
});

test('Phase 6 reservation expiry migration closes direct browser grants and skips payment-linked auto-release', () => {
  const source = fs.readFileSync(
    new URL('../../database/migrations/20260819124000_issue164_phase6_reservation_expiry_reconciliation.sql', import.meta.url),
    'utf8',
  );
  for (const table of [
    'escrow_trust_sessions',
    'escrow_trust_events',
    'escrow_trust_webhook_events',
    'vehicle_reservations',
  ]) {
    assert.match(source, new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM anon,authenticated`, 'i'));
  }
  assert.match(source, /payment_intent_id IS NOT NULL/);
  assert.match(source, /skipped_payment_linked/);
  assert.match(source, /issue164_reconcile_expired_reservations/);
});

test('Phase 6 listing detail consumes reservation authority rather than trusting the vehicle cache', () => {
  const source = fs.readFileSync(
    new URL('../services/marketplace/marketplaceListingDetailService.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /getPublicReservationProjection/);
  assert.match(source, /projectListingStatusWithReservation/);
  assert.match(source, /reservation_summary/);
  assert.doesNotMatch(source, /reservation_summary:\s*\{[^}]*buyer_id/s);
});
