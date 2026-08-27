import { emitDomainEvent } from '../eventBus/eventBusService.js';
import { EMAIL_VERIFIED_EVENT } from './producers/leadershipWelcomeProducer.js';
import { reconcileTrustPresentation } from '../trustDecision/trustPresentationChangeProducer.js';

/**
 * The durability reconciliation controller — reading a PRIVATE work queue.
 *
 * THE DEFECT CLASS this closes: recovery existed, and nothing scheduled it. Two designs preceded
 * this one. The first INFERRED outstanding work from timestamps, which made a routine Trust
 * recompute look like news and let a settled prefix starve the batch. The second stored explicit
 * boolean flags ON THE PUBLIC TABLES, which failed on privilege reality — PostgreSQL privileges are
 * additive, and live staging grants anon/authenticated table-level UPDATE on public.users, so a
 * column-level revoke on a users flag was inert and a client could manufacture or suppress a
 * Welcome. Its final clear was also unconditional, so a material change landing mid-reconciliation
 * had its freshly-declared work silently wiped.
 *
 * Work therefore lives in `communication_reconciliation_work`: a service-only table (RLS on, every
 * client privilege revoked) whose rows are created by DATABASE TRIGGERS in the same transaction as
 * the state change that created the work. Historical state creates no rows — the triggers fire only
 * on post-migration transitions and the migration performs no backfill — so baseline is a property
 * of construction. The scans here select pending work directly and apply the LIMIT to it; there is
 * no public-table prefix scan and no JavaScript post-filter for a settled row to starve.
 *
 * RETIREMENT IS CONDITIONAL, and that condition is the fix for the lost-update race. A worker reads
 * a row at generation G with fingerprint F and reconciles exactly that state. If a newer material
 * change commits mid-flight, the trigger has already moved the row to G+1/F2, and the worker's
 * compare-and-delete on (id, G, F) affects zero rows — the new work survives for the next pass.
 *
 * CONCURRENCY. Overlapping workers can read the same row; the deterministic domain-event and
 * notification dedupe keys remain the final authority, so overlap is wasteful, never duplicative.
 * The work row is an eligibility record, not the dedupe mechanism.
 */

export const RECONCILIATION_WORK_TABLE = 'communication_reconciliation_work';
export const WORK_TYPES = Object.freeze({
  WELCOME: 'user_email_verified',
  TRUST: 'vehicle_trust_presentation',
});

/** Batch ceilings. Bounded so the once-a-minute worker can never become a table sweeper. */
export const DEFAULT_TRUST_BATCH_LIMIT = Math.max(1, Math.min(Number(process.env.COMMUNICATION_TRUST_RECONCILE_LIMIT || 25), 200));
export const DEFAULT_WELCOME_BATCH_LIMIT = Math.max(1, Math.min(Number(process.env.COMMUNICATION_WELCOME_RECONCILE_LIMIT || 25), 200));

/**
 * Pending work of one type. `WHERE work_type = $1 ORDER BY subject_id LIMIT n` — the LIMIT applies
 * to rows that are already genuinely pending, which is the entire fix for prefix starvation.
 * The work_type filter is in the QUERY, not applied afterwards: filtering a mixed page in
 * JavaScript would reintroduce the same starvation one level down.
 */
async function pendingWork(repository, workType, limit) {
  const rows = await repository.list(RECONCILIATION_WORK_TABLE, { work_type: workType }, {
    select: 'id, work_type, subject_id, generation, work_fingerprint',
    order: { column: 'subject_id', ascending: true },
    limit,
  });
  return (rows || []).filter((row) => row?.subject_id);
}

/**
 * Retire one work row — atomically, and only the exact generation the worker actually reconciled.
 *
 * Returns the affected row count. Zero means a newer generation arrived mid-flight; the caller
 * must treat the work as still pending and NOT count it settled. An unconditional delete here is
 * precisely the lost-update defect this design exists to close.
 */
async function retireWork(repository, work) {
  return repository.deleteWhere(RECONCILIATION_WORK_TABLE, {
    id: work.id,
    generation: work.generation,
    work_fingerprint: work.work_fingerprint ?? null,
  });
}

/**
 * Does this account already have the durable work item, or the welcome itself?
 *
 * Returns true | false | 'unknown'. A lookup fault is NOT "accounted for" — retiring work over a
 * database blip would lose the welcome permanently. It is its own answer, and the caller leaves the
 * row pending.
 */
async function welcomeAlreadyAccountedFor(repository, userId) {
  const existingEvent = await repository.findOne('domain_events', {
    dedupe_key: `${EMAIL_VERIFIED_EVENT}:${userId}`,
  }).catch(() => undefined);
  if (existingEvent === undefined) return 'unknown';
  if (existingEvent) return true;

  const existingWelcome = await repository.findOne('notification_queue', {
    dedupe_key: `leadership_welcome:${userId}`,
  }).catch(() => undefined);
  if (existingWelcome === undefined) return 'unknown';
  return Boolean(existingWelcome);
}

