import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Container, Loader2, Plus, ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
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
  REQUESTED: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-200 text-gray-600',
}

function fillOf(container: DiasporaMarketplaceContainer) {
  const total = Number(container.total_capacity_volume || 0)
  const used = Number(container.used_capacity_volume || 0)
  const pct = total > 0 ? used / total : 0
  return { total, used, available: Math.max(total - used, 0), pct, readyToClose: pct >= 0.9, full: pct >= 0.98 }
}

function dateOf(value: unknown) {
  return value ? String(value).slice(0, 10) : 'TBD'
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
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8" data-testid="diaspora-container-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Diaspora Trade OS</Badge>
          <h1 className="mt-3 flex items-center gap-2 text-2xl font-semibold text-gray-950"><Container className="h-6 w-6 text-orange-600" /> Container co-loading</h1>
          <p className="mt-1 text-sm text-gray-500">Shared container capacity. Only approved reservations consume space; overfill is rejected server-side.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/diaspora/imports">Import orders</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/dashboard/communications">Communications</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/diaspora/rfq">Reverse RFQ</Link></Button>
        </div>
      </div>

      {isOperator && (
        <section className="mt-6 rounded-md border border-gray-200 bg-white p-5" data-testid="diaspora-container-create-section">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-950">Your containers</h2>
            <Button size="sm" variant={showCreate ? 'secondary' : 'default'} onClick={() => setShowCreate((s) => !s)} data-testid="diaspora-container-create-toggle">
              <Plus className="mr-1 h-4 w-4" /> {showCreate ? 'Hide form' : 'Create container'}
            </Button>
          </div>
          {showCreate && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="diaspora-container-create-form">
              <label className="text-sm text-gray-700">Origin country
                <Input value={createForm.origin_country} onChange={setCF('origin_country')} data-testid="create-origin-country" />
              </label>
              <label className="text-sm text-gray-700">Origin city
                <Input value={createForm.origin_city} onChange={setCF('origin_city')} placeholder="e.g. Yokohama" data-testid="create-origin-city" />
              </label>
              <label className="text-sm text-gray-700">Destination country
                <Input value={createForm.destination_country} onChange={setCF('destination_country')} data-testid="create-destination-country" />
              </label>
              <label className="text-sm text-gray-700">Destination city
                <Input value={createForm.destination_city} onChange={setCF('destination_city')} placeholder="e.g. Harare" data-testid="create-destination-city" />
              </label>
              <label className="text-sm text-gray-700">Planned departure
                <Input type="date" value={createForm.departure_date} onChange={setCF('departure_date')} data-testid="create-departure-date" />
              </label>
              <label className="text-sm text-gray-700">Booking deadline
                <Input type="date" value={createForm.booking_deadline} onChange={setCF('booking_deadline')} data-testid="create-booking-deadline" />
              </label>
              <label className="text-sm text-gray-700">Container type
                <select className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" value={createForm.container_type} onChange={setCF('container_type')} data-testid="create-container-type">
                  {CONTAINER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="text-sm text-gray-700">Total volume (CBM)
                <Input type="number" min="0" value={createForm.total_capacity_volume} onChange={setCF('total_capacity_volume')} placeholder="e.g. 66" data-testid="create-total-cbm" />
              </label>
              <label className="text-sm text-gray-700">Max weight (kg, optional)
                <Input type="number" min="0" value={createForm.total_capacity_weight} onChange={setCF('total_capacity_weight')} data-testid="create-max-weight" />
              </label>
              <label className="text-sm text-gray-700 sm:col-span-2 lg:col-span-3">Participant instructions / cargo eligibility notes (optional)
                <textarea className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" rows={2} value={createForm.participant_notes} onChange={setCF('participant_notes')} data-testid="create-participant-notes" />
              </label>
              {createError && <p className="text-sm font-medium text-red-700 sm:col-span-2 lg:col-span-3" data-testid="diaspora-container-create-error">{createError}</p>}
              <div className="sm:col-span-2 lg:col-span-3">
                <Button onClick={handleCreate} disabled={creating} data-testid="diaspora-container-create-submit">
                  {creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Create container
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-md border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-gray-950">Open containers</h2>
          {loading && <p className="mt-3 flex items-center gap-2 text-sm text-orange-700" data-testid="diaspora-container-loading"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
          {error && <Alert className="mt-3 border-red-200 bg-red-50" data-testid="diaspora-container-error"><AlertTriangle className="h-4 w-4 text-red-700" /><AlertDescription>{error}</AlertDescription></Alert>}
          {!loading && !error && containers.length === 0 && <p className="mt-3 text-sm text-gray-500" data-testid="diaspora-container-empty">No open containers.</p>}
          <div className="mt-3 space-y-3">
            {containers.map((c) => {
              const f = fillOf(c)
              return (
                <div key={c.id} className="rounded-md border border-gray-200 p-4" data-testid="diaspora-container-card">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-950">{c.origin_country} → {c.destination_country}</p>
                      <p className="text-xs text-gray-500">{c.container_type} · departs {dateOf(c.departure_date)} · book by {dateOf(c.booking_deadline)}</p>
                    </div>
                    <Badge variant="outline" data-testid="diaspora-container-status">{c.status}</Badge>
                  </div>
                  <div className="mt-2 text-sm text-gray-700">
                    Used {f.used} / {f.total} CBM · available {f.available} · <span data-testid="diaspora-container-fill">{(f.pct * 100).toFixed(0)}%</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div className={`h-full rounded-full ${f.full ? 'bg-red-500' : f.readyToClose ? 'bg-amber-500' : 'bg-orange-500'}`} style={{ width: `${Math.min(f.pct * 100, 100)}%` }} />
                  </div>
                  <div className="mt-1 flex gap-2">
                    {f.readyToClose && !f.full && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100" data-testid="diaspora-container-ready-to-close">Ready to close</Badge>}
                    {f.full && <Badge className="bg-red-100 text-red-800 hover:bg-red-100" data-testid="diaspora-container-full">Full</Badge>}
                  </div>
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => open(c)} data-testid="diaspora-container-open">Open</Button>
                </div>
              )
            })}
          </div>
        </section>

        <section className="rounded-md border border-gray-200 bg-white p-5">
          {selected ? (
            <div data-testid="diaspora-container-detail">
              <h2 className="text-lg font-semibold text-gray-950">{selected.origin_city ? `${selected.origin_city}, ` : ''}{selected.origin_country} → {selected.destination_city ? `${selected.destination_city}, ` : ''}{selected.destination_country}</h2>
              <p className="mt-1 text-xs text-gray-500">{selected.container_type} · departs {dateOf(selected.departure_date)} · booking deadline {dateOf(selected.booking_deadline)}</p>
              {selFill && (
                <p className="mt-1 text-sm text-gray-600" data-testid="diaspora-container-capacity-line">
                  Used {selFill.used}/{selFill.total} CBM · available {selFill.available} · {(selFill.pct * 100).toFixed(0)}%
                  {typeof maxWeight === 'number' || (typeof maxWeight === 'string' && maxWeight) ? ` · max weight ${maxWeight} kg` : ''}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500" data-testid="diaspora-container-counts">
                {counts.approved} approved · {counts.pending} pending
              </p>
              {typeof participantNotes === 'string' && participantNotes && (
                <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600" data-testid="diaspora-container-notes">
                  <span className="font-medium text-gray-800">Organiser notes:</span> {participantNotes}
                </div>
              )}

              {selected.status === 'BOOKING_OPEN' && (
                <div className="mt-3 rounded-md border border-orange-200 bg-orange-50 p-3">
                  <p className="text-sm font-medium text-orange-900">Request cargo space</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label className="text-xs text-orange-900">Cargo category
                      <select className="mt-1 block w-full rounded-md border border-orange-200 bg-white px-2 py-1.5 text-sm" value={cargoType} onChange={(e) => setCargoType(e.target.value)} data-testid="diaspora-container-reserve-category">
                        {CARGO_CATEGORIES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-orange-900">Volume (CBM) *
                      <Input type="number" min="0" placeholder="e.g. 12" value={volume} onChange={(e) => setVolume(e.target.value)} className="mt-1 bg-white" data-testid="diaspora-container-reserve-volume" />
                    </label>
                    <label className="text-xs text-orange-900 sm:col-span-2">Cargo description
                      <Input placeholder="e.g. Toyota Aqua 2018, or 10 boxed household items" value={cargoDescription} onChange={(e) => setCargoDescription(e.target.value)} className="mt-1 bg-white" data-testid="diaspora-container-reserve-description" />
                    </label>
                    <label className="text-xs text-orange-900">Est. weight (kg, optional)
                      <Input type="number" min="0" value={weight} onChange={(e) => setWeight(e.target.value)} className="mt-1 bg-white" data-testid="diaspora-container-reserve-weight" />
                    </label>
                    <div className="flex gap-2">
                      <label className="flex-1 text-xs text-orange-900">Declared value (optional)
                        <Input type="number" min="0" value={declaredValue} onChange={(e) => setDeclaredValue(e.target.value)} className="mt-1 bg-white" data-testid="diaspora-container-reserve-value" />
                      </label>
                      <label className="w-24 text-xs text-orange-900">Currency
                        <select className="mt-1 block w-full rounded-md border border-orange-200 bg-white px-2 py-1.5 text-sm" value={currency} onChange={(e) => setCurrency(e.target.value)} data-testid="diaspora-container-reserve-currency">
                          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </label>
                    </div>
                    {cargoType === 'vehicle' && (
                      <label className="text-xs text-orange-900 sm:col-span-2">Link your import order (optional)
                        <select className="mt-1 block w-full rounded-md border border-orange-200 bg-white px-2 py-1.5 text-sm" value={importOrderId} onChange={(e) => setImportOrderId(e.target.value)} data-testid="diaspora-container-reserve-order">
                          <option value="">No linked import order</option>
                          {(myOrders || []).map((o) => (
                            <option key={o.id} value={o.id}>
                              {[o.requested_make, o.requested_model].filter(Boolean).join(' ') || 'Import order'} · {String(o.id).slice(0, 8)} · {o.status}
                            </option>
                          ))}
                        </select>
                        {ordersUnreadable && <span className="mt-1 block text-[11px] text-amber-800">Your import orders could not be loaded right now — you can still request space without a link.</span>}
                      </label>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Button onClick={handleReserve} data-testid="diaspora-container-reserve-submit">Request</Button>
                  </div>
                  <p className="mt-2 text-[11px] leading-snug text-orange-800/80">
                    Declared value is recorded as declared, not verified. Selecting a category does not
                    constitute customs classification, dangerous-goods approval or shipping-line acceptance —
                    the organiser and carrier rules decide final eligibility.
                  </p>
                  {reserveError && <p className="mt-2 text-sm font-medium text-red-700" data-testid="diaspora-container-reserve-error">{reserveError}</p>}
                </div>
              )}
              {selected.status !== 'BOOKING_OPEN' && reserveError && (
                <p className="mt-2 text-sm font-medium text-red-700" data-testid="diaspora-container-reserve-error">{reserveError}</p>
              )}

              <h3 className="mt-4 text-base font-semibold text-gray-950">Reservations</h3>
              <div className="mt-2 overflow-x-auto rounded-md border border-gray-200" data-testid="diaspora-container-reservations">
                <Table>
                  <TableHeader><TableRow><TableHead>Cargo</TableHead><TableHead>Volume</TableHead><TableHead>Status</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {reservations.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="h-12 text-center text-gray-500" data-testid="container-reservations-state">
                    {reservationsUnreadable
                      ? 'Reservations could not be loaded. This is not a report that none exist.'
                      : 'No reservations.'}
                  </TableCell></TableRow>
                    ) : reservations.map((r) => (
                      <TableRow key={r.id} data-testid="diaspora-container-reservation-row">
                        <TableCell className="max-w-[180px]">
                          <span className="capitalize">{r.cargo_type || 'general'}</span>
                          {typeof r.cargo_description === 'string' && r.cargo_description && (
                            <span className="block truncate text-xs text-gray-500" title={r.cargo_description}>{r.cargo_description}</span>
                          )}
                        </TableCell>
                        <TableCell>{r.estimated_volume} CBM{r.estimated_weight ? <span className="block text-xs text-gray-500">{String(r.estimated_weight)} kg</span> : null}</TableCell>
                        <TableCell><Badge className={`${STATUS_STYLES[r.reservation_status] || ''} hover:bg-inherit`} variant="outline">{r.reservation_status}</Badge></TableCell>
                        <TableCell className="space-x-1 whitespace-nowrap">
                          {isOperator && r.reservation_status === 'REQUESTED' && (
                            <>
                              <Button size="sm" onClick={() => act(() => approveDiasporaMarketplaceReservation(r.id))} data-testid="diaspora-container-approve">Approve</Button>
                              <Button size="sm" variant="outline" onClick={() => act(() => rejectDiasporaMarketplaceReservation(r.id))} data-testid="diaspora-container-reject">Reject</Button>
                            </>
                          )}
                          {ownsReservation(r) && ['REQUESTED', 'APPROVED'].includes(r.reservation_status) && (
                            <Button size="sm" variant="ghost" onClick={() => act(() => cancelDiasporaMarketplaceReservation(r.id))} data-testid="diaspora-container-cancel">Cancel</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {isOperator && selected.status === 'BOOKING_OPEN' && (
                <div className="mt-3">
                  <Button variant="secondary" onClick={() => act(() => closeDiasporaContainerBooking(selected.id))} data-testid="diaspora-container-close-booking">Close booking</Button>
                  <p className="mt-1 text-[11px] text-gray-500">Closing stops new requests. It does not mean the container has departed, cleared customs, been paid for or been delivered.</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500" data-testid="diaspora-container-detail-empty">Select a container to request space.</p>
          )}
        </section>
      </div>
    </div>
  )
}
