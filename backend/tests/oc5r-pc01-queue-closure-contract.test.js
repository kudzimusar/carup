/**
 * OC-5R-PC01 B–E — the governed queue-closure contract, proved offline.
 *
 * The workflow runs this BEFORE any staging credential is read. It pins:
 *   - the frozen populations (exact ids, no overlap, totals that conserve every row);
 *   - the per-cycle gate (allowed family, IN_APP_ONLY, render-ready, combined gate) and its boundaries;
 *   - the per-row reconciliation (one attempt, processed, own in-app notification + message, zero external);
 *   - the deterministic Phase D (marketplace) and Phase E (dead-letter) disposition rules;
 *   - the source authority behind every drained family (Communications subscriber, in-app-only policy);
 *   - the runner's mutation surface (worker poll, worker replay by id, one provenance-stamped quarantine UPDATE).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  PC01_CLASS_A_FAMILIES,
  PC01_CLASS_B_FAMILY,
  PC01_D7_FAMILIES,
  PC01_DISPOSITION,
  PC01_E_REPLAY_FAMILIES,
  PC01_EXPECTED_FINAL_TOTALS,
  PC01_EXPECTED_START_TOTALS,
  PC01_FROZEN,
  PC01_SEGMENTS,
  assertSameIdSet,
  batchGate,
  deadLetterDisposition,
  evaluateProcessedRow,
  expectedQuarantineReasonCounts,
  expectedTotalsAfter,
  marketplaceDisposition,
} from '../../scripts/ci/lib/oc5r-pc01-queue-closure-contract.mjs';
import { NOTIFICATION_POLICIES } from '../services/communication/communicationNotificationService.js';
import { COMMUNICATION_EVENT_TYPES } from '../services/communication/communicationEventListeners.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const RUNNER = read('scripts/ci/oc5r-pc01-queue-closure.mjs');
const WORKFLOW = read('.github/workflows/oc5r-pc01-queue-closure.yml');
const S = PC01_FROZEN.sets;
const total = (t) => t.eligible_pending + t.dead_letter + t.processed + t.quarantined;

// ── frozen populations ──────────────────────────────────────────────────────────────────────────
test('PC01 frozen sets: exact sizes, unique ids, and family counts that add up', () => {
  const expected = { BC_DRAIN: 299, D_MARKETPLACE: 82, E_QUARANTINE: 7, E_REPLAY: 114 };
  for (const [key, count] of Object.entries(expected)) {
    assert.equal(S[key].count, count, key);
    assert.equal(S[key].ids.length, count, key + ' ids');
    assert.equal(new Set(S[key].ids).size, count, key + ' ids are unique');
    assert.equal(Object.values(S[key].families).reduce((a, b) => a + b, 0), count, key + ' family counts');
    assert.match(S[key].fingerprint, /^[0-9a-f]{32}$/, key + ' fingerprint');
  }
  assert.equal(S.S1_D7_PREFIX.ids_in_fifo_order.length, 30);
});

test('PC01 frozen sets: pending = B/C drain + marketplace; dead letters = replay + superseded; nothing overlaps', () => {
  const all = [...S.BC_DRAIN.ids, ...S.D_MARKETPLACE.ids, ...S.E_QUARANTINE.ids, ...S.E_REPLAY.ids];
  assert.equal(new Set(all).size, all.length, 'no id belongs to two sets');
  assert.equal(S.BC_DRAIN.count + S.D_MARKETPLACE.count, PC01_EXPECTED_START_TOTALS.eligible_pending);
  assert.equal(S.E_REPLAY.count + S.E_QUARANTINE.count, PC01_EXPECTED_START_TOTALS.dead_letter);
  assert.deepEqual(Object.keys(S.D_MARKETPLACE.families), [PC01_CLASS_B_FAMILY]);
  assert.ok(!Object.keys(S.BC_DRAIN.families).includes(PC01_CLASS_B_FAMILY), 'the drain set holds no Class-B row');
  for (const family of Object.keys(S.BC_DRAIN.families)) {
    assert.ok([...PC01_D7_FAMILIES, ...PC01_CLASS_A_FAMILIES].includes(family), 'unexpected drain family ' + family);
  }
  for (const family of Object.keys(S.E_REPLAY.families)) assert.ok(PC01_E_REPLAY_FAMILIES.includes(family), family);
});

test('PC01 S1: the frozen prefix is 30 D7 rows, and the batch after it is the first that holds a Class-B row', () => {
  const bc = new Set(S.BC_DRAIN.ids);
  for (const id of S.S1_D7_PREFIX.ids_in_fifo_order) assert.ok(bc.has(id), 'prefix id belongs to the drain set');
  const boundary = S.S1_D7_PREFIX.boundary_batch;
  assert.equal(boundary.length, 10);
  assert.ok(boundary.some((row) => row.type === PC01_CLASS_B_FAMILY), 'the boundary batch contains marketplace rows');
  assert.ok(boundary.filter((row) => row.type === PC01_CLASS_B_FAMILY).every((row) => S.D_MARKETPLACE.ids.includes(row.id)));
});

// ── totals ──────────────────────────────────────────────────────────────────────────────────────
test('PC01 totals: every segment conserves the 1742 rows; the final state is 0 pending, 0 dead letters', () => {
  const start = total(PC01_EXPECTED_START_TOTALS);
  assert.equal(start, 1742);
  for (const segment of PC01_SEGMENTS) assert.equal(total(expectedTotalsAfter(segment.key)), start, segment.key);
  assert.deepEqual({ ...PC01_EXPECTED_FINAL_TOTALS }, { eligible_pending: 0, dead_letter: 0, processed: 1457, quarantined: 285 });
  assert.deepEqual({ ...expectedQuarantineReasonCounts() }, {
    AUDIT_ONLY_LEGACY: 6, LEGACY_DUPLICATE_WORKFLOW_EVENT: 16, LEGACY_DUPLICATE_DIRECT_NOTIFICATION: 168, RETIRED_HISTORICAL_EVENT: 6,
    STALE_HISTORICAL_QUARANTINE: 82, SUPERSEDED_HISTORICAL_WORK: 7,
  });
  assert.throws(() => expectedTotalsAfter('S9_UNKNOWN'), /UNKNOWN SEGMENT/);
});

test('PC01 segments: drain events plus quarantined rows account for every frozen row exactly once', () => {
  const drained = PC01_SEGMENTS.filter((s) => s.kind !== 'quarantine').reduce((sum, s) => sum + s.expected_events, 0);
  const quarantined = PC01_SEGMENTS.filter((s) => s.kind === 'quarantine').reduce((sum, s) => sum + s.expected_rows, 0);
  assert.equal(drained, S.BC_DRAIN.count + S.E_REPLAY.count);
  assert.equal(quarantined, S.D_MARKETPLACE.count + S.E_QUARANTINE.count);
});

// ── the gate ────────────────────────────────────────────────────────────────────────────────────
const row = (event_type, over = {}) => ({ id: 'x', event_type, classification: { effect_class: 'IN_APP_ONLY' }, render_contract: { render_contract_ready: true }, ...over });

test('PC01 gate: an allowed, in-app-only, render-ready batch passes; each refusal names its boundary', () => {
  const d7 = PC01_D7_FAMILIES;
  assert.deepEqual(batchGate([row(d7[0]), row(d7[1])], d7, true), { safe: true });
  assert.equal(batchGate([], d7, true).reason, 'empty_queue');
  assert.equal(batchGate([row(d7[0]), row('evidence.review.decided')], d7, true).reason, 'unauthorized_family_boundary');
  assert.equal(batchGate([row(d7[0], { classification: { effect_class: 'EXTERNAL_CHANNEL_POSSIBLE' } })], d7, true).reason, 'effect_class_boundary');
  assert.equal(batchGate([row(d7[0], { render_contract: { render_contract_ready: false } })], d7, true).reason, 'render_contract_boundary');
  assert.equal(batchGate([row(d7[0])], d7, false).reason, 'combined_gate_boundary');
});

test('PC01 gate: no drain segment ever admits the Class-B family', () => {
  for (const segment of PC01_SEGMENTS.filter((s) => s.allowed)) {
    assert.ok(!segment.allowed.includes(PC01_CLASS_B_FAMILY), segment.key);
    assert.equal(batchGate([row(PC01_CLASS_B_FAMILY)], segment.allowed, true).reason, 'unauthorized_family_boundary', segment.key);
  }
  assert.deepEqual([...PC01_SEGMENTS[0].allowed], [...PC01_D7_FAMILIES], 'S1 admits D7 only');
});

// ── per-row reconciliation ──────────────────────────────────────────────────────────────────────
const good = {
  prior: { attempts: 0, status: 'pending', dead_lettered_at: null },
  after: { attempts: 1, status: 'processed', error_log: null, dead_lettered_at: null },
  beforeFx: { in_app_notifications: 0, messages: 0 },
  afterFx: { in_app_notifications: 1, messages: 1, external_notifications: 0, external_delivery_attempts: 0, external_send_evidence: 0 },
};

test('PC01 row: one attempt, processed, its own in-app notification and message, nothing external', () => {
  const result = evaluateProcessedRow(good);
  assert.equal(result.ok, true);
  assert.equal(result.effect, 'in_app_created');
});

test('PC01 row: every failure mode is a failed row', () => {
  const cases = {
    'attempt not counted': { after: { ...good.after, attempts: 0 } },
    'still pending': { after: { ...good.after, status: 'pending' } },
    'dead lettered': { after: { ...good.after, status: 'dead_letter', dead_lettered_at: '2026-10-10' } },
    'error retained': { after: { ...good.after, error_log: 'boom' } },
    'no in-app notification': { afterFx: { ...good.afterFx, in_app_notifications: 0 } },
    'no message': { afterFx: { ...good.afterFx, messages: 0 } },
    'external notification queued': { afterFx: { ...good.afterFx, external_notifications: 1 } },
    'external attempt': { afterFx: { ...good.afterFx, external_delivery_attempts: 1 } },
    'external send': { afterFx: { ...good.afterFx, external_send_evidence: 1 } },
  };
  for (const [name, over] of Object.entries(cases)) {
    assert.equal(evaluateProcessedRow({ ...good, ...over }).ok, false, name);
  }
});

// ── Phase D ─────────────────────────────────────────────────────────────────────────────────────
const inquiry = {
  inquiry_exists: true, recipient_exists: true, listing_exists: true, inquiry_seller_is_recipient: true,
  buyer_id: null, guest_email_domain: 'example.test', listing_publication_status: 'publishable', listing_status: 'Sold',
  notifications_for_event: 0, notifications_for_inquiry: 0,
};

test('PC01-D: a synthetic UAT inquiry on a listing that is not live is stale historical work', () => {
  assert.equal(marketplaceDisposition(inquiry), PC01_DISPOSITION.STALE_HISTORICAL_QUARANTINE);
  assert.equal(marketplaceDisposition({ ...inquiry, listing_status: 'Available', listing_publication_status: 'publishable' }), PC01_DISPOSITION.STALE_HISTORICAL_QUARANTINE);
});

test('PC01-D: a live listing or a real inquirer is NOT stale — it would need current delivery authority', () => {
  assert.equal(marketplaceDisposition({ ...inquiry, listing_publication_status: 'published', listing_status: 'Available' }), PC01_DISPOSITION.SAFE_CURRENT_DELIVERY);
  assert.equal(marketplaceDisposition({ ...inquiry, guest_email_domain: 'gmail.com' }), PC01_DISPOSITION.SAFE_CURRENT_DELIVERY);
  assert.equal(marketplaceDisposition({ ...inquiry, buyer_id: 'u_real_buyer' }), PC01_DISPOSITION.SAFE_CURRENT_DELIVERY);
});

test('PC01-D: an already-notified inquiry is satisfied; a broken reference is a defect', () => {
  assert.equal(marketplaceDisposition({ ...inquiry, notifications_for_event: 1 }), PC01_DISPOSITION.ALREADY_SATISFIED_IDEMPOTENT);
  assert.equal(marketplaceDisposition({ ...inquiry, notifications_for_inquiry: 1 }), PC01_DISPOSITION.ALREADY_SATISFIED_IDEMPOTENT);
  for (const broken of ['inquiry_exists', 'recipient_exists', 'listing_exists']) {
    assert.equal(marketplaceDisposition({ ...inquiry, [broken]: false }), PC01_DISPOSITION.DEFECT_REQUIRING_REMEDIATION, broken);
  }
  assert.equal(marketplaceDisposition({ ...inquiry, inquiry_seller_is_recipient: false }), PC01_DISPOSITION.DEFECT_REQUIRING_REMEDIATION);
});

// ── Phase E ─────────────────────────────────────────────────────────────────────────────────────
const dead = { event_type: 'evidence.review.decided', recipient_exists: true, notifications_for_event: 0, communications_subscribed: true, policy_in_app_only: true, render_contract_ready: true, superseded_payload_shape: false };

test('PC01-E: replayable only when subscribed, in-app only, render-ready, addressable and not yet satisfied', () => {
  assert.equal(deadLetterDisposition(dead), PC01_DISPOSITION.REPLAYABLE_CURRENT_WORK);
  assert.equal(deadLetterDisposition({ ...dead, notifications_for_event: 1 }), PC01_DISPOSITION.ALREADY_SATISFIED);
  assert.equal(deadLetterDisposition({ ...dead, recipient_exists: false }), PC01_DISPOSITION.SUPERSEDED_HISTORICAL_WORK);
  assert.equal(deadLetterDisposition({ ...dead, event_type: PC01_CLASS_B_FAMILY, superseded_payload_shape: true }), PC01_DISPOSITION.SUPERSEDED_HISTORICAL_WORK);
  for (const missing of ['communications_subscribed', 'policy_in_app_only', 'render_contract_ready']) {
    assert.equal(deadLetterDisposition({ ...dead, [missing]: false }), PC01_DISPOSITION.CURRENT_PRODUCT_DEFECT, missing);
  }
});

// ── source authority ────────────────────────────────────────────────────────────────────────────
test('PC01 authority: every drained or replayed family has a current Communications subscriber and an in-app-only policy', () => {
  const families = new Set([...PC01_D7_FAMILIES, ...PC01_CLASS_A_FAMILIES, ...PC01_E_REPLAY_FAMILIES]);
  for (const family of families) {
    assert.ok(COMMUNICATION_EVENT_TYPES.includes(family), family + ' is subscribed');
    const policy = NOTIFICATION_POLICIES[family];
    assert.ok(policy, family + ' has a policy');
    assert.deepEqual(policy.channels, ['in_app'], family + ' channels');
    assert.deepEqual(policy.fallbackChannels, [], family + ' fallback');
    assert.equal(policy.policyChannelsOnly, true, family + ' policyChannelsOnly');
    assert.ok(policy.templateKey, family + ' template');
  }
  for (const family of PC01_D7_FAMILIES) assert.equal(NOTIFICATION_POLICIES[family].templateKey, 'container_booking_update');
});

test('PC01 authority: the marketplace inquiry policy reaches external channels, which is why it is Class-B', () => {
  const policy = NOTIFICATION_POLICIES[PC01_CLASS_B_FAMILY];
  assert.ok(policy.channels.some((ch) => ch !== 'in_app') || policy.fallbackChannels.length > 0);
  assert.notEqual(policy.policyChannelsOnly, true);
});

// ── the runner's mutation surface ───────────────────────────────────────────────────────────────
test('PC01 runner: the only mutations are the worker poll, the worker replay by exact ids and one provenance-stamped quarantine', () => {
  assert.equal((RUNNER.match(/await eventWorker\.pollEvents\(\)/g) || []).length, 1, 'exactly one worker poll call site');
  assert.equal((RUNNER.match(/await eventWorker\.reprocessDeadLetters\(\{ ids: PC01_FROZEN\.sets\.E_REPLAY\.ids \}\)/g) || []).length, 1, 'exactly one replay call site, by the frozen ids');
  assert.equal((RUNNER.match(/await eventWorker\.reprocessDeadLetters\(/g) || []).length, 1, 'no other replay call');
  assert.equal((RUNNER.match(/UPDATE public\.domain_events/g) || []).length, 1, 'one UPDATE statement — the governed quarantine');
  assert.match(RUNNER, /quarantine_reason = \$3/);
  assert.match(RUNNER, /'original_status', d\.status, 'original_attempts', d\.attempts/);
  for (const banned of [/DELETE FROM/i, /TRUNCATE/i, /SET\s+status\s*=\s*'processed'/i, /SET\s+status\s*=\s*'dead_letter'/i, /eventWorker\.start\(/, /INSERT INTO/i]) {
    assert.ok(!banned.test(RUNNER), 'runner must not contain ' + banned);
  }
  assert.match(RUNNER, /FOR UPDATE NOWAIT/);
  assert.match(RUNNER, /assertFrozenSet\(key\)/);
});

test('PC01 workflow: staging environment, outbound disabled, no interval worker, contract proved before credentials', () => {
  assert.match(WORKFLOW, /environment: staging/);
  assert.match(WORKFLOW, /COMMUNICATION_OUTBOUND_DISABLED: "true"/);
  assert.match(WORKFLOW, /EVENT_WORKER_INTERVAL_ENABLED: "false"/);
  assert.match(WORKFLOW, /CARUP_ENV: staging/);
  assert.ok(!/--prod\b/.test(WORKFLOW));
  const contractStep = WORKFLOW.indexOf('node --test backend/tests/oc5r-pc01-queue-closure-contract.test.js');
  const firstSecret = WORKFLOW.indexOf('secrets.');
  assert.ok(contractStep > 0 && contractStep < firstSecret, 'the offline contract runs before any secret is referenced');
});

test('PC01 helper: id-set equality refuses drift and duplicates', () => {
  assert.equal(assertSameIdSet(['a', 'b'], ['b', 'a'], 't'), true);
  assert.throws(() => assertSameIdSet(['a'], ['a', 'b'], 't'), /id set drift/);
  assert.throws(() => assertSameIdSet(['a', 'a'], ['a'], 't'), /duplicate/);
});
