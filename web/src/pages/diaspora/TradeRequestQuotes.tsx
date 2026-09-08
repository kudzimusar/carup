import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Loader2, Package, Plus, Ship, ShoppingCart, Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { VEHICLE_MAKES, modelsForMake } from '@/data/vehicleTaxonomy'
import type { DiasporaBuyerOrderPayload, DiasporaRequestLinePayload, Vehicle } from '@/types'

/**
 * Request Quotes — the buyer's guided sourcing journey (Trade OS T2 §9.1–§9.3).
 *
 * The product rule this file exists to satisfy: a buyer states an intention in ordinary language
 * and CarUp turns it into the authoritative record. Nobody is asked to understand "Reverse RFQ",
 * "import order" or a part number they have never seen. Nothing publishes on first save — the
 * buyer reviews exactly what suppliers will see, then publishes deliberately.
 */

type Intent = 'buy' | 'ship'
type BuyKind = 'vehicle' | 'parts' | 'mixed'

const CONDITIONS: Array<[string, string]> = [
  ['any', 'Any condition'],
  ['new', 'New'],
  ['used', 'Used'],
  ['oem', 'Genuine / OEM'],
  ['aftermarket', 'Quality aftermarket'],
]

const URGENCIES: Array<[string, string]> = [
  ['NORMAL', 'No rush'],
  ['HIGH', 'Soon'],
  ['URGENT', 'Urgent'],
]

const CURRENCIES = ['USD', 'JPY', 'ZWG', 'ZAR', 'GBP', 'EUR']

const fieldLabel = 'block min-w-0 text-xs font-medium uppercase tracking-wide text-gray-600'
const control = 'mt-1 block w-full min-w-0 border border-gray-300 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:outline-none'

/**
 * Progressive disclosure (contract §36.4).
 *
 * The capabilities all exist; they are not all shown. A first-time buyer completes the same four
 * steps they always did and never opens one of these. Someone who knows what they want — a dealer
 * specifying RHD, a mileage ceiling and CIF Beira — opens it and finds structured fields rather
 * than a free-text box nobody downstream can read.
 *
 * The wording matters: "may help providers quote more accurately", never "incomplete". Nothing
 * inside is required, and leaving it shut is a legitimate way to publish.
 */
function MoreDetail({ open, onToggle, summary, children, testId }: {
  open: boolean; onToggle: () => void; summary: string; children: React.ReactNode; testId: string
}) {
  return (
    <div className="mt-5 border-t border-gray-200 pt-4">
      <button type="button" onClick={onToggle} data-testid={testId}
              className="flex w-full min-w-0 items-center justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-gray-950">{summary}</span>
          <span className="block text-xs text-gray-500">Optional — it may help suppliers quote more accurately.</span>
        </span>
        <span className="shrink-0 text-sm font-semibold text-orange-600">{open ? 'Hide' : 'Add'}</span>
      </button>
      {open && <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">{children}</div>}
    </div>
  )
}

/** A select whose blank option is a real answer: "not stated" is never a default. */
function Choice({ label, value, onChange, options, hint, testId }: {
  label: string; value: string; onChange: (v: string) => void
  options: Array<[string, string]>; hint?: string; testId: string
}) {
  return (
    <label className={fieldLabel}>{label}
      <select className={control} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        <option value="">No preference / not sure</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <span className="mt-0.5 block text-[10px] normal-case tracking-normal text-gray-500">{hint}</span>}
    </label>
  )
}

const OUTCOME_OPTIONS: Array<[string, string]> = [
  ['port_only', 'Collect it at the port myself'],
  ['port_plus_clearing', 'Port, and I need help clearing it'],
  ['cross_border_transit', 'Port, then across the border'],
  ['port_to_city', 'Bring it to my city'],
  ['door_delivery', 'Deliver it to my address'],
  ['unsure', "I'm not sure — recommend options"],
]
const OBJECTIVE_OPTIONS: Array<[string, string]> = [
  ['lowest_cost', 'Lowest reasonable cost'],
  ['faster_arrival', 'Faster arrival'],
  ['better_protection', 'Better protection / security'],
  ['extra_goods', 'I need to ship other goods with it'],
  ['non_running', 'The vehicle does not run'],
  ['multiple_vehicles', 'I have multiple vehicles'],
  ['private_container', 'I want a private container'],
  ['flexible', "I'm flexible — recommend suitable options"],
]
const BUDGET_BASIS_OPTIONS: Array<[string, string]> = [
  ['item_only', 'The vehicle/item price only'],
  ['fob', 'Purchase at the export port (FOB)'],
  ['export_side', 'Purchase plus export-side charges'],
  ['cif_port', 'Everything to the destination port (CIF)'],
  ['port_cleared', 'Everything up to cleared at the port'],
  ['delivered', 'Everything, delivered to me'],
  ['unsure', "I'm not sure — help me work it out"],
]
const QUOTE_COMPONENT_OPTIONS: Array<[string, string]> = [
  ['item_price', 'Vehicle / item price'],
  ['origin_inland_transport', 'Inland transport at origin'],
  ['auction_export_charges', 'Auction / exporter charges'],
  ['export_processing', 'Export processing'],
  ['inspection', 'Inspection'],
  ['ocean_freight', 'Ocean freight'],
  ['insurance', 'Insurance'],
  ['destination_clearing', 'Destination clearing'],
  ['cross_border_transit', 'Cross-border transit'],
  ['inland_delivery', 'Final delivery'],
]

const emptyLine = (): DiasporaRequestLinePayload => ({
  item_description: '', quantity: 1, part_number: '', part_number_known: false, condition_preference: 'any',
})

/** Human summary of one line, used in the review step and the privacy preview. */
function describeLine(line: DiasporaRequestLinePayload): string {
  const vehicle = [line.vehicle_make, line.vehicle_model].filter(Boolean).join(' ')
  const bits = [
    line.quantity && line.quantity > 1 ? `${line.quantity} ×` : null,
    line.item_description || 'Item',
    vehicle ? `for ${vehicle}` : null,
    line.part_number_known && line.part_number ? `(part ${line.part_number})` : null,
  ].filter(Boolean)
  return bits.join(' ')
}

