import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { resolvePostLoginRoute } from '@/lib/returnTo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Car, Eye, EyeOff, ArrowRight, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/AuthContext'
import { resolveApiBaseUrl } from '@/lib/apiClient'
import { LoginErrorAlert } from './LoginErrorAlert'
import { classifyLoginStatus, loginError, type LoginErrorState } from './loginError'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
);

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnTo = searchParams.get('returnTo')
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<LoginErrorState | null>(null)

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


  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,12%)] to-[hsl(222,30%,18%)] p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
              <Car className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-white">
              Car<span className="text-orange-500">Up</span>
            </span>
          </Link>
          <h1 className="text-2xl font-bold text-white mb-2">Welcome Back</h1>
          <p className="text-gray-400">Sign in to your CarUp account</p>
        </div>

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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
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
              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="rounded" /> Remember me
                </label>
                <Link to="/auth/forgot-password" className="text-orange-600 hover:underline">Forgot password?</Link>
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
