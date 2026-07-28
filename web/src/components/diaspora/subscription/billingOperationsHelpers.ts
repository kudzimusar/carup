import type { BillingHealth, BillingReconciliationRun } from '@/types'

export type HealthTone = 'ok' | 'pending' | 'failed'

export interface HealthSignal {
  label: string
  tone: HealthTone
  detail: string
}

export interface BillingHealthSummary {
  reconciliation: HealthSignal
  failedWebhooks: HealthSignal
  /** True when something will not resolve on its own and an operator must act. */
  needsOperator: boolean
  needsOperatorReason: string
}

/**
 * Turn the four raw health signals into operator-readable state.
 *
 * The rule this encodes: **a responding route is not a healthy system.** Reconciliation freshness is
 * evaluated independently of mismatch counts, because a scheduler that quietly stopped produces
 * exactly the same "0 mismatches" as a healthy one — and that is the more dangerous failure, since
 * nothing else in the system will notice provider drift.
 *
 * Dead-lettered provider events are likewise terminal: they exhausted their retries, so they will
 * never apply on their own no matter how long an operator waits.
 */
export function describeBillingHealth(health: BillingHealth): BillingHealthSummary {
  const recon = health.reconciliation || { lastCompletedAt: null, ageMinutes: null, stale: true, reason: 'NEVER_COMPLETED' }
  const failedCount = health.failedWebhooks?.count ?? 0

  const reconciliation: HealthSignal = recon.reason === 'NEVER_COMPLETED'
    ? {
      label: 'Never run',
      tone: 'failed',
      detail: 'Reconciliation has never completed, so provider drift would not be detected. This is not the same as "no problems found".',
    }
    : recon.stale
      ? {
        label: 'Stale',
        tone: 'failed',
        detail: `Last completed ${recon.ageMinutes ?? '?'} minutes ago, beyond the freshness threshold. A stopped scheduler looks identical to a clean result.`,
      }
      : {
        label: 'Fresh',
        tone: 'ok',
        detail: `Last completed ${recon.ageMinutes ?? 0} minutes ago.`,
      }

  const failedWebhooks: HealthSignal = failedCount > 0
    ? {
      label: `${failedCount} dead-lettered`,
      tone: 'failed',
      detail: `${failedCount} provider event${failedCount === 1 ? '' : 's'} exhausted their retries and will not apply automatically.`,
    }
    : {
      label: 'All applied',
      tone: 'ok',
      detail: 'No provider event has been dead-lettered.',
    }

  const reasons: string[] = []
  if (failedCount > 0) reasons.push(`${failedCount} provider event${failedCount === 1 ? '' : 's'} could not be applied`)
  if (reconciliation.tone === 'failed') reasons.push(recon.reason === 'NEVER_COMPLETED' ? 'reconciliation has never completed' : 'reconciliation is stale')

  return {
    reconciliation,
    failedWebhooks,
    needsOperator: reasons.length > 0,
    needsOperatorReason: reasons.length > 0
      ? `${reasons.join('; ')}. These will not resolve on their own.`
      : '',
  }
}

/** One reconciliation run, described without leaking finding internals. */
export function describeReconciliationRun(run: BillingReconciliationRun): HealthSignal {
  const checked = run.checked_count ?? 0
  const mismatches = run.mismatch_count ?? 0

  if (run.state === 'running') {
    return { label: 'Running', tone: 'pending', detail: 'This run has not finished yet.' }
  }
  if (run.state === 'failed') {
    return { label: 'Failed', tone: 'failed', detail: 'This run did not complete, so its result cannot be treated as a clean check.' }
  }
  return mismatches > 0
    ? {
      label: `${mismatches} mismatch${mismatches === 1 ? '' : 'es'}`,
      tone: 'failed',
      detail: `${checked} subscription${checked === 1 ? '' : 's'} checked; ${mismatches} did not match the provider.`,
    }
    : {
      label: 'Clean',
      tone: 'ok',
      detail: `${checked} subscription${checked === 1 ? '' : 's'} checked, all matching.`,
    }
}
