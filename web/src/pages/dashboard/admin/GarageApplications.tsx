import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, ArrowLeft, ShieldAlert, Eye } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { SN_PAGE, SN_DETAIL_COLUMN } from '@/lib/serviceNetworkLayout'
import StepUpPrompt from '@/components/auth/StepUpPrompt'
import { isStepUpRequired } from '@/lib/stepUp'
import {
  statusPresentation, STATUS_TONE_CLASS, evidenceTypeLabel,
  type GarageApplication, type EvidenceDocument,
} from '@/lib/garageOnboarding'

type Detail = {
  application: GarageApplication
  decisions: Array<{ id: string; decision: string; reason: string | null; actor_role: string | null; created_at: string }>
  documents: Array<EvidenceDocument & { removed_at?: string | null }>
  identity: { identity_state?: string; usable_for_identity_gated_actions?: boolean } | null
  identity_error: string | null
  allowed_decisions: string[]
  blocking: string[]
}

const DECISION_LABEL: Record<string, string> = {
  start_review: 'Start reviewing',
  request_more_info: 'Ask for more',
  approve: 'Approve',
  reject: 'Not approve',
}

/** Which decisions must say why. Mirrors the server; the server is still the one that enforces it. */
const NEEDS_REASON = new Set(['request_more_info', 'reject'])

/**
 * GMO-3 — the Operations / Compliance reviewer's workspace.
 *
 * The reviewer decides; they do not build. There is no control on this page that creates a tenant,
 * a membership or a role — approving records a judgment and GMO-4 acts on it. The browser also
 * never computes what is possible: `allowed_decisions` and `blocking` come from the server, so a
 * reviewer cannot reach an action the server would refuse.
 *
 * Approving is deliberately not phrased as verifying. PO-2 holds that an activated garage may still
 * truthfully say "CarUp has not independently verified this garage", and nothing here claims
 * otherwise.
 */
