#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { withReadOnlyDatabase } from './lib/oc5r-rel03-db-readonly.mjs';
import {
  extractTrackedEventIds,
  trackedDomainEventsSql,
} from './lib/oc5r-rel03-worker-custody.mjs';

const TABLES = Object.freeze([
  {
    name: 'notification_queue',
    time: 'created_at',
    columns: ['id', 'recipient_user_id', 'thread_id', 'message_id', 'event_id', 'notification_type', 'channel', 'provider', 'status', 'attempt_count', 'created_at', 'updated_at', 'payload'],
  },
  {
    name: 'message_threads',
    time: 'created_at',
    columns: ['id', 'tenant_id', 'thread_type', 'subject_type', 'subject_id', 'primary_user_id', 'status', 'created_at', 'updated_at', 'last_message_at'],
  },
  {
    name: 'messages',
    time: 'created_at',
    columns: ['id', 'thread_id', 'direction', 'channel', 'provider', 'status', 'created_at', 'updated_at'],
  },
  {
    name: 'message_delivery_attempts',
    time: 'started_at',
    columns: ['id', 'message_id', 'notification_id', 'attempt_number', 'provider', 'channel', 'status', 'provider_message_id', 'started_at', 'completed_at'],
  },
]);

function arg(name, required = false) {
  const i = process.argv.indexOf(name);
  const value = i >= 0 ? process.argv[i + 1] : null;
  if (required && !value) throw new Error(`${name} is required`);
  return value;
}

function validIso(label, value) {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) throw new Error(`${label} must be an ISO timestamp`);
  return new Date(ms).toISOString();
}

function quoteIdent(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function sourceSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read tracked-event inventory ${file}: ${error.message}`);
  }
}

const since = validIso('--since', arg('--since', true));
const until = validIso('--until', arg('--until') || new Date().toISOString());
if (Date.parse(until) < Date.parse(since)) throw new Error('--until must not be before --since');
const output = arg('--output', true);
const trackEventsFrom = arg('--track-events-from', true);
const trackedInventory = loadJson(trackEventsFrom);
const trackedEventIds = extractTrackedEventIds(trackedInventory);
const databaseUrl = process.env.DIASPORA_STAGING_DATABASE_URL || '';
const allowLocalTest = process.env.OC5R_REL03_ALLOW_LOCAL_TEST_DB === 'true';

const snapshot = await withReadOnlyDatabase(databaseUrl, async ({ target, query }) => {
  const tables = {};
  for (const spec of TABLES) {
    const schema = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [spec.name]);
    const available = new Set(schema.rows.map((row) => row.column_name));
    if (!available.has(spec.time)) {
      tables[spec.name] = { available: false, time_column: spec.time, columns: [], rows: [] };
      continue;
    }
    const columns = spec.columns.filter((column) => available.has(column));
    if (!columns.includes('id')) {
      tables[spec.name] = { available: false, time_column: spec.time, columns, rows: [] };
      continue;
    }
    const select = columns.map(quoteIdent).join(', ');
    const sql = `SELECT ${select} FROM public.${quoteIdent(spec.name)}
      WHERE ${quoteIdent(spec.time)} >= $1::timestamptz
        AND ${quoteIdent(spec.time)} <= $2::timestamptz
      ORDER BY ${quoteIdent(spec.time)} ASC, id ASC`;
    const result = await query(sql, [since, until]);
    tables[spec.name] = {
      available: true,
      time_column: spec.time,
      columns,
      rows: result.rows,
    };
  }

  const trackedRows = trackedEventIds.length
    ? (await query(trackedDomainEventsSql(), [trackedEventIds])).rows
    : [];

  return {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    source_sha: sourceSha(),
    target: { kind: target.kind, project_ref: target.projectRef },
    window: { since, until },
    boundary: { transaction: 'BEGIN READ ONLY', mutating_sql: false, worker_called: false },
    tracked_worker_batch: {
      source_inventory: trackEventsFrom,
      expected_ids: trackedEventIds,
      rows: trackedRows,
      selection_basis: 'exact event IDs from inventory.next_worker_batch; independent of created_at/status',
    },
    tables,
  };
}, { allowLocalTest });

fs.writeFileSync(output, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
console.log(`REL-03 read-only snapshot: ${snapshot.target.project_ref}`);
console.log(`Window for newly-created Communications rows: ${snapshot.window.since} → ${snapshot.window.until}`);
console.log(`Tracked worker events: ${snapshot.tracked_worker_batch.rows.length}/${snapshot.tracked_worker_batch.expected_ids.length}`);
for (const [name, value] of Object.entries(snapshot.tables)) {
  console.log(`${name}: ${value.available ? value.rows.length : 'UNAVAILABLE'}`);
}
console.log(`JSON: ${output}`);
