import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { CaseHub } from '@/lib/garageBusiness'
import { caseStatusLabel, isTerminalCase } from '@/lib/garageWorkspace'
import { SN_DETAIL_COLUMN, SN_PAGE } from '@/lib/serviceNetworkLayout'
import { AssignmentPanel } from '@/components/garage/hub/AssignmentPanel'
import { CaseHistory } from '@/components/garage/hub/CaseHistory'
import { CloseoutPanel } from '@/components/garage/hub/CloseoutPanel'
import { EstimatePanel } from '@/components/garage/hub/EstimatePanel'
import { HubHeader } from '@/components/garage/hub/HubHeader'
import { HubProgress } from '@/components/garage/hub/HubProgress'
import { PartsUsedPanel } from '@/components/garage/hub/PartsUsedPanel'
import { RequestDecisionPanel } from '@/components/garage/hub/RequestDecisionPanel'
import { StartWorkPanel } from '@/components/garage/hub/StartWorkPanel'
import { WorkPanel } from '@/components/garage/hub/WorkPanel'
import { ScopedError, type HubError, type HubRun } from '@/components/garage/hub/hubUi'

/**
 * One job, start to finish — the Garage operating hub (GARAGE-1.0).
 *
 * The whole page is driven by ONE read model, `fetchGarageCaseHub(caseId)`: the case, the vehicle, the
 * appointment, every estimate version, the customer's authorization, the assignment, what was done, the parts
 * used, the commercial closeout (garage administrators only) and — the rule that governs everything below —
 * `allowed_actions`, the exact set of things the backend will accept from THIS caller right now.
 *
 * Three rules run through it:
 *   - a control is rendered only if its key is in `allowed_actions`; where an action is not available the
 *     page says why in plain words but offers no button, so nobody is handed a control that comes back 409;
 *   - after every successful action the hub is re-read — nothing is patched locally, so what is shown is
 *     what the server holds;
 *   - a refusal is shown in the server's own words, beside the panel that was refused.
 *
 * Money is shown only when the server sends it (`closeout` is null for a mechanic), always as an amount
 * with its currency, "Not recorded" when it is null, and never added or converted in the browser.
 */

type Loaded = { caseId: string; hub: CaseHub | null; failed: boolean }

export default function GarageCaseDetail() {
  const { caseId } = useParams<{ caseId: string }>()
  const { fetchGarageCaseHub } = useCarUpApi()

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<HubError | null>(null)
  const busyRef = useRef(false)
  const requestSeq = useRef(0)

  /** One read of the hub. A slower, older response never overwrites a newer one. */
  const load = useCallback(async (): Promise<void> => {
    if (!caseId) return
    const seq = ++requestSeq.current
    try {
      const hub = await fetchGarageCaseHub(caseId)
      if (seq === requestSeq.current) setLoaded({ caseId, hub, failed: false })
    } catch (e) {
      // A failed RE-read keeps the hub that is already on screen; only a first read can fail the page.
      if (seq === requestSeq.current) {
        setLoaded((prev) => (prev && prev.caseId === caseId && prev.hub ? prev : { caseId, hub: null, failed: true }))
      }
      throw e
    }
  }, [caseId, fetchGarageCaseHub])

  useEffect(() => {
    load().catch(() => { /* the failed state is already recorded */ })
  }, [load])

  /**
   * Every action goes through here: run it, then re-read the hub. A refusal is kept in the server's words and
   * attributed to the panel it came from. Resolves true when the action itself succeeded.
   */
  const run: HubRun = useCallback(async (scope, fn, success) => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    let ok = false
    try {
      await fn()
      ok = true
    } catch (e) {
      setError({ scope, message: e instanceof Error && e.message ? e.message : 'That did not go through. Nothing was changed.' })
    }
    if (ok) {
      try {
        await load()
        setNotice(success)
      } catch {
        // The action itself went through, but what is on screen may now be stale — say so.
        setError({ scope: 'case', message: 'That went through, but this page could not be refreshed. Reload it to see the latest.' })
      }
    }
    busyRef.current = false
    setBusy(false)
    return ok
  }, [load])

  const mine = loaded && loaded.caseId === caseId ? loaded : null

  if (!mine) {
    return (
      <div className="flex items-center gap-3 p-8" role="status" aria-live="polite">
        <Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
        <span className="text-sm text-gray-600">Loading this job…</span>
      </div>
    )
  }

  if (mine.failed || !mine.hub) {
    return (
      <Card className={`border-0 ${SN_DETAIL_COLUMN} mx-auto`} data-testid="case-error">
        <CardContent className="p-6 text-center">
          <p className="font-semibold text-gray-800">This job could not be opened</p>
          <p className="text-sm text-gray-500 mt-1">
            It may not belong to your garage, or it could not be loaded right now.
          </p>
          <Link to="/garage"><Button variant="outline" className="mt-4 min-h-11">Back to the workshop</Button></Link>
        </CardContent>
      </Card>
    )
  }

  const hub = mine.hub
  const terminal = isTerminalCase(hub.case.status)
  const panel = { hub, busy, run, error }

  return (
    <div className={SN_PAGE}>
      <Link to="/garage" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Workshop
      </Link>

      <HubHeader hub={hub} />

      <div className="grid gap-8 lg:grid-cols-3 items-start">
        {/* On a phone the progress comes first; on a wide screen it stays beside the panels as context. */}
        <aside className="lg:col-start-3 lg:row-start-1 lg:sticky lg:top-4" aria-label="Progress">
          <HubProgress hub={hub} />
        </aside>

        <div className="space-y-8 min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-1">
          {notice && (
            <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status" data-testid="case-notice">{notice}</p>
          )}
          <ScopedError scope="case" error={error} />

          {terminal && (
            <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600" data-testid="case-closed">
              This job is {caseStatusLabel(hub.case.status).toLowerCase()} and is kept as history. It cannot be reopened,
              and what was recorded on it stays as it was recorded.
            </p>
          )}

          <RequestDecisionPanel {...panel} />
          <EstimatePanel {...panel} />
          <AssignmentPanel {...panel} />
          <StartWorkPanel {...panel} />
          <WorkPanel {...panel} />
          <PartsUsedPanel {...panel} />
          <CloseoutPanel {...panel} />
          <CaseHistory hub={hub} />
        </div>
      </div>
    </div>
  )
}
