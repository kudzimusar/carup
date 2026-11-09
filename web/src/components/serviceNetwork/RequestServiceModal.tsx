import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, CheckCircle2, Wrench, X } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { SERVICE_CATEGORIES, requestReference, statusPresentation } from '@/lib/serviceRequests'

/**
 * Request service from ONE known garage (R1).
 *
 * Owner UAT found the only service-request entry point in the product was a generic marketplace
 * inquiry: no garage, no vehicle, no category. It stored `target_provider_tenant_id: NULL` and
 * `listing_id: NULL`, and the S3 bridge refuses to open a Service Case without a target garage —
 * so the request could never reach anyone. The front door did not open into the building.
 *
 * This modal opens from a specific Garage Detail page, so the garage is already known and is sent
 * as its PUBLIC SLUG. The browser never handles a tenant id; the server resolves the slug against
 * the same governed publication check.
 *
 * On success the owner sees a real confirmation with a reference, the garage, the vehicle and what
 * happens next (R2/R3) — a successful request must never vanish.
 */

type Vehicle = { vin: string; make?: string | null; model?: string | null; year?: number | null }

export default function RequestServiceModal({
  garageSlug,
  garageName,
  offeredCategories = [],
  onClose,
}: {
  garageSlug: string
  garageName: string
  offeredCategories?: string[]
  onClose: () => void
}) {
  const { fetchOwnedVehicles, createServiceRequest } = useCarUpApi()

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [vehiclesState, setVehiclesState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [vin, setVin] = useState('')
  const [category, setCategory] = useState('')
  const [summary, setSummary] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ id: string; status: string; vin: string } | null>(null)

  useEffect(() => {
    let mounted = true
    fetchOwnedVehicles()
      .then((rows) => {
        if (!mounted) return
        const list = (rows || []) as Vehicle[]
        setVehicles(list)
        setVehiclesState('ready')
        if (list.length === 1) setVin(list[0].vin)
      })
      .catch(() => { if (mounted) setVehiclesState('error') })
    return () => { mounted = false }
  }, [fetchOwnedVehicles])

  // A garage that published its categories should be asked about those first; "Something else"
  // stays available so a real problem is never forced into the wrong box.
  const categories = offeredCategories.length
    ? SERVICE_CATEGORIES.filter((c) => offeredCategories.includes(c.value) || c.value === 'other')
    : SERVICE_CATEGORIES

  async function submit() {
    if (!vin || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await createServiceRequest({
        garage_slug: garageSlug,
        vin,
        service_category: category || null,
        request_summary: summary.trim() || null,
        source_channel: 'directory',
      })
      const c = result?.case ?? result
      setCreated({ id: String(c?.id ?? ''), status: String(c?.status ?? 'requested'), vin })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your request could not be sent. Nothing was recorded.')
    } finally {
      setSubmitting(false)
    }
  }

  const chosen = vehicles.find((v) => v.vin === vin)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
         role="dialog" aria-modal="true" aria-labelledby="request-service-title">
      <Card className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border-0">
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <h2 id="request-service-title" className="text-lg font-semibold">
              {created ? 'Request sent' : `Request service from ${garageName}`}
            </h2>
            <button onClick={onClose} aria-label="Close" className="p-2 -m-2 text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          {created ? (
            /* R3 — a real confirmation: reference, garage, vehicle, status, what happens next,
               and a route back. */
            <div className="space-y-4" data-testid="request-confirmation">
              <div className="flex items-start gap-3 rounded-lg bg-green-50 p-4">
                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-green-900" data-testid="confirmation-reference">
                    Your reference is {requestReference(created.id)}
                  </p>
                  <p className="text-green-800 mt-1">
                    {garageName} has your request for {chosen ? `${chosen.make ?? ''} ${chosen.model ?? ''}`.trim() || created.vin : created.vin}.
                  </p>
                </div>
              </div>
              <div className="rounded-lg bg-gray-50 p-4 text-sm">
                <p className="font-medium text-gray-900" data-testid="confirmation-status">
                  {statusPresentation(created.status).label}
                </p>
                <p className="text-gray-600 mt-1" data-testid="confirmation-next">
                  {statusPresentation(created.status).next}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to="/dashboard/service-requests" className="flex-1 min-w-[12rem]">
                  <Button className="w-full min-h-11 bg-orange-500 hover:bg-orange-600" data-testid="confirmation-view-requests">
                    View my service requests
                  </Button>
                </Link>
                <Button variant="outline" className="min-h-11" onClick={onClose}>Close</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {vehiclesState === 'error' && (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800" data-testid="vehicles-error">
                  Your vehicles could not be loaded, so a request cannot be prepared right now. This is
                  a loading problem, not a statement that you have no vehicles.
                </p>
              )}

              {vehiclesState === 'ready' && vehicles.length === 0 && (
                <div className="rounded-lg bg-gray-50 p-4 text-sm" data-testid="no-vehicles">
                  <p className="font-medium text-gray-900">You have no vehicle on CarUp yet</p>
                  <p className="text-gray-600 mt-1">
                    A service request is attached to a specific vehicle, so add one first.
                  </p>
                  <Link to="/dashboard/garage"><Button variant="outline" className="mt-3 min-h-11">Go to My Garage</Button></Link>
                </div>
              )}

              {vehiclesState === 'ready' && vehicles.length > 0 && (
                <>
                  <div>
                    <label htmlFor="sr-vehicle" className="block text-sm font-medium mb-1">Which vehicle?</label>
                    <select
                      id="sr-vehicle" value={vin} onChange={(e) => setVin(e.target.value)}
                      data-testid="vehicle-select"
                      className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm"
                    >
                      <option value="">Choose a vehicle</option>
                      {vehicles.map((v) => (
                        <option key={v.vin} value={v.vin}>
                          {[v.year, v.make, v.model].filter(Boolean).join(' ') || v.vin}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="sr-category" className="block text-sm font-medium mb-1">
                      What is it about? <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <select
                      id="sr-category" value={category} onChange={(e) => setCategory(e.target.value)}
                      data-testid="category-select"
                      className="w-full min-h-11 rounded-lg border border-gray-300 px-3 text-sm"
                    >
                      <option value="">Not sure yet</option>
                      {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="sr-summary" className="block text-sm font-medium mb-1">
                      Describe the problem <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <textarea
                      id="sr-summary" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)}
                      data-testid="summary-input"
                      placeholder="For example: brakes grinding at low speed, car is at home and not safe to drive."
                      className="w-full rounded-lg border border-gray-300 p-3 text-sm"
                    />
                  </div>

                  {error && (
                    <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="request-error">
                      {error}
                    </p>
                  )}

                  <Button
                    className="w-full min-h-11 bg-orange-500 hover:bg-orange-600"
                    onClick={submit}
                    disabled={!vin || submitting}
                    data-testid="submit-request"
                  >
                    {submitting
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
                      : <><Wrench className="w-4 h-4 mr-2" /> Send request</>}
                  </Button>
                  <p className="text-xs text-gray-500">
                    {garageName} sees your request in CarUp. Nothing is charged and no work starts until
                    the garage accepts and you agree.
                  </p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
