#!/usr/bin/env node
import fs from 'node:fs';
import pg from 'pg';
import { assertRel03b5StagingTarget } from './lib/oc5r-rel03b5-quarantine-contract.mjs';
import { identifyDatabaseTarget } from './lib/oc5r-rel03-db-readonly.mjs';

function has(flag) {
  return process.argv.includes(flag);
}

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

const dryRun = has('--dry-run');
const apply = has('--apply');
if (dryRun === apply) throw new Error('Choose exactly one of --dry-run or --apply.');

const idsFile = value('--ids-file');
if (!idsFile) throw new Error('--ids-file is required; wildcard or event-type restoration is forbidden.');

const operatorReason = String(value('--reason') || '').trim();
if (operatorReason.length < 8) {
  throw new Error('--reason is required and must explain the explicit restoration authority.');
}

const parsed = JSON.parse(fs.readFileSync(idsFile, 'utf8'));
if (!Array.isArray(parsed) || parsed.length === 0) {
  throw new Error('--ids-file must contain a non-empty JSON array of exact domain_events IDs.');
}
const ids = [...new Set(parsed.map((id) => String(id).trim()).filter(Boolean))];
if (ids.length !== parsed.length) throw new Error('Duplicate or empty IDs are refused.');
if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
  throw new Error('Every restore ID must be an explicit UUID.');
}

const databaseUrl = process.env.DIASPORA_STAGING_DATABASE_URL || '';
const target = assertRel03b5StagingTarget(identifyDatabaseTarget(databaseUrl));
const cleaned = databaseUrl
  .replace(/([?&])sslmode=[^&]*&?/i, '$1')
  .replace(/[?&]$/, '');

const client = new pg.Client({
  connectionString: cleaned,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
let committed = false;
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout = '20s'");

  const selected = await client.query(
    "SELECT id::text,status,quarantine_reason FROM public.domain_events WHERE id = ANY($1::uuid[]) ORDER BY id",
    [ids],
  );
  if (selected.rowCount !== ids.length) {
    throw new Error('RESTORE REFUSED: one or more exact IDs do not exist.');
  }
  if (selected.rows.some((row) => row.status !== 'quarantined')) {
    throw new Error('RESTORE REFUSED: every exact ID must currently be quarantined.');
  }

  if (dryRun) {
    await client.query('ROLLBACK');
    console.log(JSON.stringify({
      mode: 'dry-run',
      target,
      ids,
      operator_reason: operatorReason,
      mutating_sql: false,
    }, null, 2));
    process.exit(0);
  }

  const restoreSql = [
    'UPDATE public.domain_events',
    "SET status = 'pending',",
    '    quarantined_at = NULL,',
    '    quarantine_reason = NULL,',
    '    quarantine_metadata = NULL',
    'WHERE id = ANY($1::uuid[])',
    "  AND status = 'quarantined'",
    'RETURNING id::text,status,attempts',
  ].join('\n');

  const restored = await client.query(restoreSql, [ids]);
  if (restored.rowCount !== ids.length) {
    throw new Error('RESTORE ATOMICITY FAILURE: not all exact IDs were restored.');
  }

  await client.query('COMMIT');
  committed = true;
  console.log(JSON.stringify({
    mode: 'apply',
    target,
    restored: restored.rowCount,
    ids,
    operator_reason: operatorReason,
    attempts_preserved: true,
  }, null, 2));
} catch (error) {
  if (!committed) await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
