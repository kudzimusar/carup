import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Eye, DollarSign, TrendingUp, Loader2, Car, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { ListingImage } from '@/components/marketplace/ListingImage'
import ListingInsights from '@/components/intelligence/ListingInsights'
import { primaryListingImageUrl } from '@/lib/listingMedia'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { SellerInquiriesCard } from '@/components/marketplace/SellerInquiriesCard'
import { PUBLICATION_BADGE } from '@/lib/publicationStatus'
import { describePublicationRefusal } from '@/lib/publicationRefusal'
import { readOwnerTrustClaim, statedPrice } from './ownerStatedValues'
import type { Vehicle } from '@/types'

const STATUS_BADGE: Record<string, string> = {
  available: 'bg-green-100 text-green-700',
  reserved: 'bg-amber-100 text-amber-700',
  sold: 'bg-gray-100 text-gray-500',
}

export function normalizeListingStatus(status?: string | null) {
  return String(status || '').toLowerCase()
}

export function isSoldListingStatus(status?: string | null) {
  return normalizeListingStatus(status) === 'sold'
}

/**
 * An absent listing status used to default to 'available', so a row whose lifecycle state had never
 * been written was advertised to its own seller as live. Absent is its own answer.
 */
export function formatListingStatus(status?: string | null) {
  const value = String(status || '').trim()
  if (!value) return 'Status not recorded'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function applyPersistedListingStatus(listings: Vehicle[], vin: string, status: string) {
  return listings.map(listing => (
    listing.vin === vin ? { ...listing, status } : listing
  ))
}

type ListingConversation = {
  id: string
  marketplace_listing_id?: string | null
  thread_type?: string
  business_workflow?: string
  unread_count?: number
  latest_message?: { text?: string } | null
}

export default function MyListings() {
  // Destructured, never held as an aggregate object — the aggregate identity changes
  // every render and re-triggers the effects below.
  const {
    fetchOwnedVehicles,
    updateVehicleStatus,
    fetchCommunicationThreads,
    publishVehicleListing,
    unpublishVehicleListing,
  } = useCarUpApi()
  const [listingStatuses, setListingStatuses] = useState<Record<string, string>>({})
  const [insightsFor, setInsightsFor] = useState<string | null>(null)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [publishingVin, setPublishingVin] = useState<string | null>(null)
  const [publicationStatuses, setPublicationStatuses] = useState<Record<string, string>>({})
  const [myListings, setMyListings] = useState<Vehicle[]>([])
  const [conversations, setConversations] = useState<ListingConversation[]>([])
  // Lets SellerInquiriesCard tell "owned listings not loaded yet" apart from
  // "loaded and genuinely empty" — it receives undefined until the fetch lands.
  const [ownedLoaded, setOwnedLoaded] = useState(false)

  const handlePublishToggle = async (vin: string, currentlyPublished: boolean) => {
    if (publishingVin) return
    setPublishingVin(vin)
    try {
      const result = currentlyPublished
        ? await unpublishVehicleListing(vin)
        : await publishVehicleListing(vin)
      setPublicationStatuses(prev => ({ ...prev, [vin]: result.publication_status }))
      toast.success(currentlyPublished
        ? 'Listing unpublished — it is no longer publicly visible.'
        : 'Listing published! Buyers can now find it on the marketplace.')
    } catch (e: unknown) {
      toast.error(describePublicationRefusal(e))
    } finally {
      setPublishingVin(null)
    }
  }

  useEffect(() => {
    let mounted = true
    Promise.all([
      fetchOwnedVehicles(),
      fetchCommunicationThreads().catch(() => ({ threads: [] })),
    ]).then(([vehicles, communications]) => {
      if (!mounted) return
      setMyListings(vehicles)
      setConversations((communications.threads || []) as ListingConversation[])
      setOwnedLoaded(true)
    })
    return () => { mounted = false }
  }, [fetchCommunicationThreads, fetchOwnedVehicles])

  const handleMarkSold = async (vehicleId: string, vin: string) => {
    if (markingId) return
    setMarkingId(vehicleId)
    try {
      const result = await updateVehicleStatus(vin, 'sold')
      const persistedStatus = String(result?.status || 'Sold')
      setListingStatuses(prev => ({ ...prev, [vehicleId]: persistedStatus }))
      setMyListings(prev => applyPersistedListingStatus(prev, vin, persistedStatus))
      toast.success('Vehicle marked as sold! It will be removed from active listings.')
    } catch {
      toast.error('Could not mark this vehicle as sold. Please try again.')
    } finally {
      setMarkingId(null)
    }
  }

  const marketplaceConversations = conversations.filter((conversation) =>
    conversation.business_workflow === 'marketplace' || conversation.thread_type === 'marketplace_inquiry')
  const totalUnread = marketplaceConversations.reduce((sum, conversation) => sum + Number(conversation.unread_count || 0), 0)

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Listings</h1>
          <p className="text-gray-500">
            {myListings.length} listings · {marketplaceConversations.length} conversations · {totalUnread} unread
          </p>
        </div>
        <Button className="bg-orange-500 hover:bg-orange-600 gap-1" asChild>
          <Link to="/dashboard/sell-vehicle"><Plus className="w-4 h-4" /> New Listing</Link>
        </Button>
      </div>

      <SellerInquiriesCard ownedListings={ownedLoaded ? myListings : undefined} />

      {myListings.length === 0 ? (
        <Card className="border-0 card-shadow">
          <CardContent className="p-12 text-center">
            <Car className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Listings Yet</h3>
            <p className="text-gray-500 mb-4">List your vehicle on the marketplace to reach thousands of buyers across Zimbabwe.</p>
            <Button className="bg-orange-500 hover:bg-orange-600" asChild>
              <Link to="/dashboard/sell-vehicle">Create Your First Listing</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {myListings.map((listing) => {
            const effectiveStatus = listingStatuses[listing.vin] || listing.status || ''
            const normalizedStatus = normalizeListingStatus(effectiveStatus)
            const trust = readOwnerTrustClaim(listing)
            const isSold = isSoldListingStatus(effectiveStatus)
            const listingConversations = marketplaceConversations.filter((conversation) =>
              String(conversation.marketplace_listing_id || '').toUpperCase() === String(listing.vin || '').toUpperCase())
            const listingUnread = listingConversations.reduce((sum, conversation) => sum + Number(conversation.unread_count || 0), 0)
            const latest = listingConversations[0]?.latest_message?.text
            return (
              <Card key={listing.vin} className={`border-0 card-shadow transition-opacity ${isSold ? 'opacity-60' : ''}`}>
                <CardContent className="p-5" data-testid={`my-listing-card-${listing.vin}`}>
                  <div className="flex gap-4">
                    {/* No stock-photo stand-in: an unrelated car is a claim about this listing. */}
                    <ListingImage
                      src={primaryListingImageUrl(listing.listing_media)}
                      alt={`${listing.year} ${listing.make} ${listing.model}`}
                      className="w-32 h-24 rounded-lg overflow-hidden flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div>
                          <h3 className="font-semibold">{listing.year} {listing.make} {listing.model}</h3>
                          <p className="text-lg font-bold text-orange-600 mt-0.5" data-testid={`listing-price-${listing.vin}`}>
                            {statedPrice(listing.price)}
                          </p>
                        </div>
                        <div className="flex gap-1.5 flex-wrap justify-end">
                          <Badge className={`text-xs font-medium ${STATUS_BADGE[normalizedStatus] || 'bg-gray-100 text-gray-600'}`}>
                            {formatListingStatus(effectiveStatus)}
                          </Badge>
                          {(() => {
                            const pub = publicationStatuses[listing.vin] || listing.publication_status
                            const meta = pub ? PUBLICATION_BADGE[pub] : null
                            return meta ? (
                              <Badge data-testid={`publication-badge-${listing.vin}`} className={`text-xs font-medium ${meta.className}`}>
                                {meta.label}
                              </Badge>
                            ) : null
                          })()}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                        {/* `viewCount || 0` reported "0 views" on a listing nothing counts views
                            for — a measurement of zero where no measurement is taken. */}
                        <span className="flex items-center gap-1" data-testid={`listing-views-${listing.vin}`}>
                          <Eye className="w-3 h-3" />
                          {typeof listing.viewCount === 'number' ? `${listing.viewCount} views` : 'Views not tracked'}
                        </span>
                        <span className="flex items-center gap-1" data-testid={`trust-claim-${listing.vin}`}>
                          <TrendingUp className="w-3 h-3" />
                          {trust.score !== null ? (
                            <span data-testid={`trust-claim-score-${listing.vin}`}>Trust: {trust.score} / 100 · {trust.headline}</span>
                          ) : (
                            <span className="italic text-gray-400" data-testid={`trust-claim-state-${listing.vin}`}>Trust: {trust.headline}</span>
                          )}
                        </span>
                        <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{listingConversations.length} conversations · {listingUnread} unread</span>
                        {/* `vehicles.created_at` is the row-insert timestamp, not the date this
                            listing was published — there is no governed publication date, so the
                            absence is stated rather than filled with the record's birthday. */}
                        <span>Listing date not recorded</span>
                      </div>
                      {latest && <p className="mt-2 line-clamp-1 text-xs text-gray-600">Latest: “{latest}”</p>}
                      {/* OBS-16: a non-wrapping flex row of four actions, the last of them the long
                          "Publish to Marketplace", pushed the CTA outside the card on a narrow
                          viewport and gave the page horizontal overflow. Wrapping is the whole fix —
                          the publication semantics are untouched. */}
                      <div className="flex flex-wrap gap-2 mt-3" data-testid={`listing-actions-${listing.vin}`}>
                        <Button size="sm" className="text-xs gap-1" asChild>
                          <Link to="/dashboard/communications"><MessageSquare className="w-3 h-3" /> Conversations</Link>
                        </Button>
                        <Button size="sm" variant="outline" className="text-xs gap-1" asChild>
                          <Link to={`/marketplace/${listing.vin}`}><Eye className="w-3 h-3" /> View listing</Link>
                        </Button>
                        {!isSold && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs gap-1"
                            data-testid={`mark-sold-${listing.vin}`}
                            disabled={markingId === listing.vin}
                            onClick={() => handleMarkSold(listing.vin, listing.vin)}
                          >
                            {markingId === listing.vin
                              ? <><Loader2 className="w-3 h-3 animate-spin" /> Updating...</>
                              : <><DollarSign className="w-3 h-3" /> Mark sold</>
                            }
                          </Button>
                        )}
                        {!isSold && (() => {
                          const pub = publicationStatuses[listing.vin] || listing.publication_status
                          if (!pub) return null
                          const isPublished = pub === 'published'
                          return (
                            <Button
                              size="sm"
                              variant={isPublished ? 'outline' : 'default'}
                              className={`text-xs gap-1 ${isPublished ? '' : 'bg-green-600 hover:bg-green-700'}`}
                              data-testid={`publish-toggle-${listing.vin}`}
                              disabled={publishingVin === listing.vin}
                              onClick={() => handlePublishToggle(listing.vin, isPublished)}
                            >
                              {publishingVin === listing.vin
                                ? <><Loader2 className="w-3 h-3 animate-spin" /> Updating...</>
                                : (isPublished ? 'Unpublish' : 'Publish to Marketplace')
                              }
                            </Button>
                          )
                        })()}
                        {isSold && <Badge className="text-xs text-gray-400 font-normal">Sale completed</Badge>}
                      </div>

                      {/* Intelligence I7 — full listing insights, opened on demand so a
                          listing page does not fetch analytics nobody asked for. Kept
                          OUTSIDE the action row above, whose layout is pinned by a
                          sibling lane's responsive test. */}
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs gap-1 px-2"
                          data-testid={`toggle-insights-${listing.vin}`}
                          aria-expanded={insightsFor === listing.vin}
                          onClick={() => setInsightsFor(insightsFor === listing.vin ? null : listing.vin)}
                        >
                          <TrendingUp className="w-3 h-3" />
                          {insightsFor === listing.vin ? 'Hide insights' : 'Full insights'}
                        </Button>
                        {insightsFor === listing.vin && (
                          <div className="mt-3" data-testid={`listing-insights-panel-${listing.vin}`}>
                            <ListingInsights vin={listing.vin} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
