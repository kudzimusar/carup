/**
 * O2 post-Ready review C1 — the step-up a reviewer can actually perform.
 *
 * `requireAuthenticationAssurance(ACTION_CLASSES.SENSITIVE)` guards O2's consequential
 * reviewer actions, and a normal password login leaves `step_up_at` unset, so every one of
 * them answered 403 STEP_UP_REQUIRED. The backend had the only writer of step-up state
 * (`POST /api/auth/step-up`) from the beginning; no screen ever called it, so the guard was
 * unsatisfiable through the product and admins could open identity cases but never decide one.
 *
 * This dialog closes that gap and nothing else:
 *  - it re-proves the CURRENT account's password against the stored hash, server-side;
 *  - it grants no role, no capability and no scope — only recency of authentication, which
 *    the guard checks in addition to (never instead of) authorization;
 *  - it appears only in response to a real STEP_UP_REQUIRED refusal, so the guard stays the
 *    thing that decides, and the UI merely lets the human answer it.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ShieldCheck } from 'lucide-react'

export interface StepUpDialogProps {
  open: boolean
  /** What the reviewer was trying to do, so the prompt explains itself. */
  actionLabel?: string | null
  onCancel: () => void
  /** Resolve the step-up; the caller retries the guarded action on success. */
  onConfirm: (password: string) => Promise<void>
}

export function StepUpDialog({ open, actionLabel, onCancel, onConfirm }: StepUpDialogProps) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const submit = async () => {
    if (!password) {
      setError('Your current password is required to continue.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm(password)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password verification failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="step-up-title"
      data-testid="step-up-dialog"
    >
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-blue-600" aria-hidden="true" />
          <h2 id="step-up-title" className="text-sm font-semibold text-gray-900">
            Confirm it is you
          </h2>
        </div>
        <p className="mt-2 text-xs text-gray-600">
          {actionLabel
            ? `“${actionLabel}” changes someone's standing on CarUp, so it needs a fresh sign-in on this session.`
            : 'This action changes someone’s standing on CarUp, so it needs a fresh sign-in on this session.'}
        </p>
        <p className="mt-1 text-[11px] text-gray-500">
          Re-entering your password proves you are at the keyboard. It grants no extra permission.
        </p>
        <label htmlFor="step-up-password" className="mt-3 block text-xs font-medium text-gray-700">
          Your current password
        </label>
        <Input
          id="step-up-password"
          data-testid="step-up-password"
          type="password"
          autoComplete="current-password"
          value={password}
          disabled={busy}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
          className="mt-1"
        />
        {error && (
          <p className="mt-2 text-xs text-red-600" role="alert" data-testid="step-up-error">{error}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => { setPassword(''); setError(null); onCancel() }}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy} data-testid="step-up-confirm" onClick={() => void submit()}>
            {busy ? 'Confirming…' : 'Confirm and continue'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default StepUpDialog
