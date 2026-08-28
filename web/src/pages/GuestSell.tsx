import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BadgeCheck, Camera, CarFront, CircleDot, Eye, FileCheck2, Gauge, LockKeyhole, LogIn, MapPin, ScanLine, ShieldCheck, Sparkles, UploadCloud, WalletCards, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from '@/context/AuthContext'
import { zimbabweLocations, zimbabweProvinces } from '@/data/mockData'
import { BODY_STYLES, DRIVETRAINS, FUEL_TYPES, SELLER_CONDITIONS, TRANSMISSIONS, VEHICLE_COLORS, VEHICLE_MAKES, isValidVehicleYear, modelsForMake } from '@/data/vehicleTaxonomy'
import { saveGuestSellDraft } from '@/lib/guestSellDraft'
import { LISTING_IMAGE_LIMIT, screenListingImages } from '@/lib/listingMediaIntake'
import { MarketplaceListingCard } from '@/components/marketplace/MarketplaceListingCard'
import { sellerDiscoverabilityFacets, sellerDraftToCardModel } from '@/lib/sellerListingPreview'
import { VehicleIdentificationNotice } from '@/components/sell/VehicleIdentificationNotice'
import { useSellerVehicleIdentification } from '@/hooks/useSellerVehicleIdentification'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { VehicleHistoryCoveragePanel, type HistoryEvidencePlanState } from '@/components/sell/VehicleHistoryCoveragePanel'
import { SellerDocumentAutofillNotice } from '@/components/sell/SellerDocumentAutofillNotice'
import type { EvidenceSourcesResponse, EvidenceTaxonomyResponse } from '@/types'
import { toast } from 'sonner'

const CURRENCIES = ['USD', 'ZiG']

const PHOTO_LABELS = [
  'Front three-quarter',
  'Front',
  'Driver side',
  'Passenger side',
  'Rear three-quarter',
  'Rear',
  'Interior',
  'Dashboard',
  'Odometer',
  'Engine',
  'Tyres',
  'Any known damage',
  'Other',
] as const

const STEP_META = [
  { label: 'Vehicle', verb: 'Identify', note: 'Anchor the right car', icon: CarFront },
  { label: 'Listing', verb: 'Describe', note: 'Tell the buyer story', icon: ListChecksIcon },
  { label: 'Photos', verb: 'Show', note: 'Build visual confidence', icon: Camera },
  { label: 'Preview', verb: 'Review', note: 'See the buyer view', icon: Eye },
] as const

