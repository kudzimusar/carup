import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Car, ArrowLeft, MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { resolveApiBaseUrl } from '@/lib/apiClient'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

/**
 * SA1E — request a password reset.
 *
 * The success state is deliberately identical whether or not an account exists: the backend
 * returns one generic response, and this screen must not add an enumeration oracle on top of it.
 * A network failure shows the same confirmation for the same reason.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!email.trim() || submitting) return
    setSubmitting(true)
    try {
      await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
    } catch {
      // Intentionally ignored: revealing a transport failure here would let an attacker
      // distinguish outcomes. The confirmation below is always shown.
    } finally {
      setSubmitting(false)
      setSent(true)
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
          {sent ? (
            <div data-testid="forgot-password-sent">
              <div className="w-12 h-12 rounded-full bg-orange-50 flex items-center justify-center mb-4">
                <MailCheck className="w-6 h-6 text-orange-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 mb-2">Check your email</h1>
              <p className="text-sm text-slate-600 mb-6">
                If an account exists for that email address, we have sent a link to reset your
                password. The link can be used once and expires within the hour.
              </p>
              <Link to="/login">
                <Button variant="outline" className="w-full">
                  <ArrowLeft className="w-4 h-4 mr-2" /> Back to sign in
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} data-testid="forgot-password-form">
              <h1 className="text-xl font-bold text-slate-900 mb-2">Reset your password</h1>
              <p className="text-sm text-slate-600 mb-6">
                Enter the email address on your CarUp account and we will send you a reset link.
              </p>

              <div className="mb-6">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  data-testid="forgot-password-email"
                />
              </div>

              <Button
                type="submit"
                disabled={submitting || !email.trim()}
                className="w-full bg-orange-500 hover:bg-orange-600"
                data-testid="forgot-password-submit"
              >
                {submitting ? 'Sending…' : 'Send reset link'}
              </Button>

              <Link to="/login" className="block text-center text-sm text-slate-600 hover:underline mt-4">
                Back to sign in
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
