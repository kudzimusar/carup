import { AlertCircle } from 'lucide-react'
import type { LoginErrorState } from './loginError'

// Persistent, accessible inline alert for login failures.
// - role="alert" + assertive live region so screen readers announce it immediately
// - strong-contrast red surface with an icon
// - renders nothing when there is no error (cleared state on retry)
export function LoginErrorAlert({ error }: { error: LoginErrorState | null }) {
  if (!error) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      data-testid="login-error-alert"
      data-error-kind={error.kind}
      className="mb-4 flex items-start gap-2 rounded-md border border-red-500 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-800"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
      <span>{error.message}</span>
    </div>
  )
}
