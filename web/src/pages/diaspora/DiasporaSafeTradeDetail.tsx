/**
 * DiasporaSafeTradeDetail — Phase 9 SafeTrade case detail orchestrator (flag-gated, fail closed).
 *
 * Loads the case + timeline + eligibility + milestones + disputes + server-derived available-actions
 * (the UI renders action controls ONLY from available-actions; it never duplicates the transition
 * table). Resilient to partial data, 403/404, missing tenant and stale-state conflicts (manual +
 * post-action refresh). SafeTrade is non-custodial, sandbox-only; the assurance notice is always shown.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Loader2, Lock, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { safeTradeUiEnabled } from '@/config/safeTradeFlag'
import { SafeTradeAssuranceNotice } from '@/components/diaspora/safetrade/SafeTradeAssuranceNotice'
import { SafeTradeStatusBanner } from '@/components/diaspora/safetrade/SafeTradeStatusBanner'
import { SafeTradeTimeline } from '@/components/diaspora/safetrade/SafeTradeTimeline'
import { SafeTradeEligibilityPanel } from '@/components/diaspora/safetrade/SafeTradeEligibilityPanel'
import { SafeTradeMilestones } from '@/components/diaspora/safetrade/SafeTradeMilestones'
import { UnavailableNote } from '@/components/diaspora/DataStateNotes'
import { SafeTradeActions } from '@/components/diaspora/safetrade/SafeTradeActions'
import { SafeTradeDisputes } from '@/components/diaspora/safetrade/SafeTradeDisputes'
import { classifyActionError, designStateOf } from '@/components/diaspora/safetrade/safeTradeHelpers'
import type {
  SafeTradeTransaction, SafeTradeTimelineEvent, SafeTradeEligibilityVerdict,
  SafeTradeMilestone, SafeTradeDispute, SafeTradeAvailableAction,
} from '@/types'

const REVIEWER_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer'])

export default function DiasporaSafeTradeDetail() {
  const flagEnabled = safeTradeUiEnabled()
  const { id = '' } = useParams<{ id: string }>()
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  const api = useCarUpApi()
  const viewerId = user?.id || null
  const isReviewer = REVIEWER_ROLES.has((user?.role || '').toLowerCase())

  const [txn, setTxn] = useState<SafeTradeTransaction | null>(null)
  const [timeline, setTimeline] = useState<SafeTradeTimelineEvent[]>([])
  const [eligibility, setEligibility] = useState<SafeTradeEligibilityVerdict | null>(null)
  const [milestones, setMilestones] = useState<SafeTradeMilestone[]>([])
  const [disputes, setDisputes] = useState<SafeTradeDispute[]>([])
  const [actions, setActions] = useState<SafeTradeAvailableAction[]>([])
  // Which best-effort sections could not be read, so each can say so itself
  // rather than presenting an unreadable section as an empty one.
  const [unreadableSections, setUnreadableSections] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  // Distinguishes the INITIAL load (full-page spinner) from later refreshes (in-place; the case stays
  // on screen). A ref guards against overlapping loads so the always-focusable Refresh button cannot
  // fire concurrent fetches.
  const [hasLoaded, setHasLoaded] = useState(false)
  const loadingRef = useRef(false)
  const [fatal, setFatal] = useState<{ kind: 'notfound' | 'forbidden' | 'tenant' | 'session' | 'error'; message: string } | null>(null)

  const canView = flagEnabled && isAuthenticated

  const load = useCallback(async () => {
    if (!canView || !id || loadingRef.current) return
    loadingRef.current = true
    setLoading(true); setFatal(null)
    try {
      const t = await api.getSafeTradeCase(id) // backbone; its failure is fatal
      setTxn(t)
      // Best-effort enrichments — a single failure must not blank the page
      // (partial-data tolerant). But an unreadable section says so: collapsing it
      // to [] reported a failed milestone read as "no milestones defined" with a
      // plan total of zero, and hid an active dispute behind "no disputes".
      const unreadable = new Set<string>()
      try { setTimeline(await api.getSafeTradeTimeline(id)) } catch { setTimeline([]); unreadable.add('timeline') }
      try { setEligibility(await api.getSafeTradeEligibility(id)) } catch { setEligibility(null); unreadable.add('eligibility') }
      try { setMilestones(await api.getSafeTradeMilestones(id)) } catch { setMilestones([]); unreadable.add('milestones') }
      try { setDisputes(await api.getSafeTradeDisputes(id)) } catch { setDisputes([]); unreadable.add('disputes') }
      try { setActions(await api.getSafeTradeAvailableActions(id)) } catch { setActions([]); unreadable.add('actions') }
      setUnreadableSections(unreadable)
    } catch (err) {
      // apiRequest throws a plain Error carrying only the server's MESSAGE (no structured code);
      // classify from message content. A 401 session failure is shown as a sign-in prompt, NOT a
      // dead Retry (auth is already cleared, so Retry would no-op).
      const { kind } = classifyActionError(err)
      if (kind === 'session') setFatal({ kind: 'session', message: 'Your session has expired. Please sign in again to view this case.' })
      else if (kind === 'notfound') setFatal({ kind: 'notfound', message: 'This SafeTrade case was not found.' })
      else if (kind === 'forbidden') setFatal({ kind: 'forbidden', message: 'You do not have access to this SafeTrade case.' })
      else if (kind === 'tenant') setFatal({ kind: 'tenant', message: 'A tenant context is required to view this case.' })
      else setFatal({ kind: 'error', message: 'Could not load this SafeTrade case. Please retry.' })
    } finally { setLoading(false); setHasLoaded(true); loadingRef.current = false }
  }, [api, canView, id])

  // Depend on stable primitives (not `load`): useCarUpApi() returns a fresh object each render, so a
  // `load` dependency would recreate it every render and loop the effect forever.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading && canView) void load() }, [authLoading, canView, id])

  if (!flagEnabled) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="safetrade-detail-unavailable">
        <Alert className="border-slate-200 bg-slate-50">
          <Lock className="h-4 w-4 text-slate-700" aria-hidden="true" />
          <AlertTitle>SafeTrade is not available</AlertTitle>
          <AlertDescription>SafeTrade is not available in this environment. It can be enabled by an administrator.</AlertDescription>
        </Alert>
      </div>
    )
  }
  // Full-page spinner only on the INITIAL load (before the first load resolves). A manual/post-action
  // refresh keeps the case on screen (see the inline Refresh indicator) so context and focus are
  // preserved, and the Refresh control stays keyboard-focusable throughout.
  if (authLoading || (loading && !hasLoaded)) {
    return <div className="flex min-h-[40vh] items-center justify-center text-orange-600" data-testid="safetrade-detail-loading"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /></div>
  }
  if (fatal) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12" data-testid={`safetrade-detail-${fatal.kind}`}>
        <Alert variant={fatal.kind === 'error' ? 'destructive' : 'default'}>
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Unable to open case</AlertTitle>
          <AlertDescription>
            {fatal.message}
            <span className="ml-2 inline-flex gap-2">
              {fatal.kind === 'error' && <Button size="sm" variant="outline" onClick={() => void load()} data-testid="safetrade-detail-retry">Retry</Button>}
              {fatal.kind === 'session' && <Button asChild size="sm" variant="default"><Link to="/login" data-testid="safetrade-detail-signin">Sign in</Link></Button>}
              <Button asChild size="sm" variant="ghost"><Link to="/diaspora/safetrade">Back to cases</Link></Button>
            </span>
          </AlertDescription>
        </Alert>
      </main>
    )
  }
  if (!txn) return null

  return (
    <main className="mx-auto max-w-4xl px-4 py-8" data-testid="safetrade-detail-page" aria-busy={loading}>
      <div className="mb-3 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm"><Link to="/diaspora/safetrade"><ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> All cases</Link></Button>
        <Button variant="outline" size="sm" onClick={() => void load()} aria-busy={loading} data-testid="safetrade-detail-refresh">
          {loading
            ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
            : <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" />}
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <div className="space-y-4">
        <SafeTradeAssuranceNotice />
        <SafeTradeStatusBanner txn={txn} viewerId={viewerId} />
        <SafeTradeTimeline currentState={designStateOf(txn)} events={timeline} />
        <SafeTradeEligibilityPanel verdict={eligibility} showRiskTier={isReviewer} />
        <SafeTradeMilestones milestones={milestones} currency={txn.currency} unavailable={unreadableSections.has('milestones')} />
        {unreadableSections.has('disputes') && (
          <UnavailableNote testId="safetrade-disputes-unavailable">
            Dispute information could not be loaded. This is not confirmation that this case has no
            open dispute.
          </UnavailableNote>
        )}
        {unreadableSections.has('actions') && (
          <UnavailableNote testId="safetrade-actions-unavailable">
            The available actions could not be loaded, so none are offered here. Actions may still be
            available on this case.
          </UnavailableNote>
        )}
        <SafeTradeActions transactionId={txn.id} actions={actions} onDone={load} />
        <SafeTradeDisputes transactionId={txn.id} disputes={disputes} actions={actions} viewerId={viewerId} isReviewer={isReviewer} onDone={load} />
      </div>
    </main>
  )
}
