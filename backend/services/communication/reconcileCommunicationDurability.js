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
 * THE ACTIVATION BOUNDARY IS THE MOST IMPORTANT THING HERE. On the first run, without it, both scans
 * would classify all of history as outstanding work and mail every existing customer. The boundary
 * is a committed row (`communication_activation_boundaries`), not a process-local timestamp: two
 * workers must agree, a restart must not move the line, and an auditor must be able to ask later
 * exactly what counted as historical. State current at or before it is BASELINE and is never
 * reconciled into a customer Email.
 *
 * CONCURRENCY. These scans read through PostgREST, which offers no `FOR UPDATE SKIP LOCKED`, so two
 * overlapping workers CAN select the same row. Safety therefore comes from idempotency rather than
 * from locking, and it is enforced in the database, not here: R5 events dedupe on
 * `vehicle.trust.presentation_changed:<presentation_fingerprint>` and R1 on
 * `user.email.verified:<userId>`, both against the partial unique index on `domain_events`. A second
 * worker's insert collides and recovers the first worker's row. Overlap is wasteful, never
 * duplicative — and that is proven by test, not asserted here.
 */

export const EMAIL_1_0_PROGRAM = 'email_1_0';
const ACTIVATION_TABLE = 'communication_activation_boundaries';

/** Batch ceilings. Bounded so the once-a-minute worker can never become a table sweeper. */
export const DEFAULT_TRUST_BATCH_LIMIT = Math.max(1, Math.min(Number(process.env.COMMUNICATION_TRUST_RECONCILE_LIMIT || 25), 200));
export const DEFAULT_WELCOME_BATCH_LIMIT = Math.max(1, Math.min(Number(process.env.COMMUNICATION_WELCOME_RECONCILE_LIMIT || 25), 200));

/**
 * Read the durable activation watermark.
 *
 * Returns null when it cannot be read. A null boundary DISABLES both scans: without a known line
 * between history and live work there is no safe way to tell an outstanding announcement from a
 * pre-existing one, and the failure mode of guessing is a mass send. Doing nothing is always
 * recoverable; mailing every historical customer is not.
 */
export async function readActivationBoundary(repository, program = EMAIL_1_0_PROGRAM) {
  if (!repository?.findOne) return null;
  try {
    const row = await repository.findOne(ACTIVATION_TABLE, { program });
    return row?.activated_at || null;
  } catch {
    return null;
  }
}

/**
 * R5 — vehicles whose Trust presentation became current AFTER activation and has never been
 * announced.
 *
 * `trust_presentation_announced_fingerprint IS NULL` is the never-announced predicate and matches
 * the partial index; `trust_evaluated_at > boundary` excludes every historical position. Ordered by
 * `trust_evaluated_at` then `vin` so the scan is stable and the oldest outstanding work drains
 * first, and hard-limited so a backlog is worked down over successive minutes rather than in one
 * unbounded sweep.
 */
async function outstandingTrustVehicles(repository, boundary, limit) {
  const rows = await repository.list('vehicles', {
    [ANNOUNCED_FINGERPRINT_COLUMN]: null,
  }, {
    select: `vin, ${ANNOUNCED_FINGERPRINT_COLUMN}, trust_evaluated_at`,
    gt: { column: 'trust_evaluated_at', value: boundary },
    order: { column: 'trust_evaluated_at', ascending: true },
    limit,
  });
  return (rows || []).filter((row) => row?.vin && row.trust_evaluated_at && new Date(row.trust_evaluated_at) > new Date(boundary));
}

/**
 * R1 — accounts verified AFTER activation that still have no durable welcome work and no welcome.
 *
 * Both negative checks matter and neither is redundant. Without the event check the scanner would
 * re-emit for every account whose event is merely still pending. Without the notification check it
 * would reconstruct work for accounts whose welcome was already queued by the ordinary path and
 * whose event row has since been pruned.
 */
async function outstandingVerifiedAccounts(repository, boundary, limit) {
  const rows = await repository.list('users', {}, {
    select: 'id, email_verified_at',
    gt: { column: 'email_verified_at', value: boundary },
    order: { column: 'email_verified_at', ascending: true },
    limit,
  });
  return (rows || []).filter((row) => row?.id && row.email_verified_at && new Date(row.email_verified_at) > new Date(boundary));
}

/** Does this account already have the durable work item, or the welcome itself? */
async function welcomeAlreadyAccountedFor(repository, userId) {
  const existingEvent = await repository.findOne('domain_events', {
    dedupe_key: `${EMAIL_VERIFIED_EVENT}:${userId}`,
  }).catch(() => undefined);
  // `undefined` means the lookup FAILED. Treat that as "accounted for" so a fault never causes a
  // duplicate emit — the next pass will look again.
  if (existingEvent === undefined) return true;
  if (existingEvent) return true;

  const existingWelcome = await repository.findOne('notification_queue', {
    dedupe_key: `leadership_welcome:${userId}`,
  }).catch(() => undefined);
  if (existingWelcome === undefined) return true;
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
  if (await welcomeAlreadyAccountedFor(repository, userId)) {
    return { reconstructed: false, reason: 'already_accounted_for' };
  }
  await emit(null, EMAIL_VERIFIED_EVENT, { recipientUserId: userId }, null);
  return { reconstructed: true };
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
  program = EMAIL_1_0_PROGRAM,
} = {}) {
  const counts = {
    trust_scanned: 0, trust_reconciled: 0, trust_failed: 0,
    welcome_scanned: 0, welcome_reconstructed: 0, welcome_failed: 0,
    skipped: null,
  };
  if (!repository) return { ...counts, skipped: 'no_repository' };

  const boundary = await readActivationBoundary(repository, program);
  // No boundary means no safe way to separate history from live work. Do nothing.
  if (!boundary) return { ...counts, skipped: 'no_activation_boundary' };

  // ---- R5 -------------------------------------------------------------------------------------
  if (trustBatchLimit > 0 && typeof getTrustRecord === 'function') {
    let vehicles = [];
    try {
      vehicles = await outstandingTrustVehicles(repository, boundary, trustBatchLimit);
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
        if (result?.emitted) counts.trust_reconciled += 1;
      } catch {
        // Isolated on purpose: this vehicle stays eligible and the rest of the batch continues.
        counts.trust_failed += 1;
      }
    }
  }

  // ---- R1 -------------------------------------------------------------------------------------
  if (verifiedUserBatchLimit > 0) {
    let accounts = [];
    try {
      accounts = await outstandingVerifiedAccounts(repository, boundary, verifiedUserBatchLimit);
    } catch {
      accounts = [];
      counts.welcome_failed += 1;
    }
    counts.welcome_scanned = accounts.length;
    for (const account of accounts) {
      try {
        const result = await reconcileVerifiedWelcome(account.id, { repository, emit });
        if (result?.reconstructed) counts.welcome_reconstructed += 1;
      } catch {
        counts.welcome_failed += 1;
      }
    }
  }

  return counts;
}

export default reconcileCommunicationDurability;
