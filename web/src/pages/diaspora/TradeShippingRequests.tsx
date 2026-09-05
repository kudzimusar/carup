import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Box, Check, Loader2, MessageSquare, Plus, Ruler, Ship, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useNavigate } from 'react-router-dom'
import { useTradeLogisticsApi } from '@/hooks/useTradeLogisticsApi'
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

type EditableItem = LogisticsRequestItemInput & { measurementMode: MeasurementMode }

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

export default function TradeShippingRequests() {
  const api = useTradeLogisticsApi()
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
    })))
    setOriginCountry(request.origin_country || 'Japan')
    setOriginCity(request.origin_city || '')
    setOriginLocation(request.origin_location || '')
    setDestinationCountry(request.destination_country || 'Zimbabwe')
    setDestinationCity(request.destination_city || '')
    setDestinationLocation(request.destination_location || '')
    setNeededBy(request.needed_by ? String(request.needed_by).slice(0, 10) : '')
    setServicePreference(request.service_preference || 'flexible')
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
    })),
  }), [originCountry, originCity, originLocation, destinationCountry, destinationCity, destinationLocation, neededBy, servicePreference, items])

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
      const finalRequest = publish ? await api.publishRequest(saved.id) : saved
      await load()
      if (publish) await openDetail(finalRequest.id)
      else { setSelected(finalRequest); setView('detail') }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Shipping request could not be saved')
    } finally { setBusy(false) }
  }

  const openDetail = async (id: string) => {
    setBusy(true); setError('')
    try {
      const [request, matches] = await Promise.all([
        api.getRequest(id),
        api.findSailingMatches(id).catch(() => []),
      ])
      setSelected(request); setSailings(matches); setView('detail')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Shipping request could not be loaded')
    } finally { setBusy(false) }
  }

  const chooseQuote = async (quote: LogisticsQuote) => {
    if (!selected || busy) return
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
      await api.requestContainerSpace(selected.id)
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
          </div>
        )}

        {step === 3 && (
          <div className="mt-7 grid min-w-0 gap-6 lg:grid-cols-[3fr_2fr]">
            <div className="border border-slate-300 bg-white p-5">
              <h2 className="text-lg font-bold text-slate-950">Review your shipping request</h2>
              <p className="mt-1 text-sm text-slate-600">Providers will quote for this cargo and route. Publishing does not book or approve container space.</p>
              <div className="mt-5 space-y-4">
                {items.map((item, index) => <div key={index} className="border-l-2 border-orange-500 pl-3"><p className="font-medium text-slate-950">{item.quantity} × {item.description}</p><p className="text-xs text-slate-600">{categoryLabel(item.cargo_category)} · {item.measurementMode === 'unknown' ? 'Size not known yet' : item.measurementMode === 'volume' ? `${item.estimated_volume_cbm || '—'} CBM estimated` : 'Dimensions supplied for CBM calculation'}</p></div>)}
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-xs uppercase tracking-wide text-slate-500">From</dt><dd>{[originCity, originCountry].filter(Boolean).join(', ')}</dd></div><div><dt className="text-xs uppercase tracking-wide text-slate-500">To</dt><dd>{[destinationCity, destinationCountry].filter(Boolean).join(', ')}</dd></div><div><dt className="text-xs uppercase tracking-wide text-slate-500">Service</dt><dd>{serviceLabel(servicePreference)}</dd></div><div><dt className="text-xs uppercase tracking-wide text-slate-500">Needed by</dt><dd>{neededBy || 'Not specified'}</dd></div></dl>
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
    const meta = statusMeta(selected.status)
    const offers = (selected.quotes || []).filter((quote) => quote.status !== 'DRAFT' && quote.status !== 'WITHDRAWN')
    const accepted = offers.find((quote) => quote.id === selected.accepted_quote_id)
    const reservationId = typeof selected.metadata?.reservation_id === 'string' ? selected.metadata.reservation_id : null
    return (
      <section className="mx-auto w-full max-w-[1440px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="logistics-request-detail"><div className="max-w-[1280px]">
        <button type="button" onClick={() => setView('list')} className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-orange-700"><ArrowLeft className="h-4 w-4" /> My shipping</button>
        <div className="mt-4 border-b-2 border-slate-950 pb-4"><p className="font-mono text-xs text-slate-500">{selected.reference}</p><div className="mt-1 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold text-slate-950">{selected.items?.[0]?.description || 'Shipping request'}</h1><p className="mt-1 text-sm text-slate-600">{[selected.origin_city, selected.origin_country].filter(Boolean).join(', ')} → {[selected.destination_city, selected.destination_country].filter(Boolean).join(', ')}</p></div><div className="text-right"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.tone}`}>{meta.label}</span><p className="mt-1 text-xs text-slate-500">{meta.note}</p></div></div></div>
        {error && <Alert className="mt-5 border-red-200 bg-red-50"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="mt-6 grid min-w-0 gap-8 xl:grid-cols-[2fr_3fr]">
          <div className="min-w-0">
            <h2 className="border-b border-slate-300 pb-2 text-xs font-bold uppercase tracking-wide text-slate-600">Your cargo</h2>
            <div className="mt-3 space-y-3">{selected.items.map((item) => <div key={item.id} className="border-l-2 border-orange-500 pl-3"><p className="font-medium text-slate-950">{item.quantity} × {item.description}</p><p className="text-xs text-slate-600">{categoryLabel(item.cargo_category)} · {item.estimated_volume_cbm ? `${item.estimated_volume_cbm} CBM estimated` : 'Volume not recorded'} · {item.estimated_weight_kg ? `${item.estimated_weight_kg} kg estimated` : 'Weight not recorded'}</p></div>)}</div>
            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-xs uppercase tracking-wide text-slate-500">Service preference</dt><dd>{serviceLabel(selected.service_preference)}</dd></div><div><dt className="text-xs uppercase tracking-wide text-slate-500">Needed by</dt><dd>{selected.needed_by ? String(selected.needed_by).slice(0, 10) : 'Not specified'}</dd></div></dl>
            {selected.status === 'DRAFT' && <Button className="mt-5 bg-orange-500 text-white hover:bg-orange-600" onClick={() => startEdit(selected)}>Edit request</Button>}
            {selected.status === 'OPEN_FOR_QUOTES' && sailings.length > 0 && <div className="mt-7"><h2 className="text-sm font-bold text-slate-950">CarUp sailings that may fit</h2><p className="mt-1 text-xs text-slate-500">These are route/capacity matches only. They do not mean the cargo is accepted or space is approved.</p><div className="mt-3 space-y-3">{sailings.map((sailing) => <div key={sailing.id} className="border border-slate-200 p-3"><p className="font-medium text-slate-900">{sailing.organiser_name || 'Organiser not recorded'} · {sailing.container_type}</p><p className="text-xs text-slate-600">Departs {String(sailing.departure_date).slice(0, 10)} · {sailing.available_capacity_cbm} CBM recorded available</p></div>)}</div></div>}
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline justify-between border-b border-slate-300 pb-2"><h2 className="text-xs font-bold uppercase tracking-wide text-slate-600">Provider offers</h2><span className="text-xs text-slate-500">{offers.length ? `${offers.length} received` : 'None yet'}</span></div>
            {!offers.length ? <div className="mt-4 border border-dashed border-slate-300 p-6"><p className="font-medium text-slate-900">{selected.status === 'DRAFT' ? 'Not published yet' : 'Waiting for logistics providers'}</p><p className="mt-1 text-sm text-slate-600">{selected.status === 'DRAFT' ? 'Publish when you are ready for providers to quote.' : 'Offers will appear here with price components, service mode and what is included.'}</p></div> : <div className="mt-4 space-y-4">{offers.map((quote) => {
              const chosen = quote.id === selected.accepted_quote_id
              return <article key={quote.id} className={`border p-5 ${chosen ? 'border-emerald-500 bg-emerald-50/40' : 'border-slate-300 bg-white'}`} data-testid="logistics-offer-card"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-semibold text-slate-950">{quote.provider?.display_name || 'Logistics provider'}</p><p className="text-xs text-slate-500">{[quote.provider?.city, quote.provider?.country].filter(Boolean).join(', ') || 'Location not provided'} · provider-stated, not verified by CarUp</p><p className="mt-2 text-xl font-bold text-slate-950">{money(quote.total_amount, quote.currency)}</p></div><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{quote.service_mode.replace(/_/g, ' ')}</span></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3"><div><dt className="text-[10px] uppercase text-slate-500">Freight</dt><dd>{quote.freight_amount == null ? 'Not provided' : money(quote.freight_amount, quote.currency)}</dd></div><div><dt className="text-[10px] uppercase text-slate-500">Handling</dt><dd>{quote.handling_amount == null ? 'Not provided' : money(quote.handling_amount, quote.currency)}</dd></div><div><dt className="text-[10px] uppercase text-slate-500">Origin charges</dt><dd>{quote.origin_charges == null ? 'Not provided' : money(quote.origin_charges, quote.currency)}</dd></div><div><dt className="text-[10px] uppercase text-slate-500">Destination charges</dt><dd>{quote.destination_charges == null ? 'Not provided' : money(quote.destination_charges, quote.currency)}</dd></div><div><dt className="text-[10px] uppercase text-slate-500">Documentation</dt><dd>{quote.documentation_fees == null ? 'Not provided' : money(quote.documentation_fees, quote.currency)}</dd></div><div><dt className="text-[10px] uppercase text-slate-500">Transit</dt><dd>{quote.transit_days ? `${quote.transit_days} days stated` : 'Not provided'}</dd></div><div><dt className="text-[10px] uppercase text-slate-500">Pickup</dt><dd>{tri(quote.pickup_included)}</dd></div><div><dt className="text-[10px] uppercase text-slate-500">Delivery</dt><dd>{tri(quote.delivery_included)}</dd></div><div><dt className="text-[10px] uppercase text-slate-500">Valid until</dt><dd>{quote.valid_until ? String(quote.valid_until).slice(0, 10) : 'Not provided'}</dd></div></dl>{quote.inclusions?.length ? <p className="mt-3 text-xs text-slate-600"><strong>Includes:</strong> {quote.inclusions.join(', ')}</p> : null}{quote.exclusions?.length ? <p className="text-xs text-slate-600"><strong>Excludes:</strong> {quote.exclusions.join(', ')}</p> : null}{quote.conditions ? <p className="mt-2 text-xs text-slate-600"><strong>Conditions:</strong> {quote.conditions}</p> : null}<div className="mt-4 flex flex-wrap gap-2">{!selected.accepted_quote_id && quote.status === 'SUBMITTED' && <Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => void chooseQuote(quote)} disabled={busy}>Choose this provider</Button>}<Button variant="outline" className="rounded-none" onClick={() => void askProvider(quote.provider_id)} disabled={busy}><MessageSquare className="mr-1.5 h-4 w-4" /> Ask a question</Button></div>{chosen && <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-800"><Check className="h-4 w-4" /> You selected this provider.</p>}</article>
            })}</div>}
            {accepted && <div className="mt-6 border border-slate-300 bg-slate-50 p-5"><h3 className="font-bold text-slate-950">Continue the shipping transaction</h3>{accepted.compatible_container_id ? <><p className="mt-1 text-sm text-slate-600">This offer references a real CarUp shared-container sailing. Requesting space creates a <strong>pending</strong> reservation; the organiser still has to approve it.</p>{reservationId ? <p className="mt-4 text-sm font-semibold text-emerald-800">Container-space request recorded · {reservationId.slice(0, 8)}</p> : <Button className="mt-4 bg-orange-500 text-white hover:bg-orange-600" onClick={() => void requestSpace()} disabled={busy}><Ship className="mr-1.5 h-4 w-4" /> Request container space</Button>}</> : <p className="mt-1 text-sm text-slate-600">This provider did not attach a CarUp container sailing. Continue through Messages to agree the operational next step; CarUp will not invent a booking.</p>}</div>}
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
      {!unreadable && requests.length === 0 ? <div className="mt-6 border border-dashed border-slate-300 p-8"><Box className="h-7 w-7 text-orange-600" /><h2 className="mt-3 text-lg font-bold text-slate-950">Nothing to ship yet</h2><p className="mt-2 max-w-xl text-sm text-slate-600">Start with what you know. You can request quotes even when dimensions are not final; CarUp keeps unknown measurements visibly unknown.</p><Button className="mt-4 bg-orange-500 text-white hover:bg-orange-600" onClick={startNew}>Create shipping request</Button></div> : <div className="mt-5 divide-y divide-slate-200">{requests.map((request) => { const meta = statusMeta(request.status); return <button key={request.id} type="button" onClick={() => void openDetail(request.id)} className="flex w-full min-w-0 items-start justify-between gap-4 py-5 text-left hover:bg-slate-50"><div className="min-w-0"><p className="truncate font-semibold text-slate-950">{request.items?.[0]?.description || 'Shipping request'}</p><p className="mt-0.5 font-mono text-xs text-slate-500">{request.reference}</p><p className="mt-1 text-sm text-slate-600">{[request.origin_city, request.origin_country].filter(Boolean).join(', ')} → {[request.destination_city, request.destination_country].filter(Boolean).join(', ')}</p></div><div className="shrink-0 text-right"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.tone}`}>{meta.label}</span><p className="mt-1 text-xs text-slate-500">{meta.note}</p></div></button> })}</div>}
      </div>
    </section>
  )
}
