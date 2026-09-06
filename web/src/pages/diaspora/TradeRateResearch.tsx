/**
 * Trade OS T6.5 — the research / operations rate workspace.
 *
 * Deliberately austere, and deliberately not a marketplace. Every row leads with its provenance —
 * classification, source, and whether it is synthetic — because the failure this screen exists to
 * prevent is a research note being read later as a price a provider offered a customer.
 *
 * Access is PLATFORM authority, enforced server-side. Hiding the nav entry is not access control,
 * so the page also renders an honest refusal rather than a blank screen for anyone else.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'
import { useTradeLogisticsApi } from '@/hooks/useTradeLogisticsApi'
import { COST_STAGE_OPTIONS, BASIS_OPTIONS } from './commercialFormat'

const CLASSIFICATIONS: Array<[string, string]> = [
  ['PROVIDER_RATE_CARD', "A provider's published rate card"],
  ['OFFICIAL_FEE', 'An official / government fee'],
  ['RESEARCH_OBSERVATION', 'A researched market observation'],
  ['CARUP_ESTIMATE', "CarUp's own estimate"],
  ['HISTORICAL_ACTUAL', 'What a completed journey actually cost'],
]
const CLASSIFICATION_LABEL = Object.fromEntries(CLASSIFICATIONS)

const label = 'block min-w-0 text-xs font-medium uppercase tracking-wide text-slate-600'
const control = 'mt-1 block w-full min-w-0 border border-slate-300 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:outline-none'

const RESEARCH_ROLES = new Set(['admin', 'reviewer', 'super_admin', 'platform_admin'])

interface Observation {
  id: string; classification: string; is_synthetic: boolean; cost_stage: string; stage_label: string
  label: string; amount: number; currency: string; basis: string | null; unit: string | null
  effective_from: string; effective_to: string | null; source_name: string; source_reference: string | null
  corridor_id: string | null; mode: string | null; notes: string | null; status: string
}

const emptyDraft = () => ({
  classification: 'RESEARCH_OBSERVATION', cost_stage: 'MAIN_CARRIAGE', label: '',
  amount: '', currency: 'USD', basis: '', unit: '', effective_from: '', effective_to: '',
  source_name: '', source_reference: '', corridor_id: '', mode: '', notes: '', is_synthetic: true,
})

export default function TradeRateResearch() {
  const { user, loading: authLoading } = useAuth()
  const api = useTradeLogisticsApi()
  const [rows, setRows] = useState<Observation[]>([])
  const [corridors, setCorridors] = useState<Array<{ id: string; code: string; display_name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState(emptyDraft())

  const role = String(user?.role || '').toLowerCase()
  const mayResearch = RESEARCH_ROLES.has(role)

  const load = useCallback(async () => {
    if (!mayResearch) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      const [observations, corridorRows] = await Promise.all([
        api.listRateObservations(),
        api.listTradeCorridors().catch(() => []),
      ])
      setRows(observations as Observation[])
      setCorridors(corridorRows.map((c) => ({ id: c.id, code: c.code, display_name: c.display_name })))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rate observations could not be loaded')
    } finally { setLoading(false) }
  }, [api, mayResearch])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading) void load() }, [authLoading, load])

  const syntheticCount = useMemo(() => rows.filter((r) => r.is_synthetic).length, [rows])

  const save = async () => {
    setSaving(true); setError('')
    try {
      await api.recordRateObservation({
        ...draft,
        amount: Number(draft.amount),
        corridor_id: draft.corridor_id || undefined,
        effective_to: draft.effective_to || undefined,
        basis: draft.basis || undefined,
      })
      setDraft(emptyDraft()); setShowForm(false); await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The observation could not be recorded')
    } finally { setSaving(false) }
  }

  if (authLoading || loading) {
    return <div className="flex min-h-48 items-center justify-center text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  // An honest refusal, not a blank page — and the server refuses the data regardless of this.
  if (!mayResearch) {
    return (
      <section className="mx-auto w-full max-w-[1440px] min-w-0 px-4 py-10 sm:px-6 lg:px-10" data-testid="rate-research-denied">
        <h1 className="text-2xl font-bold text-slate-950">Rate research workspace</h1>
        <p className="mt-2 max-w-xl text-sm text-slate-600">
          This workspace is restricted to CarUp platform reviewers and administrators. It records what
          CarUp has learned about market rates, which is different from the offers providers make to
          customers.
        </p>
      </section>
    )
  }

  return (
    <section className="mx-auto w-full max-w-[1440px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="rate-research-workspace">
      <div className="border-b-2 border-slate-950 pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">CarUp operations</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">Rate research</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          What CarUp has learned about market rates, with its source. Nothing here is an offer a
          provider has made to a customer, and nothing here is shown on a customer screen as a price.
        </p>
      </div>

      {error && <Alert className="mt-4 border-red-200 bg-red-50"><AlertDescription>{error}</AlertDescription></Alert>}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-700" data-testid="rate-research-counts">
          {rows.length} observation{rows.length === 1 ? '' : 's'}
          {syntheticCount > 0 && (
            <span className="ml-2 font-semibold text-amber-900" data-testid="rate-research-synthetic-count">
              · {syntheticCount} synthetic
            </span>
          )}
        </p>
        <Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => setShowForm((v) => !v)} data-testid="rate-research-toggle-form">
          <Plus className="mr-1.5 h-4 w-4" /> {showForm ? 'Hide form' : 'Record an observation'}
        </Button>
      </div>

      {rows.length > 0 && syntheticCount === rows.length && (
        <p className="mt-3 border-l-2 border-amber-400 pl-3 text-xs text-amber-900" data-testid="rate-research-all-synthetic">
          Every observation recorded so far is synthetic certification data. No real market rates
          have been collected yet, and none of this may be presented as market economics.
        </p>
      )}

      {showForm && (
        <div className="mt-5 border border-slate-300 bg-white p-5" data-testid="rate-research-form">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className={label}>What kind of figure is this?
              <select className={control} value={draft.classification} onChange={(e) => setDraft({ ...draft, classification: e.target.value })} data-testid="rate-classification">
                {CLASSIFICATIONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
            <label className={label}>Cost type
              <select className={control} value={draft.cost_stage} onChange={(e) => setDraft({ ...draft, cost_stage: e.target.value })} data-testid="rate-cost-stage">
                {COST_STAGE_OPTIONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
            <label className={label}>Corridor (optional)
              <select className={control} value={draft.corridor_id} onChange={(e) => setDraft({ ...draft, corridor_id: e.target.value })} data-testid="rate-corridor">
                <option value="">Not corridor-specific</option>
                {corridors.map((c) => <option key={c.id} value={c.id}>{c.display_name} ({c.code})</option>)}
              </select>
            </label>
            <label className={`${label} lg:col-span-2`}>Describe it
              <Input className="mt-1 rounded-none" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="e.g. Yokohama → Beira, 40HC shared" data-testid="rate-label" />
            </label>
            <label className={label}>Mode (optional)
              <Input className="mt-1 rounded-none" value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value })} placeholder="e.g. shared_container" data-testid="rate-mode" />
            </label>
            <label className={label}>Amount
              <Input className="mt-1 rounded-none" type="number" min="0" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} data-testid="rate-amount" />
            </label>
            <label className={label}>Currency
              <Input className="mt-1 rounded-none" maxLength={3} value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} data-testid="rate-currency" />
            </label>
            <label className={label}>Charged per (optional)
              <select className={control} value={draft.basis} onChange={(e) => setDraft({ ...draft, basis: e.target.value })} data-testid="rate-basis">
                <option value="">Not stated</option>
                {BASIS_OPTIONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
            <label className={label}>Effective from
              <Input className="mt-1 rounded-none" type="date" value={draft.effective_from} onChange={(e) => setDraft({ ...draft, effective_from: e.target.value })} data-testid="rate-effective-from" />
            </label>
            <label className={label}>Effective to (optional)
              <Input className="mt-1 rounded-none" type="date" value={draft.effective_to} onChange={(e) => setDraft({ ...draft, effective_to: e.target.value })} data-testid="rate-effective-to" />
            </label>
            <label className={`${label} lg:col-span-2`}>Where did this come from?
              <Input className="mt-1 rounded-none" value={draft.source_name} onChange={(e) => setDraft({ ...draft, source_name: e.target.value })} placeholder="Provider name, publication, or agency" data-testid="rate-source-name" />
            </label>
            <label className={`${label} lg:col-span-2`}>Source reference (optional)
              <Input className="mt-1 rounded-none" value={draft.source_reference} onChange={(e) => setDraft({ ...draft, source_reference: e.target.value })} placeholder="URL, document reference or quote id" data-testid="rate-source-reference" />
            </label>
            <label className={`${label} lg:col-span-3`}>Notes and assumptions
              <textarea className={control} rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} data-testid="rate-notes" />
            </label>
          </div>
          <label className="mt-4 flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={draft.is_synthetic} onChange={(e) => setDraft({ ...draft, is_synthetic: e.target.checked })} data-testid="rate-is-synthetic" />
            <span>
              This is <strong>synthetic</strong> certification data, not a real market observation.
              <span className="block text-slate-500">Leave this ticked for anything invented for testing. A synthetic row stays labelled everywhere it appears.</span>
            </span>
          </label>
          <div className="mt-4">
            <Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => void save()} disabled={saving} data-testid="rate-save">
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Record observation
            </Button>
          </div>
        </div>
      )}

      <div className="mt-6">
        {rows.length === 0 ? (
          <div className="border border-dashed border-slate-300 p-8" data-testid="rate-research-empty">
            <p className="font-medium text-slate-900">No rate observations recorded</p>
            <p className="mt-1 max-w-xl text-sm text-slate-600">
              This is the honest state of the research programme: CarUp has not yet collected market
              rate data. Nothing is inferred in its absence.
            </p>
          </div>
        ) : (
          <div className="space-y-3" data-testid="rate-research-rows">
            {rows.map((r) => (
              <article key={r.id} className="border border-slate-300 bg-white p-4" data-testid="rate-observation-row">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-950">{r.label}</p>
                    <p className="mt-0.5 text-xs text-slate-600">{r.stage_label}{r.mode ? ` · ${r.mode}` : ''}</p>
                    <p className="mt-1 text-xs text-slate-700" data-testid="rate-observation-provenance">
                      <span className="font-semibold">{CLASSIFICATION_LABEL[r.classification] || r.classification}</span>
                      {' · source: '}{r.source_name}
                      {r.source_reference ? ` · ${r.source_reference}` : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Effective {r.effective_from}{r.effective_to ? ` to ${r.effective_to}` : ' — no expiry recorded'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-bold text-slate-950">{r.currency} {r.amount.toLocaleString()}</p>
                    {r.basis && <p className="text-xs text-slate-600">{BASIS_OPTIONS.find(([v]) => v === r.basis)?.[1] || r.basis}</p>}
                    {r.is_synthetic && (
                      <span className="mt-1 inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900" data-testid="rate-observation-synthetic">
                        SYNTHETIC — not market data
                      </span>
                    )}
                  </div>
                </div>
                {r.notes && <p className="mt-2 border-l-2 border-slate-200 pl-2 text-xs text-slate-600">{r.notes}</p>}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
