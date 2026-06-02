import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CheckCircle, ChevronRight, ChevronLeft, Upload, X, Loader2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { zimbabweLocations, zimbabweProvinces } from '@/data/mockData'
import { useCarUpApi } from '@/hooks/useCarUpApi'

const MAKES = ['Toyota', 'BMW', 'Mercedes-Benz', 'Nissan', 'Mazda', 'Volkswagen', 'Ford', 'Honda', 'Land Rover', 'Audi', 'Other']
const YEARS = Array.from({ length: 37 }, (_, i) => String(2026 - i))
const STEPS = ['Vehicle Details', 'Location & Pricing', 'Images & Features', 'Review & Submit']

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
  make: '', model: '', year: '2020', vin: '', engineNumber: '', color: '',
  mileage: '', condition: '', category: '', fuelType: '', transmission: '',
  location: '', province: '', price: '', description: '',
  features: [] as string[], featureInput: '',
  images: [] as string[],
}

function validateVin(vin: string) {
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)
}

export default function SellVehicle() {
  const navigate = useNavigate()
  const { createVehicleListing, uploadVehicleImages } = useCarUpApi()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(INITIAL)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const set = (field: string, value: string | number | boolean | string[]) => setForm(prev => ({ ...prev, [field]: value }))

  const addFeature = () => {
    const f = form.featureInput.trim()
    if (f && !form.features.includes(f)) {
      set('features', [...form.features, f])
      set('featureInput', '')
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (form.images.length + files.length > 15) {
      toast.error('Maximum 15 images allowed')
      return
    }
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        set('images', [...form.images, ev.target?.result as string])
      }
      reader.readAsDataURL(file)
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
      if (!form.price) e.price = 'Required'
      else if (parseFloat(form.price) < 100) e.price = 'Price must be at least $100'
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

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      let uploadedImageUrls: string[] = []
      
      // Upload listing photos to private media pipeline first if present
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

      await createVehicleListing({
        vin: form.vin.toUpperCase(),
        make: form.make,
        model: form.model,
        year: parseInt(form.year),
        color: form.color,
        mileage: parseInt(form.mileage),
        fuel_type: form.fuelType,
        transmission: form.transmission,
        condition: form.condition,
        category: form.category,
        price: parseFloat(form.price),
        currency: 'USD',
        description: form.description,
        location: form.location,
        province: form.province,
        images: uploadedImageUrls
      })
      toast.success('Listing submitted! Your vehicle is now live on CarUp.')
      navigate('/dashboard')
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : ''
      if (errMsg.includes('already listed')) {
        toast.error('A vehicle with this VIN is already listed.')
      } else {
        toast.error('Failed to submit listing. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const vinValid = form.vin.length >= 2 ? validateVin(form.vin) : null

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">List Your Vehicle</h1>
        <p className="text-gray-500">Complete the form below to list your vehicle on CarUp Marketplace</p>
      </div>

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
                  <Select value={form.make} onValueChange={v => set('make', v)}>
                    <SelectTrigger className={errors.make ? 'border-red-400' : ''} data-testid="vehicle-make-input"><SelectValue placeholder="Select make" /></SelectTrigger>
                    <SelectContent>{MAKES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                  {errors.make && <p className="text-xs text-red-500 mt-1">{errors.make}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Model *</label>
                  <Input value={form.model} onChange={e => set('model', e.target.value)} placeholder="e.g. Hilux GD-6" className={errors.model ? 'border-red-400' : ''} data-testid="vehicle-model-input" />
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
                  <Input value={form.color} onChange={e => set('color', e.target.value)} placeholder="e.g. Pearl White" className={errors.color ? 'border-red-400' : ''} />
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
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Engine Number</label>
                <Input value={form.engineNumber} onChange={e => set('engineNumber', e.target.value)} placeholder="e.g. 1GD-789012" className="font-mono" />
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
                      <SelectItem value="New">New</SelectItem>
                      <SelectItem value="Used">Used</SelectItem>
                      <SelectItem value="Certified Pre-Owned">Certified Pre-Owned</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Category *</label>
                  <Select value={form.category} onValueChange={v => set('category', v)}>
                    <SelectTrigger className={errors.category ? 'border-red-400' : ''}><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {['Sedan', 'SUV', 'Hatchback', 'Pickup', 'Luxury', 'Commercial'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Fuel Type *</label>
                  <Select value={form.fuelType} onValueChange={v => set('fuelType', v)}>
                    <SelectTrigger className={errors.fuelType ? 'border-red-400' : ''}><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {['Petrol', 'Diesel', 'Hybrid', 'Electric'].map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Transmission *</label>
                  <Select value={form.transmission} onValueChange={v => set('transmission', v)}>
                    <SelectTrigger className={errors.transmission ? 'border-red-400' : ''}><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Automatic">Automatic</SelectItem>
                      <SelectItem value="Manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Price (USD) *</label>
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
                <label className={`block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${form.images.length >= 15 ? 'border-gray-200 bg-gray-50' : 'border-orange-200 hover:border-orange-400 hover:bg-orange-50'}`}>
                  <Upload className="w-8 h-8 text-orange-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600 font-medium">Click to upload photos</p>
                  <p className="text-xs text-gray-400 mt-1">JPG, PNG up to 15 images</p>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageUpload}
                    disabled={form.images.length >= 15}
                  />
                </label>
                {form.images.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 mt-3">
                    {form.images.map((img, i) => (
                      <div key={i} className="relative aspect-square rounded-lg overflow-hidden group">
                        <img src={img} alt="" className="w-full h-full object-cover" />
                        {i === 0 && <Badge className="absolute bottom-1 left-1 text-[9px] bg-orange-500 text-white">Cover</Badge>}
                        <button
                          onClick={() => set('images', form.images.filter((_, j) => j !== i))}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
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

          {/* STEP 3: Review */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4 text-sm">
                {[
                  ['Make & Model', `${form.year} ${form.make} ${form.model}`],
                  ['VIN', form.vin],
                  ['Color', form.color],
                  ['Mileage', `${parseInt(form.mileage || '0').toLocaleString()} km`],
                  ['Condition', form.condition],
                  ['Fuel / Trans', `${form.fuelType} / ${form.transmission}`],
                  ['Location', form.location],
                  ['Asking Price', `$${parseFloat(form.price || '0').toLocaleString()} USD`],
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
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                <p className="font-semibold mb-1">By submitting, you confirm:</p>
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
                {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</> : 'Submit Listing'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
