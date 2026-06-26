import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, Link2 } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { UniversalReferralWidget } from '@/components/referral/UniversalReferralWidget'

/**
 * Seller Listing Referral (/dashboard/seller/listing-referral)
 * Creates a listing referral event, displays the permanent code and share widget.
 */

export default function SellerListingReferral() {
  const { createSellerReferral } = useCarUpApi()
  const [listingId, setListingId] = useState('')
  const [milestone, setMilestone] = useState('listed')
  const [code, setCode] = useState<string | null>(null)
  const [eventId, setEventId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await createSellerReferral({ listing_id: listingId.trim() || undefined, milestone })
      setCode(res.permanent_code?.code ?? null)
      setEventId(res.event?.id ?? null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  const MILESTONES = ['listed', 'verified_listing', 'first_sale']

  return (
    <div className="p-6 max-w-lg space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2"><Link2 className="h-6 w-6" /> Listing Referral Link</h1>
      <p className="text-sm text-gray-500">Generate a referral link for your vehicle listing. Share it to earn rewards on verified sales.</p>

      {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</p>}

      {!code ? (
        <Card>
          <CardContent className="p-5">
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">Listing ID (optional)</label>
                <Input placeholder="CarUp listing reference" value={listingId} onChange={e => setListingId(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500">Milestone</label>
                <select
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={milestone}
                  onChange={e => setMilestone(e.target.value)}
                >
                  {MILESTONES.map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? 'Generating…' : 'Generate Referral Link'}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Badge className="bg-green-100 text-green-700">Referral Created</Badge>
                {eventId && <span className="text-xs text-gray-400">Event: {eventId}</span>}
              </div>
              <p className="text-sm text-gray-500">Your permanent referral code:</p>
              <p className="font-mono text-xl font-bold tracking-widest">{code}</p>
            </CardContent>
          </Card>
          <UniversalReferralWidget code={code} />
          <Button variant="outline" className="w-full" onClick={() => { setCode(null); setEventId(null) }}>
            <RefreshCw className="h-4 w-4 mr-2" /> New Listing
          </Button>
        </div>
      )}
    </div>
  )
}