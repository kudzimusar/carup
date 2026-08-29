import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { apiRequest, resolveApiBaseUrl } from '@/lib/apiClient'
import { resolvePostLoginRoute } from '@/lib/returnTo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
  ArrowRight,
  Building2,
  Car,
  CheckCircle,
  Eye,
  EyeOff,
  MailCheck,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import type { AuthUser } from '@shared/types'

const API_BASE = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

type AccountKind = 'individual' | 'business'
type MarketRelationship = 'zimbabwe_local' | 'diaspora' | 'international'
type IntendedUse = 'buy' | 'sell' | 'buy_sell' | 'professional_services'

const BUSINESS_TYPES = [
  ['dealer', 'Dealer / dealership'],
  ['exporter', 'Vehicle exporter'],
  ['importer', 'Vehicle importer'],
  ['garage', 'Garage / service centre'],
  ['mechanic', 'Mechanic'],
  ['parts_seller', 'Parts seller'],
  ['insurer', 'Insurance provider'],
  ['lender', 'Finance / lender'],
  ['other', 'Other automotive business'],
] as const

const INITIAL = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  accountKind: 'individual' as AccountKind,
  marketRelationship: '' as MarketRelationship | '',
  countryOfResidence: '',
  city: '',
  province: '',
  intendedUse: '' as IntendedUse | '',
  organizationName: '',
  businessType: '',
  password: '',
  confirmPassword: '',
  termsAcknowledged: false,
  privacyAcknowledged: false,
  marketingConsent: false,
}

