#!/usr/bin/env node
import fs from 'node:fs';
import {
  assertTrackedReconciliationComplete,
  reconcileTrackedWorkerBatch,
} from './lib/oc5r-rel03-worker-custody.mjs';

function arg(name, required = false) {
  const i = process.argv.indexOf(name);
  const value = i >= 0 ? process.argv[i + 1] : null;
  if (required && !value) throw new Error(`${name} is required`);
  return value;
}

function load(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function stable(value) {
  return JSON.stringify(canonical(value));
}

function changedFields(before, after) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].sort();
  const out = {};
  for (const key of keys) {
    if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) {
      out[key] = { before: before?.[key] ?? null, after: after?.[key] ?? null };
    }
  }
  return out;
}

function compareRows(beforeRows = [], afterRows = []) {
  const before = new Map(beforeRows.map((row) => [String(row.id), row]));
  const after = new Map(afterRows.map((row) => [String(row.id), row]));
  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, row] of after) if (!before.has(id)) added.push(row);
  for (const [id, row] of before) if (!after.has(id)) removed.push(row);
  for (const [id, row] of after) {
    if (!before.has(id)) continue;
    const old = before.get(id);
    if (stable(old) !== stable(row)) changed.push({ id, fields: changedFields(old, row) });
  }
  return { added, removed, changed };
}

const beforePath = arg('--before', true);
const afterPath = arg('--after', true);
const outputPath = arg('--output', true);
const before = load(beforePath);
const after = load(afterPath);

if (before?.target?.project_ref !== after?.target?.project_ref) {
  throw new Error('Snapshot target mismatch; refusing reconciliation.');
}
if (!before?.target?.project_ref) throw new Error('Snapshot target identity is missing.');

const trackedWorkerBatch = reconcileTrackedWorkerBatch(
  before?.tracked_worker_batch,
  after?.tracked_worker_batch,
);

const tables = {};
for (const table of ['notification_queue', 'message_threads', 'messages', 'message_delivery_attempts']) {
  tables[table] = compareRows(before?.tables?.[table]?.rows || [], after?.tables?.[table]?.rows || []);
}

const newExternalAttempts = tables.message_delivery_attempts.added.filter((row) =>
  !['in_app', 'web_chat', 'mobile_chat'].includes(String(row.channel || '').toLowerCase()));

const report = {
  schema_version: 2,
  generated_at: new Date().toISOString(),
  target: before.target,
  before_source_sha: before.source_sha || null,
  after_source_sha: after.source_sha || null,
  windows: { before: before.window, after: after.window },
  tracked_worker_batch: trackedWorkerBatch,
  tables,
  summary: {
    tracked_batch_complete: trackedWorkerBatch.complete,
    tracked_batch_stop_required: trackedWorkerBatch.stop_required,
    tracked_status_transitions: trackedWorkerBatch.status_transitions.length,
    tracked_attempt_transitions: trackedWorkerBatch.attempt_transitions.length,
    added_notifications: tables.notification_queue.added.length,
    added_threads: tables.message_threads.added.length,
    added_messages: tables.messages.added.length,
    added_delivery_attempts: tables.message_delivery_attempts.added.length,
    new_external_delivery_attempts: newExternalAttempts,
    removed_rows: Object.fromEntries(Object.entries(tables).map(([name, delta]) => [name, delta.removed.length])),
  },
};

fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log('OC-5R-REL-03 Communications before/after reconciliation');
console.log(`Target: ${report.target.project_ref}`);
console.log(`Tracked worker events: ${trackedWorkerBatch.observed_after.length}/${trackedWorkerBatch.expected_ids.length}`);
console.log(`Tracked status transitions: ${trackedWorkerBatch.status_transitions.length}`);
console.log(`Tracked attempt transitions: ${trackedWorkerBatch.attempt_transitions.length}`);
for (const [name, delta] of Object.entries(tables)) {
  console.log(`${name}: +${delta.added.length} / -${delta.removed.length} / ~${delta.changed.length}`);
}
console.log(`New external delivery attempts: ${newExternalAttempts.length}`);
console.log(`JSON: ${outputPath}`);

assertTrackedReconciliationComplete(trackedWorkerBatch);
