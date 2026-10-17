import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DEFAULT_ALLOWED_WORKER_EFFECTS = Object.freeze(['IN_APP_ONLY', 'AUDIT_ONLY']);
export const DEFAULT_STOP_WORKER_EFFECTS = Object.freeze([
  'EXTERNAL_CHANNEL_POSSIBLE',
  'NON_COMMUNICATION_SIDE_EFFECT',
  'NO_CURRENT_SUBSCRIBER',
  'UNKNOWN_REQUIRES_REVIEW',
]);

function workerSource(root = DEFAULT_ROOT) {
  const rel = 'backend/services/eventBus/eventWorker.js';
  return { rel, source: fs.readFileSync(path.join(root, rel), 'utf8') };
}

export function loadWorkerSelectionContract(root = DEFAULT_ROOT) {
  const { rel, source } = workerSource(root);
  const attempts = /export\s+const\s+MAX_OUTBOX_ATTEMPTS\s*=\s*(\d+)\s*;/.exec(source);
  if (!attempts) throw new Error('MAX_OUTBOX_ATTEMPTS could not be derived from eventWorker.js');

  const selection = /SELECT\s+\*\s+FROM\s+domain_events([\s\S]*?)FOR\s+UPDATE\s+SKIP\s+LOCKED\s*;/i.exec(source);
  if (!selection) throw new Error('eventWorker domain_events selection query could not be derived');

  const sql = selection[0];
  const limit = /LIMIT\s+(\d+)/i.exec(sql);
  if (!limit) throw new Error('eventWorker batch LIMIT could not be derived');

  const contract = {
    source_file: rel,
    max_outbox_attempts: Number(attempts[1]),
    batch_limit: Number(limit[1]),
    status: 'pending',
    order_by: 'created_at ASC',
  };
  assertWorkerSelectionQueryContract(sql, contract, { workerQuery: true });
  return contract;
}

export function nextWorkerBatchSql(contract = loadWorkerSelectionContract()) {
  const sql = `
    SELECT id, event_type, status, attempts, tenant_id, created_at, payload
    FROM public.domain_events
    WHERE status = 'pending' AND attempts < $1
    ORDER BY created_at ASC
    LIMIT ${contract.batch_limit}
  `;
  assertWorkerSelectionQueryContract(sql, contract);
  return sql;
}

