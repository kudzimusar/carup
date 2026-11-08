import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, Store, MapPin, AlertTriangle } from 'lucide-react'
import { apiRequest, resolveApiBaseUrl } from '@/lib/apiClient'

type ResearchTier =
  | 'PRELISTED_UNCLAIMED'
  | 'CLAIMED_PUBLIC_DISPLAY_UNAPPROVED'
  | 'FULL_DEALER_APPROVED'

type ResearchProfile = {
  seed_dealer_id: string
  slug: string
  name: string
  city: string
  category: string
  source_attribution: string
  reviewed_at: string
  label: string
  claimed: boolean
  business_verified: boolean
  tier?: ResearchTier
  approved_branches?: Array<{ branch_id: string; name: string; address: string }>
  dealer_declared_sections?: Record<string, Record<string, string>>
}

type DirectoryEnvelope = {
  entries: ResearchProfile[]
  total: number | null
  page: number
  limit: number
  available_categories?: string[]
  available_tiers?: ResearchTier[]
  real_104_records_published_claim?: false
}

const DEFAULT_CATEGORIES = [
  'Vehicle sales (research category)',
  'Vehicle imports (research category)',
  'Vehicle sales and services (research category)',
  'Commercial vehicles (research category)',
  'Automotive marketplace (research category)',
  'Automotive assembly (research category)',
  'Compliance-approved dealership (no OEM affiliation implied)',
]

const TIER_LABELS: Record<ResearchTier, string> = {
  PRELISTED_UNCLAIMED: 'Prelisted research — Unclaimed & not business-verified',
  CLAIMED_PUBLIC_DISPLAY_UNAPPROVED: 'Existing approved claim — Full display not current',
  FULL_DEALER_APPROVED: 'Independently reviewed legal dealership storefront',
}

const API = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window === 'undefined' ? undefined : window.location.hostname,
)

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] || '')
    .join('')
    .toUpperCase()
}

/**
 * Only review-approved public research profiles are supplied by the backend.
 * This never uses mockData, private research rows, verified badges or invented stock.
 */
