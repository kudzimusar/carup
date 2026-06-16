import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MessageSquare, Loader2 } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

interface SellerInquiry {
  id: string
  listing_id?: string | null
  inquiry_type: string
  status: string
  message?: string | null
  contact_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  referral_attributed?: boolean
  created_at: string
}

/**
 * Marketplace inquiries for the signed-in seller/dealer. Reads the ownership-scoped backend endpoint
 * (GET /api/marketplace/my-listings/inquiries) which only returns inquiries on the seller's own
 * listings. Degrades gracefully when the inquiries table is not yet provisioned.
 */
export function SellerInquiriesCard() {
  const { fetchMyMarketplaceInquiries } = useCarUpApi()
  const [inquiries, setInquiries] = useState<SellerInquiry[]>([])
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let mounted = true
    fetchMyMarketplaceInquiries()
      .then((res) => { if (mounted) setInquiries(res.inquiries || []) })
      .catch(() => { if (mounted) setUnavailable(true) })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [fetchMyMarketplaceInquiries])

  if (unavailable) return null

  return (
    <Card className="border-0 card-shadow" data-testid="seller-inquiries-card">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-orange-500" />
          <h3 className="font-semibold">Marketplace inquiries</h3>
          {!loading && <Badge variant="secondary">{inquiries.length}</Badge>}
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : inquiries.length === 0 ? (
          <p className="text-sm text-gray-500">No inquiries yet. They will appear here when buyers contact you about your listings.</p>
        ) : (
          <ul className="space-y-2">
            {inquiries.slice(0, 8).map((inq) => (
              <li key={inq.id} className="rounded-lg border border-gray-100 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize">{inq.inquiry_type.replace(/_/g, ' ')}</span>
                  <Badge variant="secondary" className="text-[10px]">{inq.status}</Badge>
                </div>
                {inq.message && <p className="mt-1 text-gray-600 line-clamp-2">{inq.message}</p>}
                <p className="mt-1 text-xs text-gray-400">
                  {inq.contact_name || inq.contact_email || inq.contact_phone || 'Buyer'} · {new Date(inq.created_at).toLocaleDateString()}
                  {inq.referral_attributed ? ' · referral' : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
