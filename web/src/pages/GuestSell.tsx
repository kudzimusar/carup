import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Camera, LogIn, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/context/AuthContext'
import { zimbabweLocations, zimbabweProvinces } from '@/data/mockData'
import { BODY_STYLES, FUEL_TYPES, SELLER_CONDITIONS, TRANSMISSIONS, VEHICLE_COLORS, VEHICLE_MAKES, isValidVehicleYear, modelsForMake } from '@/data/vehicleTaxonomy'
import { saveGuestSellDraft } from '@/lib/guestSellDraft'
import { toast } from 'sonner'

const CURRENCIES = ['USD', 'ZiG']

const INITIAL = {
  make: '', model: '', year: '', vin: '', color: '',
  mileage: '', condition: '', category: '', fuelType: '', transmission: '',
  location: '', province: '', price: '', currency: '', description: '',
  engineNumber: '', chassisNumber: '', plateNumber: '', tempPlateId: '', importStatus: '',
  features: [] as string[], images: [] as string[],
}

type GuestForm = typeof INITIAL

function validVin(vin: string) {
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)
}

export default function GuestSell() {
  const { isAuthenticated } = useAuth()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<GuestForm>(INITIAL)
  const [feature, setFeature] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [draftSaved, setDraftSaved] = useState(false)
  const modelOptions = useMemo(() => modelsForMake(form.make).map(item => item.name), [form.make])

  const set = <K extends keyof GuestForm>(key: K, value: GuestForm[K]) => {
    setForm(previous => ({ ...previous, [key]: value }))
    setDraftSaved(false)
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
    const remaining = Math.max(0, 10 - form.images.length)
    const files = Array.from(event.target.files || [])
      .filter(file => file.type.startsWith('image/'))
      .slice(0, remaining)
    if (files.length === 0) return

    // Read the selected batch concurrently but apply it once, in selection order. Individual
    // FileReader callbacks may finish out of order; appending from each callback can silently
    // reshuffle which photo becomes the first/primary preview.
    Promise.all(files.map(file => new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => resolve('')
      reader.readAsDataURL(file)
    }))).then(results => {
      const images = results.filter(Boolean)
      if (images.length === 0) return
      setForm(previous => ({
        ...previous,
        images: [...previous.images, ...images].slice(0, 10),
      }))
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
    <div className="min-h-screen bg-white pb-10 text-slate-950" data-testid="guest-sell-page">
      <header className="relative overflow-hidden border-b border-slate-800 bg-[#08111f] text-white [background-image:radial-gradient(circle_at_85%_20%,rgba(249,115,22,0.18),transparent_30%)]">
        <div className="section-padding mx-auto max-w-5xl py-6">
          <Link to="/marketplace" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Back to marketplace
          </Link>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-400">Sell on CarUp</p>
              <h1 className="mt-2 max-w-3xl text-4xl font-black leading-[0.98] tracking-[-0.045em] text-white sm:text-5xl">Build the car story first. <span className="text-orange-400">Create the account when it matters.</span></h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
                Tell CarUp about the vehicle, add photos and preview the listing. We ask for an account only when you want CarUp to persist the draft under your identity.
              </p>
            </div>
            <div className="min-w-32">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Draft completeness</p>
              <p className="text-3xl font-black text-white">{completeness}%</p>
            </div>
          </div>
        </div>
      </header>

      <main className="section-padding mx-auto max-w-5xl py-8 sm:py-10">
        <div className="mb-8 grid grid-cols-4 gap-3 border-b border-slate-200 pb-5" aria-label="Sell progress">
          {['Vehicle', 'Listing', 'Photos', 'Preview'].map((label, index) => (
            <div key={label}>
              <div className={`h-1 ${index <= step ? 'bg-orange-500' : 'bg-slate-200'}`} />
              <p className={`mt-2 text-[11px] font-bold ${index === step ? 'text-slate-950' : 'text-slate-400'}`}>{label}</p>
            </div>
          ))}
        </div>

        <section className="border-y border-slate-200 bg-white py-6 sm:py-8">
          {step === 0 && (
            <div className="space-y-5" data-testid="guest-sell-vehicle-step">
              <div>
                <h2 className="text-xl font-black">Which vehicle are you selling?</h2>
                <p className="mt-1 text-sm text-slate-500">Nothing is published from this step.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Make" error={errors.make}>
                  <Input list="carup-guest-makes" value={form.make} onChange={e => set('make', e.target.value)} placeholder="Toyota" data-testid="guest-sell-make" />
                  <datalist id="carup-guest-makes">{VEHICLE_MAKES.map(make => <option key={make} value={make} />)}</datalist>
                </Field>
                <Field label="Model" error={errors.model}>
                  <Input list="carup-guest-models" value={form.model} onChange={e => set('model', e.target.value)} placeholder="Hilux" data-testid="guest-sell-model" />
                  <datalist id="carup-guest-models">{modelOptions.map(model => <option key={model} value={model} />)}</datalist>
                </Field>
                <Field label="Year" error={errors.year}><Input type="number" value={form.year} onChange={e => set('year', e.target.value)} placeholder="2019" data-testid="guest-sell-year" /></Field>
                <Field label="Colour" error={errors.color}>
                  <Input list="carup-guest-colours" value={form.color} onChange={e => set('color', e.target.value)} placeholder="Silver" data-testid="guest-sell-color" />
                  <datalist id="carup-guest-colours">{VEHICLE_COLORS.map(colour => <option key={colour} value={colour} />)}</datalist>
                </Field>
              </div>
              <Field label="VIN" error={errors.vin}>
                <Input value={form.vin} onChange={e => set('vin', e.target.value.toUpperCase())} maxLength={17} placeholder="17-character VIN" className="font-mono" data-testid="guest-sell-vin" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Chassis number (optional until publication)"><Input value={form.chassisNumber} onChange={e => set('chassisNumber', e.target.value.toUpperCase())} /></Field>
                <Field label="Engine number (optional until publication)"><Input value={form.engineNumber} onChange={e => set('engineNumber', e.target.value.toUpperCase())} /></Field>
                <Field label="Number plate"><Input value={form.plateNumber} onChange={e => set('plateNumber', e.target.value.toUpperCase())} /></Field>
                <Field label="Temporary import permit"><Input value={form.tempPlateId} onChange={e => set('tempPlateId', e.target.value.toUpperCase())} /></Field>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5" data-testid="guest-sell-listing-step">
              <div>
                <h2 className="text-xl font-black">Describe the listing.</h2>
                <p className="mt-1 text-sm text-slate-500">These are seller-stated facts. CarUp will not turn them into verified facts merely because you entered them.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Mileage (km)" error={errors.mileage}><Input type="number" value={form.mileage} onChange={e => set('mileage', e.target.value)} /></Field>
                <SelectField label="Condition" value={form.condition} error={errors.condition} onValue={v => set('condition', v)} options={SELLER_CONDITIONS} />
                <SelectField label="Body style" value={form.category} error={errors.category} onValue={v => set('category', v)} options={[...BODY_STYLES]} />
                <SelectField label="Fuel" value={form.fuelType} error={errors.fuelType} onValue={v => set('fuelType', v)} options={FUEL_TYPES} />
                <SelectField label="Transmission" value={form.transmission} error={errors.transmission} onValue={v => set('transmission', v)} options={TRANSMISSIONS} />
                <SelectField label="Currency" value={form.currency} error={errors.currency} onValue={v => set('currency', v)} options={CURRENCIES} />
                <Field label="Asking price" error={errors.price}><Input type="number" value={form.price} onChange={e => set('price', e.target.value)} /></Field>
                <SelectField label="City" value={form.location} error={errors.location} onValue={v => set('location', v)} options={zimbabweLocations} />
                <SelectField label="Province" value={form.province} onValue={v => set('province', v)} options={zimbabweProvinces} />
              </div>
              <Field label="Description" error={errors.description}>
                <textarea
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  rows={5}
                  className="w-full border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400"
                  placeholder="Condition, maintenance, what the buyer should know…"
                />
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6" data-testid="guest-sell-photos-step">
              <div>
                <h2 className="text-xl font-black">Show buyers the car.</h2>
                <p className="mt-1 text-sm text-slate-500">Listing photos are advertising media, not verified evidence.</p>
              </div>
              <label className="block cursor-pointer border-y border-dashed border-slate-300 bg-slate-50 p-10 text-center transition hover:border-orange-400 hover:bg-orange-50/30">
                <Camera className="mx-auto h-8 w-8 text-orange-500" />
                <p className="mt-2 text-sm font-bold">Add up to 10 photos</p>
                <p className="mt-1 text-xs text-slate-500">Nothing is uploaded to CarUp until you authenticate and save.</p>
                <input type="file" accept="image/*" multiple className="hidden" onChange={addImages} />
              </label>
              {form.images.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {form.images.map((src, index) => (
                    <div key={`${src.slice(0, 24)}-${index}`} className="relative aspect-[4/3] overflow-hidden bg-slate-100 shadow-[0_12px_28px_rgba(15,23,42,0.12)]">
                      <img src={src} alt={`Draft vehicle photo ${index + 1}`} className="h-full w-full object-cover" />
                      <button type="button" onClick={() => set('images', form.images.filter((_, i) => i !== index))} className="absolute right-2 top-2 bg-slate-950/80 p-1 text-white" aria-label={`Remove photo ${index + 1}`}><X className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <label className="text-sm font-bold">Features and extras</label>
                <div className="mt-2 flex gap-2">
                  <Input value={feature} onChange={e => setFeature(e.target.value)} placeholder="Tow bar, leather seats…" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFeature() } }} />
                  <Button type="button" variant="outline" onClick={addFeature}>Add</Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {form.features.map(item => <button key={item} type="button" onClick={() => set('features', form.features.filter(value => value !== item))} className="border border-slate-200 px-3 py-1 text-xs font-semibold">{item} ×</button>)}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6" data-testid="guest-sell-preview-step">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600">Private preview</p>
                <h2 className="mt-1 text-2xl font-black">{form.year} {form.make} {form.model}</h2>
                <p className="mt-1 text-sm text-slate-500">{form.location || 'Location not entered'} · {Number(form.mileage || 0).toLocaleString()} km</p>
              </div>
              {form.images[0] && <img src={form.images[0]} alt="Listing preview" className="aspect-[16/9] w-full object-cover shadow-[0_24px_60px_rgba(15,23,42,0.16)] sm:aspect-[2/1]" />}
              <div className="grid border-y border-slate-200 sm:grid-cols-3">
                <PreviewFact label="Price" value={form.currency && form.price ? `${form.currency} ${Number(form.price).toLocaleString()}` : 'Not entered'} />
                <PreviewFact label="Condition" value={form.condition || 'Not entered'} />
                <PreviewFact label="Fuel / transmission" value={[form.fuelType, form.transmission].filter(Boolean).join(' · ') || 'Not entered'} />
              </div>
              <div className="border-l-4 border-orange-500 bg-orange-50 p-4 text-sm text-orange-950">
                <p className="font-bold">This is still only a browser draft.</p>
                <p className="mt-1">CarUp has not claimed ownership, uploaded the photos, published the listing or created any Trust fact.</p>
              </div>
              <Button type="button" onClick={saveForAccount} className="w-full bg-slate-950 text-white hover:bg-orange-600" data-testid="guest-sell-commit">
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

          <div className="mt-7 flex items-center justify-between border-t border-slate-100 pt-5">
            <Button type="button" variant="ghost" onClick={back} disabled={step === 0}>Back</Button>
            {step < 3 && <Button type="button" onClick={next} className="bg-orange-500 text-white hover:bg-orange-600">Continue <ArrowRight className="ml-2 h-4 w-4" /></Button>}
          </div>
        </section>
      </main>
    </div>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <div><label className="mb-1.5 block text-sm font-bold text-slate-800">{label}</label>{children}{error && <p className="mt-1 text-xs text-red-600">{error}</p>}</div>
}

function SelectField({ label, value, error, onValue, options }: { label: string; value: string; error?: string; onValue: (value: string) => void; options: string[] }) {
  return <Field label={label} error={error}><Select value={value} onValueChange={onValue}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></Field>
}

function PreviewFact({ label, value }: { label: string; value: string }) {
  return <div className="border-b border-slate-200 py-4 sm:border-b-0 sm:border-r sm:px-4 last:border-r-0"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 font-black text-slate-950">{value}</p></div>
}
