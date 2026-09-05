import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Container, Loader2, Plus, ShieldCheck, X } from 'lucide-react'
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
 * Container Co-Loading — the Trade OS booking workspace (owner-UAT correction cycle).
 *
 * Design contract: root DESIGN.md, rendered as a LOGISTICS OPERATIONS composition (corridor,
 * sailing, parties, cargo, capacity, decisions, stages) — same CarUp product language (navy
 * anchors via the workspace shell, restrained orange primary actions, truthful states), not a
 * Marketplace copy and not a marketing page. Runs inside TradeOSWorkspaceLayout; this page owns
 * no global chrome.
 */

const allowedRoles = new Set(['owner', 'dealer', 'admin', 'platform_admin', 'super_admin', 'government', 'reviewer'])
const reviewerRoles = new Set(['admin', 'platform_admin', 'super_admin', 'government', 'reviewer'])
const tenantOperatorRoles = new Set(['admin', 'administrator', 'tenant_admin'])

const CARGO_CATEGORIES: Array<[string, string]> = [
  ['vehicle', 'Vehicle'],
  ['parts', 'Vehicle parts'],
  ['household', 'Household / personal effects'],
  ['general', 'General eligible cargo'],
  ['other', 'Other eligible cargo'],
]

const ELIGIBLE_EXAMPLES = [
  'Vehicles', 'Vehicle parts', 'Household & personal effects', 'Furniture & appliances*',
  'Boxed goods', 'Machinery & equipment*', 'Commercial / general cargo', 'Other eligible cargo',
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
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${STATUS_STYLES[status] || 'border-gray-300 bg-gray-50 text-gray-700'}`}
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
  return value ? String(value).slice(0, 10) : null
}

function routeLabel(c: DiasporaMarketplaceContainer) {
  const from = [c.origin_city, c.origin_country].filter(Boolean).join(', ')
  const to = [c.destination_city, c.destination_country].filter(Boolean).join(', ')
  return { from: from || String(c.origin_country || 'Origin'), to: to || String(c.destination_country || 'Destination') }
}

/** A truthful shipment fact: value when recorded, honest absence otherwise. */
function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className={`truncate text-sm ${value ? 'text-gray-900' : 'italic text-gray-400'}`} title={value || undefined}>
        {value || 'Not recorded yet'}
      </dd>
    </div>
  )
}

/**
 * Truthful transaction stages (owner UAT #9): a stage is only "done"/"current" when authoritative
 * state supports it; downstream domains with no usable state say so instead of pretending.
 */
function StageStrip({ container, approvedCount, requestedTotal }: { container: DiasporaMarketplaceContainer; approvedCount: number; requestedTotal: number }) {
  const closed = container.status === 'BOOKING_CLOSED'
  const stages: Array<{ label: string; state: 'done' | 'current' | 'todo' | 'na'; note?: string }> = [
    { label: 'Booking open', state: closed ? 'done' : 'current' },
    { label: 'Space requested', state: requestedTotal > 0 ? 'done' : 'todo' },
    { label: 'Space approved', state: approvedCount > 0 ? 'done' : 'todo' },
    { label: 'Loading preparation', state: 'na', note: 'Not started' },
    { label: 'Booking closed', state: closed ? 'current' : 'todo' },
    { label: 'Shipment', state: 'na', note: 'Not connected' },
  ]
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-2" data-testid="diaspora-container-stages">
      {stages.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5 text-xs">
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${
              s.state === 'done' ? 'bg-emerald-600' : s.state === 'current' ? 'bg-orange-500' : s.state === 'todo' ? 'bg-gray-300' : 'border border-gray-300 bg-white'
            }`}
          />
          <span className={s.state === 'na' ? 'text-gray-400' : s.state === 'todo' ? 'text-gray-500' : 'font-medium text-gray-900'}>
            {s.label}
            {s.note ? <span className="ml-1 italic text-gray-400">({s.note})</span> : null}
          </span>
        </li>
      ))}
    </ol>
  )
}

interface MeasureItem { description: string; quantity: string; length: string; width: string; height: string; unit: 'cm' | 'm' }
const EMPTY_ITEM: MeasureItem = { description: '', quantity: '1', length: '', width: '', height: '', unit: 'cm' }

