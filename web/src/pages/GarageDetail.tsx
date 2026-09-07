import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MapPin, Phone, Wrench, AlertCircle, ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import RequestServiceModal from '@/components/serviceNetwork/RequestServiceModal'
import { resolveApiBaseUrl } from '@/lib/apiClient'
import type { DirectoryGarage } from './GarageDirectory'

/**
 * Garage detail — governed public projection (Service Network S1).
 *
 * Everything rendered here is a fact the garage itself published or that a governed
 * ledger supports. There are no ratings, no opening hours, and no "verified" badge
 * unless a governed verification workflow wrote the dimension. PartSentry participation
 * is derived from the repair ledger at read time; when it cannot be read the page says
 * "not available" rather than rendering zero (Invariant 10 — unknown is not zero).
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

type Branch = {
  name: string
  location_city: string | null
  location_province: string | null
  address_public: string | null
}

type GarageDetailPayload = {
  garage: DirectoryGarage
  branches: Branch[]
  partsentry_participation: { available: boolean; recorded_repairs: number | null }
}

export default function GarageDetail() {
  const { slug } = useParams<{ slug: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [data, setData] = useState<GarageDetailPayload | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'not_found' | 'error'>('loading')
  const [requestOpen, setRequestOpen] = useState(false)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    const controller = new AbortController()
    ;(async () => {
      try {
        const response = await fetch(`${BASE_URL}/garage-directory/${encodeURIComponent(slug)}`, { signal: controller.signal })
        if (response.status === 404) {
          if (!cancelled) { setStatus('not_found'); setData(null) }
          return
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = await response.json()
        if (!cancelled) { setData(body); setStatus('ok') }
      } catch (error) {
        if (!cancelled && (error as Error)?.name !== 'AbortError') { setStatus('error'); setData(null) }
      }
    })()
    return () => { cancelled = true; controller.abort() }
  }, [slug])

  const verifications = Object.entries(data?.garage.verification_dimensions || {})

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="section-padding mx-auto max-w-[1440px] py-6">
        <Link to="/garages" className="text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to directory
        </Link>
      </div>

      <div className="section-padding mx-auto max-w-[1440px] pb-10">
        {status === 'loading' && <p className="text-sm text-gray-500" data-testid="garage-detail-loading">Loading garage…</p>}

        {status === 'not_found' && (
          <Card className="border-0 card-shadow" data-testid="garage-detail-not-found">
            <CardContent className="p-10 text-center">
              <Wrench className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <h1 className="font-semibold text-gray-800">This garage is not published</h1>
              <p className="text-sm text-gray-500 mt-2">It may never have been listed, or it may have unpublished its profile.</p>
            </CardContent>
          </Card>
        )}

        {status === 'error' && (
          <Card className="border-0 card-shadow" data-testid="garage-detail-error">
            <CardContent className="p-10 text-center">
              <AlertCircle className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <h1 className="font-semibold text-gray-800">This garage could not be loaded</h1>
              <p className="text-sm text-gray-500 mt-2">This is a loading problem, not a statement about the garage.</p>
            </CardContent>
          </Card>
        )}

        {status === 'ok' && data && (
          <div className="space-y-6" data-testid="garage-detail">
            {requestOpen && (
              <RequestServiceModal
                garageSlug={String(slug)}
                garageName={data.garage.display_name}
                offeredCategories={data.garage.service_categories}
                onClose={() => setRequestOpen(false)}
              />
            )}
            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <h1 className="text-2xl font-bold text-gray-900">{data.garage.display_name}</h1>
                {(data.garage.location_city || data.garage.location_province) && (
                  <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
                    <MapPin className="w-4 h-4" aria-hidden="true" />
                    {[data.garage.location_city, data.garage.location_province].filter(Boolean).join(', ')}
                  </p>
                )}
                {data.garage.description && <p className="text-gray-700 mt-4">{data.garage.description}</p>}

                {data.garage.contact_policy === 'phone_public' && data.garage.public_phone && (
                  <p className="text-sm text-gray-700 mt-4 flex items-center gap-1.5">
                    <Phone className="w-4 h-4" aria-hidden="true" /> {data.garage.public_phone}
                  </p>
                )}
                {data.garage.contact_policy === 'in_app_only' && (
                  <p className="text-sm text-gray-500 mt-4">This garage takes contact through CarUp only.</p>
                )}

                {/* R1/R4 — the page used to state that contact happens through CarUp and then offer
                    no way to make contact. This is that way: the garage is already known, so the
                    request is addressed to it by slug and carries a vehicle and a category. */}
                <div className="mt-5">
                  <Button
                    className="min-h-11 bg-orange-500 hover:bg-orange-600 w-full sm:w-auto"
                    data-testid="request-service-cta"
                    onClick={() => {
                      if (!user) {
                        // Come back to this exact garage after signing in, so intent is not lost.
                        navigate(`/login?returnTo=${encodeURIComponent(location.pathname)}`)
                        return
                      }
                      setRequestOpen(true)
                    }}
                  >
                    <Wrench className="w-4 h-4 mr-2" aria-hidden="true" />
                    Request service from this garage
                  </Button>
                  {!user && (
                    <p className="text-xs text-gray-500 mt-2" data-testid="request-service-signin-hint">
                      You will be asked to sign in first, then brought straight back here.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <h2 className="font-semibold text-gray-900 mb-3">Services offered</h2>
                {data.garage.service_categories.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {data.garage.service_categories.map(category => (
                      <Badge key={category} variant="secondary">{CATEGORY_LABELS[category] || category}</Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">This garage has not listed its services.</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <h2 className="font-semibold text-gray-900 mb-3">Branches</h2>
                {data.branches.length > 0 ? (
                  <ul className="space-y-3">
                    {data.branches.map(branch => (
                      <li key={branch.name} className="text-sm">
                        <span className="font-medium text-gray-800">{branch.name}</span>
                        {(branch.location_city || branch.location_province) && (
                          <span className="text-gray-500">
                            {' — '}{[branch.location_city, branch.location_province].filter(Boolean).join(', ')}
                          </span>
                        )}
                        {branch.address_public && <div className="text-gray-500">{branch.address_public}</div>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">This garage has not listed any branches.</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-0 card-shadow">
              <CardContent className="p-6">
                <h2 className="font-semibold text-gray-900 mb-3">Verification</h2>
                {verifications.length > 0 ? (
                  <ul className="space-y-1 text-sm text-gray-700">
                    {verifications.map(([dimension, value]) => (
                      <li key={dimension}>{dimension}: {String(value)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500" data-testid="garage-detail-unverified">
                    CarUp has not verified this garage. Nothing here is a CarUp verification claim.
                  </p>
                )}

                <h2 className="font-semibold text-gray-900 mt-6 mb-2">PartSentry</h2>
                <p className="text-sm text-gray-700" data-testid="garage-detail-partsentry">
                  {!data.partsentry_participation.available
                    ? 'PartSentry participation is not available right now.'
                    : data.partsentry_participation.recorded_repairs === 0
                      ? 'This garage has not recorded any PartSentry repairs.'
                      : `${data.partsentry_participation.recorded_repairs} PartSentry repair record(s) logged by this garage.`}
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
