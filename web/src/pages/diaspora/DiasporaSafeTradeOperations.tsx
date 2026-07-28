/**
 * SafeTrade Operations console — the operator surface for ST-3 items #1, #2 and #3 (Issue #127).
 *
 * Each of the three ST-3 mechanisms produces a queue that only works if a human can see it:
 *
 *   · **Approvals (#2)** — a high-risk release waits for a second human. If nobody can see that it is
 *     waiting, the release simply never happens and nobody knows why.
 *   · **Reconciliation (#3)** — an operation that never reached `ledger_applied` is money we cannot
 *     account for. Invisible, it is indistinguishable from money that settled fine.
 *   · **Outbox (#1)** — a stalled drainer is silent by construction. The backlog's *age* is what
 *     exposes it; three events whose oldest is four hours old is a stalled drainer, and a count of
 *     three looks harmless.
 *
 * Every control here is re-authorized server-side. Self-approval is refused in three independent
 * places (service, DB CHECK, RPC under row lock), so the disabled button below is a courtesy that
 * explains the rule — never the thing enforcing it.
 *
 * Fail-closed: with VITE_DIASPORA_SAFETRADE_UI_ENABLED off (the default) this renders an explicit
 * unavailable state and fetches nothing.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Loader2, Lock, RefreshCw, ShieldAlert, XCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { safeTradeUiEnabled, SAFETRADE_NON_CUSTODIAL_NOTICE } from '@/config/safeTradeFlag'
import type {
  SafeTradeApproval, SafeTradeOperation, SafeTradeOutboxBacklog, SafeTradeOutboxDeadLetter,
} from '@/types'
import { formatAge, outboxHealth } from './safeTradeOperationsHelpers'

export default function DiasporaSafeTradeOperations() {
  const flagEnabled = safeTradeUiEnabled()
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  const api = useCarUpApi()

  const [approvals, setApprovals] = useState<SafeTradeApproval[]>([])
  const [queue, setQueue] = useState<SafeTradeOperation[]>([])
  const [backlog, setBacklog] = useState<SafeTradeOutboxBacklog | null>(null)
  const [deadLetters, setDeadLetters] = useState<SafeTradeOutboxDeadLetter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const role = String(user?.role || '').toLowerCase()
  const isReviewer = ['admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer'].includes(role)
  const isPlatformAdmin = ['platform_admin', 'super_admin', 'admin'].includes(role)
  const canView = flagEnabled && isAuthenticated && isReviewer

  const load = useCallback(async () => {
    if (!canView) return
    setLoading(true); setError(null); setForbidden(false)
    try {
      // Settled independently: a failure in one queue must not blank the other two, which are still
      // true and still actionable.
      const [a, q, b, d] = await Promise.allSettled([
        api.getSafeTradeApprovals(),
        api.getSafeTradeReconciliationQueue(),
        api.getSafeTradeOutboxBacklog(),
        api.getSafeTradeOutboxDeadLetters(),
      ])
      if (a.status === 'fulfilled') setApprovals(a.value)
      if (q.status === 'fulfilled') setQueue(q.value)
      if (b.status === 'fulfilled') setBacklog(b.value)
      if (d.status === 'fulfilled') setDeadLetters(d.value)

      const firstFailure = [a, q, b, d].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
      if (firstFailure) {
        const message = firstFailure.reason instanceof Error ? firstFailure.reason.message : ''
        if (/forbidden|403/i.test(message)) setForbidden(true)
        else setError('Some operations data could not be loaded. What is shown below is still current.')
      }
    } catch {
      setError('Could not load SafeTrade operations. Please retry.')
    } finally {
      setLoading(false)
    }
  }, [api, canView])

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading && canView) void load() }, [authLoading, canView])

  const act = useCallback(async (id: string, fn: () => Promise<unknown>, ok: string, bad: string) => {
    setBusyId(id); setNotice(null)
    try { await fn(); setNotice(ok); await load() } catch { setNotice(bad) } finally { setBusyId(null) }
  }, [load])

  if (!flagEnabled) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="safetrade-ops-unavailable">
        <Alert className="border-slate-200 bg-slate-50">
          <Lock className="h-4 w-4 text-slate-700" aria-hidden="true" />
          <AlertTitle>SafeTrade operations are not available</AlertTitle>
          <AlertDescription>This console is not available in this environment. It can be enabled by an administrator.</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!authLoading && (!isAuthenticated || !isReviewer)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="safetrade-ops-forbidden">
        <Alert className="border-amber-200 bg-amber-50">
          <ShieldAlert className="h-4 w-4 text-amber-700" aria-hidden="true" />
          <AlertTitle>Reviewer access required</AlertTitle>
          <AlertDescription>
            The SafeTrade operations console is limited to reviewers and administrators.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const health = outboxHealth(backlog)

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8" data-testid="safetrade-ops-page">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">SafeTrade operations</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Approvals awaiting a second reviewer, operations awaiting confirmation, and the event
            backlog.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} data-testid="safetrade-ops-refresh">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />}
          Refresh
        </Button>
      </header>

      <div role="status" aria-live="polite" className="sr-only" data-testid="safetrade-ops-announcer">
        {loading ? 'Loading SafeTrade operations' : `${approvals.length} approvals awaiting review`}
      </div>

      {forbidden && (
        <Alert className="mb-6 border-amber-200 bg-amber-50" data-testid="safetrade-ops-denied">
          <ShieldAlert className="h-4 w-4 text-amber-700" aria-hidden="true" />
          <AlertTitle>Not available for this account</AlertTitle>
          <AlertDescription>You do not have access to SafeTrade operations for this organisation.</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert className="mb-6 border-amber-200 bg-amber-50" data-testid="safetrade-ops-partial">
          <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden="true" />
          <AlertTitle>Partial data</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert className="mb-6 border-slate-200 bg-slate-50" data-testid="safetrade-ops-notice">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {/* ── Approvals (ST-3 #2) ─────────────────────────────────────────── */}
      <section aria-labelledby="approvals-heading" className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 id="approvals-heading" className="mb-3 text-sm font-semibold text-slate-900">
          Awaiting a second approver
        </h2>
        {approvals.length === 0 ? (
          <p className="text-sm text-slate-600" data-testid="approvals-empty">No approvals are waiting.</p>
        ) : (
          <ul className="space-y-3" data-testid="approvals-list">
            {approvals.map((a) => (
              <li key={a.id} className="rounded border border-slate-200 p-3" data-testid={`approval-${a.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{a.decision_type}</Badge>
                  <Badge variant="outline">{a.risk_level}</Badge>
                  {a.amount != null && (
                    <span className="text-sm tabular-nums text-slate-700">
                      {a.currency || ''} {Number(a.amount).toLocaleString()}
                    </span>
                  )}
                  <span className="text-xs text-slate-500">requested {new Date(a.requested_at).toLocaleString()}</span>
                </div>
                {a.requested_reason && <p className="mt-1 text-sm text-slate-700">{a.requested_reason}</p>}

                {a.selfApprovalBlocked ? (
                  // The rule is explained, not merely enforced by a greyed-out control. A reviewer who
                  // cannot see WHY they are blocked will assume the page is broken.
                  <p className="mt-2 text-sm text-amber-800" data-testid={`approval-self-blocked-${a.id}`}>
                    You requested this decision, so a different reviewer must approve it.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busyId === a.id}
                      data-testid={`approve-${a.id}`}
                      onClick={() => void act(a.id, () => api.approveSafeTradeDecision(a.id),
                        'Approval recorded. The release can now be authorized.',
                        'That approval could not be recorded. It may have expired or been actioned already.')}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === a.id}
                      data-testid={`reject-${a.id}`}
                      onClick={() => void act(a.id, () => api.rejectSafeTradeDecision(a.id),
                        'Approval rejected.',
                        'That rejection could not be recorded.')}
                    >
                      <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />Reject
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Reconciliation queue (ST-3 #3) ──────────────────────────────── */}
      <section aria-labelledby="recon-heading" className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 id="recon-heading" className="mb-1 text-sm font-semibold text-slate-900">Awaiting confirmation</h2>
        <p className="mb-3 text-xs text-slate-500">
          Operations the payment provider has not yet confirmed against our ledger. These are not
          failures — do not retry them here.
        </p>
        {queue.length === 0 ? (
          <p className="text-sm text-slate-600" data-testid="recon-empty">Everything is reconciled.</p>
        ) : (
          <ul className="space-y-2" data-testid="recon-list">
            {queue.map((op) => (
              <li key={op.id} className="rounded border border-slate-200 p-3 text-sm" data-testid={`recon-${op.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{op.operation}</Badge>
                  <Badge variant="outline">{op.state}</Badge>
                  {op.amount != null && (
                    <span className="tabular-nums text-slate-700">{op.currency || ''} {Number(op.amount).toLocaleString()}</span>
                  )}
                  <span className="text-xs text-slate-500">{op.attempts} attempt{op.attempts === 1 ? '' : 's'}</span>
                </div>
                {op.userState && (
                  <p className="mt-1 text-slate-700" data-testid={`recon-message-${op.id}`}>{op.userState.userMessage}</p>
                )}
                {op.last_error && <p className="mt-1 font-mono text-xs text-slate-600">{op.last_error}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Outbox (ST-3 #1) ────────────────────────────────────────────── */}
      <section aria-labelledby="outbox-heading" className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="outbox-heading" className="text-sm font-semibold text-slate-900">Event backlog</h2>
          {isPlatformAdmin && (
            <Button
              size="sm"
              variant="outline"
              disabled={busyId === 'drain'}
              data-testid="outbox-drain"
              onClick={() => void act('drain', () => api.drainSafeTradeOutbox(),
                'Drain complete.', 'The drain could not be run.')}
            >
              {busyId === 'drain' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Clock className="mr-2 h-4 w-4" aria-hidden="true" />}
              Drain now
            </Button>
          )}
        </div>

        {backlog && (
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="outbox-backlog">
            <div><p className="text-xs uppercase text-slate-500">Pending</p><p className="text-lg font-semibold tabular-nums" data-testid="outbox-pending">{backlog.pending}</p></div>
            <div><p className="text-xs uppercase text-slate-500">Retrying</p><p className="text-lg font-semibold tabular-nums" data-testid="outbox-retrying">{backlog.retrying}</p></div>
            <div><p className="text-xs uppercase text-slate-500">Dead-lettered</p><p className="text-lg font-semibold tabular-nums" data-testid="outbox-dead">{backlog.deadLettered}</p></div>
            <div><p className="text-xs uppercase text-slate-500">Oldest waiting</p><p className="text-lg font-semibold" data-testid="outbox-oldest">{formatAge(backlog.oldestPendingAgeSeconds)}</p></div>
          </div>
        )}

        {/* A small count with a very old head is the signature of a stalled drainer, so it is called
            out in words rather than left for the reader to infer from two separate numbers. */}
        {health === 'warn' && (
          <Alert className="mb-3 border-amber-200 bg-amber-50" data-testid="outbox-stalled">
            <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden="true" />
            <AlertTitle>Events are not being delivered</AlertTitle>
            <AlertDescription>
              The oldest queued event has been waiting {formatAge(backlog?.oldestPendingAgeSeconds)}. The
              drainer may have stopped.
            </AlertDescription>
          </Alert>
        )}

        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Undeliverable events</h3>
        {deadLetters.length === 0 ? (
          <p className="text-sm text-slate-600" data-testid="outbox-dead-empty">No undeliverable events.</p>
        ) : (
          <ul className="space-y-2" data-testid="outbox-dead-list">
            {deadLetters.map((dl) => (
              <li key={dl.id} className="rounded border border-slate-200 p-3 text-sm" data-testid={`outbox-dl-${dl.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{dl.event_type}</Badge>
                  <span className="text-xs text-slate-500">{dl.attempts} attempts</span>
                  <span className="text-xs text-slate-500">{new Date(dl.created_at).toLocaleString()}</span>
                </div>
                {dl.last_error && <p className="mt-1 font-mono text-xs text-slate-700">{dl.last_error}</p>}
                <p className="mt-1 text-xs text-slate-500">{dl.payloadWithheldReason}</p>
                {isPlatformAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    disabled={busyId === dl.id}
                    data-testid={`outbox-replay-${dl.id}`}
                    onClick={() => void act(dl.id, () => api.replaySafeTradeOutboxEvent(dl.id),
                      'Event re-queued for delivery.', 'That event could not be re-queued.')}
                  >
                    Retry delivery
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-slate-500" data-testid="safetrade-ops-notice-noncustodial">
        {SAFETRADE_NON_CUSTODIAL_NOTICE}
      </p>
    </div>
  )
}
