import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  describePublicationLastChange,
  readPublicationLastChange,
  PUBLICATION_CHANGE_EVENTS,
  PUBLICATION_CHANGE_READ_LIMIT,
} from '../services/marketplace/publicationLastChange.js';

/**
 * PC01-J-R1 — the owner of a `publishable` listing is told who took it off the public Marketplace.
 *
 * The rows below are the real shape and the real sequence for GFC27-027051 on canonical staging
 * (trust_audit_events, read 2026-10-10): the owner's own last action published the Serena; a
 * moderator-authorised reconciliation then returned it to `publishable` as a system actor.
 */

const OWNER = 'u_66cace85fad949e4';
const SERENA = 'GFC27-027051';

const serenaTrail = [
  { vin: SERENA, event_type: 'VEHICLE_LISTING_UNPUBLISHED', actor_user_id: OWNER, actor_role: 'owner', created_at: '2026-09-26T20:08:18.774796+00:00' },
  { vin: SERENA, event_type: 'VEHICLE_LISTING_PUBLISHED', actor_user_id: OWNER, actor_role: 'owner', created_at: '2026-09-26T20:08:27.773373+00:00' },
  { vin: SERENA, event_type: 'VEHICLE_LISTING_UNPUBLISHED', actor_user_id: null, actor_role: 'system', created_at: '2026-10-06T23:32:43.696751+00:00' },
];

test('the Serena reads as taken off the Marketplace by CarUp, not by its owner', () => {
  const described = describePublicationLastChange(serenaTrail, { vins: [SERENA], userId: OWNER });
  assert.deepEqual(described.get(SERENA), {
    state: 'recorded',
    change: 'unpublished',
    at: '2026-10-06T23:32:43.696Z',
    by: 'carup',
  });
});

test('order of the rows does not matter — the latest change wins', () => {
  const reversed = [...serenaTrail].reverse();
  assert.equal(describePublicationLastChange(reversed, { vins: [SERENA], userId: OWNER }).get(SERENA).by, 'carup');
});

test('the owner\'s own change is attributed to "you"', () => {
  const described = describePublicationLastChange(serenaTrail.slice(0, 2), { vins: [SERENA], userId: OWNER });
  assert.deepEqual(described.get(SERENA), {
    state: 'recorded', change: 'published', at: '2026-09-26T20:08:27.773Z', by: 'you',
  });
});

test('an admin acting through the product is CarUp; another seller is "another_account"', () => {
  const admin = [{ vin: SERENA, event_type: 'VEHICLE_LISTING_UNPUBLISHED', actor_user_id: 'u_admin', actor_role: 'admin', created_at: '2026-10-07T00:00:00Z' }];
  const dealer = [{ vin: SERENA, event_type: 'VEHICLE_LISTING_PUBLISHED', actor_user_id: 'u_dealer_member', actor_role: 'dealer', created_at: '2026-10-07T00:00:00Z' }];
  assert.equal(describePublicationLastChange(admin, { vins: [SERENA], userId: OWNER }).get(SERENA).by, 'carup');
  assert.equal(describePublicationLastChange(dealer, { vins: [SERENA], userId: OWNER }).get(SERENA).by, 'another_account');
});

test('only the answer travels: no actor id, role, reason or route', () => {
  const withReason = serenaTrail.map((row) => ({ ...row, reason: 'Staging reconciliation quarantine', source_route: 'oc5r-db2b-1', request_id: 'oc5r-db2b-1' }));
  const value = describePublicationLastChange(withReason, { vins: [SERENA], userId: OWNER }).get(SERENA);
  assert.deepEqual(Object.keys(value).sort(), ['at', 'by', 'change', 'state']);
  assert.doesNotMatch(JSON.stringify(value), /u_66cace|system|oc5r|quarantine/);
});

test('three states, never two: none is a read that found nothing; not_read is a failed or truncated read', () => {
  const read = describePublicationLastChange([], { vins: ['NEVERPUBLISHED01'], userId: OWNER });
  assert.deepEqual(read.get('NEVERPUBLISHED01'), { state: 'none' });

  const truncated = describePublicationLastChange([], { vins: ['NEVERPUBLISHED01'], userId: OWNER, truncated: true });
  assert.deepEqual(truncated.get('NEVERPUBLISHED01'), { state: 'not_read' }, 'a truncated read must not become a claim of absence');

  const failed = describePublicationLastChange(null, { vins: [SERENA], userId: OWNER });
  assert.deepEqual(failed.get(SERENA), { state: 'not_read' });
});

