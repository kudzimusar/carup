/**
 * RX-06 Protection — disputes on a SafeTrade case: the list, each dispute's evidence, raising a dispute,
 * adding a statement and (reviewers only) resolving one — the same calls the shared SafeTradeDisputes
 * component makes, gated by the same server-returned permissions.
 *
 * PRIVACY: evidence is the server-redacted list, passed through visibleEvidence() as defence in depth
 * (fail closed). Only safe fields are shown. An evidence list that could not be read says so — it is
 * never presented as "no evidence".
 */
import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { WS_DANGER, WS_FIELD, WS_HINT, WS_LABEL, WS_PRIMARY, WS_SECONDARY } from '@/components/dealer/workspace/workspaceStyles'
import {
  classifyActionError, disputeCategoryLabel, disputeStatusLabel, isActiveDispute, visibleEvidence,
} from '@/components/diaspora/safetrade/safeTradeHelpers'
import type { SafeTradeAvailableAction, SafeTradeDispute, SafeTradeDisputeEvidence } from '@/types'
import { DeskState, InlineConfirm } from '@/components/trade/sourcing/TradeDesk'
import { formatDay, humanizeCode } from '@/components/trade/sourcing/deskKit'
import { blockedBecause, newIdempotencyKey } from './safeTradeDesk'

const CATEGORIES: ReadonlyArray<[string, string]> = [
  ['NOT_AS_DESCRIBED', 'Item not as described'],
  ['NOT_RECEIVED', 'Not received'],
  ['DOCUMENT_ISSUE', 'Document issue'],
  ['PAYMENT_ISSUE', 'Payment issue'],
  ['OTHER', 'Other'],
]
const RESOLUTIONS: ReadonlyArray<[string, string]> = [
  ['UPHOLD_BUYER', 'Refund buyer (sandbox)'],
  ['UPHOLD_SELLER', 'Release to seller (sandbox)'],
  ['CANCEL', 'Cancel transaction'],
  ['REJECT', 'Reject dispute'],
]

type EvidenceRead = { phase: 'ready'; items: SafeTradeDisputeEvidence[] } | { phase: 'failed' }

function actionOf(actions: SafeTradeAvailableAction[], key: string) {
  return actions.find((a) => a.actionKey === key) ?? null
}

