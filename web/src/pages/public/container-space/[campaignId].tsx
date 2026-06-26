import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Container } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

/**
 * Public Container Booking (/public/container-space/:campaignId)
 * Route, dates, capacity, goods description, referral code, waitlist consent.
 * Capacity overbooking is blocked by the backend.
 */

export default function ContainerBooking() {
  const { campaignId } = useParams<{ campaignId: string }>()
  const { submitContainerBooking } = useCarUpApi()

  const [form, setForm] = useState({
    origin: '', destination: '', departure_date: '',
    capacity_requested: '1', goods_description: '',
    referral_code: '', waitlist_consent: false,
    payer_name: '', payer_phone: '', receiver_name: '', receiver_phone: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.origin || !form.destination || !form.departure_date) {
      setError('Origin, destination and departure date are required.')
      return
    }
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const res = await submitContainerBooking({
        origin: form.origin,
        destination: form.destination,
        departure_date: form.departure_date,
        capacity_requested: Number(form.capacity_requested),
        goods_description: form.goods_description,
        referral_code: form.referral_code.trim() || undefined,
        waitlist_consent: form.waitlist_consent,
        campaign_id: campaignId,
        payer_details: { name: form.payer_name, phone: form.payer_phone },
        receiver_details: { name: form.receiver_name, phone: form.receiver_phone },
      })
      setResult('Booking submitted. Event ID: ' + res.event?.id + (form.waitlist_consent ? ' (Waitlist)' : ''))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2"><Container className="h-6 w-6" /> Book Container Space</h1>
      {campaignId && <p className="text-xs text-gray-400">Campaign: {campaignId}</p>}
      <p className="text-sm text-gray-500">Fill in shipment details to request container space. Capacity is limited — confirm your quantity carefully.</p>

      {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</p>}
      {result && <p className="text-sm text-green-600 bg-green-50 p-3 rounded">{result}</p>}

      <Card>
        <CardContent className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm font-semibold text-gray-700">Route</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">Origin *</label>
                <Input placeholder="Harare" value={form.origin} onChange={set('origin')} required />
              </div>
              <div>
                <label className="text-xs text-gray-500">Destination *</label>
                <Input placeholder="Beira" value={form.destination} onChange={set('destination')} required />
              </div>
              <div>
                <label className="text-xs text-gray-500">Departure Date *</label>
                <Input type="date" value={form.departure_date} onChange={set('departure_date')} required />
              </div>
              <div>
                <label className="text-xs text-gray-500">Capacity (units) *</label>
                <Input type="number" min={1} max={50} value={form.capacity_requested} onChange={set('capacity_requested')} required />
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500">Goods Description *</label>
              <Textarea placeholder="What are you shipping?" value={form.goods_description} onChange={set('goods_description')} rows={2} required />
            </div>

            <p className="text-sm font-semibold text-gray-700 pt-1">Contact Details</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">Your Name</label>
                <Input placeholder="Payer name" value={form.payer_name} onChange={set('payer_name')} />
              </div>
              <div>
                <label className="text-xs text-gray-500">Your Phone</label>
                <Input placeholder="+263..." value={form.payer_phone} onChange={set('payer_phone')} />
              </div>
              <div>
                <label className="text-xs text-gray-500">Receiver Name</label>
                <Input placeholder="Receiver name" value={form.receiver_name} onChange={set('receiver_name')} />
              </div>
              <div>
                <label className="text-xs text-gray-500">Receiver Phone</label>
                <Input placeholder="+263..." value={form.receiver_phone} onChange={set('receiver_phone')} />
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500">Referral Code (optional)</label>
              <Input placeholder="If referred" value={form.referral_code} onChange={set('referral_code')} className="font-mono uppercase" />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="waitlist"
                checked={form.waitlist_consent}
                onChange={e => setForm(f => ({ ...f, waitlist_consent: e.target.checked }))}
                className="h-4 w-4"
              />
              <label htmlFor="waitlist" className="text-sm text-gray-600">Join waitlist if capacity is full</label>
            </div>

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Submitting…' : 'Request Container Space'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}