/**
 * Phase 6 backend tests — authoritative container capacity rules, overfill rejection (incl.
 * concurrent approvals), 90%/98% thresholds, release on cancel/reject, authorization, participant
 * data isolation, and "close booking does not complete shipment".
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const m = await import('../services/diaspora/diasporaContainerMarketplaceService.js');

const buyerA = { id: 'a', userId: 'a', role: 'owner', platformRole: 'owner', tenantId: null };
const buyerB = { id: 'b', userId: 'b', role: 'owner', platformRole: 'owner', tenantId: null };
const reviewer = { id: 'rev', userId: 'rev', role: 'reviewer', platformRole: 'reviewer', tenantId: null };

function client(seed = {}) {
  return createMockSupabase({
    diaspora_container_shipments: [],
    diaspora_cargo_reservations: [],
    diaspora_import_audit_log: [],
    ...seed,
  });
}

function containerSeed(total = 100) {
  return [{ id: 'cont-1', tenant_id: null, status: 'BOOKING_OPEN', total_capacity_volume: total, used_capacity_volume: 0, available_capacity_volume: total, coordinator_id: 'rev', metadata: {} }];
}

test('computeCapacity sums only APPROVED reservations', () => {
  const cap = m.computeCapacity({ total_capacity_volume: 100 }, [
    { reservation_status: 'APPROVED', estimated_volume: 30 },
    { reservation_status: 'REQUESTED', estimated_volume: 40 },
    { reservation_status: 'REJECTED', estimated_volume: 50 },
  ])
  assert.equal(cap.usedVolume, 30)
  assert.equal(cap.availableVolume, 70)
})

test('approved reservation reduces available capacity', async () => {
  const c = client({ diaspora_container_shipments: containerSeed(100) })
  const r = await m.requestReservation('cont-1', { estimated_volume: 40 }, buyerA, { supabaseClient: c })
  const { capacity } = await m.approveReservation(r.id, reviewer, { supabaseClient: c })
  assert.equal(capacity.usedVolume, 40)
  assert.equal(capacity.availableVolume, 60)
})

test('overfill is rejected at approval (single)', async () => {
  const c = client({ diaspora_container_shipments: containerSeed(50) })
  const r = await m.requestReservation('cont-1', { estimated_volume: 40 }, buyerA, { supabaseClient: c })
  await m.approveReservation(r.id, reviewer, { supabaseClient: c })
  const r2 = await m.requestReservation('cont-1', { estimated_volume: 20 }, buyerB, { supabaseClient: c })
  await assert.rejects(() => m.approveReservation(r2.id, reviewer, { supabaseClient: c }), /overfill/i)
})

test('concurrent approvals cannot overfill (authoritative recompute)', async () => {
  const c = client({ diaspora_container_shipments: containerSeed(50) })
  // two pending reservations each fit individually against an empty container
  const r1 = await m.requestReservation('cont-1', { estimated_volume: 30 }, buyerA, { supabaseClient: c })
  const r2 = await m.requestReservation('cont-1', { estimated_volume: 30 }, buyerB, { supabaseClient: c })
  await m.approveReservation(r1.id, reviewer, { supabaseClient: c })
  // second approval recomputes used=30, projected 60 > 50 → rejected
  await assert.rejects(() => m.approveReservation(r2.id, reviewer, { supabaseClient: c }), /overfill/i)
  const { capacity } = await m.getContainerCapacity('cont-1', reviewer, { supabaseClient: c })
  assert.equal(capacity.usedVolume, 30)
})

test('exact 90% is ready to close; exact 98% is full', async () => {
  const c = client({ diaspora_container_shipments: containerSeed(100) })
  const r = await m.requestReservation('cont-1', { estimated_volume: 90 }, buyerA, { supabaseClient: c })
  let res = await m.approveReservation(r.id, reviewer, { supabaseClient: c })
  assert.equal(res.capacity.readyToClose, true)
  assert.equal(res.capacity.full, false)
  const r2 = await m.requestReservation('cont-1', { estimated_volume: 8 }, buyerB, { supabaseClient: c })
  res = await m.approveReservation(r2.id, reviewer, { supabaseClient: c })
  assert.equal(res.capacity.fillPercent, 0.98)
  assert.equal(res.capacity.full, true)
})

test('cancel releases capacity', async () => {
  const c = client({ diaspora_container_shipments: containerSeed(100) })
  const r = await m.requestReservation('cont-1', { estimated_volume: 60 }, buyerA, { supabaseClient: c })
  await m.approveReservation(r.id, reviewer, { supabaseClient: c })
  let cap = (await m.getContainerCapacity('cont-1', reviewer, { supabaseClient: c })).capacity
  assert.equal(cap.usedVolume, 60)
  await m.cancelReservation(r.id, buyerA, { supabaseClient: c }) // owner cancels
  cap = (await m.getContainerCapacity('cont-1', reviewer, { supabaseClient: c })).capacity
  assert.equal(cap.usedVolume, 0)
  assert.equal(cap.availableVolume, 100)
})

test('unauthorized actor cannot approve', async () => {
  const c = client({ diaspora_container_shipments: containerSeed(100) })
  const r = await m.requestReservation('cont-1', { estimated_volume: 10 }, buyerA, { supabaseClient: c })
  await assert.rejects(() => m.approveReservation(r.id, buyerB, { supabaseClient: c }), /reviewers|admins/i)
})

test('participant cannot view another participant private reservation', async () => {
  const c = client({ diaspora_container_shipments: containerSeed(100) })
  await m.requestReservation('cont-1', { estimated_volume: 10 }, buyerA, { supabaseClient: c })
  await m.requestReservation('cont-1', { estimated_volume: 10 }, buyerB, { supabaseClient: c })
  const aView = await m.listContainerReservations('cont-1', buyerA, { supabaseClient: c })
  assert.equal(aView.length, 1)
  assert.equal(aView[0].buyer_id, 'a')
  const revView = await m.listContainerReservations('cont-1', reviewer, { supabaseClient: c })
  assert.equal(revView.length, 2)
})

test('overfill rejected even if frontend would allow (request > total)', async () => {
  const c = client({ diaspora_container_shipments: containerSeed(50) })
  await assert.rejects(() => m.requestReservation('cont-1', { estimated_volume: 60 }, buyerA, { supabaseClient: c }), /exceeds total/i)
})

test('zero/negative capacity container is invalid', async () => {
  const c = client()
  await assert.rejects(() => m.createContainer({ total_capacity_volume: 0 }, reviewer, { supabaseClient: c }), /must be positive/i)
})

test('closing booking does not complete shipment', async () => {
  const c = client({ diaspora_container_shipments: containerSeed(100) })
  const closed = await m.closeBooking('cont-1', reviewer, { supabaseClient: c })
  assert.equal(closed.status, 'BOOKING_CLOSED')
  assert.notEqual(closed.status, 'COMPLETED')
})

test('weight capacity is enforced when defined', async () => {
  const c = client({ diaspora_container_shipments: [{ id: 'cw', status: 'BOOKING_OPEN', total_capacity_volume: 1000, used_capacity_volume: 0, available_capacity_volume: 1000, coordinator_id: 'rev', metadata: { total_capacity_weight: 100 } }] })
  const r = await m.requestReservation('cw', { estimated_volume: 10, estimated_weight: 80 }, buyerA, { supabaseClient: c })
  await m.approveReservation(r.id, reviewer, { supabaseClient: c })
  const r2 = await m.requestReservation('cw', { estimated_volume: 10, estimated_weight: 30 }, buyerB, { supabaseClient: c })
  await assert.rejects(() => m.approveReservation(r2.id, reviewer, { supabaseClient: c }), /weight capacity/i)
})