function itemCbm(item: MeasureItem): number {
  const factor = item.unit === 'cm' ? 0.01 : 1
  const l = Number(item.length) * factor
  const w = Number(item.width) * factor
  const h = Number(item.height) * factor
  const q = Number(item.quantity)
  if (!(l > 0 && w > 0 && h > 0 && q > 0)) return 0
  return l * w * h * q
}

const EMPTY_CREATE = {
  origin_country: 'Japan',
  origin_city: '',
  destination_country: 'Zimbabwe',
  destination_city: '',
  departure_date: '',
  booking_deadline: '',
  estimated_arrival_date: '',
  container_type: '40HC',
  total_capacity_volume: '',
  total_capacity_weight: '',
  origin_port: '',
  destination_port: '',
  loading_window: '',
  carrier_name: '',
  booking_reference: '',
  documentation_notes: '',
  participant_notes: '',
}

const fieldLabel = 'block min-w-0 text-xs font-medium uppercase tracking-wide text-gray-600'
const selectClass = 'mt-1 block w-full min-w-0 border border-gray-300 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:outline-none'

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
  // Loading is NOT empty: while the manifest is in flight the table must not claim "No
  // reservations." on a container that has bookings (DESIGN.md §8 data-state contract).
  const [reservationsLoading, setReservationsLoading] = useState(false)
  const [openBookingId, setOpenBookingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [reserveError, setReserveError] = useState('')
  const [loading, setLoading] = useState(false)

  // Cargo request (guided measurement — owner UAT #5)
  const [cargoType, setCargoType] = useState('general')
  const [cargoDescription, setCargoDescription] = useState('')
  const [measureMode, setMeasureMode] = useState<'known' | 'calc'>('known')
  const [volume, setVolume] = useState('')
  const [items, setItems] = useState<MeasureItem[]>([{ ...EMPTY_ITEM }])
  const [weight, setWeight] = useState('')
  const [declaredValue, setDeclaredValue] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [importOrderId, setImportOrderId] = useState('')
  const [myOrders, setMyOrders] = useState<DiasporaImportOrder[] | null>(null)
  const [ordersUnreadable, setOrdersUnreadable] = useState(false)

  // Operator create-container form
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
    setOpenBookingId(null)
    setReservations([])
    setReservationsUnreadable(false)
    setReservationsLoading(true)
    try {
      setReservations(await fetchDiasporaContainerReservations(container.id))
      setReservationsUnreadable(false)
    } catch {
      setReservations([])
      setReservationsUnreadable(true)
    } finally {
      setReservationsLoading(false)
    }
  }

  const refreshSelected = async (id?: string) => {
    const targetId = id || selected?.id
    if (!targetId) return
    const cap = await fetchDiasporaContainerCapacity(targetId)
    setSelected(cap.container)
    setReservationsLoading(true)
    try {
      setReservations(await fetchDiasporaContainerReservations(targetId))
      setReservationsUnreadable(false)
    } catch {
      setReservations([])
      setReservationsUnreadable(true)
    } finally {
      setReservationsLoading(false)
    }
    await load()
  }

  const computedCbm = useMemo(() => {
    const total = items.reduce((sum, item) => sum + itemCbm(item), 0)
    return Math.round((total + Number.EPSILON) * 1000) / 1000
  }, [items])

  const linkedOrder = useMemo(
    () => (importOrderId ? (myOrders || []).find((o) => String(o.id) === importOrderId) || null : null),
    [importOrderId, myOrders],
  )

  const handleReserve = async () => {
    if (!selected) return
    setReserveError('')
    const v = measureMode === 'calc' ? computedCbm : Number(volume)
    if (!(v > 0)) {
      setReserveError(measureMode === 'calc'
        ? 'Add at least one item with quantity, length, width and height so the volume can be calculated.'
        : 'Enter a positive volume')
      return
    }
    const payload: DiasporaReservationRequestPayload = {
      estimated_volume: v,
      cargo_type: cargoType,
      source: 'ui',
    }
    if (cargoDescription.trim()) payload.cargo_description = cargoDescription.trim()
    if (weight && Number(weight) > 0) payload.estimated_weight = Number(weight)
    if (declaredValue && Number(declaredValue) > 0) { payload.declared_value = Number(declaredValue); payload.currency = currency }
    if (cargoType === 'vehicle' && importOrderId) payload.import_order_id = importOrderId
    if (measureMode === 'calc') {
      payload.metadata = {
        measurement_mode: 'calculated',
        measurement_items: items.filter((i) => itemCbm(i) > 0).map((i) => ({
          description: i.description || null, quantity: Number(i.quantity), length: Number(i.length), width: Number(i.width), height: Number(i.height), unit: i.unit,
        })),
      }
    }
    try {
      await requestDiasporaReservation(selected.id, payload)
      setVolume(''); setWeight(''); setDeclaredValue(''); setCargoDescription(''); setImportOrderId('')
      setItems([{ ...EMPTY_ITEM }])
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
    const metadata: Record<string, unknown> = {}
    if (f.participant_notes.trim()) metadata.participant_notes = f.participant_notes.trim()
    if (f.origin_port.trim()) metadata.origin_port = f.origin_port.trim()
    if (f.destination_port.trim()) metadata.destination_port = f.destination_port.trim()
    if (f.loading_window.trim()) metadata.loading_window = f.loading_window.trim()
    if (f.carrier_name.trim()) metadata.carrier_name = f.carrier_name.trim()
    if (f.booking_reference.trim()) metadata.booking_reference = f.booking_reference.trim()
    if (f.documentation_notes.trim()) metadata.documentation_notes = f.documentation_notes.trim()
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
    if (f.estimated_arrival_date) payload.estimated_arrival_date = f.estimated_arrival_date
    if (f.total_capacity_weight && Number(f.total_capacity_weight) > 0) payload.total_capacity_weight = Number(f.total_capacity_weight)
    if (Object.keys(metadata).length) payload.metadata = metadata
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
  const meta = (selected?.metadata || {}) as Record<string, unknown>
  const metaText = (key: string): string | null => (typeof meta[key] === 'string' && meta[key] ? String(meta[key]) : null)
  const maxWeight = meta.total_capacity_weight
  const openBooking = openBookingId ? reservations.find((r) => r.id === openBookingId) || null : null

  const setCF = (key: keyof typeof EMPTY_CREATE) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setCreateForm((prev) => ({ ...prev, [key]: e.target.value }))
  const setItem = (index: number, key: keyof MeasureItem) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [key]: e.target.value } : item)))

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
    <div className="min-w-0 bg-white" data-testid="diaspora-container-page">
      {/* ── Purpose band: what this service is, for whom, with the ONE operator action ── */}
      <div className="border-b border-gray-200 bg-gray-50">
        <div className="mx-auto w-full max-w-[1440px] min-w-0 px-4 py-6 sm:px-6 lg:px-10">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-3xl">
              <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
                <Container className="h-7 w-7 shrink-0 text-orange-600" aria-hidden="true" /> Container Co-Loading
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-gray-700" data-testid="diaspora-container-purpose">
                Share space in a container with other participants. CarUp shared containers coordinate
                <strong> vehicles and other eligible goods</strong> that can legally and safely travel in the
                container — the organiser opens a sailing, participants request space, and every request,
                decision and capacity change stays on record.
              </p>
              <ul className="mt-3 flex flex-wrap gap-1.5" data-testid="diaspora-container-eligible-examples">
                {ELIGIBLE_EXAMPLES.map((example) => (
                  <li key={example} className="whitespace-nowrap rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-[11px] text-gray-700">{example}</li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] leading-snug text-gray-500">
                *where eligible — all cargo is subject to organiser/carrier, safety, customs and applicable
                legal requirements. CarUp is the coordination and record layer; the <strong>organiser</strong> operates
                the container, the <strong>participant</strong> reserves cargo space, and carriers/customs remain the
                external operational authorities.
              </p>
            </div>
            {isOperator && (
              <div className="shrink-0" data-testid="diaspora-container-create-section">
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
        </div>
      </div>

      {/* ── Operator: create container ── */}
      {isOperator && showCreate && (
        <section className="border-b border-gray-200 bg-white">
          <div className="mx-auto w-full max-w-[1440px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="diaspora-container-create-form">
            <h2 className="text-lg font-bold text-gray-950">New shared container</h2>
            <p className="mt-1 text-sm text-gray-600">Facts are shown to participants exactly as entered; anything left blank displays as “Not recorded yet”.</p>
            <div className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <label className={fieldLabel}>Origin country
                <Input className="mt-1 rounded-none" value={createForm.origin_country} onChange={setCF('origin_country')} data-testid="create-origin-country" />
              </label>
              <label className={fieldLabel}>Origin city
                <Input className="mt-1 rounded-none" value={createForm.origin_city} onChange={setCF('origin_city')} placeholder="e.g. Yokohama" data-testid="create-origin-city" />
              </label>
              <label className={fieldLabel}>Origin port / loading location (optional)
                <Input className="mt-1 rounded-none" value={createForm.origin_port} onChange={setCF('origin_port')} placeholder="e.g. Port of Yokohama" data-testid="create-origin-port" />
              </label>
              <label className={fieldLabel}>Destination country
                <Input className="mt-1 rounded-none" value={createForm.destination_country} onChange={setCF('destination_country')} data-testid="create-destination-country" />
              </label>
              <label className={fieldLabel}>Destination city
                <Input className="mt-1 rounded-none" value={createForm.destination_city} onChange={setCF('destination_city')} placeholder="e.g. Harare" data-testid="create-destination-city" />
              </label>
              <label className={fieldLabel}>Destination port / terminal (optional)
                <Input className="mt-1 rounded-none" value={createForm.destination_port} onChange={setCF('destination_port')} placeholder="e.g. via Beira, terminal Harare Dry Port" data-testid="create-destination-port" />
              </label>
              <label className={fieldLabel}>Booking deadline
                <Input className="mt-1 rounded-none" type="date" value={createForm.booking_deadline} onChange={setCF('booking_deadline')} data-testid="create-booking-deadline" />
              </label>
              <label className={fieldLabel}>Loading window (optional)
                <Input className="mt-1 rounded-none" value={createForm.loading_window} onChange={setCF('loading_window')} placeholder="e.g. 10–12 Oct, Yokohama warehouse" data-testid="create-loading-window" />
              </label>
              <label className={fieldLabel}>Planned departure
                <Input className="mt-1 rounded-none" type="date" value={createForm.departure_date} onChange={setCF('departure_date')} data-testid="create-departure-date" />
              </label>
              <label className={fieldLabel}>Expected arrival (optional)
                <Input className="mt-1 rounded-none" type="date" value={createForm.estimated_arrival_date} onChange={setCF('estimated_arrival_date')} data-testid="create-expected-arrival" />
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
              <label className={fieldLabel}>Carrier / forwarder (optional)
                <Input className="mt-1 rounded-none" value={createForm.carrier_name} onChange={setCF('carrier_name')} data-testid="create-carrier" />
              </label>
              <label className={fieldLabel}>Booking / container reference (optional)
                <Input className="mt-1 rounded-none" value={createForm.booking_reference} onChange={setCF('booking_reference')} data-testid="create-booking-reference" />
              </label>
              <label className={`${fieldLabel} sm:col-span-2 xl:col-span-3`}>Documentation requirements (optional)
                <textarea className={selectClass} rows={2} value={createForm.documentation_notes} onChange={setCF('documentation_notes')} placeholder="e.g. packing list and commercial invoice required per participant" data-testid="create-documentation-notes" />
              </label>
              <label className={`${fieldLabel} sm:col-span-2 xl:col-span-3`}>Participant instructions / cargo eligibility notes (optional)
                <textarea className={selectClass} rows={2} value={createForm.participant_notes} onChange={setCF('participant_notes')} data-testid="create-participant-notes" />
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

      {/* ── Workspace: sailings + selected sailing operations ── */}
      <div className="mx-auto w-full max-w-[1440px] min-w-0 px-4 py-8 sm:px-6 lg:px-10">
        <div className="grid min-w-0 gap-10 xl:grid-cols-[minmax(320px,2fr)_3fr]">
          <section className="min-w-0" aria-label="Open containers">
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
                    className={`min-w-0 py-5 pl-4 pr-2 transition-colors ${isSel ? 'border-l-4 border-orange-500 bg-gray-50' : 'border-l-4 border-transparent'}`}
                    data-testid="diaspora-container-card"
                    // Identity for test selection only — never read by the app. Certification must
                    // address the exact sailing it created, not "the first card" or one matched by
                    // a capacity string, both of which have silently read a stranger's container.
                    data-container-id={c.id}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex min-w-0 flex-wrap items-center gap-x-2 font-semibold text-gray-950">
                          <span className="truncate">{r.from}</span> <ArrowRight className="h-3.5 w-3.5 shrink-0 text-orange-500" aria-hidden="true" /> <span className="truncate">{r.to}</span>
                        </p>
                        {typeof c.organiser_name === 'string' && c.organiser_name && (
                          <p className="truncate text-xs text-gray-600" data-testid="diaspora-container-organiser">{c.organiser_name}</p>
                        )}
                        <p className="font-mono text-xs text-gray-500">
                          {c.container_type} · departs {dateOf(c.departure_date) || 'TBD'} · book by {dateOf(c.booking_deadline) || 'TBD'}
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

          <section className="min-w-0" aria-label="Selected container">
            {selected ? (
              <div className="min-w-0" data-testid="diaspora-container-detail">
                <div className="border-b-2 border-gray-950 pb-4">
                  <p className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                    Selected sailing <StatusChip status={selected.status} />
                  </p>
                  <h2 className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-gray-950">
                    <span className="truncate">{routeLabel(selected).from}</span>
                    <ArrowRight className="h-5 w-5 shrink-0 text-orange-500" aria-hidden="true" />
                    <span className="truncate">{routeLabel(selected).to}</span>
                  </h2>
                </div>

                {/* International shipment identity — truthful facts, honest absence (owner UAT #8) */}
                <dl className="mt-4 grid min-w-0 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3" data-testid="diaspora-container-shipment-facts">
                  <Fact label="Organiser" value={typeof selected.organiser_name === 'string' ? selected.organiser_name : null} />
                  <Fact label="Container" value={selected.container_type || null} />
                  <Fact label="Capacity" value={selFill ? `${selFill.total} CBM${maxWeight ? ` · max ${maxWeight} kg` : ''}` : null} />
                  <Fact label="Origin port / loading" value={metaText('origin_port')} />
                  <Fact label="Destination port / terminal" value={metaText('destination_port')} />
                  <Fact label="Carrier / forwarder" value={metaText('carrier_name')} />
                  <Fact label="Booking cut-off" value={dateOf(selected.booking_deadline)} />
                  <Fact label="Loading window" value={metaText('loading_window')} />
                  <Fact label="Planned departure" value={dateOf(selected.departure_date)} />
                  <Fact label="Expected arrival" value={dateOf(selected.estimated_arrival_date)} />
                  <Fact label="Reference" value={metaText('booking_reference')} />
                  <Fact label="Documentation" value={metaText('documentation_notes')} />
                </dl>

                {selFill && (
                  <div className="mt-5">
                    <CapacityMeter pct={selFill.pct} full={selFill.full} readyToClose={selFill.readyToClose} />
                    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm text-gray-800" data-testid="diaspora-container-capacity-line">
                        Used {selFill.used}/{selFill.total} CBM · available {selFill.available} · {(selFill.pct * 100).toFixed(0)}%
                      </p>
                      <p className="text-xs uppercase tracking-wide text-gray-500" data-testid="diaspora-container-counts">
                        {reservationsLoading
                          ? 'Counting bookings…'
                          : reservationsUnreadable
                            ? 'Booking counts unavailable'
                            : `${counts.approved} approved · ${counts.pending} pending`}
                      </p>
                    </div>
                  </div>
                )}

                <div className="mt-4 border-y border-gray-200 py-3">
                  <StageStrip container={selected} approvedCount={counts.approved} requestedTotal={reservations.length} />
                </div>

                {metaText('participant_notes') && (
                  <div className="mt-4 border-l-2 border-gray-300 pl-3 text-sm text-gray-600" data-testid="diaspora-container-notes">
                    <span className="font-semibold text-gray-900">Organiser notes:</span> {metaText('participant_notes')}
                  </div>
                )}

                {selected.status === 'BOOKING_OPEN' && (
                  <div className="mt-6 min-w-0 border border-gray-200 bg-gray-50 p-4 sm:p-5">
                    <h3 className="text-base font-bold text-gray-950">Request cargo space</h3>
                    <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
                      <label className={fieldLabel}>Cargo category
                        <select className={selectClass} value={cargoType} onChange={(e) => setCargoType(e.target.value)} data-testid="diaspora-container-reserve-category">
                          {CARGO_CATEGORIES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                        </select>
                      </label>
                      <label className={`${fieldLabel} sm:col-span-1`}>Cargo description
                        <Input className="mt-1 rounded-none bg-white" placeholder="e.g. Toyota Aqua 2018, or 10 boxed household items" value={cargoDescription} onChange={(e) => setCargoDescription(e.target.value)} data-testid="diaspora-container-reserve-description" />
                      </label>
                    </div>

                    {cargoType === 'vehicle' && (
                      <div className="mt-3 min-w-0">
                        <label className={fieldLabel}>Link your import order (optional)
                          <select className={selectClass} value={importOrderId} onChange={(e) => setImportOrderId(e.target.value)} data-testid="diaspora-container-reserve-order">
                            <option value="">No linked import order</option>
                            {(myOrders || []).map((o) => (
                              <option key={o.id} value={o.id}>
                                {[o.requested_make, o.requested_model].filter(Boolean).join(' ') || 'Import order'} · {String(o.id).slice(0, 8)} · {o.status}
                              </option>
                            ))}
                          </select>
                        </label>
                        {linkedOrder && (
                          <p className="mt-1 text-xs text-gray-700" data-testid="diaspora-container-linked-identity">
                            Linked vehicle order: <strong>{[linkedOrder.requested_make, linkedOrder.requested_model].filter(Boolean).join(' ') || 'Import order'}</strong> · {linkedOrder.status}. CarUp uses this order's identity — no need to retype vehicle facts.
                          </p>
                        )}
                        {ordersUnreadable && <p className="mt-1 text-[11px] text-amber-800">Your import orders could not be loaded right now — you can still request space without a link.</p>}
                      </div>
                    )}

                    {/* Guided measurement (owner UAT #5): nobody is required to know freight maths. */}
                    <fieldset className="mt-4 min-w-0 border border-gray-200 bg-white p-3 sm:p-4">
                      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-600">Cargo space (volume)</legend>
                      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm" role="radiogroup" aria-label="How do you want to provide volume?">
                        <label className="flex items-center gap-1.5">
                          <input type="radio" name="measure-mode" checked={measureMode === 'known'} onChange={() => setMeasureMode('known')} data-testid="diaspora-container-measure-known" />
                          I already know my total volume
                        </label>
                        <label className="flex items-center gap-1.5">
                          <input type="radio" name="measure-mode" checked={measureMode === 'calc'} onChange={() => setMeasureMode('calc')} data-testid="diaspora-container-measure-calc" />
                          Help me calculate it
                        </label>
                      </div>
                      <p className="mt-1.5 text-[11px] text-gray-500">CBM (cubic metre) is the amount of container space your cargo occupies.</p>

                      {measureMode === 'known' ? (
                        <label className={`${fieldLabel} mt-3 max-w-xs`}>Volume (CBM) — required
                          <Input className="mt-1 rounded-none bg-white" type="number" min="0" placeholder="e.g. 12" value={volume} onChange={(e) => setVolume(e.target.value)} data-testid="diaspora-container-reserve-volume" />
                        </label>
                      ) : (
                        <div className="mt-3 min-w-0">
                          {items.map((item, index) => (
                            <div key={index} className="mb-2 grid min-w-0 grid-cols-2 items-end gap-2 border-b border-dashed border-gray-200 pb-2 sm:grid-cols-[2fr_repeat(4,minmax(0,1fr))_auto_auto]" data-testid="diaspora-container-measure-item">
                              <label className={`${fieldLabel} col-span-2 sm:col-span-1`}>Item / package
                                <Input className="mt-1 rounded-none bg-white" placeholder="e.g. boxed kitchenware" value={item.description} onChange={setItem(index, 'description')} data-testid="measure-item-description" />
                              </label>
                              <label className={fieldLabel}>Qty
                                <Input className="mt-1 rounded-none bg-white" type="number" min="1" value={item.quantity} onChange={setItem(index, 'quantity')} data-testid="measure-item-quantity" />
                              </label>
                              <label className={fieldLabel}>Length
                                <Input className="mt-1 rounded-none bg-white" type="number" min="0" value={item.length} onChange={setItem(index, 'length')} data-testid="measure-item-length" />
                              </label>
                              <label className={fieldLabel}>Width
                                <Input className="mt-1 rounded-none bg-white" type="number" min="0" value={item.width} onChange={setItem(index, 'width')} data-testid="measure-item-width" />
                              </label>
                              <label className={fieldLabel}>Height
                                <Input className="mt-1 rounded-none bg-white" type="number" min="0" value={item.height} onChange={setItem(index, 'height')} data-testid="measure-item-height" />
                              </label>
                              <label className={fieldLabel}>Unit
                                <select className={selectClass} value={item.unit} onChange={setItem(index, 'unit')} data-testid="measure-item-unit">
                                  <option value="cm">cm</option>
                                  <option value="m">m</option>
                                </select>
                              </label>
                              {items.length > 1 && (
                                <button type="button" className="mb-1 justify-self-start p-1 text-gray-400 hover:text-red-600" aria-label="Remove item" onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}>
                                  <X className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          ))}
                          <Button size="sm" variant="outline" className="rounded-none" onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])} data-testid="diaspora-container-measure-add-item">
                            <Plus className="mr-1 h-3.5 w-3.5" /> Add another item / group
                          </Button>
                          <p className="mt-3 text-sm font-semibold text-gray-900" data-testid="diaspora-container-computed-cbm">
                            Estimated cargo volume: {computedCbm > 0 ? `${computedCbm} CBM` : '— add dimensions above'}
                          </p>
                          <p className="text-[11px] text-gray-500">Calculated as length × width × height × quantity for each row.</p>
                        </div>
                      )}
                    </fieldset>

                    <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
                      <label className={fieldLabel}>Estimated total weight (kg, optional)
                        <Input className="mt-1 rounded-none bg-white" type="number" min="0" value={weight} onChange={(e) => setWeight(e.target.value)} data-testid="diaspora-container-reserve-weight" />
                        <span className="mt-0.5 block text-[10px] normal-case tracking-normal text-gray-500">A bathroom-scale estimate per box is fine — the organiser confirms final weights.</span>
                      </label>
                      <div className="flex min-w-0 gap-3">
                        <label className={`${fieldLabel} min-w-0 flex-1`}>Declared value (optional)
                          <Input className="mt-1 rounded-none bg-white" type="number" min="0" value={declaredValue} onChange={(e) => setDeclaredValue(e.target.value)} data-testid="diaspora-container-reserve-value" />
                        </label>
                        <label className={`${fieldLabel} w-24 shrink-0`}>Currency
                          <select className={selectClass} value={currency} onChange={(e) => setCurrency(e.target.value)} data-testid="diaspora-container-reserve-currency">
                            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </label>
                      </div>
                    </div>

                    <div className="mt-4">
                      <Button onClick={handleReserve} className="bg-orange-500 text-white hover:bg-orange-600" data-testid="diaspora-container-reserve-submit">Request space</Button>
                    </div>
                    <p className="mt-3 max-w-xl text-[11px] leading-snug text-gray-500">
                      Volumes and weights are estimates and may require organiser confirmation before approval.
                      Declared value is recorded as declared, not verified. Selecting a category does not
                      constitute customs classification, dangerous-goods approval or shipping-line acceptance.
                    </p>
                    {reserveError && <p className="mt-2 text-sm font-medium text-red-700" data-testid="diaspora-container-reserve-error">{reserveError}</p>}
                  </div>
                )}
                {selected.status !== 'BOOKING_OPEN' && reserveError && (
                  <p className="mt-3 text-sm font-medium text-red-700" data-testid="diaspora-container-reserve-error">{reserveError}</p>
                )}

                {/* Bookings manifest (owner UAT #6) */}
                <div className="mt-8 min-w-0">
                  <div className="flex items-baseline justify-between border-b-2 border-gray-950 pb-2">
                    <h3 className="text-lg font-bold text-gray-950">{isOperator ? 'Booking manifest' : 'Your bookings'}</h3>
                  </div>
                  <div className="mt-3 min-w-0 overflow-x-auto border border-gray-200" data-testid="diaspora-container-reservations">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50">
                          <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-600">Booking</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-600">Cargo</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-600">Space</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-600">Status</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-600">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reservations.length === 0 ? (
                          <TableRow><TableCell colSpan={5} className="h-12 text-center text-gray-500" data-testid="container-reservations-state">
                        {reservationsLoading
                          ? 'Loading bookings…'
                          : reservationsUnreadable
                            ? 'Reservations could not be loaded. This is not a report that none exist.'
                            : 'No reservations.'}
                      </TableCell></TableRow>
                        ) : reservations.map((r) => (
                          <TableRow key={r.id} className={openBookingId === r.id ? 'bg-orange-50/50' : undefined} data-testid="diaspora-container-reservation-row" data-reservation-id={r.id}>
                            <TableCell className="whitespace-nowrap">
                              <span className="font-mono text-xs text-gray-700">RES-{String(r.id).replace(/-/g, '').slice(0, 8).toUpperCase()}</span>
                              {typeof r.participant_display_name === 'string' && r.participant_display_name && (
                                <span className="block max-w-[160px] truncate text-xs font-medium text-gray-900" data-testid="diaspora-container-participant-name">{r.participant_display_name}</span>
                              )}
                              {ownsReservation(r) && <span className="block text-[10px] uppercase tracking-wide text-orange-700">Your booking</span>}
                            </TableCell>
                            <TableCell className="max-w-[200px]">
                              <span className="font-medium capitalize text-gray-900">{r.cargo_type || 'general'}</span>
                              {typeof r.cargo_description === 'string' && r.cargo_description && (
                                <span className="block truncate text-xs text-gray-500" title={r.cargo_description}>{r.cargo_description}</span>
                              )}
                              {r.linked_order_summary && (
                                <span className="block truncate text-xs text-gray-600" data-testid="diaspora-container-linked-order">↳ {r.linked_order_summary.label}{r.linked_order_summary.status ? ` · ${r.linked_order_summary.status}` : ''}</span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap font-mono text-sm">{r.estimated_volume} CBM{r.estimated_weight ? <span className="block text-xs text-gray-500">{String(r.estimated_weight)} kg</span> : null}</TableCell>
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
                              <Button size="sm" variant="ghost" className="rounded-none px-2 text-gray-600" onClick={() => setOpenBookingId((prev) => (prev === r.id ? null : r.id))} data-testid="diaspora-container-open-booking">
                                {openBookingId === r.id ? 'Hide' : 'Details'}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Booking detail — the relationship, spelled out (owner UAT #6) */}
                  {openBooking && (
                    <div className="mt-4 min-w-0 border border-gray-300 bg-gray-50 p-4 sm:p-5" data-testid="diaspora-container-booking-detail">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-mono text-xs text-gray-600">RES-{String(openBooking.id).replace(/-/g, '').slice(0, 8).toUpperCase()}</p>
                        <StatusChip status={openBooking.reservation_status} />
                      </div>
                      <dl className="mt-3 grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                        <Fact label="Organiser" value={typeof selected.organiser_name === 'string' ? selected.organiser_name : null} />
                        <Fact label="Participant" value={ownsReservation(openBooking) ? `You${user?.name ? ` (${user.name})` : ''}` : (typeof openBooking.participant_display_name === 'string' ? openBooking.participant_display_name : null)} />
                        <Fact label="Container" value={`${routeLabel(selected).from} → ${routeLabel(selected).to} · departs ${dateOf(selected.departure_date) || 'TBD'}`} />
                        <Fact label="Cargo" value={`${openBooking.cargo_type || 'general'}${typeof openBooking.cargo_description === 'string' && openBooking.cargo_description ? ` — ${openBooking.cargo_description}` : ''}`} />
                        <Fact label="Space" value={`${openBooking.estimated_volume} CBM${openBooking.estimated_weight ? ` · ~${openBooking.estimated_weight} kg` : ''}`} />
                        <Fact label="Declared value" value={openBooking.declared_value ? `${openBooking.declared_value} ${openBooking.currency || ''} (declared, not verified)` : null} />
                        <Fact label="Linked import order" value={openBooking.linked_order_summary ? `${openBooking.linked_order_summary.label}${openBooking.linked_order_summary.status ? ` · ${openBooking.linked_order_summary.status}` : ''}` : null} />
                        <Fact label="Requested" value={openBooking.created_at ? String(openBooking.created_at).slice(0, 16).replace('T', ' ') : null} />
                        <Fact label="Decided" value={openBooking.reviewed_at ? String(openBooking.reviewed_at).slice(0, 16).replace('T', ' ') : null} />
                      </dl>
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <Button asChild size="sm" variant="outline" className="rounded-none">
                          <Link to="/diaspora/messages">Open CarUp Communications</Link>
                        </Button>
                        {openBooking.import_order_id && (
                          <Button asChild size="sm" variant="ghost" className="rounded-none text-gray-700">
                            <Link to={`/diaspora/imports/${openBooking.import_order_id}/passport`}>View Order Passport</Link>
                          </Button>
                        )}
                        <span className="text-[11px] text-gray-500">Contact happens through CarUp Communications — private phone/email is never shown here.</span>
                      </div>
                    </div>
                  )}
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