/**
 * Reconcile one welcome work item.
 *
 * The scanner NEVER sends the Email and never calls the producer. It recreates the same canonical
 * `user.email.verified` event with the same deterministic identity, and the existing R1 producer
 * remains the only thing that queues a welcome. If the event (or the welcome) already exists the
 * work is settled; if the emit fails the work stays pending.
 */
export async function reconcileVerifiedWelcome(userId, { repository, emit = emitDomainEvent } = {}) {
  if (!userId || !repository) return { reconstructed: false, settled: false, reason: 'not_reconcilable' };

  const accounted = await welcomeAlreadyAccountedFor(repository, userId);
  if (accounted === 'unknown') {
    return { reconstructed: false, settled: false, reason: 'lookup_unavailable' };
  }
  if (accounted) {
    return { reconstructed: false, settled: true, reason: 'already_accounted_for' };
  }

  await emit(null, EMAIL_VERIFIED_EVENT, { recipientUserId: userId }, null);
  return { reconstructed: true, settled: true };
}

/**
 * One bounded reconciliation pass. Called by the scheduled Communications worker.
 *
 * Never throws: a reconciliation failure must not fail the worker request that also delivers the
 * queue. Each item is isolated, so one bad row cannot abort the rest of the batch, and anything
 * that fails simply stays pending for a later pass.
 *
 * The returned counts are deliberately non-identifying — no addresses, no tokens, no VINs, no
 * evidence, no secrets. They are operational telemetry, not a customer record.
 */
export async function reconcileCommunicationDurability({
  repository,
  trustBatchLimit = DEFAULT_TRUST_BATCH_LIMIT,
  verifiedUserBatchLimit = DEFAULT_WELCOME_BATCH_LIMIT,
  getTrustRecord = null,
  emit = emitDomainEvent,
  pgClient = null,
} = {}) {
  const counts = {
    trust_scanned: 0, trust_reconciled: 0, trust_settled_no_recipient: 0, trust_superseded: 0, trust_failed: 0,
    welcome_scanned: 0, welcome_reconstructed: 0, welcome_settled: 0, welcome_failed: 0,
    skipped: null,
  };
  if (!repository) return { ...counts, skipped: 'no_repository' };

  // ---- R5 -------------------------------------------------------------------------------------
  if (trustBatchLimit > 0 && typeof getTrustRecord === 'function') {
    let work = [];
    try {
      work = await pendingWork(repository, WORK_TYPES.TRUST, trustBatchLimit);
    } catch {
      work = [];
      counts.trust_failed += 1;
    }
    counts.trust_scanned = work.length;
    for (const item of work) {
      try {
        const result = await reconcileTrustPresentation(item.subject_id, {
          client: repository.client || null,
          pgClient,
          getRecord: getTrustRecord,
        });
        const settled = Boolean(result?.emitted)
          || Boolean(result?.terminal)
          || result?.reason === 'already_announced'
          || result?.reason === 'no_material_change';
        if (!settled) continue; // transient — the row stays pending for a later pass

        // Retire EXACTLY the generation this pass reconciled. Zero affected rows means a newer
        // material change arrived mid-flight; its work survives and is deliberately not counted
        // as settled — the next pass reconciles the newer presentation.
        const removed = await retireWork(repository, item);
        if (removed === 0) {
          counts.trust_superseded += 1;
          continue;
        }
        if (result?.emitted) counts.trust_reconciled += 1;
        else if (result?.terminal) {
          // No resolvable owner is terminal for THIS generation: nobody to tell, guessing
          // forbidden. The announced-fingerprint is deliberately NOT written — nothing was sent —
          // and a future material change enqueues a new generation through the trigger.
          counts.trust_settled_no_recipient += 1;
        }
      } catch {
        counts.trust_failed += 1;
      }
    }
  }

  // ---- R1 -------------------------------------------------------------------------------------
  if (verifiedUserBatchLimit > 0) {
    let work = [];
    try {
      work = await pendingWork(repository, WORK_TYPES.WELCOME, verifiedUserBatchLimit);
    } catch {
      work = [];
      counts.welcome_failed += 1;
    }
    counts.welcome_scanned = work.length;
    for (const item of work) {
      try {
        const result = await reconcileVerifiedWelcome(item.subject_id, { repository, emit });
        if (!result?.settled) continue; // lookup fault or emit failure — stays pending
        const removed = await retireWork(repository, item);
        if (removed === 0) continue; // re-enqueued mid-flight; next pass re-examines
        if (result.reconstructed) counts.welcome_reconstructed += 1;
        else counts.welcome_settled += 1;
      } catch {
        counts.welcome_failed += 1;
      }
    }
  }

  return counts;
}

export default reconcileCommunicationDurability;
