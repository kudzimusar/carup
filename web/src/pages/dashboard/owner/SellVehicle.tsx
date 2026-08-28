import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CheckCircle, ChevronRight, ChevronLeft, Upload, X, Loader2, AlertCircle, FileWarning } from 'lucide-react'
import { toast } from 'sonner'
import { zimbabweLocations, zimbabweProvinces } from '@/data/mockData'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { VehicleCompletenessPanel } from '@/components/VehicleCompletenessPanel'
import { ListingQualityPanel } from '@/components/sell/ListingQualityPanel'
import { clearGuestSellDraft, readGuestSellDraft } from '@/lib/guestSellDraft'
import { sellerDiscoverabilityFacets } from '@/lib/sellerListingPreview'
import { LISTING_IMAGE_LIMIT, screenListingImages } from '@/lib/listingMediaIntake'
import { VehicleIdentificationNotice } from '@/components/sell/VehicleIdentificationNotice'
import { useSellerVehicleIdentification } from '@/hooks/useSellerVehicleIdentification'
import { BODY_STYLES, DRIVETRAINS, FUEL_TYPES, SELLER_CONDITIONS, TRANSMISSIONS, VEHICLE_COLORS, VEHICLE_MAKES, modelsForMake, vehicleYearOptions } from '@/data/vehicleTaxonomy'

const YEARS = vehicleYearOptions()
const STEPS = ['Vehicle Details', 'Location & Pricing', 'Images & Features', 'Review & Save Draft']

/**
 * Seller Journey S4 — the shot list buyers actually ask for, in the order it is easiest to walk
 * around a vehicle. Recommendations only: nothing here is required, and a suggested shot is never
 * evidence of anything. Listing media is commercial media until it is separately admitted as
 * governed evidence.
 */
const LISTING_PHOTO_SEQUENCE = [
  'Front', 'Rear', 'Driver side', 'Passenger side', 'Interior',
  'Dashboard', 'Odometer', 'Engine', 'Tyres', 'Any known damage',
]

/**
 * ISSUE #164 PHASE 4 — THE SELLER STATES THE CURRENCY. THIS FILE NO LONGER STATES IT FOR THEM.
 *
 * `currency: 'USD'` was a literal in the submit payload, with no control anywhere in this form and
 * only a parenthetical in the price label to hint at it. Phase 4 then made `currency` a mandatory
 * 400 on POST /api/vehicles/add — which this literal satisfied on 100% of real submissions. The
 * API's requirement became a formality and the business fact stayed invented by the client, which
 * is the failure governing principle 5 names: the frontend must not originate business truth.
 *
 * TWO RESOLUTIONS WERE AVAILABLE AND THIS IS WHY THIS ONE WAS TAKEN.
 *
 * Rejected — "declare USD the single supported currency and show it": it would be a false
 * declaration. This repository states the opposite in its own product surfaces: the global currency
 * context and switcher offer USD/ZiG/ZAR/BWP (web/src/App.tsx:163, components/layout/Navbar.tsx:207),
 * TrustSafety.tsx:118 tells buyers escrow settles "in both US Dollars (USD) and Zimbabwe Gold (ZiG)",
 * and HelpCenter.tsx:57 says the same. The server-side comment that removed `currency || 'USD'`
 * gives the same reason: "a market that actively trades in more than one". Making a hidden literal
 * a visible one would only relabel the fabrication.
 *
 * Taken — a real, required choice with NO pre-selection, over the currencies CarUp itself publishes
 * as settlement currencies. The vocabulary is therefore CarUp's own stated fact rather than this
 * component's invention, and it is deliberately NOT the Navbar's four: those are display-conversion
 * targets for browsing (backed by a mock rate table), whereas this value is stored on the listing as
 * the currency its price is quoted in. A seller who lists in ZiG now has a ZiG price recorded as
 * ZiG, instead of a ZiG number silently labelled USD — which is the materially dangerous reading the
 * literal produced.
 *
 * Like every other required Select in this form, it starts EMPTY: the mandatory 400 upstream is then
 * satisfied by something the seller actually asserted.
 */
const LISTING_CURRENCIES = [
  { code: 'USD', label: 'USD — US Dollar' },
  { code: 'ZiG', label: 'ZiG — Zimbabwe Gold' },
]

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {STEPS.map((label, i) => (
        <div key={i} className="flex items-center gap-2 flex-1">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 transition-colors ${i < step ? 'bg-green-500 text-white' : i === step ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
            {i < step ? <CheckCircle className="w-4 h-4" /> : i + 1}
          </div>
          <span className={`text-xs font-medium hidden sm:block ${i === step ? 'text-gray-900' : 'text-gray-400'}`}>{label}</span>
          {i < total - 1 && <div className={`h-px flex-1 mx-2 ${i < step ? 'bg-green-500' : 'bg-gray-200'}`} />}
        </div>
      ))}
    </div>
  )
}

