#!/usr/bin/env node
import pg from 'pg';
import {
  REL03B5_EXPECTED_FINGERPRINT,
  REL03B5_EXPECTED_TOTAL,
  REL03B5_FAMILY_COUNTS,
  REL03B5_SOURCE_CONVERGENCE_SHA,
  assertReasonTotals,
  assertRel03b5StagingTarget,
  reasonCountsForRows,
  reasonForHistoricalEvent,
  validateFrozenPopulation,
} from './lib/oc5r-rel03b5-quarantine-contract.mjs';
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

const authoritySha = String(value('--authority-sha') || '').trim();
if (!/^[0-9a-f]{40}$/.test(authoritySha)) {
  throw new Error('--authority-sha must be the exact 40-character final source SHA.');
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

const eventTypes = Object.keys(REL03B5_FAMILY_COUNTS);

const candidateSql = [
  'SELECT',
  '  id::text,',
  '  event_type,',
  '  status,',
  '  attempts,',
  '  tenant_id,',
  '  created_at::text,',
  '  available_at::text,',
  '  processed_at::text,',
  '  locked_at::text,',
  '  locked_by,',
  '  dead_lettered_at::text,',
  '  error_log',
  'FROM public.domain_events',
  "WHERE status = 'pending'",
  '  AND event_type = ANY($1::text[])',
  'ORDER BY id',
].join('\n');

const fingerprintSql = [
  'SELECT',
  '  count(*)::int AS total,',
  '  count(*) FILTER (WHERE locked_at IS NOT NULL OR locked_by IS NOT NULL)::int AS locked_rows,',
  '  md5(coalesce(string_agg(',
  "    concat_ws('|',",
  "      id::text,event_type,status,attempts::text,coalesce(tenant_id,''),",
  "      created_at::text,coalesce(available_at::text,''),coalesce(processed_at::text,''),",
  "      coalesce(locked_at::text,''),coalesce(locked_by,''),coalesce(dead_lettered_at::text,''),",
  "      coalesce(error_log,'')",
  '    ),',
  "    '||' ORDER BY id::text",
  "  ),'')) AS fingerprint",
  'FROM public.domain_events',
  "WHERE status = 'pending'",
  '  AND event_type = ANY($1::text[])',
].join('\n');

function summarize(rows, fingerprintRow) {
  const familyCounts = {};
  for (const row of rows) {
    familyCounts[row.event_type] = (familyCounts[row.event_type] || 0) + 1;
  }
  return {
    total: Number(fingerprintRow.total),
    fingerprint: fingerprintRow.fingerprint,
    locked_rows: Number(fingerprintRow.locked_rows),
    family_counts: familyCounts,
  };
}

await client.connect();
let committed = false;
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout = '20s'");

  const candidates = await client.query(candidateSql, [eventTypes]);
  const fingerprint = await client.query(fingerprintSql, [eventTypes]);
  const summary = summarize(candidates.rows, fingerprint.rows[0] || {});
  validateFrozenPopulation(summary);

  if (candidates.rows.some((row) => row.status !== 'pending')) {
    throw new Error('REL-03B-5 STATUS DRIFT: all frozen rows must still be pending.');
  }
  if (candidates.rows.some((row) => row.locked_at !== null || row.locked_by !== null)) {
    throw new Error('REL-03B-5 LOCKED ROW STOP: clear no locks without moderator authority.');
  }

  const ids = candidates.rows.map((row) => row.id);
  const reasons = candidates.rows.map((row) => reasonForHistoricalEvent(row.event_type));

  if (dryRun) {
    const previewRows = candidates.rows.map((row, index) => ({
      event_type: row.event_type,
      quarantine_reason: reasons[index],
    }));
    const reasonCounts = reasonCountsForRows(previewRows);
    assertReasonTotals(reasonCounts);
    await client.query('ROLLBACK');
    console.log(JSON.stringify({
      mode: 'dry-run',
      target,
      total: summary.total,
      fingerprint: summary.fingerprint,
      expected_fingerprint: REL03B5_EXPECTED_FINGERPRINT,
      family_counts: summary.family_counts,
      reason_counts: reasonCounts,
      locked_rows: summary.locked_rows,
      mutating_sql: false,
    }, null, 2));
    process.exit(0);
  }

  const updateSql = [
    'WITH selected AS (',
    '  SELECT *',
    '  FROM unnest($1::uuid[], $2::text[]) AS x(id, reason)',
    ')',
    'UPDATE public.domain_events AS d',
    'SET',
    "  status = 'quarantined',",
    '  quarantined_at = NOW(),',
    '  quarantine_reason = selected.reason,',
    '  quarantine_metadata = jsonb_build_object(',
    "    'programme', 'OC-5R',",
    "    'task', 'REL-03B-5',",
    "    'authority_sha', $3::text,",
    "    'historical_disposition', selected.reason,",
    "    'original_status', d.status,",
    "    'original_attempts', d.attempts,",
    "    'source_convergence_sha', $4::text",
    '  )',
    'FROM selected',
    'WHERE d.id = selected.id',
    "  AND d.status = 'pending'",
    'RETURNING d.id::text,d.event_type,d.status,d.attempts,d.quarantine_reason',
  ].join('\n');

  const updated = await client.query(updateSql, [ids, reasons, authoritySha, REL03B5_SOURCE_CONVERGENCE_SHA]);
  if (updated.rowCount !== REL03B5_EXPECTED_TOTAL) {
    throw new Error('REL-03B-5 ATOMICITY FAILURE: updated row count was not 196.');
  }
  if (updated.rows.some((row) => row.status !== 'quarantined')) {
    throw new Error('REL-03B-5 STATUS FAILURE: a selected row was not quarantined.');
  }

  const reasonCounts = reasonCountsForRows(updated.rows);
  assertReasonTotals(reasonCounts);

  await client.query('COMMIT');
  committed = true;
  console.log(JSON.stringify({
    mode: 'apply',
    target,
    selected: ids.length,
    quarantined: updated.rowCount,
    fingerprint: summary.fingerprint,
    deleted: 0,
    processed: 0,
    dead_lettered: 0,
    reason_counts: reasonCounts,
    authority_sha: authoritySha,
  }, null, 2));
} catch (error) {
  if (!committed) await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
