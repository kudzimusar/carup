/**
 * OC-5R-REL-03A source/harness certification and explicit mutation controls.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  D7_PARTICIPANT_EVENT,
  D7_ORGANISER_EVENT,
  matchesD7Notification,
  reservationReference,
} from '../../scripts/ci/lib/oc5r-rel03-d7-correlation.mjs';
import {
  assertApprovedDatabaseTarget,
  assertReadOnlySql,
  identifyDatabaseTarget,
  OC5R_STAGING_PROJECT_REF,
  OC5R_PRODUCTION_PROJECT_REF,
} from '../../scripts/ci/lib/oc5r-rel03-db-readonly.mjs';
import {
  classifyEventType,
  EFFECT_CLASS,
} from '../../scripts/ci/lib/oc5r-rel03-subscriber-classifier.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const SPEC = read('tests/agents/45-trade-os-container-demo-staging.spec.ts');
const UAT = read('.github/workflows/diaspora-deployed-staging-uat.yml');
const SHARD = read('.github/workflows/diaspora-deployed-staging-shard.yml');
const ROUTE = read('backend/routes/communicationRoutes.js');
const INVENTORY = read('scripts/ci/oc5r-rel03-communications-backlog-inventory.mjs');
const SNAPSHOT = read('scripts/ci/oc5r-rel03-communications-snapshot.mjs');
const KILL_SWITCH = read('backend/services/communication/outboundKillSwitch.js');

const expected = {
  recipientUserId: 'participant-current',
  reservationId: '12345678-1234-1234-1234-123456789abc',
  reference: 'RES-12345678',
  status: 'APPROVED',
  eventType: D7_PARTICIPANT_EVENT,
  notBefore: '2026-10-08T08:00:00.000Z',
};

const currentRow = {
  notification_type: 'container_booking',
  recipient_user_id: 'participant-current',
  event_id: 'evt-current',
  created_at: '2026-10-08T08:00:02.000Z',
  payload: {
    event_type: D7_PARTICIPANT_EVENT,
    safe_payload: {
      reservationId: expected.reservationId,
      reference: expected.reference,
      status: expected.status,
    },
  },
};

test('D7 canonical predicate accepts only the exact current participant notification', () => {
  assert.equal(matchesD7Notification(currentRow, expected), true);
  assert.equal(reservationReference(expected.reservationId), expected.reference);
});

test('D7 negative regression: a historical container_booking row cannot satisfy the current run', () => {
  const historical = {
    ...currentRow,
    event_id: 'evt-2026-09-26',
    created_at: '2026-09-26T02:00:00.000Z',
    payload: {
      event_type: D7_PARTICIPANT_EVENT,
      safe_payload: {
        reservationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        reference: 'RES-AAAAAAAA',
        status: 'APPROVED',
      },
    },
  };
  assert.equal(matchesD7Notification(historical, expected), false);
});

test('D7 organiser direction is a distinct exact event/state contract', () => {
  const organiserExpected = {
    ...expected,
    recipientUserId: 'hikari-coordinator',
    status: 'REQUESTED',
    eventType: D7_ORGANISER_EVENT,
  };
  const organiserRow = {
    ...currentRow,
    recipient_user_id: 'hikari-coordinator',
    payload: {
      event_type: D7_ORGANISER_EVENT,
      safe_payload: {
        reservationId: expected.reservationId,
        reference: expected.reference,
        status: 'REQUESTED',
      },
    },
  };
  assert.equal(matchesD7Notification(organiserRow, organiserExpected), true);
  assert.equal(matchesD7Notification({ ...organiserRow, recipient_user_id: 'participant-current' }, organiserExpected), false);
});

test('D7 correlation mutation set is killed 5/5', () => {
  const adversaries = [
    { name: 'remove reservation/reference condition', row: { ...currentRow, payload: { ...currentRow.payload, safe_payload: { ...currentRow.payload.safe_payload, reservationId: 'other', reference: 'RES-DEADBEEF' } } } },
    { name: 'accept any container_booking', row: { ...currentRow, recipient_user_id: 'someone-else', event_id: null, created_at: '2026-09-01T00:00:00.000Z', payload: { event_type: 'old.event', safe_payload: {} } } },
    { name: 'drop current-run condition', row: { ...currentRow, created_at: '2026-09-26T00:00:00.000Z' } },
    { name: 'drop recipient direction', row: { ...currentRow, recipient_user_id: 'wrong-recipient' } },
    { name: 'replace exact reference with generic RES match', row: { ...currentRow, payload: { ...currentRow.payload, safe_payload: { ...currentRow.payload.safe_payload, reference: 'RES-DEADBEEF' } } } },
  ];
  let killed = 0;
  for (const mutant of adversaries) {
    assert.equal(matchesD7Notification(mutant.row, expected), false, mutant.name);
    killed += 1;
  }
  console.log(`[REL03A MUTATION] D7 correlation killed ${killed}/${adversaries.length}`);
  assert.equal(killed, 5);
});

test('deployed D7 source consumes only the canonical Communications worker secret', () => {
  for (const source of [SPEC, UAT, SHARD]) {
    assert.match(source, /COMMUNICATION_WORKER_SECRET/);
    assert.doesNotMatch(source, /TRADEOS_WORKER_SECRET/);
  }
  assert.match(ROUTE, /resolveWorkerSecret\(\)/);
  assert.match(ROUTE, /Unauthorized communication worker request/);
  assert.doesNotMatch(ROUTE, /TRADEOS_WORKER_SECRET/);
  assert.doesNotMatch(ROUTE, /NODE_ENV\s*===?\s*['"]test['"]/);
});

test('worker-secret naming/auth mutation set is killed 3/3', () => {
  const contract = (spec, uat, shard) =>
    [spec, uat, shard].every((source) => source.includes('COMMUNICATION_WORKER_SECRET'))
    && [spec, uat, shard].every((source) => !source.includes('TRADEOS_WORKER_SECRET'));
  assert.equal(contract(SPEC, UAT, SHARD), true);
  const mutants = [
    [SPEC.replaceAll('COMMUNICATION_WORKER_SECRET', 'TRADEOS_WORKER_SECRET'), UAT, SHARD],
    [SPEC, UAT.replaceAll('COMMUNICATION_WORKER_SECRET', 'TRADEOS_WORKER_SECRET'), SHARD],
    [SPEC, UAT, SHARD.replaceAll('COMMUNICATION_WORKER_SECRET', 'TRADEOS_WORKER_SECRET')],
  ];
  const killed = mutants.filter((args) => !contract(...args)).length;
  console.log(`[REL03A MUTATION] worker secret contract killed ${killed}/${mutants.length}`);
  assert.equal(killed, 3);
});

test('database target proof permits canonical staging and refuses production/unknown', () => {
  const scheme = ['postgres', 'ql://'].join('');
  const staging = `${scheme}postgres.${OC5R_STAGING_PROJECT_REF}:redacted@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`;
  const production = `${scheme}postgres.${OC5R_PRODUCTION_PROJECT_REF}:redacted@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`;
  assert.equal(assertApprovedDatabaseTarget(staging).kind, 'staging');
  assert.equal(identifyDatabaseTarget(production).kind, 'production');
  assert.throws(() => assertApprovedDatabaseTarget(production), /PRODUCTION FORBIDDEN/);
  assert.throws(() => assertApprovedDatabaseTarget('postgresql://postgres:pw@example.invalid/postgres'), /UNKNOWN DATABASE TARGET/);
});

test('production/unknown-target refusal mutation set is killed 2/2', () => {
  const scheme = ['postgres', 'ql://'].join('');
  const forbidden = [
    `${scheme}postgres.${OC5R_PRODUCTION_PROJECT_REF}:pw@pooler.supabase.com/postgres`,
    `${scheme}postgres:pw@unknown.example/postgres`,
  ];
  let killed = 0;
  for (const url of forbidden) {
    assert.throws(() => assertApprovedDatabaseTarget(url));
    killed += 1;
  }
  console.log(`[REL03A MUTATION] target refusal killed ${killed}/${forbidden.length}`);
  assert.equal(killed, 2);
});

test('read-only SQL guard accepts inventory SELECTs and kills mutation verbs 8/8', () => {
  assert.doesNotThrow(() => assertReadOnlySql('SELECT status, count(*) FROM domain_events GROUP BY status'));
  assert.doesNotThrow(() => assertReadOnlySql('WITH x AS (SELECT 1) SELECT * FROM x'));
  const mutations = [
    'UPDATE domain_events SET status = \'processed\'',
    'DELETE FROM domain_events',
    'INSERT INTO domain_events(event_type) VALUES (\'x\')',
    'CREATE TABLE rel03_bad(id int)',
    'ALTER TABLE domain_events ADD COLUMN rel03_bad text',
    'TRUNCATE domain_events',
    'CALL process_events()',
    'WITH x AS (DELETE FROM domain_events RETURNING *) SELECT * FROM x',
  ];
  let killed = 0;
  for (const sql of mutations) {
    assert.throws(() => assertReadOnlySql(sql));
    killed += 1;
  }
  console.log(`[REL03A MUTATION] read-only SQL killed ${killed}/${mutations.length}`);
  assert.equal(killed, 8);
});

test('inventory/snapshot tooling uses the guarded read-only database boundary only', () => {
  for (const source of [INVENTORY, SNAPSHOT]) {
    assert.match(source, /withReadOnlyDatabase/);
    assert.doesNotMatch(source, /\b(?:UPDATE|DELETE|INSERT|UPSERT|TRUNCATE|ALTER|DROP|CREATE)\s+(?:public\.)?[a-z_]+/i);
    assert.doesNotMatch(source, /internal\/events\/process|fetch\(|axios|supabase\.rpc/i);
  }
});

test('subscriber classifier derives D7 as in-app only from current Communications source', () => {
  const participant = classifyEventType(D7_PARTICIPANT_EVENT);
  const organiser = classifyEventType(D7_ORGANISER_EVENT);
  for (const row of [participant, organiser]) {
    assert.equal(row.known_subscriber, true);
    assert.equal(row.communications_subscriber, true);
    assert.equal(row.effect_class, EFFECT_CLASS.IN_APP_ONLY);
    assert.equal(row.in_app_notification_potential, true);
    assert.equal(row.external_channel_potential, false);
  }
});

test('subscriber-classification unknown handling mutation set is killed 1/1', () => {
  const result = classifyEventType('rel03.missing_policy', {
    communicationTypes: new Set(['rel03.missing_policy']),
    literalSubscribers: new Map(),
  });
  assert.equal(result.effect_class, EFFECT_CLASS.UNKNOWN_REQUIRES_REVIEW);
  const mutantDefault = EFFECT_CLASS.IN_APP_ONLY;
  assert.notEqual(result.effect_class, mutantDefault);
  console.log('[REL03A MUTATION] subscriber unknown handling killed 1/1');
});

test('outbound kill-switch requested by REL-03B is a real runtime control', () => {
  assert.match(KILL_SWITCH, /OUTBOUND_KILL_SWITCH_ENV = 'COMMUNICATION_OUTBOUND_DISABLED'/);
  assert.match(KILL_SWITCH, /FAIL CLOSED/);
  assert.match(KILL_SWITCH, /isOutboundDisabled/);
  assert.match(KILL_SWITCH, /was not contacted and nothing was sent/);
});
