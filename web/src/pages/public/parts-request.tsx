import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Package } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

/**
 * Public Parts Request (/public/parts-request)
 * Vehicle details, part description, optional referral code.
 * Public-facing form (no authentication required), referral tracked server-side.
 */

export default function PartsRequest() {
  const { submitPartsRequest } = useCarUpApi()
  const [form, setForm] = useState({
    vehicle_make: '', vehicle_model: '', vehicle_year: '', vin: '',
    part_number: '', description: '', image_url: '', referral_code: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.vehicle_make || !form.vehicle_model) {
      setError('Vehicle make and model are required.')
      return
    }
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const res = await submitPartsRequest({
        ...form,
        vehicle_year: form.vehicle_year ? Number(form.vehicle_year) : undefined,
        referral_code: form.referral_code.trim() || undefined,
      })
      setResult('Parts request submitted. Event ID: ' + res.event?.id)
      setForm({ vehicle_make: '', vehicle_model: '', vehicle_year: '', vin: '', part_number: '', description: '', image_url: '', referral_code: '' })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="h-6 w-6" /> Request a Part</h1>
      <p className="text-sm text-gray-500">Fill in your vehicle details and the part you need. Your referral code will be credited if provided.</p>

      {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</p>}
      {result && <p className="text-sm text-green-600 bg-green-50 p-3 rounded">{result}</p>}

      <Card>
        <CardContent className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm font-semibold text-gray-700">Vehicle Details</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">Make *</label>
                <Input placeholder="Toyota" value={form.vehicle_make} onChange={set('vehicle_make')} required />
              </div>
              <div>
                <label className="text-xs text-gray-500">Model *</label>
                <Input placeholder="Hilux" value={form.vehicle_model} onChange={set('vehicle_model')} required />
              </div>
              <div>
                <label className="text-xs text-gray-500">Year</label>
                <Input type="number" placeholder="2018" value={form.vehicle_year} onChange={set('vehicle_year')} min={1980} max={2030} />
              </div>
              <div>
                <label className="text-xs text-gray-500">VIN / Chassis</label>
                <Input placeholder="Optional" value={form.vin} onChange={set('vin')} />
              </div>
            </div>

            <p className="text-sm font-semibold text-gray-700 pt-2">Part Details</p>
            <div>
              <label className="text-xs text-gray-500">Part Number (optional)</label>
              <Input placeholder="OEM part number" value={form.part_number} onChange={set('part_number')} />
            </div>
            <div>
              <label className="text-xs text-gray-500">Description *</label>
              <Textarea placeholder="What part do you need? Any damage or symptoms?" value={form.description} onChange={set('description')} rows={3} required />
            </div>
            <div>
              <label className="text-xs text-gray-500">Photo/Document URL (optional)</label>
              <Input placeholder="https://..." value={form.image_url} onChange={set('image_url')} />
            </div>

            <p className="text-sm font-semibold text-gray-700 pt-2">Referral</p>
            <div>
              <label className="text-xs text-gray-500">Referral Code (optional)</label>
              <Input placeholder="If you were referred" value={form.referral_code} onChange={set('referral_code')} className="font-mono uppercase" />
            </div>

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Submitting…' : 'Submit Parts Request'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}