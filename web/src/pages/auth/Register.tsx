// @ts-nocheck
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Car, Eye, EyeOff, ArrowRight, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'

const roles = [
  { value: 'owner', label: 'Car Owner' },
  { value: 'dealer', label: 'Dealer' },
  { value: 'mechanic', label: 'Mechanic / Garage' },
  { value: 'insurance', label: 'Insurance Provider' },
]

export default function Register() {
  const [showPassword, setShowPassword] = useState(false)
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    password: '', confirmPassword: '', role: '', location: ''
  })
  const [loading, setLoading] = useState(false)

  const { login } = useAuth()
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (step === 1) {
      setStep(2)
      return
    }
    
    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('https://carup-backend.vercel.app/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${form.firstName} ${form.lastName}`,
          email: form.email,
          phone: form.phone,
          password: form.password,
          role: form.role
        }),
      })

      if (res.ok) {
        const data = await res.json()
        login(data.user, data.token)
        toast.success('Account created! Welcome to CarUp.')
        window.location.href = '/dashboard'
      } else {
        const errorData = await res.json()
        toast.error(errorData.error || 'Registration failed')
      }
    } catch (error) {
      toast.error('Network error. Backend is offline.')
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
          <h1 className="text-2xl font-bold text-white mb-2">Create Your Account</h1>
          <p className="text-gray-400">Join Zimbabwe's automotive intelligence platform</p>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2].map(s => (
            <div key={s} className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              s === step ? 'bg-orange-500 text-white' : s < step ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400'
            }`}>
              {s < step ? <CheckCircle className="w-4 h-4" /> : s}
            </div>
          ))}
        </div>

        <Card className="border-0 card-shadow">
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {step === 1 ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">First Name</label>
                      <Input required value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} placeholder="Tendai" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Last Name</label>
                      <Input required value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} placeholder="Moyo" />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Email</label>
                    <Input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="tendai@email.co.zw" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Phone Number</label>
                    <Input required value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+263 7XX XXX XXX" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">I am a...</label>
                    <Select value={form.role} onValueChange={v => setForm({ ...form, role: v })}>
                      <SelectTrigger><SelectValue placeholder="Select your role" /></SelectTrigger>
                      <SelectContent>
                        {roles.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Location</label>
                    <Input required value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="e.g. Harare" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Password</label>
                    <div className="relative">
                      <Input type={showPassword ? 'text' : 'password'} required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Min 8 characters" />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Confirm Password</label>
                    <Input type="password" required value={form.confirmPassword} onChange={e => setForm({ ...form, confirmPassword: e.target.value })} placeholder="Repeat password" />
                  </div>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" required className="mt-0.5 rounded" />
                    <span>I agree to the <Link to="#" className="text-orange-600 hover:underline">Terms of Service</Link> and <Link to="#" className="text-orange-600 hover:underline">Privacy Policy</Link></span>
                  </label>
                </>
              )}
              <Button type="submit" className="w-full bg-orange-500 hover:bg-orange-600" disabled={loading}>
                {loading ? 'Creating Account...' : step === 1 ? 'Continue' : 'Create Account'}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              {step === 2 && (
                <Button type="button" variant="ghost" className="w-full" onClick={() => setStep(1)}>
                  Back
                </Button>
              )}
            </form>

            <p className="text-center text-sm text-gray-500 mt-6">
              Already have an account?{' '}
              <Link to="/login" className="text-orange-600 font-medium hover:underline">Sign In</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}