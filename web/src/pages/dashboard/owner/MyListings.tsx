import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Plus, Eye, DollarSign, TrendingUp, Loader2, Car, MessageSquare, ArrowRight, FileCheck2 } from 'lucide-react'
import { toast } from 'sonner'
import ListingInsights from '@/components/intelligence/ListingInsights'
import { OwnerListingMedia } from '@/components/listing/OwnerListingMedia'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { SellerInquiriesCard } from '@/components/marketplace/SellerInquiriesCard'
import { PUBLICATION_BADGE } from '@/lib/publicationStatus'
import { describePublicationRefusal } from '@/lib/publicationRefusal'
import { readOwnerTrustClaim, statedPrice } from './ownerStatedValues'
import type { Vehicle } from '@/types'
import { SellerWorkspaceHeader } from '@/components/seller/SellerWorkspaceHeader'
import { isUnifiedUiEnabled } from '@/components/shell/unifiedFlag'
import { OwnerPageHeader, OWNER_FOCUS, OWNER_PRIMARY_ACTION, OWNER_SECONDARY_ACTION } from '@/components/owner/OwnerPageHeader'
import { DataState } from '@/components/truth'
import { MoneyDisplay } from '@/components/truth/MoneyDisplay'
import { LISTING_TONE_CLASS, vehicleListingState, type ListingStateKey } from '@/lib/vehicleListingState'

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
    updateVehiclePrice,
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
  const [listingsState, setListingsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [communicationsState, setCommunicationsState] = useState<'loading' | 'ready' | 'error'>('loading')
  // S8 — the seller's own price. `editingPriceVin` is the open editor; `priceDraft` is what they
  // typed, kept as a STRING so an empty box stays empty rather than becoming 0.
  const [editingPriceVin, setEditingPriceVin] = useState<string | null>(null)
  const [priceDraft, setPriceDraft] = useState('')
  const [savingPriceVin, setSavingPriceVin] = useState<string | null>(null)
  // RX04-C — unified presentation only: which listing states the seller is looking at.
  const unified = isUnifiedUiEnabled()
  const [listingFilter, setListingFilter] = useState<'all' | 'working' | 'live' | 'sold'>('all')

  const openPriceEditor = (vin: string, current: unknown) => {
    setEditingPriceVin(vin)
    // Pre-filled from the current price when there is one, and left EMPTY when there is not —
    // seeding '0' would offer the seller a free car as a starting point.
    setPriceDraft(typeof current === 'number' && Number.isFinite(current) ? String(current) : '')
  }

  const closePriceEditor = () => {
    setEditingPriceVin(null)
    setPriceDraft('')
  }

  const handlePriceSave = async (vin: string) => {
    if (savingPriceVin) return
    const parsed = Number(priceDraft.trim())
    // The same rule the route enforces, applied before the request so the seller gets an immediate
    // answer — not instead of the server check, which stays authoritative.
    if (!priceDraft.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      toast.error('Enter a price greater than zero.')
      return
    }
    setSavingPriceVin(vin)
    try {
      const result = await updateVehiclePrice(vin, parsed)
      // The SERVER's price is displayed, never the typed one: echoing the input would show a price
      // that was never stored if the write were refused or adjusted.
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
        : 'Listing published! Buyers can now find it on the marketplace.')
    } catch (e: unknown) {
      toast.error(describePublicationRefusal(e))
    } finally {
      setPublishingVin(null)
    }
  }

  useEffect(() => {
    let mounted = true
    // Both states already INITIALISE to 'loading' and both readers are stable useCallbacks, so this
    // effect runs once per mount; re-asserting 'loading' in the effect body was a redundant
    // cascading render. The 'ready'/'error' transitions below still ride the async boundary.
    Promise.allSettled([
      fetchOwnedVehicles(),
      fetchCommunicationThreads(),
    ]).then(([vehiclesResult, communicationsResult]) => {
      if (!mounted) return
      if (vehiclesResult.status === 'fulfilled') {
        setMyListings(Array.isArray(vehiclesResult.value) ? vehiclesResult.value : [])
        setOwnedLoaded(true)
        setListingsState('ready')
      } else {
        setMyListings([])
        setOwnedLoaded(false)
        setListingsState('error')
      }
      if (communicationsResult.status === 'fulfilled') {
        setConversations((communicationsResult.value.threads || []) as ListingConversation[])
        setCommunicationsState('ready')
      } else {
        setConversations([])
        setCommunicationsState('error')
      }
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

  const publishedCount = myListings.filter((listing) =>
    (publicationStatuses[listing.vin] || listing.publication_status) === 'published').length
  const draftsNeedingAction = myListings.filter((listing) => {
    const publication = publicationStatuses[listing.vin] || listing.publication_status
    const status = listingStatuses[listing.vin] || listing.status
    return publication !== 'published' && !isSoldListingStatus(status)
  }).length
  const trackedViews = myListings
    .map(listing => listing.viewCount)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const rawSaveCounts = myListings
    .map(listing => (listing as Vehicle & { saveCount?: number }).saveCount)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const pricedListings = myListings.filter(listing =>
    typeof listing.price === 'number' && Number.isFinite(listing.price) && Boolean(listing.currency))
  const valueCurrencies = new Set(pricedListings.map(listing => String(listing.currency)))
  const canAggregateValue = myListings.length > 0
    && pricedListings.length === myListings.length
    && valueCurrencies.size === 1
  const listingValue = canAggregateValue
    ? `${[...valueCurrencies][0]} ${pricedListings.reduce((sum, listing) => sum + Number(listing.price), 0).toLocaleString()}`
    : 'Mixed / incomplete'

  if (unified) {
    const rows = myListings.map(listing => {
      const effectiveStatus = listingStatuses[listing.vin] || listing.status || ''
      const publication = publicationStatuses[listing.vin] || listing.publication_status || ''
      const state = vehicleListingState({ vin: listing.vin, status: effectiveStatus, publication_status: publication })
      return { listing, effectiveStatus, publication, state }
    })
    const FILTERS: Array<{ key: typeof listingFilter; label: string; keys: ListingStateKey[] | null }> = [
      { key: 'all', label: 'All', keys: null },
      { key: 'working', label: 'Drafts & review', keys: ['draft', 'ready', 'review', 'not_listed'] },
      { key: 'live', label: 'Live', keys: ['live'] },
      { key: 'sold', label: 'Sold', keys: ['sold'] },
    ]
    const countFor = (keys: ListingStateKey[] | null) => rows.filter(row => !keys || keys.includes(row.state.key)).length
    const activeKeys = FILTERS.find(f => f.key === listingFilter)?.keys ?? null
    const visible = rows.filter(row => !activeKeys || activeKeys.includes(row.state.key))
    const actionBtn = `inline-flex min-h-11 items-center gap-1.5 rounded-full bg-carup-bg-raised px-3.5 text-[13px] font-semibold text-carup-text ring-1 ring-carup-line hover:bg-carup-bg-surface disabled:opacity-60 ${OWNER_FOCUS}`
    return (
      <div className="mx-auto w-full max-w-[1320px] space-y-6" data-testid="my-listings-unified">
        <OwnerPageHeader
          title="My listings"
          description="Every car you are selling, where it stands, and the next step for each — drafts, review, live and sold."
          meta={listingsState === 'ready'
            ? `${countFor(['live'])} live · ${countFor(['draft', 'ready', 'review', 'not_listed'])} in progress · ${countFor(['sold'])} sold`
            : undefined}
          actions={<Link to="/sell" className={OWNER_PRIMARY_ACTION}><Plus className="h-4 w-4" aria-hidden="true" /> Sell another car</Link>}
          testId="my-listings-header"
        />

        {listingsState === 'loading' && <DataState state="loading" subject="your listings" />}
        {listingsState === 'error' && (
          <div role="alert" className="rounded-card border border-status-warning bg-status-warning-soft p-5">
            <p className="font-semibold text-carup-text">Listings could not be read.</p>
            <p className="mt-1 text-sm text-carup-text-2">CarUp has not converted that failure into zero listings or zero buyer activity.</p>
          </div>
        )}

        {listingsState === 'ready' && (
          <section className="rounded-card bg-carup-bg-raised p-4 ring-1 ring-carup-line sm:p-5" data-testid="seller-listing-kpis" aria-label="Listing summary">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div><dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">Live</dt><dd className="mt-1 text-2xl font-bold tracking-[-0.02em] text-carup-text">{publishedCount}</dd></div>
              <div><dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">Need action</dt><dd className="mt-1 text-2xl font-bold tracking-[-0.02em] text-carup-text">{draftsNeedingAction}</dd></div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">Buyer conversations</dt>
                <dd className="mt-1 text-2xl font-bold tracking-[-0.02em] text-carup-text">{communicationsState === 'ready' ? marketplaceConversations.length : '—'}</dd>
                <dd className="text-[12px] text-carup-text-3">{communicationsState === 'ready' ? `${totalUnread} unread` : 'Could not be read'}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">Asking total</dt>
                <dd className="mt-1 text-base font-semibold text-carup-text">{listingValue}</dd>
                <dd className="text-[12px] text-carup-text-3">{canAggregateValue ? 'One recorded currency' : 'Not added across currencies or gaps'}</dd>
              </div>
            </dl>
            <p className="mt-4 border-t border-carup-line pt-3 text-[12px] text-carup-text-3">
              {trackedViews.length || rawSaveCounts.length
                ? `Views reported for ${trackedViews.length} listing${trackedViews.length === 1 ? '' : 's'}, saves for ${rawSaveCounts.length}.`
                : 'Listing views and saves are not measured yet, so none are shown.'}
            </p>
          </section>
        )}

        {listingsState === 'ready' && myListings.length === 0 && (
          <section className="overflow-hidden rounded-card bg-carup-raw-ink p-6 text-white sm:p-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">My listings</p>
            <h2 className="mt-2 text-xl font-bold tracking-[-0.02em] sm:text-2xl">You are not selling a car yet</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/75">Choose a car from your Garage or start with a VIN. A draft stays private until its publication requirements are met and you choose to publish.</p>
            <Link to="/sell" className={`${OWNER_PRIMARY_ACTION} mt-5`}>Start selling <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </section>
        )}

        {listingsState === 'ready' && myListings.length > 0 && (
          <>
            <div role="tablist" aria-label="Filter listings" className="flex gap-2 overflow-x-auto pb-1" data-testid="my-listings-filters">
              {FILTERS.map(filter => (
                <button
                  key={filter.key}
                  type="button"
                  role="tab"
                  aria-selected={listingFilter === filter.key}
                  onClick={() => setListingFilter(filter.key)}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold ring-1 transition ${OWNER_FOCUS} ${listingFilter === filter.key ? 'bg-carup-text text-carup-bg-raised ring-carup-text' : 'bg-carup-bg-raised text-carup-text-2 ring-carup-line hover:text-carup-text'}`}
                  data-testid={`my-listings-filter-${filter.key}`}
                >
                  {filter.label} <span className="tabular-nums opacity-70">{countFor(filter.keys)}</span>
                </button>
              ))}
            </div>

            {visible.length === 0 && (
              <p className="rounded-card bg-carup-bg-raised p-5 text-sm text-carup-text-2 ring-1 ring-carup-line">No listings in this view.</p>
            )}

            <ul className="space-y-4">
              {visible.map(({ listing, effectiveStatus, publication, state }) => {
                const name = [listing.year, listing.make, listing.model].filter(Boolean).join(' ') || 'Vehicle identity incomplete'
                const publicationMeta = publication ? PUBLICATION_BADGE[publication] : null
                const trust = readOwnerTrustClaim(listing)
                const isSold = state.key === 'sold'
                const isPublished = publication === 'published'
                const listingConversations = marketplaceConversations.filter(conversation =>
                  String(conversation.marketplace_listing_id || '').toUpperCase() === String(listing.vin || '').toUpperCase())
                const listingUnread = listingConversations.reduce((sum, conversation) => sum + Number(conversation.unread_count || 0), 0)
                const latest = listingConversations[0]?.latest_message?.text
                const dominant = isSold
                  ? { label: 'View Vehicle Passport', href: `/dashboard/garage/${encodeURIComponent(listing.vin)}` }
                  : isPublished
                    ? { label: 'View on Marketplace', href: `/marketplace/${encodeURIComponent(listing.vin)}` }
                    : { label: state.key === 'ready' ? 'Review & publish' : 'Continue listing', href: `/dashboard/sell-vehicle?vin=${encodeURIComponent(listing.vin)}` }
                return (
                  <li key={listing.vin}>
                    <article className={`overflow-hidden rounded-card bg-carup-bg-raised ring-1 ring-carup-line md:grid md:grid-cols-[280px_minmax(0,1fr)] ${isSold ? 'opacity-80' : ''}`} data-testid={`my-listing-card-${listing.vin}`}>
                      <Link to={`/dashboard/garage/${encodeURIComponent(listing.vin)}`} className={`relative block aspect-[16/10] bg-carup-bg-surface md:aspect-auto md:min-h-[220px] ${OWNER_FOCUS}`} aria-label={`${name} — open Vehicle Passport`}>
                        <OwnerListingMedia media={listing.listing_media} alt={name} className="absolute inset-0 h-full w-full" imgClassName="h-full w-full" />
                      </Link>
                      <div className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${LISTING_TONE_CLASS[state.tone]}`} data-testid={`publication-badge-${listing.vin}`}>
                            {publicationMeta ? publicationMeta.label : isSold ? 'Sold' : 'Publication state not recorded'}
                          </span>
                          <span className="text-[12px] text-carup-text-3">Availability: {formatListingStatus(effectiveStatus)}</span>
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <h2 className="text-lg font-semibold tracking-[-0.01em] text-carup-text sm:text-xl">{name}</h2>
                            <p className="mt-0.5 truncate font-mono text-[12px] text-carup-text-3">VIN {listing.vin}</p>
                            <div className="mt-2" data-testid={`listing-price-${listing.vin}`}>
                              {typeof listing.price === 'number' && Number.isFinite(listing.price)
                                ? <MoneyDisplay amount={listing.price} currency={listing.currency ?? null} source="asking" />
                                : <span className="text-sm text-carup-text-2">{statedPrice(listing.price)}</span>}
                            </div>
                          </div>
                          <Link to={dominant.href} className={`${OWNER_PRIMARY_ACTION} shrink-0`} data-testid={`listing-primary-${listing.vin}`}>
                            {dominant.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                          </Link>
                        </div>

                        <dl className="grid gap-x-4 gap-y-2 border-t border-carup-line pt-3 text-[13px] sm:grid-cols-3">
                          <div data-testid={`trust-claim-${listing.vin}`}>
                            <dt className="text-carup-text-3">CarUp Trust</dt>
                            {trust.score !== null
                              ? <dd className="font-semibold text-carup-text" data-testid={`trust-claim-score-${listing.vin}`}>{trust.score} / 100 · {trust.headline}</dd>
                              : <dd className="text-carup-text-2" data-testid={`trust-claim-state-${listing.vin}`}>{trust.headline}</dd>}
                          </div>
                          <div>
                            <dt className="text-carup-text-3">Buyer activity</dt>
                            <dd className="text-carup-text-2">{communicationsState === 'ready' ? `${listingConversations.length} conversations · ${listingUnread} unread` : 'Could not be read'}</dd>
                          </div>
                          <div data-testid={`listing-views-${listing.vin}`}>
                            <dt className="text-carup-text-3">Views</dt>
                            <dd className="text-carup-text-2">{typeof listing.viewCount === 'number' ? `${listing.viewCount} views` : 'Not measured'}</dd>
                          </div>
                        </dl>
                        {latest && <p className="line-clamp-2 rounded-control bg-carup-bg-surface px-3 py-2 text-[13px] leading-5 text-carup-text-2">Latest buyer message: “{latest}”</p>}

                        <div className="flex flex-wrap gap-2 border-t border-carup-line pt-3" data-testid={`listing-actions-${listing.vin}`}>
                          <Link to={isPublished ? `/marketplace/${encodeURIComponent(listing.vin)}` : `/marketplace/${encodeURIComponent(listing.vin)}?mode=seller_preview`} className={actionBtn}>
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" /> {isPublished ? 'Public page' : 'Buyer preview'}
                          </Link>
                          <Link to={`/dashboard/garage/${encodeURIComponent(listing.vin)}`} className={actionBtn}>
                            <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" /> Evidence &amp; Trust
                          </Link>
                          {!isSold && !isPublished && (
                            <Link to={`/dashboard/sell-vehicle?vin=${encodeURIComponent(listing.vin)}&stage=review`} className={actionBtn} data-testid={`publication-readiness-${listing.vin}`}>
                              <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" /> Publication readiness
                            </Link>
                          )}
                          <Link to="/dashboard/communications" className={actionBtn}>
                            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" /> Conversations
                          </Link>
                          {!isSold && (
                            <button type="button" className={actionBtn} data-testid={`change-price-${listing.vin}`} onClick={() => openPriceEditor(listing.vin, listing.price)}>
                              <DollarSign className="h-3.5 w-3.5" aria-hidden="true" /> Change price
                            </button>
                          )}
                          {!isSold && publication && (
                            <button type="button" className={actionBtn} data-testid={`publish-toggle-${listing.vin}`} disabled={publishingVin === listing.vin} onClick={() => handlePublishToggle(listing.vin, isPublished)}>
                              {publishingVin === listing.vin ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Updating…</> : (isPublished ? 'Unpublish' : 'Publish to Marketplace')}
                            </button>
                          )}
                          {!isSold && (
                            <button type="button" className={actionBtn} data-testid={`mark-sold-${listing.vin}`} disabled={markingId === listing.vin} onClick={() => handleMarkSold(listing.vin, listing.vin)}>
                              {markingId === listing.vin ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Updating…</> : 'Mark sold'}
                            </button>
                          )}
                          <button type="button" className={actionBtn} data-testid={`toggle-insights-${listing.vin}`} aria-expanded={insightsFor === listing.vin} onClick={() => setInsightsFor(insightsFor === listing.vin ? null : listing.vin)}>
                            <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> {insightsFor === listing.vin ? 'Hide performance' : 'Performance'}
                          </button>
                        </div>

                        {editingPriceVin === listing.vin && (
                          <div className="rounded-control border border-carup-line-strong bg-carup-bg-surface p-4" data-testid={`price-editor-${listing.vin}`}>
                            <label className="text-[13px] font-semibold text-carup-text" htmlFor={`price-input-${listing.vin}`}>
                              New asking price{listing.currency && <span className="ml-1 font-normal text-carup-text-2">({listing.currency})</span>}
                            </label>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Input id={`price-input-${listing.vin}`} data-testid={`price-input-${listing.vin}`} type="number" min="1" inputMode="decimal" value={priceDraft} onChange={e => setPriceDraft(e.target.value)} className="h-11 w-44" />
                              <button type="button" className={OWNER_PRIMARY_ACTION} data-testid={`price-save-${listing.vin}`} disabled={savingPriceVin === listing.vin} onClick={() => handlePriceSave(listing.vin)}>
                                {savingPriceVin === listing.vin ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Saving…</> : 'Save price'}
                              </button>
                              <button type="button" className={OWNER_SECONDARY_ACTION} data-testid={`price-cancel-${listing.vin}`} onClick={closePriceEditor}>Cancel</button>
                            </div>
                            <p className="mt-2 text-[12px] leading-5 text-carup-text-3">Only the recorded amount changes. Currency, availability, Trust and verification stay separate.</p>
                          </div>
                        )}

                        {insightsFor === listing.vin && (
                          <div data-testid={`listing-insights-panel-${listing.vin}`}><ListingInsights vin={listing.vin} /></div>
                        )}

                        {(state.key === 'draft' || state.key === 'ready' || state.key === 'review' || state.key === 'not_listed') && (
                          <details className="group text-[13px]" data-testid={`listing-remove-unavailable-${listing.vin}`}>
                            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 font-semibold text-carup-text-2 hover:text-carup-text">
                              Don’t want to sell this car any more?
                            </summary>
                            <p className="max-w-2xl leading-5 text-carup-text-2">
                              A draft is part of the car’s Vehicle Passport, and CarUp does not yet have an action to withdraw a draft listing, so it cannot be removed here. It stays private: buyers never see a draft. You can stop working on it at any time.
                            </p>
                          </details>
                        )}
                        {isSold && <p className="text-[13px] text-carup-text-2">Sale completed. The Vehicle Passport remains even though active Marketplace commerce has ended.</p>}
                      </div>
                    </article>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        <section aria-labelledby="my-listings-enquiries">
          <h2 id="my-listings-enquiries" className="mb-3 text-[17px] font-semibold tracking-[-0.01em] text-carup-text">Buyer enquiries</h2>
          <SellerInquiriesCard ownedListings={ownedLoaded ? myListings : undefined} />
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-9">
      <SellerWorkspaceHeader
        eyebrow="Commerce workspace"
        title="My Listings"
        description="Operate the commercial lifecycle around the same Vehicle Passport: continue drafts, publish deliberately, respond to buyers and retire sold stock without creating a parallel vehicle record."
        statusLabel={listingsState === 'loading'
          ? 'Loading governed listing state'
          : listingsState === 'error'
            ? 'Listing read unavailable'
            : communicationsState === 'error'
              ? `${myListings.length} vehicle listings · conversation read unavailable`
              : `${myListings.length} vehicle listings · ${marketplaceConversations.length} conversations · ${totalUnread} unread`}
        primaryAction={(
          <Button className="min-h-11 rounded-none bg-orange-600 font-black hover:bg-orange-700" asChild>
            <Link to="/sell"><Plus className="mr-2 h-4 w-4" /> Sell another vehicle</Link>
          </Button>
        )}
      />

      {listingsState === 'ready' && (
        <section className="grid gap-px border-y border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-6" data-testid="seller-listing-kpis">
          {[
            ['Published', String(publishedCount), 'Public Marketplace listings'],
            ['Need action', String(draftsNeedingAction), 'Unpublished active drafts'],
            ['Buyer inquiries', communicationsState === 'ready' ? String(marketplaceConversations.length) : 'Unavailable', communicationsState === 'ready' ? `${totalUnread} unread` : 'Conversation read failed'],
            ['Tracked views', trackedViews.length ? String(trackedViews.reduce((a, b) => a + b, 0)) : 'Not tracked', trackedViews.length ? `${trackedViews.length} listing${trackedViews.length === 1 ? '' : 's'} reporting` : 'No view measurement exposed'],
            ['Tracked saves', rawSaveCounts.length ? String(rawSaveCounts.reduce((a, b) => a + b, 0)) : 'Not tracked', rawSaveCounts.length ? `${rawSaveCounts.length} listing${rawSaveCounts.length === 1 ? '' : 's'} reporting` : 'No save measurement exposed'],
            ['Listing value', listingValue, canAggregateValue ? 'One recorded currency' : 'Not aggregated across currencies/gaps'],
          ].map(([label, value, detail]) => (
            <div key={label} className="bg-white px-4 py-5">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
              <p className="mt-2 break-words text-2xl font-black tracking-[-0.04em] text-slate-950">{value}</p>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">{detail}</p>
            </div>
          ))}
        </section>
      )}

      <SellerInquiriesCard ownedListings={ownedLoaded ? myListings : undefined} />

      {listingsState === 'loading' && (
        <div className="border-y border-slate-200 py-14 text-sm text-slate-500" role="status">
          Loading your Seller commerce workspace…
        </div>
      )}

      {listingsState === 'error' && (
        <div className="border-y border-amber-200 bg-amber-50 px-5 py-9" role="alert">
          <p className="font-black text-slate-950">Listings could not be read.</p>
          <p className="mt-1 text-sm text-slate-600">CarUp has not converted that failure into zero listings or zero buyer activity.</p>
        </div>
      )}

      {listingsState === 'ready' && myListings.length === 0 && (
        <section className="grid gap-6 border-y border-slate-200 py-12 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <Car className="h-9 w-9 text-slate-300" />
            <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] text-slate-950">No Seller listing thread yet.</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Choose a vehicle already in your Garage or add one new to CarUp. A draft remains private until publication blockers clear and you explicitly publish it.
            </p>
          </div>
          <Button asChild className="min-h-12 rounded-none bg-orange-600 font-black hover:bg-orange-700">
            <Link to="/sell">Start Seller journey <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </section>
      )}

      {listingsState === 'ready' && myListings.length > 0 && (
        <section className="divide-y divide-slate-200 border-y border-slate-200">
          {myListings.map((listing, index) => {
            const effectiveStatus = listingStatuses[listing.vin] || listing.status || ''
            const normalizedStatus = normalizeListingStatus(effectiveStatus)
            const publication = publicationStatuses[listing.vin] || listing.publication_status || ''
            const publicationMeta = publication ? PUBLICATION_BADGE[publication] : null
            const trust = readOwnerTrustClaim(listing)
            const isSold = isSoldListingStatus(effectiveStatus)
            const isPublished = publication === 'published'
            const listingConversations = marketplaceConversations.filter((conversation) =>
              String(conversation.marketplace_listing_id || '').toUpperCase() === String(listing.vin || '').toUpperCase())
            const listingUnread = listingConversations.reduce((sum, conversation) => sum + Number(conversation.unread_count || 0), 0)
            const latest = listingConversations[0]?.latest_message?.text
            const dominant = isSold
              ? { label: 'View Vehicle Passport', href: `/dashboard/garage/${encodeURIComponent(listing.vin)}` }
              : isPublished
                ? { label: 'View on Marketplace', href: `/marketplace/${encodeURIComponent(listing.vin)}` }
                : { label: 'Continue listing', href: `/dashboard/sell-vehicle?vin=${encodeURIComponent(listing.vin)}` }

            return (
              <article
                key={listing.vin}
                className={`grid gap-0 py-8 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-9 ${isSold ? 'opacity-75' : ''}`}
                data-testid={`my-listing-card-${listing.vin}`}
              >
                <div className="relative min-h-[230px] overflow-hidden bg-slate-100">
                  <OwnerListingMedia
                    media={listing.listing_media}
                    alt={`${listing.year || ''} ${listing.make || ''} ${listing.model || ''}`.trim() || 'Vehicle listing media'}
                    className="absolute inset-0 h-full w-full"
                    imgClassName="h-full w-full"
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 to-transparent px-5 pb-5 pt-16 text-white">
                    <p className="font-mono text-[11px]">{listing.vin}</p>
                    <p className="mt-1 text-xs text-slate-200">Vehicle Passport commerce thread</p>
                  </div>
                </div>

                <div className="min-w-0 py-5 lg:py-1">
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                        Listing {String(index + 1).padStart(2, '0')}
                      </p>
                      <h2 className="mt-2 text-3xl font-black tracking-[-0.045em] text-slate-950">
                        {[listing.year, listing.make, listing.model].filter(Boolean).join(' ') || 'Vehicle identity incomplete'}
                      </h2>
                      <p className="mt-2 text-xl font-black text-orange-600" data-testid={`listing-price-${listing.vin}`}>
                        {statedPrice(listing.price)}
                      </p>
                    </div>
                    <Button asChild className="min-h-11 rounded-none bg-slate-950 px-6 font-black hover:bg-orange-600">
                      <Link to={dominant.href} data-testid={`listing-primary-${listing.vin}`}>
                        {dominant.label} <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Badge className={`rounded-none text-xs font-bold ${STATUS_BADGE[normalizedStatus] || 'bg-slate-100 text-slate-700'}`}>
                      Availability: {formatListingStatus(effectiveStatus)}
                    </Badge>
                    {publicationMeta ? (
                      <Badge data-testid={`publication-badge-${listing.vin}`} className={`rounded-none text-xs font-bold ${publicationMeta.className}`}>
                        Publication: {publicationMeta.label}
                      </Badge>
                    ) : (
                      <Badge data-testid={`publication-badge-${listing.vin}`} className="rounded-none bg-slate-100 text-xs font-bold text-slate-700">
                        Publication state not recorded
                      </Badge>
                    )}
                  </div>

                  <div className="mt-6 grid gap-px bg-slate-200 sm:grid-cols-3">
                    <div className="bg-white px-4 py-4" data-testid={`listing-views-${listing.vin}`}>
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Views</p>
                      <p className="mt-2 text-sm font-bold text-slate-800">
                        {typeof listing.viewCount === 'number' ? `${listing.viewCount} views` : 'Views not tracked'}
                      </p>
                    </div>
                    <div className="bg-white px-4 py-4" data-testid={`trust-claim-${listing.vin}`}>
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Canonical Trust</p>
                      {trust.score !== null ? (
                        <p className="mt-2 text-sm font-bold text-slate-800" data-testid={`trust-claim-score-${listing.vin}`}>
                          {trust.score} / 100 · {trust.headline}
                        </p>
                      ) : (
                        <p className="mt-2 text-sm font-bold text-slate-500" data-testid={`trust-claim-state-${listing.vin}`}>
                          {trust.headline}
                        </p>
                      )}
                    </div>
                    <div className="bg-white px-4 py-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Buyer activity</p>
                      <p className="mt-2 text-sm font-bold text-slate-800">
                        {communicationsState === 'ready'
                          ? `${listingConversations.length} conversations · ${listingUnread} unread`
                          : 'Conversation state unavailable'}
                      </p>
                    </div>
                  </div>

                  <p className="mt-4 text-xs text-slate-500">Listing date not recorded</p>
                  {latest && <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">Latest buyer message: “{latest}”</p>}

                  <div className="mt-6 border-t border-slate-200 pt-5">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Manage this listing</p>
                    <div className="flex flex-wrap gap-2 mt-3" data-testid={`listing-actions-${listing.vin}`}>
                      <Button size="sm" variant="outline" className="min-h-10 rounded-none text-xs font-bold" asChild>
                        <Link to={isPublished
                          ? `/marketplace/${encodeURIComponent(listing.vin)}`
                          : `/marketplace/${encodeURIComponent(listing.vin)}?mode=seller_preview`}>
                          <Eye className="mr-1.5 h-3.5 w-3.5" /> {isPublished ? 'Public detail' : 'Buyer Preview'}
                        </Link>
                      </Button>
                      <Button size="sm" variant="outline" className="min-h-10 rounded-none text-xs font-bold" asChild>
                        <Link to={`/dashboard/garage/${encodeURIComponent(listing.vin)}`}>
                          <FileCheck2 className="mr-1.5 h-3.5 w-3.5" /> Evidence &amp; Trust
                        </Link>
                      </Button>
                      {!isSold && !isPublished && (
                        <Button size="sm" variant="outline" className="min-h-10 rounded-none text-xs font-bold" asChild>
                          <Link to={`/dashboard/sell-vehicle?vin=${encodeURIComponent(listing.vin)}&stage=review`} data-testid={`publication-readiness-${listing.vin}`}>
                            <FileCheck2 className="mr-1.5 h-3.5 w-3.5" /> Publication readiness
                          </Link>
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="min-h-10 rounded-none text-xs font-bold" asChild>
                        <Link to="/dashboard/communications">
                          <MessageSquare className="mr-1.5 h-3.5 w-3.5" /> Conversations
                        </Link>
                      </Button>
                      {!isSold && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-10 rounded-none text-xs font-bold"
                          data-testid={`change-price-${listing.vin}`}
                          onClick={() => openPriceEditor(listing.vin, listing.price)}
                        >
                          <DollarSign className="mr-1 h-3.5 w-3.5" /> Change price
                        </Button>
                      )}
                      {!isSold && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-10 rounded-none text-xs font-bold"
                          data-testid={`mark-sold-${listing.vin}`}
                          disabled={markingId === listing.vin}
                          onClick={() => handleMarkSold(listing.vin, listing.vin)}
                        >
                          {markingId === listing.vin
                            ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Updating…</>
                            : 'Mark sold'}
                        </Button>
                      )}
                      {!isSold && publication && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-10 rounded-none text-xs font-bold"
                          data-testid={`publish-toggle-${listing.vin}`}
                          disabled={publishingVin === listing.vin}
                          onClick={() => handlePublishToggle(listing.vin, isPublished)}
                        >
                          {publishingVin === listing.vin
                            ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Updating…</>
                            : (isPublished ? 'Unpublish' : 'Publish to Marketplace')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-10 rounded-none px-2 text-xs font-bold"
                        data-testid={`toggle-insights-${listing.vin}`}
                        aria-expanded={insightsFor === listing.vin}
                        onClick={() => setInsightsFor(insightsFor === listing.vin ? null : listing.vin)}
                      >
                        <TrendingUp className="mr-1.5 h-3.5 w-3.5" />
                        {insightsFor === listing.vin ? 'Hide performance' : 'Performance'}
                      </Button>
                    </div>

                    {insightsFor === listing.vin && (
                      <div className="mt-4" data-testid={`listing-insights-panel-${listing.vin}`}>
                        <ListingInsights vin={listing.vin} />
                      </div>
                    )}

                    {editingPriceVin === listing.vin && (
                      <div className="mt-4 border-l-2 border-orange-500 bg-slate-50 p-4" data-testid={`price-editor-${listing.vin}`}>
                        <label className="text-xs font-bold text-slate-700" htmlFor={`price-input-${listing.vin}`}>
                          New price
                          {listing.currency && <span className="ml-1 font-normal text-slate-500">({listing.currency})</span>}
                        </label>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Input
                            id={`price-input-${listing.vin}`}
                            data-testid={`price-input-${listing.vin}`}
                            type="number"
                            min="1"
                            value={priceDraft}
                            onChange={e => setPriceDraft(e.target.value)}
                            className="h-10 w-44 rounded-none text-sm"
                          />
                          <Button
                            size="sm"
                            className="min-h-10 rounded-none text-xs font-bold"
                            data-testid={`price-save-${listing.vin}`}
                            disabled={savingPriceVin === listing.vin}
                            onClick={() => handlePriceSave(listing.vin)}
                          >
                            {savingPriceVin === listing.vin
                              ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Saving…</>
                              : 'Save price'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="min-h-10 rounded-none text-xs"
                            data-testid={`price-cancel-${listing.vin}`}
                            onClick={closePriceEditor}
                          >
                            Cancel
                          </Button>
                        </div>
                        <p className="mt-2 text-[11px] leading-4 text-slate-500">
                          Only the recorded amount changes. Currency, availability, Trust and verification remain separate.
                        </p>
                      </div>
                    )}

                    {isSold && (
                      <p className="mt-4 text-xs font-bold text-slate-500">
                        Sale completed. The Vehicle Passport remains durable even though active Marketplace commerce has ended.
                      </p>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      )}
    </div>
  )
}
