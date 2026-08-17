import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Car, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { resolveApiBaseUrl } from '@/lib/apiClient'
import { MIN_PASSWORD_LENGTH, passwordPolicyError } from '@/lib/passwordPolicy'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

/**
 * SA1E — complete a password reset.
 *
 * On success the user is sent back to /login rather than being signed in automatically: the
 * existing session contract issues tokens only through POST /api/auth/login, and signing in here
 * would mean minting a session for whoever holds the emailed link.
 */
export default function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const policy = passwordPolicyError(password, confirm)
    if (policy) { setError(policy); return }

    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error || 'This reset link is invalid or has expired. Please request a new one.')
        return
      }
      setDone(true)
      setTimeout(() => navigate('/login'), 2500)
    } catch {
      setError('Could not reach CarUp. Please check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,12%)] to-[hsl(222,30%,18%)] p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
              <Car className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-white">Car<span className="text-orange-500">Up</span></span>
          </Link>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          {!token ? (
            <div data-testid="reset-password-missing-token">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 mb-2">This link is not valid</h1>
              <p className="text-sm text-slate-600 mb-6">
                The reset link is incomplete or has expired. Request a new one to continue.
              </p>
              <Link to="/auth/forgot-password">
                <Button className="w-full bg-orange-500 hover:bg-orange-600">Request a new link</Button>
              </Link>
            </div>
          ) : done ? (
            <div data-testid="reset-password-success">
              <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 mb-2">Password updated</h1>
              <p className="text-sm text-slate-600 mb-6">
                Your password has been reset and any existing sessions were signed out. Redirecting
                you to sign in…
              </p>
              <Link to="/login">
                <Button className="w-full bg-orange-500 hover:bg-orange-600">Sign in</Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} data-testid="reset-password-form">
              <h1 className="text-xl font-bold text-slate-900 mb-2">Choose a new password</h1>
              <p className="text-sm text-slate-600 mb-6">
                Your new password must be at least {MIN_PASSWORD_LENGTH} characters.
              </p>

              {error && (
                <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3" role="alert" data-testid="reset-password-error">
                  <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <div className="mb-4">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password" type="password" autoComplete="new-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  data-testid="reset-password-input"
                />
              </div>

              <div className="mb-6">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm" type="password" autoComplete="new-password" required
                  value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  data-testid="reset-password-confirm"
                />
              </div>

              <Button
                type="submit" disabled={submitting}
                className="w-full bg-orange-500 hover:bg-orange-600"
                data-testid="reset-password-submit"
              >
                {submitting ? 'Updating…' : 'Update password'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
