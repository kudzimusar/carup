#!/usr/bin/env node
/**
 * OC-5R-PC01 B–E — governed queue closure runner (staging only).
 *
 * Executed ONLY by .github/workflows/oc5r-pc01-queue-closure.yml inside the GitHub `staging`
 * environment. Every mutation goes through one of exactly three paths:
 *   - eventWorker.pollEvents()                  (the product's own outbox worker, Communications listeners only)
 *   - eventWorker.reprocessDeadLetters({ ids }) (the worker's own governed replay, EXACT ids)
 *   - one atomic governed-quarantine UPDATE per frozen set (provenance-stamped, B5 pattern)
 * The contract (scripts/ci/lib/oc5r-pc01-queue-closure-contract.mjs) fixes every id, fingerprint,
 * family and total in advance; any drift throws before the next mutation.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import {
  PC01_CLASS_B_FAMILY,
  PC01_CONTINUES_FROM,
  PC01_EXPECTED_FINAL_TOTALS,
  PC01_EXPECTED_START_TOTALS,
  PC01_FINGERPRINT_SQL,
  PC01_FROZEN,
  PC01_SEGMENTS,
  PC01_STAGING_PROJECT_REF,
  PC01_DISPOSITION,
  assertSameIdSet,
  batchGate,
  deadLetterDisposition,
  evaluateProcessedRow,
  expectedQuarantineReasonCounts,
  expectedTotalsAfter,
  marketplaceDisposition,
} from './lib/oc5r-pc01-queue-closure-contract.mjs';

const MAX_CYCLES_PER_SEGMENT = 40;
const RECEIPT_PATH = path.join(process.env.RUNNER_TEMP || process.cwd(), 'oc5r-pc01-queue-closure-receipt.json');

// ── custody ──────────────────────────────────────────────────────────────────────────────────────
const databaseUrl = String(process.env.DIASPORA_STAGING_DATABASE_URL || '');
const supabaseUrl = String(process.env.SUPABASE_URL || '');
const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
if (!databaseUrl || !supabaseUrl || !serviceRole) throw new Error('Required staging credentials are unavailable.');
if (!databaseUrl.includes(PC01_STAGING_PROJECT_REF)) throw new Error('Database URL is not canonical CarUp staging.');
if (new URL(supabaseUrl).hostname !== PC01_STAGING_PROJECT_REF + '.supabase.co') throw new Error('SUPABASE_URL is not canonical CarUp staging.');
if (process.env.COMMUNICATION_OUTBOUND_DISABLED !== 'true') throw new Error('COMMUNICATION_OUTBOUND_DISABLED=true is mandatory.');
if (process.env.EVENT_WORKER_INTERVAL_ENABLED !== 'false') throw new Error('EVENT_WORKER_INTERVAL_ENABLED=false is mandatory.');
if (process.env.CARUP_ENV !== 'staging') throw new Error('CARUP_ENV=staging is mandatory.');
if (process.env.NODE_ENV !== 'production') throw new Error('NODE_ENV=production deployed-like classification is mandatory.');
const authoritySha = String(process.env.GITHUB_SHA || '');
if (!/^[0-9a-f]{40}$/.test(authoritySha)) throw new Error('GITHUB_SHA must be the exact pushed commit.');

process.env.EVENT_WORKER_DATABASE_URL = databaseUrl;
for (const name of ['SUPABASE_POOLER_DB_URL', 'SUPABASE_TRANSACTION_POOLER_URL', 'DATABASE_URL', 'SUPABASE_DB_URL']) delete process.env[name];

const cleaned = databaseUrl.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '');
const client = new pg.Client({ connectionString: cleaned, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query("SET TIME ZONE 'UTC'");

const { eventWorker } = await import('../../backend/services/eventBus/eventWorker.js');
const { registerCommunicationListeners, COMMUNICATION_EVENT_TYPES } = await import('../../backend/services/communication/communicationEventListeners.js');
const { NOTIFICATION_POLICIES } = await import('../../backend/services/communication/communicationNotificationService.js');
const { evaluateRenderContract, governedTemplateRegistrySql } = await import('./lib/oc5r-rel03-render-contract.mjs');
registerCommunicationListeners(eventWorker);

const receipt = {
  schema: 'oc5r-pc01-queue-closure-receipt/v1',
  authority_sha: authoritySha,
  continues_from: PC01_CONTINUES_FROM,
  staging_project_ref: PC01_STAGING_PROJECT_REF,
  started_at: new Date().toISOString(),
  preflight: null,
  segments: [],
  final: null,
};
const log = (value) => console.log(JSON.stringify(value, null, 2));
const saveReceipt = () => fs.writeFileSync(RECEIPT_PATH, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });

// ── read helpers (B6 contract) ───────────────────────────────────────────────────────────────────
async function queueTotals() {
  const { rows } = await client.query(
    "SELECT count(*) FILTER (WHERE status='pending' AND attempts < 5)::int AS eligible_pending," +
    " count(*) FILTER (WHERE status='dead_letter')::int AS dead_letter," +
    " count(*) FILTER (WHERE status='processed')::int AS processed," +
    " count(*) FILTER (WHERE status='quarantined')::int AS quarantined," +
    " count(*) FILTER (WHERE status='pending' AND attempts >= 5)::int AS stuck_pending," +
    " count(*) FILTER (WHERE status NOT IN ('pending','dead_letter','processed','quarantined'))::int AS other" +
    ' FROM public.domain_events');
  return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
}
function coreTotals(t) {
  return { eligible_pending: t.eligible_pending, dead_letter: t.dead_letter, processed: t.processed, quarantined: t.quarantined };
}
async function assertTotals(expected, label) {
  const t = await queueTotals();
  assert.equal(t.stuck_pending, 0, label + ': a pending row reached the attempt ceiling');
  assert.equal(t.other, 0, label + ': an unknown status appeared');
  assert.deepEqual(coreTotals(t), { ...expected }, label + ': queue totals drifted');
  return t;
}
async function quarantineReasonCounts() {
  const { rows } = await client.query("SELECT quarantine_reason, count(*)::int AS n FROM public.domain_events WHERE status='quarantined' GROUP BY 1 ORDER BY 1");
  return Object.fromEntries(rows.map((row) => [row.quarantine_reason, Number(row.n)]));
}
async function schedulerState() {
  const { rows } = await client.query(
    'SELECT jobid,jobname,schedule,active FROM cron.job ' +
    "WHERE jobname IN ('carup-events-outbox-every-minute','carup-communication-worker-every-minute') " +
    "OR command ILIKE '%/api/internal/events/process%' OR command ILIKE '%/api/internal/communications/process%' ORDER BY jobid");
  const eventJob = rows.find((row) => row.jobname === 'carup-events-outbox-every-minute');
  const commJob = rows.find((row) => row.jobname === 'carup-communication-worker-every-minute');
  if (!eventJob || eventJob.active !== false) throw new Error('Event scheduler is not proven inactive.');
  if (!commJob || commJob.active !== false) throw new Error('Communication scheduler is not proven inactive.');
  if (rows.some((row) => row.active === true)) throw new Error('A relevant scheduler became active.');
  return rows.map((row) => ({ jobid: Number(row.jobid), jobname: row.jobname, active: row.active }));
}
async function fingerprint(ids) {
  const { rows } = await client.query(PC01_FINGERPRINT_SQL, [ids]);
  return { total: Number(rows[0].total), fingerprint: rows[0].fingerprint };
}
async function assertFrozenSet(key) {
  const set = PC01_FROZEN.sets[key];
  const observed = await fingerprint(set.ids);
  assert.equal(observed.total, set.count, key + ': frozen set row count drifted');
  assert.equal(observed.fingerprint, set.fingerprint, key + ': frozen set fingerprint drifted');
  return observed;
}
async function globalDeliveryStats() {
  const { rows } = await client.query(
    'SELECT count(*)::int AS attempts,' +
    " count(*) FILTER (WHERE channel IS DISTINCT FROM 'in_app')::int AS external_attempts," +
    " count(*) FILTER (WHERE channel IS DISTINCT FROM 'in_app' AND (provider_message_id IS NOT NULL OR lower(coalesce(status,'')) IN ('accepted','sent','delivered')))::int AS external_send_evidence" +
    ' FROM public.message_delivery_attempts');
  return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
}
async function externalQueueStats() {
  const { rows } = await client.query("SELECT count(*) FILTER (WHERE channel IS DISTINCT FROM 'in_app')::int AS external_rows FROM public.notification_queue");
  return Number(rows[0].external_rows);
}
async function effectStats(ids) {
  const { rows } = await client.query(
    'WITH wanted AS (SELECT unnest($1::text[]) AS event_id), ' +
    'n AS (SELECT q.event_id,count(*)::int AS notifications,' +
    " count(*) FILTER (WHERE q.channel='in_app')::int AS in_app_notifications," +
    " count(*) FILTER (WHERE q.channel IS DISTINCT FROM 'in_app')::int AS external_notifications" +
    ' FROM public.notification_queue q WHERE q.event_id = ANY($1::text[]) GROUP BY q.event_id), ' +
    'm AS (SELECT q.event_id,count(DISTINCT m.id)::int AS messages' +
    ' FROM public.notification_queue q JOIN public.messages m ON m.id=q.message_id' +
    ' WHERE q.event_id = ANY($1::text[]) GROUP BY q.event_id), ' +
    'a AS (SELECT q.event_id,count(a.id)::int AS delivery_attempts,' +
    " count(a.id) FILTER (WHERE a.channel IS DISTINCT FROM 'in_app')::int AS external_delivery_attempts," +
    " count(a.id) FILTER (WHERE a.channel IS DISTINCT FROM 'in_app' AND (a.provider_message_id IS NOT NULL OR lower(coalesce(a.status,'')) IN ('accepted','sent','delivered')))::int AS external_send_evidence" +
    ' FROM public.notification_queue q LEFT JOIN public.message_delivery_attempts a' +
    ' ON a.notification_id=q.id::text OR a.message_id=q.message_id' +
    ' WHERE q.event_id = ANY($1::text[]) GROUP BY q.event_id) ' +
    'SELECT w.event_id,coalesce(n.notifications,0)::int AS notifications,' +
    ' coalesce(n.in_app_notifications,0)::int AS in_app_notifications,' +
    ' coalesce(n.external_notifications,0)::int AS external_notifications,' +
    ' coalesce(m.messages,0)::int AS messages,' +
    ' coalesce(a.delivery_attempts,0)::int AS delivery_attempts,' +
    ' coalesce(a.external_delivery_attempts,0)::int AS external_delivery_attempts,' +
    ' coalesce(a.external_send_evidence,0)::int AS external_send_evidence' +
    ' FROM wanted w LEFT JOIN n USING(event_id) LEFT JOIN m USING(event_id) LEFT JOIN a USING(event_id)' +
    ' ORDER BY array_position($1::text[],w.event_id)', [ids]);
  return new Map(rows.map((row) => [row.event_id, row]));
}
async function eventRows(ids) {
  const { rows } = await client.query(
    'SELECT id::text,event_type,status,attempts,tenant_id,created_at::text,locked_at::text,locked_by,error_log,dead_lettered_at::text ' +
    'FROM public.domain_events WHERE id::text = ANY($1::text[]) ORDER BY array_position($1::text[],id::text)', [ids]);
  return rows;
}
async function queueHead() {
  const { rows } = await client.query(
    "SELECT id::text,event_type FROM public.domain_events WHERE status='pending' AND attempts < 5 ORDER BY created_at ASC LIMIT 10");
  return rows;
}
function runInventory(label) {
  const output = path.join(process.env.RUNNER_TEMP || process.cwd(), 'oc5r-pc01-inventory-' + label + '.json');
  const proc = spawnSync(process.execPath, ['scripts/ci/oc5r-rel03-communications-backlog-inventory.mjs', '--output', output, '--format', 'human'], {
    cwd: process.cwd(), env: process.env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
  });
  if (proc.status !== 0) throw new Error('REL-03 inventory failed for ' + label + ': ' + (proc.stderr || proc.stdout || '').slice(-4000));
  const inventory = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(inventory.target?.kind, 'staging', label + ': inventory target kind drift');
  assert.equal(inventory.target?.project_ref, PC01_STAGING_PROJECT_REF, label + ': inventory target ref drift');
  assert.equal(inventory.boundary?.worker_called, false, label + ': inventory unexpectedly called the worker');
  assert.equal(inventory.boundary?.mutating_sql, false, label + ': inventory became mutating');
  return inventory;
}
async function snapshotBatch(ids) {
  await client.query('BEGIN');
  try {
    const { rows } = await client.query(
      'SELECT id::text,event_type,status,attempts,locked_at::text,locked_by,error_log,dead_lettered_at::text ' +
      'FROM public.domain_events WHERE id::text = ANY($1::text[]) ORDER BY array_position($1::text[],id::text) FOR UPDATE NOWAIT', [ids]);
    assert.deepEqual(rows.map((row) => row.id), ids, 'Batch snapshot lost or reordered exact ids.');
    assert.ok(rows.every((row) => row.status === 'pending'), 'Batch contains a non-pending row.');
    assert.ok(rows.every((row) => row.locked_at === null && row.locked_by === null), 'A candidate row carries lock metadata.');
    const effects = await effectStats(ids);
    await client.query('ROLLBACK');
    return { rows, effects };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

// ── preflight proofs (read-only) ─────────────────────────────────────────────────────────────────
async function marketplaceFacts(ids) {
  const { rows } = await client.query(
    'SELECT e.id::text AS id, e.event_type, e.status,' +
    " (i.id IS NOT NULL) AS inquiry_exists, i.buyer_id, lower(split_part(coalesce(i.guest_email,''),'@',2)) AS guest_email_domain," +
    " (u.id IS NOT NULL) AS recipient_exists, (i.seller_id = e.payload->>'recipientUserId') AS inquiry_seller_is_recipient," +
    ' (v.vin IS NOT NULL) AS listing_exists, v.publication_status AS listing_publication_status, v.status AS listing_status,' +
    ' (SELECT count(*) FROM public.notification_queue q WHERE q.event_id = e.id::text)::int AS notifications_for_event,' +
    " (SELECT count(*) FROM public.notification_queue q JOIN public.domain_events d2 ON d2.id::text = q.event_id WHERE d2.event_type = e.event_type AND d2.payload->>'inquiryId' = e.payload->>'inquiryId' AND d2.id <> e.id)::int AS notifications_for_inquiry" +
    ' FROM public.domain_events e' +
    " LEFT JOIN public.marketplace_inquiries i ON i.id::text = e.payload->>'inquiryId'" +
    " LEFT JOIN public.users u ON u.id = e.payload->>'recipientUserId'" +
    " LEFT JOIN public.vehicles v ON v.vin = e.payload->>'listingId'" +
    ' WHERE e.id::text = ANY($1::text[]) ORDER BY e.id::text', [ids]);
  return rows;
}
async function deadLetterFacts(ids, registry) {
  const { rows } = await client.query(
    'SELECT e.id::text AS id, e.event_type, e.status, e.payload,' +
    " (SELECT count(*) FROM public.users u WHERE u.id = coalesce(e.payload->>'recipientUserId', e.payload->>'recipient_user_id', e.payload->>'userId', e.payload->>'user_id', e.payload->>'buyerId', e.payload->>'buyer_id', e.payload->>'sellerId', e.payload->>'seller_id'))::int AS recipient_rows," +
    ' (SELECT count(*) FROM public.notification_queue q WHERE q.event_id = e.id::text)::int AS notifications_for_event' +
    ' FROM public.domain_events e WHERE e.id::text = ANY($1::text[]) ORDER BY e.id::text', [ids]);
  const communicationTypes = new Set(COMMUNICATION_EVENT_TYPES);
  return rows.map((row) => {
    const policy = NOTIFICATION_POLICIES[row.event_type] || null;
    const channels = policy?.channels || [];
    const render = evaluateRenderContract({ event_type: row.event_type, payload: row.payload }, registry);
    return {
      id: row.id,
      event_type: row.event_type,
      status: row.status,
      recipient_exists: Number(row.recipient_rows) === 1,
      notifications_for_event: Number(row.notifications_for_event),
      communications_subscribed: communicationTypes.has(row.event_type),
      policy_in_app_only: channels.length > 0 && channels.every((ch) => ch === 'in_app') && (policy?.fallbackChannels || []).length === 0 && policy?.policyChannelsOnly === true,
      render_contract_ready: render.render_contract_ready === true,
      superseded_payload_shape: row.event_type === PC01_CLASS_B_FAMILY && !(row.payload && row.payload.sellerId && row.payload.listingId),
    };
  });
}

// ── mutations ────────────────────────────────────────────────────────────────────────────────────
async function governedQuarantine(segment) {
  const set = PC01_FROZEN.sets[segment.set];
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL statement_timeout = '30s'");
    const { rows } = await client.query(
      'SELECT id::text,event_type,status,attempts,locked_at,locked_by FROM public.domain_events WHERE id::text = ANY($1::text[]) ORDER BY id::text FOR UPDATE NOWAIT', [set.ids]);
    assertSameIdSet(rows.map((row) => row.id), set.ids, segment.key + ' lock set');
    assert.ok(rows.every((row) => row.status === segment.from_status), segment.key + ': a frozen row left ' + segment.from_status);
    assert.ok(rows.every((row) => row.locked_at === null && row.locked_by === null), segment.key + ': a frozen row is locked');
    const fp = await fingerprint(set.ids);
    assert.equal(fp.fingerprint, set.fingerprint, segment.key + ': fingerprint drifted inside the transaction');
    const updated = await client.query(
      'UPDATE public.domain_events AS d SET status = $2, quarantined_at = NOW(), quarantine_reason = $3,' +
      ' quarantine_metadata = jsonb_build_object(' +
      "  'programme', 'OC-5R', 'task', $4::text, 'phase', $5::text, 'authority_sha', $6::text," +
      "  'historical_disposition', $3::text, 'original_status', d.status, 'original_attempts', d.attempts," +
      "  'frozen_set', $7::text, 'frozen_fingerprint', $8::text, 'rule', $9::text)" +
      ' WHERE d.id::text = ANY($1::text[]) AND d.status = $10' +
      ' RETURNING d.id::text, d.status, d.quarantine_reason',
      [set.ids, 'quarantined', segment.reason, 'PC01-' + segment.key, segment.phase, authoritySha, segment.set, set.fingerprint, segment.rule, segment.from_status]);
    assert.equal(updated.rowCount, segment.expected_rows, segment.key + ': atomic quarantine row count mismatch');
    assert.ok(updated.rows.every((row) => row.status === 'quarantined' && row.quarantine_reason === segment.reason), segment.key + ': a row was not quarantined with its reason');
    await client.query('COMMIT');
    return { quarantined: updated.rowCount, reason: segment.reason, from_status: segment.from_status, fingerprint: set.fingerprint, deleted: 0, processed: 0 };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function drainSegment(segment, segmentStartTotals) {
  const processedIds = [];
  const cycles = [];
  let stopReason = null;
  let boundaryBatch = [];
  for (let cycle = 1; cycle <= MAX_CYCLES_PER_SEGMENT; cycle += 1) {
    const inventory = runInventory(segment.key + '-c' + cycle);
    const batch = inventory.next_worker_batch || [];
    const gate = batchGate(batch, segment.allowed, inventory.next_worker_batch_review?.combined_batch_gate_passes);
    if (!gate.safe) {
      stopReason = gate.reason;
      boundaryBatch = batch.map((row) => ({ id: row.id, event_type: row.event_type, effect_class: row.classification?.effect_class || null, render_contract_ready: row.render_contract?.render_contract_ready === true }));
      break;
    }
    const ids = batch.map((row) => String(row.id));
    if (processedIds.length + ids.length > segment.expected_events) throw new Error(segment.key + ': next batch would exceed the frozen event count');
    await schedulerState();
    const head = await queueHead();
    assert.deepEqual(head.map((row) => row.id), ids, segment.key + ': queue head drifted from the inventory');
    const before = await snapshotBatch(ids);
    const deliveryBefore = await globalDeliveryStats();
    const externalQueueBefore = await externalQueueStats();

    const poll = await eventWorker.pollEvents();

    const afterRows = await eventRows(ids);
    const afterFx = await effectStats(ids);
    const deliveryAfter = await globalDeliveryStats();
    const externalQueueAfter = await externalQueueStats();
    const totals = await queueTotals();
    const beforeById = new Map(before.rows.map((row) => [row.id, row]));
    const rowResults = afterRows.map((row) => {
      const result = evaluateProcessedRow({ prior: beforeById.get(row.id), after: row, beforeFx: before.effects.get(row.id), afterFx: afterFx.get(row.id) });
      return { id: row.id, event_type: row.event_type, ok: result.ok, effect: result.effect, failed_checks: Object.entries(result.checks).filter(([, v]) => !v).map(([k]) => k), notifications_added: result.notifications_added, messages_added: result.messages_added };
    });
    const cycleOk = !poll?.error && Number(poll?.processed) === ids.length
      && rowResults.every((row) => row.ok)
      && deliveryAfter.external_attempts === deliveryBefore.external_attempts
      && deliveryAfter.external_send_evidence === deliveryBefore.external_send_evidence
      && externalQueueAfter === externalQueueBefore
      && totals.dead_letter === segmentStartTotals.dead_letter
      && totals.quarantined === segmentStartTotals.quarantined;
    const cycleReceipt = {
      cycle, ids, event_types: batch.map((row) => row.event_type), poll,
      rows: rowResults,
      notifications_added: rowResults.reduce((s, r) => s + r.notifications_added, 0),
      messages_added: rowResults.reduce((s, r) => s + r.messages_added, 0),
      external_attempt_delta: deliveryAfter.external_attempts - deliveryBefore.external_attempts,
      external_send_delta: deliveryAfter.external_send_evidence - deliveryBefore.external_send_evidence,
      external_queue_delta: externalQueueAfter - externalQueueBefore,
      totals_after: coreTotals(totals),
      green: cycleOk,
    };
    cycles.push(cycleReceipt);
    log({ phase: 'pc01-cycle', segment: segment.key, ...cycleReceipt });
    if (!cycleOk) throw new Error(segment.key + ': worker anomaly at cycle ' + cycle + ' — no automatic retry is authorised');
    processedIds.push(...ids);
  }
  if (!stopReason) throw new Error(segment.key + ': cycle ceiling reached before the expected boundary');
  return { processedIds, cycles, stopReason, boundaryBatch };
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────────
try {
  // S0 — preflight
  const startTotals = await assertTotals(PC01_EXPECTED_START_TOTALS, 'S0 start');
  const schedulers = await schedulerState();
  assert.deepEqual(await quarantineReasonCounts(), { AUDIT_ONLY_LEGACY: 6, LEGACY_DUPLICATE_DIRECT_NOTIFICATION: 168, LEGACY_DUPLICATE_WORKFLOW_EVENT: 16, RETIRED_HISTORICAL_EVENT: 6 }, 'S0: B5 quarantine drifted');
  const frozen = {};
  for (const key of ['BC_DRAIN', 'D_MARKETPLACE', 'E_QUARANTINE', 'E_REPLAY']) frozen[key] = await assertFrozenSet(key);
  const head = await queueHead();
  assert.deepEqual(head.map((row) => row.id), PC01_FROZEN.sets.S1_D7_PREFIX.ids_in_fifo_order.slice(0, 10), 'S0: queue head is not the frozen D7 head');

  const mFacts = await marketplaceFacts(PC01_FROZEN.sets.D_MARKETPLACE.ids);
  const mDisp = mFacts.map((fact) => ({ id: fact.id, disposition: marketplaceDisposition(fact) }));
  assert.equal(mFacts.length, 82, 'S0: marketplace facts incomplete');
  assert.ok(mFacts.every((fact) => fact.status === 'pending' && fact.event_type === PC01_CLASS_B_FAMILY), 'S0: marketplace set drifted');
  const mBad = mDisp.filter((row) => row.disposition !== PC01_DISPOSITION.STALE_HISTORICAL_QUARANTINE);
  assert.equal(mBad.length, 0, 'S0: a marketplace row is not STALE_HISTORICAL_QUARANTINE: ' + JSON.stringify(mBad.slice(0, 5)));

  const { rows: registry } = await client.query(governedTemplateRegistrySql());
  const replayFacts = await deadLetterFacts(PC01_FROZEN.sets.E_REPLAY.ids, registry);
  const supersededFacts = await deadLetterFacts(PC01_FROZEN.sets.E_QUARANTINE.ids, registry);
  const replayBad = replayFacts.filter((fact) => fact.status !== 'dead_letter' || deadLetterDisposition(fact) !== PC01_DISPOSITION.REPLAYABLE_CURRENT_WORK);
  const supersededBad = supersededFacts.filter((fact) => fact.status !== 'dead_letter' || deadLetterDisposition(fact) !== PC01_DISPOSITION.SUPERSEDED_HISTORICAL_WORK);
  assert.equal(replayFacts.length, 114, 'S0: replay facts incomplete');
  assert.equal(supersededFacts.length, 7, 'S0: superseded facts incomplete');
  assert.equal(replayBad.length, 0, 'S0: a replay row is not REPLAYABLE_CURRENT_WORK: ' + JSON.stringify(replayBad.slice(0, 5)));
  assert.equal(supersededBad.length, 0, 'S0: a superseded row is not SUPERSEDED_HISTORICAL_WORK: ' + JSON.stringify(supersededBad.slice(0, 5)));
  const deliveryStart = await globalDeliveryStats();
  const externalQueueStart = await externalQueueStats();
  receipt.preflight = {
    totals: coreTotals(startTotals), schedulers, frozen,
    queue_head: head.map((row) => row.id),
    marketplace_dispositions: Object.fromEntries(Object.entries(mDisp.reduce((acc, row) => ({ ...acc, [row.disposition]: (acc[row.disposition] || 0) + 1 }), {}))),
    marketplace_rule_facts: {
      synthetic_guest_domains: [...new Set(mFacts.map((f) => f.guest_email_domain))],
      listing_states: [...new Set(mFacts.map((f) => `${f.listing_status}/${f.listing_publication_status}`))],
      prior_notifications: mFacts.reduce((s, f) => s + Number(f.notifications_for_event) + Number(f.notifications_for_inquiry), 0),
    },
    dead_letter_dispositions: {
      REPLAYABLE_CURRENT_WORK: replayFacts.length,
      SUPERSEDED_HISTORICAL_WORK: supersededFacts.length,
      superseded_detail: supersededFacts.map((f) => ({ id: f.id, event_type: f.event_type, recipient_exists: f.recipient_exists, superseded_payload_shape: f.superseded_payload_shape })),
    },
    delivery_start: deliveryStart,
    external_queue_rows_start: externalQueueStart,
  };
  log({ phase: 'pc01-preflight', ...receipt.preflight });
  saveReceipt();

  // S1..S5
  let running = coreTotals(startTotals);
  for (const segment of PC01_SEGMENTS) {
    await schedulerState();
    const started = new Date().toISOString();
    let result;
    if (segment.kind === 'drain') {
      const out = await drainSegment(segment, running);
      assert.equal(out.processedIds.length, segment.expected_events, segment.key + ': processed event count');
      assert.equal(out.stopReason, segment.expected_stop, segment.key + ': unexpected stop reason ' + out.stopReason);
      if (segment.key === 'S1_D7_PREFIX') {
        assert.deepEqual(out.processedIds, PC01_FROZEN.sets.S1_D7_PREFIX.ids_in_fifo_order, 'S1: processed ids are not the frozen D7 prefix');
        assert.deepEqual(out.boundaryBatch.map((row) => row.id), PC01_FROZEN.sets.S1_D7_PREFIX.boundary_batch.map((row) => row.id), 'S1: boundary batch drifted');
        assert.ok(out.boundaryBatch.some((row) => row.event_type === PC01_CLASS_B_FAMILY), 'S1: the boundary is not the Class-B family');
      } else {
        const expectedIds = PC01_FROZEN.sets.BC_DRAIN.ids.filter((id) => !PC01_FROZEN.sets.S1_D7_PREFIX.ids_in_fifo_order.includes(id));
        assertSameIdSet(out.processedIds, expectedIds, segment.key + ' processed set');
      }
      result = { processed: out.processedIds.length, stop_reason: out.stopReason, boundary_batch: out.boundaryBatch, cycles: out.cycles };
    } else if (segment.kind === 'quarantine') {
      result = await governedQuarantine({ ...segment, rule: segment.key === 'S2_D_MARKETPLACE'
        ? 'automated-UAT guest inquiry (reserved test domain), listing not live in public commerce, no prior notification, single event per inquiry; delivery would open push/email/WhatsApp/SMS'
        : 'superseded payload shape (no sellerId/listingId) or recipient identity no longer exists in CarUp authority' });
    } else if (segment.kind === 'replay_drain') {
      const replay = await eventWorker.reprocessDeadLetters({ ids: PC01_FROZEN.sets.E_REPLAY.ids });
      assertSameIdSet(replay.ids.map(String), PC01_FROZEN.sets.E_REPLAY.ids, 'S5 replay set');
      const afterReplay = { ...running, dead_letter: running.dead_letter - replay.replayed, eligible_pending: running.eligible_pending + replay.replayed };
      await assertTotals(afterReplay, 'S5 after replay');
      const out = await drainSegment(segment, afterReplay);
      assertSameIdSet(out.processedIds, PC01_FROZEN.sets.E_REPLAY.ids, 'S5 processed set');
      assert.equal(out.stopReason, segment.expected_stop, segment.key + ': unexpected stop reason ' + out.stopReason);
      result = { replayed: replay.replayed, processed: out.processedIds.length, stop_reason: out.stopReason, cycles: out.cycles };
    }
    running = coreTotals(await assertTotals(expectedTotalsAfter(segment.key), segment.key + ' exit'));
    receipt.segments.push({ key: segment.key, phase: segment.phase, started_at: started, finished_at: new Date().toISOString(), totals_after: running, ...result });
    log({ phase: 'pc01-segment-exit', key: segment.key, totals_after: running });
    saveReceipt();
  }

  // final
  const finalTotals = await assertTotals(PC01_EXPECTED_FINAL_TOTALS, 'final');
  const reasons = await quarantineReasonCounts();
  assert.deepEqual(reasons, Object.fromEntries(Object.entries(expectedQuarantineReasonCounts()).sort(([a], [b]) => a.localeCompare(b))), 'final: quarantine reasons');
  const deliveryEnd = await globalDeliveryStats();
  const externalQueueEnd = await externalQueueStats();
  assert.equal(deliveryEnd.external_attempts, deliveryStart.external_attempts, 'final: external delivery attempts changed');
  assert.equal(deliveryEnd.external_send_evidence, deliveryStart.external_send_evidence, 'final: external send evidence changed');
  assert.equal(externalQueueEnd, externalQueueStart, 'final: an external-channel notification was queued');
  receipt.final = {
    totals: coreTotals(finalTotals), quarantine_reasons: reasons, schedulers: await schedulerState(),
    delivery_end: deliveryEnd, external_queue_rows_end: externalQueueEnd,
    notifications_added: receipt.segments.flatMap((s) => s.cycles || []).reduce((sum, c) => sum + c.notifications_added, 0),
    messages_added: receipt.segments.flatMap((s) => s.cycles || []).reduce((sum, c) => sum + c.messages_added, 0),
    worker_calls: receipt.segments.flatMap((s) => s.cycles || []).length,
    finished_at: new Date().toISOString(),
  };
  log({ phase: 'pc01-final', ...receipt.final });
  saveReceipt();
} catch (error) {
  // Fail closed: record exactly where the run stopped. Every completed mutation was atomic, so the
  // receipt plus the live totals reconstruct the state; nothing is retried automatically.
  receipt.stopped = { at: new Date().toISOString(), message: String(error?.message || error).slice(0, 2000) };
  console.error('PC01 QUEUE CLOSURE STOPPED: ' + receipt.stopped.message);
  process.exitCode = 1;
} finally {
  saveReceipt();
  await Promise.resolve(eventWorker.stop()).catch(() => {});
  await client.end().catch(() => {});
}
process.exit(process.exitCode || 0);