export function SafeTradeDisputeDesk({ transactionId, disputes, actions, viewerId, isReviewer, unreadable, onDone }: {
  transactionId: string
  disputes: SafeTradeDispute[]
  actions: SafeTradeAvailableAction[]
  viewerId: string | null
  isReviewer: boolean
  unreadable: boolean
  onDone: () => void | Promise<void>
}) {
  const { getSafeTradeDisputeEvidence, openSafeTradeDispute, addSafeTradeDisputeEvidence, resolveSafeTradeDispute } = useCarUpApi()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)
  const [category, setCategory] = useState('NOT_AS_DESCRIBED')
  const [reason, setReason] = useState('')
  const [statements, setStatements] = useState<Record<string, string>>({})
  const [resolutions, setResolutions] = useState<Record<string, string>>({})
  const [resolving, setResolving] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<Record<string, EvidenceRead>>({})
  const [tick, setTick] = useState(0)
  const liveRef = useRef<HTMLDivElement | null>(null)
  const id = useId()

  const openAction = actionOf(actions, 'open-dispute')
  const canOpen = Boolean(openAction?.permitted)
  const canAddEvidence = Boolean(actionOf(actions, 'add-evidence')?.permitted)
  const canResolve = Boolean(actionOf(actions, 'resolve-dispute')?.permitted)

  // The server-redacted evidence for each dispute; re-read after this desk's own changes (tick).
  const disputeIds = disputes.map((d) => d.id).join(',')
  useEffect(() => {
    let active = true
    const ids = disputeIds ? disputeIds.split(',') : []
    Promise.all(ids.map((disputeId) =>
      getSafeTradeDisputeEvidence(disputeId)
        .then((items): [string, EvidenceRead] => [disputeId, { phase: 'ready', items }])
        .catch((): [string, EvidenceRead] => [disputeId, { phase: 'failed' }]),
    )).then((entries) => { if (active) setEvidence(Object.fromEntries(entries)) })
    return () => { active = false }
  }, [disputeIds, tick, getSafeTradeDisputeEvidence])

  async function run(fn: () => Promise<unknown>, success: string) {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      await fn()
      setMessage({ tone: 'info', text: success })
      setTick((t) => t + 1)
      await onDone()
      return true
    } catch (err) {
      setMessage({ tone: 'danger', text: classifyActionError(err).message })
      return false
    } finally {
      setBusy(false)
      liveRef.current?.focus()
    }
  }

  return (
    <div className="space-y-4" data-testid="trade-safetrade-disputes">
      <div ref={liveRef} tabIndex={-1} aria-live="polite" className="empty:hidden focus-visible:outline-none">
        {message && <p role={message.tone === 'info' ? 'status' : 'alert'} className={cn('rounded-control border px-3 py-2.5 text-sm text-carup-text', message.tone === 'info' ? 'border-status-info bg-status-info-soft' : 'border-status-danger bg-status-danger-soft')} data-testid="trade-safetrade-disputes-message">{message.text}</p>}
      </div>

      {canOpen ? (
        <section aria-labelledby={`${id}-open-h`} className="rounded-card border border-carup-line bg-carup-bg-raised p-4" data-testid="trade-safetrade-dispute-open">
          <h3 id={`${id}-open-h`} className="text-sm font-semibold text-carup-text">Raise a dispute</h3>
          <p className="mt-1 text-xs leading-5 text-carup-text-2">A CarUp reviewer assesses it. While it is open, the server blocks the steps it affects.</p>
          <form noValidate className="mt-3 space-y-3" onSubmit={(e) => {
            e.preventDefault()
            void run(() => openSafeTradeDispute(transactionId, { category, reason: reason.trim(), idempotencyKey: newIdempotencyKey() }), 'Dispute raised. A reviewer will assess it.')
              .then((ok) => { if (ok) setReason('') })
          }}>
            <div className="grid gap-3 sm:grid-cols-[16rem_minmax(0,1fr)]">
              <div className="min-w-0">
                <label htmlFor={`${id}-cat`} className={WS_LABEL}>Category</label>
                <select id={`${id}-cat`} className={WS_FIELD} value={category} onChange={(e) => setCategory(e.target.value)} data-testid="trade-safetrade-dispute-category">
                  {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className="min-w-0">
                <label htmlFor={`${id}-reason`} className={WS_LABEL}>What happened?</label>
                <textarea id={`${id}-reason`} className={cn(WS_FIELD, 'min-h-24')} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="trade-safetrade-dispute-reason" />
                <p className={WS_HINT}>At least 4 characters · {reason.length}/2000</p>
              </div>
            </div>
            <button type="submit" className={WS_PRIMARY} disabled={busy || reason.trim().length < 4} data-testid="trade-safetrade-dispute-submit">
              {busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}Raise dispute
            </button>
          </form>
        </section>
      ) : openAction ? (
        <p className="rounded-control border border-carup-line bg-carup-bg-surface px-3 py-2.5 text-sm text-carup-text-2" data-testid="trade-safetrade-dispute-open-blocked">
          <span className="font-semibold text-carup-text">Raising a dispute is not available: </span>{blockedBecause(openAction)}
        </p>
      ) : null}

      {unreadable ? (
        <DeskState kind="failed" title="Dispute information could not be loaded" testId="trade-safetrade-disputes-unreadable">
          This is not confirmation that this case has no open dispute.
        </DeskState>
      ) : disputes.length === 0 ? (
        <DeskState kind="empty" title="No disputes have been raised for this case" testId="trade-safetrade-disputes-empty">
          {canOpen ? 'If something is wrong, raise one above — a CarUp reviewer assesses it.' : 'A participant can raise one when the server allows it at this stage.'}
        </DeskState>
      ) : (
        <ul className="space-y-3" data-testid="trade-safetrade-dispute-list">
          {disputes.map((d) => {
            const read = evidence[d.id]
            const shown = read?.phase === 'ready' ? visibleEvidence(read.items, { id: viewerId, isReviewer }) : []
            const open = String(d.status).toUpperCase() !== 'RESOLVED'
            return (
              <li key={d.id} className="rounded-card border border-carup-line bg-carup-bg-raised p-4" data-testid={`trade-safetrade-dispute-${d.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-carup-text">{disputeCategoryLabel(d.category)}</p>
                    <p className="mt-0.5 text-xs text-carup-text-3">
                      Raised {d.raised_by_role ? `by the ${humanizeCode(d.raised_by_role).toLowerCase()}` : ''} {formatDay(d.created_at ?? null) ? `on ${formatDay(d.created_at ?? null)}` : '(date not recorded)'}
                    </p>
                  </div>
                  <StatusChip tone={isActiveDispute(d) ? 'warning' : 'neutral'} testId={`trade-safetrade-dispute-${d.id}-status`}>{disputeStatusLabel(d.status)}</StatusChip>
                </div>
                {d.hold_placed && <p className="mt-2 rounded-control bg-status-warning-soft px-3 py-2 text-xs text-carup-text">A payment hold is in place while this dispute is open (sandbox).</p>}
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-carup-text-2 [overflow-wrap:anywhere]">{(d.reason || '').slice(0, 2000)}</p>
                {d.resolution && <p className="mt-2 text-xs text-carup-text-2">Resolution recorded: <span className="font-semibold text-carup-text">{humanizeCode(d.resolution)}</span>{d.resolved_at ? ` · ${formatDay(d.resolved_at)}` : ''}</p>}

                <div className="mt-3 border-t border-carup-line pt-3">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-carup-text-3">Evidence</h4>
                  {!read ? (
                    <p className="mt-1 text-xs text-carup-text-3">Loading evidence…</p>
                  ) : read.phase === 'failed' ? (
                    <p className="mt-1 text-xs font-medium text-status-warning" data-testid={`trade-safetrade-dispute-${d.id}-evidence-failed`}>Evidence could not be loaded. This is not a report that there is none.</p>
                  ) : shown.length === 0 ? (
                    <p className="mt-1 text-xs text-carup-text-3">No evidence is visible to you.</p>
                  ) : (
                    <ul className="mt-1 space-y-1.5" data-testid={`trade-safetrade-dispute-${d.id}-evidence`}>
                      {shown.map((ev) => (
                        <li key={ev.id} className="text-xs leading-5 text-carup-text-2">
                          <span className="font-semibold text-carup-text">{ev.author_role ? humanizeCode(ev.author_role) : 'Participant'}</span> · {humanizeCode(ev.evidence_type)}
                          {ev.statement ? <> — {String(ev.statement).slice(0, 1000)}</> : null}
                          {ev.created_at ? <span className="text-carup-text-3"> ({formatDay(ev.created_at)})</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {canAddEvidence && open && (
                  <form noValidate className="mt-3 space-y-2" onSubmit={(e) => {
                    e.preventDefault()
                    const text = (statements[d.id] || '').trim()
                    void run(() => addSafeTradeDisputeEvidence(d.id, { statement: text, visibility: 'PARTICIPANTS', idempotencyKey: newIdempotencyKey() }), 'Statement added.')
                      .then((ok) => { if (ok) setStatements((s) => ({ ...s, [d.id]: '' })) })
                  }}>
                    <label htmlFor={`${id}-${d.id}-ev`} className={WS_LABEL}>Add a statement <span className="font-normal text-carup-text-3">· visible to the case participants</span></label>
                    <textarea id={`${id}-${d.id}-ev`} className={cn(WS_FIELD, 'min-h-20')} maxLength={1000} value={statements[d.id] || ''} onChange={(e) => setStatements((s) => ({ ...s, [d.id]: e.target.value }))} data-testid={`trade-safetrade-dispute-${d.id}-statement`} />
                    <button type="submit" className={WS_SECONDARY} disabled={busy || !(statements[d.id] || '').trim()} data-testid={`trade-safetrade-dispute-${d.id}-statement-submit`}>Submit statement</button>
                  </form>
                )}

                {canResolve && isReviewer && open && (
                  <div className="mt-3 rounded-control border border-status-warning bg-status-warning-soft p-3" data-testid={`trade-safetrade-dispute-${d.id}-resolve`}>
                    <h4 className="flex items-center gap-1.5 text-sm font-semibold text-carup-text"><ShieldAlert className="h-4 w-4 text-status-warning" aria-hidden="true" />Reviewer resolution (sandbox)</h4>
                    {resolving === d.id ? (
                      <div className="mt-2">
                        <InlineConfirm
                          tone="danger"
                          title={`Resolve as “${RESOLUTIONS.find(([v]) => v === (resolutions[d.id] || 'UPHOLD_BUYER'))?.[1]}”?`}
                          confirm={<button type="button" className={WS_DANGER} disabled={busy} onClick={() => void run(() => resolveSafeTradeDispute(d.id, { resolution: resolutions[d.id] || 'UPHOLD_BUYER', idempotencyKey: newIdempotencyKey() }), 'Dispute resolved (sandbox).').then(() => setResolving(null))} data-testid={`trade-safetrade-dispute-${d.id}-resolve-confirm`}>{busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}Resolve</button>}
                          cancel={<button type="button" className={WS_SECONDARY} disabled={busy} onClick={() => setResolving(null)}>Back</button>}
                        >
                          This records your decision on the case. Any refund or release it triggers is a sandbox simulation — no real funds move.
                        </InlineConfirm>
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
                        <div className="min-w-0 sm:w-72">
                          <label htmlFor={`${id}-${d.id}-res`} className={WS_LABEL}>Resolution</label>
                          <select id={`${id}-${d.id}-res`} className={WS_FIELD} value={resolutions[d.id] || 'UPHOLD_BUYER'} onChange={(e) => setResolutions((s) => ({ ...s, [d.id]: e.target.value }))}>
                            {RESOLUTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                        </div>
                        <button type="button" className={WS_DANGER} disabled={busy} onClick={() => setResolving(d.id)} data-testid={`trade-safetrade-dispute-${d.id}-resolve-submit`}>Resolve…</button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
