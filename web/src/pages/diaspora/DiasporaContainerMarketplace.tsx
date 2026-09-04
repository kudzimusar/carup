import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Container, Loader2, Plus, ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type {
  DiasporaImportOrder,
  DiasporaMarketplaceContainer,
  DiasporaMarketplaceContainerPayload,
  DiasporaMarketplaceReservation,
  DiasporaReservationRequestPayload,
} from '@/types'

/**
 * Container Co-Loading — Trade OS operational workspace.
 *
 * Design contract: root DESIGN.md (editorial workspace composition, navy/charcoal anchors,
 * restrained orange primary actions, one primary action per decision region, truthful data
 * states) with docs/marketplace/MARKETPLACE_VISUAL_DNA.md as the reference generation. This is
 * a logistics operating surface, not a Marketplace copy: route + capacity truth lead, tables
 * carry comparison density, and every state renders from authoritative records only.
 */

const allowedRoles = new Set(['owner', 'dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'reviewer'])
const reviewerRoles = new Set(['admin', 'platform_admin', 'super_admin', 'government', 'reviewer'])
// Server-verified tenant membership roles that carry operator authority (mirrors TENANT_ADMIN_ROLES
// in backend diasporaAuthorization; the backend re-verifies on every call — this only shapes the UI).
const tenantOperatorRoles = new Set(['admin', 'administrator', 'tenant_admin'])

const CARGO_CATEGORIES: Array<[string, string]> = [
  ['vehicle', 'Vehicle'],
  ['parts', 'Vehicle parts'],
  ['household', 'Household / personal effects'],
  ['general', 'General eligible cargo'],
  ['other', 'Other eligible cargo'],
]

const CONTAINER_TYPES = ['40HC', '40ft', '20ft']
const CURRENCIES = ['USD', 'JPY', 'ZWG', 'ZAR', 'GBP', 'EUR']

const STATUS_STYLES: Record<string, string> = {
  REQUESTED: 'border-amber-300 bg-amber-50 text-amber-900',
  APPROVED: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  REJECTED: 'border-red-300 bg-red-50 text-red-800',
  CANCELLED: 'border-gray-300 bg-gray-100 text-gray-600',
}

function StatusChip({ status, testid }: { status: string; testid?: string }) {
  return (
    <span
      data-testid={testid}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${STATUS_STYLES[status] || 'border-gray-300 bg-gray-50 text-gray-700'}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function fillOf(container: DiasporaMarketplaceContainer) {
  const total = Number(container.total_capacity_volume || 0)
  const used = Number(container.used_capacity_volume || 0)
  const pct = total > 0 ? used / total : 0
  return { total, used, available: Math.max(total - used, 0), pct, readyToClose: pct >= 0.9, full: pct >= 0.98 }
}

function CapacityMeter({ pct, full, readyToClose }: { pct: number; full: boolean; readyToClose: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden bg-gray-200" role="presentation">
      <div
        className={`h-full ${full ? 'bg-red-600' : readyToClose ? 'bg-amber-500' : 'bg-orange-500'}`}
        style={{ width: `${Math.min(pct * 100, 100)}%` }}
      />
    </div>
  )
}

function dateOf(value: unknown) {
  return value ? String(value).slice(0, 10) : 'TBD'
}

function routeLabel(c: DiasporaMarketplaceContainer) {
  const from = [c.origin_city, c.origin_country].filter(Boolean).join(', ')
  const to = [c.destination_city, c.destination_country].filter(Boolean).join(', ')
  return { from: from || String(c.origin_country || 'Origin'), to: to || String(c.destination_country || 'Destination') }
}

const EMPTY_CREATE = {
  origin_country: 'Japan',
  origin_city: '',
  destination_country: 'Zimbabwe',
  destination_city: '',
  departure_date: '',
  booking_deadline: '',
  container_type: '40HC',
  total_capacity_volume: '',
  total_capacity_weight: '',
  participant_notes: '',
}

const fieldLabel = 'block text-xs font-medium uppercase tracking-wide text-gray-600'
const selectClass = 'mt-1 block w-full border border-gray-300 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:outline-none'

export default function DiasporaContainerMarketplace() {
  const { user, isAuthenticated, loading: authLoading } = useAuth()
  const {
    fetchDiasporaMarketplaceContainers,
    createDiasporaMarketplaceContainer,
    fetchDiasporaContainerCapacity,
    fetchDiasporaContainerReservations,
    requestDiasporaReservation,
    approveDiasporaMarketplaceReservation,
    rejectDiasporaMarketplaceReservation,
    cancelDiasporaMarketplaceReservation,
    closeDiasporaContainerBooking,
    fetchDiasporaImportOrders,
  } = useCarUpApi()

  const role = (user?.role || '').toLowerCase()
  const canView = isAuthenticated && allowedRoles.has(role)
  const tenantOperator = Boolean(user?.active_tenant_id) && tenantOperatorRoles.has((user?.tenant_role || '').toLowerCase())
  const isOperator = reviewerRoles.has(role) || tenantOperator

  const [containers, setContainers] = useState<DiasporaMarketplaceContainer[]>([])
  const [selected, setSelected] = useState<DiasporaMarketplaceContainer | null>(null)
  const [reservations, setReservations] = useState<DiasporaMarketplaceReservation[]>([])
  const [reservationsUnreadable, setReservationsUnreadable] = useState(false)
  const [error, setError] = useState('')
  const [reserveError, setReserveError] = useState('')
  const [loading, setLoading] = useState(false)

  // Rich cargo request form (D4)
  const [cargoType, setCargoType] = useState('general')
  const [cargoDescription, setCargoDescription] = useState('')
  const [volume, setVolume] = useState('')
  const [weight, setWeight] = useState('')
  const [declaredValue, setDeclaredValue] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [importOrderId, setImportOrderId] = useState('')
  const [myOrders, setMyOrders] = useState<DiasporaImportOrder[] | null>(null)
  const [ordersUnreadable, setOrdersUnreadable] = useState(false)

  // Operator create-container form (D3)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ ...EMPTY_CREATE })
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    if (!canView) return
    setLoading(true)
    setError('')
    try {
      setContainers(await fetchDiasporaMarketplaceContainers())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load containers')
    } finally {
      setLoading(false)
    }
  }, [fetchDiasporaMarketplaceContainers, canView])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading && canView) void load() }, [authLoading, canView, load])

  // The vehicle import-order selector lists only THIS participant's own orders (server-scoped).
  useEffect(() => {
    if (!canView || cargoType !== 'vehicle' || myOrders !== null) return
    let live = true
    fetchDiasporaImportOrders()
      .then((orders) => { if (live) { setMyOrders(orders || []); setOrdersUnreadable(false) } })
      .catch(() => { if (live) { setMyOrders([]); setOrdersUnreadable(true) } })
    return () => { live = false }
  }, [canView, cargoType, myOrders, fetchDiasporaImportOrders])

  const open = async (container: DiasporaMarketplaceContainer) => {
    setSelected(container)
    setReserveError('')
    try {
      setReservations(await fetchDiasporaContainerReservations(container.id))
      setReservationsUnreadable(false)
    } catch {
      // A reviewer could otherwise close a booking believing nobody reserved space.
      setReservations([])
      setReservationsUnreadable(true)
    }
  }

  const refreshSelected = async (id?: string) => {
    const targetId = id || selected?.id
    if (!targetId) return
    const cap = await fetchDiasporaContainerCapacity(targetId)
    setSelected(cap.container)
    try {
      setReservations(await fetchDiasporaContainerReservations(targetId))
      setReservationsUnreadable(false)
    } catch {
      setReservations([])
      setReservationsUnreadable(true)
    }
    await load()
  }

  const handleReserve = async () => {
    if (!selected) return
    setReserveError('')
    const v = Number(volume)
    if (!(v > 0)) { setReserveError('Enter a positive volume'); return }
    const payload: DiasporaReservationRequestPayload = {
      estimated_volume: v,
      cargo_type: cargoType,
      source: 'ui',
    }
    if (cargoDescription.trim()) payload.cargo_description = cargoDescription.trim()
    if (weight && Number(weight) > 0) payload.estimated_weight = Number(weight)
    if (declaredValue && Number(declaredValue) > 0) { payload.declared_value = Number(declaredValue); payload.currency = currency }
    if (cargoType === 'vehicle' && importOrderId) payload.import_order_id = importOrderId
    try {
      await requestDiasporaReservation(selected.id, payload)
      setVolume(''); setWeight(''); setDeclaredValue(''); setCargoDescription(''); setImportOrderId('')
      await refreshSelected()
    } catch (err) {
      setReserveError(err instanceof Error ? err.message : 'Reservation rejected')
    }
  }

  const handleCreate = async () => {
    setCreateError('')
    const f = createForm
    const missing = [
      ['origin_country', f.origin_country], ['origin_city', f.origin_city],
      ['destination_country', f.destination_country], ['destination_city', f.destination_city],
      ['departure_date', f.departure_date], ['booking_deadline', f.booking_deadline],
    ].filter(([, v]) => !String(v).trim()).map(([k]) => String(k).replace(/_/g, ' '))
    const totalVol = Number(f.total_capacity_volume)
    if (!(totalVol > 0)) missing.push('total CBM (must be positive)')
    if (missing.length) { setCreateError(`Required: ${missing.join(', ')}`); return }
    const payload: DiasporaMarketplaceContainerPayload = {
      origin_country: f.origin_country.trim(),
      origin_city: f.origin_city.trim(),
      destination_country: f.destination_country.trim(),
      destination_city: f.destination_city.trim(),
      departure_date: f.departure_date,
      booking_deadline: f.booking_deadline,
      container_type: f.container_type,
      total_capacity_volume: totalVol,
    }
    if (f.total_capacity_weight && Number(f.total_capacity_weight) > 0) payload.total_capacity_weight = Number(f.total_capacity_weight)
    if (f.participant_notes.trim()) payload.metadata = { participant_notes: f.participant_notes.trim() }
    setCreating(true)
    try {
      const created = await createDiasporaMarketplaceContainer(payload)
      setCreateForm({ ...EMPTY_CREATE })
      setShowCreate(false)
      await load()
      await refreshSelected(created.id)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Container creation failed')
    } finally {
      setCreating(false)
    }
  }

  const act = async (fn: () => Promise<unknown>) => {
    setReserveError('')
    try { await fn(); await refreshSelected() } catch (err) { setReserveError(err instanceof Error ? err.message : 'Action failed') }
  }

  const selFill = useMemo(() => (selected ? fillOf(selected) : null), [selected])
  const counts = useMemo(() => ({
    approved: reservations.filter((r) => r.reservation_status === 'APPROVED').length,
    pending: reservations.filter((r) => r.reservation_status === 'REQUESTED').length,
  }), [reservations])
  const userId = user?.id ? String(user.id) : ''
  const ownsReservation = (r: DiasporaMarketplaceReservation) =>
    Boolean(userId) && (String(r.buyer_id || '') === userId || String(r.created_by || '') === userId)
  const maxWeight = selected?.metadata?.total_capacity_weight
  const participantNotes = selected?.metadata?.participant_notes

  const setCF = (key: keyof typeof EMPTY_CREATE) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setCreateForm((prev) => ({ ...prev, [key]: e.target.value }))

  if (authLoading) return <div className="flex min-h-[50vh] items-center justify-center text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /></div>
  if (!canView) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16" data-testid="diaspora-container-access-denied">
        <Alert className="border-amber-200 bg-amber-50">
          <ShieldCheck className="h-4 w-4 text-amber-700" />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>The container marketplace requires an authorized trade role.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="bg-white" data-testid="diaspora-container-page">
      {/* ── Anchor band: identity, orientation, the one page-level primary action ── */}
      <header className="bg-slate-950 text-white">
        <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 lg:px-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-400">Diaspora Trade OS</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight sm:text-4xl">
                <Container className="h-8 w-8 text-orange-500" aria-hidden="true" /> Container Co-Loading
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                Shared container capacity between organiser and participants. Only approved reservations
                consume space — overfill is rejected by the server, never negotiated by the screen.
              </p>
            </div>
            {isOperator && (
              <div data-testid="diaspora-container-create-section">
                <Button
                  onClick={() => setShowCreate((s) => !s)}
                  data-testid="diaspora-container-create-toggle"
                  className="bg-orange-500 text-white hover:bg-orange-600"
                >
                  <Plus className="mr-1.5 h-4 w-4" /> {showCreate ? 'Hide create form' : 'Create container'}
                </Button>
              </div>
            )}
          </div>
          <nav className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-800 pt-4 text-sm">
            <Link to="/diaspora/imports" className="text-slate-300 transition-colors hover:text-orange-400">Import orders</Link>
            <Link to="/dashboard/communications" className="text-slate-300 transition-colors hover:text-orange-400">Communications</Link>
            <Link to="/diaspora/rfq" className="text-slate-300 transition-colors hover:text-orange-400">Reverse RFQ</Link>
          </nav>
        </div>
      </header>

      {/* ── Operator: create container (opened by the header action; one primary action) ── */}
      {isOperator && showCreate && (
        <section className="border-b border-gray-200 bg-gray-50">
          <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-10" data-testid="diaspora-container-create-form">
            <h2 className="text-lg font-bold text-gray-950">New shared container</h2>
            <p className="mt-1 text-sm text-gray-600">Route, dates and capacity are shown to participants exactly as entered. Nothing is substituted.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className={fieldLabel}>Origin country
                <Input className="mt-1 rounded-none" value={createForm.origin_country} onChange={setCF('origin_country')} data-testid="create-origin-country" />
              </label>
              <label className={fieldLabel}>Origin city
                <Input className="mt-1 rounded-none" value={createForm.origin_city} onChange={setCF('origin_city')} placeholder="e.g. Yokohama" data-testid="create-origin-city" />
              </label>
              <label className={fieldLabel}>Destination country
                <Input className="mt-1 rounded-none" value={createForm.destination_country} onChange={setCF('destination_country')} data-testid="create-destination-country" />
              </label>
              <label className={fieldLabel}>Destination city
                <Input className="mt-1 rounded-none" value={createForm.destination_city} onChange={setCF('destination_city')} placeholder="e.g. Harare" data-testid="create-destination-city" />
              </label>
              <label className={fieldLabel}>Planned departure
                <Input className="mt-1 rounded-none" type="date" value={createForm.departure_date} onChange={setCF('departure_date')} data-testid="create-departure-date" />
              </label>
              <label className={fieldLabel}>Booking deadline
                <Input className="mt-1 rounded-none" type="date" value={createForm.booking_deadline} onChange={setCF('booking_deadline')} data-testid="create-booking-deadline" />
              </label>
              <label className={fieldLabel}>Container type
                <select className={selectClass} value={createForm.container_type} onChange={setCF('container_type')} data-testid="create-container-type">
                  {CONTAINER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className={fieldLabel}>Total volume (CBM)
                <Input className="mt-1 rounded-none" type="number" min="0" value={createForm.total_capacity_volume} onChange={setCF('total_capacity_volume')} placeholder="e.g. 66" data-testid="create-total-cbm" />
              </label>
              <label className={fieldLabel}>Max weight (kg, optional)
                <Input className="mt-1 rounded-none" type="number" min="0" value={createForm.total_capacity_weight} onChange={setCF('total_capacity_weight')} data-testid="create-max-weight" />
              </label>
              <label className={`${fieldLabel} sm:col-span-2 lg:col-span-3`}>Participant instructions / cargo eligibility notes (optional)
                <textarea className={`${selectClass} rounded-none`} rows={2} value={createForm.participant_notes} onChange={setCF('participant_notes')} data-testid="create-participant-notes" />
              </label>
            </div>
            {createError && <p className="mt-3 text-sm font-medium text-red-700" data-testid="diaspora-container-create-error">{createError}</p>}
            <div className="mt-5">
              <Button onClick={handleCreate} disabled={creating} className="bg-orange-500 text-white hover:bg-orange-600" data-testid="diaspora-container-create-submit">
                {creating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null} Create container
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* ── Workspace: sailings on the left, selected container operations on the right ── */}
      <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[minmax(320px,2fr)_3fr]">
          <section aria-label="Open containers">
            <div className="flex items-baseline justify-between border-b-2 border-gray-950 pb-2">
              <h2 className="text-lg font-bold text-gray-950">Open sailings</h2>
              <span className="text-xs uppercase tracking-wide text-gray-500">{containers.length} open</span>
            </div>
            {loading && <p className="mt-4 flex items-center gap-2 text-sm text-orange-700" data-testid="diaspora-container-loading"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
            {error && <Alert className="mt-4 border-red-200 bg-red-50" data-testid="diaspora-container-error"><AlertTriangle className="h-4 w-4 text-red-700" /><AlertDescription>{error}</AlertDescription></Alert>}
            {!loading && !error && containers.length === 0 && (
              <p className="mt-4 text-sm text-gray-600" data-testid="diaspora-container-empty">
                No open containers. {isOperator ? 'Create the first sailing to open bookings.' : 'Check back when an organiser opens a sailing.'}
              </p>
            )}
            <div className="divide-y divide-gray-200">
              {containers.map((c) => {
                const f = fillOf(c)
                const r = routeLabel(c)
                const isSel = selected?.id === c.id
                return (
                  <article
                    key={c.id}
                    className={`py-5 pl-4 pr-2 transition-colors ${isSel ? 'border-l-4 border-orange-500 bg-gray-50' : 'border-l-4 border-transparent'}`}
                    data-testid="diaspora-container-card"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="flex items-center gap-2 font-semibold text-gray-950">
                          {r.from} <ArrowRight className="h-3.5 w-3.5 text-orange-500" aria-hidden="true" /> {r.to}
                        </p>
                        <p className="mt-0.5 font-mono text-xs text-gray-500">
                          {c.container_type} · departs {dateOf(c.departure_date)} · book by {dateOf(c.booking_deadline)}
                        </p>
                      </div>
                      <StatusChip status={c.status} testid="diaspora-container-status" />
                    </div>
                    <div className="mt-3">
                      <CapacityMeter pct={f.pct} full={f.full} readyToClose={f.readyToClose} />
                      <p className="mt-1.5 text-sm text-gray-700">
                        Used {f.used} / {f.total} CBM · available {f.available} · <span data-testid="diaspora-container-fill">{(f.pct * 100).toFixed(0)}%</span>
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {f.readyToClose && !f.full && <span className="border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900" data-testid="diaspora-container-ready-to-close">Ready to close</span>}
                      {f.full && <span className="border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800" data-testid="diaspora-container-full">Full</span>}
                    </div>
                    <Button size="sm" variant={isSel ? 'secondary' : 'outline'} className="mt-3 rounded-none" onClick={() => open(c)} data-testid="diaspora-container-open">
                      {isSel ? 'Selected' : 'Open'}
                    </Button>
                  </article>
                )
              })}
            </div>
          </section>

          <section aria-label="Selected container">
            {selected ? (
              <div data-testid="diaspora-container-detail">
                <div className="border-b-2 border-gray-950 pb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Selected sailing · <StatusChip status={selected.status} /></p>
                  <h2 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-gray-950">
                    {routeLabel(selected).from} <ArrowRight className="h-5 w-5 text-orange-500" aria-hidden="true" /> {routeLabel(selected).to}
                  </h2>
                  <p className="mt-1 font-mono text-xs text-gray-500">
                    {selected.container_type} · departs {dateOf(selected.departure_date)} · booking deadline {dateOf(selected.booking_deadline)}
                  </p>
                </div>

                {selFill && (
                  <div className="mt-4">
                    <CapacityMeter pct={selFill.pct} full={selFill.full} readyToClose={selFill.readyToClose} />
                    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm text-gray-800" data-testid="diaspora-container-capacity-line">
                        Used {selFill.used}/{selFill.total} CBM · available {selFill.available} · {(selFill.pct * 100).toFixed(0)}%
                        {typeof maxWeight === 'number' || (typeof maxWeight === 'string' && maxWeight) ? ` · max weight ${maxWeight} kg` : ''}
                      </p>
                      <p className="text-xs uppercase tracking-wide text-gray-500" data-testid="diaspora-container-counts">
                        {counts.approved} approved · {counts.pending} pending
                      </p>
                    </div>
                  </div>
                )}

                {typeof participantNotes === 'string' && participantNotes && (
                  <div className="mt-4 border-l-2 border-gray-300 pl-3 text-sm text-gray-600" data-testid="diaspora-container-notes">
                    <span className="font-semibold text-gray-900">Organiser notes:</span> {participantNotes}
                  </div>
                )}

                {selected.status === 'BOOKING_OPEN' && (
                  <div className="mt-6 border border-gray-200 bg-gray-50 p-5">
                    <h3 className="text-base font-bold text-gray-950">Request cargo space</h3>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <label className={fieldLabel}>Cargo category
                        <select className={selectClass} value={cargoType} onChange={(e) => setCargoType(e.target.value)} data-testid="diaspora-container-reserve-category">
                          {CARGO_CATEGORIES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                        </select>
                      </label>
                      <label className={fieldLabel}>Volume (CBM) — required
                        <Input className="mt-1 rounded-none bg-white" type="number" min="0" placeholder="e.g. 12" value={volume} onChange={(e) => setVolume(e.target.value)} data-testid="diaspora-container-reserve-volume" />
                      </label>
                      <label className={`${fieldLabel} sm:col-span-2`}>Cargo description
                        <Input className="mt-1 rounded-none bg-white" placeholder="e.g. Toyota Aqua 2018, or 10 boxed household items" value={cargoDescription} onChange={(e) => setCargoDescription(e.target.value)} data-testid="diaspora-container-reserve-description" />
                      </label>
                      <label className={fieldLabel}>Est. weight (kg, optional)
                        <Input className="mt-1 rounded-none bg-white" type="number" min="0" value={weight} onChange={(e) => setWeight(e.target.value)} data-testid="diaspora-container-reserve-weight" />
                      </label>
                      <div className="flex gap-3">
                        <label className={`${fieldLabel} flex-1`}>Declared value (optional)
                          <Input className="mt-1 rounded-none bg-white" type="number" min="0" value={declaredValue} onChange={(e) => setDeclaredValue(e.target.value)} data-testid="diaspora-container-reserve-value" />
                        </label>
                        <label className={`${fieldLabel} w-24`}>Currency
                          <select className={selectClass} value={currency} onChange={(e) => setCurrency(e.target.value)} data-testid="diaspora-container-reserve-currency">
                            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </label>
                      </div>
                      {cargoType === 'vehicle' && (
                        <label className={`${fieldLabel} sm:col-span-2`}>Link your import order (optional)
                          <select className={selectClass} value={importOrderId} onChange={(e) => setImportOrderId(e.target.value)} data-testid="diaspora-container-reserve-order">
                            <option value="">No linked import order</option>
                            {(myOrders || []).map((o) => (
                              <option key={o.id} value={o.id}>
                                {[o.requested_make, o.requested_model].filter(Boolean).join(' ') || 'Import order'} · {String(o.id).slice(0, 8)} · {o.status}
                              </option>
                            ))}
                          </select>
                          {ordersUnreadable && <span className="mt-1 block text-[11px] normal-case tracking-normal text-amber-800">Your import orders could not be loaded right now — you can still request space without a link.</span>}
                        </label>
                      )}
                    </div>
                    <div className="mt-4">
                      <Button onClick={handleReserve} className="bg-orange-500 text-white hover:bg-orange-600" data-testid="diaspora-container-reserve-submit">Request space</Button>
                    </div>
                    <p className="mt-3 max-w-xl text-[11px] leading-snug text-gray-500">
                      Declared value is recorded as declared, not verified. Selecting a category does not
                      constitute customs classification, dangerous-goods approval or shipping-line acceptance —
                      the organiser and carrier rules decide final eligibility.
                    </p>
                    {reserveError && <p className="mt-2 text-sm font-medium text-red-700" data-testid="diaspora-container-reserve-error">{reserveError}</p>}
                  </div>
                )}
                {selected.status !== 'BOOKING_OPEN' && reserveError && (
                  <p className="mt-3 text-sm font-medium text-red-700" data-testid="diaspora-container-reserve-error">{reserveError}</p>
                )}

                <div className="mt-8">
                  <div className="flex items-baseline justify-between border-b-2 border-gray-950 pb-2">
                    <h3 className="text-lg font-bold text-gray-950">Reservations</h3>
                  </div>
                  <div className="mt-3 overflow-x-auto border border-gray-200" data-testid="diaspora-container-reservations">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50">
                          <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-600">Cargo</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-600">Volume</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-600">Status</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-600">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reservations.length === 0 ? (
                          <TableRow><TableCell colSpan={4} className="h-12 text-center text-gray-500" data-testid="container-reservations-state">
                        {reservationsUnreadable
                          ? 'Reservations could not be loaded. This is not a report that none exist.'
                          : 'No reservations.'}
                      </TableCell></TableRow>
                        ) : reservations.map((r) => (
                          <TableRow key={r.id} data-testid="diaspora-container-reservation-row">
                            <TableCell className="max-w-[220px]">
                              <span className="font-medium capitalize text-gray-900">{r.cargo_type || 'general'}</span>
                              {typeof r.cargo_description === 'string' && r.cargo_description && (
                                <span className="block truncate text-xs text-gray-500" title={r.cargo_description}>{r.cargo_description}</span>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-sm">{r.estimated_volume} CBM{r.estimated_weight ? <span className="block text-xs text-gray-500">{String(r.estimated_weight)} kg</span> : null}</TableCell>
                            <TableCell><StatusChip status={r.reservation_status} /></TableCell>
                            <TableCell className="space-x-1.5 whitespace-nowrap">
                              {isOperator && r.reservation_status === 'REQUESTED' && (
                                <>
                                  <Button size="sm" className="rounded-none bg-orange-500 text-white hover:bg-orange-600" onClick={() => act(() => approveDiasporaMarketplaceReservation(r.id))} data-testid="diaspora-container-approve">Approve</Button>
                                  <Button size="sm" variant="outline" className="rounded-none" onClick={() => act(() => rejectDiasporaMarketplaceReservation(r.id))} data-testid="diaspora-container-reject">Reject</Button>
                                </>
                              )}
                              {ownsReservation(r) && ['REQUESTED', 'APPROVED'].includes(r.reservation_status) && (
                                <Button size="sm" variant="ghost" className="rounded-none text-gray-600" onClick={() => act(() => cancelDiasporaMarketplaceReservation(r.id))} data-testid="diaspora-container-cancel">Cancel</Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {isOperator && selected.status === 'BOOKING_OPEN' && (
                  <div className="mt-8 border-t border-gray-200 pt-5">
                    <Button variant="outline" className="rounded-none border-gray-400 text-gray-800" onClick={() => act(() => closeDiasporaContainerBooking(selected.id))} data-testid="diaspora-container-close-booking">Close booking</Button>
                    <p className="mt-2 max-w-xl text-[11px] leading-snug text-gray-500">
                      Closing stops new requests. It does not mean the container has departed, cleared customs,
                      been paid for or been delivered.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex min-h-[280px] items-center border border-dashed border-gray-300 px-8">
                <p className="text-sm text-gray-500" data-testid="diaspora-container-detail-empty">Select a sailing to see capacity, request space or manage reservations.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
