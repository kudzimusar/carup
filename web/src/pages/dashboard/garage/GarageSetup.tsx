import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, Clock, AlertCircle, XCircle } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { SERVICE_CATEGORIES } from '@/lib/serviceRequests'
import { SN_PAGE, SN_FORM_COLUMN } from '@/lib/serviceNetworkLayout'
import GarageEvidence from './GarageEvidence'
import {
  APPLICANT_RELATIONSHIPS,
  STATUS_TONE_CLASS,
  setupSteps,
  statusPresentation,
  type GarageApplication,
  type SetupStep,
} from '@/lib/garageOnboarding'

/**
 * GMO-1 — "Finish setting up your garage".
 *
 * The surface a garage applicant never had. Before this, registering as a garage produced a correct,
 * safe account and a dead end with no way forward and no way to see the state you were in.
 *
 * It is one page in two moods, because they are the same object at different moments: while the
 * applicant owns the form it is a form, and once CarUp owns it it is a status. Splitting them into
 * two routes would mean a person waiting on a decision has nowhere that is "theirs".
 *
 * Nothing here grants anything. Submitting hands the application to a reviewer; only an approved
 * decision, executed by the activation service, creates a garage.
 */

type LoadState = 'loading' | 'ready' | 'error'

const STEP_ICON: Record<SetupStep['state'], typeof CheckCircle2> = {
  complete: CheckCircle2,
  waiting: Clock,
  pending: Clock,
  blocked: XCircle,
}
const STEP_CLASS: Record<SetupStep['state'], string> = {
  complete: 'text-green-600',
  waiting: 'text-amber-500',
  pending: 'text-gray-400',
  blocked: 'text-gray-500',
}

