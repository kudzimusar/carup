import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Search, Store, MapPin, AlertTriangle } from 'lucide-react'
import { apiRequest, resolveApiBaseUrl } from '@/lib/apiClient'

type ResearchProfile = {
  seed_dealer_id: string
  slug: string
  name: string
  city: string
  category: string
  source_attribution: string
  reviewed_at: string
  label: string
  claimed: false
  business_verified: false
}
type DirectoryEnvelope = { entries: ResearchProfile[]; total: number | null; page: number; limit: number }
const API = resolveApiBaseUrl(import.meta.env.VITE_API_URL,
  typeof window === 'undefined' ? undefined : window.location.hostname)

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(word => word[0] || '').join('').toUpperCase()
}

/**
 * Only review-approved public research profiles are supplied by the backend. 
 * This never uses mockData, private research rows, verified badges or invented stock.
 */
export default function DealerDirectory() {
  const [search, setSearch] = useState('')
  const [directory, setDirectory] = useState<DirectoryEnvelope | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      setState('loading')
      apiRequest<DirectoryEnvelope>({
        baseUrl: API, path: '/dealership/research?q=' + encodeURIComponent(search.trim()),
      }).then(result => {
        if (!active) return
        setDirectory(result)
        setState('ready')
      }).catch(() => {
        if (!active) return
        setDirectory(null)
        setState('unavailable')
      })
    }, 300)
    return () => { active = false; window.clearTimeout(timer) }
  }, [search])

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px] py-10">
          <h1 className="text-3xl font-bold mb-2">Zimbabwe Dealership Directory</h1>
          <p className="text-gray-600 mb-2 max-w-3xl">
            Discover researched automotive businesses and CarUp-approved dealerships.
            A research listing is not proof of legal ownership, current operation or business verification.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            Profiles become visible only after CarUp independently reviews their public research information.
          </p>
          <label htmlFor="dealer-search" className="block font-medium text-sm mb-2">Search published dealership profiles</label>
          <div className="relative max-w-lg">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
            <Input id="dealer-search" placeholder="Business name..." value={search}
              onChange={e => setSearch(e.target.value)} className="pl-10" maxLength={80} />
          </div>
        </div>
      </div>
      <div className="section-padding mx-auto max-w-[1440px] py-8">
        {state === 'loading' && (
          <p role="status" className="text-gray-600">Loading reviewed dealership profiles…</p>
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
            <p className="mb-5 text-sm text-gray-600" aria-live="polite">
              {directory.total == null ? 'Reviewed public results' : `${directory.total} reviewed public results`}
              {' · '}Research listings are unclaimed and not independently business-verified.
            </p>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {directory.entries.map(dealer => (
                <Card key={dealer.seed_dealer_id} className="border border-gray-200 shadow-sm">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 shrink-0 rounded-xl bg-slate-800 text-white font-bold flex items-center justify-center"
                        aria-hidden="true">{initials(dealer.name)}</div>
                      <div className="min-w-0">
                        <h2 className="font-semibold text-lg leading-snug break-words">{dealer.name}</h2>
                        <span className="text-xs text-gray-500">{dealer.category}</span>
                      </div>
                    </div>
                    <div className="flex gap-2 text-gray-700 text-sm mt-4 items-center">
                      <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>{dealer.city}, Zimbabwe — researched location, not independently confirmed</span>
                    </div>
                    <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded-lg mt-4">
                      {dealer.label}
                    </p>
                    <p className="text-xs text-gray-500 mt-3">Source: {dealer.source_attribution}. Information may be outdated.</p>
                    <div className="mt-5 flex flex-wrap gap-4 text-sm font-semibold">
                      <Link className="text-blue-700 underline underline-offset-4" to={`/dealers/${dealer.slug}`}>
                        View researched profile
                      </Link>
                      <Link className="text-blue-700 underline underline-offset-4" to={`/dealers/${dealer.slug}/claim`}>
                        Claim this dealership
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
