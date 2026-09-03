/**
 * O2-X2 — Registration journey: Progressive Trust onboarding.
 *
 * The page is a VIEW over server truth. Everything it shows — steps, who-must-act, the
 * capability ladder, locked reasons, candidates — comes from the journey/candidates
 * endpoints on every load, so a refresh or re-login resumes exactly where the person
 * left off. OCR output renders strictly as CANDIDATES: a field the document did not
 * yield says so, a suggestion must be explicitly used, and every submitted value is the
 * user's own. Verification itself stays with the Phase 7C case — this page only feeds
 * evidence in and reports the case state back.
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
        lifecycle: {
          effective_state: string
          reason_code: string | null
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

const SIDES: Array<{ side: 'front' | 'back' | 'selfie'; label: string }> = [
  { side: 'front', label: 'Document front' },
  { side: 'back', label: 'Document back' },
  { side: 'selfie', label: 'Selfie' },
]

const fieldClass = 'w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100'

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

  useEffect(() => {
    if (!user) {
      navigate('/login')
      return
    }
    // The shared request() helper flips its loading flag synchronously, so defer the
    // initial fetch by a microtask — the effect itself must not set state in its pass.
    queueMicrotask(() => { void load() })
  }, [user, navigate, load])

  const identity = journey?.journey.steps.identity
  const countryCandidate = candidates?.available ? candidates.profile_candidates?.country_of_residence : undefined

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
      toast.success('Verification started — upload your document images next.')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start verification.')
    } finally {
      setStarting(false)
    }
  }

  const uploadSide = async (side: 'front' | 'back' | 'selfie', file: File | undefined) => {
    if (!file || !identity?.session_id) return
    if (file.size > 15 * 1024 * 1024) {
      toast.error('Images must be 15MB or smaller.')
      return
    }
    setUploadState((current) => ({ ...current, [side]: 'uploading' }))
    try {
      const dataUri = await readFileAsDataUri(file)
      await uploadIdentitySide(identity.session_id, side, dataUri)
      setUploadState((current) => ({ ...current, [side]: 'idle' }))
      await load()
    } catch (error) {
      // A failed upload is retryable in place — nothing else about the session is lost.
      setUploadState((current) => ({ ...current, [side]: 'error' }))
      toast.error(error instanceof Error ? error.message : `Could not upload the ${side} image — try again.`)
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
      case 'not_started': return <Badge variant="outline" data-testid="identity-state">Not started</Badge>
      // O2-X3 — current lifecycle states (labels stay applicant-safe).
      case 'reverification_required': return <Badge className="bg-amber-600 text-white" data-testid="identity-state">Re-verification required</Badge>
      case 'suspended': return <Badge className="bg-red-800 text-white" data-testid="identity-state">On hold</Badge>
      case 'compromised': return <Badge className="bg-red-800 text-white" data-testid="identity-state">Security review</Badge>
      case 'disputed': return <Badge className="bg-amber-700 text-white" data-testid="identity-state">Under dispute</Badge>
      case 'revoked': return <Badge className="bg-red-900 text-white" data-testid="identity-state">Revoked</Badge>
      default: return <Badge variant="outline" data-testid="identity-state">{identity?.state || '—'}</Badge>
    }
  }, [identity?.state])

  if (loading) {
    return <div className="p-8 text-gray-300" data-testid="journey-loading">Loading your registration status…</div>
  }
  if (!journey) {
    return <div className="p-8 text-gray-300">Your registration status is unavailable right now.</div>
  }

  const wizardOpen = identity && ['draft', 'capturing', 'ready_to_submit', 'action_required'].includes(identity.state)
  const showUploads = Boolean(wizardOpen && identity?.session_id)

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8 text-gray-100">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Finish setting up your CarUp account</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" data-testid="who-must-act">{ACTOR_LABELS[journey.journey.who_must_act] || journey.journey.who_must_act}</Badge>
          {journey.user?.email_verified === false && <Badge className="bg-gray-700">Email not yet verified</Badge>}
        </div>
        <p className="text-sm text-gray-400" data-testid="required-action">{journey.journey.required_action}</p>
      </header>

      {/* Progressive Trust ladder — server-derived; this page never decides. */}
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-4 space-y-3">
          <h2 className="font-medium">Your progress</h2>
          <ol className="space-y-2">
            {journey.journey.capability_ladder.map((stage) => (
              <li key={stage.stage} className="flex items-start gap-2" data-testid={`stage-${stage.stage}`}>
                {stage.reached
                  ? <CheckCircle className="mt-0.5 h-4 w-4 text-green-500" aria-hidden />
                  : <Circle className="mt-0.5 h-4 w-4 text-gray-600" aria-hidden />}
                <div>
                  <div className={stage.reached ? 'text-gray-100' : 'text-gray-400'}>
                    {STAGE_LABELS[stage.stage] || stage.stage}
                  </div>
                  <div className="text-xs text-gray-500">{stage.unlocks.map((u) => u.replace(/_/g, ' ')).join(' · ')}</div>
                </div>
              </li>
            ))}
          </ol>
          <div className="border-t border-gray-800 pt-3 space-y-1">
            {journey.journey.locked_capabilities.map((lock) => (
              <div key={lock.capability} className="flex items-start gap-2 text-xs text-gray-500" data-testid={`locked-${lock.capability}`}>
                <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                <span>
                  <span className="text-gray-400">{lock.capability.replace(/_/g, ' ')}</span>
                  {' — '}{lock.reason}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Contact & context — the confirmed data lives in the Registration Profile. */}
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Contact & context</h2>
            {journey.journey.steps.context_established && !editContext && (
              <Button variant="ghost" size="sm" onClick={() => setEditContext(true)}>Edit</Button>
            )}
          </div>

          {journey.journey.steps.context_established && !editContext ? (
            <dl className="grid grid-cols-2 gap-2 text-sm" data-testid="context-summary">
              <dt className="text-gray-500">Account</dt><dd>{journey.profile?.account_kind}</dd>
              <dt className="text-gray-500">Market</dt><dd>{journey.profile?.market_relationship?.replace(/_/g, ' ')}</dd>
              <dt className="text-gray-500">Country</dt><dd>{journey.profile?.country_of_residence}</dd>
              <dt className="text-gray-500">City</dt><dd>{journey.profile?.city}</dd>
            </dl>
          ) : (
            <div className="space-y-3" data-testid="context-form">
              <p className="text-xs text-gray-500">
                You can complete this at any time — an OCR problem never blocks it.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm space-y-1">
                  <span className="text-gray-400">Account type</span>
                  <select className={fieldClass} value={form.account_kind}
                    onChange={(e) => setForm({ ...form, account_kind: e.target.value })}>
                    <option value="individual">Individual</option>
                    <option value="business">Business</option>
                  </select>
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-gray-400">Relationship to Zimbabwe market</span>
                  <select className={fieldClass} value={form.market_relationship}
                    onChange={(e) => setForm({ ...form, market_relationship: e.target.value })}>
                    <option value="zimbabwe_local">Living in Zimbabwe</option>
                    <option value="diaspora">Diaspora</option>
                    <option value="international">International</option>
                  </select>
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-gray-400">Country of residence</span>
                  <input className={fieldClass} value={form.country_of_residence}
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
                  <span className="text-gray-400">City</span>
                  <input className={fieldClass} value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-gray-400">Province (optional)</span>
                  <input className={fieldClass} value={form.province}
                    onChange={(e) => setForm({ ...form, province: e.target.value })} />
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-gray-400">How will you use CarUp?</span>
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
                      <span className="text-gray-400">Business name</span>
                      <input className={fieldClass} value={form.organization_name}
                        onChange={(e) => setForm({ ...form, organization_name: e.target.value })} />
                    </label>
                    <label className="text-sm space-y-1">
                      <span className="text-gray-400">Business type</span>
                      <select className={fieldClass} value={form.business_type}
                        onChange={(e) => setForm({ ...form, business_type: e.target.value })}>
                        {['dealer', 'exporter', 'importer', 'garage', 'mechanic', 'parts_seller', 'insurer', 'lender', 'other'].map((t) => (
                          <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </div>
              {form.account_kind === 'business' && (
                <p className="text-xs text-gray-500">
                  Business details route you into Dealer onboarding later — they never grant dealer access by themselves.
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
              <Button onClick={saveProfile} disabled={saving} data-testid="save-profile">
                {saving ? 'Saving…' : 'Save details'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Identity verification — evidence in, 7C case state back. */}
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Identity verification</h2>
            {identityBadge}
          </div>
          <p className="text-sm text-gray-400" data-testid="identity-guidance">{identity?.guidance}</p>

          {(identity?.state === 'not_started' || identity?.state === 'reverification_required') && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm space-y-1">
                <span className="text-gray-400">Document type</span>
                <select className={fieldClass} value={docType} onChange={(e) => setDocType(e.target.value)}>
                  <option value="national_id">Zimbabwe National ID</option>
                  <option value="passport">Passport</option>
                  <option value="driver_license">Driver's licence</option>
                </select>
              </label>
              <Button onClick={startIdentity} disabled={starting} data-testid="start-identity">
                <Camera className="mr-1 h-4 w-4" aria-hidden />
                {starting ? 'Starting…' : identity?.state === 'reverification_required' ? 'Verify again' : 'Start verification'}
              </Button>
            </div>
          )}

          {(identity?.state === 'suspended' || identity?.state === 'compromised' || identity?.state === 'disputed' || identity?.state === 'revoked') && (
            <div className="flex items-center gap-2 rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-200" data-testid="lifecycle-hold">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              <span>{ACTOR_LABELS[identity.who_must_act] || 'With CarUp review'} — identity-dependent features are paused meanwhile.</span>
            </div>
          )}

          {showUploads && (
            <div className="grid gap-3 sm:grid-cols-3" data-testid="upload-tiles">
              {SIDES.filter(({ side }) => side !== 'back' || identity?.double_sided !== false).map(({ side, label }) => {
                const uploaded = identity?.uploaded_sides?.[side]
                const state = uploadState[side] || 'idle'
                return (
                  <label key={side} className="block cursor-pointer rounded-md border border-dashed border-gray-700 p-3 text-center text-sm"
                    data-testid={`upload-${side}`}>
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                      onChange={(e) => uploadSide(side, e.target.files?.[0])} />
                    <div className="flex flex-col items-center gap-1">
                      {uploaded
                        ? <CheckCircle className="h-5 w-5 text-green-500" aria-hidden />
                        : state === 'error'
                          ? <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />
                          : <Camera className="h-5 w-5 text-gray-500" aria-hidden />}
                      <span>{label}</span>
                      <span className="text-xs text-gray-500">
                        {state === 'uploading' ? 'Uploading…'
                          : uploaded ? 'Uploaded — tap to replace'
                            : state === 'error' ? 'Failed — tap to retry'
                              : 'Tap to upload'}
                      </span>
                    </div>
                  </label>
                )
              })}
            </div>
          )}

          {identity?.state === 'ready_to_submit' && (
            <Button onClick={submitIdentity} disabled={submitting} data-testid="submit-identity">
              {submitting ? 'Submitting…' : 'Submit for verification'}
            </Button>
          )}
          {identity?.state === 'action_required' && showUploads && (
            <Button onClick={submitIdentity} disabled={submitting} variant="outline" data-testid="resubmit-identity">
              <RefreshCw className="mr-1 h-4 w-4" aria-hidden />{submitting ? 'Submitting…' : 'Resubmit documents'}
            </Button>
          )}
          {(identity?.state === 'processing' || identity?.state === 'in_review') && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
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
            <div className="space-y-2 border-t border-gray-800 pt-3" data-testid="candidates">
              <h3 className="text-sm font-medium">What we read from your document</h3>
              <p className="text-xs text-gray-500">
                Extracted by OCR as candidates only — a human reviewer decides verification. Nothing
                here is saved to your profile unless you use and save it yourself.
              </p>
              <dl className="grid grid-cols-2 gap-1 text-sm">
                {Object.entries(candidates.document_fields).map(([field, candidate]) => (
                  <React.Fragment key={field}>
                    <dt className="text-gray-500">{DOCUMENT_FIELD_LABELS[field] || field}</dt>
                    <dd data-testid={`candidate-${field}`}>
                      {candidate.state === 'machine_candidate'
                        ? candidate.value
                        : <span className="text-gray-600">Not read from document</span>}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
