import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Wrench, Building2, Calendar, Car, Loader2 } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import {
  canCancel,
  requestDate,
  requestReference,
  serviceCategoryLabel,
  statusPresentation,
} from '@/lib/serviceRequests'

/**
 * My Service Requests (R3).
 *
 * Owner UAT: a request could be submitted successfully and then be findable NOWHERE — not on the
 * dashboard, not in communications, not in service history. A person who cannot see their own
 * request assumes it failed and phones the garage instead, and CarUp loses the interaction it just
 * captured.
 *
 * This reads the canonical Service Cases the owner already owns (`/api/service-cases/mine`). It is
 * not a second request ledger: there is one, and this is a view of it.
 */

type ServiceRequest = {
  id: string
  vin: string
  status: string
  service_category: string | null
  request_summary: string | null
  garage_display_name?: string | null
  garage_slug?: string | null
  requested_at: string | null
  accepted_at: string | null
  declined_at: string | null
  started_at: string | null
  completed_at: string | null
  cancelled_at: string | null
}

const TONE_CLASS: Record<string, string> = {
  waiting: 'bg-amber-500 text-white',
  progress: 'bg-blue-500 text-white',
  done: 'bg-green-500 text-white',
  closed: 'bg-gray-400 text-white',
}

/** The most recent thing that actually happened, so "last update" is a fact and not a guess. */
function lastChange(r: ServiceRequest): string {
  const stamps = [r.cancelled_at, r.completed_at, r.started_at, r.declined_at, r.accepted_at, r.requested_at]
    .filter(Boolean) as string[]
  return stamps.length ? requestDate(stamps[0]) : 'Not recorded'
}

export default function ServiceRequests() {
  const { fetchMyServiceRequests, cancelServiceRequest } = useCarUpApi()
  const [requests, setRequests] = useState<ServiceRequest[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchMyServiceRequests()
      .then((rows) => {
        setRequests((rows || []) as ServiceRequest[])
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [fetchMyServiceRequests])

  useEffect(() => { load() }, [load])

  async function withdraw(id: string) {
    setBusyId(id)
    try {
      await cancelServiceRequest(id)
      load()
    } catch {
      // The list is reloaded either way; a failed withdrawal leaves the request as it was rather
      // than showing an optimistic state the server never accepted.
      load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">My Service Requests</h1>
        <p className="text-gray-500">Requests you have sent to garages on CarUp</p>
      </div>

      {state === 'loading' && (
        <div className="flex items-center gap-3 p-8" role="status" aria-live="polite">
          <Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
          <span className="text-sm text-gray-600">Loading your requests…</span>
        </div>
      )}

      {state === 'error' && (
        <Card className="border-0 card-shadow" data-testid="requests-error">
          <CardContent className="p-6 text-center">
            <p className="font-semibold text-gray-800">Your requests could not be loaded</p>
            <p className="text-sm text-gray-500 mt-1">
              This is a loading problem, not a statement that you have made no requests.
            </p>
            <Button variant="outline" className="mt-4 min-h-11" onClick={() => { setState('loading'); load() }}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {state === 'ready' && requests.length === 0 && (
        <Card className="border-0 card-shadow" data-testid="requests-empty">
          <CardContent className="p-8 text-center">
            <Wrench className="w-7 h-7 text-gray-300 mx-auto mb-3" aria-hidden="true" />
            <p className="font-semibold text-gray-800">You have not requested service yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Find a garage and ask them to look at your vehicle.
            </p>
            <Link to="/garages"><Button className="mt-4 min-h-11 bg-orange-500 hover:bg-orange-600">Browse garages</Button></Link>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {requests.map((r) => {
          const presentation = statusPresentation(r.status)
          return (
            <Card key={r.id} className="border-0 card-shadow" data-testid="service-request-card">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold" data-testid="request-reference">{requestReference(r.id)}</p>
                    <p className="text-sm text-gray-600 mt-0.5">{serviceCategoryLabel(r.service_category)}</p>
                  </div>
                  <Badge className={TONE_CLASS[presentation.tone]} data-testid="request-status">
                    {presentation.label}
                  </Badge>
                </div>

                <p className="text-sm text-gray-700 mt-3" data-testid="request-next">{presentation.next}</p>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-3">
                  <span className="flex items-center gap-1" data-testid="request-garage">
                    <Building2 className="w-3 h-3" aria-hidden="true" />
                    {r.garage_slug && r.garage_display_name
                      ? <Link to={`/garages/${r.garage_slug}`} className="hover:underline">{r.garage_display_name}</Link>
                      : (r.garage_display_name || 'Garage not recorded')}
                  </span>
                  <span className="flex items-center gap-1" data-testid="request-vehicle">
                    <Car className="w-3 h-3" aria-hidden="true" />
                    <Link to={`/dashboard/garage/${r.vin}`} className="hover:underline">{r.vin}</Link>
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" aria-hidden="true" />
                    Requested {requestDate(r.requested_at)}
                  </span>
                  <span data-testid="request-last-change">Last update {lastChange(r)}</span>
                </div>

                {r.request_summary && (
                  <p className="text-sm text-gray-600 mt-3 border-l-2 border-gray-200 pl-3">{r.request_summary}</p>
                )}

                {canCancel(r.status) && (
                  <Button
                    variant="outline" className="mt-4 min-h-11"
                    disabled={busyId === r.id}
                    onClick={() => withdraw(r.id)}
                    data-testid="withdraw-request"
                  >
                    {busyId === r.id ? 'Withdrawing…' : 'Withdraw this request'}
                  </Button>
                )}

                {String(r.status).toLowerCase() === 'completed' && (
                  <Link to="/dashboard/service-history">
                    <Button variant="outline" className="mt-4 min-h-11" data-testid="view-service-history">
                      See what was recorded
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
