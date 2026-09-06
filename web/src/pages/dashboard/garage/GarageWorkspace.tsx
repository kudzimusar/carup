import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, Inbox, Car, ArrowRight, Users } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import {
  assignedTo,
  caseStatusLabel,
  categoryLabel,
  nextActionLabel,
  STATUS_TONE,
  vehicleLabel,
  whenLabel,
  type QueueCase,
} from '@/lib/garageWorkspace'
import { SN_PAGE } from '@/lib/serviceNetworkLayout'

/**
 * The garage's work, in one place (R5).
 *
 * Owner UAT: a garage tenant-member who signed in landed on the OWNER dashboard — a screen about
 * selling their own car — while `/api/garage/queue` had been returning their real work all along.
 * Accept, decline, job cards, assignment and service records were all certified and none of them
 * had a screen.
 *
 * This is deliberately NOT a garage ERP. It shows the queue the backend already computes, including
 * the `next_action` it derives per case, and hands off to the one case screen where work is done.
 * Every number here is counted by the server from this garage's own cases; nothing is estimated.
 */
export default function GarageWorkspace() {
  const { fetchGarageQueue } = useCarUpApi()
  const { user } = useAuth()
  const [queue, setQueue] = useState<QueueCase[]>([])
  // R6 — a mechanic and a garage manager share this queue and want different things from it. The
  // filter is a VIEW of the same tenant-scoped data, never a different read: switching it asks the
  // server for nothing new and reveals nothing new.
  const [scope, setScope] = useState<'all' | 'mine'>('all')
  const [counts, setCounts] = useState<{ requested: number; accepted: number; active: number } | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(() => {
    fetchGarageQueue()
      .then((res) => {
        setQueue((res?.queue || []) as QueueCase[])
        // Counts come from the server. A failed read leaves them null so the UI can say "unknown"
        // instead of rendering three zeroes that read as "no work today".
        setCounts(res?.counts ?? null)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [fetchGarageQueue])

  useEffect(() => { load() }, [load])

  const visible = scope === 'mine' ? queue.filter((c) => assignedTo(c, user?.id)) : queue

  return (
    <div className={SN_PAGE}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Workshop</h1>
          <p className="text-gray-500">Service requests and jobs for your garage</p>
        </div>
        <Link to="/garage/customers">
          <Button variant="outline" className="min-h-11" data-testid="open-customers">
            <Users className="w-4 h-4 mr-2" aria-hidden="true" /> Customers
          </Button>
        </Link>
      </div>

      {state === 'loading' && (
        <div className="flex items-center gap-3 p-8" role="status" aria-live="polite">
          <Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
          <span className="text-sm text-gray-600">Loading your workshop…</span>
        </div>
      )}

      {state === 'error' && (
        <Card className="border-0 card-shadow" data-testid="queue-error">
          <CardContent className="p-6 text-center">
            <p className="font-semibold text-gray-800">Your queue could not be loaded</p>
            <p className="text-sm text-gray-500 mt-1">
              This is a loading problem, not a statement that you have no work waiting.
            </p>
            <Button variant="outline" className="mt-4 min-h-11" onClick={() => { setState('loading'); load() }}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {state === 'ready' && (
        <>
          <div className="flex gap-2" role="group" aria-label="Which jobs to show" data-testid="queue-scope">
            {([['all', 'All jobs'], ['mine', 'Assigned to me']] as const).map(([value, label]) => (
              <button
                key={value} onClick={() => setScope(value)} aria-pressed={scope === value}
                data-testid={`scope-${value}`}
                className={`min-h-11 px-4 rounded-full border text-sm ${
                  scope === value ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="queue-counts">
            {([
              ['New requests', counts?.requested, 'requested'],
              ['Accepted', counts?.accepted, 'accepted'],
              ['In progress', counts?.active, 'active'],
            ] as const).map(([label, value, key]) => (
              <Card key={key} className="border-0 card-shadow">
                <CardContent className="p-5">
                  <p className="text-sm text-gray-500">{label}</p>
                  <p className="text-2xl font-bold mt-1" data-testid={`count-${key}`}>
                    {value === undefined || value === null ? 'Not available' : value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {visible.length === 0 ? (
            <Card className="border-0 card-shadow" data-testid="queue-empty">
              <CardContent className="p-8 text-center">
                <Inbox className="w-7 h-7 text-gray-300 mx-auto mb-3" aria-hidden="true" />
                {/* An empty "mine" view is a different fact from an empty garage, and telling a
                    mechanic to go publish the garage page would be advice they cannot act on. */}
                {scope === 'mine' ? (
                  <>
                    <p className="font-semibold text-gray-800">Nothing is assigned to you right now</p>
                    <p className="text-sm text-gray-500 mt-1">
                      {queue.length > 0
                        ? 'The garage has open jobs that nobody has been put on yet.'
                        : 'The garage has no open jobs at the moment.'}
                    </p>
                    {queue.length > 0 && (
                      <Button
                        variant="outline" className="mt-4 min-h-11" data-testid="queue-empty-see-all"
                        onClick={() => setScope('all')}
                      >
                        See all jobs
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-gray-800">No open jobs right now</p>
                    <p className="text-sm text-gray-500 mt-1">
                      New service requests from CarUp appear here. Customers find you through your
                      public garage page, so keeping it published is what brings work in.
                    </p>
                    <Link to="/garage/profile">
                      <Button variant="outline" className="mt-4 min-h-11" data-testid="queue-empty-profile">
                        Check my garage page
                      </Button>
                    </Link>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {visible.map((c) => (
                <Link key={c.id} to={`/garage/cases/${c.id}`} className="block" data-testid="queue-case">
                  <Card className="border-0 card-shadow hover:ring-2 hover:ring-orange-200 transition">
                    <CardContent className="p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold flex items-center gap-2" data-testid="queue-vehicle">
                            <Car className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />
                            {vehicleLabel(c.vehicle, c.vin)}
                          </p>
                          <p className="text-sm text-gray-600 mt-0.5" data-testid="queue-category">
                            {categoryLabel(c.service_category)}
                          </p>
                        </div>
                        <Badge className={STATUS_TONE[String(c.status).toLowerCase()]} data-testid="queue-status">
                          {caseStatusLabel(c.status)}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
                        <p className="text-sm text-gray-700" data-testid="queue-next-action">
                          {nextActionLabel(c.next_action)}
                        </p>
                        <span className="text-orange-600 text-sm font-medium flex items-center gap-1">
                          Open <ArrowRight className="w-4 h-4" aria-hidden="true" />
                        </span>
                      </div>

                      <p className="text-xs text-gray-500 mt-2">
                        Requested {whenLabel(c.requested_at)}
                        {c.work_order ? ` · Job card ${c.work_order.status}` : ''}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