export default function GarageSetup() {
  const {
    fetchMyGarageApplication, startGarageApplication,
    saveGarageApplication, submitGarageApplication,
  } = useCarUpApi()

  const [application, setApplication] = useState<GarageApplication | null>(null)
  const [blockers, setBlockers] = useState<string[] | null>(null)
  const [editable, setEditable] = useState(false)
  const [state, setState] = useState<LoadState>('loading')
  const [notAnApplicant, setNotAnApplicant] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  // `null` means "not measured yet" and renders as such. A 0 here would tell a person who uploaded
  // three documents that they have none.
  const [evidenceCount, setEvidenceCount] = useState<number | null>(null)

  // Local form state so typing stays responsive; autosave reconciles it with the server.
  const [form, setForm] = useState<Partial<GarageApplication> & { attestation_accepted?: boolean }>({})
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const adopt = useCallback((res: { application?: GarageApplication | null; blockers?: string[] | null; editable?: boolean }) => {
    const app = res?.application ?? null
    setApplication(app)
    setBlockers(res?.blockers ?? null)
    setEditable(res?.editable ?? statusPresentation(app?.status ?? 'draft').editable)
    if (app) {
      setForm({
        trading_name: app.trading_name, address_line: app.address_line,
        location_city: app.location_city, location_province: app.location_province,
        contact_phone: app.contact_phone, contact_email: app.contact_email,
        applicant_relationship: app.applicant_relationship,
        service_categories: app.service_categories ?? [],
        attestation_accepted: Boolean(app.attestation_accepted_at),
      })
    }
  }, [])

  const load = useCallback(() => {
    fetchMyGarageApplication()
      .then((res) => { adopt(res); setState('ready') })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : ''
        // Refusing because this person never declared a garage business is a DIFFERENT fact from a
        // failed read, and the page must not show one as the other.
        if (/GARAGE_ONBOARDING_CONTEXT_REQUIRED/.test(message)) { setNotAnApplicant(true); setState('ready') }
        else setState('error')
      })
  }, [fetchMyGarageApplication, adopt])

  useEffect(() => { load() }, [load])

  /**
   * Evidence changed, so the server's blocker list changed with it.
   *
   * This refreshes the blockers WITHOUT calling `load()`, which would re-adopt the server row into
   * the form — and a person who typed their garage name and then uploaded a photo before the
   * 900ms autosave landed would watch their typing disappear. A failed refresh keeps the last
   * known blockers rather than inventing an empty list.
   */
  const handleEvidenceChanged = useCallback((count: number) => {
    setEvidenceCount(count)
    fetchMyGarageApplication()
      .then((res) => setBlockers(res?.blockers ?? null))
      .catch(() => { /* the previous blockers remain the best thing we know */ })
  }, [fetchMyGarageApplication])

  /** Autosave at a meaningful boundary, not on every keystroke. */
  const queueSave = useCallback((patch: Record<string, unknown>) => {
    if (!application || !editable) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveGarageApplication(application.id, patch)
        .then((res) => {
          setBlockers(res?.blockers ?? null)
          setSavedAt(new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))
          setError(null)
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'That did not save.'))
    }, 900)
  }, [application, editable, saveGarageApplication])

  function setField(key: string, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }))
    queueSave({ [key]: value })
  }

  function toggleCategory(value: string) {
    const current = (form.service_categories as string[] | undefined) ?? []
    const next = current.includes(value) ? current.filter((c) => c !== value) : [...current, value]
    setField('service_categories', next)
  }

  async function begin() {
    setBusy(true); setError(null)
    try { adopt(await startGarageApplication()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start your application.') }
    finally { setBusy(false) }
  }

  async function send() {
    if (!application) return
    setBusy(true); setError(null)
    try {
      // Flush any pending autosave first, or the submit validates a stale row.
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      await saveGarageApplication(application.id, {
        trading_name: form.trading_name, address_line: form.address_line,
        location_city: form.location_city, location_province: form.location_province,
        contact_phone: form.contact_phone, contact_email: form.contact_email,
        applicant_relationship: form.applicant_relationship,
        service_categories: form.service_categories ?? [],
        attestation_accepted: Boolean(form.attestation_accepted),
      })
      await submitGarageApplication(application.id)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your application could not be sent. Nothing was lost.')
    } finally { setBusy(false) }
  }

  async function reapply() {
    if (!application) return
    setBusy(true); setError(null)
    try { adopt(await startGarageApplication({ supersedes: application.id })) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start a new application.') }
    finally { setBusy(false) }
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-3 p-8" role="status" aria-live="polite">
        <Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
        <span className="text-sm text-gray-600">Loading your garage setup…</span>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className={`${SN_PAGE} ${SN_FORM_COLUMN}`}>
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center" data-testid="setup-error">
          <p className="font-semibold text-gray-800">Your garage setup could not be loaded</p>
          <p className="text-sm text-gray-500 mt-1">
            This is a loading problem, not a decision about your application.
          </p>
          <Button variant="outline" className="mt-4 min-h-11" onClick={() => { setState('loading'); load() }}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (notAnApplicant) {
    return (
      <div className={`${SN_PAGE} ${SN_FORM_COLUMN}`}>
        <div className="rounded-xl border border-gray-200 bg-white p-6" data-testid="not-a-garage-applicant">
          <h1 className="text-xl font-semibold">Garage setup is not open on this account</h1>
          <p className="text-sm text-gray-600 mt-2">
            Garage setup appears once your account records that you are applying for a garage
            business. If that is you, ask CarUp support to point you the right way.
          </p>
          <Link to="/dashboard"><Button variant="outline" className="mt-4 min-h-11">Back to my account</Button></Link>
        </div>
      </div>
    )
  }

  const presentation = statusPresentation(application?.status ?? 'draft')
  const steps = setupSteps(application, blockers, evidenceCount)
  const canSend = editable && Array.isArray(blockers) && blockers.length === 0

  return (
    <div className={`${SN_PAGE} ${SN_FORM_COLUMN}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {application?.trading_name || 'Set up your garage'}
          </h1>
          <p className="text-gray-500">Tell CarUp about your business so customers can find you</p>
        </div>
        {application && (
          <Badge className={STATUS_TONE_CLASS[presentation.tone]} data-testid="application-status">
            {presentation.label}
          </Badge>
        )}
      </div>

      {application && (
        <p className="text-sm text-gray-700" data-testid="application-next">{presentation.next}</p>
      )}

      {/* The checklist. Every step states what is actually known — no tick for something that has
          not happened, and no spinner standing in for a fact. */}
      {application && (
        <ol className="rounded-xl border border-gray-200 bg-white divide-y" data-testid="setup-steps">
          {steps.map((step) => {
            const Icon = STEP_ICON[step.state]
            return (
              <li key={step.label} className="flex items-start gap-3 p-4" data-testid="setup-step" data-state={step.state}>
                <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${STEP_CLASS[step.state]}`} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-medium text-sm">{step.label}</p>
                  <p className="text-sm text-gray-600">{step.detail}</p>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="setup-save-error">{error}</p>
      )}

      {!application && (
        <div className="rounded-xl border border-gray-200 bg-white p-6" data-testid="setup-start">
          <p className="font-semibold text-gray-900">Finish setting up your garage</p>
          <p className="text-sm text-gray-600 mt-1">
            CarUp needs a few details about your business before customers can send you work. You can
            save as you go and come back to it.
          </p>
          <Button
            className="mt-4 min-h-11 bg-orange-500 hover:bg-orange-600"
            onClick={begin} disabled={busy} data-testid="start-application"
          >
            {busy ? 'Starting…' : 'Start'}
          </Button>
        </div>
      )}

      {application && editable && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4" data-testid="application-form">
          <div>
            <label htmlFor="trading-name" className="block text-sm font-medium mb-1">What is the garage called?</label>
            <input
              id="trading-name" data-testid="field-trading-name"
              value={(form.trading_name as string) ?? ''}
              onChange={(e) => setField('trading_name', e.target.value)}
              className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm"
            />
          </div>

          <div>
            <label htmlFor="address" className="block text-sm font-medium mb-1">Where is it?</label>
            <input
              id="address" data-testid="field-address" placeholder="Street address"
              value={(form.address_line as string) ?? ''}
              onChange={(e) => setField('address_line', e.target.value)}
              className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm"
            />
            <div className="grid grid-cols-2 gap-3 mt-2">
              <input
                data-testid="field-city" placeholder="City" aria-label="City"
                value={(form.location_city as string) ?? ''}
                onChange={(e) => setField('location_city', e.target.value)}
                className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm"
              />
              <input
                data-testid="field-province" placeholder="Province (optional)" aria-label="Province"
                value={(form.location_province as string) ?? ''}
                onChange={(e) => setField('location_province', e.target.value)}
                className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="phone" className="block text-sm font-medium mb-1">Phone</label>
              <input
                id="phone" data-testid="field-phone" inputMode="tel"
                value={(form.contact_phone as string) ?? ''}
                onChange={(e) => setField('contact_phone', e.target.value)}
                className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                Email <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="email" data-testid="field-email" inputMode="email"
                value={(form.contact_email as string) ?? ''}
                onChange={(e) => setField('contact_email', e.target.value)}
                className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="relationship" className="block text-sm font-medium mb-1">
              What is your part in this business?
            </label>
            <select
              id="relationship" data-testid="field-relationship"
              value={(form.applicant_relationship as string) ?? ''}
              onChange={(e) => setField('applicant_relationship', e.target.value)}
              className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm"
            >
              <option value="">Choose one</option>
              {APPLICANT_RELATIONSHIPS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <fieldset>
            <legend className="block text-sm font-medium mb-2">What work do you do?</legend>
            <div className="flex flex-wrap gap-2" data-testid="field-categories">
              {SERVICE_CATEGORIES.filter((c) => c.value !== 'other').map((c) => {
                const on = ((form.service_categories as string[] | undefined) ?? []).includes(c.value)
                return (
                  <button
                    key={c.value} type="button" onClick={() => toggleCategory(c.value)}
                    aria-pressed={on} data-testid={`category-${c.value}`}
                    className={`min-h-11 px-3 rounded-full border text-sm ${
                      on ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-700 border-gray-300'
                    }`}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <label className="flex items-start gap-3 text-sm text-gray-700">
            <input
              type="checkbox" className="mt-1 h-4 w-4 rounded" data-testid="field-attestation"
              checked={Boolean(form.attestation_accepted)}
              onChange={(e) => setField('attestation_accepted', e.target.checked)}
            />
            <span>
              I confirm these details are true, and that I am allowed to act for this business.
            </span>
          </label>

          <div className="border-t pt-4">
            <GarageEvidence
              applicationId={application!.id}
              editable={editable}
              onChanged={handleEvidenceChanged}
              onUseValue={setField}
            />
          </div>

          <div className="border-t pt-4">
            {blockers && blockers.length > 0 && (
              <div className="text-sm text-gray-600 mb-3" data-testid="submission-blockers">
                <p className="font-medium text-gray-800">Before you can send this, add:</p>
                <ul className="list-disc pl-5 mt-1 space-y-0.5">
                  {blockers.map((b) => <li key={b}>{b}</li>)}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                className="min-h-11 bg-orange-500 hover:bg-orange-600"
                onClick={send} disabled={!canSend || busy} data-testid="submit-application"
              >
                {busy ? 'Sending…' : 'Send to CarUp'}
              </Button>
              {savedAt && (
                <span className="text-xs text-gray-500" data-testid="autosave-note">Saved at {savedAt}</span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Sending this does not make you a CarUp garage on its own. Someone reviews it first.
            </p>
          </div>
        </div>
      )}

      {application?.status === 'rejected' && (
        <div className="rounded-xl border border-gray-200 bg-white p-5" data-testid="rejected-panel">
          <p className="font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-gray-500" aria-hidden="true" /> This application was not approved
          </p>
          {application.decision_reason && (
            <p className="text-sm text-gray-700 mt-2 border-l-2 border-gray-200 pl-3" data-testid="rejection-reason">
              {application.decision_reason}
            </p>
          )}
          <p className="text-sm text-gray-600 mt-3">
            The record of this application stays as it is. You can start a new one that carries on
            from it.
          </p>
          <Button variant="outline" className="mt-4 min-h-11" onClick={reapply} disabled={busy} data-testid="reapply">
            {busy ? 'Starting…' : 'Start a new application'}
          </Button>
        </div>
      )}

      {application?.activated_tenant_id && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5" data-testid="activated-panel">
          <p className="font-semibold text-green-900">Your garage is ready</p>
          <p className="text-sm text-green-800 mt-1">
            You can now receive service requests from CarUp customers.
          </p>
          <Link to="/garage">
            <Button className="mt-4 min-h-11 bg-orange-500 hover:bg-orange-600" data-testid="open-workshop">
              Open my workshop
            </Button>
          </Link>
        </div>
      )}
    </div>
  )
}
