import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Mail, MessageSquare, Loader2, Phone } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { Vehicle } from '@/types'

export interface SellerInquiry {
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

interface SellerInquiriesCardProps {
  ownedListings?: Vehicle[]
}

function normalizeId(value?: string | null) {
  return String(value || '').trim()
}

function buildOwnedListingMap(ownedListings?: Vehicle[]) {
  return new Map((ownedListings || []).map((listing) => [normalizeId(listing.vin), listing]))
}

function vehicleLabel(listing: Vehicle | undefined, listingId: string) {
  if (!listing) return listingId ? `Listing ${listingId}` : 'Marketplace request'
  return [listing.year, listing.make, listing.model].filter(Boolean).join(' ') || listing.vin
}

function emailHref(email?: string | null) {
  const value = String(email || '').trim()
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? `mailto:${encodeURIComponent(value)}` : null
}

function phoneHref(phone?: string | null) {
  const value = String(phone || '').trim()
  const dial = value.replace(/[^\d+]/g, '')
  return dial.length >= 6 ? `tel:${dial}` : null
}

export function SellerInquiryList({
  inquiries,
  ownedListings,
}: {
  inquiries: SellerInquiry[]
  ownedListings?: Vehicle[]
}) {
  const ownedByVin = buildOwnedListingMap(ownedListings)
  const sellerScopedInquiries = ownedListings
    ? inquiries.filter((inq) => {
        const listingId = normalizeId(inq.listing_id)
        return !listingId || ownedByVin.has(listingId)
      })
    : inquiries

  if (sellerScopedInquiries.length === 0) {
    return <p className="text-sm text-gray-500">No inquiries yet. They will appear here when buyers contact you about your listings.</p>
  }

  return (
    <ul className="space-y-2">
      {sellerScopedInquiries.slice(0, 8).map((inq) => {
        const listingId = normalizeId(inq.listing_id)
        const listing = ownedByVin.get(listingId)
        const vin = listing?.vin || listingId
        const mailto = emailHref(inq.contact_email)
        const tel = phoneHref(inq.contact_phone)
        const hasReplyChannel = Boolean(mailto || tel)

        return (
          <li key={inq.id} className="rounded-lg border border-gray-100 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium capitalize">{inq.inquiry_type.replace(/_/g, ' ')}</span>
              <Badge variant="secondary" className="text-[10px]">{inq.status}</Badge>
            </div>
            <div className="mt-2 rounded-md bg-gray-50 p-2 text-xs text-gray-600">
              <p className="font-medium text-gray-800">
                {vin ? (
                  <Link className="hover:text-orange-600 hover:underline" to={`/marketplace/${encodeURIComponent(vin)}`}>
                    {vehicleLabel(listing, listingId)}
                  </Link>
                ) : (
                  vehicleLabel(listing, listingId)
                )}
              </p>
              {vin && <p className="mt-0.5 font-mono text-[11px] text-gray-500">VIN {vin}</p>}
            </div>
            {inq.message && <p className="mt-2 text-gray-600 line-clamp-2">{inq.message}</p>}
            <div className="mt-2 space-y-1 text-xs text-gray-500">
              <p><span className="text-gray-400">Buyer:</span> {inq.contact_name || 'Buyer'}</p>
              {inq.contact_email && (
                <p className="flex items-center gap-1.5">
                  <Mail className="h-3 w-3 text-gray-400" />
                  {mailto ? <a className="hover:text-orange-600 hover:underline" href={mailto}>{inq.contact_email}</a> : <span>{inq.contact_email}</span>}
                </p>
              )}
              {inq.contact_phone && (
                <p className="flex items-center gap-1.5">
                  <Phone className="h-3 w-3 text-gray-400" />
                  {tel ? <a className="hover:text-orange-600 hover:underline" href={tel}>{inq.contact_phone}</a> : <span>{inq.contact_phone}</span>}
                </p>
              )}
              {!hasReplyChannel && <p className="text-amber-700">No reply channel available</p>}
            </div>
            <p className="mt-2 text-xs text-gray-400">
              {new Date(inq.created_at).toLocaleDateString()}
              {inq.referral_attributed ? ' · referral' : ''}
            </p>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Marketplace inquiries for the signed-in seller/dealer. Reads the ownership-scoped backend endpoint
 * (GET /api/marketplace/my-listings/inquiries) which only returns inquiries on the seller's own
 * listings. Degrades gracefully when the inquiries table is not yet provisioned.
 */
export function SellerInquiriesCard({ ownedListings }: SellerInquiriesCardProps) {
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
          <SellerInquiryList inquiries={inquiries} ownedListings={ownedListings} />
        )}
      </CardContent>
    </Card>
  )
}
