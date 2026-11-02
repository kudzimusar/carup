import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertObservedNextWorkerBatch,
  assertTrackedEventQueryContract,
  assertTrackedReconciliationComplete,
  assertWorkerSelectionQueryContract,
  loadWorkerSelectionContract,
  nextWorkerBatchSql,
  reconcileTrackedWorkerBatch,
  reviewNextWorkerBatch,
  trackedDomainEventsSql,
} from '../../scripts/ci/lib/oc5r-rel03-worker-custody.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const UAT = read('.github/workflows/diaspora-deployed-staging-uat.yml');
const SHARD = read('.github/workflows/diaspora-deployed-staging-shard.yml');
const HANDOFF = read('docs/one-carup/OC5R_REL03B_LOCAL_EXECUTION_HANDOFF.md');
const INVENTORY = read('scripts/ci/oc5r-rel03-communications-backlog-inventory.mjs');
const SNAPSHOT = read('scripts/ci/oc5r-rel03-communications-snapshot.mjs');
const RECONCILE = read('scripts/ci/oc5r-rel03-communications-reconcile.mjs');

function stagingCustodyContract(uat, shard, handoff) {
  const bootstrap = /\n  bootstrap:\n[\s\S]{0,180}?\n    environment: staging\n/.test(uat);
  const reusableShard = /\n  shard:\n[\s\S]{0,140}?\n    environment: staging\n/.test(shard);
  const command = /gh secret set COMMUNICATION_WORKER_SECRET[\s\S]{0,180}?--repo kudzimusar\/carup[\s\S]{0,100}?--env staging/.test(handoff);
  const noTradeOsInExecutableWorkflows = !/TRADEOS_WORKER_SECRET/.test(uat + shard);
  const handoffExplicitlyForbidsTradeOs = /Do not create \`TRADEOS_WORKER_SECRET\` support/.test(handoff);
  return bootstrap && reusableShard && command && noTradeOsInExecutableWorkflows && handoffExplicitlyForbidsTradeOs;
}

test('GitHub worker-secret jobs and handoff are staging-environment scoped', () => {
  assert.equal(stagingCustodyContract(UAT, SHARD, HANDOFF), true);
  assert.match(HANDOFF, /Do not create or replace a repository-wide `COMMUNICATION_WORKER_SECRET`/);
  assert.match(UAT, /COMMUNICATION_WORKER_SECRET: \$\{\{ secrets\.COMMUNICATION_WORKER_SECRET \}\}/);
  assert.match(SHARD, /COMMUNICATION_WORKER_SECRET: \$\{\{ secrets\.COMMUNICATION_WORKER_SECRET \}\}/);
});

test('GitHub staging-custody mutation set is killed 3/3', () => {
  const mutants = [
    [UAT.replace('    environment: staging\n', ''), SHARD, HANDOFF],
    [UAT, SHARD.replace('    environment: staging\n', ''), HANDOFF],
    [UAT, SHARD, HANDOFF.replace('    --env staging\n', '')],
  ];
  const killed = mutants.filter(([uat, shard, handoff]) => !stagingCustodyContract(uat, shard, handoff)).length;
  console.log(`[REL03A-R2 MUTATION] GitHub staging custody killed ${killed}/${mutants.length}`);
  assert.equal(killed, 3);
});

test('worker selection is source-derived: pending attempts<5 oldest-first limit10', () => {
  const contract = loadWorkerSelectionContract();
  assert.deepEqual(
    {
      max_outbox_attempts: contract.max_outbox_attempts,
      batch_limit: contract.batch_limit,
      status: contract.status,
      order_by: contract.order_by,
    },
    {
      max_outbox_attempts: 5,
      batch_limit: 10,
      status: 'pending',
      order_by: 'created_at ASC',
    },
  );
  const sql = nextWorkerBatchSql(contract);
  assertWorkerSelectionQueryContract(sql, contract);
  assert.match(INVENTORY, /query\(nextWorkerBatchSql\(workerContract\), \[workerContract\.max_outbox_attempts\]\)/);

  const rows = Array.from({ length: 10 }, (_, index) => ({
    id: `event-${index + 1}`,
    status: 'pending',
    attempts: index % 5,
    created_at: new Date(Date.UTC(2026, 8, 26, 0, index)).toISOString(),
  }));
  assert.equal(assertObservedNextWorkerBatch(rows, contract), true);
});

test('worker-selection mutation set is killed 4/4', () => {
  const contract = loadWorkerSelectionContract();
  const sql = nextWorkerBatchSql(contract);
  const mutants = [
    sql.replace(/AND attempts < \$1/, ''),
    sql.replace(/ORDER BY created_at ASC/, 'ORDER BY created_at DESC'),
    sql.replace(/LIMIT 10/, ''),
    { sql, contract: { ...contract, max_outbox_attempts: 6 } },
  ];
  let killed = 0;
  for (const mutant of mutants) {
    const mutantSql = typeof mutant === 'string' ? mutant : mutant.sql;
    const mutantContract = typeof mutant === 'string' ? contract : mutant.contract;
    assert.throws(() => assertWorkerSelectionQueryContract(mutantSql, mutantContract));
    killed += 1;
  }
  console.log(`[REL03A-R2 MUTATION] worker selection killed ${killed}/${mutants.length}`);
  assert.equal(killed, 4);
});

test('only IN_APP_ONLY and AUDIT_ONLY pass the default first-batch classification gate', () => {
  const allowed = reviewNextWorkerBatch([
    { id: 'a', event_type: 'one', classification: { effect_class: 'IN_APP_ONLY' }, render_contract: { render_contract_ready: true } },
    { id: 'b', event_type: 'two', classification: { effect_class: 'AUDIT_ONLY' }, render_contract: { render_contract_ready: true } },
  ]);
  assert.equal(allowed.stop_required, false);
  assert.equal(allowed.default_classification_gate_passes, true);
  assert.equal(allowed.render_contract_gate_passes, true);
  assert.equal(allowed.combined_batch_gate_passes, true);

  for (const effect of [
    'EXTERNAL_CHANNEL_POSSIBLE',
    'NON_COMMUNICATION_SIDE_EFFECT',
    'NO_CURRENT_SUBSCRIBER',
    'UNKNOWN_REQUIRES_REVIEW',
  ]) {
    const result = reviewNextWorkerBatch([{ id: effect, event_type: 'x', classification: { effect_class: effect }, render_contract: { render_contract_ready: true } }]);
    assert.equal(result.stop_required, true, effect);
    assert.equal(result.default_classification_gate_passes, false, effect);
  }
  assert.match(HANDOFF, /NO_CURRENT_SUBSCRIBER.*specifically fail-closed/s);
  assert.match(HANDOFF, /kill switch prevents external sends; it does not neutralize non-Communications handlers or make handlerless event consumption harmless/);
});

test('next-batch classification stop mutation set is killed 4/4', () => {
  const forbidden = [
    'EXTERNAL_CHANNEL_POSSIBLE',
    'NON_COMMUNICATION_SIDE_EFFECT',
    'NO_CURRENT_SUBSCRIBER',
    'UNKNOWN_REQUIRES_REVIEW',
  ];
  let killed = 0;
  for (const effect of forbidden) {
    const review = reviewNextWorkerBatch([{ id: 'event', event_type: 'x', classification: { effect_class: effect }, render_contract: { render_contract_ready: true } }]);
    assert.equal(review.stop_required, true);
    killed += 1;
  }
  console.log(`[REL03A-R2 MUTATION] classification stops killed ${killed}/${forbidden.length}`);
  assert.equal(killed, 4);
});

test('combined batch gate fails closed when render preflight is absent or not ready', () => {
  for (const row of [
    { id: 'missing-preflight', event_type: 'x', classification: { effect_class: 'IN_APP_ONLY' } },
    { id: 'unregistered', event_type: 'x', classification: { effect_class: 'IN_APP_ONLY' }, render_contract: { render_contract_ready: false, stop_reason: 'template_unregistered' } },
    { id: 'missing-variable', event_type: 'x', classification: { effect_class: 'IN_APP_ONLY' }, render_contract: { render_contract_ready: false, stop_reason: 'required_variables_missing', missing_required_variables: ['headline'] } },
  ]) {
    const review = reviewNextWorkerBatch([row]);
    assert.equal(review.default_classification_gate_passes, true);
    assert.equal(review.render_contract_gate_passes, false);
    assert.equal(review.combined_batch_gate_passes, false);
    assert.equal(review.stop_required, true);
  }
});

test('snapshot tracks exact inventory event IDs independently of created_at or status', () => {
  const sql = trackedDomainEventsSql();
  assert.equal(assertTrackedEventQueryContract(sql), true);
  assert.match(SNAPSHOT, /--track-events-from/);
  assert.match(SNAPSHOT, /extractTrackedEventIds\(trackedInventory\)/);
  assert.match(SNAPSHOT, /query\(trackedDomainEventsSql\(\), \[trackedEventIds\]\)/);
  assert.doesNotMatch(sql, /created_at\s*(?:>=|>|BETWEEN)/i);
  assert.doesNotMatch(sql, /status\s*=\s*['"]pending['"]/i);
});

test('tracked-ID query mutation set is killed 2/2', () => {
  const sql = trackedDomainEventsSql();
  const mutants = [
    sql.replace(/WHERE id::text = ANY\(\$1::text\[\]\)/, 'WHERE true'),
    sql.replace(/WHERE id::text = ANY\(\$1::text\[\]\)/, "WHERE created_at >= '2026-10-08T00:00:00Z'"),
  ];
  let killed = 0;
  for (const mutant of mutants) {
    assert.throws(() => assertTrackedEventQueryContract(mutant));
    killed += 1;
  }
  console.log(`[REL03A-R2 MUTATION] tracked event query killed ${killed}/${mutants.length}`);
  assert.equal(killed, 2);
});

test('historical tracked events remain reconcilable across an October observation window', () => {
  const expectedIds = ['old-processed', 'old-retry', 'old-dead'];
  const createdAt = '2026-09-26T02:00:00.000Z';
  const beforeSnapshot = {
    window: { since: '2026-10-08T00:00:00.000Z', until: '2026-10-08T01:00:00.000Z' },
    tracked_worker_batch: {
      expected_ids: expectedIds,
      rows: [
        { id: 'old-processed', status: 'pending', attempts: 0, created_at: createdAt, error_log: null },
        { id: 'old-retry', status: 'pending', attempts: 2, created_at: createdAt, error_log: null },
        { id: 'old-dead', status: 'pending', attempts: 4, created_at: createdAt, error_log: null },
      ],
    },
  };
  const afterSnapshot = {
    window: { since: '2026-10-08T00:00:00.000Z', until: '2026-10-08T01:05:00.000Z' },
    tracked_worker_batch: {
      expected_ids: expectedIds,
      rows: [
        { id: 'old-processed', status: 'processed', attempts: 1, created_at: createdAt, error_log: null },
        { id: 'old-retry', status: 'pending', attempts: 3, created_at: createdAt, error_log: 'retryable failure' },
        { id: 'old-dead', status: 'dead_letter', attempts: 5, created_at: createdAt, error_log: 'terminal failure' },
      ],
    },
  };

  assert.ok(Date.parse(createdAt) < Date.parse(beforeSnapshot.window.since));
  const tracked = reconcileTrackedWorkerBatch(beforeSnapshot.tracked_worker_batch, afterSnapshot.tracked_worker_batch);
  assert.equal(tracked.complete, true);
  assert.deepEqual(tracked.status_transitions, [
    { id: 'old-processed', before: 'pending', after: 'processed' },
    { id: 'old-dead', before: 'pending', after: 'dead_letter' },
  ]);
  assert.deepEqual(tracked.attempt_transitions, [
    { id: 'old-processed', before: 0, after: 1 },
    { id: 'old-retry', before: 2, after: 3 },
    { id: 'old-dead', before: 4, after: 5 },
  ]);
  assert.equal(tracked.missing_ids.length, 0);
  assert.equal(assertTrackedReconciliationComplete(tracked), true);
});

test('missing tracked event fails closed and cannot be treated as a removed time-window row', () => {
  const tracked = reconcileTrackedWorkerBatch(
    { expected_ids: ['event-a', 'event-b'], rows: [{ id: 'event-a', status: 'pending', attempts: 0 }, { id: 'event-b', status: 'pending', attempts: 0 }] },
    { expected_ids: ['event-a', 'event-b'], rows: [{ id: 'event-a', status: 'processed', attempts: 1 }] },
  );
  assert.equal(tracked.complete, false);
  assert.equal(tracked.stop_required, true);
  assert.deepEqual(tracked.missing_after, ['event-b']);
  assert.throws(() => assertTrackedReconciliationComplete(tracked), /RECONCILIATION INCOMPLETE/);
  assert.match(RECONCILE, /assertTrackedReconciliationComplete\(trackedWorkerBatch\)/);
  console.log('[REL03A-R2 MUTATION] missing tracked event fail-closed killed 1/1');
});

test('handoff consumes batch authority after one call and requires re-inventory before any second call', () => {
  assert.match(HANDOFF, /Approval of batch 1 never authorizes batch 2/);
  assert.match(HANDOFF, /--track-events-from "\$PWD\/rel03-backlog-before\.json"/);
  assert.match(HANDOFF, /rel03-backlog-after-batch1\.json/);
  assert.match(HANDOFF, /Do not make a second worker call unless the new exact batch is separately reviewed and the moderator explicitly authorizes continuation/);
});
