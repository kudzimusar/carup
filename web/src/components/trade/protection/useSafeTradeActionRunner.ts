/**
 * RX-06 Protection — one runner for SafeTrade lifecycle actions, shared by the case's "Next move", its
 * phone bar and its full action list so a step can never be submitted twice from two places.
 *
 * Same behaviour as the shared SafeTradeActions component: a duplicate-submit guard, a fresh idempotency
 * key per submission, a confirmation for actions the server marks `confirmationRequired`, the release
 * evaluation captured for approve-release, the receipt wording, errors classified by message
 * (classifyActionError), then the page's own reload.
 */
import { useRef, useState } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { classifyActionError } from '@/components/diaspora/safetrade/safeTradeHelpers'
import type { SafeTradeAvailableAction } from '@/types'
import { submitSafeTradeAction, submittedText } from './safeTradeDesk'

export interface SafeTradeActionRunner {
  pending: string | null
  confirm: SafeTradeAvailableAction | null
  setConfirm: (action: SafeTradeAvailableAction | null) => void
  result: string | null
  error: string | null
  evaluationId: string | null
  /** Ask first when the server requires confirmation; otherwise submit. Never runs a refused action. */
  start: (action: SafeTradeAvailableAction) => void
  submit: (action: SafeTradeAvailableAction) => Promise<void>
}

export function useSafeTradeActionRunner(transactionId: string, onDone: () => void | Promise<void>): SafeTradeActionRunner {
  const api = useCarUpApi()
  const [pending, setPending] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<SafeTradeAvailableAction | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [evaluationId, setEvaluationId] = useState<string | null>(null)
  const inFlight = useRef(false)

  async function submit(action: SafeTradeAvailableAction) {
    if (inFlight.current || !action.permitted) return
    inFlight.current = true
    setPending(action.actionKey)
    setResult(null)
    setError(null)
    try {
      const out = await submitSafeTradeAction(api, transactionId, action, { evaluationId })
      if (out.verdict) {
        // RX06-LR03 (TF-03): report the server's verdict; only a passing evaluation unlocks approval.
        setEvaluationId(out.verdict.eligible ? out.evaluationId : null)
        setResult(out.verdict.eligible
          ? 'Release evaluation passed (sandbox simulation; no real funds). Approval can now be requested.'
          : `Release evaluation did not pass${out.verdict.blockers.length ? `: ${out.verdict.blockers.slice(0, 3).join('; ')}` : ''}. Approval stays blocked.`)
      } else {
        if (out.evaluationId) setEvaluationId(out.evaluationId)
        setResult(submittedText(action))
      }
      await onDone()
    } catch (err) {
      setError(classifyActionError(err).message)
    } finally {
      inFlight.current = false
      setPending(null)
      setConfirm(null)
    }
  }

  function start(action: SafeTradeAvailableAction) {
    if (!action.permitted || inFlight.current) return
    if (action.confirmationRequired) setConfirm(action)
    else void submit(action)
  }

  return { pending, confirm, setConfirm, result, error, evaluationId, start, submit }
}
