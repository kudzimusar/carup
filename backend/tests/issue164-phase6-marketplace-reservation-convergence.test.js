import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const {
  getPublicReservationProjectionBatch,
  projectListingStatusWithReservation,
} = await import('../services/reservation/reservationProjectionService.js');

const NOW = new Date('2026-08-19T09:00:00.000Z');

function reservationRow(vin, overrides = {}) {
  return {
    id: `${vin}-reservation`,
    vin,
    transaction_intent_id: `${vin}-tx`,
    status: 'active',
    reserved_at: '2026-08-19T08:00:00.000Z',
    expires_at: '2026-08-19T10:00:00.000Z',
    created_at: '2026-08-19T08:00:00.000Z',
    updated_at: '2026-08-19T08:00:00.000Z',
    ...overrides,
  };
}

function batchClient({ rows = [], transactions = [], reservationError = null, transactionError = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      if (table === 'vehicle_reservations') {
        const builder = {
          select() { calls.push(['reservation.select']); return this; },
          in(_field, values) { calls.push(['reservation.in', [...values]]); return this; },
          async order() {
            calls.push(['reservation.order']);
            return { data: reservationError ? null : rows, error: reservationError };
          },
        };
        return builder;
      }
      if (table === 'escrow_trust_sessions') {
        return {
          select() { calls.push(['transaction.select']); return this; },
          async in(_field, values) {
            calls.push(['transaction.in', [...values]]);
            return { data: transactionError ? null : transactions, error: transactionError };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test('Phase 6: batch reservation projection converges active and expired list-card truth in two reads max', async () => {
  const activeVin = 'VIN-LIST-ACTIVE';
  const expiredVin = 'VIN-LIST-EXPIRED';
  const noneVin = 'VIN-LIST-NONE';
  const client = batchClient({
    rows: [
      reservationRow(activeVin),
      reservationRow(expiredVin, { expires_at: '2026-08-19T08:30:00.000Z' }),
    ],
    transactions: [
      { id: `${expiredVin}-tx`, status: 'eligible', payment_intent_id: null, payment_state: 'not_started' },
    ],
  });

  const projected = await getPublicReservationProjectionBatch(
    [activeVin, expiredVin, noneVin],
    { client, now: NOW },
  );

  assert.equal(projected.get(activeVin).state, 'active');
  assert.equal(projectListingStatusWithReservation('Available', projected.get(activeVin)), 'Reserved');
  assert.equal(projected.get(expiredVin).state, 'expired');
  assert.equal(projectListingStatusWithReservation('Reserved', projected.get(expiredVin)), 'Available');
  assert.equal(projected.get(noneVin).state, 'none');
  assert.equal(projectListingStatusWithReservation('Available', projected.get(noneVin)), 'Available');

  assert.equal(client.calls.filter(([name]) => name === 'reservation.in').length, 1);
  assert.equal(client.calls.filter(([name]) => name === 'transaction.in').length, 1);
});

test('Phase 6: batch reservation read failure marks every requested VIN unavailable, never none', async () => {
  const client = batchClient({ reservationError: { message: 'table unavailable' } });
  const projected = await getPublicReservationProjectionBatch(['VIN-1', 'VIN-2'], { client, now: NOW });
  for (const vin of ['VIN-1', 'VIN-2']) {
    assert.equal(projected.get(vin).state, 'unavailable');
    assert.equal(projected.get(vin).reserved, null);
  }
});

test('Phase 6: expired reservation enrichment failure also fails the whole public batch closed', async () => {
  const client = batchClient({
    rows: [reservationRow('VIN-1', { expires_at: '2026-08-19T08:30:00.000Z' })],
    transactionError: { message: 'session read unavailable' },
  });
  const projected = await getPublicReservationProjectionBatch(['VIN-1', 'VIN-2'], { client, now: NOW });
  assert.equal(projected.get('VIN-1').state, 'unavailable');
  assert.equal(projected.get('VIN-2').state, 'unavailable');
});

test('Phase 6: Marketplace list route overlays reservation status and publishes the same reservation envelope as detail', () => {
  const routes = fs.readFileSync(new URL('../routes/marketplaceRoutes.js', import.meta.url), 'utf8');
  const detail = fs.readFileSync(
    new URL('../services/marketplace/marketplaceListingDetailService.js', import.meta.url),
    'utf8',
  );
  assert.match(routes, /getPublicReservationProjectionBatch/);
  assert.match(routes, /projectListingStatusWithReservation/);
  assert.match(routes, /reservation_summary:\s*reservationSummary/);
  assert.match(detail, /getPublicReservationProjection/);
  assert.match(detail, /projectListingStatusWithReservation/);
  assert.match(detail, /reservation_summary:\s*reservationSummary/);
});
