import { useEffect, useMemo, useState } from 'react'
import { BarChart3, DollarSign, Eye, FileText, Loader2, MessageSquare, Plus, ShieldCheck, Tag, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { WorkspaceHeader } from '@/components/dashboard/WorkspaceHeader'
import ListingInsights from '@/components/intelligence/ListingInsights'
import { primaryListingImageUrl } from '@/lib/listingMedia'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { SellerInquiriesCard } from '@/components/marketplace/SellerInquiriesCard'
import { PUBLICATION_BADGE } from '@/lib/publicationStatus'
import { describePublicationRefusal } from '@/lib/publicationRefusal'
import { readOwnerTrustClaim, statedPrice } from './ownerStatedValues'
import type { Vehicle } from '@/types'

export function normalizeListingStatus(status?: string | null) {
  return String(status || '').toLowerCase()
}

export function isSoldListingStatus(status?: string | null) {
  return normalizeListingStatus(status) === 'sold'
}

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

function lifecycleLabel(status: string, publication: string | null | undefined) {
  if (status === 'sold') return 'Sold'
  if (publication === 'published') return 'Published'
  if (publication === 'publishable') return 'Ready to publish'
  if (publication === 'draft') return 'Draft'
  return publication ? publication.replace(/_/g, ' ') : 'Listing state not recorded'
}

function primaryAction(listing: Vehicle, publication: string | null | undefined, status: string) {
  if (status === 'sold') {
    return { label: 'Open Vehicle Passport', href: `/dashboard/garage/${encodeURIComponent(listing.vin)}` }
  }
  if (publication === 'published') {
    return { label: 'Manage published listing', href: `/marketplace/${encodeURIComponent(listing.vin)}` }
  }
  if (publication === 'publishable') {
    return { label: 'Review & publish', href: `/dashboard/sell-vehicle?vin=${encodeURIComponent(listing.vin)}` }
  }
  return { label: 'Continue listing', href: `/dashboard/sell-vehicle?vin=${encodeURIComponent(listing.vin)}` }
}

export default function MyListings() {
  const {
    fetchOwnedVehicles,
    updateVehicleStatus,
    fetchCommunicationThreads,
    publishVehicleListing,
    unpublishVehicleListing,
    updateVehiclePrice,
  } = useCarUpApi()
  const [listingStatuses, setListingStatuses] = useState<Record<string, string>>({})
  const [insightsFor, setInsightsFor] = useState<string | null>(null)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [publishingVin, setPublishingVin] = useState<string | null>(null)
  const [publicationStatuses, setPublicationStatuses] = useState<Record<string, string>>({})
  const [myListings, setMyListings] = useState<Vehicle[]>([])
  const [conversations, setConversations] = useState<ListingConversation[]>([])
  const [ownedLoaded, setOwnedLoaded] = useState(false)
  const [editingPriceVin, setEditingPriceVin] = useState<string | null>(null)
  const [priceDraft, setPriceDraft] = useState('')
  const [savingPriceVin, setSavingPriceVin] = useState<string | null>(null)

  const openPriceEditor = (vin: string, current: unknown) => {
    setEditingPriceVin(vin)
    setPriceDraft(typeof current === 'number' && Number.isFinite(current) ? String(current) : '')
  }

  const closePriceEditor = () => {
    setEditingPriceVin(null)
    setPriceDraft('')
  }

  const handlePriceSave = async (vin: string) => {
    if (savingPriceVin) return
    const parsed = Number(priceDraft.trim())
    if (!priceDraft.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      toast.error('Enter a price greater than zero.')
      return
    }
    setSavingPriceVin(vin)
    try {
      const result = await updateVehiclePrice(vin, parsed)
      const persisted = typeof result?.price === 'number' ? result.price : parsed
      setMyListings(prev => prev.map(item => (item.vin === vin ? { ...item, price: persisted } : item)))
      toast.success('Price updated. Buyers will see the new price on your listing.')
      closePriceEditor()
    } catch (e: unknown) {
      toast.error(e instanceof Error && e.message ? e.message : 'Could not update the price. Please try again.')
    } finally {
      setSavingPriceVin(null)
    }
  }

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
        : 'Listing published. Buyers can now find it on Marketplace.')
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
      setMyListings(vehicles || [])
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
      toast.success('Vehicle marked as sold. Active commerce for this listing has ended.')
    } catch {
      toast.error('Could not mark this vehicle as sold. Please try again.')
    } finally {
      setMarkingId(null)
    }
  }

  const marketplaceConversations = useMemo(() => conversations.filter((conversation) =>
    conversation.business_workflow === 'marketplace' || conversation.thread_type === 'marketplace_inquiry'), [conversations])
  const totalUnread = marketplaceConversations.reduce((sum, conversation) => sum + Number(conversation.unread_count || 0), 0)
  const publishedCount = myListings.filter(listing => (publicationStatuses[listing.vin] || listing.publication_status) === 'published').length
  const draftCount = myListings.filter(listing => {
    const publication = publicationStatuses[listing.vin] || listing.publication_status
    return publication === 'draft' || publication === 'publishable'
  }).length

  return (
    <div className="mx-auto max-w-[1440px] space-y-8" data-testid="my-listings-page">
      <WorkspaceHeader
        eyebrow="Seller commerce"
        title="My Listings"
        subtitle="Move each vehicle from draft to public Marketplace without losing its Vehicle Passport, media, evidence or buyer context."
        breadcrumbs={[
          { label: 'Seller home', href: '/dashboard' },
          { label: 'My Listings' },
        ]}
        action={(
          <Button asChild className="min-h-11 rounded-none bg-orange-500 px-5 font-black text-white hover:bg-orange-600">
            <Link to="/dashboard/sell-vehicle"><Plus className="mr-2 h-4 w-4" /> New listing</Link>
          </Button>
        )}
      />

      <section className="grid gap-px overflow-hidden border-y border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-4" aria-label="Listing summary">
        {[
          ['Published', String(publishedCount), 'Public Marketplace inventory'],
          ['Drafts needing action', String(draftCount), 'Draft or ready-to-publish listings'],
          ['Conversation threads', String(marketplaceConversations.length), 'Projected Marketplace conversations'],
          ['Unread', String(totalUnread), 'Unread projected conversation messages'],
        ].map(([label, value, note]) => (
          <div key={label} className="bg-white px-5 py-5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
            <p className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950">{value}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{note}</p>
          </div>
        ))}
      </section>

      <SellerInquiriesCard ownedListings={ownedLoaded ? myListings : undefined} />

      {ownedLoaded && myListings.length === 0 ? (
        <section className="border-y border-slate-200 py-14 text-center">
          <Tag className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] text-slate-950">No Seller listing yet.</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">
            Start with a vehicle in My Garage, a known CarUp Passport or a vehicle that is genuinely new to CarUp.
          </p>
          <Button asChild className="mt-6 min-h-11 rounded-none bg-orange-500 px-6 font-black text-white hover:bg-orange-600">
            <Link to="/sell">Start a Seller journey</Link>
          </Button>
        </section>
      ) : (
        <div className="divide-y divide-slate-200 border-y border-slate-200">
          {myListings.map((listing) => {
            const effectiveStatus = listingStatuses[listing.vin] || listing.status || ''
            const normalizedStatus = normalizeListingStatus(effectiveStatus)
            const trust = readOwnerTrustClaim(listing)
            const isSold = isSoldListingStatus(effectiveStatus)
            const publication = publicationStatuses[listing.vin] || listing.publication_status
            const pubMeta = publication ? PUBLICATION_BADGE[publication] : null
            const action = primaryAction(listing, publication, normalizedStatus)
            const listingConversations = marketplaceConversations.filter((conversation) =>
              String(conversation.marketplace_listing_id || '').toUpperCase() === String(listing.vin || '').toUpperCase())
            const listingUnread = listingConversations.reduce((sum, conversation) => sum + Number(conversation.unread_count || 0), 0)
            const latest = listingConversations[0]?.latest_message?.text

            return (
              <article
                key={listing.vin}
                className={`grid gap-6 py-7 lg:grid-cols-[300px_minmax(0,1fr)] ${isSold ? 'opacity-75' : ''}`}
                data-testid={`my-listing-card-${listing.vin}`}
              >
                <div className="relative min-h-[220px] overflow-hidden bg-slate-100">
                  <ListingImage
                    src={primaryListingImageUrl(listing.listing_media)}
                    alt={[listing.year, listing.make, listing.model].filter(Boolean).join(' ') || 'Vehicle'}
                    className="absolute inset-0 h-full w-full"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-5 pt-16 text-white">
                    <p className="font-mono text-[11px] text-white/70">{listing.vin}</p>
                    <h2 className="mt-1 text-2xl font-black tracking-[-0.04em]">{[listing.year, listing.make, listing.model].filter(Boolean).join(' ')}</h2>
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
                    <div>
                      <div className="flex flex-wrap gap-2">
                        <span className="border border-slate-300 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-700">
                          {formatListingStatus(effectiveStatus)}
                        </span>
                        {pubMeta && (
                          <span data-testid={`publication-badge-${listing.vin}`} className={`px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${pubMeta.className}`}>
                            {pubMeta.label}
                          </span>
                        )}
                      </div>
                      <p className="mt-4 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Lifecycle</p>
                      <p className="mt-1 text-xl font-black text-slate-950">{lifecycleLabel(normalizedStatus, publication)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Asking price</p>
                      <p className="mt-1 text-3xl font-black tracking-[-0.04em] text-slate-950" data-testid={`listing-price-${listing.vin}`}>
                        {statedPrice(listing.price)}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-px bg-slate-200 sm:grid-cols-3">
                    <div className="bg-white py-4 pr-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Views</p>
                      <p className="mt-1 text-sm font-black text-slate-900" data-testid={`listing-views-${listing.vin}`}>
                        {typeof listing.viewCount === 'number' ? listing.viewCount.toLocaleString() : 'Not tracked'}
                      </p>
                    </div>
                    <div className="bg-white p-4" data-testid={`trust-claim-${listing.vin}`}>
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Canonical Trust</p>
                      {trust.score !== null ? (
                        <>
                          <p className="mt-1 text-sm font-black text-slate-900" data-testid={`trust-claim-score-${listing.vin}`}>{trust.score}/100 · {trust.headline}</p>
                          <p className="mt-1 text-[11px] text-slate-500">Evidence basis and confidence live on Passport.</p>
                        </>
                      ) : (
                        <p className="mt-1 text-sm font-black text-slate-600" data-testid={`trust-claim-state-${listing.vin}`}>{trust.headline}</p>
                      )}
                    </div>
                    <div className="bg-white py-4 pl-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Buyer communication</p>
                      <p className="mt-1 text-sm font-black text-slate-900">{listingConversations.length} threads · {listingUnread} unread</p>
                    </div>
                  </div>

                  {latest && (
                    <p className="mt-4 border-l-2 border-orange-400 pl-3 text-xs leading-5 text-slate-600">
                      Latest projected conversation: “{latest}”
                    </p>
                  )}

                  <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-950 pt-5" data-testid={`listing-actions-${listing.vin}`}>
                    <Button asChild className="min-h-11 rounded-none bg-orange-500 px-5 font-black text-white hover:bg-orange-600">
                      <Link to={action.href} data-testid={`listing-primary-action-${listing.vin}`}>{action.label}</Link>
                    </Button>

                    {!isSold && publication === 'published' && (
                      <Button
                        variant="outline"
                        className="min-h-11 rounded-none"
                        data-testid={`publish-toggle-${listing.vin}`}
                        disabled={publishingVin === listing.vin}
                        onClick={() => handlePublishToggle(listing.vin, true)}
                      >
                        {publishingVin === listing.vin ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating…</> : 'Unpublish'}
                      </Button>
                    )}

                    {!isSold && publication !== 'published' && publication && (
                      <Button
                        variant="outline"
                        className="min-h-11 rounded-none"
                        data-testid={`publish-toggle-${listing.vin}`}
                        disabled={publishingVin === listing.vin}
                        onClick={() => handlePublishToggle(listing.vin, false)}
                      >
                        {publishingVin === listing.vin ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking…</> : 'Publish'}
                      </Button>
                    )}

                    <Button variant="outline" className="min-h-11 rounded-none" asChild>
                      <Link to={`/marketplace/${encodeURIComponent(listing.vin)}`}>
                        <Eye className="mr-2 h-4 w-4" /> {publication === 'published' ? 'View on Marketplace' : 'Preview buyer listing'}
                      </Link>
                    </Button>

                    <Button variant="outline" className="min-h-11 rounded-none" asChild>
                      <Link to="/dashboard/communications"><MessageSquare className="mr-2 h-4 w-4" /> Communications</Link>
                    </Button>

                    {!isSold && (
                      <Button
                        variant="ghost"
                        className="min-h-11 rounded-none"
                        data-testid={`change-price-${listing.vin}`}
                        onClick={() => openPriceEditor(listing.vin, listing.price)}
                      >
                        <DollarSign className="mr-2 h-4 w-4" /> Price
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      className="min-h-11 rounded-none"
                      data-testid={`toggle-insights-${listing.vin}`}
                      aria-expanded={insightsFor === listing.vin}
                      onClick={() => setInsightsFor(insightsFor === listing.vin ? null : listing.vin)}
                    >
                      <BarChart3 className="mr-2 h-4 w-4" /> {insightsFor === listing.vin ? 'Hide performance' : 'Performance'}
                    </Button>

                    {!isSold && (
                      <Button
                        variant="ghost"
                        className="min-h-11 rounded-none text-slate-500 hover:text-red-700"
                        data-testid={`mark-sold-${listing.vin}`}
                        disabled={markingId === listing.vin}
                        onClick={() => handleMarkSold(listing.vin, listing.vin)}
                      >
                        {markingId === listing.vin
                          ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating…</>
                          : <><Tag className="mr-2 h-4 w-4" /> Mark sold</>}
                      </Button>
                    )}
                  </div>

                  {editingPriceVin === listing.vin && (
                    <div className="mt-4 border-l-4 border-orange-500 bg-slate-50 p-4" data-testid={`price-editor-${listing.vin}`}>
                      <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-600" htmlFor={`price-input-${listing.vin}`}>
                        New price {listing.currency && <span className="font-semibold normal-case tracking-normal text-slate-500">({listing.currency})</span>}
                      </label>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Input id={`price-input-${listing.vin}`} data-testid={`price-input-${listing.vin}`} type="number" min="1" value={priceDraft} onChange={e => setPriceDraft(e.target.value)} className="h-10 w-44 rounded-none" />
                        <Button className="rounded-none" data-testid={`price-save-${listing.vin}`} disabled={savingPriceVin === listing.vin} onClick={() => handlePriceSave(listing.vin)}>
                          {savingPriceVin === listing.vin ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Saving…</> : 'Save price'}
                        </Button>
                        <Button variant="ghost" className="rounded-none" data-testid={`price-cancel-${listing.vin}`} onClick={closePriceEditor}>Cancel</Button>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">Only the amount changes. Currency, availability and verification are unchanged.</p>
                    </div>
                  )}

                  {insightsFor === listing.vin && (
                    <div className="mt-5 border-t border-slate-200 pt-5" data-testid={`listing-insights-panel-${listing.vin}`}>
                      <ListingInsights vin={listing.vin} />
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      <section className="grid gap-4 border-t border-slate-200 pt-8 md:grid-cols-3" aria-label="Seller operating principles">
        <div><ShieldCheck className="h-5 w-5 text-orange-500" /><p className="mt-2 text-sm font-black text-slate-950">Trust is evidence-led</p><p className="mt-1 text-xs leading-5 text-slate-500">Listing quality and publication readiness never substitute for canonical Trust.</p></div>
        <div><FileText className="h-5 w-5 text-orange-500" /><p className="mt-2 text-sm font-black text-slate-950">Passport persists</p><p className="mt-1 text-xs leading-5 text-slate-500">Selling changes commerce state, not the durable vehicle identity.</p></div>
        <div><TrendingUp className="h-5 w-5 text-orange-500" /><p className="mt-2 text-sm font-black text-slate-950">Performance is measured</p><p className="mt-1 text-xs leading-5 text-slate-500">Untracked metrics stay labelled untracked instead of becoming fake zeroes.</p></div>
      </section>
    </div>
  )
}
