/**
 * Regression test for the TEST MOCK itself.
 *
 * `mockSupabase.UNIQUE_INDEXES` originally accepted only a plain column list, which cannot
 * express a PARTIAL unique index. Service Network relies on one:
 *
 *     uq_work_order_assignments_live:
 *       UNIQUE (work_order_id) WHERE unassigned_at IS NULL
 *
 * Registered as a plain list `['work_order_id', 'unassigned_at']` it never fired, because
 * every LIVE row has NULL in `unassigned_at` and NULLs never collide. The consequence was
 * not a cosmetic gap: a concurrent double-assignment test passed while leaving **two
 * current mechanics** on one work order — the mock asserting the opposite of PostgreSQL.
 *
 * These tests pin the mock's own behaviour so the gap cannot silently reopen. The same
 * invariant is independently proven against REAL PostgreSQL in
 * database/test/service_network_s4_check.mjs, so neither proof stands alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { UNIQUE_INDEXES, createMockSupabase } from './helpers/mockSupabase.js';

const WO = 'wo-1';
const OTHER_WO = 'wo-2';
const TENANT = '11111111-1111-1111-1111-111111111111';

const assignment = (over = {}) => ({
  work_order_id: WO, tenant_id: TENANT, mechanic_user_id: 'u-mech-1',
  assigned_by_user_id: 'u-mgr', unassigned_at: null, ...over,
});

function client() {
  return createMockSupabase({ work_order_assignments: [] });
}

test('the live-assignment index is registered as PARTIAL, carrying its predicate', () => {
  const entries = UNIQUE_INDEXES.work_order_assignments;
  assert.ok(Array.isArray(entries) && entries.length >= 1);
  const partial = entries.find((e) => !Array.isArray(e) && typeof e.where === 'function');
  assert.ok(partial, 'a plain column list cannot express WHERE unassigned_at IS NULL');
  assert.deepEqual(partial.columns, ['work_order_id']);
  // the predicate must select exactly the LIVE rows
  assert.equal(partial.where({ unassigned_at: null }), true);
  assert.equal(partial.where({}), true, 'an unset column is NULL');
  assert.equal(partial.where({ unassigned_at: '2026-08-01T00:00:00Z' }), false);
});

test('a second LIVE assignment for the same work order is rejected with 23505', async () => {
  const c = client();
  const first = await c.from('work_order_assignments').insert(assignment()).select().single();
  assert.equal(first.error, null);

  const second = await c.from('work_order_assignments').insert(assignment({ mechanic_user_id: 'u-mech-2' })).select().single();
  assert.equal(second.error?.code, '23505', 'PostgreSQL would refuse this; the mock must too');
  assert.equal(c._tables.work_order_assignments.length, 1);
});

test('many HISTORICAL (unassigned) rows for one work order are allowed', async () => {
  const c = client();
  // three closed assignments — all legitimate history
  for (const [i, mech] of [['1', 'u-mech-1'], ['2', 'u-mech-2'], ['3', 'u-mech-3']]) {
    const res = await c.from('work_order_assignments')
      .insert(assignment({ mechanic_user_id: mech, unassigned_at: `2026-08-0${i}T00:00:00Z` }))
      .select().single();
    assert.equal(res.error, null, `historical row ${i} must be allowed`);
  }
  // and one live row alongside them
  const live = await c.from('work_order_assignments').insert(assignment()).select().single();
  assert.equal(live.error, null, 'exactly one live row is permitted beside the history');
  assert.equal(c._tables.work_order_assignments.length, 4);

  // but not a second live one
  const extra = await c.from('work_order_assignments').insert(assignment({ mechanic_user_id: 'u-mech-9' })).select().single();
  assert.equal(extra.error?.code, '23505');
});

test('the predicate is per-work-order — a live row elsewhere does not collide', async () => {
  const c = client();
  await c.from('work_order_assignments').insert(assignment()).select().single();
  const other = await c.from('work_order_assignments')
    .insert(assignment({ work_order_id: OTHER_WO })).select().single();
  assert.equal(other.error, null, 'a different work order may have its own live assignment');
  assert.equal(c._tables.work_order_assignments.length, 2);
});

test('reassignment works: close the live row, then a new live row is accepted', async () => {
  const c = client();
  await c.from('work_order_assignments').insert(assignment()).select().single();
  await c.from('work_order_assignments')
    .update({ unassigned_at: '2026-08-05T00:00:00Z' })
    .eq('work_order_id', WO).is('unassigned_at', null);

  const next = await c.from('work_order_assignments')
    .insert(assignment({ mechanic_user_id: 'u-mech-2' })).select().single();
  assert.equal(next.error, null);
  const live = c._tables.work_order_assignments.filter((a) => !a.unassigned_at);
  assert.equal(live.length, 1);
  assert.equal(live[0].mechanic_user_id, 'u-mech-2');
});

test('plain (non-partial) unique indexes still behave as before', async () => {
  // service_cases.source_inquiry_id is registered as a plain list; NULLs must not collide.
  const c = createMockSupabase({ service_cases: [] });
  const a = await c.from('service_cases').insert({ id: 'c1', source_inquiry_id: null }).select().single();
  const b = await c.from('service_cases').insert({ id: 'c2', source_inquiry_id: null }).select().single();
  assert.equal(a.error, null);
  assert.equal(b.error, null, 'NULLs never collide (NULLS DISTINCT)');

  await c.from('service_cases').insert({ id: 'c3', source_inquiry_id: 'inq-1' }).select().single();
  const dup = await c.from('service_cases').insert({ id: 'c4', source_inquiry_id: 'inq-1' }).select().single();
  assert.equal(dup.error?.code, '23505');
});
