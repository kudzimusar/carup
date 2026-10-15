#!/usr/bin/env node
import fs from 'node:fs';
import { withReadOnlyDatabase } from './lib/oc5r-rel03-db-readonly.mjs';
import { classifyEventTypes } from './lib/oc5r-rel03-subscriber-classifier.mjs';
import {
  assertObservedNextWorkerBatch,
  loadWorkerSelectionContract,
  nextWorkerBatchSql,
  reviewNextWorkerBatch,
} from './lib/oc5r-rel03-worker-custody.mjs';
import {
  attachRenderContracts,
  governedTemplateRegistrySql,
  pendingEligiblePayloadSql,
  summarizeClassARenderContracts,
} from './lib/oc5r-rel03-render-contract.mjs';

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
const workerContract = loadWorkerSelectionContract();

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

  const statusSummaryResult = await query(`
    SELECT
      count(*) FILTER (WHERE status = 'pending' AND attempts < $1)::bigint AS deliverable_pending,
      count(*) FILTER (WHERE status = 'dead_letter')::bigint AS dead_letter,
      count(*) FILTER (WHERE status = 'quarantined')::bigint AS quarantined,
      count(*) FILTER (WHERE status = 'processed')::bigint AS processed
    FROM public.domain_events
  `, [workerContract.max_outbox_attempts]);

  const quarantineColumnResult = await query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'domain_events'
      AND column_name IN ('quarantined_at', 'quarantine_reason', 'quarantine_metadata')
    ORDER BY column_name
  `);
  const quarantineColumnsReady = quarantineColumnResult.rows.length === 3;
  const quarantineReasonResult = quarantineColumnsReady
    ? await query(`
        SELECT quarantine_reason, count(*)::bigint AS count
        FROM public.domain_events
        WHERE status = 'quarantined'
        GROUP BY quarantine_reason
        ORDER BY quarantine_reason
      `)
    : { rows: [] };

  const nextBatchResult = await query(nextWorkerBatchSql(workerContract), [workerContract.max_outbox_attempts]);
  assertObservedNextWorkerBatch(nextBatchResult.rows, workerContract);
  const registryResult = await query(governedTemplateRegistrySql());
  const pendingEligibleResult = await query(pendingEligiblePayloadSql(), [workerContract.max_outbox_attempts]);

  const eventTypes = [
    ...grouped.rows.map((row) => row.event_type),
    ...nextBatchResult.rows.map((row) => row.event_type),
  ];
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

  const nextWithContracts = attachRenderContracts(nextBatchResult.rows, registryResult.rows, classificationByType);
  const nextWorkerBatch = nextWithContracts.map((row) => ({
    id: String(row.id),
    event_type: row.event_type,
    status: row.status,
    attempts: Number(row.attempts),
    tenant_id: row.tenant_id,
    created_at: row.created_at,
    classification: classificationByType.get(row.event_type) || {
      effect_class: 'UNKNOWN_REQUIRES_REVIEW',
      confidence: 'unknown',
      source_files: [],
    },
    render_contract: row.render_contract,
  }));
  const classARenderContractReview = summarizeClassARenderContracts(
    pendingEligibleResult.rows,
    registryResult.rows,
    classificationByType,
  );

  return {
    schema_version: 2,
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
    worker_selection_contract: {
      source_file: workerContract.source_file,
      status: workerContract.status,
      attempts_predicate: `attempts < ${workerContract.max_outbox_attempts}`,
      max_outbox_attempts: workerContract.max_outbox_attempts,
      order_by: workerContract.order_by,
      batch_limit: workerContract.batch_limit,
      observation_locking_note: 'Inventory reproduces eligibility/order/limit but does not acquire row locks because it is strictly read-only.',
    },
    source_classification_note: 'SOURCE CLASSIFICATION is derived from this checkout. It does not prove which rows exist in staging.',
    live_observation_note: 'LIVE BACKLOG OBSERVATION is read-only database evidence. It does not by itself prove a subscriber will complete successfully.',
    operator_guidance: {
      NO_CURRENT_SUBSCRIBER: {
        instruction: 'DO NOT CALL CURRENT WORKER UNTIL PROVEN DISPOSITION.',
        worker_semantics: 'The worker now retains an explicit NO_CURRENT_SUBSCRIBER failure through its normal retry/dead-letter path; preservation or quarantine is not business-event success.',
        disposition_note: 'A real subscriber, an audit-only designation, or historical terminal quarantine requires separate provenance authority.',
      },
    },
    source_classification: sourceClassification,
    live_backlog_observation: liveBacklogObservation,
    queue_status_totals: {
      deliverable_pending: Number(statusSummaryResult.rows[0]?.deliverable_pending || 0),
      dead_letter: Number(statusSummaryResult.rows[0]?.dead_letter || 0),
      quarantined: Number(statusSummaryResult.rows[0]?.quarantined || 0),
      processed: Number(statusSummaryResult.rows[0]?.processed || 0),
    },
    historical_quarantine_count: Number(statusSummaryResult.rows[0]?.quarantined || 0),
    quarantine_reason_counts: quarantineReasonResult.rows.map((row) => ({
      reason: row.quarantine_reason,
      count: Number(row.count),
    })),
    next_worker_batch: nextWorkerBatch,
    next_worker_batch_review: reviewNextWorkerBatch(nextWorkerBatch),
    class_a_render_contract_review: classARenderContractReview,
    class_a_render_contract_gate_passes: classARenderContractReview.length > 0
      && classARenderContractReview.every((row) => row.result === 'PASS'),
  };
}, { allowLocalTest });

const human = [
  'OC-5R-REL-03 Communications backlog inventory (READ ONLY)',
  `Target: ${report.target.kind} / ${report.target.project_ref}`,
  `Observed groups: ${report.live_backlog_observation.length}`,
  `Authoritative worker batch: pending, attempts < ${report.worker_selection_contract.max_outbox_attempts}, created_at ASC, LIMIT ${report.worker_selection_contract.batch_limit}`,
  '',
  'status | event_type | count | oldest | newest | effect',
  ...report.live_backlog_observation.map((row) =>
    `${row.status} | ${row.event_type} | ${row.count} | ${row.oldest_created_at || '-'} | ${row.newest_created_at || '-'} | ${row.source_classification?.effect_class || 'UNKNOWN_REQUIRES_REVIEW'}`),
  '',
  'QUEUE STATUS TOTALS',
  `deliverable_pending=${report.queue_status_totals.deliverable_pending} dead_letter=${report.queue_status_totals.dead_letter} quarantined=${report.queue_status_totals.quarantined} processed=${report.queue_status_totals.processed}`,
  `historical_quarantine_count=${report.historical_quarantine_count}`,
  ...report.quarantine_reason_counts.map((row) => `quarantine_reason=${row.reason || '<null>'} count=${row.count}`),
  '',
  'NEXT WORKER BATCH',
  'id | event_type | attempts | tenant_id | created_at | effect',
  ...report.next_worker_batch.map((row) =>
    `${row.id} | ${row.event_type} | ${row.attempts} | ${row.tenant_id || '-'} | ${row.created_at} | ${row.classification?.effect_class || 'UNKNOWN_REQUIRES_REVIEW'} | render=${row.render_contract?.render_contract_ready === true ? 'READY' : 'STOP'}`),
  `Default classification gate passes: ${report.next_worker_batch_review.default_classification_gate_passes}`,
  `Render-contract gate passes: ${report.next_worker_batch_review.render_contract_gate_passes}`,
  `Combined batch gate passes: ${report.next_worker_batch_review.combined_batch_gate_passes}`,
  `STOP required: ${report.next_worker_batch_review.stop_required}`,
  '',
  'PENDING CLASS-A RENDER CONTRACTS (payloads withheld)',
  'event_type | count | template | required | missing | result',
  ...report.class_a_render_contract_review.map((row) =>
    `${row.event_type} | ${row.count} | ${row.policy_template || '-'} | ${(row.required_variables || []).join(',') || '-'} | ${(row.missing_required_variables || []).join(',') || '-'} | ${row.result}`),
  `Class-A render-contract gate passes: ${report.class_a_render_contract_gate_passes}`,
  '',
  'OPERATOR GUIDANCE',
  `NO_CURRENT_SUBSCRIBER: ${report.operator_guidance.NO_CURRENT_SUBSCRIBER.instruction}`,
  report.operator_guidance.NO_CURRENT_SUBSCRIBER.worker_semantics,
  report.operator_guidance.NO_CURRENT_SUBSCRIBER.disposition_note,
  '',
  'SOURCE CLASSIFICATION and LIVE BACKLOG OBSERVATION are intentionally separate.',
  'COMMUNICATION_OUTBOUND_DISABLED does not override next-batch classification.',
].join('\n');

const json = JSON.stringify(report, null, 2);
if (outputPath) {
  fs.writeFileSync(outputPath, json + '\n', { mode: 0o600 });
}
if (format === 'human' || format === 'both') console.log(human);
if (format === 'json' || (format === 'both' && !outputPath)) console.log(json);
