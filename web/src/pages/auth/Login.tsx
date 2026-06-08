import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Car, Eye, EyeOff, ArrowRight, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/AuthContext'

const DEMO_USERS = {
  owner: { id: 'u1', name: 'Tendai Moyo', email: 'tendai@email.co.zw', phone: '+263 773 345 678', role: 'owner' as const },
  dealer: { id: 'u3', name: 'Croco Motors', email: 'dealer@crocomoto.co.zw', phone: '+263 772 100 200', role: 'dealer' as const },
  mechanic: { id: 'u2', name: 'Simba Mechanic', email: 'simba@garage.co.zw', phone: '+263 775 200 300', role: 'mechanic' as const },
}

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.email.trim()) e.email = 'Email or phone is required'
    if (!form.password) e.password = 'Password is required'
    else if (form.password.length < 6) e.password = 'Password must be at least 6 characters'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const getDashboardRoute = (role: string) => {
    if (role === 'dealer') return '/dealer'
    if (role === 'mechanic') return '/mechanic'
    if (role === 'admin') return '/admin'
    return '/dashboard'
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    setLoading(true)

    try {
      const res = await fetch('https://carup-backend.vercel.app/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, password: form.password }),
      })

      if (res.ok) {
        const data = await res.json()
        const userData = data.user
        const token = data.token
        
        login(userData, token)
        toast.success(`Welcome back, ${userData.name}!`)
        navigate(getDashboardRoute(userData.role))
      } else {
        const errorData = await res.json()
        toast.error(errorData.error || 'Invalid credentials')
      }
    } catch (e) {
      toast.error('Network error. Backend is offline.')
    } finally {
      setLoading(false)
    }
  }

  const handleDemoLogin = async (userKey: keyof typeof DEMO_USERS) => {
    const demoUser = DEMO_USERS[userKey]
    setLoading(true)
    try {
      const res = await fetch('https://carup-backend.vercel.app/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: demoUser.email, password: 'password123' }),
      })
      if (res.ok) {
        const data = await res.json()
        login(data.user, data.token)
        toast.success(`Logged in as ${data.user.name}`)
        navigate(getDashboardRoute(data.user.role))
      } else {
        toast.error('Demo login failed. Make sure DB is seeded.')
      }
    } catch (e) {
      toast.error('Network error.')
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
              <div>
                <label className="text-sm font-medium mb-1.5 block">Email or Phone</label>
                <Input
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="tendai@email.co.zw or +263..."
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
                <Link to="#" className="text-orange-600 hover:underline">Forgot password?</Link>
              </div>
              <Button type="submit" className="w-full bg-orange-500 hover:bg-orange-600" disabled={loading} data-testid="login-button">
                {loading ? 'Signing in...' : 'Sign In'} <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </form>

            <Separator className="my-6" />

            <p className="text-xs text-gray-400 text-center mb-3 font-medium uppercase tracking-wider">Quick Demo Access</p>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start gap-2 text-sm" onClick={() => handleDemoLogin('owner')}>
                <Car className="w-4 h-4 text-orange-500" /> Browse as Buyer (Tendai Moyo)
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" className="text-xs" onClick={() => handleDemoLogin('dealer')}>
                  Demo: Dealer
                </Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => handleDemoLogin('mechanic')}>
                  Demo: Mechanic
                </Button>
              </div>
            </div>

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
