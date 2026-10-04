/**
 * OC-5D (P6) — GET /api/service-history/me against shared/contracts/owner-service-history.v1.contract.json,
 * through the SHIPPED app over an in-memory world seeded with every row shape the schema has produced:
 * 006 (organization_id, customer_name, issue_description), 009 (tenant_id, customer_id, mechanic_id,
 * costs), OC-5A (owner_authorization + who decided) and a row carrying columns no migration has written
 * yet. Proven:
 *   · every entry carries exactly the contract's keys with the contract's types — never `cost` (F1);
 *   · nothing identifying another person leaves the server: after a sale the row names the PREVIOUS
 *     owner, and the work order names the garage employee and the account that decided;
 *   · money is reported with a currency or as not recorded — this table has no currency column;
 *   · an unreadable ownership or work-order read is a 503, never "no service history".
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;

const CONTRACT = JSON.parse(readFileSync(new URL('../../shared/contracts/owner-service-history.v1.contract.json', import.meta.url), 'utf8'));
const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const VIN = 'OC5DTESTVIN000001';
const OTHER_VIN = 'OC5DTESTVIN000002';
const PREVIOUS_OWNER = 'Chipo Previous-Owner';

let world; let restoreWorld; let server; let baseUrl;
function seedWorld() {
  restoreWorld?.();
  world = createSupabaseWorld({
    users: [
      { id: 'u-owner', name: 'Current Owner', email: 'owner@example.invalid', role: 'owner', is_verified: true },
      { id: 'u-other', name: 'Someone Else', email: 'else@example.invalid', role: 'owner', is_verified: true },
    ],
    user_sessions: [
      { token: 'tok-owner', user_id: 'u-owner', is_valid: true, expires_at: FUTURE },
      { token: 'tok-other', user_id: 'u-other', is_valid: true, expires_at: FUTURE },
    ],
    vehicles: [
      { vin: VIN, owner_id: 'u-owner' },
      { vin: OTHER_VIN, owner_id: 'u-other' },
    ],
    mechanic_work_orders: [
      // 006 shape: a walk-in recorded under the PREVIOUS owner's name, before the sale
      { id: 'wo-006', organization_id: 'org-garage', vin: VIN, customer_name: PREVIOUS_OWNER, issue_description: 'Brake squeal', status: 'pending', created_at: '2026-01-10T09:00:00.000Z' },
      // 009 shape
      { id: 'wo-009', tenant_id: 'tenant-garage', vin: VIN, customer_id: 'u-previous', customer_name: PREVIOUS_OWNER, status: 'Completed', description: 'Oil and filter', labor_cost: 20, total_cost: 85.5, mechanic_id: 'u-mechanic-7', created_at: '2026-03-02T09:00:00.000Z', updated_at: '2026-03-02T12:00:00.000Z' },
      // OC-5A shape: the owner decided
      { id: 'wo-5a', tenant_id: 'tenant-garage', vin: VIN, customer_id: 'u-owner', status: 'In Progress', description: 'Timing belt', labor_cost: 0, total_cost: 0, mechanic_id: 'u-mechanic-7', owner_authorization: 'authorized', owner_authorized_by: 'u-owner', owner_authorized_at: '2026-09-01T08:00:00.000Z', created_at: '2026-09-01T07:00:00.000Z', updated_at: '2026-09-01T08:00:00.000Z' },
      // columns no migration has written yet (a later lane adds them) — they must not ride along
      { id: 'wo-future', tenant_id: 'tenant-garage', vin: VIN, status: 'Completed', description: 'Alignment', total_cost: null, assigned_mechanic_id: 'u-mechanic-9', internal_notes: 'customer was rude', owner_authorization: 'not-a-state', created_at: '2026-09-20T07:00:00.000Z' },
      // someone else's vehicle
      { id: 'wo-other', tenant_id: 'tenant-garage', vin: OTHER_VIN, status: 'Completed', description: 'Not yours', created_at: '2026-05-01T07:00:00.000Z' },
    ],
  });
  restoreWorld = installSupabaseWorld(supabase, world);
}

before(async () => {
  seedWorld();
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  restoreWorld?.();
  if (server) await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => seedWorld());

async function history(token) {
  const res = await fetch(`${baseUrl}/api/service-history/me`, { headers: { 'x-session-token': token, 'x-bypass-rate-limit': 'true' } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text };
}

function typeOk(value, spec) {
  return spec.split('|').some((t) => (t === 'null' ? value === null : t === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : typeof value === t));
}

function failTable(table) {
  const inner = supabase.from;
  supabase.from = (name) => {
    const builder = inner(name);
    if (name === table) builder.then = (resolve, reject) => Promise.resolve({ data: null, error: { message: 'connection reset' } }).then(resolve, reject);
    return builder;
  };
  return () => { supabase.from = inner; };
}

test('contract: the shape every client is held to', () => {
  assert.equal(CONTRACT.contract, 'carup.owner_service_history.v1');
  assert.ok(CONTRACT.entry.forbidden.includes('cost'), 'the key the native screen crashed on can never be emitted');
  for (const key of CONTRACT.entry.forbidden) {
    assert.equal(key in CONTRACT.entry.required || key in CONTRACT.entry.optional, false, `${key} is both allowed and forbidden`);
  }
});

test('every entry carries exactly the contract keys, with the contract types', async () => {
  const res = await history('tok-owner');
  assert.equal(res.status, 200, res.text);
  assert.ok(Array.isArray(res.body));
  assert.deepEqual(res.body.map((e) => e.id).sort(), ['wo-006', 'wo-009', 'wo-5a', 'wo-future']);
  const allowed = new Set([...Object.keys(CONTRACT.entry.required), ...Object.keys(CONTRACT.entry.optional)]);
  for (const entry of res.body) {
    for (const key of Object.keys(entry)) assert.ok(allowed.has(key), `${entry.id}: unlisted key ${key}`);
    for (const [key, spec] of Object.entries(CONTRACT.entry.required)) {
      assert.ok(key in entry, `${entry.id}: missing ${key}`);
      assert.ok(typeOk(entry[key], spec), `${entry.id}: ${key}=${JSON.stringify(entry[key])} is not ${spec}`);
    }
    for (const [key, spec] of Object.entries(CONTRACT.entry.money)) {
      if (key.startsWith('$')) continue;
      assert.ok(typeOk(entry.money[key], spec), `${entry.id}: money.${key} is not ${spec}`);
    }
    for (const key of CONTRACT.entry.forbidden) assert.equal(key in entry, false, `${entry.id}: forbidden ${key}`);
  }
});

test('nothing identifying another person leaves the server (privacy measured on every row and value)', async () => {
  const res = await history('tok-owner');
  for (const needle of [PREVIOUS_OWNER, 'u-previous', 'u-mechanic-7', 'u-mechanic-9', 'org-garage', 'tenant-garage', 'customer was rude']) {
    assert.equal(res.text.includes(needle), false, `the response carries ${needle}`);
  }
  const decided = res.body.find((e) => e.id === 'wo-5a');
  assert.equal(decided.owner_authorization, 'authorized');
  assert.equal(res.text.includes('owner_authorized_by'), false);
});

test('money is shown with a currency or as not recorded — absent is never zero', async () => {
  const res = await history('tok-owner');
  const byId = Object.fromEntries(res.body.map((e) => [e.id, e]));
  for (const entry of res.body) assert.deepEqual(entry.money, { recorded: false, amount: null, currency: null }, `${entry.id}: no currency column, so no money`);
  assert.equal(byId['wo-009'].total_cost, 85.5, 'the RC1 numeric fields keep their meaning for existing readers');
  assert.equal(byId['wo-006'].total_cost, null, 'a 006 row has no cost — null, not 0');
  assert.equal(byId['wo-006'].issue_description, 'Brake squeal');
  assert.equal(byId['wo-future'].owner_authorization, null, 'an unknown authorization state is not passed through');
  assert.equal(byId['wo-006'].owner_authorization, null, 'a schema without the column says nothing about authorization');
});

test('newest first; another owner\'s vehicle is never included', async () => {
  const res = await history('tok-owner');
  assert.deepEqual(res.body.map((e) => e.id), ['wo-future', 'wo-5a', 'wo-009', 'wo-006']);
  const other = await history('tok-other');
  assert.deepEqual(other.body.map((e) => e.id), ['wo-other']);
});

test('an unreadable ownership read or work-order read is a 503 — never an empty history', async () => {
  for (const table of ['vehicles', 'mechanic_work_orders']) {
    const restore = failTable(table);
    try {
      const res = await history('tok-owner');
      assert.equal(res.status, 503, `${table}: ${res.text}`);
      assert.equal(res.body.code, CONTRACT.failure.code);
      assert.doesNotMatch(res.text, /connection reset/, 'no raw database text');
    } finally { restore(); }
  }
});

test('an owner with no vehicles gets an empty list (a real answer, not a failure)', async () => {
  world.tables.vehicles = [];
  const res = await history('tok-owner');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});
