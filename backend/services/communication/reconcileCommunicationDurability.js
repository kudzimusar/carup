import { emitDomainEvent } from '../eventBus/eventBusService.js';
import { EMAIL_VERIFIED_EVENT } from './producers/leadershipWelcomeProducer.js';
import {
  ANNOUNCED_FINGERPRINT_COLUMN,
  reconcileTrustPresentation,
} from '../trustDecision/trustPresentationChangeProducer.js';

/**
 * The durability reconciliation controller.
 *
 * THE DEFECT CLASS this closes: recovery existed, and nothing scheduled it.
 *
 *   - `reconcileTrustPresentation()` was written for R5-D1, hardened again in C3, fully tested — and
 *     called only from test files. Zero production callers. `idx_vehicles_trust_unannounced` was
 *     added to the migration specifically to make its scan cheap, so the index existed for a scanner
 *     that did not.
 *   - R1's durable `user.email.verified` event closes every failure after the outbox insert, but if
 *     the insert ITSELF fails the welcome is still lost, because nothing reconstructs it.
 *
 * A recovery mechanism that nothing invokes is not a recovery mechanism. This controller is that
 * invocation, driven by the Communications worker that pg_cron already calls every minute. It adds
 * no scheduler, no timer, and no second worker.
 *
 * HISTORY IS BASELINE BY CONSTRUCTION. The scans read EXPLICIT durable work markers set by database
 * trigger in the same transaction as the change that made the work exist. Nothing is inferred from a
 * timestamp comparison, so a routine Trust recompute cannot make a historical vehicle eligible, and
 * an account verified before this shipped simply has a FALSE flag. The earlier design inferred
 * eligibility after the fact and produced four separate defects from that single choice — including a
 * client-writable watermark table, which has been deleted rather than defended.
 *
 * THE LIMIT IS APPLIED TO ALREADY-PENDING ROWS. Previously it bounded inferred candidates and the
 * "already handled" test ran afterwards in JavaScript, so a settled prefix re-occupied the batch every
 * minute and genuinely lost work behind it was never reached. Settled work now has its flag retired
 * and is not selected at all.
 *
 * CONCURRENCY. These scans read through PostgREST, which offers no `FOR UPDATE SKIP LOCKED`, so two
 * overlapping workers CAN select the same row. Safety therefore comes from idempotency rather than
 * from locking, and it is enforced in the database, not here: R5 events dedupe on
 * `vehicle.trust.presentation_changed:<presentation_fingerprint>` and R1 on
 * `user.email.verified:<userId>`, both against the partial unique index on `domain_events`. A second
 * worker's insert collides and recovers the first worker's row. Overlap is wasteful, never
 * duplicative — and that is proven by test, not asserted here.
 */

/** The explicit durable work markers. Set by database trigger, cleared only when work settles. */
export const WELCOME_WORK_COLUMN = 'email_welcome_reconcile_required';
export const TRUST_WORK_COLUMN = 'trust_presentation_reconcile_required';

/** Batch ceilings. Bounded so the once-a-minute worker can never become a table sweeper. */
export const DEFAULT_TRUST_BATCH_LIMIT = Math.max(1, Math.min(Number(process.env.COMMUNICATION_TRUST_RECONCILE_LIMIT || 25), 200));
export const DEFAULT_WELCOME_BATCH_LIMIT = Math.max(1, Math.min(Number(process.env.COMMUNICATION_WELCOME_RECONCILE_LIMIT || 25), 200));

/**
 * R5 candidates: vehicles that DECLARED a material Trust change needing reconciliation.
 *
 * The LIMIT is applied to rows that are already genuinely pending, so a settled row can never
 * occupy the batch. Nothing is filtered in JavaScript afterwards, and there is no timestamp
 * comparison: a historical vehicle is excluded because its flag is FALSE, not because a clock says
 * so — which is why a routine recompute can no longer make it eligible.
 */
async function pendingTrustVehicles(repository, limit) {
  const rows = await repository.list('vehicles', { [TRUST_WORK_COLUMN]: true }, {
    select: `vin, ${TRUST_WORK_COLUMN}`,
    order: { column: 'vin', ascending: true },
    limit,
  });
  return (rows || []).filter((row) => row?.vin);
}

/** R1 candidates: accounts that DECLARED a verification needing a welcome work item. */
async function pendingVerifiedAccounts(repository, limit) {
  const rows = await repository.list('users', { [WELCOME_WORK_COLUMN]: true }, {
    select: `id, ${WELCOME_WORK_COLUMN}`,
    order: { column: 'id', ascending: true },
    limit,
  });
  return (rows || []).filter((row) => row?.id);
}

/**
 * Retire a settled work flag.
 *
 * Best effort on purpose: failing to clear it costs one wasted re-examination next minute, which is
 * strictly better than any scheme that could clear it while the work is still outstanding.
 */
