#!/usr/bin/env node
import fs from 'node:fs';
import { withReadOnlyDatabase } from './lib/oc5r-rel03-db-readonly.mjs';
import { classifyEventTypes } from './lib/oc5r-rel03-subscriber-classifier.mjs';

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const outputPath = argValue('--output');
const format = argValue('--format') || 'both';
if (!['human', 'json', 'both'].includes(format)) {
  throw new Error('--format must be human, json or both');
}

const databaseUrl = process.env.DIASPORA_STAGING_DATABASE_URL || '';
const allowLocalTest = process.env.OC5R_REL03_ALLOW_LOCAL_TEST_DB === 'true';

const report = await withReadOnlyDatabase(databaseUrl, async ({ target, query }) => {
  const grouped = await query(`
    SELECT
      status,
      event_type,
      count(*)::bigint AS count,
      min(created_at)::text AS oldest_created_at,
      max(created_at)::text AS newest_created_at
    FROM public.domain_events
    GROUP BY status, event_type
    ORDER BY status, event_type
  `);

  const tenants = await query(`
    SELECT
      event_type,
      tenant_id,
      count(*)::bigint AS count
    FROM public.domain_events
    GROUP BY event_type, tenant_id
    ORDER BY event_type, count(*) DESC, tenant_id NULLS LAST
  `);

  const eventTypes = grouped.rows.map((row) => row.event_type);
  const sourceClassification = classifyEventTypes(eventTypes);
  const classificationByType = new Map(sourceClassification.map((row) => [row.event_type, row]));

  const tenantByType = new Map();
  for (const row of tenants.rows) {
    const list = tenantByType.get(row.event_type) || [];
    list.push({ tenant_id: row.tenant_id, count: Number(row.count) });
    tenantByType.set(row.event_type, list);
  }

  const liveBacklogObservation = grouped.rows.map((row) => ({
    status: row.status,
    event_type: row.event_type,
    count: Number(row.count),
    oldest_created_at: row.oldest_created_at,
    newest_created_at: row.newest_created_at,
    tenant_distribution: tenantByType.get(row.event_type) || [],
    source_classification: classificationByType.get(row.event_type) || null,
  }));

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    target: {
      kind: target.kind,
      project_ref: target.projectRef,
    },
    boundary: {
      transaction: 'BEGIN READ ONLY',
      mutating_sql: false,
      worker_called: false,
      live_rows_changed: false,
    },
    source_classification_note: 'SOURCE CLASSIFICATION is derived from this checkout. It does not prove which rows exist in staging.',
    live_observation_note: 'LIVE BACKLOG OBSERVATION is read-only database evidence. It does not by itself prove a subscriber will complete successfully.',
    source_classification: sourceClassification,
    live_backlog_observation: liveBacklogObservation,
  };
}, { allowLocalTest });

const human = [
  'OC-5R-REL-03 Communications backlog inventory (READ ONLY)',
  `Target: ${report.target.kind} / ${report.target.project_ref}`,
  `Observed groups: ${report.live_backlog_observation.length}`,
  '',
  'status | event_type | count | oldest | newest | effect',
  ...report.live_backlog_observation.map((row) =>
    `${row.status} | ${row.event_type} | ${row.count} | ${row.oldest_created_at || '-'} | ${row.newest_created_at || '-'} | ${row.source_classification?.effect_class || 'UNKNOWN_REQUIRES_REVIEW'}`),
  '',
  'SOURCE CLASSIFICATION and LIVE BACKLOG OBSERVATION are intentionally separate.',
].join('\n');

const json = JSON.stringify(report, null, 2);
if (outputPath) {
  fs.writeFileSync(outputPath, json + '\n', { mode: 0o600 });
}
if (format === 'human' || format === 'both') console.log(human);
if (format === 'json' || (format === 'both' && !outputPath)) console.log(json);
