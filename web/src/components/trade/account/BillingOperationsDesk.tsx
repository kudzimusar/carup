/**
 * RX-06 Account — billing operations for subscription managers (test mode), in the Trade desk style.
 *
 * The same three manager-gated reads and one action the shared BillingOperationsPanel uses
 * (billing-health, reconciliation-runs, reconcile), interpreted by the SAME helpers
 * (describeBillingHealth / describeReconciliationRun): reconciliation freshness is reported apart from
 * mismatch counts, because a stopped scheduler looks exactly like "no problems found". Everything here
 * is test mode and says so. A 403 removes the panel rather than showing a misleading empty state.
 */
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { WS_SECONDARY } from '@/components/dealer/workspace/workspaceStyles'
import { describeBillingHealth, describeReconciliationRun, type HealthTone } from '@/components/diaspora/subscription/billingOperationsHelpers'
import type { BillingHealth, BillingReconciliationRun } from '@/types'
import { DeskPanel, DeskState } from '@/components/trade/sourcing/TradeDesk'
import { READ_IDLE, READ_LOADING, READ_READY, errorStatus, failedRead, failureKind, formatDateTime, type ReadState } from '@/components/trade/sourcing/deskKit'

const TONE: Record<HealthTone, 'success' | 'warning' | 'danger'> = { ok: 'success', pending: 'warning', failed: 'danger' }

export function BillingOperationsDesk() {
  const { fetchDiasporaBillingHealth, fetchDiasporaReconciliationRuns, runDiasporaBillingReconciliation } = useCarUpApi()
  const [health, setHealth] = useState<BillingHealth | null>(null)
  const [runs, setRuns] = useState<BillingReconciliationRun[]>([])
  const [read, setRead] = useState<ReadState>(READ_IDLE)
  const [forbidden, setForbidden] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [outcome, setOutcome] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)
  const [tick, setTick] = useState(0)
  const reconcilingRef = useRef(false)

  // One read per mount / explicit reload (tick). State is set only in the promise callbacks, and an
  // answer that arrives after unmount or after a newer reload is ignored.
  useEffect(() => {
    let active = true
    Promise.all([fetchDiasporaBillingHealth(), fetchDiasporaReconciliationRuns()])
      .then(([h, r]) => {
        if (!active) return
        setHealth(h)
        setRuns(r || [])
        setForbidden(false)
        setRead(READ_READY)
      })
      .catch((err: unknown) => {
        if (!active) return
        // 403 is the expected answer for a non-manager: the panel removes itself.
        if (errorStatus(err) === 403) setForbidden(true)
        else setRead(failedRead(err))
      })
    return () => { active = false }
  }, [fetchDiasporaBillingHealth, fetchDiasporaReconciliationRuns, tick])

  function reload() {
    setRead(READ_LOADING)
    setTick((t) => t + 1)
  }

  async function reconcileNow() {
    if (reconcilingRef.current) return
    reconcilingRef.current = true
    setReconciling(true)
    setOutcome(null)
    try {
      const result = await runDiasporaBillingReconciliation()
      setOutcome({
        tone: 'info',
        text: result.mismatches > 0
          ? `Reconciliation finished: ${result.mismatches} mismatch${result.mismatches === 1 ? '' : 'es'} across ${result.checked} checked. Review the runs below.`
          : `Reconciliation finished: ${result.checked} checked, no mismatches.`,
      })
      reload()
    } catch (err) {
      setOutcome({ tone: 'danger', text: `Reconciliation could not be started: ${err instanceof Error ? err.message : 'unknown error'}` })
    } finally {
      setReconciling(false)
      reconcilingRef.current = false
    }
  }

  if (forbidden) return null
  const summary = health ? describeBillingHealth(health) : null

  return (
    <DeskPanel
      eyebrow="Operator · test mode"
      title="Billing operations"
      testId="trade-billing-ops"
      actions={(
        <button type="button" className={WS_SECONDARY} onClick={() => void reconcileNow()} disabled={reconciling} data-testid="trade-billing-reconcile">
          {reconciling ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          {reconciling ? 'Reconciling…' : 'Reconcile now'}
        </button>
      )}
    >
      <p className="mb-3 text-sm leading-6 text-carup-text-2">The billing provider runs in test mode. No real payment is collected and no live provider is enabled.</p>
      {outcome && <p role={outcome.tone === 'info' ? 'status' : 'alert'} className={cn('mb-3 rounded-control border px-3 py-2.5 text-sm text-carup-text', outcome.tone === 'info' ? 'border-status-info bg-status-info-soft' : 'border-status-danger bg-status-danger-soft')} data-testid="trade-billing-outcome">{outcome.text}</p>}
      {(read.phase === 'idle' || read.phase === 'loading') && <DeskState compact kind="loading" title="Loading billing health…" testId="trade-billing-loading" />}
      {read.phase === 'failed' && (
        failureKind(read) === 'limited'
          ? <DeskState compact kind="limited" title="Too many requests right now" onRetry={reload} retryLabel="Retry now" testId="trade-billing-failed">Nothing is retried automatically.</DeskState>
          : <DeskState compact kind="failed" title="Billing health could not be loaded" onRetry={reload} testId="trade-billing-failed">A failed read is not a clean result.</DeskState>
      )}
      {read.phase === 'ready' && summary && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {([['Reconciliation', summary.reconciliation, 'trade-billing-reconciliation'], ['Provider events', summary.failedWebhooks, 'trade-billing-webhooks']] as const).map(([label, signal, testId]) => (
              <div key={label} className={cn('rounded-control border p-3', signal.tone === 'failed' ? 'border-status-danger bg-status-danger-soft' : 'border-carup-line bg-carup-bg-surface')} data-testid={testId}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-carup-text-2">{label}</p>
                  <StatusChip tone={TONE[signal.tone]}>{signal.label}</StatusChip>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-carup-text-2">{signal.detail}</p>
              </div>
            ))}
          </div>
          {summary.needsOperator && (
            <p role="alert" className="flex items-start gap-2 rounded-control border border-status-danger bg-status-danger-soft px-3 py-2.5 text-sm text-carup-text" data-testid="trade-billing-needs-operator">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-danger" aria-hidden="true" />
              <span><strong className="font-semibold">Needs operator attention.</strong> {summary.needsOperatorReason}</span>
            </p>
          )}
          {runs.length > 0 && (
            <div data-testid="trade-billing-runs">
              <h3 className="text-sm font-semibold text-carup-text">Recent reconciliation runs</h3>
              <ul className="mt-2 divide-y divide-carup-line rounded-control border border-carup-line">
                {runs.map((run) => {
                  const d = describeReconciliationRun(run)
                  return (
                    <li key={run.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5 text-xs" data-testid={`trade-billing-run-${run.state}`}>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-semibold text-carup-text">
                          {d.tone === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5 text-status-success" aria-hidden="true" /> : d.tone === 'failed' ? <AlertTriangle className="h-3.5 w-3.5 text-status-danger" aria-hidden="true" /> : <Loader2 className="h-3.5 w-3.5 text-carup-text-3" aria-hidden="true" />}
                          {d.label}
                        </span>
                        <span className="mt-0.5 block text-carup-text-2">{d.detail}</span>
                      </span>
                      <span className="text-right text-carup-text-3">
                        <span className="block">{run.trigger}</span>
                        <span className="block">{formatDateTime(run.finished_at ?? run.started_at) ?? 'Time not recorded'}</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </DeskPanel>
  )
}
