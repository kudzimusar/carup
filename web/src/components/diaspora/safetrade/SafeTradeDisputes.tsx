/**
 * SafeTradeDisputes — dispute list, evidence timeline, evidence submission and (reviewer-only)
 * resolution. PRIVACY: evidence is filtered through visibleEvidence() so a participant never sees
 * REVIEWERS_ONLY / another author's AUTHOR_ONLY evidence; only safe fields are rendered (type, role,
 * statement, date) — never storage paths, raw internal ids or private PII. All action availability
 * comes from the server-derived available-actions; the backend stays authoritative.
 */
import { useRef, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { disputeCategoryLabel, disputeStatusLabel, visibleEvidence } from './safeTradeHelpers'
import type { SafeTradeAvailableAction, SafeTradeDispute, SafeTradeDisputeEvidence } from '@/types'

export interface SafeTradeDisputesProps {
  transactionId: string
  disputes: SafeTradeDispute[]
  actions: SafeTradeAvailableAction[]
  viewerId?: string | null
  isReviewer?: boolean
  onDone: () => void | Promise<void>
  testId?: string
}

function actionPermitted(actions: SafeTradeAvailableAction[], key: string): boolean {
  return actions.some((a) => a.actionKey === key && a.permitted)
}
function newId(): string {
  try { return (globalThis.crypto as Crypto)?.randomUUID?.() || `idem-${Date.now()}` } catch { return `idem-${Date.now()}` }
}

export function SafeTradeDisputes({ transactionId, disputes, actions, viewerId = null, isReviewer = false, onDone, testId = 'safetrade-disputes' }: SafeTradeDisputesProps) {
  const api = useCarUpApi()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [openCategory, setOpenCategory] = useState('NOT_AS_DESCRIBED')
  const [openReason, setOpenReason] = useState('')
  const [evidenceText, setEvidenceText] = useState<Record<string, string>>({})
  const [resolution, setResolution] = useState<Record<string, string>>({})
  const liveRef = useRef<HTMLParagraphElement>(null)

  const canOpen = actionPermitted(actions, 'open-dispute')
  const canAddEvidence = actionPermitted(actions, 'add-evidence')
  const canResolve = actionPermitted(actions, 'resolve-dispute')

  async function run(fn: () => Promise<unknown>, success: string) {
    if (busy) return
    setBusy(true); setMsg(null)
    try { await fn(); setMsg(success); await onDone() }
    catch (e) {
      const code = (e as { code?: string })?.code
      setMsg(code === 'INSUFFICIENT_PERMISSIONS' ? 'You are not authorized to perform this action.' : 'The action could not be completed. Please try again.')
    } finally { setBusy(false); if (liveRef.current) liveRef.current.focus() }
  }

  return (
    <Card data-testid={testId} aria-label="SafeTrade disputes">
      <CardHeader className="pb-3"><CardTitle className="text-base">Disputes</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p ref={liveRef} tabIndex={-1} role="status" aria-live="polite" className="text-sm text-slate-700" data-testid={`${testId}-status`}>{msg}</p>

        {canOpen && (
          <section aria-labelledby={`${testId}-open-h`} className="rounded-md border border-slate-200 p-3">
            <h3 id={`${testId}-open-h`} className="mb-2 text-sm font-medium">Raise a dispute</h3>
            <div className="space-y-2">
              <Label htmlFor={`${testId}-cat`}>Category</Label>
              <select id={`${testId}-cat`} className="w-full rounded border border-slate-300 p-2 text-sm" value={openCategory} onChange={(e) => setOpenCategory(e.target.value)}>
                <option value="NOT_AS_DESCRIBED">Item not as described</option>
                <option value="NOT_RECEIVED">Not received</option>
                <option value="DOCUMENT_ISSUE">Document issue</option>
                <option value="PAYMENT_ISSUE">Payment issue</option>
                <option value="OTHER">Other</option>
              </select>
              <Label htmlFor={`${testId}-reason`}>What happened?</Label>
              <Textarea id={`${testId}-reason`} maxLength={2000} value={openReason} onChange={(e) => setOpenReason(e.target.value)} data-testid={`${testId}-open-reason`} />
              <Button type="button" disabled={busy || openReason.trim().length < 4} data-testid={`${testId}-open-submit`}
                onClick={() => run(() => api.openSafeTradeDispute(transactionId, { category: openCategory, reason: openReason.trim(), idempotencyKey: newId() }), 'Dispute raised. A reviewer will assess it.')}>
                Raise dispute
              </Button>
            </div>
          </section>
        )}

        {disputes.length === 0 ? (
          <p className="text-sm text-slate-600" data-testid={`${testId}-empty`}>No disputes have been raised for this case.</p>
        ) : (
          <ul className="space-y-3" data-testid={`${testId}-list`}>
            {disputes.map((d) => {
              const evidence = visibleEvidence(((d as { evidence?: SafeTradeDisputeEvidence[] }).evidence) || [], { id: viewerId, isReviewer })
              return (
                <li key={d.id} className="rounded-md border border-slate-200 p-3" data-testid={`${testId}-dispute-${d.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{disputeCategoryLabel(d.category)}</span>
                    <Badge variant={d.status === 'RESOLVED' ? 'default' : 'secondary'} data-testid={`${testId}-${d.id}-status`}>{disputeStatusLabel(d.status)}</Badge>
                  </div>
                  {d.hold_placed ? <p className="mt-1 text-xs text-amber-800">A payment hold is in place while this dispute is open (sandbox).</p> : null}
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{(d.reason || '').slice(0, 2000)}</p>

                  <Separator className="my-2" />
                  <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Evidence</h4>
                  {evidence.length === 0 ? <p className="text-xs text-slate-500">No evidence is visible to you.</p> : (
                    <ul className="space-y-1" data-testid={`${testId}-${d.id}-evidence`}>
                      {evidence.map((ev) => (
                        <li key={ev.id} className="text-xs text-slate-600">
                          <span className="font-medium">{ev.author_role || 'Participant'}</span>{' · '}{ev.evidence_type}
                          {ev.statement ? <span> — {String(ev.statement).slice(0, 1000)}</span> : null}
                          {ev.created_at ? <span className="text-slate-400"> ({new Date(ev.created_at).toLocaleDateString()})</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}

                  {canAddEvidence && d.status !== 'RESOLVED' && (
                    <div className="mt-2 space-y-1">
                      <Label htmlFor={`${testId}-${d.id}-ev`}>Add a statement</Label>
                      <Textarea id={`${testId}-${d.id}-ev`} maxLength={1000} value={evidenceText[d.id] || ''} onChange={(e) => setEvidenceText((s) => ({ ...s, [d.id]: e.target.value }))} data-testid={`${testId}-${d.id}-ev-input`} />
                      <Button type="button" size="sm" disabled={busy || !(evidenceText[d.id] || '').trim()} data-testid={`${testId}-${d.id}-ev-submit`}
                        onClick={() => run(() => api.addSafeTradeDisputeEvidence(d.id, { statement: (evidenceText[d.id] || '').trim(), visibility: 'PARTICIPANTS', idempotencyKey: newId() }), 'Statement added.')}>
                        Submit statement
                      </Button>
                    </div>
                  )}

                  {canResolve && isReviewer && d.status !== 'RESOLVED' && (
                    <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2" data-testid={`${testId}-${d.id}-resolve`}>
                      <h4 className="mb-1 flex items-center gap-1 text-xs font-medium text-amber-900"><ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" /> Reviewer resolution (sandbox)</h4>
                      <Label htmlFor={`${testId}-${d.id}-res`}>Resolution</Label>
                      <select id={`${testId}-${d.id}-res`} className="mb-1 w-full rounded border border-slate-300 p-2 text-sm" value={resolution[d.id] || 'UPHOLD_BUYER'} onChange={(e) => setResolution((s) => ({ ...s, [d.id]: e.target.value }))}>
                        <option value="UPHOLD_BUYER">Refund buyer (sandbox)</option>
                        <option value="UPHOLD_SELLER">Release to seller (sandbox)</option>
                        <option value="CANCEL">Cancel transaction</option>
                        <option value="REJECT">Reject dispute</option>
                      </select>
                      <Button type="button" size="sm" variant="destructive" disabled={busy} data-testid={`${testId}-${d.id}-resolve-submit`}
                        onClick={() => run(() => api.resolveSafeTradeDispute(d.id, { resolution: resolution[d.id] || 'UPHOLD_BUYER', idempotencyKey: newId() }), 'Dispute resolved (sandbox).')}>
                        Resolve
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