function ListChecksIcon({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center ${className}`}>
      <span className="grid gap-0.5">
        <span className="flex items-center gap-1"><CircleDot className="h-2.5 w-2.5" /><span className="h-0.5 w-3 rounded bg-current" /></span>
        <span className="flex items-center gap-1"><CircleDot className="h-2.5 w-2.5" /><span className="h-0.5 w-3 rounded bg-current" /></span>
      </span>
    </span>
  )
}

const INITIAL = {
  make: '', model: '', year: '', vin: '', color: '',
  mileage: '', condition: '', category: '', fuelType: '', transmission: '', drivetrain: '',
  location: '', province: '', price: '', currency: '', description: '',
  engineNumber: '', chassisNumber: '', plateNumber: '', tempPlateId: '', importStatus: '',
  features: [] as string[], images: [] as string[], imageLabels: [] as string[],
  coverImageIndex: null as number | null,
  historyPlan: {} as Record<string, HistoryEvidencePlanState>,
}

type GuestForm = typeof INITIAL

function validVin(vin: string) {
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)
}

export default function GuestSell() {
  const { isAuthenticated } = useAuth()
  const { fetchEvidenceTaxonomy, fetchEvidenceSources } = useCarUpApi()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<GuestForm>(INITIAL)
  const [feature, setFeature] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [draftSaved, setDraftSaved] = useState(false)
  const [taxonomy, setTaxonomy] = useState<EvidenceTaxonomyResponse | null>(null)
  const [sources, setSources] = useState<EvidenceSourcesResponse | null>(null)
  const historyCatalogAvailable = typeof fetchEvidenceTaxonomy === 'function' && typeof fetchEvidenceSources === 'function'
  const [historyLoading, setHistoryLoading] = useState(historyCatalogAvailable)
  const [buyerPreviewOpen, setBuyerPreviewOpen] = useState(false)
  const modelOptions = useMemo(() => modelsForMake(form.make).map(item => item.name), [form.make])
  // S6: exactly the facets a buyer could search this listing by today — no padding.
  const discoverability = useMemo(() => sellerDiscoverabilityFacets(form), [form])
  // S1: detect an existing CarUp Passport before the seller invests in the rest of the form.
  const { result: identification, checking: identifying } = useSellerVehicleIdentification(form.vin)

  useEffect(() => {
    let active = true

    // Evidence coverage is progressive enhancement on Guest Sell. If a partially mocked/test host or
    // temporarily older backend does not expose the catalog collaborators, the core seller journey
    // remains usable and the panel truthfully shows its unavailable state instead of crashing.
    if (!historyCatalogAvailable) return () => { active = false }

    Promise.allSettled([fetchEvidenceTaxonomy(), fetchEvidenceSources()])
      .then(([taxonomyResult, sourceResult]) => {
        if (!active) return
        if (taxonomyResult.status === 'fulfilled') setTaxonomy(taxonomyResult.value)
        if (sourceResult.status === 'fulfilled') setSources(sourceResult.value)
      })
      .finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [fetchEvidenceTaxonomy, fetchEvidenceSources, historyCatalogAvailable])

  const set = <K extends keyof GuestForm>(key: K, value: GuestForm[K]) => {
    setForm(previous => ({ ...previous, [key]: value }))
    setDraftSaved(false)
  }

  const setHistoryPlan = (evidenceClass: string, state: HistoryEvidencePlanState) => {
    set('historyPlan', { ...form.historyPlan, [evidenceClass]: state })
  }

  const setImageLabel = (index: number, label: string) => {
    const labels = [...form.imageLabels]
    labels[index] = label
    set('imageLabels', labels)
  }

  const setCoverImage = (index: number) => {
    set('coverImageIndex', index)
  }

  const removeImage = (index: number) => {
    setForm(previous => {
      const images = previous.images.filter((_, i) => i !== index)
      const imageLabels = previous.imageLabels.filter((_, i) => i !== index)
      let coverImageIndex = previous.coverImageIndex
      if (coverImageIndex === index) coverImageIndex = null
      else if (coverImageIndex !== null && coverImageIndex > index) coverImageIndex -= 1
      return { ...previous, images, imageLabels, coverImageIndex }
    })
    setDraftSaved(false)
  }

  const assignShot = (label: string) => {
    if (form.images.length === 0) {
      toast.info('Add a photo first, then attach a walk-around label.')
      return
    }
    const target = form.imageLabels.findIndex(value => !value)
    if (target === -1) {
      toast.info('Every current photo already has a label. Change one from the gallery if needed.')
      return
    }
    setImageLabel(target, label)
  }

  const validate = () => {
    const next: Record<string, string> = {}
    if (step === 0) {
      if (!form.make.trim()) next.make = 'Make is required'
      if (!form.model.trim()) next.model = 'Model is required'
      if (!isValidVehicleYear(form.year)) next.year = 'Enter a valid year'
      if (!validVin(form.vin)) next.vin = 'Enter the 17-character VIN'
      if (!form.color.trim()) next.color = 'Colour is required'
    }
    if (step === 1) {
      for (const key of ['mileage', 'condition', 'category', 'fuelType', 'transmission', 'location', 'price', 'currency'] as const) {
        if (!form[key]) next[key] = 'Required'
      }
      if (!form.description.trim() || form.description.trim().length < 30) next.description = 'Tell buyers at least 30 characters about the vehicle'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const next = () => {
    if (!validate()) return
    setStep(current => Math.min(current + 1, 3))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const back = () => {
    setStep(current => Math.max(current - 1, 0))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const addImages = (event: React.ChangeEvent<HTMLInputElement>) => {
    // Guest and authenticated Sell share ONE deterministic intake contract. The guest flow used to
    // silently drop non-images and cap itself at 10 while authenticated Sell accepted 15; the same
    // seller therefore got two different answers depending on which side of account creation they
    // were on.
    const { accepted: files, rejected } = screenListingImages(
      Array.from(event.target.files || []),
      form.images.length,
    )
    for (const refusal of rejected) toast.error(`${refusal.name}: ${refusal.reason}`)
    if (files.length === 0) return

    // Read the selected batch concurrently but apply it once, in selection order. Individual
    // FileReader callbacks may finish out of order; appending from each callback can silently
    // reshuffle which photo is associated with each walk-around label.
    Promise.all(files.map(file => new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => resolve('')
      reader.readAsDataURL(file)
    }))).then(results => {
      const images = results.filter(Boolean)
      if (images.length === 0) return
      setForm(previous => {
        const nextImages = [...previous.images, ...images].slice(0, LISTING_IMAGE_LIMIT)
        const addedCount = Math.max(0, nextImages.length - previous.images.length)
        return {
          ...previous,
          images: nextImages,
          imageLabels: [...previous.imageLabels, ...Array(addedCount).fill('')].slice(0, LISTING_IMAGE_LIMIT),
        }
      })
      setDraftSaved(false)
    })
  }

  const addFeature = () => {
    const value = feature.trim()
    if (!value || form.features.includes(value)) return
    set('features', [...form.features, value])
    setFeature('')
  }

  const saveForAccount = () => {
    const result = saveGuestSellDraft(form)
    if (!result.ok) {
      toast.error('This browser could not keep the draft for sign-in. Keep this page open and try again.')
      return
    }
    if (result.images_omitted) {
      toast.info('Your vehicle details are saved. Re-attach the photos after sign-in because the browser draft was too large.')
    } else {
      toast.success('Draft ready. Your account will claim and persist it only after you sign in.')
    }
    setDraftSaved(true)
  }

  const completeness = useMemo(() => {
    const fields = [form.make, form.model, form.year, form.vin, form.color, form.mileage, form.condition, form.price, form.currency, form.location]
    return Math.round((fields.filter(Boolean).length / fields.length) * 100)
  }, [form])

  return (
    <div className="min-h-screen bg-[#f6f7f9] pb-24 text-slate-950" data-testid="guest-sell-page">
      <header className="relative overflow-hidden border-b border-slate-800 bg-[#07111f] text-white">
        <div className="absolute inset-0 opacity-80 [background-image:radial-gradient(circle_at_82%_18%,rgba(249,115,22,0.26),transparent_26%),radial-gradient(circle_at_60%_120%,rgba(59,130,246,0.16),transparent_34%)]" />
        <div className="absolute right-[-8rem] top-[-7rem] h-80 w-80 rounded-full border border-white/10" />
        <div className="absolute right-[-2rem] top-[-1rem] h-44 w-44 rounded-full border border-orange-400/20" />

        <div className="section-padding relative mx-auto max-w-7xl py-7 sm:py-10">
          <Link to="/marketplace" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-400 transition hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Back to marketplace
          </Link>

          <div className="mt-7 grid items-end gap-8 lg:grid-cols-[1.45fr_0.75fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-orange-400/25 bg-orange-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-orange-300">
                <Sparkles className="h-3.5 w-3.5" /> Seller studio
              </div>
              <h1 className="mt-5 max-w-4xl text-[2.65rem] font-black leading-[0.96] tracking-[-0.055em] text-white sm:text-6xl">
                Tell the car story.
                <span className="block text-orange-400">Prove what matters. Sell with confidence.</span>
              </h1>
              <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">
                Start without an account. CarUp keeps seller claims, verified facts and buyer-facing presentation separate — then brings them together when you are ready to publish.
              </p>
              <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-slate-300">
                <span className="inline-flex items-center gap-1.5"><LockKeyhole className="h-3.5 w-3.5 text-orange-400" /> Private until you choose to save</span>
                <span className="inline-flex items-center gap-1.5"><BadgeCheck className="h-3.5 w-3.5 text-orange-400" /> Seller statement ≠ verified fact</span>
                <span className="inline-flex items-center gap-1.5"><Eye className="h-3.5 w-3.5 text-orange-400" /> Preview the real buyer card</span>
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/20 backdrop-blur">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Draft completeness</p>
                  <p className="mt-1 text-4xl font-black tracking-tight text-white">{completeness}%</p>
                </div>
                <div
                  className="grid h-16 w-16 place-items-center rounded-full p-[5px]"
                  style={{ background: `conic-gradient(#f97316 ${completeness * 3.6}deg, rgba(255,255,255,0.12) 0deg)` }}
                  aria-label={`Draft completeness ${completeness}%`}
                >
                  <div className="grid h-full w-full place-items-center rounded-full bg-[#0b1625]">
                    <Gauge className="h-6 w-6 text-orange-400" />
                  </div>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {STEP_META.map((item, index) => {
                  const Icon = item.icon
                  const active = index === step
                  const done = index < step
                  return (
                    <div key={item.label} className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${active ? 'bg-white text-slate-950' : 'text-slate-300'}`}>
                      <div className={`grid h-8 w-8 place-items-center rounded-xl ${active ? 'bg-orange-500 text-white' : done ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/5 text-slate-400'}`}>
                        {done ? <BadgeCheck className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-black">{item.verb} · {item.label}</p>
                        <p className={`text-[11px] ${active ? 'text-slate-500' : 'text-slate-500'}`}>{item.note}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="section-padding mx-auto max-w-7xl py-6 sm:py-10">
        <div className="mb-6 grid grid-cols-4 gap-2 lg:hidden" aria-label="Sell progress">
          {STEP_META.map((item, index) => (
            <div key={item.label}>
              <div className={`h-1.5 rounded-full ${index <= step ? 'bg-orange-500' : 'bg-slate-200'}`} />
              <p className={`mt-2 text-[10px] font-black uppercase tracking-wide ${index === step ? 'text-slate-950' : 'text-slate-400'}`}>{item.label}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-7 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <div className="sticky top-8 space-y-3">
              <p className="px-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Your sell journey</p>
              {STEP_META.map((item, index) => {
                const Icon = item.icon
                const active = index === step
                const done = index < step
                return (
                  <div key={item.label} className={`rounded-2xl border p-3.5 transition ${active ? 'border-orange-200 bg-white shadow-[0_14px_35px_rgba(15,23,42,0.08)]' : 'border-transparent'}`}>
                    <div className="flex items-start gap-3">
                      <div className={`grid h-9 w-9 flex-none place-items-center rounded-xl ${active ? 'bg-orange-500 text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                        {done ? <BadgeCheck className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="text-xs font-black text-slate-900">{item.verb}</p>
                        <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{item.note}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
              <div className="mt-4 rounded-2xl bg-[#0b1625] p-4 text-white">
                <ShieldCheck className="h-5 w-5 text-orange-400" />
                <p className="mt-3 text-xs font-black">CarUp truth rule</p>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">What you tell us stays seller-stated until evidence or a governed source supports something stronger.</p>
              </div>
            </div>
          </aside>

          <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_24px_65px_rgba(15,23,42,0.08)]">
            <div className="border-b border-slate-100 bg-gradient-to-r from-white to-slate-50 px-5 py-5 sm:px-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Step {step + 1} of 4</p>
                  <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{STEP_META[step].verb} the vehicle</h2>
                </div>
                <div className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-500">{STEP_META[step].note}</div>
              </div>
            </div>

            <div className="p-5 sm:p-8">
              {step === 0 && (
                <div className="space-y-6" data-testid="guest-sell-vehicle-step">
                  <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
                    <div className="rounded-3xl border border-slate-200 p-5 sm:p-6">
                      <div className="flex items-center gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-orange-50 text-orange-600"><CarFront className="h-5 w-5" /></div>
                        <div>
                          <h3 className="font-black">Which vehicle is this?</h3>
                          <p className="text-xs text-slate-500">Start with the facts buyers recognise.</p>
                        </div>
                      </div>
                      <div className="mt-5 grid gap-4 sm:grid-cols-2">
                        <Field label="Make" error={errors.make}>
                          <Input list="carup-guest-makes" value={form.make} onChange={e => set('make', e.target.value)} placeholder="Toyota" data-testid="guest-sell-make" />
                          <datalist id="carup-guest-makes">{VEHICLE_MAKES.map(make => <option key={make} value={make} />)}</datalist>
                        </Field>
                        <Field label="Model" error={errors.model}>
                          <Input list="carup-guest-models" value={form.model} onChange={e => set('model', e.target.value)} placeholder="Hilux" data-testid="guest-sell-model" />
                          <datalist id="carup-guest-models">{modelOptions.map(model => <option key={model} value={model} />)}</datalist>
                        </Field>
                        <Field label="Year" error={errors.year}><Input type="number" value={form.year} onChange={e => set('year', e.target.value)} placeholder="2021" data-testid="guest-sell-year" /></Field>
                        <Field label="Colour" error={errors.color}>
                          <Input list="carup-guest-colours" value={form.color} onChange={e => set('color', e.target.value)} placeholder="Silver" data-testid="guest-sell-color" />
                          <datalist id="carup-guest-colours">{VEHICLE_COLORS.map(colour => <option key={colour} value={colour} />)}</datalist>
                        </Field>
                      </div>
                    </div>

                    <div className="rounded-3xl bg-[#0b1625] p-5 text-white sm:p-6">
                      <ScanLine className="h-6 w-6 text-orange-400" />
                      <h3 className="mt-4 font-black">Vehicle fingerprint</h3>
                      <p className="mt-1 text-xs leading-5 text-slate-400">The VIN lets CarUp check whether this car already has a Passport before you invest more time.</p>
                      <div className="mt-5">
                        <Field label="VIN" error={errors.vin} dark>
                          <Input value={form.vin} onChange={e => set('vin', e.target.value.toUpperCase())} maxLength={17} placeholder="17-character VIN" className="border-white/15 bg-white/10 font-mono text-white placeholder:text-slate-500" data-testid="guest-sell-vin" />
                          <VehicleIdentificationNotice result={identification} checking={identifying} />
                        </Field>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5 sm:p-6">
                    <div className="flex items-center gap-3">
                      <FileCheck2 className="h-5 w-5 text-slate-600" />
                      <div>
                        <h3 className="text-sm font-black">Publication identifiers</h3>
                        <p className="text-xs text-slate-500">You can continue now and complete these before publication.</p>
                      </div>
                    </div>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <Field label="Chassis number · optional for now"><Input value={form.chassisNumber} onChange={e => set('chassisNumber', e.target.value.toUpperCase())} /></Field>
                      <Field label="Engine number · optional for now"><Input value={form.engineNumber} onChange={e => set('engineNumber', e.target.value.toUpperCase())} /></Field>
                      <Field label="Number plate"><Input value={form.plateNumber} onChange={e => set('plateNumber', e.target.value.toUpperCase())} /></Field>
                      <Field label="Temporary import permit"><Input value={form.tempPlateId} onChange={e => set('tempPlateId', e.target.value.toUpperCase())} /></Field>
                    </div>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-6" data-testid="guest-sell-listing-step">
                  <div className="rounded-3xl border border-orange-100 bg-orange-50/60 p-4">
                    <div className="flex gap-3">
                      <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-orange-600" />
                      <div>
                        <p className="text-sm font-black text-orange-950">Your words are seller-stated facts.</p>
                        <p className="mt-1 text-xs leading-5 text-orange-900/70">CarUp will use them to build the listing and search facets, but entering a value does not make it verified.</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-200 p-5 sm:p-6">
                    <div className="flex items-center gap-3">
                      <Gauge className="h-5 w-5 text-orange-600" />
                      <div>
                        <h3 className="text-sm font-black">How buyers find the car</h3>
                        <p className="text-xs text-slate-500">Every answered facet improves discoverability.</p>
                      </div>
                    </div>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      <Field label="Mileage (km)" error={errors.mileage}><Input type="number" value={form.mileage} onChange={e => set('mileage', e.target.value)} data-testid="guest-sell-mileage" /></Field>
                      <SelectField label="Condition" value={form.condition} error={errors.condition} onValue={v => set('condition', v)} options={SELLER_CONDITIONS} testId="guest-sell-condition" />
                      <SelectField label="Body style" value={form.category} error={errors.category} onValue={v => set('category', v)} options={[...BODY_STYLES]} testId="guest-sell-body-style" />
                      <SelectField label="Fuel" value={form.fuelType} error={errors.fuelType} onValue={v => set('fuelType', v)} options={FUEL_TYPES} testId="guest-sell-fuel" />
                      <SelectField label="Transmission" value={form.transmission} error={errors.transmission} onValue={v => set('transmission', v)} options={TRANSMISSIONS} testId="guest-sell-transmission" />
                      <SelectField label="Drivetrain · optional" value={form.drivetrain} onValue={v => set('drivetrain', v)} options={DRIVETRAINS} testId="guest-sell-drivetrain" />
                    </div>
                  </div>

                  <div className="grid gap-5 xl:grid-cols-2">
                    <div className="rounded-3xl border border-slate-200 p-5 sm:p-6">
                      <div className="flex items-center gap-3">
                        <WalletCards className="h-5 w-5 text-orange-600" />
                        <div><h3 className="text-sm font-black">Price</h3><p className="text-xs text-slate-500">State the amount and currency explicitly.</p></div>
                      </div>
                      <div className="mt-5 grid gap-4 sm:grid-cols-2">
                        <SelectField label="Currency" value={form.currency} error={errors.currency} onValue={v => set('currency', v)} options={CURRENCIES} testId="guest-sell-currency" />
                        <Field label="Asking price" error={errors.price}><Input type="number" value={form.price} onChange={e => set('price', e.target.value)} data-testid="guest-sell-price" /></Field>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 p-5 sm:p-6">
                      <div className="flex items-center gap-3">
                        <MapPin className="h-5 w-5 text-orange-600" />
                        <div><h3 className="text-sm font-black">Where is the vehicle?</h3><p className="text-xs text-slate-500">Location can later be governed by your privacy choice.</p></div>
                      </div>
                      <div className="mt-5 grid gap-4 sm:grid-cols-2">
                        <SelectField label="City" value={form.location} error={errors.location} onValue={v => set('location', v)} options={zimbabweLocations} testId="guest-sell-city" />
                        <SelectField label="Province" value={form.province} onValue={v => set('province', v)} options={zimbabweProvinces} testId="guest-sell-province" />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-200 p-5 sm:p-6">
                    <Field label="Tell the buyer what matters" error={errors.description}>
                      <textarea
                        value={form.description}
                        onChange={e => set('description', e.target.value)}
                        rows={5}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100"
                        placeholder="Condition, maintenance, recent work, why you are selling, and anything a serious buyer should know…"
                        data-testid="guest-sell-description"
                      />
                    </Field>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                      <span>Clear, specific descriptions reduce repetitive buyer questions.</span>
                      <span>{form.description.trim().length}/500</span>
                    </div>
                  </div>

                  <SellerDocumentAutofillNotice />

                  <VehicleHistoryCoveragePanel
                    taxonomy={taxonomy}
                    sources={sources}
                    plan={form.historyPlan}
                    onPlanChange={setHistoryPlan}
                    loading={historyLoading}
                  />
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6" data-testid="guest-sell-photos-step">
                  <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
                    <div>
                      <label className="group block cursor-pointer rounded-[2rem] border-2 border-dashed border-orange-200 bg-gradient-to-br from-orange-50 to-white p-10 text-center transition hover:border-orange-400 hover:shadow-[0_18px_45px_rgba(249,115,22,0.10)]">
                        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-500/20"><UploadCloud className="h-7 w-7" /></div>
                        <p className="mt-4 text-base font-black">Drop in the vehicle story</p>
                        <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-slate-500">Add up to {LISTING_IMAGE_LIMIT} listing photos now. They stay in the browser draft until you authenticate and save.</p>
                        <span className="mt-4 inline-flex rounded-full bg-white px-3 py-1 text-[11px] font-bold text-slate-600 shadow-sm">Choose JPG / PNG photos</span>
                        <input type="file" accept="image/*" multiple className="hidden" onChange={addImages} />
                      </label>
                    </div>

                    <div className="rounded-[2rem] bg-[#0b1625] p-5 text-white">
                      <Camera className="h-5 w-5 text-orange-400" />
                      <p className="mt-3 text-sm font-black">A buyer’s walk-around</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">Think like someone inspecting the car from another city.</p>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                        {PHOTO_LABELS.slice(0, 10).map(shot => {
                          const assigned = form.imageLabels.includes(shot)
                          return (
                            <button
                              key={shot}
                              type="button"
                              onClick={() => assignShot(shot)}
                              className={'rounded-xl px-2.5 py-2 text-left transition ' + (
                                assigned
                                  ? 'bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/30'
                                  : 'bg-white/[0.06] text-slate-300 hover:bg-white/10'
                              )}
                              aria-pressed={assigned}
                            >
                              {assigned ? '✓ ' : ''}{shot}
                            </button>
                          )
                        })}
                      </div>
                      <p className="mt-3 text-[10px] leading-4 text-slate-500">Tap a block to attach it to the next unlabeled photo, or choose a label directly beneath any image.</p>
                      <p className="mt-4 text-[11px] leading-5 text-orange-200">Listing photos help buyers decide. They are not verified evidence.</p>
                    </div>
                  </div>

                  {form.images.length > 0 && (
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-sm font-black">Draft gallery</p>
                        <span className="text-xs font-semibold text-slate-400">{form.images.length}/{LISTING_IMAGE_LIMIT} photos</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {form.images.map((src, index) => (
                          <div key={`${src.slice(0, 24)}-${index}`} className="space-y-2">
                            <div className="group relative aspect-[4/3] overflow-hidden rounded-2xl bg-slate-100 shadow-[0_12px_28px_rgba(15,23,42,0.12)]">
                              <img src={src} alt={form.imageLabels[index] || `Draft vehicle photo ${index + 1}`} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                              <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
                                <span className="rounded-lg bg-black/65 px-2 py-1 text-[10px] font-bold text-white">Photo {index + 1}</span>
                                {form.imageLabels[index] && <span className="rounded-lg bg-orange-500 px-2 py-1 text-[10px] font-black text-white">{form.imageLabels[index]}</span>}
                                {form.coverImageIndex === index && <span className="rounded-lg bg-emerald-600 px-2 py-1 text-[10px] font-black text-white">Cover</span>}
                              </div>
                              <button type="button" onClick={() => removeImage(index)} className="absolute right-2 top-2 rounded-xl bg-slate-950/80 p-1.5 text-white opacity-80 transition hover:opacity-100 focus:opacity-100" aria-label={`Remove photo ${index + 1}`}><X className="h-4 w-4" /></button>
                            </div>
                            <Select value={form.imageLabels[index] || ''} onValueChange={value => setImageLabel(index, value)}>
                              <SelectTrigger className="h-9 text-[11px]" aria-label={`Photo ${index + 1} angle or view`}>
                                <SelectValue placeholder="Label angle / view" />
                              </SelectTrigger>
                              <SelectContent>{PHOTO_LABELS.map(label => <SelectItem key={label} value={label}>{label}</SelectItem>)}</SelectContent>
                            </Select>
                            <Button
                              type="button"
                              size="sm"
                              variant={form.coverImageIndex === index ? 'default' : 'outline'}
                              onClick={() => setCoverImage(index)}
                              className="h-8 w-full text-[11px]"
                            >
                              {form.coverImageIndex === index ? 'Cover selected' : 'Make cover'}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-3xl border border-slate-200 p-5 sm:p-6">
                    <div className="flex items-center gap-3">
                      <Sparkles className="h-5 w-5 text-orange-600" />
                      <div><h3 className="text-sm font-black">Features & extras</h3><p className="text-xs text-slate-500">Add the equipment that makes this specific car useful.</p></div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Input value={feature} onChange={e => setFeature(e.target.value)} placeholder="Tow bar, leather seats, reverse camera…" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFeature() } }} />
                      <Button type="button" variant="outline" onClick={addFeature}>Add</Button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {form.features.map(item => <button key={item} type="button" onClick={() => set('features', form.features.filter(value => value !== item))} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-red-200 hover:bg-red-50">{item} ×</button>)}
                    </div>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-6" data-testid="guest-sell-preview-step">
                  <div className="grid items-start gap-6 xl:grid-cols-[0.78fr_1.22fr]">
                    <div className="rounded-[2rem] bg-[#0b1625] p-5 text-white sm:p-6">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-400">Private preview</p>
                      <h3 className="mt-2 text-2xl font-black leading-tight">Before CarUp saves anything, see the buyer view.</h3>
                      <p className="mt-3 text-xs leading-5 text-slate-400">This is the real Marketplace card, not a separate mock-up.</p>

                      <div className="mt-6 space-y-3">
                        <div className="flex gap-3"><div className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-white/10"><Eye className="h-4 w-4 text-orange-300" /></div><div><p className="text-xs font-black">Buyer presentation</p><p className="text-[11px] text-slate-400">Check price, mileage, vehicle details and missing states.</p></div></div>
                        <div className="flex gap-3"><div className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-white/10"><ScanLine className="h-4 w-4 text-orange-300" /></div><div><p className="text-xs font-black">Discoverability</p><p className="text-[11px] text-slate-400">Only answered search facets can match buyers.</p></div></div>
                        <div className="flex gap-3"><div className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-white/10"><ShieldCheck className="h-4 w-4 text-orange-300" /></div><div><p className="text-xs font-black">Truth stays separate</p><p className="text-[11px] text-slate-400">No ownership, Trust or verification claim exists yet.</p></div></div>
                      </div>
                    </div>

                    <div className="rounded-[2rem] border border-slate-200 bg-slate-50 p-4 sm:p-6">
                      <div className="mx-auto w-full max-w-sm" data-testid="guest-sell-buyer-preview">
                        <MarketplaceListingCard
                          vehicle={sellerDraftToCardModel(form)}
                          href="#"
                          ctaLabel="Draft buyer preview"
                          dataTestId="guest-sell-preview-card"
                          showMissingMileage
                          allowLocalDraftMedia
                          previewMode
                        />
                        <Button type="button" variant="outline" className="mt-4 w-full rounded-xl" onClick={() => setBuyerPreviewOpen(true)}>
                          <Eye className="mr-2 h-4 w-4" /> Open full buyer preview
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-200 p-5 sm:p-6" data-testid="guest-sell-discoverability">
                    <div className="flex items-center gap-3">
                      <ScanLine className="h-5 w-5 text-orange-600" />
                      <div><p className="text-sm font-black">Buyers can find this by</p><p className="text-xs text-slate-500">These are the search facets your answers currently support.</p></div>
                    </div>
                    <p className="mt-3 text-[11px] leading-5 text-slate-500">
                      A filter you have not answered will not match this listing; CarUp never invents a value to improve discoverability.
                    </p>
                    {discoverability.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {discoverability.map(facet => (
                          <span key={facet} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">{facet}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-slate-500">Nothing yet — add vehicle details so buyers can filter for this car.</p>
                    )}
                  </div>

                  <div className="rounded-3xl border border-orange-200 bg-orange-50 p-5">
                    <div className="flex gap-3">
                      <LockKeyhole className="mt-0.5 h-5 w-5 flex-none text-orange-600" />
                      <div>
                        <p className="text-sm font-black text-orange-950">Still a browser draft.</p>
                        <p className="mt-1 text-xs leading-5 text-orange-900/70">CarUp has not claimed ownership, uploaded your photos, published the listing or created a Trust fact. Your account is the handoff point.</p>
                      </div>
                    </div>
                  </div>

                  <Button type="button" onClick={saveForAccount} className="h-12 w-full rounded-2xl bg-slate-950 text-white hover:bg-orange-600" data-testid="guest-sell-commit">
                    <ShieldCheck className="mr-2 h-4 w-4" /> {isAuthenticated ? 'Continue to save this draft' : 'Continue with an account to save'}
                  </Button>
                  {draftSaved && (
                    <div className="grid gap-2 sm:grid-cols-2" data-testid="guest-sell-auth-options">
                      {isAuthenticated ? (
                        <Button asChild className="sm:col-span-2"><Link to="/dashboard/sell-vehicle">Open my saved-draft flow <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
                      ) : (
                        <>
                          <Button asChild><Link to="/register?returnTo=%2Fdashboard%2Fsell-vehicle">Create account</Link></Button>
                          <Button asChild variant="outline"><Link to="/login?returnTo=%2Fdashboard%2Fsell-vehicle"><LogIn className="mr-2 h-4 w-4" /> Sign in</Link></Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-8">
              <Button type="button" variant="ghost" onClick={back} disabled={step === 0} className="rounded-xl">Back</Button>
              {step < 3 && (
                <Button type="button" onClick={next} className="h-11 rounded-xl bg-orange-500 px-5 text-white shadow-lg shadow-orange-500/15 hover:bg-orange-600">
                  Continue <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
            </div>
          </section>
        </div>
      </main>

      <Dialog open={buyerPreviewOpen} onOpenChange={setBuyerPreviewOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Full buyer preview</DialogTitle>
            <DialogDescription>
              Browser-only preview of the real Marketplace card. Nothing here is published or verified yet.
            </DialogDescription>
          </DialogHeader>
          {form.images.length > 1 && (
            <div className="grid grid-cols-4 gap-2">
              {form.images.map((src, index) => (
                <div key={index} className="relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-100">
                  <img src={src} alt={form.imageLabels[index] || `Draft photo ${index + 1}`} className="h-full w-full object-cover" />
                  <span className="absolute inset-x-1 bottom-1 truncate rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-bold text-white">
                    {form.imageLabels[index] || `Photo ${index + 1}`}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="mx-auto w-full max-w-md">
            <MarketplaceListingCard
              vehicle={sellerDraftToCardModel(form)}
              href="#"
              ctaLabel="Draft buyer preview"
              dataTestId="guest-sell-full-preview-card"
              showMissingMileage
              allowLocalDraftMedia
              previewMode
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, error, children, dark = false }: { label: string; error?: string; children: React.ReactNode; dark?: boolean }) {
  return (
    <div>
      <label className={`mb-1.5 block text-xs font-black uppercase tracking-[0.08em] ${dark ? 'text-slate-300' : 'text-slate-700'}`}>{label}</label>
      {children}
      {error && <p className="mt-1.5 text-xs font-semibold text-red-600">{error}</p>}
    </div>
  )
}

function SelectField({ label, value, error, onValue, options, testId }: { label: string; value: string; error?: string; onValue: (value: string) => void; options: readonly string[]; testId?: string }) {
  return <Field label={label} error={error}><Select value={value} onValueChange={onValue}><SelectTrigger data-testid={testId}><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></Field>
}

