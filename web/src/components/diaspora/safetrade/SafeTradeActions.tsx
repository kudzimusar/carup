/**
 * SafeTradeActions — renders action controls ONLY from the server-derived available-actions
 * (GET /:id/available-actions). It never duplicates the 16-state transition table: a control exists
 * only if the projection returned that action, is enabled only when `permitted`, and otherwise shows
 * the human-readable disabled reason. The backend remains authoritative on submit (a hidden/enabled
 * button is convenience, not security).
 *
 * Dispute actions (open/add-evidence/resolve) are handled in SafeTradeDisputes. Money release flows
 * through evaluate-release -> approve-release (sandbox only). No control here ever states that CarUp
 * holds or releases real funds.
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { actionLabel, classifyActionError, disabledReasonLabel, partitionActions } from './safeTradeHelpers'
import { SAFETRADE_SANDBOX_LABEL } from '@/config/safeTradeFlag'
import type { SafeTradeAvailableAction, SafeTradeCommitEvent } from '@/types'

export interface SafeTradeActionsProps {
  transactionId: string
  actions: SafeTradeAvailableAction[]
  /** Most recent passing release evaluation id (required to approve a release). */
  latestEvaluationId?: string | null
  onDone: () => void | Promise<void>
  testId?: string
}

// Commit-style actions map to the allowlisted SafeTradeCommitEvent (kebab -> UPPER_SNAKE).
const COMMIT_KEYS = new Set([
  'run-eligibility', 'buyer-commit', 'seller-commit', 'request-payment', 'hold-payment',
  'attach-documents', 'submit-compliance', 'compliance-pass', 'compliance-fail',
  'begin-shipment', 'mark-arrived', 'await-delivery', 'confirm-delivery', 'suspend', 'resume',
])
const DEDICATED_KEYS = new Set(['evaluate-release', 'request-release', 'approve-release', 'cancel'])
const DISPUTE_KEYS = new Set(['open-dispute', 'add-evidence', 'resolve-dispute'])
const SANDBOX_MONEY_KEYS = new Set(['hold-payment', 'request-payment', 'request-release', 'approve-release', 'evaluate-release'])

function eventForKey(key: string): SafeTradeCommitEvent {
  return key.toUpperCase().replace(/-/g, '_') as SafeTradeCommitEvent
}
function newIdempotencyKey(): string {
  try { return (globalThis.crypto as Crypto)?.randomUUID?.() || `idem-${Date.now()}-${Math.round(Math.random() * 1e9)}` }
  catch { return `idem-${Date.now()}` }
}

