import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ShieldCheck, Loader2 } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

/**
 * Re-prove your password before a sensitive action.
 *
 * The backend has required this since O2-X3 — `requireAuthenticationAssurance(SENSITIVE)` guards
 * reviewer decisions, private-evidence previews and identity lifecycle changes — and **no surface
 * in the product ever offered it**. A reviewer could open a decision page, press Approve, and get
 * `STEP_UP_REQUIRED` back with nothing anywhere able to satisfy it. The route was governed and
 * unreachable at the same time, which is a gate that protects nothing because nobody can pass it.
 *
 * Found while trying to walk the GMO-3 reviewer journey in a real browser. Every earlier check
 * passed because they exercised the service with a session the test had already stamped.
 *
 * It asks for a password and nothing else: the endpoint verifies the credential server-side against
 * the stored hash, and the only thing that ever leaves this component is what the person typed.
 */
export default function StepUpPrompt({
  reason, onConfirmed, onCancel,
}: {
  /** What the person is about to do, in their words. Never a code. */
  reason: string
  onConfirmed: () => void
  onCancel: () => void
}) {
  const { stepUp } = useCarUpApi()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await stepUp(password)
      setPassword('')
      onConfirmed()
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      setError(
        /STEP_UP_CREDENTIAL_INVALID|verification failed/i.test(message)
          ? 'That password was not correct.'
          // A rate limit or an outage is not a wrong password, and telling someone their own
          // password is wrong when it is not is how they end up resetting an account needlessly.
          : `We could not confirm it just now: ${message || 'please try again.'}`,
      )
    } finally { setBusy(false) }
  }

  return (
    <form
      onSubmit={confirm}
      className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-3"
      data-testid="step-up-prompt"
    >
      <p className="font-medium text-amber-900 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4" aria-hidden="true" /> Confirm it is you
      </p>
      <p className="text-sm text-amber-900">{reason}</p>

      <div>
        <label htmlFor="step-up-password" className="block text-sm font-medium text-amber-900 mb-1">
          Your password
        </label>
        <input
          id="step-up-password" data-testid="step-up-password" type="password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm min-h-[44px] bg-white"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit" className="min-h-11 bg-orange-500 hover:bg-orange-600"
          disabled={busy || !password} data-testid="step-up-confirm"
        >
          {busy ? <><Loader2 className="w-4 h-4 mr-1 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Confirming…</> : 'Confirm'}
        </Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={onCancel} data-testid="step-up-cancel">
          Cancel
        </Button>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert" data-testid="step-up-error">
          {error}
        </p>
      )}
    </form>
  )
}

/** Does this failure mean "prove it is you again"? */
export function isStepUpRequired(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  return /STEP_UP_REQUIRED|Recent re-authentication is required/i.test(message)
}
