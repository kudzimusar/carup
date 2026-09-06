import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Box, Check, Loader2, MessageSquare, Plus, Ruler, Ship, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useNavigate } from 'react-router-dom'
import { useTradeLogisticsApi } from '@/hooks/useTradeLogisticsApi'
import { formatRoute } from './tradeRoute'
import { MoreDetail, Choice, ChoiceSet, PrivateNote, intakeFieldLabel, intakeControl } from './intakeControls'
import {
  DESTINATION_OUTCOME_OPTIONS, SHIPPING_OBJECTIVE_OPTIONS, SHIPPING_MODE_OPTIONS,
  HANDLING_FLAG_OPTIONS, CONTENT_DECLARATION_OPTIONS, INSPECTION_INTENT_OPTIONS,
  INSURANCE_INTENT_OPTIONS, CLEARING_INTENT_OPTIONS, TIMING_FLEXIBILITY_OPTIONS,
} from './intakeVocabularies'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { Vehicle } from '@/types'
import type {
  LogisticsCargoCategory,
  LogisticsQuote,
  LogisticsRequest,
  LogisticsRequestInput,
  LogisticsRequestItemInput,
  LogisticsSailingMatch,
} from '@/types/tradeLogistics'

type View = 'list' | 'edit' | 'detail'
type MeasurementMode = 'dimensions' | 'volume' | 'unknown'

type EditableItem = LogisticsRequestItemInput & { measurementMode: MeasurementMode; detailOpen?: boolean }

const CATEGORY_OPTIONS: Array<[LogisticsCargoCategory, string, string]> = [
  ['vehicle', 'Vehicle', 'Car, van, truck, motorcycle or similar vehicle'],
  ['parts', 'Vehicle parts', 'Engines, body parts, tyres or other vehicle components'],
  ['household', 'Household / personal effects', 'Personal belongings and household goods'],
  ['boxes', 'Boxes / cartons', 'Packed cartons or boxes'],
  ['furniture_appliances', 'Furniture / appliances', 'Furniture and eligible household appliances'],
  ['machinery_equipment', 'Machinery / equipment', 'Eligible tools, machinery or equipment'],
  ['pallet_crate', 'Pallet / crate', 'Palletised or crated cargo'],
  ['general', 'General eligible cargo', 'Other ordinary cargo the organiser can assess'],
  ['other', 'Other eligible cargo', 'Describe it clearly so providers can assess it'],
]

const SERVICE_OPTIONS: Array<[string, string, string]> = [
  ['flexible', 'I’m flexible', 'Let providers propose the most suitable service'],
  ['door_to_door', 'Door to door', 'Pickup from your location and deliver to destination'],
  ['door_to_port', 'Pickup to port', 'Provider collects the cargo and moves it to the destination port'],
  ['port_to_door', 'Port to door', 'You deliver to origin port; provider delivers at destination'],
  ['port_to_port', 'Port to port', 'You handle delivery to and collection from the ports'],
]

const emptyItem = (): EditableItem => ({
  cargo_category: 'boxes',
  description: '',
  quantity: 1,
  dimension_unit: 'cm',
  measurementMode: 'unknown',
})

const fieldLabel = 'block min-w-0 text-xs font-semibold uppercase tracking-wide text-slate-600'
const selectClass = 'mt-1 block w-full min-w-0 border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-orange-500 focus:outline-none'

function num(value: string | number | null | undefined): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * The canonical identity of a CarUp vehicle, written the way a person would describe it. Reusing
 * this is the whole point of linking: the year/make/model are already recorded facts, so the
 * requester should never retype them, and providers read the same identity CarUp holds.
 */
function vehicleIdentity(vehicle: Vehicle): string {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ').trim()
}

function categoryLabel(category: string) {
  return CATEGORY_OPTIONS.find(([value]) => value === category)?.[1] || category.replace(/_/g, ' ')
}

function serviceLabel(value: string) {
  return SERVICE_OPTIONS.find(([key]) => key === value)?.[1] || value.replace(/_/g, ' ')
}

function statusMeta(status: string) {
  switch (status) {
    case 'DRAFT': return { label: 'Draft', note: 'Only you can see this.', tone: 'bg-slate-100 text-slate-700 border-slate-300' }
    case 'OPEN_FOR_QUOTES': return { label: 'Waiting for offers', note: 'Logistics providers can respond.', tone: 'bg-orange-50 text-orange-900 border-orange-300' }
    case 'AWARDED': return { label: 'Provider selected', note: 'Continue with the chosen shipping service.', tone: 'bg-emerald-50 text-emerald-900 border-emerald-300' }
    case 'CLOSED': return { label: 'Closed', note: 'This request is no longer active.', tone: 'bg-slate-100 text-slate-600 border-slate-300' }
    case 'CANCELLED': return { label: 'Cancelled', note: 'This request was cancelled.', tone: 'bg-slate-100 text-slate-600 border-slate-300' }
    default: return { label: status, note: '', tone: 'bg-slate-100 text-slate-700 border-slate-300' }
  }
}

function money(value: unknown, currency?: string | null) {
  const amount = Number(value)
  return Number.isFinite(amount) ? `${amount.toLocaleString()} ${currency || ''}`.trim() : 'Not provided'
}

function tri(value: boolean | null | undefined) {
  if (value === true) return 'Included'
  if (value === false) return 'Not included'
  return 'Not provided'
}

/**
 * The furthest REAL operating stage, derived from authoritative facts only.
 *
 * The header used to render the request's own status enum, which stops at AWARDED — so after the
 * organiser approved container space it still announced "Provider selected", a state the
 * transaction had already moved past. This derives the stage instead of mutating the enum, and it
 * deliberately stops at approved space: loaded, shipped, cleared and delivered are NOT implied by
 * a container approval.
 */
function transactionStage(
  request: LogisticsRequest,
  offers: LogisticsQuote[],
  reservationState: string | null,
): { label: string; note: string; tone: string } {
  if (reservationState === 'APPROVED') {
    return { label: 'Container space approved', note: 'The organiser approved your space on this sailing.', tone: 'bg-emerald-50 text-emerald-900 border-emerald-300' }
  }
  if (reservationState === 'REJECTED' || reservationState === 'CANCELLED') {
    return { label: 'Space not approved', note: 'Your selected provider still stands — agree the next step with them.', tone: 'bg-red-50 text-red-900 border-red-300' }
  }
  if (reservationState === 'REQUESTED') {
    return { label: 'Space requested', note: 'Waiting for the organiser to review your space request.', tone: 'bg-orange-50 text-orange-900 border-orange-300' }
  }
  if (request.status === 'AWARDED') {
    return { label: 'Provider selected', note: 'Continue with the chosen shipping service.', tone: 'bg-emerald-50 text-emerald-900 border-emerald-300' }
  }
  if (request.status === 'OPEN_FOR_QUOTES' && offers.length > 0) {
    return { label: `${offers.length} offer${offers.length === 1 ? '' : 's'} received`, note: 'Compare what each price includes, then choose.', tone: 'bg-orange-50 text-orange-900 border-orange-300' }
  }
  const base = statusMeta(request.status)
  return { label: base.label, note: base.note, tone: base.tone }
}

function quoteValidityEnded(quote: LogisticsQuote): boolean {
  if (!quote.valid_until || quote.status !== 'SUBMITTED') return false
  const timestamp = Date.parse(String(quote.valid_until))
  return Number.isFinite(timestamp) && timestamp <= Date.now()
}