async function clearWorkFlag(repository, table, id, column) {
  const key = table === 'vehicles' ? 'vin' : 'id';
  try {
    if (typeof repository.updateWhere === 'function') {
      await repository.updateWhere(table, { [key]: id }, { [column]: false });
      return true;
    }
    await repository.updateById(table, id, { [column]: false });
    return true;
  } catch {
    return false;
  }
}

/** Does this account already have the durable work item, or the welcome itself? */
async function welcomeAlreadyAccountedFor(repository, userId) {
  // Returns true | false | 'unknown'. A lookup fault is NOT "accounted for" — reporting it as such
  // would retire the work flag over a database blip and lose the welcome permanently. It is its own
  // answer, and the caller leaves the flag pending.
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
 * Reconstruct the durable welcome work item for one verified account.
 *
 * The scanner NEVER sends the Email and never calls the producer. It recreates the same canonical
 * event with the same deterministic identity, and the existing R1 producer remains the only thing
 * that queues a welcome. One producer, one path, one place for the payload to be decided.
 */
export async function reconcileVerifiedWelcome(userId, { repository, emit = emitDomainEvent } = {}) {
  if (!userId || !repository) return { reconstructed: false, reason: 'not_reconcilable' };

  const accounted = await welcomeAlreadyAccountedFor(repository, userId);
  if (accounted === 'unknown') {
    // A lookup fault. Leave the flag TRUE and try again — never emit on an unreadable answer.
    return { reconstructed: false, reason: 'lookup_unavailable', settled: false };
  }
  if (accounted) {
    // The durable event or the welcome itself already exists. The work is done; retire the flag so
    // it cannot re-occupy a future batch.
    await clearWorkFlag(repository, 'users', userId, WELCOME_WORK_COLUMN);
    return { reconstructed: false, reason: 'already_accounted_for', settled: true };
  }

  await emit(null, EMAIL_VERIFIED_EVENT, { recipientUserId: userId }, null);
  // Only after the durable event exists. If the emit threw we never get here and the flag stays TRUE.
  await clearWorkFlag(repository, 'users', userId, WELCOME_WORK_COLUMN);
  return { reconstructed: true, settled: true };
}

/**
 * One bounded reconciliation pass. Called by the scheduled Communications worker.
 *
 * Never throws: a reconciliation failure must not fail the worker request that also delivers the
 * queue. Each item is isolated, so one bad vehicle or account cannot abort the rest of the batch,
 * and anything that fails simply remains eligible for a later pass.
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
    trust_scanned: 0, trust_reconciled: 0, trust_settled_no_recipient: 0, trust_failed: 0,
    welcome_scanned: 0, welcome_reconstructed: 0, welcome_settled: 0, welcome_failed: 0,
    skipped: null,
  };
  if (!repository) return { ...counts, skipped: 'no_repository' };

  // ---- R5 -------------------------------------------------------------------------------------
  if (trustBatchLimit > 0 && typeof getTrustRecord === 'function') {
    let vehicles = [];
    try {
      vehicles = await pendingTrustVehicles(repository, trustBatchLimit);
    } catch {
      vehicles = [];
      counts.trust_failed += 1;
    }
    counts.trust_scanned = vehicles.length;
    for (const vehicle of vehicles) {
      try {
        const result = await reconcileTrustPresentation(vehicle.vin, {
          client: repository.client || null,
          pgClient,
          getRecord: getTrustRecord,
        });
        if (result?.emitted) {
          counts.trust_reconciled += 1;
          await clearWorkFlag(repository, 'vehicles', vehicle.vin, TRUST_WORK_COLUMN);
        } else if (result?.terminal || result?.reason === 'already_announced' || result?.reason === 'no_material_change') {
          // Settled, not pending. `no_resolvable_owner` is the case that used to starve the queue:
          // there is nobody to tell, guessing is forbidden, and retrying forever would block every
          // recoverable vehicle behind it. The announced-fingerprint is deliberately NOT written —
          // nothing was sent, and claiming otherwise would suppress a genuine future announcement.
          // A later material change sets the flag again through the trigger.
          counts.trust_settled_no_recipient += result?.terminal ? 1 : 0;
          await clearWorkFlag(repository, 'vehicles', vehicle.vin, TRUST_WORK_COLUMN);
        }
        // Anything else (transient owner/DB fault) leaves the flag TRUE for a later pass.
      } catch {
        counts.trust_failed += 1;
      }
    }
  }

  // ---- R1 -------------------------------------------------------------------------------------
  if (verifiedUserBatchLimit > 0) {
    let accounts = [];
    try {
      accounts = await pendingVerifiedAccounts(repository, verifiedUserBatchLimit);
    } catch {
      accounts = [];
      counts.welcome_failed += 1;
    }
    counts.welcome_scanned = accounts.length;
    for (const account of accounts) {
      try {
        const result = await reconcileVerifiedWelcome(account.id, { repository, emit });
        if (result?.reconstructed) counts.welcome_reconstructed += 1;
        else if (result?.settled) counts.welcome_settled += 1;
      } catch {
        counts.welcome_failed += 1;
      }
    }
  }

  return counts;
}

export default reconcileCommunicationDurability;
