/**
 * O2-X2 — Registration journey: Progressive Trust onboarding (ported by OC-5C from PR #208).
 *
 * The page is a VIEW over server truth. Everything it shows — steps, who-must-act, the
 * capability ladder, locked reasons, candidates — comes from the journey/candidates
 * endpoints on every load, so a refresh or re-login resumes exactly where the person
 * left off. OCR output renders strictly as CANDIDATES: a field the document did not
 * yield says so, a suggestion must be explicitly used, and every submitted value is the
 * user's own. Verification itself stays with the Phase 7C case — this page only feeds
 * evidence in and reports the case state back.
 *
 * OC-5C: the identity standing shown is the server's SUBJECT-SAFE status (on hold, under security
 * review…), never an internal state; account type and business type are fixed once registered (the
 * server refuses a change), so they render read-only; documents are images only on this lineage.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle, Circle, Lock, Camera, RefreshCw, ShieldCheck, Hourglass, AlertTriangle } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { useAuth } from '@/context/AuthContext'
import { toast } from 'sonner'

type FieldCandidate = { state: string; value?: string; extracted_from?: string }

interface RegistrationProfileShape {
  account_kind?: string
  market_relationship?: string
  country_of_residence?: string
  city?: string
  province?: string | null
  intended_use?: string
  organization_name?: string | null
  business_type?: string | null
  marketing_consent?: boolean
  created_at?: string
}

interface JourneyResponse {
  user: { id: string; name: string; email: string; phone: string | null; email_verified: boolean } | null
  profile: RegistrationProfileShape | null
  identity_session: { id?: string; status?: string } | null
  journey: {
    steps: {
      account_created: boolean
      context_established: boolean
      identity: {
        state: string
        session_id: string | null
        uploaded_sides: { front: boolean; back: boolean; selfie: boolean }
        double_sided: boolean | null
        document_type: string | null
        who_must_act: string
        guidance: string
        lifecycle?: {
          status: string | null
          status_label: string | null
          applicant_guidance: string | null
          who_must_act: string
          capability_bearing: boolean
        } | null
      }
    }
    who_must_act: string
    required_action: string
    capability_ladder: Array<{ stage: string; reached: boolean; unlocks: string[] }>
    locked_capabilities: Array<{ capability: string; locked_by: string; reason: string }>
  }
}

interface CandidatesResponse {
  candidates: {
    available: boolean
    reason?: string
    source?: { document_type: string | null; confidence_score: number | null }
    document_fields: Record<string, FieldCandidate>
    profile_candidates: Record<string, FieldCandidate>
  }
}

const STAGE_LABELS: Record<string, string> = {
  basic_account: 'Account created',
  contact_context_established: 'Contact & context',
  identity_pending: 'Identity evidence',
  identity_approved: 'Identity verified',
}

const ACTOR_LABELS: Record<string, string> = {
  subject_action: 'Your action needed',
  carup_review: 'With CarUp review',
  platform_processing: 'CarUp is processing',
  escalated: 'Escalated to CarUp',
  external_authority: 'With an external authority',
  none: 'Nothing outstanding',
}

const DOCUMENT_FIELD_LABELS: Record<string, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  national_id_number: 'National ID number',
  date_of_birth: 'Date of birth',
  country: 'Country',
}

/** The registration vocabulary (the same labels as signup). */
const BUSINESS_TYPES: Array<[string, string]> = [
  ['dealer', 'Dealer / dealership'],
  ['exporter', 'Vehicle exporter'],
  ['importer', 'Vehicle importer'],
  ['garage', 'Garage / service centre'],
  ['mechanic', 'Mechanic'],
  ['parts_seller', 'Parts seller'],
  ['insurer', 'Insurance provider'],
  ['lender', 'Finance / lender'],
  ['logistics_provider', 'Logistics / freight forwarder'],
  ['other', 'Other automotive business'],
]
const businessTypeLabel = (value?: string | null) => BUSINESS_TYPES.find(([v]) => v === value)?.[1] || value || '—'

/** Lifecycle standings that pause identity-dependent features (subject-safe codes from the server). */
const HOLD_STATES = new Set(['on_hold', 'security_review', 'disputed', 'revoked'])

const SIDES: Array<{ side: 'front' | 'back' | 'selfie'; label: string }> = [
  { side: 'front', label: 'Document front' },
  { side: 'back', label: 'Document back' },
  { side: 'selfie', label: 'Selfie' },
]