export default function TradeShippingRequests() {
  const api = useTradeLogisticsApi()
  const { confirmMeasurements, fetchContainerReservations } = api
  // Destructured deliberately: the useCarUpApi aggregate object is a new identity every render and
  // depending on it directly loops.
  const { fetchOwnedVehicles } = useCarUpApi()
  const navigate = useNavigate()
  const [requests, setRequests] = useState<LogisticsRequest[]>([])
  // null = not read yet. An empty array is a real answer ("you have none"); a failed read is
  // `myVehiclesUnreadable`, and the two must never render as the same thing (DESIGN.md §8).
  const [myVehicles, setMyVehicles] = useState<Vehicle[] | null>(null)
  const [myVehiclesUnreadable, setMyVehiclesUnreadable] = useState(false)
  const [view, setView] = useState<View>('list')
  const [selected, setSelected] = useState<LogisticsRequest | null>(null)
  const [sailings, setSailings] = useState<LogisticsSailingMatch[]>([])
  const [sailingsUnreadable, setSailingsUnreadable] = useState(false)
  const [showAllSailings, setShowAllSailings] = useState(false)
  // The reservation's real state. `reservationState` holds the last CONFIRMED authoritative status
  // — from the request-space response itself, or from a successful read-back. `reservationStale`
  // says the most recent refresh failed, which is a statement about our knowledge, never about the
  // reservation. A failed refresh must not erase a fact the server already told us.
  const [reservationState, setReservationState] = useState<string | null>(null)
  const [reservationStale, setReservationStale] = useState(false)
  // Which request the reservation state belongs to, so re-opening the SAME request refreshes
  // without discarding what we know, while opening a different one starts clean.
  const reservationForRequest = useRef<string | null>(null)
  // #28: volumes the requester is typing to CONFIRM missing measurements (item id → input text).
  const [confirmVolumes, setConfirmVolumes] = useState<Record<string, string>>({})
  // #4: monotonically increasing token so a slower, OLDER detail response can never overwrite a
  // newer one. React state setters are compared against the ref at await boundaries.
  const detailGeneration = useRef(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [unreadable, setUnreadable] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [items, setItems] = useState<EditableItem[]>([emptyItem()])
  const [originCountry, setOriginCountry] = useState('Japan')
  const [originCity, setOriginCity] = useState('')
  const [originLocation, setOriginLocation] = useState('')
  const [destinationCountry, setDestinationCountry] = useState('Zimbabwe')
  const [destinationCity, setDestinationCity] = useState('Harare')
  const [destinationLocation, setDestinationLocation] = useState('')
  const [neededBy, setNeededBy] = useState('')
  const [servicePreference, setServicePreference] = useState('flexible')

  /**
   * Intake 2.0 (contract §36) for the shipping side. Everything starts EMPTY and is written as
   * null when unanswered. The sections these feed are scenario-triggered: a pickup address only
   * exists once someone says they need pickup, and vehicle condition only when the cargo IS a
   * vehicle — so a customer shipping six boxes never meets a question about keys.
   */
  const [showHandling, setShowHandling] = useState(false)
  const [showPickup, setShowPickup] = useState(false)
  const [showServices, setShowServices] = useState(false)
  const [pickupRequired, setPickupRequired] = useState('')
  const [originSiteType, setOriginSiteType] = useState('')
  const [pickupAddress, setPickupAddress] = useState('')
  const [pickupContactName, setPickupContactName] = useState('')
  const [pickupContactPhone, setPickupContactPhone] = useState('')
  const [pickupAvailableFrom, setPickupAvailableFrom] = useState('')
  const [pickupAccessNotes, setPickupAccessNotes] = useState('')
  const [pickupLoadingEquipment, setPickupLoadingEquipment] = useState('')
  const [destinationOutcome, setDestinationOutcome] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryContactName, setDeliveryContactName] = useState('')
  const [deliveryContactPhone, setDeliveryContactPhone] = useState('')
  const [unloadingRequired, setUnloadingRequired] = useState('')
  const [shippingObjective, setShippingObjective] = useState('')
  const [serviceModePreference, setServiceModePreference] = useState('')
  const [inspectionIntent, setInspectionIntent] = useState('')
  const [insuranceIntent, setInsuranceIntent] = useState('')
  const [clearingIntent, setClearingIntent] = useState('')
  const [clearingAgentName, setClearingAgentName] = useState('')
  const [clearingAgentContact, setClearingAgentContact] = useState('')
  const [availableFrom, setAvailableFrom] = useState('')
  const [arrivalFrom, setArrivalFrom] = useState('')
  const [arrivalTo, setArrivalTo] = useState('')
  const [timingFlexibility, setTimingFlexibility] = useState('')
  const [preferredLanguage, setPreferredLanguage] = useState('')
  const [preferredChannel, setPreferredChannel] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRequests(await api.listMyRequests())
      setUnreadable(false)
    } catch {
      setRequests([])
      setUnreadable(true)
    } finally {
      setLoading(false)
    }
  }, [api])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical repo data-fetch pattern: load() flips the loading flag before awaiting so the panel never renders a false empty state.
  useEffect(() => { void load() }, [load])

  // The requester's own CarUp vehicles, read only once a vehicle cargo group actually exists.
  // setState happens in the async callbacks, so this effect needs no suppression.
  const needsVehicleList = items.some((item) => item.cargo_category === 'vehicle')
  useEffect(() => {
    if (!needsVehicleList || myVehicles !== null) return
    let live = true
    fetchOwnedVehicles()
      .then((vehicles) => { if (live) { setMyVehicles(vehicles || []); setMyVehiclesUnreadable(false) } })
      .catch(() => { if (live) { setMyVehicles([]); setMyVehiclesUnreadable(true) } })
    return () => { live = false }
  }, [needsVehicleList, myVehicles, fetchOwnedVehicles])

  const resetEditor = () => {
    setEditingId(null)
    setItems([emptyItem()])
    setOriginCountry('Japan'); setOriginCity(''); setOriginLocation('')
    setDestinationCountry('Zimbabwe'); setDestinationCity('Harare'); setDestinationLocation('')
    setNeededBy(''); setServicePreference('flexible'); setStep(0); setError('')
  }

  const startNew = () => { resetEditor(); setView('edit') }

  const startEdit = (request: LogisticsRequest) => {
    setEditingId(request.id)
    setItems((request.items || []).map((item) => ({
      cargo_category: item.cargo_category,
      description: item.description,
      quantity: item.quantity,
      length_value: item.length_value,
      width_value: item.width_value,
      height_value: item.height_value,
      dimension_unit: item.dimension_unit || 'cm',
      estimated_volume_cbm: item.estimated_volume_cbm,
      estimated_weight_kg: item.estimated_weight_kg,
      linked_vehicle_vin: item.linked_vehicle_vin,
      notes: item.notes,
      measurementMode: item.measurement_basis === 'CALCULATED' ? 'dimensions' : item.measurement_basis === 'PROVIDED' ? 'volume' : 'unknown',
      // Intake 2.0 cargo facts. Selective hydration is the failure this guards against: a longer
      // form that reopens with half its answers gone destroys work the customer already did.
      packaging_type: item.packaging_type, goods_nature: item.goods_nature,
      declared_value: item.declared_value, declared_value_currency: item.declared_value_currency,
      handling_flags: item.handling_flags || [], content_declarations: item.content_declarations || [],
      vehicle_running_state: item.vehicle_running_state, vehicle_keys_state: item.vehicle_keys_state,
      export_clearance_state: item.export_clearance_state, inspection_state: item.inspection_state,
      accompanying_parts: item.accompanying_parts,
      accompanying_personal_goods: item.accompanying_personal_goods,
      current_location: item.current_location,
      // Reopen the section if the customer had answered anything inside it.
      detailOpen: Boolean(item.packaging_type || item.goods_nature || item.vehicle_running_state
        || (item.handling_flags || []).length || (item.content_declarations || []).length),
    })))
    setOriginCountry(request.origin_country || 'Japan')
    setOriginCity(request.origin_city || '')
    setOriginLocation(request.origin_location || '')
    setDestinationCountry(request.destination_country || 'Zimbabwe')
    setDestinationCity(request.destination_city || '')
    setDestinationLocation(request.destination_location || '')
    setNeededBy(request.needed_by ? String(request.needed_by).slice(0, 10) : '')
    setServicePreference(request.service_preference || 'flexible')

    // Intake 2.0 request-level facts, restored in full.
    const r = request as unknown as Record<string, unknown>
    const str = (k: string) => (r[k] === null || r[k] === undefined ? '' : String(r[k]))
    const date = (k: string) => (r[k] ? String(r[k]).slice(0, 10) : '')
    setPickupRequired(str('pickup_required')); setOriginSiteType(str('origin_site_type'))
    setPickupAddress(str('pickup_address')); setPickupContactName(str('pickup_contact_name'))
    setPickupContactPhone(str('pickup_contact_phone')); setPickupAvailableFrom(date('pickup_available_from'))
    setPickupAccessNotes(str('pickup_access_notes')); setPickupLoadingEquipment(str('pickup_loading_equipment'))
    setDestinationOutcome(str('destination_outcome')); setDeliveryAddress(str('delivery_address'))
    setDeliveryContactName(str('delivery_contact_name')); setDeliveryContactPhone(str('delivery_contact_phone'))
    setUnloadingRequired(str('unloading_required')); setShippingObjective(str('shipping_objective'))
    setServiceModePreference(str('service_mode_preference'))
    setInspectionIntent(str('inspection_intent')); setInsuranceIntent(str('insurance_intent'))
    setClearingIntent(str('clearing_intent')); setClearingAgentName(str('clearing_agent_name'))
    setClearingAgentContact(str('clearing_agent_contact'))
    setAvailableFrom(date('available_from')); setArrivalFrom(date('arrival_window_start'))
    setArrivalTo(date('arrival_window_end')); setTimingFlexibility(str('timing_flexibility'))
    setPreferredLanguage(str('preferred_language')); setPreferredChannel(str('preferred_contact_channel'))
    // Sections the customer had used stay open, so returning to a draft does not hide their work.
    setShowPickup(Boolean(r.pickup_required || r.pickup_address))
    setShowHandling(Boolean(r.destination_outcome || r.shipping_objective))
    setShowServices(Boolean(r.inspection_intent || r.insurance_intent || r.clearing_intent || r.available_from))

    setStep(0); setError(''); setView('edit')
  }

  const setItem = (index: number, patch: Partial<EditableItem>) => {
    setItems((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item))
  }

  const payload = useMemo<LogisticsRequestInput>(() => ({
    origin_country: originCountry.trim(),
    origin_city: originCity.trim() || undefined,
    origin_location: originLocation.trim() || undefined,
    destination_country: destinationCountry.trim(),
    destination_city: destinationCity.trim() || undefined,
    destination_location: destinationLocation.trim() || undefined,
    needed_by: neededBy || null,
    service_preference: servicePreference as LogisticsRequestInput['service_preference'],
    // Intake 2.0 — only ANSWERED questions travel. An untouched control sends nothing, so the
    // server writes null and "not stated" survives instead of becoming a default.
    ...Object.fromEntries(Object.entries({
      pickup_required: pickupRequired, origin_site_type: originSiteType,
      pickup_address: pickupAddress.trim(), pickup_contact_name: pickupContactName.trim(),
      pickup_contact_phone: pickupContactPhone.trim(), pickup_available_from: pickupAvailableFrom,
      pickup_access_notes: pickupAccessNotes.trim(), pickup_loading_equipment: pickupLoadingEquipment,
      destination_outcome: destinationOutcome, delivery_address: deliveryAddress.trim(),
      delivery_contact_name: deliveryContactName.trim(), delivery_contact_phone: deliveryContactPhone.trim(),
      unloading_required: unloadingRequired, shipping_objective: shippingObjective,
      service_mode_preference: serviceModePreference, inspection_intent: inspectionIntent,
      insurance_intent: insuranceIntent, clearing_intent: clearingIntent,
      clearing_agent_name: clearingAgentName.trim(), clearing_agent_contact: clearingAgentContact.trim(),
      available_from: availableFrom, arrival_window_start: arrivalFrom, arrival_window_end: arrivalTo,
      timing_flexibility: timingFlexibility, preferred_language: preferredLanguage.trim(),
      preferred_contact_channel: preferredChannel,
    }).filter(([, v]) => v !== '' && v !== undefined && v !== null)),
    items: items.map((item) => ({
      cargo_category: item.cargo_category,
      description: item.description.trim(),
      quantity: Math.max(1, Number(item.quantity) || 1),
      dimension_unit: item.measurementMode === 'dimensions' ? item.dimension_unit : undefined,
      length_value: item.measurementMode === 'dimensions' ? num(item.length_value) : undefined,
      width_value: item.measurementMode === 'dimensions' ? num(item.width_value) : undefined,
      height_value: item.measurementMode === 'dimensions' ? num(item.height_value) : undefined,
      estimated_volume_cbm: item.measurementMode === 'volume' ? num(item.estimated_volume_cbm) : undefined,
      estimated_weight_kg: num(item.estimated_weight_kg),
      linked_vehicle_vin: item.linked_vehicle_vin || undefined,
      notes: item.notes || undefined,
      // Intake 2.0 cargo facts, again answered-only.
      ...Object.fromEntries(Object.entries({
        packaging_type: (item.packaging_type || '').trim(),
        goods_nature: item.goods_nature || '',
        declared_value: item.declared_value ? Number(item.declared_value) : '',
        declared_value_currency: (item.declared_value_currency || '').trim(),
        vehicle_running_state: item.vehicle_running_state || '',
        vehicle_keys_state: item.vehicle_keys_state || '',
        export_clearance_state: item.export_clearance_state || '',
        inspection_state: item.inspection_state || '',
        accompanying_parts: (item.accompanying_parts || '').trim(),
        accompanying_personal_goods: (item.accompanying_personal_goods || '').trim(),
        current_location: (item.current_location || '').trim(),
      }).filter(([, v]) => v !== '' && v !== undefined && v !== null)),
      handling_flags: item.handling_flags?.length ? item.handling_flags : undefined,
      content_declarations: item.content_declarations?.length ? item.content_declarations : undefined,
    })),
  }), [originCountry, originCity, originLocation, destinationCountry, destinationCity, destinationLocation,
       neededBy, servicePreference, items,
       pickupRequired, originSiteType, pickupAddress, pickupContactName, pickupContactPhone,
       pickupAvailableFrom, pickupAccessNotes, pickupLoadingEquipment, destinationOutcome,
       deliveryAddress, deliveryContactName, deliveryContactPhone, unloadingRequired,
       shippingObjective, serviceModePreference, inspectionIntent, insuranceIntent, clearingIntent,
       clearingAgentName, clearingAgentContact, availableFrom, arrivalFrom, arrivalTo,
       timingFlexibility, preferredLanguage, preferredChannel])

  const validation = useMemo(() => {
    if (!items.length || items.some((item) => !item.description.trim())) return 'Describe every cargo item in ordinary language.'
    if (!originCountry.trim()) return 'Tell providers which country the cargo is in now.'
    if (!destinationCountry.trim()) return 'Tell providers which country the cargo is going to.'
    return ''
  }, [items, originCountry, destinationCountry])

  const save = async (publish: boolean) => {
    if (busy || validation) { if (validation) setError(validation); return }
    setBusy(true); setError('')
    try {
      const saved = editingId ? await api.updateRequest(editingId, payload) : await api.createRequest(payload)
      // The created id is recorded IMMEDIATELY. Publish is a second write; if it fails, the retry
      // must PATCH this same request, not run create again and leave an orphan draft per click.
      if (!editingId) setEditingId(saved.id)
      const finalRequest = publish ? await api.publishRequest(saved.id) : saved
      await load()
      if (publish) await openDetail(finalRequest.id)
      else { setSelected(finalRequest); setView('detail') }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Shipping request could not be saved')
    } finally { setBusy(false) }
  }

  const openDetail = async (id: string) => {
    if (busy) return
    const generation = ++detailGeneration.current
    setBusy(true); setError(''); setSailings([]); setSailingsUnreadable(false)
    setConfirmVolumes({})
    if (reservationForRequest.current !== id) {
      reservationForRequest.current = id
      setReservationState(null); setReservationStale(false)
    }
    try {
      const request = await api.getRequest(id)
      if (generation !== detailGeneration.current) return // a newer open superseded this one
      setSelected(request)
      try {
        const matches = await api.findSailingMatches(id)
        if (generation !== detailGeneration.current) return
        setSailings(matches)
        setSailingsUnreadable(false)
      } catch {
        if (generation !== detailGeneration.current) return
        setSailings([])
        setSailingsUnreadable(true)
      }
      // #29: a recorded space request is a live thing with a real state — read it back from the
      // container product instead of narrating a frozen "pending". A failed read is UNREADABLE,
      // never a claimed state.
      const reservationId = typeof request.metadata?.reservation_id === 'string' ? request.metadata.reservation_id : null
      const acceptedQuote = (request.quotes || []).find((quote) => quote.id === request.accepted_quote_id)
      if (reservationId && acceptedQuote?.compatible_container_id) {
        try {
          const rows = await fetchContainerReservations(String(acceptedQuote.compatible_container_id))
          if (generation !== detailGeneration.current) return
          const row = rows.find((entry) => String(entry.id) === reservationId)
          const status = row ? String(row.reservation_status || '') : ''
          if (status) { setReservationState(status); setReservationStale(false) }
          // Not finding the row is a failure to REFRESH, not evidence about the reservation.
          else setReservationStale(true)
        } catch {
          if (generation !== detailGeneration.current) return
          setReservationStale(true)
        }
      }
      setView('detail')
    } catch (err) {
      if (generation !== detailGeneration.current) return
      setError(err instanceof Error ? err.message : 'Shipping request could not be loaded')
    } finally {
      if (generation === detailGeneration.current) setBusy(false)
    }
  }

  const chooseQuote = async (quote: LogisticsQuote) => {
    if (!selected || busy || quoteValidityEnded(quote)) return
    setBusy(true); setError('')
    try {
      await api.acceptQuote(selected.id, quote.id)
      await openDetail(selected.id)
    } catch (err) { setError(err instanceof Error ? err.message : 'Provider could not be selected') }
    finally { setBusy(false) }
  }

  const askProvider = async (providerId?: string) => {
    if (!selected || !providerId || busy) return
    setBusy(true); setError('')
    try {
      await api.ensureConversation(selected.id, providerId)
      navigate('/diaspora/messages')
    } catch (err) { setError(err instanceof Error ? err.message : 'Conversation could not be opened'); setBusy(false) }
  }

  const requestSpace = async () => {
    if (!selected || busy) return
    setBusy(true); setError('')
    try {
      // The mutation response already carries the authoritative status the server just wrote
      // (REQUESTED). Discarding it and re-deriving the same fact from a follow-up read is what
      // made a SUCCESSFUL request momentarily report "state could not be read".
      const result = await api.requestContainerSpace(selected.id)
      const confirmed = result?.reservation?.reservation_status
      reservationForRequest.current = selected.id
      if (confirmed) { setReservationState(String(confirmed)); setReservationStale(false) }
      await openDetail(selected.id)
    } catch (err) { setError(err instanceof Error ? err.message : 'Container space could not be requested') }
    finally { setBusy(false) }
  }

  if (loading) return <div className="flex min-h-48 items-center justify-center text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /></div>

  if (view === 'edit') {
    const steps = ['Cargo', 'Size & weight', 'Route', 'Review']
    return (
      <section className="mx-auto w-full max-w-[1440px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="logistics-request-wizard"><div className="max-w-[1180px]">
        <button type="button" onClick={() => setView('list')} className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-orange-700">
          <ArrowLeft className="h-4 w-4" /> My shipping
        </button>
        <div className="mt-4 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">Shipping request</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Tell providers what you need moved</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">You do not need freight expertise. Describe the cargo as you know it; measurements can be estimated or left unknown until a provider or organiser confirms them.</p>
        </div>

        <ol className="mt-6 flex flex-wrap gap-3" aria-label="Shipping request steps">
          {steps.map((label, index) => (
            <li key={label} className={`flex items-center gap-2 text-xs ${index === step ? 'font-semibold text-slate-950' : 'text-slate-500'}`}>
              <span className={`flex h-6 w-6 items-center justify-center rounded-full ${index < step ? 'bg-emerald-600 text-white' : index === step ? 'bg-orange-500 text-white' : 'bg-slate-200'}`}>
                {index < step ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>{label}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="mt-7 space-y-5">
            <div>
              <h2 className="text-lg font-bold text-slate-950">What are you shipping?</h2>
              <p className="mt-1 text-sm text-slate-600">Add separate groups when the cargo is different — for example 12 cartons plus one washing machine.</p>
            </div>
            {items.map((item, index) => (
              <div key={index} className="border border-slate-300 bg-white p-5" data-testid="logistics-cargo-item">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cargo group {index + 1}</span>
                  {items.length > 1 && <button type="button" onClick={() => setItems((current) => current.filter((_, i) => i !== index))} className="text-slate-400 hover:text-red-600" aria-label={`Remove cargo group ${index + 1}`}><Trash2 className="h-4 w-4" /></button>}
                </div>
                <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-[1fr_2fr_110px]">
                  <label className={fieldLabel}>Category
                    <select className={selectClass} value={item.cargo_category} onChange={(e) => setItem(index, { cargo_category: e.target.value as LogisticsCargoCategory })}>
                      {CATEGORY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label className={fieldLabel}>Describe it
                    <Input className="mt-1 rounded-none" value={item.description} onChange={(e) => setItem(index, { description: e.target.value })} placeholder="e.g. Clothes and kitchen items in cartons" data-testid="logistics-cargo-description" />
                  </label>
                  <label className={fieldLabel}>Quantity
                    <Input className="mt-1 rounded-none" type="number" min="1" value={String(item.quantity)} onChange={(e) => setItem(index, { quantity: Number(e.target.value) })} />
                  </label>
                </div>
                <p className="mt-2 text-xs text-slate-500">{CATEGORY_OPTIONS.find(([value]) => value === item.cargo_category)?.[2]}</p>

                {/* Cargo detail — optional, and the VEHICLE questions appear only when the cargo is
                    a vehicle. Someone shipping cartons is never asked whether it has keys. */}
                <MoreDetail open={Boolean(item.detailOpen)} onToggle={() => setItem(index, { detailOpen: !item.detailOpen })}
                            summary="Tell providers more about this cargo" testId={`logistics-cargo-detail-${index}`}>
                  <label className={intakeFieldLabel}>How is it packed
                    <Input className="mt-1 rounded-none" value={item.packaging_type || ''} onChange={(e) => setItem(index, { packaging_type: e.target.value })}
                           placeholder="e.g. cartons, crate, loose" data-testid={`logistics-packaging-${index}`} />
                  </label>
                  <Choice label="Nature of the goods" value={item.goods_nature || ''}
                          onChange={(v) => setItem(index, { goods_nature: v as EditableItem['goods_nature'] })}
                          options={[['new', 'New'], ['used', 'Used'], ['personal_effects', 'Personal effects'],
                                    ['commercial_goods', 'Commercial goods'], ['unsure', 'Not sure']]}
                          testId={`logistics-goods-nature-${index}`} />
                  <label className={intakeFieldLabel}>Estimated value
                    <Input className="mt-1 rounded-none" inputMode="decimal" value={String(item.declared_value ?? '')}
                           onChange={(e) => setItem(index, { declared_value: e.target.value })}
                           data-testid={`logistics-declared-value-${index}`} />
                    <PrivateNote />
                  </label>
                  <label className={intakeFieldLabel}>Currency
                    <Input className="mt-1 rounded-none" value={item.declared_value_currency || ''}
                           onChange={(e) => setItem(index, { declared_value_currency: e.target.value })}
                           placeholder="USD" data-testid={`logistics-value-currency-${index}`} />
                  </label>
                  <ChoiceSet legend="How should it be handled" values={item.handling_flags || []}
                             onChange={(next) => setItem(index, { handling_flags: next })}
                             options={HANDLING_FLAG_OPTIONS} testIdPrefix={`logistics-handling-${index}`} />
                  <ChoiceSet legend="Does it contain any of these?"
                             note="Telling us lets a provider decide whether they can carry it. It is not CarUp approving carriage — the provider and carrier decide."
                             values={item.content_declarations || []}
                             onChange={(next) => setItem(index, { content_declarations: next })}
                             options={CONTENT_DECLARATION_OPTIONS} testIdPrefix={`logistics-declaration-${index}`} />
                  {item.cargo_category === 'vehicle' && (
                    <>
                      <Choice label="Does it run" value={item.vehicle_running_state || ''}
                              onChange={(v) => setItem(index, { vehicle_running_state: v as EditableItem['vehicle_running_state'] })}
                              options={[['runs_and_drives', 'Runs and drives'], ['starts_only', 'Starts but cannot be driven'],
                                        ['non_running', 'Does not run'], ['unknown', 'I do not know']]}
                              testId={`logistics-running-${index}`} />
                      <Choice label="Keys" value={item.vehicle_keys_state || ''}
                              onChange={(v) => setItem(index, { vehicle_keys_state: v as EditableItem['vehicle_keys_state'] })}
                              options={[['available', 'Available'], ['missing', 'Missing'], ['unknown', 'I do not know']]}
                              testId={`logistics-keys-${index}`} />
                      <Choice label="Export / deregistration" value={item.export_clearance_state || ''}
                              onChange={(v) => setItem(index, { export_clearance_state: v as EditableItem['export_clearance_state'] })}
                              options={[['completed', 'Completed'], ['in_progress', 'In progress'],
                                        ['not_started', 'Not started'], ['unknown', 'I do not know']]}
                              testId={`logistics-export-${index}`} />
                      <Choice label="Inspection" value={item.inspection_state || ''}
                              onChange={(v) => setItem(index, { inspection_state: v as EditableItem['inspection_state'] })}
                              options={[['completed', 'Completed'], ['booked', 'Booked'],
                                        ['not_arranged', 'Not arranged'], ['unknown', 'I do not know']]}
                              testId={`logistics-inspection-${index}`} />
                      <label className={intakeFieldLabel}>Spare parts travelling with it
                        <Input className="mt-1 rounded-none" value={item.accompanying_parts || ''}
                               onChange={(e) => setItem(index, { accompanying_parts: e.target.value })}
                               data-testid={`logistics-parts-${index}`} placeholder="e.g. spare bumper" />
                      </label>
                      <label className={intakeFieldLabel}>Personal goods travelling with it
                        <Input className="mt-1 rounded-none" value={item.accompanying_personal_goods || ''}
                               onChange={(e) => setItem(index, { accompanying_personal_goods: e.target.value })}
                               data-testid={`logistics-personal-${index}`} />
                        <span className="mt-0.5 block text-[10px] normal-case tracking-normal text-slate-500">
                          Whether goods may travel inside a vehicle depends on the carrier and the port.
                        </span>
                      </label>
                    </>
                  )}
                  <label className={`${intakeFieldLabel} sm:col-span-2`}>Where is this cargo now
                    <Input className="mt-1 rounded-none" value={item.current_location || ''}
                           onChange={(e) => setItem(index, { current_location: e.target.value })}
                           data-testid={`logistics-current-location-${index}`} />
                    <PrivateNote />
                  </label>
                </MoreDetail>

                {item.cargo_category === 'vehicle' && (
                  <div className="mt-4 border-t border-slate-200 pt-4" data-testid="logistics-vehicle-link">
                    <label className={fieldLabel}>Is this one of your CarUp vehicles?
                      <select
                        className={selectClass}
                        data-testid="logistics-vehicle-select"
                        value={item.linked_vehicle_vin || ''}
                        onChange={(e) => {
                          const vin = e.target.value
                          if (!vin) { setItem(index, { linked_vehicle_vin: undefined }); return }
                          const vehicle = (myVehicles || []).find((row) => row.vin === vin)
                          // Reuse the identity CarUp already holds instead of asking for it again.
                          // The description is only replaced when it is empty or was itself
                          // generated from a vehicle, so anything the person typed is preserved.
                          const previous = (myVehicles || []).find((row) => row.vin === item.linked_vehicle_vin)
                          const describedByUs = !item.description.trim() || (previous && item.description.trim() === vehicleIdentity(previous))
                          setItem(index, {
                            linked_vehicle_vin: vin,
                            ...(vehicle && describedByUs ? { description: vehicleIdentity(vehicle) } : {}),
                          })
                        }}
                      >
                        <option value="">No — I will describe it myself</option>
                        {(myVehicles || []).map((vehicle) => (
                          <option key={vehicle.vin} value={vehicle.vin}>
                            {vehicleIdentity(vehicle)} · VIN {vehicle.vin}
                          </option>
                        ))}
                      </select>
                    </label>
                    {myVehiclesUnreadable ? (
                      <p className="mt-2 text-xs text-amber-800" data-testid="logistics-vehicle-unreadable">
                        Your CarUp vehicles could not be loaded, so this list is not a report that
                        you have none. You can still describe the vehicle yourself and continue.
                      </p>
                    ) : myVehicles === null ? (
                      <p className="mt-2 text-xs text-slate-500">Checking your CarUp vehicles…</p>
                    ) : myVehicles.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">
                        No vehicles are recorded against your CarUp account yet. Describe the
                        vehicle above and providers can still quote for it.
                      </p>
                    ) : item.linked_vehicle_vin ? (
                      <p className="mt-2 text-xs text-slate-600" data-testid="logistics-vehicle-linked">
                        Linked to your CarUp vehicle. Providers see that a vehicle is linked and the
                        description — never the VIN. CarUp re-checks that this vehicle is yours when
                        the request is saved.
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        Linking reuses the make, model and year CarUp already holds, so you do not
                        have to type them again.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
            <Button type="button" variant="outline" className="rounded-none" onClick={() => setItems((current) => [...current, emptyItem()])}><Plus className="mr-1.5 h-4 w-4" /> Add another cargo group</Button>
          </div>
        )}

        {step === 1 && (
          <div className="mt-7 space-y-5">
            <div>
              <h2 className="text-lg font-bold text-slate-950">How much space does it need?</h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-600"><strong>CBM</strong> means cubic metres — the amount of container space your cargo occupies. If you know length × width × height, CarUp calculates it. If not, choose “I don’t know yet”. Estimates are not provider verification.</p>
            </div>
            {items.map((item, index) => (
              <div key={index} className="border border-slate-300 bg-white p-5">
                <div className="flex items-center gap-2"><Ruler className="h-4 w-4 text-orange-600" /><h3 className="font-semibold text-slate-950">{item.description || `Cargo group ${index + 1}`}</h3></div>
                <div className="mt-4 flex flex-wrap gap-4 text-sm">
                  {([['dimensions', 'Help me calculate it'], ['volume', 'I know the total volume'], ['unknown', 'I don’t know yet']] as Array<[MeasurementMode, string]>).map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2"><input type="radio" name={`measure-${index}`} checked={item.measurementMode === value} onChange={() => setItem(index, { measurementMode: value })} /> {label}</label>
                  ))}
                </div>
                {item.measurementMode === 'dimensions' && (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <label className={fieldLabel}>Length<Input className="mt-1 rounded-none" type="number" min="0" value={item.length_value ?? ''} onChange={(e) => setItem(index, { length_value: Number(e.target.value) || undefined })} /></label>
                    <label className={fieldLabel}>Width<Input className="mt-1 rounded-none" type="number" min="0" value={item.width_value ?? ''} onChange={(e) => setItem(index, { width_value: Number(e.target.value) || undefined })} /></label>
                    <label className={fieldLabel}>Height<Input className="mt-1 rounded-none" type="number" min="0" value={item.height_value ?? ''} onChange={(e) => setItem(index, { height_value: Number(e.target.value) || undefined })} /></label>
                    <label className={fieldLabel}>Unit<select className={selectClass} value={item.dimension_unit || 'cm'} onChange={(e) => setItem(index, { dimension_unit: e.target.value as 'cm' | 'm' })}><option value="cm">cm</option><option value="m">m</option></select></label>
                    <label className={fieldLabel}>Total weight kg<Input className="mt-1 rounded-none" type="number" min="0" value={item.estimated_weight_kg ?? ''} onChange={(e) => setItem(index, { estimated_weight_kg: Number(e.target.value) || undefined })} /></label>
                  </div>
                )}
                {item.measurementMode === 'dimensions' && (() => {
                  // The step's copy says "CarUp calculates it" — so the calculation must be shown,
                  // here, while the person is typing, not silently carried to the server.
                  const divisor = item.dimension_unit === 'm' ? 1 : 100
                  const l = Number(item.length_value); const w = Number(item.width_value); const h = Number(item.height_value)
                  const cbm = l > 0 && w > 0 && h > 0 ? Math.round(((l / divisor) * (w / divisor) * (h / divisor) * Math.max(1, Number(item.quantity) || 1) + Number.EPSILON) * 1000) / 1000 : null
                  return cbm !== null ? (
                    <p className={`mt-3 border-l-2 pl-3 text-sm ${cbm > 0 ? 'border-emerald-500 text-slate-700' : 'border-red-400 text-red-800'}`} data-testid="logistics-computed-cbm">
                      {cbm > 0 ? <>Estimated volume: <strong>{cbm.toFixed(3)} CBM</strong> for this group ({item.quantity} × {item.length_value}×{item.width_value}×{item.height_value} {item.dimension_unit}). An estimate, not a measurement.</>
                        : <>These measurements round to 0.000 CBM — check the unit ({item.dimension_unit}), or switch to “I know the total volume”.</>}
                    </p>
                  ) : null
                })()}
                {item.measurementMode === 'volume' && (
                  <div className="mt-4 grid max-w-lg gap-3 sm:grid-cols-2">
                    <label className={fieldLabel}>Estimated total volume (CBM)<Input className="mt-1 rounded-none" type="number" min="0" step="0.001" value={item.estimated_volume_cbm ?? ''} onChange={(e) => setItem(index, { estimated_volume_cbm: Number(e.target.value) || undefined })} /></label>
                    <label className={fieldLabel}>Estimated total weight (kg)<Input className="mt-1 rounded-none" type="number" min="0" value={item.estimated_weight_kg ?? ''} onChange={(e) => setItem(index, { estimated_weight_kg: Number(e.target.value) || undefined })} /></label>
                  </div>
                )}
                {item.measurementMode === 'unknown' && <p className="mt-4 border-l-2 border-amber-400 pl-3 text-sm text-slate-600">That is okay. Providers can quote with the size marked unknown, but container-space booking will wait until every cargo group has an estimated volume.</p>}
              </div>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="mt-7 max-w-4xl">
            <h2 className="text-lg font-bold text-slate-950">Where is it going?</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className={fieldLabel}>Origin country<Input className="mt-1 rounded-none" value={originCountry} onChange={(e) => setOriginCountry(e.target.value)} /></label>
              <label className={fieldLabel}>Origin city<Input className="mt-1 rounded-none" value={originCity} onChange={(e) => setOriginCity(e.target.value)} placeholder="e.g. Yokohama" /></label>
              <label className={`${fieldLabel} sm:col-span-2`}>Pickup / warehouse location (optional)<Input className="mt-1 rounded-none" value={originLocation} onChange={(e) => setOriginLocation(e.target.value)} placeholder="Address, warehouse or port if known" /></label>
              <label className={fieldLabel}>Destination country<Input className="mt-1 rounded-none" value={destinationCountry} onChange={(e) => setDestinationCountry(e.target.value)} /></label>
              <label className={fieldLabel}>Destination city<Input className="mt-1 rounded-none" value={destinationCity} onChange={(e) => setDestinationCity(e.target.value)} /></label>
              <label className={`${fieldLabel} sm:col-span-2`}>Final delivery location (optional)<Input className="mt-1 rounded-none" value={destinationLocation} onChange={(e) => setDestinationLocation(e.target.value)} placeholder="Address or collection point if known" /></label>
              <label className={fieldLabel}>Needed by (optional)<Input className="mt-1 rounded-none" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></label>
              <label className={fieldLabel}>Service preference<select className={selectClass} value={servicePreference} onChange={(e) => setServicePreference(e.target.value)}>{SERVICE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="mt-1 block text-[11px] normal-case tracking-normal text-slate-500">{SERVICE_OPTIONS.find(([value]) => value === servicePreference)?.[2]}</span></label>
            </div>

            {/* Pickup — scenario-triggered. The address and contact only exist once someone says
                they need collection, so a customer delivering their own cargo never meets them. */}
            <MoreDetail open={showPickup} onToggle={() => setShowPickup((v) => !v)}
                        summary="Does this cargo need collecting?" testId="ship-more-pickup">
              <Choice label="Pickup" value={pickupRequired} onChange={setPickupRequired}
                      options={[['yes', 'Yes — please collect it'], ['no', 'No — I will deliver it'], ['unsure', 'Not sure yet']]}
                      testId="ship-pickup-required" blankLabel="Not stated" />
              <Choice label="Where is it now" value={originSiteType} onChange={setOriginSiteType}
                      options={[['auction', 'Auction house'], ['dealer', 'Dealer'], ['exporter', 'Exporter'],
                                ['private_seller', 'Private seller'], ['warehouse_yard', 'Warehouse / yard'],
                                ['carup_partner_yard', 'CarUp partner yard'], ['customer_location', 'My own location'],
                                ['other', 'Somewhere else']]}
                      testId="ship-origin-site-type" />
              {pickupRequired === 'yes' && (
                <>
                  <label className={`${intakeFieldLabel} sm:col-span-2`}>Pickup address
                    <Input className="mt-1 rounded-none" value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)}
                           data-testid="ship-pickup-address" placeholder="Where the driver should go" />
                    <PrivateNote />
                  </label>
                  <label className={intakeFieldLabel}>Contact on site
                    <Input className="mt-1 rounded-none" value={pickupContactName} onChange={(e) => setPickupContactName(e.target.value)} data-testid="ship-pickup-contact-name" />
                    <PrivateNote />
                  </label>
                  <label className={intakeFieldLabel}>Contact number
                    <Input className="mt-1 rounded-none" value={pickupContactPhone} onChange={(e) => setPickupContactPhone(e.target.value)} data-testid="ship-pickup-contact-phone" />
                    <PrivateNote />
                  </label>
                  <label className={intakeFieldLabel}>Available for collection from
                    <Input className="mt-1 rounded-none" type="date" value={pickupAvailableFrom} onChange={(e) => setPickupAvailableFrom(e.target.value)} data-testid="ship-pickup-available-from" />
                  </label>
                  <Choice label="Loading equipment on site" value={pickupLoadingEquipment} onChange={setPickupLoadingEquipment}
                          options={[['available', 'Available'], ['not_available', 'Not available'], ['unknown', 'I do not know']]}
                          testId="ship-pickup-loading" />
                  <label className={`${intakeFieldLabel} sm:col-span-2`}>Access or opening notes
                    <textarea className={intakeControl} rows={2} value={pickupAccessNotes} onChange={(e) => setPickupAccessNotes(e.target.value)}
                              data-testid="ship-pickup-access" placeholder="Gate, opening hours, anything a driver needs" />
                    <PrivateNote />
                  </label>
                </>
              )}
            </MoreDetail>

            {/* Destination outcome and what matters — asked before any freight jargon. */}
            <MoreDetail open={showHandling} onToggle={() => setShowHandling((v) => !v)}
                        summary="What should happen when it arrives, and what matters most?"
                        testId="ship-more-destination">
              <Choice label="What do you need" value={destinationOutcome} onChange={setDestinationOutcome}
                      options={DESTINATION_OUTCOME_OPTIONS} testId="ship-destination-outcome"
                      hint="You do not need to know which port." />
              <Choice label="What matters most" value={shippingObjective} onChange={setShippingObjective}
                      options={SHIPPING_OBJECTIVE_OPTIONS} testId="ship-objective" />
              <Choice label="Shipping method preference" value={serviceModePreference} onChange={setServiceModePreference}
                      options={SHIPPING_MODE_OPTIONS} testId="ship-mode"
                      hint="Only if you already know — providers can propose what suits." />
              <Choice label="Unloading at the other end" value={unloadingRequired} onChange={setUnloadingRequired}
                      options={[['yes', 'I need help unloading'], ['no', 'Not needed'], ['unsure', 'Not sure']]}
                      testId="ship-unloading" />
              {/* Delivery contact only appears for outcomes that actually involve delivery. */}
              {['port_to_city', 'door_delivery', 'cross_border_transit'].includes(destinationOutcome) && (
                <>
                  <label className={`${intakeFieldLabel} sm:col-span-2`}>Delivery address
                    <Input className="mt-1 rounded-none" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} data-testid="ship-delivery-address" />
                    <PrivateNote />
                  </label>
                  <label className={intakeFieldLabel}>Who receives it
                    <Input className="mt-1 rounded-none" value={deliveryContactName} onChange={(e) => setDeliveryContactName(e.target.value)} data-testid="ship-delivery-contact-name" />
                    <PrivateNote />
                  </label>
                  <label className={intakeFieldLabel}>Their number
                    <Input className="mt-1 rounded-none" value={deliveryContactPhone} onChange={(e) => setDeliveryContactPhone(e.target.value)} data-testid="ship-delivery-contact-phone" />
                    <PrivateNote />
                  </label>
                </>
              )}
            </MoreDetail>

            {/* Services and timing — intentions, which create no capability. */}
            <MoreDetail open={showServices} onToggle={() => setShowServices((v) => !v)}
                        summary="Do you want help with inspection, insurance or clearing?"
                        testId="ship-more-services">
              <Choice label="Pre-shipment inspection" value={inspectionIntent} onChange={setInspectionIntent}
                      options={INSPECTION_INTENT_OPTIONS} testId="ship-inspection-intent"
                      hint="Records what you want. It does not book anything." />
              <Choice label="Transport insurance" value={insuranceIntent} onChange={setInsuranceIntent}
                      options={INSURANCE_INTENT_OPTIONS} testId="ship-insurance-intent"
                      hint="CarUp does not underwrite insurance." />
              <Choice label="Destination clearing" value={clearingIntent} onChange={setClearingIntent}
                      options={CLEARING_INTENT_OPTIONS} testId="ship-clearing-intent" />
              {clearingIntent === 'own_agent' && (
                <>
                  <label className={intakeFieldLabel}>Your clearing agent
                    <Input className="mt-1 rounded-none" value={clearingAgentName} onChange={(e) => setClearingAgentName(e.target.value)} data-testid="ship-clearing-agent-name" />
                    <PrivateNote />
                  </label>
                  <label className={intakeFieldLabel}>How to reach them
                    <Input className="mt-1 rounded-none" value={clearingAgentContact} onChange={(e) => setClearingAgentContact(e.target.value)} data-testid="ship-clearing-agent-contact" />
                    <PrivateNote />
                  </label>
                </>
              )}
              <label className={intakeFieldLabel}>Cargo available from
                <Input className="mt-1 rounded-none" type="date" value={availableFrom} onChange={(e) => setAvailableFrom(e.target.value)} data-testid="ship-available-from" />
              </label>
              <Choice label="How fixed is your timing" value={timingFlexibility} onChange={setTimingFlexibility}
                      options={TIMING_FLEXIBILITY_OPTIONS} testId="ship-timing-flexibility" />
              <label className={intakeFieldLabel}>Ideal arrival — from
                <Input className="mt-1 rounded-none" type="date" value={arrivalFrom} onChange={(e) => setArrivalFrom(e.target.value)} data-testid="ship-arrival-from" />
              </label>
              <label className={intakeFieldLabel}>Ideal arrival — to
                <Input className="mt-1 rounded-none" type="date" value={arrivalTo} onChange={(e) => setArrivalTo(e.target.value)} data-testid="ship-arrival-to" />
                <span className="mt-0.5 block text-[10px] normal-case tracking-normal text-slate-500">A wish, not a shipping date. Nobody has promised it yet.</span>
              </label>
              <label className={intakeFieldLabel}>Preferred language
                <Input className="mt-1 rounded-none" value={preferredLanguage} onChange={(e) => setPreferredLanguage(e.target.value)} data-testid="ship-language" />
              </label>
              <Choice label="Best way to reach you" value={preferredChannel} onChange={setPreferredChannel}
                      options={[['carup_messages', 'CarUp messages'], ['email', 'Email'], ['phone', 'Phone'], ['whatsapp', 'WhatsApp']]}
                      testId="ship-channel" hint="Providers still reach you through CarUp." />
            </MoreDetail>
          </div>
        )}

        {step === 3 && (
          <div className="mt-7 grid min-w-0 gap-6 lg:grid-cols-[3fr_2fr]">
            <div className="border border-slate-300 bg-white p-5">
              <h2 className="text-lg font-bold text-slate-950">Review your shipping request</h2>
              <p className="mt-1 text-sm text-slate-600">Providers will quote for this cargo and route. Publishing does not book or approve container space.</p>
              <div className="mt-5 space-y-4">
                {items.map((item, index) => <div key={index} className="border-l-2 border-orange-500 pl-3"><p className="font-medium text-slate-950">{item.quantity} × {item.description}</p><p className="text-xs text-slate-600">{categoryLabel(item.cargo_category)} · {(() => {
                  if (item.measurementMode === 'unknown') return 'Size not known yet'
                  if (item.measurementMode === 'volume') return `${item.estimated_volume_cbm || '—'} CBM estimated`
                  const divisor = item.dimension_unit === 'm' ? 1 : 100
                  const l = Number(item.length_value); const w = Number(item.width_value); const h = Number(item.height_value)
                  const cbm = l > 0 && w > 0 && h > 0 ? Math.round(((l / divisor) * (w / divisor) * (h / divisor) * Math.max(1, Number(item.quantity) || 1) + Number.EPSILON) * 1000) / 1000 : null
                  return cbm && cbm > 0 ? `${cbm.toFixed(3)} CBM calculated from dimensions` : 'Dimensions incomplete — volume not yet calculable'
                })()}</p></div>)}
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-xs uppercase tracking-wide text-slate-500">From</dt><dd>{[originCity, originCountry].filter(Boolean).join(', ')}</dd></div><div><dt className="text-xs uppercase tracking-wide text-slate-500">To</dt><dd>{[destinationCity, destinationCountry].filter(Boolean).join(', ')}</dd></div><div><dt className="text-xs uppercase tracking-wide text-slate-500">Service</dt><dd>{serviceLabel(servicePreference)}</dd></div><div><dt className="text-xs uppercase tracking-wide text-slate-500">Needed by</dt><dd>{neededBy || 'Not specified'}</dd></div></dl>

              {/* Request brief — ONLY what was answered. A simple request stays simple rather than
                  becoming a page of "Not provided" rows. */}
              {(() => {
                const label = (opts: Array<[string, string]>, v: string) => opts.find(([k]) => k === v)?.[1] || null
                const group = (heading: string, entries: Array<[string, string | null]>) =>
                  [heading, entries.filter(([, v]) => Boolean(v)) as Array<[string, string]>] as const
                const first = items[0] || ({} as EditableItem)
                const sections = [
                  group('Handling', [
                    ['Packed as', first.packaging_type || null],
                    ['Nature', label([['new', 'New'], ['used', 'Used'], ['personal_effects', 'Personal effects'], ['commercial_goods', 'Commercial goods'], ['unsure', 'Not sure']], first.goods_nature || '')],
                    ['Handling', (first.handling_flags || []).map((f) => HANDLING_FLAG_OPTIONS.find(([k]) => k === f)?.[1] || f).join(' · ') || null],
                    ['Contents declared', (first.content_declarations || []).map((f) => CONTENT_DECLARATION_OPTIONS.find(([k]) => k === f)?.[1] || f).join(' · ') || null],
                    ['Runs', label([['runs_and_drives', 'Runs and drives'], ['starts_only', 'Starts only'], ['non_running', 'Does not run'], ['unknown', 'Not known']], first.vehicle_running_state || '')],
                    ['Keys', label([['available', 'Available'], ['missing', 'Missing'], ['unknown', 'Not known']], first.vehicle_keys_state || '')],
                    ['Export status', label([['completed', 'Completed'], ['in_progress', 'In progress'], ['not_started', 'Not started'], ['unknown', 'Not known']], first.export_clearance_state || '')],
                    ['Travelling with it', [first.accompanying_parts, first.accompanying_personal_goods].filter(Boolean).join(' · ') || null],
                  ]),
                  group('Pickup', [
                    ['Collection', label([['yes', 'CarUp collects it'], ['no', 'I deliver it'], ['unsure', 'Not decided']], pickupRequired)],
                    ['Where it is', label([['auction', 'Auction house'], ['dealer', 'Dealer'], ['exporter', 'Exporter'], ['private_seller', 'Private seller'], ['warehouse_yard', 'Warehouse / yard'], ['carup_partner_yard', 'CarUp partner yard'], ['customer_location', 'My own location'], ['other', 'Elsewhere']], originSiteType)],
                    ['Available from', pickupAvailableFrom || null],
                    ['Pickup details', pickupAddress ? 'Recorded — kept private' : null],
                  ]),
                  group('Destination', [
                    ['Outcome', label(DESTINATION_OUTCOME_OPTIONS, destinationOutcome)],
                    ['Unloading', label([['yes', 'Help needed'], ['no', 'Not needed'], ['unsure', 'Not sure']], unloadingRequired)],
                    ['Delivery details', deliveryAddress || deliveryContactName ? 'Recorded — kept private' : null],
                  ]),
                  group('Shipping preference', [
                    ['What matters most', label(SHIPPING_OBJECTIVE_OPTIONS, shippingObjective)],
                    ['Method', label(SHIPPING_MODE_OPTIONS, serviceModePreference)],
                  ]),
                  group('Services', [
                    ['Inspection', label(INSPECTION_INTENT_OPTIONS, inspectionIntent)],
                    ['Insurance', label(INSURANCE_INTENT_OPTIONS, insuranceIntent)],
                    ['Clearing', label(CLEARING_INTENT_OPTIONS, clearingIntent)],
                  ]),
                  group('Timing', [
                    ['Available from', availableFrom || null],
                    ['Ideal arrival', arrivalFrom || arrivalTo ? `${arrivalFrom || '?'} – ${arrivalTo || '?'}` : null],
                    ['Flexibility', label(TIMING_FLEXIBILITY_OPTIONS, timingFlexibility)],
                  ]),
                ].filter(([, entries]) => entries.length > 0)
                if (!sections.length) return null
                return (
                  <div className="mt-5 space-y-4 border-t border-slate-200 pt-4" data-testid="logistics-request-brief">
                    {sections.map(([heading, entries]) => (
                      <div key={heading} className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-orange-700">{heading}</p>
                        <dl className="mt-1 space-y-1">
                          {entries.map(([k, v]) => (
                            <div key={k} className="flex min-w-0 flex-wrap gap-x-2 text-sm">
                              <dt className="text-slate-500">{k}:</dt>
                              <dd className="min-w-0 font-medium text-slate-900">{v}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
            <div className="border border-slate-300 bg-slate-50 p-5">
              <h2 className="font-bold text-slate-950">What logistics providers will see</h2>
              <ul className="mt-3 space-y-2 text-sm text-slate-700"><li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 text-emerald-600" />Cargo descriptions and quantities</li><li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 text-emerald-600" />Estimated size/weight when you supplied it</li><li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 text-emerald-600" />Origin, destination and timing</li><li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 text-emerald-600" />Whether a vehicle is linked — not its VIN</li></ul>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Not shown in the opportunity</p><p className="mt-1 text-sm text-slate-600">Your user id, tenant id, email, phone and unrelated CarUp records.</p>
              <p className="mt-4 text-xs text-slate-500">CarUp coordinates the request and evidence. A provider’s offer is not customs approval, carrier acceptance or a completed booking.</p>
            </div>
          </div>
        )}

        {error && <Alert className="mt-5 border-red-200 bg-red-50"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">
          {step > 0 && <Button variant="outline" className="rounded-none" onClick={() => setStep((value) => value - 1)} disabled={busy}>Back</Button>}
          {step < 3 ? <Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => { if (step === 0 && items.some((item) => !item.description.trim())) { setError('Describe every cargo group before continuing.'); return } setError(''); setStep((value) => value + 1) }}>Continue <ArrowRight className="ml-1.5 h-4 w-4" /></Button> : <><Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => void save(true)} disabled={busy}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Publish shipping request</Button><Button variant="outline" className="rounded-none" onClick={() => void save(false)} disabled={busy}>Save draft</Button></>}
        </div>
        </div>
      </section>
    )
  }

  if (view === 'detail' && selected) {
    const offers = (selected.quotes || []).filter((quote) => quote.status !== 'DRAFT' && quote.status !== 'WITHDRAWN')
    const meta = transactionStage(selected, offers, reservationState)
    const accepted = offers.find((quote) => quote.id === selected.accepted_quote_id)
    const reservationId = typeof selected.metadata?.reservation_id === 'string' ? selected.metadata.reservation_id : null
    return (
      <section className="mx-auto w-full max-w-[1440px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="logistics-request-detail"><div className="max-w-[1280px]">
        <button type="button" onClick={() => setView('list')} className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-orange-700"><ArrowLeft className="h-4 w-4" /> My shipping</button>
        <div className="mt-4 border-b-2 border-slate-950 pb-4"><p className="font-mono text-xs text-slate-500">{selected.reference}</p><div className="mt-1 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold text-slate-950">{selected.items?.[0]?.description || 'Shipping request'}</h1><p className="mt-1 text-sm text-slate-600">{formatRoute({ city: selected.origin_city, country: selected.origin_country }, { city: selected.destination_city, country: selected.destination_country })}</p></div><div className="text-right"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.tone}`}>{meta.label}</span><p className="mt-1 text-xs text-slate-500">{meta.note}</p></div></div></div>
        {error && <Alert className="mt-5 border-red-200 bg-red-50"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="mt-6 grid min-w-0 gap-8 xl:grid-cols-[2fr_3fr]">
          <div className="min-w-0">
            <h2 className="border-b border-slate-300 pb-2 text-xs font-bold uppercase tracking-wide text-slate-600">Your cargo</h2>
            <div className="mt-3 space-y-3">{selected.items.map((item) => <div key={item.id} className="border-l-2 border-orange-500 pl-3"><p className="font-medium text-slate-950">{item.quantity} × {item.description}</p><p className="text-xs text-slate-600">{categoryLabel(item.cargo_category)} · {item.estimated_volume_cbm ? `${item.estimated_volume_cbm} CBM estimated` : 'Volume not recorded'} · {item.estimated_weight_kg ? `${item.estimated_weight_kg} kg estimated` : 'Weight not recorded'}</p></div>)}</div>
            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-xs uppercase tracking-wide text-slate-500">Service preference</dt><dd>{serviceLabel(selected.service_preference)}</dd></div><div><dt className="text-xs uppercase tracking-wide text-slate-500">Needed by</dt><dd>{selected.needed_by ? String(selected.needed_by).slice(0, 10) : 'Not specified'}</dd></div></dl>
            {selected.status === 'DRAFT' && <Button className="mt-5 bg-orange-500 text-white hover:bg-orange-600" onClick={() => startEdit(selected)}>Edit request</Button>}
            {selected.status === 'OPEN_FOR_QUOTES' && (
              <div className="mt-7" data-testid="logistics-sailing-matches-state">
                <h2 className="text-sm font-bold text-slate-950">CarUp sailings that may fit</h2>
                {sailingsUnreadable ? (
                  <p className="mt-2 border-l-2 border-amber-400 pl-3 text-xs text-amber-900" data-testid="logistics-sailings-unreadable">Compatible sailings could not be checked. This is not a report that none are available; you can still compare provider offers.</p>
                ) : sailings.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500" data-testid="logistics-sailings-empty">No compatible open CarUp sailings were found from the recorded route and capacity facts.</p>
                ) : (() => {
                  /*
                   * A decision aid, not a data dump. Eight near-identical rows — five reading the
                   * same container type, departure and capacity — told the customer nothing and
                   * visually outweighed the actual commercial offer beside it.
                   *
                   * Sailings are grouped by the facts a person actually decides on: WHO operates
                   * it and WHEN it departs. Genuinely equivalent sailings are stated as a count
                   * rather than repeated as if they differed, and only the soonest few departures
                   * are shown up front. Nothing is ranked "best" or "recommended" — CarUp has no
                   * authority for that claim — and the list stays informational, which is what the
                   * current flow actually supports.
                   */
                  const groups = new Map<string, { organiser: string; departure: string; deadline: string; type: string; count: number; bestCapacity: number; anyUnevaluated: boolean }>()
                  for (const sailing of sailings) {
                    const departure = String(sailing.departure_date || '').slice(0, 10)
                    const organiser = sailing.organiser_name || 'Organiser not recorded'
                    const key = `${organiser}|${departure}|${sailing.container_type}`
                    const existing = groups.get(key)
                    if (existing) {
                      existing.count += 1
                      existing.bestCapacity = Math.max(existing.bestCapacity, Number(sailing.available_capacity_cbm) || 0)
                      existing.anyUnevaluated = existing.anyUnevaluated || sailing.capacity_match === null
                    } else {
                      groups.set(key, {
                        organiser, departure, type: sailing.container_type,
                        deadline: String(sailing.booking_deadline || '').slice(0, 10),
                        count: 1,
                        bestCapacity: Number(sailing.available_capacity_cbm) || 0,
                        anyUnevaluated: sailing.capacity_match === null,
                      })
                    }
                  }
                  const ordered = [...groups.values()].sort((a, b) => a.departure.localeCompare(b.departure))
                  const shown = showAllSailings ? ordered : ordered.slice(0, 3)
                  return (
                    <>
                      <p className="mt-1 text-xs text-slate-500">Route and recorded-capacity matches only — they do not mean the cargo is accepted or space is approved. Your provider attaches the sailing when they offer.</p>
                      <div className="mt-3 space-y-2" data-testid="logistics-sailing-groups">
                        {shown.map((group) => (
                          <div key={`${group.organiser}|${group.departure}|${group.type}`} className="border border-slate-200 p-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <p className="font-medium text-slate-900">{group.organiser}</p>
                              <p className="text-xs font-semibold text-slate-700">Departs {group.departure || 'Not recorded'}</p>
                            </div>
                            <p className="mt-0.5 text-xs text-slate-600">
                              {group.type}
                              {group.deadline ? ` · book by ${group.deadline}` : ' · no booking cut-off recorded'}
                              {' · up to '}{group.bestCapacity} CBM recorded available
                            </p>
                            {group.count > 1 && <p className="mt-1 text-[11px] text-slate-500" data-testid="logistics-sailing-group-count">{group.count} sailings on this departure match equally on the facts CarUp records.</p>}
                            {group.anyUnevaluated && <p className="mt-1 text-[11px] text-amber-900">Capacity fit not evaluated — this request’s cargo volume is not fully known yet.</p>}
                          </div>
                        ))}
                      </div>
                      {ordered.length > 3 && (
                        <button type="button" onClick={() => setShowAllSailings((value) => !value)} className="mt-2 text-xs font-semibold text-orange-700 hover:underline" data-testid="logistics-sailing-toggle">
                          {showAllSailings ? 'Show fewer departures' : `Show ${ordered.length - 3} more departure${ordered.length - 3 === 1 ? '' : 's'}`}
                        </button>
                      )}
                    </>
                  )
                })()}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline justify-between border-b border-slate-300 pb-2"><h2 className="text-xs font-bold uppercase tracking-wide text-slate-600">Provider offers</h2><span className="text-xs text-slate-500">{offers.length ? `${offers.length} received` : 'None yet'}</span></div>
            {!offers.length ? <div className="mt-4 border border-dashed border-slate-300 p-6"><p className="font-medium text-slate-900">{selected.status === 'DRAFT' ? 'Not published yet' : 'Waiting for logistics providers'}</p><p className="mt-1 text-sm text-slate-600">{selected.status === 'DRAFT' ? 'Publish when you are ready for providers to quote.' : 'Offers will appear here with price components, service mode and what is included.'}</p></div> : <div className="mt-4 space-y-4">{offers.map((quote) => {
              const chosen = quote.id === selected.accepted_quote_id
              const expired = quoteValidityEnded(quote)
              return <article key={quote.id} className={`border p-5 ${chosen ? 'border-emerald-500 bg-emerald-50/40' : expired ? 'border-amber-300 bg-amber-50/30' : 'border-slate-300 bg-white'}`} data-testid="logistics-offer-card"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-semibold text-slate-950">{quote.provider?.display_name || 'Logistics provider'}</p><p className="text-xs text-slate-500">{[quote.provider?.city, quote.provider?.country].filter(Boolean).join(', ') || 'Location not provided'} · provider-stated, not verified by CarUp</p><p className="mt-2 text-xl font-bold text-slate-950">{money(quote.total_amount, quote.currency)}</p></div><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{quote.service_mode.replace(/_/g, ' ')}</span></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3"><div><dt className="text-[10px] uppercase text-slate-500">Freight</dt><dd>{quote.freight_amount == null ? 'Not provided' : money(quote.freight_amount, quote.currency)}</dd></div><div><dt className="text-[10px] uppercase text-slate-500">Handling</dt><dd>{quote.handling_amount == null ? 'Not provided' : money(quote.handling_amount, quote.currency)}</dd></div><div><dt className="text-[10px] uppercase text-slate-500">Origin charges</dt><dd>{quote.origin_charges == null ? 'Not provided' : money(quote.origin_charges, quote.currency)}</dd></div><div><dt className="text-[10px] uppercase text-slate-500">Destination charges</dt><dd>{quote.destination_charges == null ? 'Not provided' : money(quote.destination_charges, quote.currency)}</dd></div><div><dt className="text-[10px] uppercase text-slate-500">Documentation</dt><dd>{quote.documentation_fees == null ? 'Not provided' : money(quote.documentation_fees, quote.currency)}</dd></div><div><dt className="text-[10px] uppercase text-slate-500">Transit</dt><dd>{quote.transit_days ? `${quote.transit_days} days stated` : 'Not provided'}</dd></div><div><dt className="text-[10px] uppercase text-slate-500">Pickup</dt><dd>{tri(quote.pickup_included)}</dd></div><div><dt className="text-[10px] uppercase text-slate-500">Delivery</dt><dd>{tri(quote.delivery_included)}</dd></div><div><dt className="text-[10px] uppercase text-slate-500">Valid until</dt><dd>{quote.valid_until ? String(quote.valid_until).slice(0, 10) : 'Not provided'}</dd></div></dl>{quote.inclusions?.length ? <p className="mt-3 text-xs text-slate-600"><strong>Includes:</strong> {quote.inclusions.join(', ')}</p> : null}{quote.exclusions?.length ? <p className="text-xs text-slate-600"><strong>Excludes:</strong> {quote.exclusions.join(', ')}</p> : null}{quote.conditions ? <p className="mt-2 text-xs text-slate-600"><strong>Conditions:</strong> {quote.conditions}</p> : null}{expired && <p className="mt-3 text-xs font-semibold text-amber-900" data-testid="logistics-offer-expired">This offer’s stated validity has ended. Ask the provider for a current offer before choosing.</p>}<div className="mt-4 flex flex-wrap gap-2">{!selected.accepted_quote_id && quote.status === 'SUBMITTED' && !expired && <Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => void chooseQuote(quote)} disabled={busy}>Choose this provider</Button>}<Button variant="outline" className="rounded-none" onClick={() => void askProvider(quote.provider_id)} disabled={busy}><MessageSquare className="mr-1.5 h-4 w-4" /> Ask a question</Button></div>{chosen && <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-800"><Check className="h-4 w-4" /> You selected this provider.</p>}</article>
            })}</div>}
            {accepted && (() => {
              const missingVolumeItems = (selected.items || []).filter((item) => item.estimated_volume_cbm == null)
              const confirmReady = missingVolumeItems.every((item) => Number(confirmVolumes[item.id]) > 0)
              return <div className="mt-6 border border-slate-300 bg-slate-50 p-5" data-testid="logistics-continue-panel"><h3 className="font-bold text-slate-950">Continue the shipping transaction</h3>{accepted.compatible_container_id ? <>
                <p className="mt-1 text-sm text-slate-600">This offer references a real CarUp shared-container sailing. Requesting space creates a <strong>pending</strong> reservation; the organiser still has to approve it.</p>

                {/* #28: the wizard promised container-space booking would WAIT for missing volumes,
                    not die on them. Confirming is fill-only — stated measurements stay stated. */}
                {!reservationId && missingVolumeItems.length > 0 && (
                  <div className="mt-4 border-l-2 border-amber-400 pl-3" data-testid="logistics-confirm-measurements">
                    <p className="text-sm font-medium text-slate-900">Confirm the estimated volume before booking space</p>
                    <p className="mt-1 text-xs text-slate-600">Providers quoted this cargo with its size marked unknown. Container space is allocated in CBM, so each group needs an estimate now — it stays an estimate until the organiser or warehouse measures.</p>
                    {missingVolumeItems.map((item) => (
                      <label key={item.id} className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-600">{item.quantity} × {item.description}
                        <span className="mt-1 flex items-center gap-2 normal-case"><Input className="w-32 rounded-none" type="number" min="0.001" step="0.001" value={confirmVolumes[item.id] || ''} onChange={(e) => setConfirmVolumes((current) => ({ ...current, [item.id]: e.target.value }))} data-testid="logistics-confirm-volume-input" /><span className="text-xs tracking-normal text-slate-500">estimated CBM</span></span>
                      </label>
                    ))}
                    <Button className="mt-3 bg-orange-500 text-white hover:bg-orange-600" disabled={busy || !confirmReady} data-testid="logistics-confirm-volumes-submit" onClick={() => void (async () => {
                      if (!selected || busy) return
                      setBusy(true); setError('')
                      try {
                        await confirmMeasurements(selected.id, missingVolumeItems.map((item) => ({ item_id: item.id, estimated_volume_cbm: Number(confirmVolumes[item.id]) })))
                        setBusy(false)
                        await openDetail(selected.id)
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Measurements could not be confirmed')
                        setBusy(false)
                      }
                    })()}>Confirm measurements</Button>
                  </div>
                )}

                {reservationId ? (
                  /* #29: the reservation has a REAL state — narrate that, never a frozen "pending". */
                  reservationState === 'APPROVED' ? <p className="mt-4 text-sm font-semibold text-emerald-800" data-testid="logistics-reservation-approved">Container space approved by the organiser · {reservationId.slice(0, 8)}. Booking, loading and shipping milestones continue in the container workspace.</p>
                  : reservationState === 'REJECTED' || reservationState === 'CANCELLED' ? <p className="mt-4 text-sm font-semibold text-red-800" data-testid="logistics-reservation-refused">The organiser did not approve this space request ({reservationState.toLowerCase()}). Ask the provider through Messages how to continue; the selected offer itself still stands.</p>
                  : reservationState ? <p className="mt-4 text-sm font-semibold text-slate-800" data-testid="logistics-reservation-pending">Container-space request recorded · {reservationId.slice(0, 8)} — waiting for the organiser to review. A request is not yet a booking.{reservationStale && <span className="mt-1 block text-xs font-normal text-slate-500">Showing the last confirmed state; the current one could not be refreshed just now.</span>}</p>
                  : <p className="mt-4 text-sm text-slate-700" data-testid="logistics-reservation-unreadable">Container-space request recorded · {reservationId.slice(0, 8)}. Its current review state is not available right now — this is not a report of approval or rejection.</p>
                ) : missingVolumeItems.length === 0 && <Button className="mt-4 bg-orange-500 text-white hover:bg-orange-600" onClick={() => void requestSpace()} disabled={busy}><Ship className="mr-1.5 h-4 w-4" /> Request container space</Button>}</> : <p className="mt-1 text-sm text-slate-600">This provider did not attach a CarUp container sailing. Continue through Messages to agree the operational next step; CarUp will not invent a booking.</p>}</div>
            })()}
          </div>
        </div>
        </div>
      </section>
    )
  }

  return (
    <section className="mx-auto w-full max-w-[1440px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="trade-my-shipping"><div className="max-w-[1280px]">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-slate-950 pb-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">My shipping</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Move goods you already own or bought</h1><p className="mt-1 max-w-3xl text-sm text-slate-600">Describe the cargo once, let qualified logistics providers propose a service, compare what each price includes, then choose. You can also use open CarUp container space directly.</p></div><Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={startNew}><Plus className="mr-1.5 h-4 w-4" /> New shipping request</Button></div>
      {unreadable && <Alert className="mt-5 border-amber-200 bg-amber-50"><AlertDescription>Your shipping requests could not be loaded. This is not a report that you have none.</AlertDescription></Alert>}
      {error && <Alert className="mt-5 border-red-200 bg-red-50"><AlertDescription>{error}</AlertDescription></Alert>}
      {!unreadable && requests.length === 0 ? <div className="mt-6 border border-dashed border-slate-300 p-8"><Box className="h-7 w-7 text-orange-600" /><h2 className="mt-3 text-lg font-bold text-slate-950">Nothing to ship yet</h2><p className="mt-2 max-w-xl text-sm text-slate-600">Start with what you know. You can request quotes even when dimensions are not final; CarUp keeps unknown measurements visibly unknown.</p><Button className="mt-4 bg-orange-500 text-white hover:bg-orange-600" onClick={startNew}>Create shipping request</Button></div> : <div className="mt-5 divide-y divide-slate-200">{requests.map((request) => { const meta = statusMeta(request.status); return <button key={request.id} type="button" onClick={() => void openDetail(request.id)} className="flex w-full min-w-0 items-start justify-between gap-4 py-5 text-left hover:bg-slate-50"><div className="min-w-0"><p className="truncate font-semibold text-slate-950">{request.items?.[0]?.description || 'Shipping request'}</p><p className="mt-0.5 font-mono text-xs text-slate-500">{request.reference}</p><p className="mt-1 text-sm text-slate-600">{formatRoute({ city: request.origin_city, country: request.origin_country }, { city: request.destination_city, country: request.destination_country })}</p></div><div className="shrink-0 text-right"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.tone}`}>{meta.label}</span><p className="mt-1 text-xs text-slate-500">{meta.note}</p></div></button> })}</div>}
      </div>
    </section>
  )
}
