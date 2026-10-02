import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import GarageEvidence from './GarageEvidence'
import {
  APPLICANT_RELATIONSHIPS,
  statusPresentation,
  type GarageApplication,
} from '@/lib/garageOnboarding'
import { useCarUpApi } from '@/hooks/useCarUpApi'

const SERVICE_CATEGORIES = [
  'general_service', 'engine', 'transmission', 'brakes', 'suspension', 'electrical',
  'diagnostics', 'bodywork', 'tyres', 'air_conditioning', 'exhaust', 'other',
] as const

type Envelope = {
  application?: GarageApplication | null
  blockers?: string[] | null
  editable?: boolean
  created?: boolean
}

export default function GarageSetup() {
  const {
    fetchMyGarageApplication,
    startGarageApplication,
    saveGarageApplication,
    submitGarageApplication,
  } = useCarUpApi()

  const [application, setApplication] = useState<GarageApplication | null>(null)
  const [blockers, setBlockers] = useState<string[] | null>(null)
  const [editable, setEditable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notApplicant, setNotApplicant] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<GarageApplication> & { attestation_accepted?: boolean }>({})
  const pending = useRef<Record<string, unknown>>({})
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const adopt = useCallback((raw: Record<string, unknown>) => {
    const res = raw as unknown as Envelope
    const app = res.application ?? null
    setApplication(app)
    setBlockers(res.blockers ?? null)
    setEditable(res.editable ?? Boolean(app && ['draft', 'information_required'].includes(app.status)))
    if (app) {
      setForm({
        trading_name: app.trading_name,
        address_line: app.address_line,
        location_city: app.location_city,
        location_province: app.location_province,
        contact_phone: app.contact_phone,
        contact_email: app.contact_email,
        service_categories: app.service_categories ?? [],
        applicant_relationship: app.applicant_relationship,
        attestation_accepted: Boolean(app.attestation_accepted_at),
      })
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchMyGarageApplication()
      adopt(res)
      setNotApplicant(false)
      setError(null)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not load your garage application.'
      if (/GARAGE_ONBOARDING_CONTEXT_REQUIRED/.test(message)) {
        setNotApplicant(true)
        setError(null)
      } else {
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }, [fetchMyGarageApplication, adopt])

  useEffect(() => { load() }, [load])
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  const queueSave = useCallback((patch: Record<string, unknown>) => {
    if (!application || !editable) return
    pending.current = { ...pending.current, ...patch }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const toSave = pending.current
      pending.current = {}
      try {
        const res = await saveGarageApplication(application.id, toSave)
        const env = res as unknown as Envelope
        setBlockers(env.blockers ?? null)
        setSavedAt(new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))
        setError(null)
      } catch (e) {
        pending.current = { ...toSave, ...pending.current }
        setError(e instanceof Error ? e.message : 'Your latest changes did not save.')
      }
    }, 700)
  }, [application, editable, saveGarageApplication])

  function setField(key: string, value: unknown) {
    setForm((current) => ({ ...current, [key]: value }))
    queueSave({ [key]: value })
  }

  function toggleCategory(category: string) {
    const current = (form.service_categories as string[] | undefined) ?? []
    setField(
      'service_categories',
      current.includes(category) ? current.filter((v) => v !== category) : [...current, category],
    )
  }

  async function begin() {
    setBusy(true); setError(null)
    try { adopt(await startGarageApplication()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start your application.') }
    finally { setBusy(false) }
  }

  async function submit() {
    if (!application) return
    setBusy(true); setError(null)
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      const patch = { ...pending.current }
      pending.current = {}
      if (Object.keys(patch).length) await saveGarageApplication(application.id, patch)
      const res = await submitGarageApplication(application.id)
      await load()
      if ((res as Record<string, unknown>).application) setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your application could not be submitted.')
    } finally { setBusy(false) }
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-600" role="status">Loading your garage setup…</div>
  }

  if (notApplicant) {
    return (
      <div className="p-6 max-w-3xl">
        <h1 className="text-2xl font-semibold text-gray-900">Garage setup</h1>
        <p className="mt-2 text-gray-600">
          Garage setup becomes available after your registration profile records a garage business.
        </p>
      </div>
    )
  }

  if (!application) {
    return (
      <div className="p-6 max-w-3xl">
        <h1 className="text-2xl font-semibold text-gray-900">Set up your garage</h1>
        <p className="mt-2 text-gray-600">
          Start with your business details. Automatic document reading is optional; every field can be typed manually.
        </p>
        {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
        <Button className="mt-5 min-h-11" onClick={begin} disabled={busy}>
          {busy ? 'Starting…' : 'Start garage application'}
        </Button>
      </div>
    )
  }

  const presentation = statusPresentation(application.status)
  const cats = (form.service_categories as string[] | undefined) ?? []

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6" data-testid="garage-c3-setup">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Set up your garage</h1>
        <p className="mt-1 text-sm text-gray-600">
          {presentation.label}. {presentation.next}
        </p>
        <p className="mt-2 text-xs text-gray-500">
          OCR is optional assistance. A machine suggestion never becomes your application until you choose it.
        </p>
      </header>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4" aria-labelledby="manual-fields">
        <div>
          <h2 id="manual-fields" className="font-medium text-gray-900">Your garage details</h2>
          <p className="text-sm text-gray-600 mt-1">You can complete all of these manually, whether OCR is available or not.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {([
            ['trading_name', 'Garage name'],
            ['address_line', 'Street address'],
            ['location_city', 'City'],
            ['location_province', 'Province'],
            ['contact_phone', 'Contact phone'],
            ['contact_email', 'Contact email'],
          ] as const).map(([key, label]) => (
            <label key={key} className="text-sm text-gray-700">
              <span className="block mb-1 font-medium">{label}</span>
              <input
                value={String(form[key] ?? '')}
                onChange={(e) => setField(key, e.target.value)}
                disabled={!editable}
                className="w-full min-h-11 rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100"
                data-testid={`garage-field-${key}`}
              />
            </label>
          ))}
        </div>

        <label className="block text-sm text-gray-700">
          <span className="block mb-1 font-medium">Your relationship to the garage</span>
          <select
            value={String(form.applicant_relationship ?? '')}
            onChange={(e) => setField('applicant_relationship', e.target.value || null)}
            disabled={!editable}
            className="w-full min-h-11 rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100"
          >
            <option value="">Choose one</option>
            {APPLICANT_RELATIONSHIPS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

        <fieldset disabled={!editable}>
          <legend className="text-sm font-medium text-gray-700">Work your garage does</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            {SERVICE_CATEGORIES.map((category) => (
              <label key={category} className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={cats.includes(category)} onChange={() => toggleCategory(category)} />
                {category.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={Boolean(form.attestation_accepted)}
            disabled={!editable}
            onChange={(e) => setField('attestation_accepted', e.target.checked)}
            className="mt-1"
          />
          <span>I confirm these business details are true to the best of my knowledge.</span>
        </label>

        {savedAt && editable && <p className="text-xs text-gray-500">Saved at {savedAt}</p>}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <GarageEvidence
          applicationId={application.id}
          editable={editable}
          onUseValue={(field, value) => setField(field, value)}
          onChanged={() => {
            fetchMyGarageApplication()
              .then((res) => setBlockers((res as unknown as Envelope).blockers ?? null))
              .catch(() => {})
          }}
        />
      </section>

      <section className="rounded-xl border border-gray-200 bg-gray-50 p-5">
        <h2 className="font-medium text-gray-900">Before you submit</h2>
        {blockers?.length ? (
          <ul className="mt-2 list-disc pl-5 text-sm text-gray-700">
            {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-700">The currently measured submission requirements are complete.</p>
        )}
        {editable && (
          <Button className="mt-4 min-h-11" onClick={submit} disabled={busy}>
            {busy ? 'Submitting…' : 'Submit to CarUp for review'}
          </Button>
        )}
      </section>
    </div>
  )
}