export default function DealerDirectory() {
  const [search, setSearch] = useState('')
  const [city, setCity] = useState('')
  const [category, setCategory] = useState('')
  const [tier, setTier] = useState<'' | ResearchTier>('')
  const [page, setPage] = useState(1)
  const [directory, setDirectory] = useState<DirectoryEnvelope | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      setState('loading')
      const params = new URLSearchParams()
      if (search.trim()) params.set('q', search.trim())
      if (city.trim()) params.set('city', city.trim())
      if (category.trim()) params.set('category', category.trim())
      if (tier) params.set('tier', tier)
      params.set('page', String(page))
      apiRequest<DirectoryEnvelope>({
        baseUrl: API,
        path: '/dealership/research?' + params.toString(),
      })
        .then((result) => {
          if (!active) return
          setDirectory(result)
          setState('ready')
        })
        .catch(() => {
          if (!active) return
          setDirectory(null)
          setState('unavailable')
        })
    }, 300)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [search, city, category, tier, page])

  const hasFilters = Boolean(search.trim() || city.trim() || category || tier)
  const categories = directory?.available_categories?.length
    ? directory.available_categories
    : DEFAULT_CATEGORIES

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px] py-10">
          <h1 className="text-3xl font-bold mb-2">Zimbabwe Dealership Directory</h1>
          <p className="text-gray-600 mb-2 max-w-3xl">
            Discover researched automotive businesses and CarUp-approved dealerships.
            A research listing is not proof of legal ownership, current operation or business verification.
          </p>
          <p className="text-sm text-gray-500 mb-4">
            Profiles become visible only after CarUp independently reviews their public research information.
            Private research candidates remain withheld until individually reviewed.
          </p>
          {/* Owner UAT: S24 is deferred — a business with no research listing is told plainly. */}
          <p className="text-sm text-gray-600 mb-4 max-w-3xl" data-testid="dealer-unavailable-new-business">
            Your dealership is not listed, or operates outside Zimbabwe? Applying as a new business without a
            CarUp research listing is not available yet.
          </p>
          <Link
            className="inline-flex text-sm font-medium text-blue-800 underline mb-6"
            to="/dealers/feedback"
          >
            Transaction-linked buyer complaints and private feedback
          </Link>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-4 max-w-5xl">
            <div>
              <label htmlFor="dealer-city-filter" className="block font-medium text-sm mb-2">
                Filter by researched or independently reviewed city
              </label>
              <Input
                id="dealer-city-filter"
                placeholder="e.g. Harare"
                value={city}
                onChange={(e) => {
                  setCity(e.target.value)
                  setPage(1)
                }}
                maxLength={80}
              />
            </div>

            <div>
              <label htmlFor="dealer-search" className="block font-medium text-sm mb-2">
                Search published dealership profiles
              </label>
              <div className="relative">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                  aria-hidden="true"
                />
                <Input
                  id="dealer-search"
                  placeholder="Business name..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setPage(1)
                  }}
                  className="pl-10"
                  maxLength={80}
                />
              </div>
            </div>

            <div>
              <label htmlFor="dealer-category-filter" className="block font-medium text-sm mb-2">
                Filter by research or storefront category
              </label>
              <select
                id="dealer-category-filter"
                data-testid="dealer-category-filter"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value)
                  setPage(1)
                }}
                className="w-full h-10 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
              >
                <option value="">All reviewed categories</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="dealer-tier-filter" className="block font-medium text-sm mb-2">
                Filter by verification tier
              </label>
              <select
                id="dealer-tier-filter"
                data-testid="dealer-tier-filter"
                value={tier}
                onChange={(e) => {
                  setTier(e.target.value as '' | ResearchTier)
                  setPage(1)
                }}
                className="w-full h-10 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
              >
                <option value="">All verification tiers</option>
                {(Object.keys(TIER_LABELS) as ResearchTier[]).map((key) => (
                  <option key={key} value={key}>
                    {TIER_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {hasFilters && (
            <div className="mt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="dealer-directory-clear-filters"
                onClick={() => {
                  setSearch('')
                  setCity('')
                  setCategory('')
                  setTier('')
                  setPage(1)
                }}
              >
                Clear directory filters
              </Button>
            </div>
          )}
        </div>
      </div>
      <div className="section-padding mx-auto max-w-[1440px] py-8">
        {state === 'loading' && (
          <p role="status" className="text-gray-600">
            Loading reviewed dealership profiles…
          </p>
        )}
        {state === 'unavailable' && (
          <Card className="border-0 card-shadow">
            <CardContent className="p-8" role="alert">
              <AlertTriangle className="w-6 h-6 mb-3 text-amber-600" aria-hidden="true" />
              The governed directory could not be loaded. Availability is not evidence that no dealers exist.
            </CardContent>
          </Card>
        )}
        {state === 'ready' && directory?.entries.length === 0 && (
          <Card className="border-0 card-shadow" data-testid="dealer-directory-empty">
            <CardContent className="p-10 text-center">
              <Store className="w-8 h-8 text-gray-400 mx-auto mb-3" aria-hidden="true" />
              <h2 className="font-semibold text-gray-800">No reviewed profiles match this search</h2>
              <p className="text-sm text-gray-500 mt-2">
                Research records are never listed publicly before a safe publication review.
                New dealerships may still begin the existing onboarding process.
              </p>
            </CardContent>
          </Card>
        )}
        {state === 'ready' && directory && directory.entries.length > 0 && (
          <>
            <p
              className="mb-5 text-sm text-gray-600"
              aria-live="polite"
              data-testid="dealer-directory-count"
            >
              {directory.total == null
                ? 'Reviewed public results'
                : `${directory.total} reviewed public result${directory.total === 1 ? '' : 's'}`}
              {' · '}Unclaimed research entries, existing claims without current public approval, and independently approved storefronts are distinguished.
            </p>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {directory.entries.map((dealer) => (
                <Card
                  key={dealer.seed_dealer_id}
                  className="border border-gray-200 shadow-sm"
                  data-testid={`dealer-directory-card-${dealer.seed_dealer_id}`}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div
                        className="w-12 h-12 shrink-0 rounded-xl bg-slate-800 text-white font-bold flex items-center justify-center"
                        aria-hidden="true"
                      >
                        {initials(dealer.name)}
                      </div>
                      <div className="min-w-0">
                        <h2 className="font-semibold text-lg leading-snug break-words">{dealer.name}</h2>
                        <span className="text-xs text-gray-600">{dealer.category}</span>
                        {dealer.business_verified && (
                          <span className="block mt-2 text-xs font-semibold text-blue-800">
                            Independently reviewed business and current operating authorization
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 text-gray-700 text-sm mt-4 items-center">
                      <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>
                        {dealer.city}, Zimbabwe —{' '}
                        {dealer.business_verified
                          ? 'public branch review completed'
                          : 'research city, not independently confirmed'}
                      </span>
                    </div>
                    <p
                      className={
                        'text-sm border p-3 rounded-lg mt-4 ' +
                        (dealer.business_verified
                          ? 'text-blue-900 bg-blue-50 border-blue-200'
                          : 'text-amber-800 bg-amber-50 border-amber-200')
                      }
                    >
                      {dealer.label}
                    </p>
                    <p className="text-xs text-gray-600 mt-3">
                      Source: {dealer.source_attribution}. Information may be outdated.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-4 text-sm font-semibold">
                      <Link
                        className="text-blue-700 underline underline-offset-4"
                        to={`/dealers/${dealer.slug}`}
                      >
                        View researched profile
                      </Link>
                      {!dealer.claimed && (
                        <Link
                          className="text-blue-700 underline underline-offset-4"
                          to={`/dealers/${dealer.slug}/claim`}
                        >
                          Claim this dealership
                        </Link>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            {directory.total !== null && directory.total > directory.limit && (
              <nav
                aria-label="Dealership directory pages"
                className="flex justify-between items-center mt-8 max-w-md"
              >
                <button
                  type="button"
                  className="text-sm underline text-blue-700 disabled:text-gray-500"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous page
                </button>
                <span className="text-sm text-gray-600">
                  Page {directory.page} of {Math.ceil(directory.total / directory.limit)}
                </span>
                <button
                  type="button"
                  className="text-sm underline text-blue-700 disabled:text-gray-500"
                  disabled={page >= Math.ceil(directory.total / directory.limit)}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next page
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </main>
  )
}