test('rows that are not publication changes, or carry no usable time, are ignored', () => {
  const noise = [
    { vin: SERENA, event_type: 'TRUST_SCORE_RECALCULATED', actor_user_id: null, actor_role: 'system', created_at: '2026-10-08T00:00:00Z' },
    { vin: SERENA, event_type: 'VEHICLE_LISTING_PUBLISHED', actor_user_id: OWNER, actor_role: 'owner', created_at: 'not a time' },
  ];
  assert.deepEqual(describePublicationLastChange(noise, { vins: [SERENA], userId: OWNER }).get(SERENA), { state: 'none' });
});

function fakeClient({ data = serenaTrail, error = null, throws = false } = {}) {
  const calls = [];
  const chain = {
    select(columns) { calls.push(['select', columns]); return chain; },
    in(column, values) { calls.push(['in', column, values]); return chain; },
    order(column, options) { calls.push(['order', column, options]); return chain; },
    limit(n) {
      calls.push(['limit', n]);
      if (throws) return Promise.reject(new Error('network down'));
      return Promise.resolve({ data, error });
    },
  };
  return {
    calls,
    from(table) { calls.push(['from', table]); return chain; },
  };
}

test('the read asks the audit trail for exactly the owner\'s vehicles and the two publication events', async () => {
  const client = fakeClient();
  const described = await readPublicationLastChange(client, [SERENA, SERENA], OWNER);
  assert.deepEqual(client.calls, [
    ['from', 'trust_audit_events'],
    ['select', 'vin, event_type, actor_user_id, actor_role, created_at'],
    ['in', 'vin', [SERENA]],
    ['in', 'event_type', [...PUBLICATION_CHANGE_EVENTS]],
    ['order', 'created_at', { ascending: false }],
    ['limit', PUBLICATION_CHANGE_READ_LIMIT],
  ]);
  assert.equal(described.get(SERENA).by, 'carup');
});

test('a read error or a thrown read is not_read — never "no history"', async () => {
  const errored = await readPublicationLastChange(fakeClient({ data: null, error: { message: 'permission denied' } }), [SERENA], OWNER);
  assert.deepEqual(errored.get(SERENA), { state: 'not_read' });
  const thrown = await readPublicationLastChange(fakeClient({ throws: true }), [SERENA], OWNER);
  assert.deepEqual(thrown.get(SERENA), { state: 'not_read' });
});

test('a read that fills its limit marks absent vehicles not_read', async () => {
  const full = Array.from({ length: PUBLICATION_CHANGE_READ_LIMIT }, (_, i) => ({
    vin: 'OTHERVEHICLE0001', event_type: 'VEHICLE_LISTING_PUBLISHED', actor_user_id: OWNER, actor_role: 'owner', created_at: new Date(Date.UTC(2026, 8, 1) + i * 1000).toISOString(),
  }));
  const described = await readPublicationLastChange(fakeClient({ data: full }), ['OTHERVEHICLE0001', SERENA], OWNER);
  assert.equal(described.get('OTHERVEHICLE0001').state, 'recorded');
  assert.deepEqual(described.get(SERENA), { state: 'not_read' });
});

const SERVER_CODE = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../server.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

test('GET /api/vehicles/me attaches publication_last_change from the audit trail for the caller', () => {
  const handler = SERVER_CODE.slice(SERVER_CODE.indexOf("app.get('/api/vehicles/me'"));
  const body = handler.slice(0, handler.indexOf('app.get(', 10));
  assert.match(body, /readPublicationLastChange\(\s*supabase,\s*withTrust\.map\(\(vehicle\) => vehicle\.vin\),\s*req\.userContext\.id,?\s*\)/);
  assert.match(body, /publication_last_change:\s*publicationChanges\.get\(vehicle\.vin\)\s*\?\?\s*\{ state: 'not_read' \}/);
});