const fieldClass = 'min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-base text-foreground shadow-sm outline-none focus:border-primary sm:text-sm'
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp'
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the selected file.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}

export default function RegistrationJourney() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const {
    fetchRegistrationJourney,
    fetchRegistrationCandidates,
    saveRegistrationProfile,
    createIdentitySession,
    uploadIdentitySide,
    submitIdentitySession,
  } = useCarUpApi()

  const [journey, setJourney] = useState<JourneyResponse | null>(null)
  const [candidates, setCandidates] = useState<CandidatesResponse['candidates'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [docType, setDocType] = useState('national_id')
  const [starting, setStarting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploadState, setUploadState] = useState<Record<string, 'idle' | 'uploading' | 'error'>>({})
  const [editContext, setEditContext] = useState(false)
  // Which profile fields were prefilled from a shown candidate, and the exact value shown —
  // sent back so the SERVER derives confirmed-vs-corrected by comparison.
  const candidatesSeen = useRef<Record<string, string>>({})

  const [form, setForm] = useState({
    account_kind: 'individual',
    market_relationship: 'zimbabwe_local',
    country_of_residence: '',
    city: '',
    province: '',
    intended_use: 'buy',
    organization_name: '',
    business_type: 'dealer',
    terms_acknowledged: false,
    privacy_acknowledged: false,
    marketing_consent: false,
  })

  const load = useCallback(async () => {
    try {
      const data = await fetchRegistrationJourney() as unknown as JourneyResponse
      setJourney(data)
      if (data.profile) {
        setForm((current) => ({
          ...current,
          account_kind: data.profile!.account_kind || 'individual',
          market_relationship: data.profile!.market_relationship || 'zimbabwe_local',
          country_of_residence: data.profile!.country_of_residence || '',
          city: data.profile!.city || '',
          province: data.profile!.province || '',
          intended_use: data.profile!.intended_use || 'buy',
          organization_name: data.profile!.organization_name || '',
          business_type: data.profile!.business_type || 'dealer',
          terms_acknowledged: true,
          privacy_acknowledged: true,
          marketing_consent: Boolean(data.profile!.marketing_consent),
        }))
      }
      if (data.identity_session) {
        try {
          const c = await fetchRegistrationCandidates() as unknown as CandidatesResponse
          setCandidates(c.candidates)
        } catch {
          setCandidates(null)
        }
      } else {
        setCandidates(null)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load your registration status.')
    } finally {
      setLoading(false)
    }
  }, [fetchRegistrationJourney, fetchRegistrationCandidates])

  // Key the load effect on the user's id, not the user object: a context re-render that
  // rebuilds the user object must not re-run the initial fetch.
  const userId = user?.id
  useEffect(() => {
    if (!userId) {
      navigate('/login')
      return
    }
    // The shared request() helper flips its loading flag synchronously, so defer the
    // initial fetch by a microtask — the effect itself must not set state in its pass.
    queueMicrotask(() => { void load() })
  }, [userId, navigate, load])

  const identity = journey?.journey.steps.identity
  const countryCandidate = candidates?.available ? candidates.profile_candidates?.country_of_residence : undefined
  // Account type and business type are fixed once the profile exists (the server refuses a change).
  const identityFieldsFixed = Boolean(journey?.profile)

  const useCountryCandidate = () => {
    if (countryCandidate?.state === 'machine_candidate' && countryCandidate.value) {
      candidatesSeen.current.country_of_residence = countryCandidate.value
      setForm((current) => ({ ...current, country_of_residence: countryCandidate.value! }))
    }
  }

  const saveProfile = async () => {
    setSaving(true)
    try {
      const profile = {
        account_kind: form.account_kind,
        market_relationship: form.market_relationship,
        country_of_residence: form.country_of_residence.trim(),
        city: form.city.trim(),
        province: form.province.trim() || null,
        intended_use: form.intended_use,
        organization_name: form.account_kind === 'business' ? form.organization_name.trim() : null,
        business_type: form.account_kind === 'business' ? form.business_type : null,
        terms_acknowledged: form.terms_acknowledged,
        privacy_acknowledged: form.privacy_acknowledged,
        marketing_consent: form.marketing_consent,
      }
      const seen: Record<string, string> = {}
      if (candidatesSeen.current.country_of_residence) {
        seen.country_of_residence = candidatesSeen.current.country_of_residence
      }
      await saveRegistrationProfile({ profile, candidates_seen: Object.keys(seen).length ? seen : undefined })
      toast.success('Your registration details are saved.')
      setEditContext(false)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save your registration details.')
    } finally {
      setSaving(false)
    }
  }

  const startIdentity = async () => {
    setStarting(true)
    try {
      await createIdentitySession(docType)
      toast.success('Verification started — upload your identity document and selfie next.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start verification.')
    } finally {
      setStarting(false)
    }
  }

  const uploadSide = async (side: 'front' | 'back' | 'selfie', file: File | undefined) => {
    if (!file || !identity?.session_id) return
    const isSelfie = side === 'selfie'
    if (!ALLOWED_IMAGE_TYPES.has(file.type.toLowerCase())) {
      toast.error(isSelfie
        ? 'Unsupported selfie type. Take a photo or choose a JPG, PNG or WebP image.'
        : 'Unsupported document type. Take a photo or choose a JPG, PNG or WebP image.')
      return
    }
    if (file.size === 0) {
      toast.error(isSelfie
        ? 'This selfie file is empty or corrupt. Take a new selfie photo or choose another image.'
        : 'This identity document image is empty or corrupt. Take a clear photo or choose another image.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`${isSelfie ? 'Selfie' : 'Identity document'} is larger than 15 MB. Choose a smaller image.`)
      return
    }
    setUploadState((current) => ({ ...current, [side]: 'uploading' }))
    try {
      const dataUri = await readFileAsDataUri(file)
      if (!dataUri.includes(';base64,') || dataUri.endsWith(';base64,')) {
        throw new Error(`The selected ${isSelfie ? 'selfie' : 'identity document'} image is empty or corrupt.`)
      }
      await uploadIdentitySide(identity.session_id, side, dataUri)
      setUploadState((current) => ({ ...current, [side]: 'idle' }))
      await load()
    } catch (error) {
      setUploadState((current) => ({ ...current, [side]: 'error' }))
      const fallback = isSelfie
        ? 'Could not upload the selfie. Take a new photo or choose another JPG, PNG or WebP image.'
        : 'Could not upload the identity document. Take a clear photo or choose another JPG, PNG or WebP image.'
      toast.error(error instanceof Error ? error.message : fallback)
    }
  }

  const submitIdentity = async () => {
    if (!identity?.session_id) return
    setSubmitting(true)
    try {
      await submitIdentitySession(identity.session_id)
      toast.success('Documents submitted. CarUp will process them and a reviewer will decide.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not submit your documents.')
    } finally {
      setSubmitting(false)
    }
  }

  const identityBadge = useMemo(() => {
    switch (identity?.state) {
      case 'approved': return <Badge className="bg-green-600 text-white" data-testid="identity-state">Verified</Badge>
      case 'rejected': return <Badge className="bg-red-700 text-white" data-testid="identity-state">Closed by reviewer</Badge>
      case 'action_required': return <Badge className="bg-amber-600 text-white" data-testid="identity-state">Your action needed</Badge>
      case 'processing': return <Badge className="bg-blue-600 text-white" data-testid="identity-state">Processing</Badge>
      case 'in_review': return <Badge className="bg-blue-800 text-white" data-testid="identity-state">In human review</Badge>
      case 'not_started': return <Badge variant="outline" className="border-input text-foreground" data-testid="identity-state">Not started</Badge>
      // The current identity standing — the server's subject-safe codes, never internal states.
      case 'reverification_required': return <Badge className="bg-amber-600 text-white" data-testid="identity-state">Re-verification required</Badge>
      case 'on_hold': return <Badge className="bg-red-800 text-white" data-testid="identity-state">On hold</Badge>
      case 'security_review': return <Badge className="bg-red-800 text-white" data-testid="identity-state">Security review</Badge>
      case 'disputed': return <Badge className="bg-amber-700 text-white" data-testid="identity-state">Under review</Badge>
      case 'revoked': return <Badge className="bg-red-900 text-white" data-testid="identity-state">No longer verified</Badge>
      default: return <Badge variant="outline" className="border-input text-foreground" data-testid="identity-state">{identity?.state || '—'}</Badge>
    }
  }, [identity?.state])

  if (loading) {
    return <div className="min-h-[45vh] bg-background px-4 py-6 text-base text-muted-foreground" data-testid="journey-loading">Loading your registration status…</div>
  }
  if (!journey) {
    return <div className="min-h-[45vh] bg-background px-4 py-6 text-base text-muted-foreground" data-testid="journey-unavailable">Your registration status is unavailable right now.</div>
  }

  const wizardOpen = identity && ['draft', 'capturing', 'ready_to_submit', 'action_required'].includes(identity.state)
  const showUploads = Boolean(wizardOpen && identity?.session_id)

  return (
    <div className="min-h-screen overflow-x-clip bg-background"><div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 pb-24 text-foreground sm:space-y-6 sm:px-6 sm:py-8 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">Finish setting up your CarUp account</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-input text-foreground" data-testid="who-must-act">{ACTOR_LABELS[journey.journey.who_must_act] || journey.journey.who_must_act}</Badge>
          {journey.user?.email_verified === false && <Badge className="bg-muted text-foreground">Email not yet verified</Badge>}
        </div>
        <p className="text-sm text-muted-foreground" data-testid="required-action">{journey.journey.required_action}</p>
      </header>

      {/* Progressive Trust ladder — server-derived; this page never decides. */}
      <Card className="bg-card border-border">
        <CardContent className="space-y-3 p-4 sm:p-5">
          <h2 className="font-medium">Your progress</h2>
          <ol className="space-y-2">
            {journey.journey.capability_ladder.map((stage) => (
              <li key={stage.stage} className="flex items-start gap-2" data-testid={`stage-${stage.stage}`}>
                {stage.reached
                  ? <CheckCircle className="mt-0.5 h-4 w-4 text-green-500" aria-hidden />
                  : <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />}
                <div>
                  <div className={stage.reached ? 'text-foreground' : 'text-muted-foreground'}>
                    {STAGE_LABELS[stage.stage] || stage.stage}
                  </div>
                  <div className="text-xs text-muted-foreground">{stage.unlocks.map((u) => u.replace(/_/g, ' ')).join(' · ')}</div>
                </div>
              </li>
            ))}
          </ol>
          {journey.journey.capability_ladder.some((s) => s.stage === 'contact_context_established' && s.reached && s.unlocks.includes('prepare_dealer_onboarding')) && (
            <Button size="sm" variant="outline" onClick={() => navigate('/dealer/onboarding')} data-testid="start-dealer-onboarding">
              Start Dealer onboarding
            </Button>
          )}
          <div className="border-t border-border pt-3 space-y-1">
            {journey.journey.locked_capabilities.map((lock) => (
              <div key={lock.capability} className="flex items-start gap-2 text-xs text-muted-foreground" data-testid={`locked-${lock.capability}`}>
                <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                <span>
                  <span className="text-muted-foreground">{lock.capability.replace(/_/g, ' ')}</span>
                  {' — '}{lock.reason}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Contact & context — the confirmed data lives in the Registration Profile. */}
      <Card className="bg-card border-border">
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Contact & context</h2>
            {journey.journey.steps.context_established && !editContext && (
              <Button variant="ghost" size="sm" onClick={() => setEditContext(true)} data-testid="edit-context">Edit</Button>
            )}
          </div>

          {journey.journey.steps.context_established && !editContext ? (
            <dl className="grid grid-cols-2 gap-2 text-sm" data-testid="context-summary">
              <dt className="text-muted-foreground">Account</dt><dd>{journey.profile?.account_kind}</dd>
              {journey.profile?.account_kind === 'business' && (
                <><dt className="text-muted-foreground">Business type</dt><dd>{businessTypeLabel(journey.profile?.business_type)}</dd></>
              )}
              <dt className="text-muted-foreground">Market</dt><dd>{journey.profile?.market_relationship?.replace(/_/g, ' ')}</dd>
              <dt className="text-muted-foreground">Country</dt><dd>{journey.profile?.country_of_residence}</dd>
              <dt className="text-muted-foreground">City</dt><dd>{journey.profile?.city}</dd>
            </dl>
          ) : (
            <div className="space-y-3" data-testid="context-form">
              <p className="text-xs text-muted-foreground">
                You can complete this at any time — an OCR problem never blocks it.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {identityFieldsFixed ? (
                  <div className="text-sm space-y-1 sm:col-span-2" data-testid="fixed-identity-fields">
                    <span className="text-muted-foreground">Account type</span>
                    <p className="font-medium">
                      {form.account_kind === 'business' ? `Business — ${businessTypeLabel(form.business_type)}` : 'Individual'}
                    </p>
                    <p className="text-xs text-muted-foreground">Set when you registered. To change it, contact CarUp support.</p>
                  </div>
                ) : (
                  <label className="text-sm space-y-1">
                    <span className="text-muted-foreground">Account type</span>
                    <select className={fieldClass} value={form.account_kind} data-testid="account-kind"
                      onChange={(e) => setForm({ ...form, account_kind: e.target.value })}>
                      <option value="individual">Individual</option>
                      <option value="business">Business</option>
                    </select>
                  </label>
                )}
                <label className="text-sm space-y-1">
                  <span className="text-muted-foreground">Relationship to Zimbabwe market</span>
                  <select className={fieldClass} value={form.market_relationship}
                    onChange={(e) => setForm({ ...form, market_relationship: e.target.value })}>
                    <option value="zimbabwe_local">Living in Zimbabwe</option>
                    <option value="diaspora">Diaspora</option>
                    <option value="international">International</option>
                  </select>
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-muted-foreground">Country of residence</span>
                  <input className={fieldClass} value={form.country_of_residence} data-testid="country-input"
                    onChange={(e) => setForm({ ...form, country_of_residence: e.target.value })} />
                  {countryCandidate?.state === 'machine_candidate' && (
                    <button type="button" data-testid="use-country-candidate"
                      className="text-xs text-orange-400 underline"
                      onClick={useCountryCandidate}>
                      From your document: {countryCandidate.value} — use this
                    </button>
                  )}
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-muted-foreground">City</span>
                  <input className={fieldClass} value={form.city} data-testid="city-input"
                    onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-muted-foreground">Province (optional)</span>
                  <input className={fieldClass} value={form.province}
                    onChange={(e) => setForm({ ...form, province: e.target.value })} />
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-muted-foreground">How will you use CarUp?</span>
                  <select className={fieldClass} value={form.intended_use}
                    onChange={(e) => setForm({ ...form, intended_use: e.target.value })}>
                    <option value="buy">Buying</option>
                    <option value="sell">Selling</option>
                    <option value="buy_sell">Buying & selling</option>
                    <option value="professional_services">Professional services</option>
                  </select>
                </label>
                {form.account_kind === 'business' && (
                  <>
                    <label className="text-sm space-y-1">
                      <span className="text-muted-foreground">Business name</span>
                      <input className={fieldClass} value={form.organization_name}
                        onChange={(e) => setForm({ ...form, organization_name: e.target.value })} />
                    </label>
                    {!identityFieldsFixed && (
                      <label className="text-sm space-y-1">
                        <span className="text-muted-foreground">Business type</span>
                        <select className={fieldClass} value={form.business_type} data-testid="business-type"
                          onChange={(e) => setForm({ ...form, business_type: e.target.value })}>
                          {BUSINESS_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                    )}
                  </>
                )}
              </div>
              {form.account_kind === 'business' && (
                <p className="text-xs text-muted-foreground">
                  Business details route you into governed business onboarding — they never grant dealer or other professional access by themselves.
                </p>
              )}
              {!journey.journey.steps.context_established && (
                <div className="space-y-1 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={form.terms_acknowledged}
                      onChange={(e) => setForm({ ...form, terms_acknowledged: e.target.checked })} />
                    <span>I accept the Terms of Service</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={form.privacy_acknowledged}
                      onChange={(e) => setForm({ ...form, privacy_acknowledged: e.target.checked })} />
                    <span>I accept the Privacy Policy</span>
                  </label>
                </div>
              )}
              <Button className="min-h-11 w-full sm:w-auto" onClick={saveProfile} disabled={saving} data-testid="save-profile">
                {saving ? 'Saving…' : 'Save details'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Identity verification — evidence in, 7C case state back. */}
      <Card className="bg-card border-border">
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-medium">Identity verification</h2>
            {identityBadge}
          </div>
          <p className="text-sm text-muted-foreground" data-testid="identity-guidance">{identity?.guidance}</p>

          {(identity?.state === 'not_started' || identity?.state === 'reverification_required') && (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label className="w-full space-y-1 text-sm">
                <span className="text-muted-foreground">Document type</span>
                <select className={fieldClass} value={docType} onChange={(e) => setDocType(e.target.value)}>
                  <option value="national_id">Zimbabwe National ID</option>
                  <option value="passport">Passport</option>
                  <option value="driver_license">Driver's licence</option>
                </select>
              </label>
              <Button className="min-h-11 w-full sm:w-auto" onClick={startIdentity} disabled={starting} data-testid="start-identity">
                <Camera className="mr-1 h-4 w-4" aria-hidden />
                {starting ? 'Starting…' : identity?.state === 'reverification_required' ? 'Verify again' : 'Start verification'}
              </Button>
            </div>
          )}

          {identity && HOLD_STATES.has(identity.state) && (
            <div className="flex items-center gap-2 rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-200" data-testid="lifecycle-hold">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              <span>{ACTOR_LABELS[identity.who_must_act] || 'With CarUp review'} — identity-dependent features are paused meanwhile.</span>
            </div>
          )}

          {showUploads && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground" data-testid="identity-format-guidance">
                <p><span className="font-semibold text-foreground">Identity document and selfie:</span> JPG, PNG or WebP photos · Maximum 15 MB each</p>
                <p className="mt-1">HEIC/HEIF photos are not supported yet. On iPhone, choose a JPG or PNG photo instead.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="upload-tiles">
                {SIDES.filter(({ side }) => side !== 'back' || identity?.double_sided !== false).map(({ side, label }) => {
                  const uploaded = identity?.uploaded_sides?.[side]
                  const state = uploadState[side] || 'idle'
                  return (
                    <label key={side} className="block min-h-24 cursor-pointer rounded-lg border border-dashed border-input bg-background p-3 text-center text-sm shadow-sm"
                      data-testid={`upload-${side}`}>
                      <input type="file" accept={IMAGE_ACCEPT} className="hidden"
                        onChange={(e) => uploadSide(side, e.target.files?.[0])} />
                      <div className="flex flex-col items-center gap-1.5">
                        {uploaded
                          ? <CheckCircle className="h-5 w-5 text-green-600" aria-hidden />
                          : state === 'error'
                            ? <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />
                            : <Camera className="h-5 w-5 text-muted-foreground" aria-hidden />}
                        <span className="font-medium text-foreground">{label}</span>
                        <span className="text-xs text-muted-foreground">
                          {state === 'uploading' ? 'Uploading…'
                            : uploaded ? 'Uploaded — tap to replace'
                              : state === 'error' ? 'Failed — tap to retry'
                                : 'Take or choose a photo'}
                        </span>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {identity?.state === 'ready_to_submit' && (
            <Button className="min-h-11 w-full sm:w-auto" onClick={submitIdentity} disabled={submitting} data-testid="submit-identity">
              {submitting ? 'Submitting…' : 'Submit for verification'}
            </Button>
          )}
          {identity?.state === 'action_required' && showUploads && (
            <Button className="min-h-11 w-full sm:w-auto" onClick={submitIdentity} disabled={submitting} variant="outline" data-testid="resubmit-identity">
              <RefreshCw className="mr-1 h-4 w-4" aria-hidden />{submitting ? 'Submitting…' : 'Resubmit documents'}
            </Button>
          )}
          {(identity?.state === 'processing' || identity?.state === 'in_review') && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Hourglass className="h-4 w-4" aria-hidden />
              <span>{ACTOR_LABELS[identity.who_must_act] || identity.who_must_act}</span>
            </div>
          )}
          {identity?.state === 'approved' && (
            <div className="flex items-center gap-2 text-sm text-green-500">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              <span>Identity verified. Seller, dealer and other authorities still have their own separate steps.</span>
            </div>
          )}

          {candidates?.available && (
            <div className="space-y-2 border-t border-border pt-3" data-testid="candidates">
              <h3 className="text-sm font-medium">What we read from your document</h3>
              <p className="text-xs text-muted-foreground">
                Read by OCR as candidates only — a human reviewer decides verification. Nothing
                here is saved to your profile unless you use and save it yourself.
              </p>
              <dl className="grid grid-cols-2 gap-1 text-sm">
                {Object.entries(candidates.document_fields).map(([field, candidate]) => (
                  <React.Fragment key={field}>
                    <dt className="text-muted-foreground">{DOCUMENT_FIELD_LABELS[field] || field}</dt>
                    <dd data-testid={`candidate-${field}`}>
                      {candidate.state === 'machine_candidate'
                        ? candidate.value
                        : <span className="text-muted-foreground">Not read from document</span>}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            </div>
          )}
          {candidates && !candidates.available && candidates.reason && identity?.session_id && (
            <p className="text-xs text-muted-foreground" data-testid="candidates-unavailable">{candidates.reason}</p>
          )}
        </CardContent>
      </Card>
    </div></div>
  )
}