export function SafeTradeActions({ transactionId, actions, latestEvaluationId = null, onDone, testId = 'safetrade-actions' }: SafeTradeActionsProps) {
  const api = useCarUpApi()
  const [pending, setPending] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<SafeTradeAvailableAction | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The passing evaluation needed to approve a sandbox release. Provided by the parent if known, and
  // captured here from evaluate-release's own response so the reviewer's evaluate -> approve flow can
  // complete in one session without depending on a separate fetch path.
  const [capturedEvaluationId, setCapturedEvaluationId] = useState<string | null>(null)
  const evaluationId = capturedEvaluationId || latestEvaluationId
  const liveRef = useRef<HTMLParagraphElement>(null)

  // Only render lifecycle actions we can submit; disputes render in SafeTradeDisputes.
  const renderable = actions.filter((a) => (COMMIT_KEYS.has(a.actionKey) || DEDICATED_KEYS.has(a.actionKey)) && !DISPUTE_KEYS.has(a.actionKey))
  const { participant, reviewer } = partitionActions(renderable)

  useEffect(() => { if ((result || error) && liveRef.current) liveRef.current.focus() }, [result, error])

  async function submit(action: SafeTradeAvailableAction) {
    if (pending) return // duplicate-submit guard
    setPending(action.actionKey)
    setResult(null)
    setError(null)
    const idempotencyKey = newIdempotencyKey()
    try {
      switch (action.actionKey) {
        case 'evaluate-release': {
          const resp = await api.evaluateSafeTradeRelease(transactionId, {})
          // Capture the recorded evaluation so the subsequent approve-release can reference it.
          if (resp?.evaluation?.id) setCapturedEvaluationId(resp.evaluation.id)
          break
        }
        case 'request-release': await api.requestSafeTradeRelease(transactionId, { idempotencyKey }); break
        case 'approve-release':
          await api.approveSafeTradeRelease(transactionId, { evaluationId: evaluationId || undefined, idempotencyKey }); break
        case 'cancel': await api.cancelSafeTrade(transactionId, { idempotencyKey }); break
        default: await api.commitSafeTrade(transactionId, { event: eventForKey(action.actionKey), idempotencyKey })
      }
      setResult(`${actionLabel(action)} submitted${action.sandboxOnly ? ' — sandbox simulation only; no real funds moved.' : '.'}`)
      await onDone()
    } catch (err) {
      // apiClient throws message-only Errors; classify by message content (never by a non-existent
      // `.code`) so the user sees the right reason (external-activation / permission / conflict).
      setError(classifyActionError(err).message)
    } finally {
      setPending(null)
      setConfirm(null)
    }
  }

  function renderButtons(list: SafeTradeAvailableAction[], group: string) {
    return (
      <div className="flex flex-wrap gap-2" data-testid={`${testId}-${group}`}>
        {list.map((a) => {
          const disabled = !a.permitted || Boolean(pending)
          const reason = !a.permitted ? disabledReasonLabel(a.disabledReasonCode) : null
          return (
            <Button
              key={a.actionKey}
              type="button"
              variant={group === 'reviewer' ? 'destructive' : 'default'}
              disabled={disabled}
              aria-disabled={disabled}
              title={reason || undefined}
              data-testid={`${testId}-action-${a.actionKey}`}
              data-permitted={a.permitted}
              data-disabled-reason={a.disabledReasonCode || ''}
              onClick={() => (a.confirmationRequired ? setConfirm(a) : void submit(a))}
            >
              {pending === a.actionKey && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              {actionLabel(a)}
              {!a.permitted && reason ? <span className="ml-1 text-xs opacity-80">— {reason}</span> : null}
            </Button>
          )
        })}
      </div>
    )
  }

  if (renderable.length === 0) {
    return (
      <Card data-testid={`${testId}-empty`}>
        <CardContent className="py-4 text-sm text-slate-600">No actions are available to you in the current state.</CardContent>
      </Card>
    )
  }

  return (
    <Card data-testid={testId} aria-label="SafeTrade actions">
      <CardHeader className="pb-3"><CardTitle className="text-base">Actions</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p ref={liveRef} tabIndex={-1} role="status" aria-live="polite" className="text-sm">
          {error ? <span className="text-red-700" data-testid={`${testId}-error`}>{error}</span>
            : result ? <span className="text-emerald-700" data-testid={`${testId}-result`}>{result}</span> : null}
        </p>

        {participant.length > 0 && (
          <section aria-labelledby={`${testId}-participant-h`}>
            <h3 id={`${testId}-participant-h`} className="mb-2 text-sm font-medium text-slate-700">Participant actions</h3>
            {renderButtons(participant, 'participant')}
          </section>
        )}

        {reviewer.length > 0 && (
          <section aria-labelledby={`${testId}-reviewer-h`} className="rounded-md border border-amber-300 bg-amber-50 p-3" data-testid={`${testId}-reviewer-section`}>
            <h3 id={`${testId}-reviewer-h`} className="mb-1 flex items-center gap-1 text-sm font-medium text-amber-900">
              <ShieldAlert className="h-4 w-4" aria-hidden="true" /> Reviewer / admin actions
            </h3>
            <p className="mb-2 text-xs text-amber-800">
              High-risk: these decisions affect the assurance outcome. Release is a sandbox simulation only — no real funds move.
            </p>
            {renderButtons(reviewer, 'reviewer')}
          </section>
        )}

        <AlertDialog open={Boolean(confirm)} onOpenChange={(o) => { if (!o) setConfirm(null) }}>
          <AlertDialogContent data-testid={`${testId}-confirm`}>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm: {confirm ? actionLabel(confirm) : ''}</AlertDialogTitle>
              <AlertDialogDescription>
                {confirm && SANDBOX_MONEY_KEYS.has(confirm.actionKey)
                  ? `${SAFETRADE_SANDBOX_LABEL} This records an assurance/payment-state simulation. CarUp does not hold or release real funds.`
                  : 'This submits the action to the SafeTrade workflow. The backend remains authoritative.'}
                {confirm?.actionKey === 'approve-release' && !evaluationId
                  ? ' A passing release evaluation is required first.' : ''}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid={`${testId}-confirm-cancel`}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                data-testid={`${testId}-confirm-submit`}
                disabled={Boolean(pending) || (confirm?.actionKey === 'approve-release' && !evaluationId)}
                onClick={() => confirm && void submit(confirm)}
              >
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