export function assertWorkerSelectionQueryContract(sql, contract, options = {}) {
  const source = String(sql || '');
  if (!/status\s*=\s*['"]pending['"]/i.test(source)) {
    throw new Error('Worker selection drift: status=pending predicate missing');
  }
  if (!/attempts\s*<\s*\$1/i.test(source)) {
    throw new Error('Worker selection drift: attempts<$1 predicate missing');
  }
  if (!/ORDER\s+BY\s+created_at\s+ASC/i.test(source)) {
    throw new Error('Worker selection drift: created_at ASC ordering missing');
  }
  const limit = /LIMIT\s+(\d+)/i.exec(source);
  if (!limit || Number(limit[1]) !== Number(contract.batch_limit)) {
    throw new Error(`Worker selection drift: LIMIT must equal ${contract.batch_limit}`);
  }
  if (Number(contract.max_outbox_attempts) !== 5) {
    throw new Error(`Worker selection drift: expected authoritative MAX_OUTBOX_ATTEMPTS=5, got ${contract.max_outbox_attempts}`);
  }
  if (options.workerQuery === true && !/FOR\s+UPDATE\s+SKIP\s+LOCKED/i.test(source)) {
    throw new Error('Worker selection drift: worker lock semantics missing');
  }
  return true;
}

export function assertObservedNextWorkerBatch(rows, contract = loadWorkerSelectionContract()) {
  if (!Array.isArray(rows)) throw new Error('next worker batch must be an array');
  if (rows.length > contract.batch_limit) {
    throw new Error(`next worker batch exceeds authoritative LIMIT ${contract.batch_limit}`);
  }
  let previous = null;
  for (const row of rows) {
    if (row?.status !== 'pending') throw new Error(`next worker batch contains non-pending event ${row?.id || '<unknown>'}`);
    if (!Number.isFinite(Number(row?.attempts)) || Number(row.attempts) >= contract.max_outbox_attempts) {
      throw new Error(`next worker batch contains exhausted event ${row?.id || '<unknown>'}`);
    }
    const created = Date.parse(String(row?.created_at || ''));
    if (!Number.isFinite(created)) throw new Error(`next worker batch contains invalid created_at for ${row?.id || '<unknown>'}`);
    if (previous !== null && created < previous) throw new Error('next worker batch is not ordered by created_at ASC');
    previous = created;
  }
  return true;
}

export function reviewNextWorkerBatch(rows) {
  const counts = Object.fromEntries([
    ...DEFAULT_ALLOWED_WORKER_EFFECTS,
    ...DEFAULT_STOP_WORKER_EFFECTS,
  ].map((effect) => [effect, 0]));
  const classificationStopReasons = [];
  const renderStopReasons = [];

  for (const row of rows || []) {
    const effect = row?.classification?.effect_class || 'UNKNOWN_REQUIRES_REVIEW';
    if (!(effect in counts)) counts[effect] = 0;
    counts[effect] += 1;
    if (!DEFAULT_ALLOWED_WORKER_EFFECTS.includes(effect)) {
      classificationStopReasons.push({
        id: String(row?.id || ''),
        event_type: row?.event_type || null,
        effect_class: effect,
        reason: 'effect_class_not_authorized',
      });
    }
    if (row?.render_contract?.render_contract_ready !== true) {
      renderStopReasons.push({
        id: String(row?.id || ''),
        event_type: row?.event_type || null,
        effect_class: effect,
        template_key: row?.render_contract?.template_key || null,
        reason: row?.render_contract?.stop_reason || 'render_contract_not_evaluated',
        missing_required_variables: row?.render_contract?.missing_required_variables || [],
      });
    }
  }

  const hasRows = Array.isArray(rows) && rows.length > 0;
  const classificationPasses = hasRows && classificationStopReasons.length === 0;
  const renderPasses = hasRows && renderStopReasons.length === 0;
  const stopReasons = [...classificationStopReasons, ...renderStopReasons];

  return {
    batch_size: Array.isArray(rows) ? rows.length : 0,
    default_allowed_effect_classes: [...DEFAULT_ALLOWED_WORKER_EFFECTS],
    stop_effect_classes: [...DEFAULT_STOP_WORKER_EFFECTS],
    effect_counts: counts,
    stop_required: stopReasons.length > 0,
    default_classification_gate_passes: classificationPasses,
    render_contract_gate_passes: renderPasses,
    combined_batch_gate_passes: classificationPasses && renderPasses,
    stop_reasons: stopReasons,
    outbound_kill_switch_does_not_override_classification: true,
  };
}

export function extractTrackedEventIds(inventory) {
  const batch = inventory?.next_worker_batch;
  if (!Array.isArray(batch)) throw new Error('inventory.next_worker_batch is required for tracked-event custody');
  const ids = batch.map((row) => String(row?.id || '').trim());
  if (ids.some((id) => !id)) throw new Error('next_worker_batch contains an event without an id');
  if (new Set(ids).size !== ids.length) throw new Error('next_worker_batch contains duplicate event ids');
  return ids;
}

export function trackedDomainEventsSql() {
  const sql = `
    SELECT id, event_type, status, attempts, tenant_id, created_at, updated_at, error_log, dead_lettered_at
    FROM public.domain_events
    WHERE id::text = ANY($1::text[])
    ORDER BY array_position($1::text[], id::text)
  `;
  assertTrackedEventQueryContract(sql);
  return sql;
}

export function assertTrackedEventQueryContract(sql) {
  const source = String(sql || '');
  if (!/id::text\s*=\s*ANY\(\$1::text\[\]\)/i.test(source)) {
    throw new Error('Tracked-event query must select exact event IDs');
  }
  if (/created_at\s*(?:>=|>|BETWEEN)/i.test(source)) {
    throw new Error('Tracked-event query must not depend on created_at');
  }
  if (/status\s*=\s*['"]pending['"]/i.test(source)) {
    throw new Error('Tracked-event query must observe the same IDs after status transition');
  }
  return true;
}

function mapRows(rows = []) {
  return new Map(rows.map((row) => [String(row.id), row]));
}

export function reconcileTrackedWorkerBatch(beforeTracked, afterTracked) {
  const beforeIds = (beforeTracked?.expected_ids || []).map(String);
  const afterIds = (afterTracked?.expected_ids || []).map(String);
  if (JSON.stringify(beforeIds) !== JSON.stringify(afterIds)) {
    throw new Error('Tracked worker batch ID set changed between before and after snapshots');
  }

  const before = mapRows(beforeTracked?.rows || []);
  const after = mapRows(afterTracked?.rows || []);
  const missingBefore = beforeIds.filter((id) => !before.has(id));
  const missingAfter = beforeIds.filter((id) => !after.has(id));
  const statusTransitions = [];
  const attemptTransitions = [];
  const errorTransitions = [];

  for (const id of beforeIds) {
    if (!before.has(id) || !after.has(id)) continue;
    const a = before.get(id);
    const b = after.get(id);
    if (a.status !== b.status) statusTransitions.push({ id, before: a.status ?? null, after: b.status ?? null });
    if (Number(a.attempts) !== Number(b.attempts)) attemptTransitions.push({ id, before: Number(a.attempts), after: Number(b.attempts) });
    if ((a.error_log ?? null) !== (b.error_log ?? null)) {
      errorTransitions.push({ id, before_present: Boolean(a.error_log), after_present: Boolean(b.error_log) });
    }
  }

  const missingIds = [...new Set([...missingBefore, ...missingAfter])];
  return {
    expected_ids: beforeIds,
    observed_before: beforeIds.filter((id) => before.has(id)),
    observed_after: beforeIds.filter((id) => after.has(id)),
    status_transitions: statusTransitions,
    attempt_transitions: attemptTransitions,
    error_transitions: errorTransitions,
    missing_before: missingBefore,
    missing_after: missingAfter,
    missing_ids: missingIds,
    complete: missingIds.length === 0,
    stop_required: missingIds.length > 0,
  };
}

export function assertTrackedReconciliationComplete(tracked) {
  if (!tracked?.complete || (tracked?.missing_ids || []).length) {
    throw new Error(`TRACKED WORKER BATCH RECONCILIATION INCOMPLETE: missing ids ${(tracked?.missing_ids || []).join(', ') || '<unknown>'}`);
  }
  return true;
}