const INITIAL = {
  // S3 consent. Both default to the PRIVATE answer: a seller has to choose to publish, and a
  // seller who never reached this step has not consented to anything.
  locationVisibility: 'withheld', publicSellerDisplay: false,
  make: '', model: '', year: '', vin: '', engineNumber: '', chassisNumber: '',
  plateNumber: '', tempPlateId: '', importStatus: '', color: '',
  mileage: '', condition: '', category: '', fuelType: '', transmission: '', drivetrain: '',
  location: '', province: '', price: '', currency: '', description: '',
  features: [] as string[], featureInput: '',
  images: [] as string[], imageLabels: [] as string[],
}

function validateVin(vin: string) {
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)
}

export default function SellVehicle() {
  const { createVehicleListing, uploadVehicleImages } = useCarUpApi()
  const [guestDraft] = useState(() => readGuestSellDraft())
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(() => guestDraft ? ({
    ...INITIAL,
    make: guestDraft.make,
    model: guestDraft.model,
    year: guestDraft.year || INITIAL.year,
    vin: guestDraft.vin,
    color: guestDraft.color,
    mileage: guestDraft.mileage,
    condition: guestDraft.condition,
    category: guestDraft.category,
    fuelType: guestDraft.fuelType,
    transmission: guestDraft.transmission,
    drivetrain: guestDraft.drivetrain,
    location: guestDraft.location,
    province: guestDraft.province,
    price: guestDraft.price,
    currency: guestDraft.currency,
    description: guestDraft.description,
    engineNumber: guestDraft.engineNumber,
    chassisNumber: guestDraft.chassisNumber,
    plateNumber: guestDraft.plateNumber,
    tempPlateId: guestDraft.tempPlateId,
    importStatus: guestDraft.importStatus,
    features: guestDraft.features,
    images: guestDraft.images,
    imageLabels: guestDraft.imageLabels,
  }) : INITIAL)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [savedVin, setSavedVin] = useState<string | null>(null)
  const [guestDraftLoaded, setGuestDraftLoaded] = useState(() => Boolean(guestDraft))
  const [guestHistoryPlan] = useState(() => guestDraft?.historyPlan ?? {})
  const modelOptions = modelsForMake(form.make).map(item => item.name)
  // S1: the same shared existing-Passport check Guest Sell runs. Advisory here too — the server's
  // 409 stays the authoritative duplicate rejection.
  const { result: identification, checking: identifying } = useSellerVehicleIdentification(form.vin)

  // S4 — WHICH PHOTO THE SELLER CHOSE, or null because they have not chosen.
  // `null` is the honest state for a question not answered, and it is what the server's media
  // contract already expects: a bare URL claims nothing, and only `is_primary: true` is a claim.
  const [coverImageIndex, setCoverImageIndex] = useState<number | null>(() => guestDraft?.coverImageIndex ?? null)

  /**
   * Move one photo one step. The stored order IS the submitted array order — the write path
   * persists `display_order: idx` — so this is the real reorder, not a presentation trick.
   *
   * The cover travels with the PHOTO, never with the slot. Recomputing it from a position would
   * re-introduce exactly the `index === 0` fabrication S4 removed, one move later.
   */
  const moveImage = (from: number, to: number) => {
    if (to < 0 || to >= form.images.length) return
    setForm(previous => {
      const next = [...previous.images]
      const labels = [...previous.imageLabels]
      const [moved] = next.splice(from, 1)
      const [movedLabel] = labels.splice(from, 1)
      next.splice(to, 0, moved)
      labels.splice(to, 0, movedLabel || '')
      return { ...previous, images: next, imageLabels: labels }
    })
    setCoverImageIndex(current => {
      if (current === null) return null
      if (current === from) return to            // the covered photo itself moved
      if (current > from && current <= to) return current - 1   // it shifted back to fill the gap
      if (current < from && current >= to) return current + 1   // it shifted forward to make room
      return current
    })
  }

  useEffect(() => {
    if (guestDraft) toast.success('Your pre-sign-in listing draft is ready to review.')
  }, [guestDraft])

  const set = (field: string, value: string | number | boolean | string[]) => setForm(prev => ({ ...prev, [field]: value }))

  const setImageLabel = (index: number, label: string) => {
    setForm(previous => {
      const imageLabels = [...previous.imageLabels]
      imageLabels[index] = label
      return { ...previous, imageLabels }
    })
  }

  const addFeature = () => {
    const f = form.featureInput.trim()
    if (f && !form.features.includes(f)) {
      set('features', [...form.features, f])
      set('featureInput', '')
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    // S4 — DETERMINISTIC FEEDBACK, NAMED. Files failing the image filter used to vanish without a
    // word, so a seller who picked a PDF alongside three photos saw three appear and no reason for
    // the fourth. Every refusal now names the file and the measurement behind it. Nothing here
    // judges how GOOD a photo is: CarUp has no governed signal for that.
    const { accepted: files, rejected } = screenListingImages(
      Array.from(e.target.files || []),
      form.images.length,
    )
    for (const refusal of rejected) toast.error(`${refusal.name}: ${refusal.reason}`)
    if (files.length === 0) return

    // Preserve the seller's selection order even when FileReader completion order differs. The
    // first photo is merchandising intent, so an async race must never choose it for the seller.
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
    })
  }

  const validateStep = () => {
    const e: Record<string, string> = {}
    if (step === 0) {
      if (!form.make) e.make = 'Required'
      if (!form.model) e.model = 'Required'
      if (!form.year) e.year = 'Required'
      if (!form.vin) e.vin = 'Required'
      else if (!validateVin(form.vin)) e.vin = 'VIN must be 17 alphanumeric characters'
      if (!form.color) e.color = 'Required'
    }
    if (step === 1) {
      if (!form.mileage) e.mileage = 'Required'
      if (!form.condition) e.condition = 'Required'
      if (!form.category) e.category = 'Required'
      if (!form.fuelType) e.fuelType = 'Required'
      if (!form.transmission) e.transmission = 'Required'
      if (!form.currency) e.currency = 'Required'
      if (!form.price) e.price = 'Required'
      // The floor is a plain number, not "$100": prefixing it asserted a currency the seller had
      // not chosen yet. It is echoed back in whichever currency they did choose.
      else if (parseFloat(form.price) < 100) e.price = `Price must be at least 100${form.currency ? ` ${form.currency}` : ''}`
      if (!form.location) e.location = 'Required'
      if (!form.description) e.description = 'Required'
      else if (form.description.length < 50) e.description = `Minimum 50 characters (${form.description.length}/50)`
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const nextStep = () => {
    if (validateStep()) setStep(s => Math.min(s + 1, STEPS.length - 1))
  }

  // Identify which publication requirements are not yet filled in the form
  const missingIdentityFields = [
    !form.chassisNumber && 'Chassis Number',
    !form.engineNumber && 'Engine Number',
    !(form.plateNumber || form.tempPlateId) && 'Number Plate or Temporary Import Permit',
  ].filter(Boolean) as string[]

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      let uploadedImageUrls: string[] = []

      if (form.images && form.images.length > 0) {
        try {
          const uploadRes = await uploadVehicleImages(form.vin.toUpperCase(), form.images)
          if (uploadRes && Array.isArray(uploadRes.urls)) {
            uploadedImageUrls = uploadRes.urls
          }
        } catch (uploadErr) {
          console.error('Image upload failed, proceeding without images:', uploadErr)
          toast.warning('Listing images failed to upload, but proceeding with vehicle details.')
        }
      }

      const result = await createVehicleListing({
        vin: form.vin.toUpperCase(),
        make: form.make,
        model: form.model,
        year: parseInt(form.year),
        color: form.color,
        mileage: parseInt(form.mileage),
        fuel_type: form.fuelType,
        transmission: form.transmission,
        drivetrain: form.drivetrain || undefined,
        condition: form.condition,
        seller_stated_condition: form.condition,
        category: form.category,
        body_style: form.category,
        price: parseFloat(form.price),
        // The seller's own choice, never a client-side literal. Step 1 will not advance without it,
        // so this is a value someone asserted rather than one this component supplied.
        currency: form.currency,
        description: form.description,
        features: form.features,
        location: form.location,
        province: form.province,
        // S4 — the media-primacy contract, in the shape the server defines. A bare URL claims
        // nothing; exactly the seller's chosen photo carries `is_primary: true`. When no cover was
        // chosen, every entry stays a plain URL and the listing honestly has no primary photo.
        images: coverImageIndex === null
          ? uploadedImageUrls
          : uploadedImageUrls.map((url, index) => (
              index === coverImageIndex ? { url, is_primary: true } : url
            )),
        // S3 — the seller's own consent decisions, sent explicitly in both directions so the
        // server records a choice rather than inferring one from silence.
        location_visibility: form.locationVisibility,
        public_seller_display_enabled: form.publicSellerDisplay,
        // Phase 4: identity fields sent to backend for completeness gate
        engine_number: form.engineNumber || undefined,
        chassis_number: form.chassisNumber || undefined,
        plate_number: form.plateNumber || undefined,
        temp_plate_id: form.tempPlateId || undefined,
        import_status: form.importStatus || undefined,
      })

      const returnedVin: string = (result as { vin?: string } | null)?.vin ?? form.vin.toUpperCase()
      setSavedVin(returnedVin)
      clearGuestSellDraft()
      setGuestDraftLoaded(false)
      toast.success('Vehicle saved as draft. Upload ownership documents to publish your listing.')
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : ''
      if (errMsg.includes('already listed')) {
        toast.error('A vehicle with this VIN is already registered.')
      } else {
        toast.error('Failed to save vehicle. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const vinValid = form.vin.length >= 2 ? validateVin(form.vin) : null

  // Post-save: show completeness panel instead of the form
  if (savedVin) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-start gap-3">
          <CheckCircle className="w-6 h-6 text-green-600 mt-0.5 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold">Draft saved</h1>
            <p className="text-gray-500">
              Your vehicle has been registered as a draft. Complete the document requirements below to publish your listing.
            </p>
          </div>
        </div>
        {/* S7 — THREE MEASUREMENTS, THREE BLOCKS, NEVER COLLAPSED (Invariant 6).
            Publication Readiness answers "may CarUp publish this?" and is the governed evidence
            panel. Listing Quality answers "is my advertisement strong?" and is computed from the
            seller's own inputs. Canonical Trust — what CarUp has actually verified — is published
            only by the Trust surfaces from canonicalTrustService, and is deliberately NOT restated
            here: a seller-facing copy of a Trust position is how a score drifts from its own
            calculation_version. */}
        {Object.keys(guestHistoryPlan).length > 0 && (
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-4" data-testid="post-save-evidence-plan">
            <p className="text-sm font-semibold text-orange-950">Your evidence preparation came with you</p>
            <p className="mt-1 text-xs text-orange-900/70">
              {Object.values(guestHistoryPlan).filter(value => value === 'now').length} categories were marked as records you have now.
              Upload the actual documents/evidence below; the checklist itself never counts as proof.
            </p>
          </div>
        )}
        <VehicleCompletenessPanel vin={savedVin} data-testid="post-save-completeness" />
        <ListingQualityPanel
          listing={{
            images: form.images,
            coverChosen: coverImageIndex !== null,
            description: form.description,
            features: form.features,
            discoverabilityFacets: sellerDiscoverabilityFacets(form),
          }}
        />
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" data-testid="canonical-trust-pointer">
          <p className="text-sm font-semibold text-slate-800">Canonical Trust is measured separately</p>
          <p className="mt-1 text-xs text-slate-600">
            Neither block above is a Trust score. CarUp publishes what it has actually verified on
            the vehicle&rsquo;s Passport, and only once evidence has been reviewed.
          </p>
          <Link to={`/vehicle/${savedVin}`} className="mt-2 inline-flex text-xs font-semibold text-orange-600 hover:underline">
            Open this vehicle&rsquo;s Passport
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Register Your Vehicle</h1>
        <p className="text-gray-500">Save your vehicle as a draft. You must upload ownership documents before your listing can be published.</p>
      </div>
      {guestDraftLoaded && (
        <div className="border-l-4 border-orange-500 bg-orange-50 p-4 text-sm text-orange-950" data-testid="seller-guest-draft-loaded">
          <p className="font-semibold">Your guest preview has been restored.</p>
          <p className="mt-1">Review the details below. Nothing is published until CarUp's publication requirements are completed.</p>
          {Object.keys(guestHistoryPlan).length > 0 && (
            <p className="mt-2 text-xs" data-testid="seller-guest-evidence-plan">
              Evidence preparation carried over: {Object.values(guestHistoryPlan).filter(value => value === 'now').length} categories marked ready now · {Object.values(guestHistoryPlan).filter(value => value === 'later').length} to add later.
              These are reminders, not verified claims.
            </p>
          )}
        </div>
      )}

      <StepIndicator step={step} total={STEPS.length} />

      <Card className="border-0 card-shadow">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* STEP 0: Vehicle Details */}
          {step === 0 && (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Make *</label>
                  <Input list="carup-seller-makes" value={form.make} onChange={e => set('make', e.target.value)} placeholder="e.g. Toyota" className={errors.make ? 'border-red-400' : ''} data-testid="vehicle-make-input" />
                  <datalist id="carup-seller-makes">{VEHICLE_MAKES.map(make => <option key={make} value={make} />)}</datalist>
                  {errors.make && <p className="text-xs text-red-500 mt-1">{errors.make}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Model *</label>
                  <Input list="carup-seller-models" value={form.model} onChange={e => set('model', e.target.value)} placeholder="e.g. Hilux" className={errors.model ? 'border-red-400' : ''} data-testid="vehicle-model-input" />
                  <datalist id="carup-seller-models">{modelOptions.map(model => <option key={model} value={model} />)}</datalist>
                  {errors.model && <p className="text-xs text-red-500 mt-1">{errors.model}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Year *</label>
                  <Select value={form.year} onValueChange={v => set('year', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{YEARS.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Color *</label>
                  <Input list="carup-seller-colours" value={form.color} onChange={e => set('color', e.target.value)} placeholder="e.g. Pearl White" className={errors.color ? 'border-red-400' : ''} />
                  <datalist id="carup-seller-colours">{VEHICLE_COLORS.map(colour => <option key={colour} value={colour} />)}</datalist>
                  {errors.color && <p className="text-xs text-red-500 mt-1">{errors.color}</p>}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">VIN (Vehicle Identification Number) *</label>
                <div className="relative">
                  <Input
                    value={form.vin}
                    onChange={e => set('vin', e.target.value.toUpperCase())}
                    placeholder="17-character VIN e.g. JTELU9FJ9K5987234"
                    maxLength={17}
                    className={`font-mono pr-10 ${errors.vin ? 'border-red-400' : vinValid === true ? 'border-green-400' : ''}`}
                    data-testid="vehicle-vin-input"
                  />
                  {vinValid === true && <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />}
                  {vinValid === false && <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />}
                </div>
                <p className="text-xs text-gray-400 mt-1">{form.vin.length}/17 characters</p>
                {errors.vin && <p className="text-xs text-red-500">{errors.vin}</p>}
                <VehicleIdentificationNotice result={identification} checking={identifying} />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Engine Number</label>
                  <Input value={form.engineNumber} onChange={e => set('engineNumber', e.target.value.toUpperCase())} placeholder="e.g. 1GD-789012" className="font-mono" />
                  <p className="text-xs text-gray-400 mt-1">Required to publish your listing</p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Chassis Number</label>
                  <Input value={form.chassisNumber} onChange={e => set('chassisNumber', e.target.value.toUpperCase())} placeholder="e.g. ZW1234567890" className="font-mono" />
                  <p className="text-xs text-gray-400 mt-1">Required to publish your listing</p>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Number Plate</label>
                  <Input value={form.plateNumber} onChange={e => set('plateNumber', e.target.value.toUpperCase())} placeholder="e.g. ABC 1234" className="font-mono" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Temporary Import Permit No.</label>
                  <Input value={form.tempPlateId} onChange={e => set('tempPlateId', e.target.value.toUpperCase())} placeholder="e.g. TIP-2024-00123" className="font-mono" />
                  <p className="text-xs text-gray-400 mt-1">If no local plate yet — provide plate or TIP</p>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Import Status</label>
                <Select value={form.importStatus} onValueChange={v => set('importStatus', v)}>
                  <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">Locally registered in Zimbabwe</SelectItem>
                    <SelectItem value="imported">Imported / Foreign-registered</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* STEP 1: Location & Pricing */}
          {step === 1 && (
            <>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Mileage (km) *</label>
                  <Input type="number" value={form.mileage} onChange={e => set('mileage', e.target.value)} placeholder="e.g. 45000" className={errors.mileage ? 'border-red-400' : ''} />
                  {errors.mileage && <p className="text-xs text-red-500 mt-1">{errors.mileage}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Condition *</label>
                  <Select value={form.condition} onValueChange={v => set('condition', v)}>
                    <SelectTrigger className={errors.condition ? 'border-red-400' : ''}><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {SELLER_CONDITIONS.map(condition => <SelectItem key={condition} value={condition}>{condition}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Body style *</label>
                  <Select value={form.category} onValueChange={v => set('category', v)}>
                    <SelectTrigger className={errors.category ? 'border-red-400' : ''}><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {BODY_STYLES.map(bodyStyle => <SelectItem key={bodyStyle} value={bodyStyle}>{bodyStyle}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Fuel Type *</label>
                  <Select value={form.fuelType} onValueChange={v => set('fuelType', v)}>
                    <SelectTrigger className={errors.fuelType ? 'border-red-400' : ''}><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {FUEL_TYPES.map(fuel => <SelectItem key={fuel} value={fuel}>{fuel}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Transmission *</label>
                  <Select value={form.transmission} onValueChange={v => set('transmission', v)}>
                    <SelectTrigger className={errors.transmission ? 'border-red-400' : ''}><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {TRANSMISSIONS.map(transmission => <SelectItem key={transmission} value={transmission}>{transmission}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Drivetrain</label>
                  <Select value={form.drivetrain} onValueChange={v => set('drivetrain', v)}>
                    <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                    <SelectContent>
                      {DRIVETRAINS.map(drivetrain => <SelectItem key={drivetrain} value={drivetrain}>{drivetrain}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Currency *</label>
                  <Select value={form.currency} onValueChange={v => set('currency', v)}>
                    <SelectTrigger className={errors.currency ? 'border-red-400' : ''} data-testid="vehicle-currency-input"><SelectValue placeholder="Select currency" /></SelectTrigger>
                    <SelectContent>{LISTING_CURRENCIES.map(c => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                  {errors.currency && <p className="text-xs text-red-500 mt-1">{errors.currency}</p>}
                </div>
                <div>
                  {/* The label states the amount only. It read "Price (USD)" while the payload
                      hardcoded 'USD' — the sole place the seller was told which currency this
                      figure would be published in, and they had no say in it. */}
                  <label className="text-sm font-medium mb-1.5 block">
                    Price *{form.currency && <span className="text-gray-400 font-normal"> ({form.currency})</span>}
                  </label>
                  <Input type="number" value={form.price} onChange={e => set('price', e.target.value)} placeholder="e.g. 25000" className={errors.price ? 'border-red-400' : ''} />
                  {errors.price && <p className="text-xs text-red-500 mt-1">{errors.price}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Location *</label>
                  <Select value={form.location} onValueChange={v => set('location', v)}>
                    <SelectTrigger className={errors.location ? 'border-red-400' : ''}><SelectValue placeholder="City" /></SelectTrigger>
                    <SelectContent>{zimbabweLocations.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Province</label>
                  <Select value={form.province} onValueChange={v => set('province', v)}>
                    <SelectTrigger><SelectValue placeholder="Province" /></SelectTrigger>
                    <SelectContent>{zimbabweProvinces.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>

              {/* S3 — WHAT THIS SELLER AGREES TO PUBLISH.
                  The backend has always governed both of these fail-closed, but neither was a
                  seller's decision: location was published because they typed it into a listing
                  form, and public identity could not be switched on at all. Both now default to
                  the private answer, so publishing is something a seller chooses. */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4" data-testid="seller-privacy-controls">
                <div>
                  <p className="text-sm font-semibold">What buyers can see about you</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    These are your choices. CarUp keeps everything else private until you change them.
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block" htmlFor="listing-location-visibility">Location on the public listing</label>
                  <Select value={form.locationVisibility} onValueChange={v => set('locationVisibility', v)}>
                    <SelectTrigger id="listing-location-visibility" data-testid="listing-location-visibility">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="withheld">Keep my location private until I reply to a buyer</SelectItem>
                      <SelectItem value="province_only">Show my province only, not my city</SelectItem>
                      <SelectItem value="public">Show my city and province on the listing</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500 mt-1">
                    {form.locationVisibility === 'public'
                      ? 'Buyers will see your city and province, and can filter for it.'
                      : form.locationVisibility === 'province_only'
                        ? 'Buyers will see your province but not your city. Province-level searches will still find this listing.'
                        : 'Buyers will not see where the vehicle is. Location filters will not match this listing.'}
                  </p>
                </div>
                <div>
                  <label className="flex items-start gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-gray-300"
                      checked={form.publicSellerDisplay}
                      onChange={e => set('publicSellerDisplay', e.target.checked)}
                      data-testid="public-seller-display-toggle"
                    />
                    <span>
                      <span className="font-medium">Show my seller name on the listing</span>
                      <span className="block text-xs text-gray-500 mt-0.5">
                        Leave this off to stay anonymous. Buyers can still contact you through CarUp either way.
                      </span>
                    </span>
                  </label>
                </div>
              </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  Description * <span className="text-gray-400 font-normal">({form.description.length}/500 — min 50)</span>
                </label>
                <textarea
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  rows={5}
                  maxLength={500}
                  placeholder="Describe the vehicle's condition, history, special features..."
                  className={`w-full rounded-md border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-400 ${errors.description ? 'border-red-400' : 'border-gray-200'}`}
                />
                {errors.description && <p className="text-xs text-red-500">{errors.description}</p>}
              </div>
            </>
          )}

          {/* STEP 2: Images & Features */}
          {step === 2 && (
            <>
              <div>
                <label className="text-sm font-medium mb-2 block">Vehicle Images ({form.images.length}/15)</label>
                {/* S4 — GUIDANCE, NOT A GATE. These are the shots buyers ask for; none is required,
                    and CarUp does not claim a photo was taken because it was suggested. Damage and
                    odometer are named explicitly because a listing that omits them invites the
                    question anyway, and answering it up front is the seller's advantage. */}
                <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="listing-media-guidance">
                  <p className="text-xs font-semibold text-slate-700">Photos buyers look for</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    All optional. A listing that shows the odometer and any known damage gets fewer
                    &ldquo;can you send more photos?&rdquo; replies.
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {LISTING_PHOTO_SEQUENCE.map(shot => (
                      <li key={shot} className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">{shot}</li>
                    ))}
                  </ul>
                </div>
                <label className={`block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${form.images.length >= LISTING_IMAGE_LIMIT ? 'border-gray-200 bg-gray-50' : 'border-orange-200 hover:border-orange-400 hover:bg-orange-50'}`}>
                  <Upload className="w-8 h-8 text-orange-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600 font-medium">Click to upload photos</p>
                  <p className="text-xs text-gray-400 mt-1">JPG, PNG up to 15 images</p>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageUpload}
                    disabled={form.images.length >= LISTING_IMAGE_LIMIT}
                  />
                </label>
                {form.images.length > 0 && (
                  <div className="mt-3" data-testid="listing-media-grid">
                    {/* THE COVER IS A CHOICE, NOT AN INDEX. This badge used to sit on whichever
                        photo happened to be first while the payload sent bare URL strings — so the
                        seller was shown a cover selection that was never made, never sent and never
                        stored. The server's own contract says a bare URL claims nothing and calls
                        electing `idx === 0` a fabrication; painting it here was the same fabrication
                        with fewer steps. */}
                    <p className="text-xs font-medium text-gray-600 mb-2" data-testid="listing-media-cover-state">
                      {coverImageIndex === null
                        ? 'No cover photo chosen. Pick the photo buyers should see first — otherwise CarUp will not claim one for you.'
                        : `Photo ${coverImageIndex + 1} is your cover photo.`}
                    </p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {form.images.map((img, i) => (
                        <div key={i} className="space-y-1.5">
                          <div className="relative aspect-square rounded-lg overflow-hidden group">
                          <img src={img} alt={form.imageLabels[i] || `Listing photo ${i + 1}`} className="w-full h-full object-cover" />
                          {form.imageLabels[i] && (
                            <Badge className="absolute bottom-1 right-1 max-w-[70%] truncate bg-slate-950/80 text-[9px] text-white">
                              {form.imageLabels[i]}
                            </Badge>
                          )}
                          {coverImageIndex === i && (
                            <Badge
                              className="absolute bottom-1 left-1 text-[9px] bg-orange-500 text-white"
                              data-testid={`listing-media-cover-badge-${i}`}
                            >
                              Cover
                            </Badge>
                          )}
                          {coverImageIndex !== i && (
                            <button
                              type="button"
                              onClick={() => setCoverImageIndex(i)}
                              className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                              data-testid={`listing-media-choose-cover-${i}`}
                              aria-label={`Make photo ${i + 1} the cover photo`}
                            >
                              Make cover
                            </button>
                          )}
                          <div className="absolute inset-x-1 top-1 flex justify-start gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            {i > 0 && (
                              <button
                                type="button"
                                onClick={() => moveImage(i, i - 1)}
                                className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                                data-testid={`listing-media-move-earlier-${i}`}
                                aria-label={`Move photo ${i + 1} earlier`}
                              >
                                ←
                              </button>
                            )}
                            {i < form.images.length - 1 && (
                              <button
                                type="button"
                                onClick={() => moveImage(i, i + 1)}
                                className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                                data-testid={`listing-media-move-later-${i}`}
                                aria-label={`Move photo ${i + 1} later`}
                              >
                                →
                              </button>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              // Removing the chosen cover CLEARS the choice. Letting the badge slide
                              // onto whatever takes this index would re-invent a selection the
                              // seller never made.
                              setCoverImageIndex(current => {
                                if (current === null) return null
                                if (current === i) return null
                                return current > i ? current - 1 : current
                              })
                              setForm(previous => ({
                                ...previous,
                                images: previous.images.filter((_, j) => j !== i),
                                imageLabels: previous.imageLabels.filter((_, j) => j !== i),
                              }))
                            }}
                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                            data-testid={`listing-media-remove-${i}`}
                            aria-label={`Remove listing photo ${i + 1}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                          </div>
                          <Select value={form.imageLabels[i] || ''} onValueChange={value => setImageLabel(i, value)}>
                            <SelectTrigger className="h-8 text-[10px]" aria-label={`Photo ${i + 1} angle or view`}>
                              <SelectValue placeholder="Label angle / view" />
                            </SelectTrigger>
                            <SelectContent>
                              {LISTING_PHOTO_SEQUENCE.map(label => <SelectItem key={label} value={label}>{label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <Separator />
              <div>
                <label className="text-sm font-medium mb-2 block">Features & Extras</label>
                <div className="flex gap-2">
                  <Input
                    value={form.featureInput}
                    onChange={e => set('featureInput', e.target.value)}
                    placeholder="e.g. Sunroof, Leather Seats..."
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addFeature() } }}
                  />
                  <Button variant="outline" onClick={addFeature}>Add</Button>
                </div>
                <p className="text-xs text-gray-400 mt-1">Press Enter or comma to add. Click a tag to remove.</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {form.features.map(f => (
                    <Badge
                      key={f}
                      variant="secondary"
                      className="cursor-pointer hover:bg-red-50 hover:text-red-600 gap-1"
                      onClick={() => set('features', form.features.filter(x => x !== f))}
                    >
                      {f} <X className="w-3 h-3" />
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* STEP 3: Review & Save Draft */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4 text-sm">
                {[
                  ['Make & Model', `${form.year} ${form.make} ${form.model}`],
                  ['VIN', form.vin],
                  ['Color', form.color],
                  ['Engine No.', form.engineNumber || '—'],
                  ['Chassis No.', form.chassisNumber || '—'],
                  ['Number Plate', form.plateNumber || form.tempPlateId || '—'],
                  ['Mileage', `${parseInt(form.mileage || '0').toLocaleString()} km`],
                  ['Condition', form.condition],
                  ['Fuel / Trans', `${form.fuelType} / ${form.transmission}`],
                  ['Drivetrain', form.drivetrain || 'Not recorded'],
                  ['Location', form.location],
                  // Was `$… USD` regardless of anything the seller had entered. The review screen is
                  // the last thing they read before asserting "all information provided is accurate",
                  // so it shows the currency they chose and no other.
                  ['Asking Price', `${form.currency} ${parseFloat(form.price || '0').toLocaleString()}`.trim()],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-gray-500">{label}</span>
                    <span className="font-medium text-right">{value}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Description</p>
                <p className="text-sm bg-gray-50 rounded-lg p-3">{form.description}</p>
              </div>
              {form.features.length > 0 && (
                <div>
                  <p className="text-sm text-gray-500 mb-2">Features</p>
                  <div className="flex flex-wrap gap-2">
                    {form.features.map(f => <Badge key={f} variant="secondary">{f}</Badge>)}
                  </div>
                </div>
              )}
              {form.images.length > 0 && (
                <div>
                  <p className="text-sm text-gray-500 mb-2">{form.images.length} image(s) attached</p>
                  <div className="flex gap-2 flex-wrap">
                    {form.images.slice(0, 4).map((img, i) => (
                      <img key={i} src={img} alt="" className="w-16 h-12 rounded-lg object-cover" />
                    ))}
                    {form.images.length > 4 && <div className="w-16 h-12 rounded-lg bg-gray-100 flex items-center justify-center text-xs text-gray-500">+{form.images.length - 4}</div>}
                  </div>
                </div>
              )}

              {/* Publication requirements notice */}
              {missingIdentityFields.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
                  <div className="flex items-start gap-2">
                    <FileWarning className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold text-amber-800 mb-1">Missing identity fields — listing will be saved as draft</p>
                      <p className="text-amber-700 mb-2">The following fields are required before your listing can be published:</p>
                      <ul className="list-disc list-inside text-amber-700 space-y-0.5">
                        {missingIdentityFields.map(f => <li key={f}>{f}</li>)}
                      </ul>
                      <p className="text-amber-600 mt-2">You can add them now or after saving the draft. You must also upload an ownership/registration document.</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                <p className="font-semibold mb-1">By saving, you confirm:</p>
                <p>✓ You are the legal owner or authorised seller</p>
                <p>✓ All information provided is accurate</p>
                <p>✓ The vehicle complies with CarUp listing standards</p>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between pt-4">
            <Button variant="outline" onClick={() => setStep(s => Math.max(s - 1, 0))} disabled={step === 0}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button className="bg-orange-500 hover:bg-orange-600" onClick={nextStep}>
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button className="bg-orange-500 hover:bg-orange-600 min-w-36" onClick={handleSubmit} disabled={submitting} data-testid="submit-vehicle-button">
                {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save as Draft'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