export default function Register() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnTo = searchParams.get('returnTo')
  const [showPassword, setShowPassword] = useState(false)
  const [step, setStep] = useState(1)
  const [form, setForm] = useState(INITIAL)
  const [loading, setLoading] = useState(false)
  const [registered, setRegistered] = useState<{
    email: string
    emailStatus: 'sent' | 'queued' | 'delivery_failed' | 'queue_failed'
    onboardingRequested: boolean
    role: string
  } | null>(null)
  const [resending, setResending] = useState(false)

  const { login } = useAuth()

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm(previous => ({ ...previous, [key]: value }))
  }

  const validateProfileStep = () => {
    if (!form.marketRelationship) return 'Choose your relationship to the Zimbabwe market.'
    if (!form.countryOfResidence.trim()) return 'Country of residence is required.'
    if (!form.city.trim()) return 'City or location is required.'
    if (!form.intendedUse) return 'Choose how you plan to use CarUp.'
    if (form.accountKind === 'business' && !form.organizationName.trim()) return 'Business or organisation name is required.'
    if (form.accountKind === 'business' && !form.businessType) return 'Choose the type of automotive business.'
    return null
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (step === 1) {
      setStep(2)
      return
    }

    if (step === 2) {
      const error = validateProfileStep()
      if (error) {
        toast.error(error)
        return
      }
      setStep(3)
      return
    }

    if (form.password.length < 8) {
      toast.error('Password must be at least 8 characters.')
      return
    }
    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match.')
      return
    }
    if (!form.termsAcknowledged || !form.privacyAcknowledged) {
      toast.error('Please acknowledge both the Terms of Service and Privacy Policy.')
      return
    }

    setLoading(true)
    try {
      const data = await apiRequest<{
        user: AuthUser
        token: string
        email_verification?: { status?: 'sent' | 'queued' | 'delivery_failed' | 'queue_failed' }
        onboarding?: { status?: string } | null
      }>({
        baseUrl: API_BASE,
        path: '/auth/register',
        options: {
          method: 'POST',
          body: JSON.stringify({
            name: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
            email: form.email.trim(),
            phone: form.phone.trim(),
            password: form.password,
            // Deliberately never transmit Dealer/Exporter/etc as an authorization role.
            role: 'owner',
            location: form.city.trim(),
            registration_profile: {
              account_kind: form.accountKind,
              market_relationship: form.marketRelationship,
              country_of_residence: form.countryOfResidence.trim(),
              city: form.city.trim(),
              province: form.province.trim() || null,
              intended_use: form.intendedUse,
              organization_name: form.accountKind === 'business' ? form.organizationName.trim() : null,
              business_type: form.accountKind === 'business' ? form.businessType : null,
              terms_acknowledged: form.termsAcknowledged,
              privacy_acknowledged: form.privacyAcknowledged,
              marketing_consent: form.marketingConsent,
            },
          }),
        },
      })

      login(data.user, data.token)
      setRegistered({
        email: data.user.email,
        emailStatus: data.email_verification?.status || 'queue_failed',
        onboardingRequested: data.onboarding?.status === 'requested',
        role: data.user.role,
      })
      toast.success('Account created. Your Seller draft is still waiting for you.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  const resendVerification = async () => {
    if (!registered?.email) return
    setResending(true)
    try {
      await apiRequest({
        baseUrl: API_BASE,
        path: '/auth/resend-verification',
        options: {
          method: 'POST',
          body: JSON.stringify({ email: registered.email }),
        },
      })
      toast.success('If this address still needs verification, a new link has been queued.')
    } catch {
      toast.error('Could not request another verification email right now.')
    } finally {
      setResending(false)
    }
  }

  const continueRoute = returnTo
    ? resolvePostLoginRoute(returnTo, registered?.role || 'owner')
    : resolvePostLoginRoute(null, registered?.role || 'owner')

  if (registered) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,12%)] to-[hsl(222,30%,18%)] p-4">
        <Card className="w-full max-w-lg border-0 shadow-2xl">
          <CardContent className="p-7 sm:p-9">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
              <MailCheck className="h-7 w-7" />
            </div>
            <h1 className="mt-5 text-center text-2xl font-bold text-slate-950">Your account is ready</h1>
            <p className="mt-2 text-center text-sm leading-6 text-slate-600">
              We created a secure base account and kept your Seller handoff separate from any
              privileged business access.
            </p>

            <div className="mt-6 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <div className="flex items-start gap-3">
                <MailCheck className="mt-0.5 h-4 w-4 flex-none text-orange-600" />
                <div>
                  <p className="font-semibold text-slate-900">Verify your email</p>
                  <p className="mt-0.5 text-slate-600">
                    {registered.emailStatus === 'sent'
                      ? `A confirmation email was sent to ${registered.email}.`
                      : registered.emailStatus === 'queued'
                        ? `Your confirmation email is queued for ${registered.email}. You can resend it if it does not arrive shortly.`
                        : `CarUp could not confirm delivery of the verification email to ${registered.email}. Use the resend button below.`}
                  </p>
                </div>
              </div>
              {registered.onboardingRequested && (
                <div className="flex items-start gap-3">
                  <Building2 className="mt-0.5 h-4 w-4 flex-none text-orange-600" />
                  <div>
                    <p className="font-semibold text-slate-900">Business onboarding requested</p>
                    <p className="mt-0.5 text-slate-600">
                      Dealer, exporter and other professional permissions are granted only after
                      governed business review. Signup itself does not grant those privileges.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 grid gap-3">
              <Button
                type="button"
                className="h-11 bg-orange-500 hover:bg-orange-600"
                onClick={() => navigate(continueRoute)}
                data-testid="registration-continue"
              >
                Continue to my Seller draft <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" onClick={resendVerification} disabled={resending}>
                {resending ? 'Requesting…' : 'Resend verification email'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,12%)] to-[hsl(222,30%,18%)] p-4">
      <div className="w-full max-w-xl">
        <div className="text-center mb-7">
          <Link to="/" className="inline-flex items-center gap-2 mb-5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
              <Car className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-white">Car<span className="text-orange-500">Up</span></span>
          </Link>
          <h1 className="text-2xl font-bold text-white mb-2">Create your CarUp profile</h1>
          <p className="text-sm text-gray-400">
            Tell us who you are in the automotive journey. Verification happens only where it is actually needed.
          </p>
        </div>

        <div className="flex items-center justify-center gap-3 mb-6" aria-label="Registration progress">
          {[1, 2, 3].map(value => (
            <div key={value} className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold ${
                value === step ? 'bg-orange-500 text-white' : value < step ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400'
              }`}>
                {value < step ? <CheckCircle className="w-4 h-4" /> : value}
              </div>
              {value < 3 && <div className={`h-px w-10 sm:w-16 ${value < step ? 'bg-green-500' : 'bg-gray-700'}`} />}
            </div>
          ))}
        </div>

        <Card className="border-0 card-shadow">
          <CardContent className="p-6 sm:p-7">
            <form onSubmit={handleSubmit} className="space-y-4">
              {step === 1 && (
                <>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-600">1 · Identity & contact</p>
                    <h2 className="mt-1 text-lg font-bold">Start with the person we can contact</h2>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="First Name">
                      <Input required autoComplete="given-name" value={form.firstName} onChange={e => set('firstName', e.target.value)} placeholder="Tendai" />
                    </Field>
                    <Field label="Last Name">
                      <Input required autoComplete="family-name" value={form.lastName} onChange={e => set('lastName', e.target.value)} placeholder="Moyo" />
                    </Field>
                  </div>
                  <Field label="Email">
                    <Input type="email" required autoComplete="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="tendai@example.com" />
                  </Field>
                  <Field label="Phone Number">
                    <Input required autoComplete="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+263 7XX XXX XXX" />
                  </Field>
                  <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
                    We do not ask for passport, ID or ownership documents at signup. CarUp requests
                    sensitive evidence later, inside the governed verification or Vehicle Passport journey.
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-600">2 · Market profile</p>
                    <h2 className="mt-1 text-lg font-bold">How do you participate in the vehicle market?</h2>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <AccountKindCard
                      active={form.accountKind === 'individual'}
                      icon={<UserRound className="h-5 w-5" />}
                      title="Individual"
                      note="Buyer, private owner or private seller"
                      onClick={() => {
                        set('accountKind', 'individual')
                        set('businessType', '')
                        set('organizationName', '')
                      }}
                    />
                    <AccountKindCard
                      active={form.accountKind === 'business'}
                      icon={<Building2 className="h-5 w-5" />}
                      title="Business / professional"
                      note="Dealer, exporter, garage or other automotive organisation"
                      onClick={() => set('accountKind', 'business')}
                    />
                  </div>

                  <Field label="Relationship to Zimbabwe">
                    <select
                      required
                      value={form.marketRelationship}
                      onChange={e => set('marketRelationship', e.target.value as MarketRelationship)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Choose one</option>
                      <option value="zimbabwe_local">Zimbabwe-based / local</option>
                      <option value="diaspora">Zimbabwe diaspora</option>
                      <option value="international">International / non-diaspora</option>
                    </select>
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Country of residence">
                      <Input required autoComplete="country-name" value={form.countryOfResidence} onChange={e => set('countryOfResidence', e.target.value)} placeholder="Zimbabwe, Japan, UK…" />
                    </Field>
                    <Field label="City / location">
                      <Input required autoComplete="address-level2" value={form.city} onChange={e => set('city', e.target.value)} placeholder="Harare, Tokyo…" />
                    </Field>
                  </div>

                  {form.marketRelationship === 'zimbabwe_local' && (
                    <Field label="Province (optional)">
                      <Input value={form.province} onChange={e => set('province', e.target.value)} placeholder="Harare, Bulawayo, Manicaland…" />
                    </Field>
                  )}

                  <Field label="What do you plan to do on CarUp?">
                    <select
                      required
                      value={form.intendedUse}
                      onChange={e => set('intendedUse', e.target.value as IntendedUse)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Choose one</option>
                      <option value="buy">Buy vehicles</option>
                      <option value="sell">Sell my own vehicles</option>
                      <option value="buy_sell">Buy and sell</option>
                      <option value="professional_services">Operate an automotive business / professional service</option>
                    </select>
                  </Field>

                  {form.accountKind === 'business' && (
                    <>
                      <Field label="Business / organisation name">
                        <Input required value={form.organizationName} onChange={e => set('organizationName', e.target.value)} placeholder="Example Motors (Pvt) Ltd" />
                      </Field>
                      <Field label="Business type">
                        <select
                          required
                          value={form.businessType}
                          onChange={e => set('businessType', e.target.value)}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="">Choose one</option>
                          {BUSINESS_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </Field>
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                        Choosing Dealer, Exporter or another business type records your onboarding
                        request. It does <strong>not</strong> self-grant privileged access; CarUp reviews
                        the business before enabling those capabilities.
                      </div>
                    </>
                  )}
                </>
              )}

              {step === 3 && (
                <>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-600">3 · Security & privacy</p>
                    <h2 className="mt-1 text-lg font-bold">Secure the account and choose your permissions</h2>
                  </div>

                  <Field label="Password">
                    <div className="relative">
                      <Input type={showPassword ? 'text' : 'password'} required minLength={8} autoComplete="new-password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="At least 8 characters" />
                      <button type="button" onClick={() => setShowPassword(value => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </Field>
                  <Field label="Confirm Password">
                    <Input type="password" required minLength={8} autoComplete="new-password" value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} placeholder="Repeat password" />
                  </Field>

                  <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <Consent
                      checked={form.termsAcknowledged}
                      onChange={value => set('termsAcknowledged', value)}
                      required
                    >
                      I agree to the <Link to="/terms" target="_blank" className="font-semibold text-orange-600 hover:underline">Terms of Service</Link>.
                    </Consent>
                    <Consent
                      checked={form.privacyAcknowledged}
                      onChange={value => set('privacyAcknowledged', value)}
                      required
                    >
                      I have read the <Link to="/privacy" target="_blank" className="font-semibold text-orange-600 hover:underline">Privacy Policy</Link> and understand how CarUp handles account and vehicle data.
                    </Consent>
                    <Consent checked={form.marketingConsent} onChange={value => set('marketingConsent', value)}>
                      Send me optional CarUp product news and offers. I can change this later.
                    </Consent>
                  </div>

                  <div className="flex gap-3 rounded-xl bg-slate-950 p-4 text-white">
                    <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-orange-400" />
                    <div>
                      <p className="text-sm font-semibold">Verification is separate from signup</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        We will send a one-time email confirmation. Vehicle ownership, identity/KYC,
                        Dealer or Exporter approval remain governed workflows and are never implied by this form.
                      </p>
                    </div>
                  </div>
                </>
              )}

              <Button type="submit" className="w-full bg-orange-500 hover:bg-orange-600" disabled={loading}>
                {loading ? 'Creating Account…' : step < 3 ? 'Continue' : 'Create Account'}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>

              {step > 1 && (
                <Button type="button" variant="ghost" className="w-full" onClick={() => setStep(current => current - 1)}>
                  Back
                </Button>
              )}
            </form>

            <p className="text-center text-sm text-gray-500 mt-6">
              Already have an account?{' '}
              <Link to={returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login'} className="text-orange-600 font-medium hover:underline">Sign In</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium mb-1.5 block">{label}</label>
      {children}
    </div>
  )
}

function AccountKindCard({
  active,
  icon,
  title,
  note,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  title: string
  note: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition ${
        active ? 'border-orange-400 bg-orange-50 ring-1 ring-orange-200' : 'border-slate-200 hover:border-slate-300'
      }`}
      aria-pressed={active}
    >
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${active ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600'}`}>{icon}</span>
      <span className="mt-3 block text-sm font-bold text-slate-950">{title}</span>
      <span className="mt-1 block text-xs leading-5 text-slate-500">{note}</span>
    </button>
  )
}

function Consent({
  checked,
  onChange,
  children,
  required = false,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  children: React.ReactNode
  required?: boolean
}) {
  return (
    <label className="flex items-start gap-2.5 text-sm leading-5 text-slate-700">
      <input
        type="checkbox"
        required={required}
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300"
      />
      <span>{children}</span>
    </label>
  )
}
