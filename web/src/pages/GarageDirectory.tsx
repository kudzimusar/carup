import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Search, Wrench, MapPin, AlertCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { resolveApiBaseUrl } from '@/lib/apiClient'

/**
 * Garage Directory — governed publication surface (Service Network S1).
 *
 * This page previously listed invented service centres from `mockData.garages` — fabricated names,
 * ratings, opening hours, phone numbers and a green "Verified" check. Those records were removed,
 * and the page now reads the governed registry instead: only garages a garage tenant has explicitly
 * published are returned by /api/garage-directory, and the payload carries no ratings, no opening
 * hours and no verification claim that a governed workflow did not write.
 *
 * The honest empty state is preserved: when nothing is published the page says so plainly rather
 * than showing unverified entries. A load failure is reported as a failure — never as "no garages".
 */
const BASE_URL = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  typeof window !== 'undefined' ? window.location.hostname : undefined,
)

const CATEGORY_LABELS: Record<string, string> = {
  general_service: 'General service',
  engine: 'Engine',
  transmission: 'Transmission',
  brakes: 'Brakes',
  suspension: 'Suspension',
  electrical: 'Electrical',
  diagnostics: 'Diagnostics',
  bodywork: 'Bodywork',
  tyres: 'Tyres',
  air_conditioning: 'Air conditioning',
  exhaust: 'Exhaust',
  other: 'Other',
}

export type DirectoryGarage = {
  slug: string
  display_name: string
  description: string | null
  location_city: string | null
  location_province: string | null
  service_categories: string[]
  contact_policy: string
  public_phone: string | null
  verification_dimensions: Record<string, unknown>
  public_media: unknown[]
  published_at: string | null
}

export default function GarageDirectory() {
  const [search, setSearch] = useState('')
  const [garages, setGarages] = useState<DirectoryGarage[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    ;(async () => {
      try {
        const response = await fetch(`${BASE_URL}/garage-directory`, { signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = await response.json()
        if (!cancelled) {
          setGarages(Array.isArray(body?.garages) ? body.garages : [])
          setLoadFailed(false)
        }
      } catch (error) {
        if (!cancelled && (error as Error)?.name !== 'AbortError') {
          // A failed load is NOT an empty directory — say which one it is.
          setGarages(null)
          setLoadFailed(true)
        }
      }
    })()
    return () => { cancelled = true; controller.abort() }
  }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!garages) return []
    if (!term) return garages
    return garages.filter(g =>
      g.display_name.toLowerCase().includes(term) ||
      (g.location_city || '').toLowerCase().includes(term) ||
      (g.location_province || '').toLowerCase().includes(term),
    )
  }, [garages, search])

  const loading = garages === null && !loadFailed

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b">
        <div className="section-padding mx-auto max-w-[1440px] py-10">
          <h1 className="text-3xl font-bold mb-2">Garage Directory</h1>
          <p className="text-gray-600 mb-6">Garages that have published a profile on CarUp.</p>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search garages by name or location..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10"
              aria-label="Search garages by name or location"
            />
          </div>
        </div>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] py-8">
        {loading && (
          <p className="text-sm text-gray-500" data-testid="garage-directory-loading">Loading garages…</p>
        )}

        {loadFailed && (
          <Card className="border-0 card-shadow" data-testid="garage-directory-error">
            <CardContent className="p-10 text-center">
              <AlertCircle className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <h2 className="font-semibold text-gray-800">The garage directory could not be loaded</h2>
              <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
                This is a loading problem, not an empty directory — we do not know how many garages are
                published right now. Please try again shortly.
              </p>
            </CardContent>
          </Card>
        )}

        {!loading && !loadFailed && filtered.length === 0 && (
          <Card className="border-0 card-shadow" data-testid="garage-directory-empty">
            <CardContent className="p-10 text-center">
              <Wrench className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <h2 className="font-semibold text-gray-800">
                {search.trim() ? 'No garages match your search' : 'No garages listed yet'}
              </h2>
              <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
                {search.trim()
                  ? 'Try a different name, city or province.'
                  : 'A garage appears here once it publishes its own profile. None has been published yet, so this directory is empty rather than showing unverified entries.'}
              </p>
            </CardContent>
          </Card>
        )}

        {!loadFailed && filtered.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="garage-directory-list">
            {filtered.map(garage => (
              <Link key={garage.slug} to={`/garages/${garage.slug}`} className="block focus:outline-none focus:ring-2 focus:ring-offset-2 rounded-lg">
                <Card className="border-0 card-shadow h-full hover:shadow-lg transition-shadow">
                  <CardContent className="p-5">
                    <h2 className="font-semibold text-gray-900">{garage.display_name}</h2>
                    {(garage.location_city || garage.location_province) && (
                      <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                        {[garage.location_city, garage.location_province].filter(Boolean).join(', ')}
                      </p>
                    )}
                    {garage.description && (
                      <p className="text-sm text-gray-600 mt-3 line-clamp-2">{garage.description}</p>
                    )}
                    {garage.service_categories.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {garage.service_categories.slice(0, 4).map(category => (
                          <Badge key={category} variant="secondary" className="text-xs">
                            {CATEGORY_LABELS[category] || category}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
