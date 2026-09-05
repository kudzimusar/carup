import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Loader2, MailCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { apiRequest, resolveApiBaseUrl } from '@/lib/apiClient'
import { useAuth } from '@/context/AuthContext'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

type State = 'loading' | 'success' | 'error' | 'missing'

export default function VerifyEmail() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const { isAuthenticated } = useAuth()
  const [state, setState] = useState<State>(token ? 'loading' : 'missing')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!token) return
    let active = true

    apiRequest<{ success: boolean; message?: string }>({
      baseUrl: API_BASE,
      path: '/auth/verify-email',
      options: {
        method: 'POST',
        body: JSON.stringify({ token }),
      },
    })
      .then(result => {
        if (!active) return
        setMessage(result.message || 'Your email address has been verified.')
        setState('success')
      })
      .catch(error => {
        if (!active) return
        setMessage(error instanceof Error ? error.message : 'This verification link is invalid or has expired.')
        setState('error')
      })

    return () => { active = false }
  }, [token])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,12%)] to-[hsl(222,30%,18%)] p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        {state === 'loading' && (
          <div className="text-center" data-testid="verify-email-loading">
            <Loader2 className="mx-auto h-9 w-9 animate-spin text-orange-500" />
            <h1 className="mt-4 text-xl font-bold text-slate-950">Verifying your email…</h1>
            <p className="mt-2 text-sm text-slate-600">This one-time link is being checked securely.</p>
          </div>
        )}

        {state === 'success' && (
          <div data-testid="verify-email-success">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h1 className="mt-4 text-xl font-bold text-slate-950">Email verified</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
            <Button asChild className="mt-6 w-full bg-orange-500 hover:bg-orange-600">
              <Link to={isAuthenticated ? '/dashboard' : '/login'}>{isAuthenticated ? 'Continue to CarUp' : 'Sign in to CarUp'}</Link>
            </Button>
          </div>
        )}

        {(state === 'error' || state === 'missing') && (
          <div data-testid="verify-email-error">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-700">
              <AlertCircle className="h-6 w-6" />
            </div>
            <h1 className="mt-4 text-xl font-bold text-slate-950">Verification link unavailable</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {state === 'missing' ? 'This verification link is incomplete.' : message}
            </p>
            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              <MailCheck className="mb-2 h-4 w-4 text-orange-600" />
              Sign in and request another verification message if this link has expired.
            </div>
            <Button asChild className="mt-4 w-full bg-orange-500 hover:bg-orange-600">
              <Link to="/login">Go to sign in</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
