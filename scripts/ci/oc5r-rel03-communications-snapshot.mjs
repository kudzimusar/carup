#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { withReadOnlyDatabase } from './lib/oc5r-rel03-db-readonly.mjs';

const TABLES = Object.freeze([
  {
    name: 'domain_events',
    time: 'created_at',
    columns: ['id', 'event_type', 'status', 'attempts', 'tenant_id', 'dedupe_key', 'created_at', 'updated_at', 'available_at', 'dead_lettered_at', 'payload'],
  },
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

const since = validIso('--since', arg('--since', true));
const until = validIso('--until', arg('--until') || new Date().toISOString());
if (Date.parse(until) < Date.parse(since)) throw new Error('--until must not be before --since');
const output = arg('--output', true);
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
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source_sha: sourceSha(),
    target: { kind: target.kind, project_ref: target.projectRef },
    window: { since, until },
    boundary: { transaction: 'BEGIN READ ONLY', mutating_sql: false, worker_called: false },
    tables,
  };
}, { allowLocalTest });

fs.writeFileSync(output, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
console.log(`REL-03 read-only snapshot: ${snapshot.target.project_ref}`);
console.log(`Window: ${snapshot.window.since} → ${snapshot.window.until}`);
for (const [name, value] of Object.entries(snapshot.tables)) {
  console.log(`${name}: ${value.available ? value.rows.length : 'UNAVAILABLE'}`);
}
console.log(`JSON: ${output}`);
