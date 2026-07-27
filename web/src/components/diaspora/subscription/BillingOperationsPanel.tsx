import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { BillingHealth, BillingReconciliationRun } from '@/types'
import { describeBillingHealth, describeReconciliationRun } from './billingOperationsHelpers'

/**
 * Operator view of billing health (Issue #127, Deliverable D).
 *
 * The backend records four independent signals; this panel exists so none of them can be silently
 * lost. Two design rules it must not break:
 *
 *  - A route that responds is not a healthy system. Reconciliation FRESHNESS is reported separately
 *    from mismatch counts, because a scheduler that quietly stopped looks exactly like "no problems
 *    found" if you only count mismatches.
 *  - Everything here is test-mode. The panel says so unconditionally, so no reading of it can be
 *    mistaken for evidence that real money moved.
 *
 * All three reads are manager-gated server-side; a non-manager gets 403 and this panel renders
 * nothing rather than a misleading empty state.
 */
export default function BillingOperationsPanel() {
  const {
    fetchDiasporaBillingHealth,
    fetchDiasporaReconciliationRuns,
    runDiasporaBillingReconciliation,
  } = useCarUpApi()

  const [health, setHealth] = useState<BillingHealth | null>(null)
  const [runs, setRuns] = useState<BillingReconciliationRun[]>([])
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(false)
  const [loading, setLoading] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [outcome, setOutcome] = useState('')
  // Synchronous guards: the load effect must not loop, and a double-click must not start two runs.
  const inFlight = useRef(false)
  const reconcilingRef = useRef(false)

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError('')
    try {
      const [h, r] = await Promise.all([fetchDiasporaBillingHealth(), fetchDiasporaReconciliationRuns()])
      setHealth(h)
      setRuns(r || [])
      setForbidden(false)
    } catch (err) {
      const status = (err as { status?: number } | null)?.status
      // 403 is the expected answer for a non-manager, not a failure worth alarming them about.
      if (status === 403) setForbidden(true)
      else setError(err instanceof Error ? err.message : 'Unable to load billing health')
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }, [fetchDiasporaBillingHealth, fetchDiasporaReconciliationRuns])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const reconcileNow = async () => {
    if (reconcilingRef.current) return
    reconcilingRef.current = true
    setReconciling(true)
    setOutcome('')
    setError('')
    try {
      const result = await runDiasporaBillingReconciliation()
      setOutcome(
        result.mismatches > 0
          ? `Reconciliation finished: ${result.mismatches} mismatch${result.mismatches === 1 ? '' : 'es'} across ${result.checked} checked. Review the findings below.`
          : `Reconciliation finished: ${result.checked} checked, no mismatches.`,
      )
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reconciliation could not be started')
    } finally {
      setReconciling(false)
      reconcilingRef.current = false
    }
  }

  if (forbidden) return null

  const summary = health ? describeBillingHealth(health) : null

  return (
    <section className="mt-6 rounded-lg border border-gray-200 bg-white p-4" data-testid="billing-operations-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Billing operations</h2>
          <p className="mt-1 text-xs text-gray-500">
            Provider integration runs in <strong>test mode</strong>. No real payment is ever collected
            and no live provider is enabled.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={reconcileNow} disabled={reconciling} data-testid="billing-reconcile-now">
          {reconciling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {reconciling ? 'Reconciling…' : 'Reconcile now'}
        </Button>
      </div>

      {loading && <p className="mt-3 flex items-center gap-2 text-sm text-orange-600" data-testid="billing-ops-loading"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}

      {error && (
        <Alert className="mt-3 border-red-200" data-testid="billing-ops-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Unable to load billing health</AlertTitle>
          <AlertDescription>
            <span className="block">{error}</span>
            <Button size="sm" variant="outline" className="mt-2" onClick={load} data-testid="billing-ops-retry">Retry</Button>
          </AlertDescription>
        </Alert>
      )}

      {outcome && <p aria-live="polite" className="mt-3 text-sm font-medium text-gray-800" data-testid="billing-reconcile-outcome">{outcome}</p>}

      {summary && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {/* Freshness first: a stale reconciliation is indistinguishable from "all clear" if you
              only look at mismatch counts. */}
          <div
            className={`rounded-md border p-3 ${summary.reconciliation.tone === 'failed' ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}
            data-testid="billing-health-reconciliation"
          >
            <p className="text-xs font-semibold uppercase text-gray-500">Reconciliation</p>
            <p className="mt-1 text-sm font-medium text-gray-900" data-testid="billing-health-reconciliation-label">{summary.reconciliation.label}</p>
            <p className="mt-1 text-xs text-gray-600">{summary.reconciliation.detail}</p>
          </div>

          <div
            className={`rounded-md border p-3 ${summary.failedWebhooks.tone === 'failed' ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}
            data-testid="billing-health-failed-webhooks"
          >
            <p className="text-xs font-semibold uppercase text-gray-500">Provider events</p>
            <p className="mt-1 text-sm font-medium text-gray-900" data-testid="billing-health-failed-webhooks-label">{summary.failedWebhooks.label}</p>
            <p className="mt-1 text-xs text-gray-600">{summary.failedWebhooks.detail}</p>
          </div>
        </div>
      )}

      {summary?.needsOperator && (
        <Alert className="mt-3 border-red-200" data-testid="billing-needs-operator">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Needs operator attention</AlertTitle>
          <AlertDescription>{summary.needsOperatorReason}</AlertDescription>
        </Alert>
      )}

      {runs.length > 0 && (
        <div className="mt-4" data-testid="billing-reconciliation-runs">
          <h3 className="text-sm font-semibold text-gray-900">Recent reconciliation runs</h3>
          <ul className="mt-2 space-y-2">
            {runs.map((run) => {
              const d = describeReconciliationRun(run)
              return (
                <li key={run.id} className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs" data-testid={`billing-run-${run.state}`}>
                  <span className="flex items-center gap-2 font-medium text-gray-900">
                    {d.tone === 'failed'
                      ? <AlertTriangle className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />
                      : d.tone === 'ok'
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-700" aria-hidden="true" />
                        : <Loader2 className="h-3.5 w-3.5 text-gray-600" aria-hidden="true" />}
                    {d.label}
                    <Badge variant="outline">{run.trigger}</Badge>
                  </span>
                  <span className="mt-1 block text-gray-600">{d.detail}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
