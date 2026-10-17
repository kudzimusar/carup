/**
 * Trade OS T10 — the legacy loading bypass, closed.
 *
 * The T10.0 audit found `POST /api/diaspora/containers/:id/mark-loading` marking a sailing `LOADING`
 * — and then `SHIPPED` — with **no manifest, no warehouse receipt, no attributed load and no seal**.
 * Nothing anywhere said a single consignment had gone into the container. A status is a claim, and
 * that one was free.
 *
 * The fix is deliberately not a second loading truth. `diaspora_container_loads` remains the
 * authority; the sailing's status now REFLECTS it. These tests prove the reflection cannot be faked,
 * and that the legitimate path still works — a gate that refuses everybody is not a gate.
 *
 * On the `SHIPPED` rule: requiring a COMPLETED load is the strongest precondition T10 can honestly
 * impose, because it is about loading rather than movement. Whether SHIPPED should additionally
 * require a governed T11 shipment record is T11.0's question, and implementing T11 inside T10 is
 * exactly what this phase must not do.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import { transitionContainer } from '../services/diaspora/diasporaContainerService.js';

const OPERATOR = { id: 'user-operator', platformRole: 'platform_admin', tenantRole: 'admin', tenantId: 'tenant-op' };
const CONTAINER = 'cont-1';

function world({ loads = [] } = {}) {
  return createMockSupabase({
    diaspora_container_shipments: [
      { id: CONTAINER, tenant_id: 'tenant-op', coordinator_id: 'user-operator', status: 'BOOKING_CLOSED',
        total_capacity_volume: 33, used_capacity_volume: 5.5, available_capacity_volume: 27.5, deleted_at: null },
    ],
    diaspora_cargo_reservations: [],
    diaspora_container_loads: loads,
    diaspora_import_audit_log: [],
  });
}

const opts = (client) => ({ supabaseClient: client });

test('T10: a sailing CANNOT be marked LOADING with no load record at all', async () => {
  const client = world();
  await assert.rejects(
    () => transitionContainer(CONTAINER, 'LOADING', OPERATOR, null, opts(client)),
    /nothing has been recorded as going into it/i,
  );
  const { data } = await client.from('diaspora_container_shipments').select('*').eq('id', CONTAINER).maybeSingle();
  assert.equal(data.status, 'BOOKING_CLOSED', 'the sailing moved anyway');
});

test('T10: the refusal names the reason a caller can act on', async () => {
  const client = world();
  try {
    await transitionContainer(CONTAINER, 'LOADING', OPERATOR, null, opts(client));
    assert.fail('the transition was accepted');
  } catch (err) {
    assert.equal(err.details?.code || err.code, 'LOADING_NOT_BACKED_BY_LOAD_RECORD');
    // It also says WHERE to do it properly, rather than only refusing.
    assert.match(err.message, /loading workspace/i);
  }
});

test('T10: an ABANDONED load does not back a LOADING claim', async () => {
  const client = world({ loads: [{ id: 'l-1', container_id: CONTAINER, status: 'ABANDONED', deleted_at: null }] });
  await assert.rejects(
    () => transitionContainer(CONTAINER, 'LOADING', OPERATOR, null, opts(client)),
    /nothing has been recorded as going into it/i,
  );
});

test('T10: a soft-deleted load does not back a LOADING claim', async () => {
  const client = world({ loads: [{ id: 'l-1', container_id: CONTAINER, status: 'IN_PROGRESS', deleted_at: '2026-09-01T00:00:00Z' }] });
  await assert.rejects(
    () => transitionContainer(CONTAINER, 'LOADING', OPERATOR, null, opts(client)),
    /nothing has been recorded as going into it/i,
  );
});

test('T10: another container\'s load does not back THIS sailing\'s claim', async () => {
  const client = world({ loads: [{ id: 'l-1', container_id: 'some-other-container', status: 'IN_PROGRESS', deleted_at: null }] });
  await assert.rejects(
    () => transitionContainer(CONTAINER, 'LOADING', OPERATOR, null, opts(client)),
    /nothing has been recorded as going into it/i,
  );
});

test('T10: POSITIVE CONTROL — with a live T10 load, LOADING is accepted', async () => {
  const client = world({ loads: [{ id: 'l-1', container_id: CONTAINER, status: 'IN_PROGRESS', deleted_at: null }] });
  const result = await transitionContainer(CONTAINER, 'LOADING', OPERATOR, null, opts(client));
  assert.equal(result.status, 'LOADING', 'a legitimate transition was refused — a gate that refuses everybody is not a gate');
});

// ── SHIPPED ────────────────────────────────────────────────────────────────

test('T10: a sailing CANNOT be marked SHIPPED with no load at all', async () => {
  const client = world({ loads: [] });
  await client.from('diaspora_container_shipments').update({ status: 'LOADING' }).eq('id', CONTAINER);
  await assert.rejects(
    () => transitionContainer(CONTAINER, 'SHIPPED', OPERATOR, null, opts(client)),
    /loading has not been completed/i,
  );
});

test('T10: a sailing CANNOT be marked SHIPPED while its load is still IN_PROGRESS', async () => {
  const client = world({ loads: [{ id: 'l-1', container_id: CONTAINER, status: 'IN_PROGRESS', deleted_at: null }] });
  await client.from('diaspora_container_shipments').update({ status: 'LOADING' }).eq('id', CONTAINER);
  try {
    await transitionContainer(CONTAINER, 'SHIPPED', OPERATOR, null, opts(client));
    assert.fail('a container that was never finished being loaded was marked as sailed');
  } catch (err) {
    assert.equal(err.details?.code || err.code, 'SHIPPED_WITHOUT_COMPLETED_LOAD');
  }
  const { data } = await client.from('diaspora_container_shipments').select('*').eq('id', CONTAINER).maybeSingle();
  assert.equal(data.status, 'LOADING');
});

test('T10: POSITIVE CONTROL — with a COMPLETED load, SHIPPED is accepted', async () => {
  const client = world({ loads: [{ id: 'l-1', container_id: CONTAINER, status: 'COMPLETED', deleted_at: null }] });
  await client.from('diaspora_container_shipments').update({ status: 'LOADING' }).eq('id', CONTAINER);
  const result = await transitionContainer(CONTAINER, 'SHIPPED', OPERATOR, null, opts(client));
  assert.equal(result.status, 'SHIPPED');
});

// ── The gate is narrow on purpose ──────────────────────────────────────────

test('T10: the guard touches ONLY loading and shipped — booking transitions are unaffected', async () => {
  const client = world();
  const opened = await transitionContainer(CONTAINER, 'CANCELLED', OPERATOR, null, opts(client));
  assert.equal(opened.status, 'CANCELLED', 'an unrelated transition was caught by the loading guard');
});

test('T10: the guard does not create a load — it only reads one', async () => {
  const client = world({ loads: [{ id: 'l-1', container_id: CONTAINER, status: 'IN_PROGRESS', deleted_at: null }] });
  await transitionContainer(CONTAINER, 'LOADING', OPERATOR, null, opts(client));
  const { data } = await client.from('diaspora_container_loads').select('*');
  assert.equal(data.length, 1, 'the status transition manufactured a load record');
  assert.equal(data[0].status, 'IN_PROGRESS', 'the status transition mutated the load');
});

test('T10: marking a sailing LOADING does not put any cargo on a manifest', async () => {
  const client = world({ loads: [{ id: 'l-1', container_id: CONTAINER, status: 'IN_PROGRESS', deleted_at: null }] });
  await transitionContainer(CONTAINER, 'LOADING', OPERATOR, null, opts(client));
  const { data } = await client.from('diaspora_container_load_items').select('*');
  // A sailing status is a label on the container. It has never been, and must never become, a
  // statement about whose goods are inside it.
  assert.equal((data || []).length, 0, 'a status change created manifest lines');
});