export default function GarageApplications() {
  const {
    fetchGarageApplicationsForReview, fetchGarageApplicationForReview,
    decideGarageApplication, activateGarageApplication, previewGarageEvidenceForReview,
  } = useCarUpApi()

  const [queue, setQueue] = useState<GarageApplication[] | null>(null)
  const [queueState, setQueueState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // GMO-4: the outcome of building the workspace, reported separately from the decision. `null`
  // means no activation has been attempted in this session — not that it failed.
  const [activation, setActivation] = useState<{ activated: boolean; reason?: string } | null>(null)
  // The action the server asked us to re-authenticate for, held so it can be retried once the
  // person has proved it is them. Without this the reviewer hits STEP_UP_REQUIRED and the product
  // offers them nothing — the route was governed and unreachable at the same time.
  const [pendingStepUp, setPendingStepUp] = useState<{ reason: string; retry: () => Promise<void> } | null>(null)

  const loadQueue = useCallback(() => {
    fetchGarageApplicationsForReview()
      .then((res: { applications?: GarageApplication[] }) => { setQueue(res?.applications ?? []); setQueueState('ready') })
      // An empty queue and a broken queue look identical otherwise, and the difference is whether
      // people are waiting.
      .catch(() => setQueueState('error'))
  }, [fetchGarageApplicationsForReview])

  useEffect(() => { loadQueue() }, [loadQueue])

  const loadDetail = useCallback((id: string) => {
    // No synchronous setState here: this runs from an effect, and setting state synchronously
    // inside one is both a lint error and an extra render nobody asked for. The 'loading' state is
    // set by whatever causes the load — opening an application, or pressing Try again.
    fetchGarageApplicationForReview(id)
      .then((res) => { setDetail(res as unknown as Detail); setDetailState('ready') })
      .catch(() => setDetailState('error'))
  }, [fetchGarageApplicationForReview])

  useEffect(() => { if (selected) loadDetail(selected) }, [selected, loadDetail])

  async function decide(decision: string) {
    if (!selected) return
    setBusy(decision); setError(null)
    try {
      const res = await decideGarageApplication(selected, { decision, reason: reason.trim() || undefined })
      // An approval reports two outcomes: the judgment, and whether the workspace got built.
      if (res?.activation) setActivation(res.activation)
      setReason('')
      setPendingStepUp(null)
      loadDetail(selected)
      loadQueue()
    } catch (e) {
      if (isStepUpRequired(e)) {
        // Not an error to show as one: the decision was not refused, it was deferred until the
        // reviewer proves it is them. The reason they typed is preserved for the retry.
        setPendingStepUp({
          reason: 'Deciding a garage application changes what happens to someone\'s business, so CarUp asks you to confirm your password first.',
          retry: () => decide(decision),
        })
        return
      }
      setError(e instanceof Error ? e.message : 'That decision was not recorded.')
    } finally { setBusy(null) }
  }

  /** Retry building the workspace. Idempotent server-side, so pressing it twice is harmless. */
  async function retryActivation() {
    if (!selected) return
    setBusy('activate'); setError(null)
    try {
      await activateGarageApplication(selected)
      setActivation({ activated: true })
      loadDetail(selected)
    } catch (e) {
      setActivation({ activated: false, reason: e instanceof Error ? e.message : 'The workspace was not created.' })
    } finally { setBusy(null) }
  }

  async function preview(docId: string) {
    if (!selected) return
    setBusy(docId); setError(null)
    try {
      const res = await previewGarageEvidenceForReview(selected, docId)
      if (res?.url) window.open(res.url, '_blank', 'noopener,noreferrer')
      else setError('That preview link could not be created.')
    } catch (e) {
      if (isStepUpRequired(e)) {
        setPendingStepUp({
          reason: 'Opening someone\'s private document is a sensitive action, so CarUp asks you to confirm your password first.',
          retry: () => preview(docId),
        })
        return
      }
      setError(e instanceof Error ? e.message : 'That preview link could not be created.')
    } finally { setBusy(null) }
  }

  if (!selected) {
    return (
      <div className={SN_PAGE}>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Garage applications</h1>
          <p className="text-sm text-gray-600 mt-1">
            Businesses asking to operate a garage on CarUp. Approving one records a decision — it does
            not verify the business.
          </p>
        </div>

        {queueState === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-gray-600 py-8" role="status" aria-live="polite">
            <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
            Loading the queue…
          </div>
        )}

        {queueState === 'error' && (
          <div className="rounded-xl border border-gray-200 bg-white p-6" data-testid="queue-error">
            <p className="font-medium text-gray-900">The review queue could not be loaded.</p>
            <p className="text-sm text-gray-600 mt-1">
              This is a loading problem — it does not mean there is nothing waiting.
            </p>
            <Button variant="outline" className="min-h-11 mt-3" onClick={() => { setQueueState('loading'); loadQueue() }}>
              Try again
            </Button>
          </div>
        )}

        {queueState === 'ready' && (queue?.length ? (
          <ul className="space-y-3" data-testid="review-queue">
            {queue.map((app) => {
              const p = statusPresentation(app.status)
              return (
                <li key={app.id}>
                  <button
                    onClick={() => { setDetailState('loading'); setSelected(app.id) }} data-testid="queue-item"
                    className="w-full text-left rounded-xl border border-gray-200 bg-white p-4 hover:border-orange-300 min-h-11"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-gray-900">{app.trading_name || 'Unnamed garage'}</span>
                      <Badge className={STATUS_TONE_CLASS[p.tone]}>{p.label}</Badge>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      {app.location_city || 'No city recorded'} · sent {app.submitted_at ? new Date(app.submitted_at).toLocaleDateString() : 'not recorded'}
                    </p>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-600 rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center" data-testid="queue-empty">
            Nothing is waiting for review.
          </p>
        ))}
      </div>
    )
  }

  return (
    <div className={`${SN_PAGE} ${SN_DETAIL_COLUMN}`}>
      <Button
        variant="ghost" className="min-h-11 -ml-2" data-testid="back-to-queue"
        onClick={() => { setSelected(null); setDetail(null); setError(null); setReason('') }}
      >
        <ArrowLeft className="w-4 h-4 mr-1" aria-hidden="true" /> All applications
      </Button>

      {detailState === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-gray-600 py-8" role="status" aria-live="polite">
          <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
          Loading this application…
        </div>
      )}

      {detailState === 'error' && (
        <div className="rounded-xl border border-gray-200 bg-white p-6" data-testid="detail-error">
          <p className="font-medium text-gray-900">This application could not be loaded.</p>
          <Button variant="outline" className="min-h-11 mt-3" onClick={() => loadDetail(selected)}>Try again</Button>
        </div>
      )}

      {detailState === 'ready' && detail && (
        <>
          <div className="rounded-xl border border-gray-200 bg-white p-5" data-testid="application-detail">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h1 className="text-xl font-semibold text-gray-900">{detail.application.trading_name || 'Unnamed garage'}</h1>
              <Badge className={STATUS_TONE_CLASS[statusPresentation(detail.application.status).tone]} data-testid="detail-status">
                {statusPresentation(detail.application.status).label}
              </Badge>
            </div>
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 mt-4 text-sm">
              {([
                ['Address', detail.application.address_line],
                ['City', detail.application.location_city],
                ['Province', detail.application.location_province],
                ['Phone', detail.application.contact_phone],
                ['Email', detail.application.contact_email],
                ['Relationship', detail.application.applicant_relationship],
              ] as const).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-gray-500">{label}</dt>
                  {/* Not recorded is a fact. An empty cell reads as a rendering bug. */}
                  <dd className="text-gray-900">{value || <span className="text-gray-400">Not recorded</span>}</dd>
                </div>
              ))}
            </dl>
            {detail.application.service_categories?.length ? (
              <p className="text-sm text-gray-600 mt-3">
                <span className="text-gray-500">Work they do: </span>
                {detail.application.service_categories.join(', ')}
              </p>
            ) : null}
          </div>

          {/* PO-2: person identity is a prerequisite for a workspace. O2 owns this answer. */}
          <div className="rounded-xl border border-gray-200 bg-white p-5" data-testid="identity-panel">
            <h2 className="font-medium text-gray-900">Applicant identity</h2>
            {detail.identity_error ? (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2" data-testid="identity-unreadable">
                Their identity status could not be read just now. This is a system problem, not a
                finding against them — try again before you decide.
              </p>
            ) : detail.identity ? (
              <p className="text-sm text-gray-700 mt-2" data-testid="identity-state">
                {detail.identity.usable_for_identity_gated_actions
                  ? 'Approved and usable for identity-gated actions.'
                  : `Not approved — currently ${detail.identity.identity_state || 'in an unrecorded state'}.`}
              </p>
            ) : (
              <p className="text-sm text-gray-700 mt-2" data-testid="identity-missing">No identity record was found.</p>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5" data-testid="review-evidence">
            <h2 className="font-medium text-gray-900">Evidence</h2>
            {detail.documents.length === 0 ? (
              <p className="text-sm text-gray-600 mt-2" data-testid="review-evidence-empty">Nothing was uploaded.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {detail.documents.map((doc) => (
                  <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 border-b last:border-0 pb-2" data-testid="review-evidence-item">
                    <span className="text-sm text-gray-900">
                      {evidenceTypeLabel(doc.evidence_type)}
                      {doc.removed_at && (
                        <span className="text-gray-500"> · withdrawn by the applicant</span>
                      )}
                    </span>
                    <Button variant="outline" size="sm" className="min-h-11" onClick={() => preview(doc.id)} disabled={busy === doc.id} data-testid="review-evidence-preview">
                      <Eye className="w-4 h-4 mr-1" aria-hidden="true" /> View
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {detail.blocking.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4" data-testid="approval-blockers">
              <p className="font-medium text-amber-900 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" aria-hidden="true" /> This cannot be approved yet
              </p>
              <ul className="list-disc pl-5 mt-2 space-y-1 text-sm text-amber-900">
                {detail.blocking.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </div>
          )}

          {/* GMO-4 — what actually happened to the workspace, said plainly either way. */}
          {detail.application.activated_tenant_id ? (
            <p className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900" data-testid="workspace-activated">
              The garage workspace exists. The applicant is its administrator and can open it from
              their account.
            </p>
          ) : activation && !activation.activated ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4" data-testid="activation-failed">
              <p className="font-medium text-amber-900">
                Your decision was recorded, but the workspace was not created.
              </p>
              <p className="text-sm text-amber-900 mt-1">
                The approval stands — you do not need to decide again. {activation.reason}
              </p>
              <Button
                variant="outline" className="min-h-11 mt-3" data-testid="retry-activation"
                onClick={retryActivation} disabled={busy === 'activate'}
              >
                {busy === 'activate' ? 'Creating…' : 'Create the workspace'}
              </Button>
            </div>
          ) : null}

          {pendingStepUp && (
            <StepUpPrompt
              reason={pendingStepUp.reason}
              onConfirmed={() => { const again = pendingStepUp.retry; setPendingStepUp(null); void again() }}
              onCancel={() => setPendingStepUp(null)}
            />
          )}

          {detail.allowed_decisions.length > 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3" data-testid="decision-panel">
              <h2 className="font-medium text-gray-900">Your decision</h2>
              <div>
                <label htmlFor="decision-reason" className="block text-sm font-medium text-gray-700 mb-1">
                  Reason <span className="text-gray-500">(required to ask for more, or to not approve)</span>
                </label>
                <textarea
                  id="decision-reason" data-testid="decision-reason" rows={3}
                  value={reason} onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="The applicant sees this. Say what would change the outcome."
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {detail.allowed_decisions.map((d) => {
                  const blockedByReason = NEEDS_REASON.has(d) && !reason.trim()
                  const blockedByFacts = d === 'approve' && detail.blocking.length > 0
                  return (
                    <Button
                      key={d} data-testid={`decision-${d}`}
                      variant={d === 'approve' ? 'default' : 'outline'}
                      className={`min-h-11 ${d === 'approve' ? 'bg-orange-500 hover:bg-orange-600' : ''}`}
                      disabled={busy !== null || blockedByReason || blockedByFacts}
                      onClick={() => decide(d)}
                    >
                      {busy === d ? 'Recording…' : DECISION_LABEL[d] ?? d}
                    </Button>
                  )
                })}
              </div>
              <p className="text-xs text-gray-500">
                Approving records your decision. It does not verify the business, and the workspace is
                created separately.
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-600 rounded-xl border border-gray-200 bg-white p-5" data-testid="no-decisions">
              {detail.application.status === 'information_required'
                ? 'This is with the applicant. It comes back to you when they send it again.'
                : 'This application is closed. There is nothing further to decide.'}
            </p>
          )}

          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert" data-testid="decision-error">
              {error}
            </p>
          )}

          <div className="rounded-xl border border-gray-200 bg-white p-5" data-testid="decision-history">
            <h2 className="font-medium text-gray-900">History</h2>
            {detail.decisions.length === 0 ? (
              <p className="text-sm text-gray-600 mt-2">No decisions have been recorded yet.</p>
            ) : (
              <ol className="mt-3 space-y-2">
                {detail.decisions.map((d) => (
                  <li key={d.id} className="text-sm border-b last:border-0 pb-2" data-testid="history-item">
                    <span className="font-medium text-gray-900">{DECISION_LABEL[d.decision] ?? d.decision}</span>
                    <span className="text-gray-500"> · {new Date(d.created_at).toLocaleString()}</span>
                    {d.reason && <p className="text-gray-700 mt-0.5">{d.reason}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </div>
  )
}
