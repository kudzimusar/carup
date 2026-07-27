/**
 * Diaspora GTM — what the scheduler actually runs (Issue #127, Phase 2E).
 *
 * Kept apart from `diasporaSchedulerService.js` on purpose. The service owns claiming, leasing,
 * backoff and the terminus, and none of that should have to know what billing reconciliation is. This
 * file is the only place where the two vocabularies meet, and every entry is a thin adapter:
 * translate the scheduler's context into the domain call, translate the domain result into three
 * numbers and a sanitized detail blob.
 *
 * FIVE JOBS, EACH ALREADY IMPLEMENTED AND PREVIOUSLY UNREACHABLE WITHOUT A HUMAN:
 *
 *   billing_reconciliation      ADR-001 §7 — "not optional" on a rail whose own provider documents its
 *                               callback as a hint. Detection only; `repair` stays false, because
 *                               auto-healing destroys the evidence of the bug that caused the drift
 *                               and one bad provider read could revoke a paying tenant's access.
 *   billing_checkout_sweep      `abandoned` is DERIVED. A session nobody sweeps stays `open` forever
 *                               and the abandonment rate is silently, permanently wrong.
 *   billing_event_retry         Ledger #24 gave events `attempts`/`dead_lettered` and nothing came
 *                               back for the ones that were claimed but never applied.
 *   drive_sync_retry            Ledger #21 wrote `next_attempt_at` on every failure and nothing ever
 *                               read it, so "queued for retry" was a promise with no mechanism.
 *   subscription_renewal_sweep  ADR-001 §8. Detection only — it contacts no provider and moves no
 *                               money; collection stays gated behind ADR-001 §9.
 *
 * Every handler is BOUNDED (`limit` comes from the scheduler) and returns counts rather than rows: the
 * run row is an operator artefact, not a data export, and stuffing findings into it would put tenant
 * detail somewhere with a different retention story.
 */
import { SCHEDULER_JOB_KEYS } from '../../../constants/diaspora/diasporaSchedulerConstants.js';
import { BILLING_RECONCILIATION_TRIGGERS } from '../../../constants/diaspora/diasporaBillingConstants.js';
import { runBillingReconciliation } from '../billing/diasporaBillingReconciliationService.js';
import { sweepAbandonedCheckouts } from '../billing/diasporaBillingCheckoutSessionService.js';
import { retryUnappliedBillingEvents } from '../billing/diasporaBillingEventRetryService.js';
import { sweepDueRenewals } from '../billing/diasporaSubscriptionRenewalService.js';
import { sweepDriveSyncAttempts } from '../drive/driveSyncSweeper.js';

/**
 * @typedef {object} SchedulerJobContext
 * @property {object} supabase
 * @property {string|null} tenantId
 * @property {string|null} runId
 * @property {string|null} correlationId
 * @property {Date} now
 * @property {number} limit
 */

export const SCHEDULER_JOB_DEFINITIONS = Object.freeze({
  [SCHEDULER_JOB_KEYS.BILLING_RECONCILIATION]: {
    description: 'Compare provider subscription state against the CarUp ledger (ADR-001 §7).',
    async handler({ supabase, tenantId, correlationId, limit, billingProvider = null }) {
      const result = await runBillingReconciliation({
        trigger: BILLING_RECONCILIATION_TRIGGERS.SCHEDULED,
        tenantId: tenantId || null,
        limit,
        // NEVER repair from a scheduled run. The repair path exists and is bounded to the safe
        // direction, but applying it unattended means a transient bad provider read can revoke access
        // with nobody watching. An operator run can still ask for it explicitly.
        repair: false,
        correlationId,
        billingProvider,
        supabaseClient: supabase,
      });
      return {
        processed: result.checked,
        failed: result.mismatches,
        detail: {
          reconciliationRunId: result.runId,
          provider: result.provider,
          mismatches: result.mismatches,
          repaired: result.repaired,
        },
      };
    },
  },

  [SCHEDULER_JOB_KEYS.BILLING_CHECKOUT_SWEEP]: {
    description: 'Mark checkout sessions abandoned once they pass the abandonment window.',
    async handler({ supabase, correlationId, limit, now }) {
      const result = await sweepAbandonedCheckouts({
        now, limit, correlationId, supabaseClient: supabase,
      });
      return {
        processed: result.swept,
        detail: { cutoff: result.cutoff, swept: result.swept },
      };
    },
  },

  [SCHEDULER_JOB_KEYS.BILLING_EVENT_RETRY]: {
    description: 'Re-apply provider events that were claimed but never applied; dead-letter at the ceiling.',
    async handler({ supabase, correlationId, limit, now, billingProvider = null }) {
      const result = await retryUnappliedBillingEvents({
        limit, now, correlationId, billingProvider, supabaseClient: supabase,
      });
      return {
        processed: result.applied,
        failed: result.failed,
        deadLettered: result.deadLettered,
        detail: {
          scanned: result.scanned,
          applied: result.applied,
          failed: result.failed,
          deadLettered: result.deadLettered,
          skipped: result.skipped,
        },
      };
    },
  },

  [SCHEDULER_JOB_KEYS.DRIVE_SYNC_RETRY]: {
    description: 'Reclaim abandoned Drive sync claims and dead-letter attempts past the retry ceiling.',
    async handler({ supabase, tenantId, correlationId, limit, now, driveReplayers = {} }) {
      const result = await sweepDriveSyncAttempts({
        limit, now, tenantId: tenantId || null, correlationId,
        replayers: driveReplayers,
        supabaseClient: supabase,
      });
      return {
        processed: result.reclaimed + result.replayed,
        failed: result.replayFailed,
        deadLettered: result.deadLettered,
        detail: {
          scanned: result.scanned,
          reclaimed: result.reclaimed,
          replayed: result.replayed,
          replayFailed: result.replayFailed,
          deadLettered: result.deadLettered,
          // Surfaced rather than hidden: uploads cannot be replayed by a sweeper because the table
          // stores a checksum, not content. An operator seeing a rising number here is seeing a real
          // fact about the system, not a bug in the sweep.
          unreplayable: result.unreplayable,
        },
      };
    },
  },

  [SCHEDULER_JOB_KEYS.SUBSCRIPTION_RENEWAL_SWEEP]: {
    description: 'Detect renewals due on locally-driven rails and record them for an operator (ADR-001 §8).',
    async handler({ supabase, tenantId, correlationId, limit, now, runId }) {
      const result = await sweepDueRenewals({
        limit, now, tenantId: tenantId || null, correlationId, runId, supabaseClient: supabase,
      });
      return {
        processed: result.recorded,
        detail: {
          scanned: result.scanned,
          recorded: result.recorded,
          alreadyRecorded: result.alreadyRecorded,
          needsOperator: result.needsOperator,
          cancelling: result.cancelling,
          // Always false today, and recorded in every run so the gate is visible in the history
          // rather than being something a reader has to take on trust.
          collectionAttempted: result.collectionAttempted,
        },
      };
    },
  },
});

export default SCHEDULER_JOB_DEFINITIONS;