export default function TradeRequestQuotes() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const { createDiasporaBuyerOrder, updateDiasporaBuyerOrder, publishDiasporaRfq, fetchDiasporaBuyerOrder, fetchVehicles } = useCarUpApi()
  const [searchParams] = useSearchParams()
  // When ?edit=<id> is present we are amending an EXISTING draft, not creating a new request.
  const editId = searchParams.get('edit')
  const [hydrating, setHydrating] = useState(Boolean(editId))

  const [intent, setIntent] = useState<Intent | null>(null)
  const [kind, setKind] = useState<BuyKind | null>(null)
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Vehicle request
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [yearMin, setYearMin] = useState('')
  const [yearMax, setYearMax] = useState('')
  const [condition, setCondition] = useState('any')
  const [requirements, setRequirements] = useState('')

  // Parts / mixed request
  const [lines, setLines] = useState<DiasporaRequestLinePayload[]>([emptyLine()])
  const [myVehicles, setMyVehicles] = useState<Vehicle[] | null>(null)
  const [vehiclesUnreadable, setVehiclesUnreadable] = useState(false)

  // Shared
  const [originCountry, setOriginCountry] = useState('Japan')
  const [destinationCountry, setDestinationCountry] = useState('Zimbabwe')
  const [destinationCity, setDestinationCity] = useState('')
  const [budget, setBudget] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [discloseBudget, setDiscloseBudget] = useState(false)
  const [urgency, setUrgency] = useState('NORMAL')
  const [neededBy, setNeededBy] = useState('')

  /**
   * Intake 2.0 (contract §36). Every one of these is optional and starts EMPTY — never at a
   * plausible default — because a blank here means "not stated" and is written as null. They live
   * behind optional disclosure so the four-step path a first-time buyer walks is unchanged: you can
   * still say "find me an Alphard and get it to Harare" without opening any of it.
   */
  const [showMoreVehicle, setShowMoreVehicle] = useState(false)
  const [showMoreOutcome, setShowMoreOutcome] = useState(false)
  const [showMoreServices, setShowMoreServices] = useState(false)

  // What matters / where it ends up
  const [destinationOutcome, setDestinationOutcome] = useState('')
  const [destinationArea, setDestinationArea] = useState('')
  const [preferredPort, setPreferredPort] = useState('')
  const [consigneeKind, setConsigneeKind] = useState('')
  const [shippingObjective, setShippingObjective] = useState('')
  const [shippingMode, setShippingMode] = useState('')
  // What the budget MEANS
  const [budgetBasis, setBudgetBasis] = useState('')
  const [budgetMax, setBudgetMax] = useState('')
  const [budgetFlexibility, setBudgetFlexibility] = useState('')
  // Services the buyer wants help with — intentions, not capabilities
  const [inspectionIntent, setInspectionIntent] = useState('')
  const [insuranceIntent, setInsuranceIntent] = useState('')
  const [clearingIntent, setClearingIntent] = useState('')
  const [paymentIntent, setPaymentIntent] = useState('')
  const [quoteComponents, setQuoteComponents] = useState<string[]>([])
  // Timing as a window
  const [availableFrom, setAvailableFrom] = useState('')
  const [arrivalFrom, setArrivalFrom] = useState('')
  const [arrivalTo, setArrivalTo] = useState('')
  const [timingFlexibility, setTimingFlexibility] = useState('')
  const [deadlineIsHard, setDeadlineIsHard] = useState(false)
  // Vehicle preferences a supplier matches inventory against
  const [steering, setSteering] = useState('')
  const [transmission, setTransmission] = useState('')
  const [drivetrain, setDrivetrain] = useState('')
  const [fuelType, setFuelType] = useState('')
  const [bodyType, setBodyType] = useState('')
  const [mileageMax, setMileageMax] = useState('')
  const [seatsMin, setSeatsMin] = useState('')
  const [colourPreference, setColourPreference] = useState('')
  const [accidentTolerance, setAccidentTolerance] = useState('')
  const [rustTolerance, setRustTolerance] = useState('')
  const [intendedUse, setIntendedUse] = useState('')
  const [alternativesPolicy, setAlternativesPolicy] = useState('')
  const [alternativeModels, setAlternativeModels] = useState('')

  /**
   * Load an existing DRAFT into the wizard so the buyer amends it rather than retyping it
   * (audit item 5). Only a draft is loaded; a published request is not editable here.
   */
  useEffect(() => {
    if (!editId || !isAuthenticated) return
    let live = true
    fetchDiasporaBuyerOrder(editId)
      .then((order) => {
        if (!live) return
        const orderLines = (order.request_lines as DiasporaRequestLinePayload[] | undefined) || []
        setIntent('buy')
        setKind(order.order_type === 'vehicle' ? 'vehicle' : orderLines.length > 1 ? 'mixed' : 'parts')
        setOriginCountry(String(order.origin_country || 'Japan'))
        setDestinationCountry(String(order.destination_country || 'Zimbabwe'))
        setDestinationCity(String(order.destination_city || ''))
        if (order.budget_amount) setBudget(String(order.budget_amount))
        if (order.budget_currency) setCurrency(String(order.budget_currency))
        setDiscloseBudget(order.metadata?.rfq?.discloseBudget === true)
        if (order.metadata?.rfq?.neededBy) setNeededBy(String(order.metadata.rfq.neededBy))
        if (order.metadata?.urgency) setUrgency(String(order.metadata.urgency))
        if (order.order_type === 'vehicle') {
          setMake(String(order.requested_make || ''))
          setModel(String(order.requested_model || ''))
          if (order.requested_year_min) setYearMin(String(order.requested_year_min))
          if (order.requested_year_max) setYearMax(String(order.requested_year_max))
          if (order.metadata?.rfq?.buyerNotes) setRequirements(String(order.metadata.rfq.buyerNotes))
        } else if (orderLines.length) {
          setLines(orderLines.map((l) => ({ ...l, part_number: l.part_number || '' })))
        }
        // Intake 2.0 — a longer form makes reliable hydration non-negotiable: a draft that reopens
        // with half its answers missing silently destroys work the buyer already did.
        const o = order as unknown as Record<string, unknown>
        const str = (k: string) => (o[k] === null || o[k] === undefined ? '' : String(o[k]))
        setDestinationOutcome(str('destination_outcome')); setDestinationArea(str('destination_area'))
        setPreferredPort(str('preferred_port')); setConsigneeKind(str('consignee_kind'))
        setShippingObjective(str('shipping_objective')); setShippingMode(str('shipping_mode_preference'))
        setBudgetBasis(str('budget_basis')); setBudgetMax(str('budget_max_amount'))
        setBudgetFlexibility(str('budget_flexibility'))
        setInspectionIntent(str('inspection_intent')); setInsuranceIntent(str('insurance_intent'))
        setClearingIntent(str('clearing_intent')); setPaymentIntent(str('payment_intent'))
        setQuoteComponents(Array.isArray(o.requested_quote_components) ? o.requested_quote_components as string[] : [])
        setAvailableFrom(str('available_from')); setArrivalFrom(str('arrival_window_start'))
        setArrivalTo(str('arrival_window_end')); setTimingFlexibility(str('timing_flexibility'))
        setDeadlineIsHard(o.deadline_is_hard === true)
        setAlternativesPolicy(str('alternatives_policy'))
        const firstLine = (orderLines[0] || {}) as unknown as Record<string, unknown>
        const lineStr = (k: string) => (firstLine[k] === null || firstLine[k] === undefined ? '' : String(firstLine[k]))
        setSteering(lineStr('vehicle_steering')); setTransmission(lineStr('vehicle_transmission'))
        setDrivetrain(lineStr('vehicle_drivetrain')); setFuelType(lineStr('vehicle_fuel_type'))
        setBodyType(lineStr('vehicle_body_type')); setMileageMax(lineStr('vehicle_mileage_max_km'))
        setSeatsMin(lineStr('vehicle_seats_min')); setColourPreference(lineStr('vehicle_colour_preference'))
        setAccidentTolerance(lineStr('accident_repair_tolerance')); setRustTolerance(lineStr('rust_tolerance'))
        setIntendedUse(lineStr('intended_use'))
        setAlternativeModels(Array.isArray(firstLine.alternative_models) ? (firstLine.alternative_models as string[]).join(', ') : '')
        // Anything the buyer had opened stays open, so returning to a draft does not hide their work.
        if (o.destination_outcome || o.shipping_objective) setShowMoreOutcome(true)
        if (o.inspection_intent || o.insurance_intent || o.clearing_intent || o.payment_intent) setShowMoreServices(true)
        if (firstLine.vehicle_steering || firstLine.intended_use) setShowMoreVehicle(true)

        setStep(0)
      })
      .catch(() => { if (live) setError('That draft could not be loaded. It has not been changed.') })
      .finally(() => { if (live) setHydrating(false) })
    return () => { live = false }
  }, [editId, isAuthenticated, fetchDiasporaBuyerOrder])

  // The buyer's own vehicles let a parts request reuse canonical identity instead of retyping.
  useEffect(() => {
    if (!isAuthenticated || kind === 'vehicle' || myVehicles !== null) return
    let live = true
    fetchVehicles()
      .then((v) => { if (live) { setMyVehicles(v || []); setVehiclesUnreadable(false) } })
      .catch(() => { if (live) { setMyVehicles([]); setVehiclesUnreadable(true) } })
    return () => { live = false }
  }, [isAuthenticated, kind, myVehicles, fetchVehicles])

  const setLine = (index: number, patch: Partial<DiasporaRequestLinePayload>) =>
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))

  const isMulti = kind === 'mixed'
  const activeLines = useMemo(
    () => (isMulti ? lines : lines.slice(0, 1)).filter((l) => l.item_description.trim()),
    [lines, isMulti],
  )

  const summary = useMemo(() => {
    if (kind === 'vehicle') {
      const years = yearMin || yearMax ? `${yearMin || 'any'}–${yearMax || 'any'}` : 'Any suitable year'
      return {
        title: [make, model].filter(Boolean).join(' ') || 'Vehicle (details flexible)',
        rows: [
          ['Years', years],
          ['Condition', CONDITIONS.find(([v]) => v === condition)?.[1] || 'Any condition'],
          ['Destination', [destinationCity, destinationCountry].filter(Boolean).join(', ')],
          ['Source preference', originCountry || 'No preference'],
          ['Budget', budget ? `${budget} ${currency}${discloseBudget ? '' : ' (kept private)'}` : 'Not stated'],
          ['Timing', neededBy ? `Needed by ${neededBy}` : URGENCIES.find(([v]) => v === urgency)?.[1] || 'No rush'],
        ] as Array<[string, string]>,
      }
    }
    return {
      title: activeLines.length === 1 ? describeLine(activeLines[0]) : `${activeLines.length} parts`,
      rows: [
        ['Items', activeLines.length ? activeLines.map(describeLine).join(' · ') : 'None added yet'],
        ['Destination', [destinationCity, destinationCountry].filter(Boolean).join(', ')],
        ['Source preference', originCountry || 'No preference'],
        ['Budget', budget ? `${budget} ${currency}${discloseBudget ? '' : ' (kept private)'}` : 'Not stated'],
        ['Timing', neededBy ? `Needed by ${neededBy}` : URGENCIES.find(([v]) => v === urgency)?.[1] || 'No rush'],
      ] as Array<[string, string]>,
    }
  }, [kind, make, model, yearMin, yearMax, condition, activeLines, destinationCity, destinationCountry, originCountry, budget, currency, discloseBudget, neededBy, urgency])

  /**
   * The Request Brief — the answers the buyer actually gave, in the words they chose.
   *
   * Only ANSWERED questions appear. An unopened section contributes nothing, so a simple request
   * still reads as a simple request rather than a page of "Not specified" rows, and a detailed one
   * reads as a brief a supplier can act on.
   */
  const briefSections = useMemo(() => {
    const label = (options: Array<[string, string]>, value: string) => options.find(([v]) => v === value)?.[1] || null
    const rows = (entries: Array<[string, string | null]>) => entries.filter(([, v]) => Boolean(v)) as Array<[string, string]>

    const requirements = rows([
      ['Steering', label([['rhd', 'Right-hand drive'], ['lhd', 'Left-hand drive'], ['either', 'Either']], steering)],
      ['Transmission', label([['automatic', 'Automatic'], ['manual', 'Manual'], ['either', 'Either']], transmission)],
      ['Drivetrain', label([['2wd', '2WD'], ['4wd_awd', '4WD / AWD'], ['either', 'Either']], drivetrain)],
      ['Fuel', fuelType.trim() || null],
      ['Body', bodyType.trim() || null],
      ['Maximum mileage', mileageMax ? `${Number(mileageMax).toLocaleString()} km` : null],
      ['Minimum seats', seatsMin || null],
      ['Colour', colourPreference.trim() || null],
      ['Accident-repaired', label([['none', 'Not acceptable'], ['minor_acceptable', 'Minor repairs acceptable'], ['flexible', 'Flexible'], ['unsure', 'Not sure']], accidentTolerance)],
      ['Rust', label([['none', 'Not acceptable'], ['minor_acceptable', 'Minor acceptable'], ['flexible', 'Flexible'], ['unsure', 'Not sure']], rustTolerance)],
      ['Purpose', label([['personal_family', 'Personal / family'], ['company', 'Company use'], ['taxi_ride_hailing', 'Taxi / ride-hailing'], ['dealer_resale', 'Dealer stock / resale'], ['commercial_transport', 'Commercial transport'], ['farm', 'Farm'], ['mining_industrial', 'Mining / industrial'], ['restoration_project', 'Restoration project'], ['donor_parts', 'Parts / donor vehicle'], ['other', 'Something else']], intendedUse)],
      ['Alternatives', label([['exact_only', 'This model only'], ['flexible_trim', 'Same model, flexible trim'], ['similar_models', 'Similar models are fine'], ['supplier_may_propose', 'Suppliers may propose alternatives'], ['ask_before_proposing', 'Ask me first']], alternativesPolicy)],
      ['Also acceptable', alternativeModels.trim() || null],
    ])

    const outcome = rows([
      ['What you need', label(OUTCOME_OPTIONS, destinationOutcome)],
      ['What matters most', label(OBJECTIVE_OPTIONS, shippingObjective)],
      ['Shipping method', label([['no_preference', 'No preference'], ['roro', 'RoRo'], ['shared_container', 'Shared container'], ['private_container', 'Private container'], ['provider_recommendation', 'Provider recommendation']], shippingMode)],
      ['Preferred port', preferredPort.trim() || null],
    ])

    const commercial = rows([
      ['Budget covers', label(BUDGET_BASIS_OPTIONS, budgetBasis)],
      ['Inspection', label([['please_arrange', 'Wants help arranging it'], ['already_arranged', 'Already arranged'], ['already_completed', 'Already completed'], ['unsure', 'Not sure if required'], ['not_applicable', 'Not applicable']], inspectionIntent)],
      ['Insurance', label([['interested', 'Interested'], ['not_interested', 'Not interested'], ['already_insured', 'Already insured'], ['unsure', 'Not sure']], insuranceIntent)],
      ['Clearing', label([['own_agent', 'Has own agent'], ['want_provider', 'Wants a provider'], ['arrange_later', 'Will arrange later'], ['unsure', 'Not sure']], clearingIntent)],
      ['Offers should cover', quoteComponents.length
        ? quoteComponents.map((c) => QUOTE_COMPONENT_OPTIONS.find(([v]) => v === c)?.[1] || c).join(' · ') : null],
      ['Timing', [availableFrom ? `available from ${availableFrom}` : null,
                  arrivalFrom || arrivalTo ? `ideally arriving ${arrivalFrom || '?'} – ${arrivalTo || '?'}` : null,
                  label([['fixed', 'fixed deadline'], ['somewhat_flexible', 'somewhat flexible'], ['flexible', 'flexible']], timingFlexibility)]
        .filter(Boolean).join(', ') || null],
    ])

    return [
      ['Your requirements', requirements],
      ['Destination outcome', outcome],
      ['Commercial and services', commercial],
    ].filter(([, entries]) => (entries as Array<unknown>).length > 0) as Array<[string, Array<[string, string]>]>
  }, [steering, transmission, drivetrain, fuelType, bodyType, mileageMax, seatsMin, colourPreference,
      accidentTolerance, rustTolerance, intendedUse, alternativesPolicy, alternativeModels,
      destinationOutcome, shippingObjective, shippingMode, preferredPort, budgetBasis,
      inspectionIntent, insuranceIntent, clearingIntent, quoteComponents,
      availableFrom, arrivalFrom, arrivalTo, timingFlexibility])

  const buildPayload = useCallback((): DiasporaBuyerOrderPayload => {
    const base: DiasporaBuyerOrderPayload = {
      order_type: kind === 'vehicle' ? 'vehicle' : kind === 'mixed' ? 'mixed' : 'parts',
      origin_country: originCountry.trim() || 'Japan',
      destination_country: destinationCountry.trim() || 'Zimbabwe',
      destination_city: destinationCity.trim() || undefined,
      urgency,
      disclose_budget: discloseBudget,
    }
    if (budget && Number(budget) > 0) { base.budget_amount = Number(budget); base.budget_currency = currency }
    if (neededBy) base.needed_by = neededBy
    if (kind === 'vehicle') {
      if (make.trim()) base.requested_make = make.trim()
      if (model.trim()) base.requested_model = model.trim()
      if (yearMin) base.requested_year_min = Number(yearMin)
      if (yearMax) base.requested_year_max = Number(yearMax)
      if (requirements.trim()) base.buyer_notes = requirements.trim()
      base.lines = [{
        item_description: [make, model].filter(Boolean).join(' ') || 'Vehicle',
        item_kind: 'vehicle',
        quantity: 1,
        vehicle_make: make.trim() || undefined,
        vehicle_model: model.trim() || undefined,
        vehicle_year_min: yearMin ? Number(yearMin) : undefined,
        vehicle_year_max: yearMax ? Number(yearMax) : undefined,
        condition_preference: condition as DiasporaRequestLinePayload['condition_preference'],
        notes: requirements.trim() || undefined,
      }]
    } else {
      base.lines = activeLines.map((l) => ({
        ...l,
        item_kind: 'part',
        quantity: Number(l.quantity) > 0 ? Number(l.quantity) : 1,
        part_number: l.part_number_known ? l.part_number : undefined,
      }))
      const first = activeLines[0]
      if (first?.vehicle_make) base.requested_make = first.vehicle_make
      if (first?.vehicle_model) base.requested_model = first.vehicle_model
      if (first?.part_number_known && first.part_number) base.requested_part_number = first.part_number
    }
    // Intake 2.0 — only ANSWERED questions are sent. An untouched control contributes nothing, so
    // the server writes null rather than a default, and "not stated" survives all the way down.
    const answered: Record<string, unknown> = {
      intake_intent: kind === 'vehicle' ? 'buy_vehicle' : 'buy_parts',
      destination_outcome: destinationOutcome || undefined,
      destination_area: destinationArea.trim() || undefined,
      preferred_port: preferredPort.trim() || undefined,
      consignee_kind: consigneeKind || undefined,
      shipping_objective: shippingObjective || undefined,
      shipping_mode_preference: shippingMode || undefined,
      budget_basis: budgetBasis || undefined,
      budget_max_amount: budgetMax ? Number(budgetMax) : undefined,
      budget_flexibility: budgetFlexibility || undefined,
      budget_disclosed: discloseBudget,
      inspection_intent: inspectionIntent || undefined,
      insurance_intent: insuranceIntent || undefined,
      clearing_intent: clearingIntent || undefined,
      payment_intent: paymentIntent || undefined,
      requested_quote_components: quoteComponents.length ? quoteComponents : undefined,
      available_from: availableFrom || undefined,
      arrival_window_start: arrivalFrom || undefined,
      arrival_window_end: arrivalTo || undefined,
      timing_flexibility: timingFlexibility || undefined,
      deadline_is_hard: deadlineIsHard || undefined,
      alternatives_policy: alternativesPolicy || undefined,
    }
    for (const [key, value] of Object.entries(answered)) {
      if (value !== undefined) (base as unknown as Record<string, unknown>)[key] = value
    }

    // Vehicle preferences belong to the LINE, because they describe the thing being sourced.
    if (kind === 'vehicle' && base.lines?.[0]) {
      const linePrefs: Record<string, unknown> = {
        vehicle_steering: steering || undefined,
        vehicle_transmission: transmission || undefined,
        vehicle_drivetrain: drivetrain || undefined,
        vehicle_fuel_type: fuelType.trim() || undefined,
        vehicle_body_type: bodyType.trim() || undefined,
        vehicle_mileage_max_km: mileageMax ? Number(mileageMax) : undefined,
        vehicle_seats_min: seatsMin ? Number(seatsMin) : undefined,
        vehicle_colour_preference: colourPreference.trim() || undefined,
        accident_repair_tolerance: accidentTolerance || undefined,
        rust_tolerance: rustTolerance || undefined,
        intended_use: intendedUse || undefined,
        alternative_models: alternativeModels.trim()
          ? alternativeModels.split(',').map((v) => v.trim()).filter(Boolean)
          : undefined,
      }
      for (const [key, value] of Object.entries(linePrefs)) {
        if (value !== undefined) (base.lines[0] as unknown as Record<string, unknown>)[key] = value
      }
    }

    return base
  }, [kind, originCountry, destinationCountry, destinationCity, urgency, discloseBudget, budget, currency,
      neededBy, make, model, yearMin, yearMax, requirements, condition, activeLines,
      destinationOutcome, destinationArea, preferredPort, consigneeKind, shippingObjective, shippingMode,
      budgetBasis, budgetMax, budgetFlexibility, inspectionIntent, insuranceIntent, clearingIntent,
      paymentIntent, quoteComponents, availableFrom, arrivalFrom, arrivalTo, timingFlexibility,
      deadlineIsHard, alternativesPolicy, steering, transmission, drivetrain, fuelType, bodyType,
      mileageMax, seatsMin, colourPreference, accidentTolerance, rustTolerance, intendedUse, alternativeModels])

  const canPublish = kind === 'vehicle'
    ? Boolean(destinationCountry.trim())
    : activeLines.length > 0 && Boolean(destinationCountry.trim())

  /** Save the draft, then publish it. Two governed steps — never one silent one. */
  const handlePublish = async () => {
    if (saving) return
    setError('')
    if (!canPublish) { setError('Add at least one item and a destination before publishing.'); return }
    setSaving(true)
    try {
      const created = editId
        ? await updateDiasporaBuyerOrder(editId, buildPayload())
        : await createDiasporaBuyerOrder(buildPayload())
      await publishDiasporaRfq(created.id || editId!)
      navigate(`/diaspora/requests/${created.id || editId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish your request')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveDraft = async () => {
    if (saving) return
    setError('')
    setSaving(true)
    try {
      const created = editId
        ? await updateDiasporaBuyerOrder(editId, buildPayload())
        : await createDiasporaBuyerOrder(buildPayload())
      navigate(`/diaspora/requests/${created.id || editId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your draft')
    } finally {
      setSaving(false)
    }
  }

  if (authLoading || hydrating) {
    return <div className="flex min-h-[50vh] items-center justify-center text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  // ── Step 0: what do you need help with? ───────────────────────────────────
  if (!intent) {
    return (
      <div className="mx-auto w-full max-w-[1100px] min-w-0 px-4 py-10 sm:px-6 lg:px-10" data-testid="trade-request-intent">
        <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">What do you need help with?</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600">
          CarUp connects you with suppliers and logistics providers, keeps the conversation and the
          paperwork attached to your transaction, and follows it through to Zimbabwe.
        </p>
        <div className="mt-8 grid min-w-0 gap-5 md:grid-cols-2">
          <button
            type="button"
            onClick={() => { setIntent('buy'); setStep(0) }}
            className="group min-w-0 border border-gray-300 bg-white p-6 text-left transition-colors hover:border-orange-500"
            data-testid="trade-intent-buy"
          >
            <ShoppingCart className="h-7 w-7 text-orange-600" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-bold text-gray-950">Buy something</h2>
            <p className="mt-1 text-sm text-gray-600">
              Tell CarUp what you need. Suitable suppliers can send you offers, so you can compare
              price, availability and terms before choosing.
            </p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-700">
              Request quotes <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => setIntent('ship')}
            className="group min-w-0 border border-gray-300 bg-white p-6 text-left transition-colors hover:border-orange-500"
            data-testid="trade-intent-ship"
          >
            <Ship className="h-7 w-7 text-slate-700" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-bold text-gray-950">Ship something</h2>
            <p className="mt-1 text-sm text-gray-600">
              Already have the goods? Arrange transport — including sharing space in a container
              with other participants.
            </p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              Arrange shipping <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </span>
          </button>
        </div>
      </div>
    )
  }

  // ── Ship path: the two real ways to move cargo you already own ────────────
  // This used to end in a dead end saying multi-provider logistics quotation was unavailable.
  // T3 built it, so the primary action is now the shipping request itself. The user-facing words
  // stay ordinary — "ask providers to quote", never "logistics RFQ".
  if (intent === 'ship') {
    return (
      <div className="mx-auto w-full max-w-[900px] min-w-0 px-4 py-10 sm:px-6 lg:px-10" data-testid="trade-ship-path">
        <button type="button" onClick={() => setIntent(null)} className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-orange-700">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
        </button>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-gray-950">Ship something</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          You already have the goods and need to move them. You can ask logistics providers to
          quote for the job, or go straight to a shared container an organiser is already running.
        </p>

        <div className="mt-6 border border-gray-300 bg-white p-5">
          <h2 className="text-base font-bold text-gray-950">Ask providers to quote</h2>
          <p className="mt-1 text-sm text-gray-600">
            Describe the cargo once — vehicles, parts, household effects or other eligible goods —
            and qualified logistics providers reply with what they would charge and what that
            price includes. You compare the offers and choose. You do not need dimensions or
            freight knowledge to start; unknown measurements stay visibly unknown.
          </p>
          <Button asChild className="mt-4 bg-orange-500 text-white hover:bg-orange-600">
            <Link to="/diaspora/containers?view=mine" data-testid="trade-ship-request">Create a shipping request</Link>
          </Button>
        </div>

        <div className="mt-4 border border-gray-300 bg-white p-5">
          <h2 className="text-base font-bold text-gray-950">Shared container space</h2>
          <p className="mt-1 text-sm text-gray-600">
            Already know you want to share a container? Browse open sailings and request space
            directly. The organiser reviews and approves your booking.
          </p>
          <Button asChild variant="outline" className="mt-4 rounded-none">
            <Link to="/diaspora/containers?view=containers" data-testid="trade-ship-containers">Find container space</Link>
          </Button>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-gray-500">
          A provider&rsquo;s offer is a price for a stated service. It is not customs approval,
          carrier acceptance, or approved container space — those remain separate steps CarUp
          keeps visibly separate.
        </p>
      </div>
    )
  }

  // ── Buy path: choose what you are sourcing ────────────────────────────────
  if (!kind) {
    const options: Array<[BuyKind, string, string, typeof Package]> = [
      ['vehicle', 'A vehicle', 'A car, van, truck or bike you want to import.', ShoppingCart],
      ['parts', 'A vehicle part', 'One part — you do not need the part number.', Package],
      // T2 writes every non-vehicle line as item_kind='part', so this advertises parts only.
      // True mixed vehicle+part sourcing is a later decision (recorded in the master plan).
      ['mixed', 'Several parts', 'Multiple parts in one request, quoted together.', Package],
    ]
    return (
      <div className="mx-auto w-full max-w-[1100px] min-w-0 px-4 py-10 sm:px-6 lg:px-10" data-testid="trade-request-kind">
        <button type="button" onClick={() => setIntent(null)} className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-orange-700">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
        </button>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">What are you looking for?</h1>
        <div className="mt-8 grid min-w-0 gap-5 md:grid-cols-3">
          {options.map(([value, title, blurb, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => { setKind(value); setStep(0) }}
              className="min-w-0 border border-gray-300 bg-white p-5 text-left transition-colors hover:border-orange-500"
              data-testid={`trade-kind-${value}`}
            >
              <Icon className="h-6 w-6 text-orange-600" aria-hidden="true" />
              <h2 className="mt-3 font-bold text-gray-950">{title}</h2>
              <p className="mt-1 text-sm text-gray-600">{blurb}</p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Guided capture ────────────────────────────────────────────────────────
  const steps = kind === 'vehicle'
    ? ['Vehicle', 'Destination', 'Budget & timing', 'Review']
    : ['Items', 'Destination', 'Budget & timing', 'Review']
  const isReview = step === steps.length - 1

  return (
    <div className="mx-auto w-full max-w-[1100px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="trade-request-wizard">
      <button
        type="button"
        onClick={() => (step === 0 ? setKind(null) : setStep((s) => s - 1))}
        className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-orange-700"
        data-testid="trade-request-back"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
      </button>

      <ol className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5" data-testid="trade-request-steps">
        {steps.map((label, i) => (
          <li key={label} className="flex items-center gap-1.5 text-xs">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
              i < step ? 'bg-emerald-600 text-white' : i === step ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-600'
            }`}>
              {i < step ? <Check className="h-3 w-3" aria-hidden="true" /> : i + 1}
            </span>
            <span className={i === step ? 'font-semibold text-gray-950' : 'text-gray-500'}>{label}</span>
          </li>
        ))}
      </ol>

      <div className="mt-6 min-w-0">
        {/* Step 1 — what */}
        {step === 0 && kind === 'vehicle' && (
          <section className="min-w-0" data-testid="trade-step-vehicle">
            <h1 className="text-xl font-bold text-gray-950">What vehicle are you looking for?</h1>
            <p className="mt-1 text-sm text-gray-600">If you are flexible, leave a field blank — suppliers can still offer suitable vehicles.</p>
            <div className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2">
              <label className={fieldLabel}>Make
                <select className={control} value={make} onChange={(e) => { setMake(e.target.value); setModel('') }} data-testid="trade-vehicle-make">
                  <option value="">I&apos;m flexible / not sure</option>
                  {VEHICLE_MAKES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className={fieldLabel}>Model
                <select className={control} value={model} onChange={(e) => setModel(e.target.value)} disabled={!make} data-testid="trade-vehicle-model">
                  <option value="">{make ? 'Any model' : 'Choose a make first'}</option>
                  {modelsForMake(make).map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
              </label>
              <label className={fieldLabel}>Earliest year
                <Input className="mt-1 rounded-none" type="number" placeholder="Any" value={yearMin} onChange={(e) => setYearMin(e.target.value)} data-testid="trade-vehicle-year-min" />
              </label>
              <label className={fieldLabel}>Latest year
                <Input className="mt-1 rounded-none" type="number" placeholder="Any" value={yearMax} onChange={(e) => setYearMax(e.target.value)} data-testid="trade-vehicle-year-max" />
              </label>
              <label className={fieldLabel}>Condition
                <select className={control} value={condition} onChange={(e) => setCondition(e.target.value)} data-testid="trade-vehicle-condition">
                  {CONDITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <div className="sm:col-span-2">
                <MoreDetail open={showMoreVehicle} onToggle={() => setShowMoreVehicle((v) => !v)}
                            summary="Do you have specific requirements?" testId="trade-more-vehicle">
                  <Choice label="Steering" value={steering} onChange={setSteering}
                          options={[['rhd', 'Right-hand drive'], ['lhd', 'Left-hand drive'], ['either', 'Either']]}
                          testId="trade-steering" />
                  <Choice label="Transmission" value={transmission} onChange={setTransmission}
                          options={[['automatic', 'Automatic'], ['manual', 'Manual'], ['either', 'Either']]}
                          testId="trade-transmission" />
                  <Choice label="Drivetrain" value={drivetrain} onChange={setDrivetrain}
                          options={[['2wd', '2WD'], ['4wd_awd', '4WD / AWD'], ['either', 'Either']]}
                          testId="trade-drivetrain" />
                  <label className={fieldLabel}>Fuel type (optional)
                    <Input className="mt-1 rounded-none" placeholder="e.g. petrol, hybrid" value={fuelType}
                           onChange={(e) => setFuelType(e.target.value)} data-testid="trade-fuel-type" />
                  </label>
                  <label className={fieldLabel}>Body type (optional)
                    <Input className="mt-1 rounded-none" placeholder="e.g. SUV, van" value={bodyType}
                           onChange={(e) => setBodyType(e.target.value)} data-testid="trade-body-type" />
                  </label>
                  <label className={fieldLabel}>Maximum mileage in km (optional)
                    <Input className="mt-1 rounded-none" inputMode="numeric" placeholder="e.g. 80000" value={mileageMax}
                           onChange={(e) => setMileageMax(e.target.value)} data-testid="trade-mileage-max" />
                  </label>
                  <label className={fieldLabel}>Minimum seats (optional)
                    <Input className="mt-1 rounded-none" inputMode="numeric" value={seatsMin}
                           onChange={(e) => setSeatsMin(e.target.value)} data-testid="trade-seats-min" />
                  </label>
                  <label className={fieldLabel}>Colour preference (optional)
                    <Input className="mt-1 rounded-none" value={colourPreference}
                           onChange={(e) => setColourPreference(e.target.value)} data-testid="trade-colour" />
                  </label>
                  <Choice label="Accident-repaired vehicles" value={accidentTolerance} onChange={setAccidentTolerance}
                          options={[['none', 'Not acceptable'], ['minor_acceptable', 'Minor repairs acceptable'],
                                    ['flexible', 'Flexible'], ['unsure', 'Not sure']]}
                          testId="trade-accident-tolerance"
                          hint="What you will accept. It says nothing about any particular vehicle's history." />
                  <Choice label="Rust" value={rustTolerance} onChange={setRustTolerance}
                          options={[['none', 'Not acceptable'], ['minor_acceptable', 'Minor acceptable'],
                                    ['flexible', 'Flexible'], ['unsure', 'Not sure']]}
                          testId="trade-rust-tolerance" />
                  <Choice label="What will you use it for" value={intendedUse} onChange={setIntendedUse}
                          options={[['personal_family', 'Personal / family'], ['company', 'Company use'],
                                    ['taxi_ride_hailing', 'Taxi / ride-hailing'], ['dealer_resale', 'Dealer stock / resale'],
                                    ['commercial_transport', 'Commercial transport'], ['farm', 'Farm'],
                                    ['mining_industrial', 'Mining / industrial'], ['restoration_project', 'Restoration project'],
                                    ['donor_parts', 'Parts / donor vehicle'], ['other', 'Something else']]}
                          testId="trade-intended-use" />
                  <Choice label="Are alternatives acceptable" value={alternativesPolicy} onChange={setAlternativesPolicy}
                          options={[['exact_only', 'This model only'], ['flexible_trim', 'Same model, flexible trim'],
                                    ['similar_models', 'Similar models are fine'],
                                    ['supplier_may_propose', 'Suppliers may propose alternatives'],
                                    ['ask_before_proposing', 'Ask me before proposing alternatives']]}
                          testId="trade-alternatives-policy" />
                  <label className={fieldLabel}>Models you would also accept (optional)
                    <Input className="mt-1 rounded-none" placeholder="e.g. Toyota Vellfire" value={alternativeModels}
                           onChange={(e) => setAlternativeModels(e.target.value)} data-testid="trade-alternative-models" />
                    <span className="mt-0.5 block text-[10px] normal-case tracking-normal text-gray-500">Separate several with commas.</span>
                  </label>
                </MoreDetail>
              </div>

              <label className={`${fieldLabel} sm:col-span-2`}>Anything else suppliers should know? (optional)
                <textarea className={control} rows={2} value={requirements} onChange={(e) => setRequirements(e.target.value)} placeholder="e.g. must be hybrid, low mileage preferred" data-testid="trade-vehicle-requirements" />
              </label>
            </div>
          </section>
        )}

        {step === 0 && kind !== 'vehicle' && (
          <section className="min-w-0" data-testid="trade-step-parts">
            <h1 className="text-xl font-bold text-gray-950">{isMulti ? 'What parts do you need?' : 'What part do you need?'}</h1>
            <p className="mt-1 text-sm text-gray-600">
              Describe it in ordinary language — “front shocks” is enough. You do not need a part number.
            </p>
            {(isMulti ? lines : lines.slice(0, 1)).map((line, index) => (
              <div key={index} className="mt-5 min-w-0 border border-gray-200 bg-gray-50 p-4" data-testid="trade-part-line">
                {isMulti && (
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Part {index + 1}</span>
                    {lines.length > 1 && (
                      <button type="button" className="p-1 text-gray-400 hover:text-red-600" aria-label={`Remove part ${index + 1}`} onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <label className={`${fieldLabel} sm:col-span-2`}>What part do you need?
                    <Input className="mt-1 rounded-none bg-white" placeholder="e.g. Front shocks" value={line.item_description} onChange={(e) => setLine(index, { item_description: e.target.value })} data-testid="trade-part-description" />
                  </label>
                  <label className={fieldLabel}>How many?
                    <Input className="mt-1 rounded-none bg-white" type="number" min="1" value={String(line.quantity ?? 1)} onChange={(e) => setLine(index, { quantity: Number(e.target.value) })} data-testid="trade-part-quantity" />
                  </label>
                  <label className={fieldLabel}>Condition
                    <select className={control} value={line.condition_preference || 'any'} onChange={(e) => setLine(index, { condition_preference: e.target.value as DiasporaRequestLinePayload['condition_preference'] })} data-testid="trade-part-condition">
                      {CONDITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>

                  <fieldset className="min-w-0 border border-gray-200 bg-white p-3 sm:col-span-2">
                    <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-600">Part number</legend>
                    <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm" role="radiogroup" aria-label="Do you know the part number?">
                      <label className="flex items-center gap-1.5">
                        <input type="radio" name={`pn-${index}`} checked={!line.part_number_known} onChange={() => setLine(index, { part_number_known: false })} data-testid="trade-part-number-unknown" />
                        I don&apos;t know it
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" name={`pn-${index}`} checked={Boolean(line.part_number_known)} onChange={() => setLine(index, { part_number_known: true })} data-testid="trade-part-number-known" />
                        I have the part number
                      </label>
                    </div>
                    {line.part_number_known ? (
                      <Input className="mt-2 rounded-none" placeholder="e.g. 51605-TF0-901" value={line.part_number || ''} onChange={(e) => setLine(index, { part_number: e.target.value })} data-testid="trade-part-number-input" />
                    ) : (
                      <p className="mt-2 text-xs text-gray-600" data-testid="trade-part-number-reassurance">
                        That&apos;s fine — most buyers don&apos;t. Tell us which vehicle the part is for and
                        suppliers will identify it.
                      </p>
                    )}
                  </fieldset>

                  <label className={fieldLabel}>Vehicle make
                    <select className={control} value={line.vehicle_make || ''} onChange={(e) => setLine(index, { vehicle_make: e.target.value, vehicle_model: '' })} data-testid="trade-part-vehicle-make">
                      <option value="">Not sure</option>
                      {VEHICLE_MAKES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                  <label className={fieldLabel}>Vehicle model
                    <select className={control} value={line.vehicle_model || ''} onChange={(e) => setLine(index, { vehicle_model: e.target.value })} disabled={!line.vehicle_make} data-testid="trade-part-vehicle-model">
                      <option value="">{line.vehicle_make ? 'Any model' : 'Choose a make first'}</option>
                      {modelsForMake(line.vehicle_make).map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                    </select>
                  </label>

                  {(myVehicles?.length ?? 0) > 0 && (
                    <label className={`${fieldLabel} sm:col-span-2`}>…or choose one of your CarUp vehicles
                      <select
                        className={control}
                        value={line.linked_vehicle_vin || ''}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                          const v = (myVehicles || []).find((x) => x.vin === e.target.value)
                          setLine(index, v
                            ? { linked_vehicle_vin: v.vin, vehicle_make: v.make, vehicle_model: v.model, vehicle_year_min: v.year }
                            : { linked_vehicle_vin: undefined })
                        }}
                        data-testid="trade-part-my-vehicle"
                      >
                        <option value="">Not one of my vehicles</option>
                        {(myVehicles || []).map((v) => (
                          <option key={v.vin} value={v.vin}>{[v.year, v.make, v.model].filter(Boolean).join(' ')}</option>
                        ))}
                      </select>
                      <span className="mt-0.5 block text-[10px] normal-case tracking-normal text-gray-500">
                        CarUp uses that vehicle&apos;s recorded identity, so you don&apos;t retype it.
                      </span>
                    </label>
                  )}
                  {vehiclesUnreadable && (
                    <p className="text-[11px] text-amber-800 sm:col-span-2">Your vehicles could not be loaded — you can still enter the vehicle details above.</p>
                  )}
                </div>
              </div>
            ))}
            {isMulti && (
              <Button variant="outline" size="sm" className="mt-3 rounded-none" onClick={() => setLines((prev) => [...prev, emptyLine()])} data-testid="trade-add-item">
                <Plus className="mr-1 h-3.5 w-3.5" /> Add another part
              </Button>
            )}
          </section>
        )}

        {/* Step 2 — destination */}
        {step === 1 && (
          <section className="min-w-0" data-testid="trade-step-destination">
            <h1 className="text-xl font-bold text-gray-950">Where should it go?</h1>
            <div className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2">
              <label className={fieldLabel}>Destination country
                <Input className="mt-1 rounded-none" value={destinationCountry} onChange={(e) => setDestinationCountry(e.target.value)} data-testid="trade-destination-country" />
              </label>
              <label className={fieldLabel}>Destination city
                <Input className="mt-1 rounded-none" placeholder="e.g. Harare" value={destinationCity} onChange={(e) => setDestinationCity(e.target.value)} data-testid="trade-destination-city" />
              </label>
              <label className={fieldLabel}>Preferred source country (optional)
                <Input className="mt-1 rounded-none" value={originCountry} onChange={(e) => setOriginCountry(e.target.value)} data-testid="trade-origin-country" />
                <span className="mt-0.5 block text-[10px] normal-case tracking-normal text-gray-500">Leave as is if you have no preference.</span>
              </label>
            </div>

            <MoreDetail open={showMoreOutcome} onToggle={() => setShowMoreOutcome((v) => !v)}
                        summary="What should happen when it arrives?" testId="trade-more-outcome">
              <Choice label="What do you need" value={destinationOutcome} onChange={setDestinationOutcome}
                      options={OUTCOME_OPTIONS} testId="trade-destination-outcome"
                      hint="You do not need to know which port. CarUp works that out later." />
              <Choice label="What matters most" value={shippingObjective} onChange={setShippingObjective}
                      options={OBJECTIVE_OPTIONS} testId="trade-shipping-objective" />
              <label className={fieldLabel}>Delivery area (optional)
                <Input className="mt-1 rounded-none" placeholder="e.g. Borrowdale" value={destinationArea}
                       onChange={(e) => setDestinationArea(e.target.value)} data-testid="trade-destination-area" />
                <span className="mt-0.5 block text-[10px] normal-case tracking-normal text-gray-500">Kept private — never shown to suppliers.</span>
              </label>
              <Choice label="Who receives it" value={consigneeKind} onChange={setConsigneeKind}
                      options={[['self', 'Me'], ['my_company', 'My company'], ['another_person', 'Another person'],
                                ['another_company', 'Another company'], ['undecided', 'Not decided yet']]}
                      testId="trade-consignee-kind" hint="Kept private." />
              <Choice label="Shipping method preference" value={shippingMode} onChange={setShippingMode}
                      options={[['no_preference', 'No preference'], ['roro', 'RoRo (driven on/off)'],
                                ['shared_container', 'Shared container'], ['private_container', 'Private container'],
                                ['provider_recommendation', 'Whatever the provider recommends']]}
                      testId="trade-shipping-mode"
                      hint="Only if you already know. Providers can propose what suits." />
              <label className={fieldLabel}>Preferred port (optional)
                <Input className="mt-1 rounded-none" placeholder="Leave blank if unsure" value={preferredPort}
                       onChange={(e) => setPreferredPort(e.target.value)} data-testid="trade-preferred-port" />
              </label>
            </MoreDetail>
          </section>
        )}

        {/* Step 3 — budget & timing */}
        {step === 2 && (
          <section className="min-w-0" data-testid="trade-step-budget">
            <h1 className="text-xl font-bold text-gray-950">Budget and timing</h1>
            <p className="mt-1 text-sm text-gray-600">Both are optional. Suppliers can still quote without a budget.</p>
            <div className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2">
              <div className="flex min-w-0 gap-3">
                <label className={`${fieldLabel} min-w-0 flex-1`}>Budget (optional)
                  <Input className="mt-1 rounded-none" type="number" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} data-testid="trade-budget-amount" />
                </label>
                <label className={`${fieldLabel} w-24 shrink-0`}>Currency
                  <select className={control} value={currency} onChange={(e) => setCurrency(e.target.value)} data-testid="trade-budget-currency">
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
              <label className={fieldLabel}>How soon do you need it?
                <select className={control} value={urgency} onChange={(e) => setUrgency(e.target.value)} data-testid="trade-urgency">
                  {URGENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className={fieldLabel}>Needed by (optional)
                <Input className="mt-1 rounded-none" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} data-testid="trade-needed-by" />
              </label>
              {budget && (
                <label className="flex min-w-0 items-start gap-2 self-end text-sm text-gray-700 sm:col-span-2">
                  <input type="checkbox" className="mt-0.5" checked={discloseBudget} onChange={(e) => setDiscloseBudget(e.target.checked)} data-testid="trade-disclose-budget" />
                  <span>
                    Show my budget to suppliers.
                    <span className="block text-xs text-gray-500">Off by default — your budget stays private and suppliers quote their own price.</span>
                  </span>
                </label>
              )}
            </div>

            <MoreDetail open={showMoreServices} onToggle={() => setShowMoreServices((v) => !v)}
                        summary="What should your budget cover, and what help do you want?"
                        testId="trade-more-services">
              <Choice label="What does your budget include" value={budgetBasis} onChange={setBudgetBasis}
                      options={BUDGET_BASIS_OPTIONS} testId="trade-budget-basis"
                      hint="Kept private. It tells CarUp what your number means — it does not calculate a price." />
              <label className={fieldLabel}>Maximum you would go to (optional)
                <Input className="mt-1 rounded-none" inputMode="decimal" value={budgetMax}
                       onChange={(e) => setBudgetMax(e.target.value)} data-testid="trade-budget-max" />
                <span className="mt-0.5 block text-[10px] normal-case tracking-normal text-gray-500">Never shown to suppliers.</span>
              </label>
              <Choice label="Pre-shipment inspection" value={inspectionIntent} onChange={setInspectionIntent}
                      options={[['please_arrange', 'Please help arrange it'], ['already_arranged', 'Already arranged'],
                                ['already_completed', 'Already completed'], ['unsure', 'Not sure if it is required'],
                                ['not_applicable', 'Not applicable']]}
                      testId="trade-inspection-intent" hint="Records what you want. It does not book anything." />
              <Choice label="Transport insurance" value={insuranceIntent} onChange={setInsuranceIntent}
                      options={[['interested', 'Interested — explain the options'], ['not_interested', 'Not interested'],
                                ['already_insured', 'Already insured'], ['unsure', 'Not sure']]}
                      testId="trade-insurance-intent" hint="CarUp does not underwrite insurance." />
              <Choice label="Destination clearing" value={clearingIntent} onChange={setClearingIntent}
                      options={[['own_agent', 'I have my own clearing agent'], ['want_provider', 'Connect me with someone'],
                                ['arrange_later', 'I will arrange it later'], ['unsure', 'Not sure']]}
                      testId="trade-clearing-intent" />
              <Choice label="How you expect to pay" value={paymentIntent} onChange={setPaymentIntent}
                      options={[['bank_transfer', 'Bank transfer'], ['already_paid', 'Already paid the supplier'],
                                ['outstanding', 'Still outstanding'], ['financing_needed', 'I need financing'],
                                ['installments_interest', 'Interested in instalments'],
                                ['safetrade_interest', 'Interested in SafeTrade'],
                                ['decide_after_quote', 'I will decide after quotes']]}
                      testId="trade-payment-intent" hint="Kept private. Recording an interest does not create a facility." />
              <div className="sm:col-span-2">
                <p className={fieldLabel}>What should supplier offers cover?</p>
                <p className="mt-0.5 text-[10px] normal-case tracking-normal text-gray-500">
                  Asking for a component does not mean a supplier offers it — each offer states what it actually includes.
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {QUOTE_COMPONENT_OPTIONS.map(([value, label]) => (
                    <label key={value} className="flex min-w-0 items-start gap-2 text-sm text-gray-700">
                      <input type="checkbox" className="mt-0.5" checked={quoteComponents.includes(value)}
                             data-testid={`trade-quote-component-${value}`}
                             onChange={(e) => setQuoteComponents((prev) => (
                               e.target.checked ? [...prev, value] : prev.filter((v) => v !== value)))} />
                      <span className="min-w-0">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label className={fieldLabel}>Cargo/vehicle available from (optional)
                <Input className="mt-1 rounded-none" type="date" value={availableFrom}
                       onChange={(e) => setAvailableFrom(e.target.value)} data-testid="trade-available-from" />
              </label>
              <Choice label="How fixed is your timing" value={timingFlexibility} onChange={setTimingFlexibility}
                      options={[['fixed', 'Fixed — I have a hard deadline'], ['somewhat_flexible', 'Somewhat flexible'],
                                ['flexible', 'Flexible']]} testId="trade-timing-flexibility" />
              <label className={fieldLabel}>Ideal arrival — from (optional)
                <Input className="mt-1 rounded-none" type="date" value={arrivalFrom}
                       onChange={(e) => setArrivalFrom(e.target.value)} data-testid="trade-arrival-from" />
              </label>
              <label className={fieldLabel}>Ideal arrival — to (optional)
                <Input className="mt-1 rounded-none" type="date" value={arrivalTo}
                       onChange={(e) => setArrivalTo(e.target.value)} data-testid="trade-arrival-to" />
                <span className="mt-0.5 block text-[10px] normal-case tracking-normal text-gray-500">A wish, not a shipping date. No one has promised it yet.</span>
              </label>
            </MoreDetail>
          </section>
        )}

        {/* Step 4 — review + privacy preview */}
        {isReview && (
          <section className="min-w-0" data-testid="trade-step-review">
            <h1 className="text-xl font-bold text-gray-950">Review your request</h1>
            <div className="mt-5 grid min-w-0 gap-6 lg:grid-cols-2">
              <div className="min-w-0 border border-gray-300 bg-white p-5">
                <h2 className="text-base font-bold text-gray-950" data-testid="trade-review-title">{summary.title}</h2>
                <dl className="mt-3 space-y-2">
                  {summary.rows.map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
                      <dd className="text-sm text-gray-900">{value}</dd>
                    </div>
                  ))}
                </dl>

                {briefSections.length > 0 && (
                  <div className="mt-5 space-y-4 border-t border-gray-200 pt-4" data-testid="trade-request-brief">
                    {briefSections.map(([heading, entries]) => (
                      <div key={heading} className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-orange-700">{heading}</p>
                        <dl className="mt-1 space-y-1">
                          {entries.map(([k, v]) => (
                            <div key={k} className="flex min-w-0 flex-wrap gap-x-2 text-sm">
                              <dt className="text-gray-500">{k}:</dt>
                              <dd className="min-w-0 font-medium text-gray-900">{v}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="min-w-0 border border-slate-300 bg-slate-50 p-5" data-testid="trade-privacy-preview">
                <h2 className="text-base font-bold text-gray-950">What suppliers will see</h2>
                <p className="mt-1 text-xs text-gray-600">Suppliers see what you need — not who you are.</p>
                <ul className="mt-3 space-y-1.5 text-sm text-gray-800">
                  <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" /> What you are looking for, and how many</li>
                  <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" /> Destination ({[destinationCity, destinationCountry].filter(Boolean).join(', ') || 'not set'})</li>
                  <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" /> Your timing</li>
                  {discloseBudget && budget && <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" /> Your budget ({budget} {currency}) — because you chose to show it</li>}
                </ul>
                <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Never shared</p>
                <ul className="mt-1.5 space-y-1 text-sm text-gray-600">
                  <li>Your name, email and phone number</li>
                  <li>Your organisation and other CarUp records</li>
                  {!discloseBudget && <li>Your budget</li>}
                </ul>
                <p className="mt-4 text-xs text-gray-600">
                  Suppliers reply through CarUp. You choose who to deal with — publishing does not
                  commit you to anything.
                </p>
              </div>
            </div>
            {error && <Alert className="mt-4 border-red-200 bg-red-50" data-testid="trade-request-error"><AlertDescription>{error}</AlertDescription></Alert>}
          </section>
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-gray-200 pt-5">
        {!isReview ? (
          <Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => setStep((s) => s + 1)} data-testid="trade-request-next">
            Continue <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
          </Button>
        ) : (
          <>
            <Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={handlePublish} disabled={saving} data-testid="trade-request-publish">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null} Publish request
            </Button>
            <Button variant="outline" className="rounded-none" onClick={handleSaveDraft} disabled={saving} data-testid="trade-request-save-draft">
              Save as draft
            </Button>
            <span className="text-xs text-gray-500">Publishing lets suppliers send you offers.</span>
          </>
        )}
      </div>
    </div>
  )
}
