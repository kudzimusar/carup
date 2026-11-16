import { BrandIdentity } from '@/components/brand/BrandIdentity'
import { isShowroomChromeEnabled } from '@/lib/presentationFlags'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { isSafeReturnTo, resolvePostLoginRoute } from '@/lib/returnTo'
import { getFeatureByRoute } from '@/config/featureRegistry'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Car, Eye, EyeOff, ArrowRight, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/AuthContext'
import { useFocusedEmbed } from '@/components/shell/FocusedEmbedContext'
import { resolveApiBaseUrl } from '@/lib/apiClient'
import { LoginErrorAlert } from './LoginErrorAlert'
import { classifyLoginStatus, loginError, type LoginErrorState } from './loginError'

// TI-01 — demo-login identities, the shared demo credential, and the "Quick Demo Access"
// controls were removed from every client build (dispatch RX02-RS-R3). Sign-in is the real
// credential form only; no hardcoded identity or password exists in this module.

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
);

export default function Login() {
  const { login } = useAuth()
  // S1-4B R2-5: when rendered beneath the unified focused chrome, suppress this
  // page's own brand block + dark stage so the task gets ONE clear hierarchy.
  // Outside the focused shell (default) the legacy presentation is unchanged.
  const focusedEmbed = useFocusedEmbed()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnTo = searchParams.get('returnTo')
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<LoginErrorState | null>(null)
  // RX03-AUTH: name the task the person will return to (safe internal paths only; presentation only —
  // the redirect itself is still resolvePostLoginRoute's, and the destination's own guard decides access).
  const continueLabel = isSafeReturnTo(returnTo)
    ? getFeatureByRoute(returnTo.split(/[?#]/)[0])?.label ?? null
    : null
  const registerHref = isSafeReturnTo(returnTo) ? `/register?returnTo=${encodeURIComponent(returnTo)}` : '/register'

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.email.trim()) e.email = 'Email or phone is required'
    if (!form.password) e.password = 'Password is required'
    else if (form.password.length < 6) e.password = 'Password must be at least 6 characters'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    // Cleared state on retry: drop any previous failure before the new attempt.
    setFormError(null)
    setLoading(true)

    try {
      // Fetch CSRF token to pass the security middleware
      const csrfRes = await fetch(`${API_BASE}/security/csrf-token`, {
        method: 'GET',
        credentials: 'include'
      })
      const csrfData = await csrfRes.json()
      const csrfToken = csrfData.csrfToken

      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        credentials: 'include',
        body: JSON.stringify({ email: form.email, password: form.password }),
      })

      if (res.ok) {
        const data = await res.json()
        const userData = data.user
        const token = data.token

        login(userData, token)
        toast.success(`Welcome back, ${userData.name}!`)
        navigate(resolvePostLoginRoute(returnTo, userData.role))
      } else {
        // Distinct, safe message for invalid credentials vs. server/session failure.
        setFormError(loginError(classifyLoginStatus(res.status)))
      }
    } catch {
      // Request never reached the backend (offline / server unreachable).
      setFormError(loginError('backend_unavailable'))
    } finally {
      setLoading(false)
    }
  }

  // RX03-AUTH — inside the account stage (RX-03 showroom chrome or the unified FocusedShell) the stage
  // owns the logo, title and exit; this renders the form only, once. Same state, same submit, same
  // CSRF-bound request and error classification as the legacy card below — one credential path.
  if (focusedEmbed) {
    const field = 'h-12 w-full rounded-xl border bg-white px-4 text-[16px] text-[#09122A] placeholder:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18] focus-visible:ring-offset-1'
    return (
      <form onSubmit={handleSubmit} noValidate className="space-y-5" data-testid="signin-form" aria-label="Sign in">
        {continueLabel && (
          <p className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200" data-testid="signin-continue">
            After you sign in, you’ll continue to <strong className="font-semibold text-[#09122A]">{continueLabel}</strong>.
          </p>
        )}
        <LoginErrorAlert error={formError} />
        <div>
          <label htmlFor="signin-identifier" className="mb-1.5 block text-sm font-semibold text-[#09122A]">Email or phone</label>
          <input
            id="signin-identifier"
            name="username"
            type="text"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            placeholder="you@example.com"
            className={`${field} ${errors.email ? 'border-red-500' : 'border-slate-300'}`}
            data-testid="email-input"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'signin-identifier-error' : undefined}
          />
          {errors.email && (
            <p id="signin-identifier-error" className="mt-1.5 flex items-center gap-1 text-sm text-red-700">
              <AlertCircle className="h-4 w-4" aria-hidden="true" /> {errors.email}
            </p>
          )}
        </div>
        <div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="signin-password" className="inline-flex min-h-11 items-center text-sm font-semibold text-[#09122A]">Password</label>
            <Link to="/auth/forgot-password" className="inline-flex min-h-11 items-center text-sm font-semibold text-[#C2410C] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18]" data-testid="signin-forgot">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              id="signin-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              className={`${field} pr-14 ${errors.password ? 'border-red-500' : 'border-slate-300'}`}
              data-testid="password-input"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'signin-password-error' : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-600 hover:text-[#09122A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18]"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              aria-controls="signin-password"
              data-testid="signin-password-toggle"
            >
              {showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
          {errors.password && (
            <p id="signin-password-error" className="mt-1.5 flex items-center gap-1 text-sm text-red-700">
              <AlertCircle className="h-4 w-4" aria-hidden="true" /> {errors.password}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={loading}
          data-testid="login-button"
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#09122A] text-[15px] font-semibold text-white transition-colors hover:bg-[#16244d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18] focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {loading ? 'Signing in…' : 'Sign in'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <p className="text-center text-sm text-slate-600">
          New to CarUp?{' '}
          <Link to={registerHref} className="inline-flex min-h-11 items-center font-semibold text-[#C2410C] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18]" data-testid="signin-register">
            Create an account
          </Link>
        </p>
      </form>
    )
  }

  return (
    <div className={focusedEmbed
      ? 'w-full max-w-md mx-auto py-2'
      : 'min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,12%)] to-[hsl(222,30%,18%)] p-4'}>
      <div className="w-full max-w-md">
        {!focusedEmbed && (
        <div className="text-center mb-8">
          {isShowroomChromeEnabled() ? (
            <Link to="/" className="mb-6 inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18]" aria-label="CarUp home" data-testid="brand-home-link">
              <BrandIdentity role="stacked" surface="dark" height={64} decorative priority />
            </Link>
          ) : (
            <Link to="/" className="inline-flex min-h-11 items-center gap-2 mb-6">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
                <Car className="w-6 h-6 text-white" />
              </div>
              <span className="text-2xl font-bold text-white">
                Car<span className="text-orange-500">Up</span>
              </span>
            </Link>
          )}
          <h1 className="text-2xl font-bold text-white mb-2">Welcome Back</h1>
          <p className="text-gray-400">Sign in to your CarUp account</p>
        </div>
        )}

        <Card className="border-0 card-shadow">
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <LoginErrorAlert error={formError} />
              <div>
                <label className="text-sm font-medium mb-1.5 block">Email or Phone</label>
                <Input
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="you@example.co.zw or +263..."
                  className={errors.email ? 'border-red-400' : ''}
                  data-testid="email-input"
                  aria-label="Email or Phone"
                  autoComplete="email"
                />
                {errors.email && (
                  <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {errors.email}
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Password</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    placeholder="Enter your password"
                    className={errors.password ? 'border-red-400' : ''}
                    data-testid="password-input"
                    aria-label="Password"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center text-gray-400"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {errors.password}
                  </p>
                )}
              </div>
              {/* PC01-J-R1: a "Remember me" checkbox stood here, bound to nothing — a control that did nothing. */}
              <div className="flex items-center justify-end text-sm">
                <Link to="/auth/forgot-password" className="inline-flex min-h-11 items-center text-orange-600 hover:underline">Forgot password?</Link>
              </div>
              <Button type="submit" className="w-full bg-orange-500 hover:bg-orange-600" disabled={loading} data-testid="login-button">
                {loading ? 'Signing in...' : 'Sign In'} <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </form>

            <p className="text-center text-sm text-gray-500 mt-6">
              Don't have an account?{' '}
              <Link to="/register" className="text-orange-600 font-medium hover:underline">Get Started</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
