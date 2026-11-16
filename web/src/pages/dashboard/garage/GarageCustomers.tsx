import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Loader2, Users } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import { whenLabel } from '@/lib/garageWorkspace'
import { SN_PAGE } from '@/lib/serviceNetworkLayout'

/**
 * The garage's customers, counted from its own service cases (R5).
 *
 * `/api/garage/customers` was certified and unreachable. Every figure below is counted by the
 * server from cases this garage owns — nothing is estimated, spend is tracked PER CURRENCY and
 * never summed across currencies, and a customer whose name is not on file is shown as unnamed
 * rather than given an invented one.
 */

type Customer = {
  user_id: string
  display_name: string | null
  vehicle_count: number
  case_count: number
  completed_count: number
  last_service_at: string | null
  spend_by_currency: Record<string, number>
  conversation_thread_id: string | null
}

/** An empty spend map means nothing has been recorded — not that the customer spent zero. */
function spendLabel(spend: Record<string, number>): string {
  const entries = Object.entries(spend || {})
  if (!entries.length) return 'No cost recorded'
  return entries.map(([currency, amount]) => `${currency} ${amount.toLocaleString()}`).join(' · ')
}

export default function GarageCustomers() {
  const { fetchGarageCustomers } = useCarUpApi()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(() => {
    fetchGarageCustomers()
      .then((res) => { setCustomers((res?.customers || []) as Customer[]); setState('ready') })
      .catch(() => setState('error'))
  }, [fetchGarageCustomers])

  useEffect(() => { load() }, [load])

  return (
    <div className={SN_PAGE}>
      <Link to="/garage" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Workshop
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Customers</h1>
        <p className="text-gray-500">People whose cars you have worked on through CarUp</p>
      </div>

      {state === 'loading' && (
        <div className="flex items-center gap-3 p-8" role="status" aria-live="polite">
          <Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
          <span className="text-sm text-gray-600">Loading your customers…</span>
        </div>
      )}

      {state === 'error' && (
        <Card className="border-0 card-shadow" data-testid="customers-error">
          <CardContent className="p-6 text-center">
            <p className="font-semibold text-gray-800">Your customers could not be loaded</p>
            <p className="text-sm text-gray-500 mt-1">
              This is a loading problem, not a statement that you have no customers.
            </p>
            <Button variant="outline" className="mt-4 min-h-11" onClick={() => { setState('loading'); load() }}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {state === 'ready' && customers.length === 0 && (
        <Card className="border-0 card-shadow" data-testid="customers-empty">
          <CardContent className="p-8 text-center">
            <Users className="w-7 h-7 text-gray-300 mx-auto mb-3" aria-hidden="true" />
            <p className="font-semibold text-gray-800">No customers yet</p>
            <p className="text-sm text-gray-500 mt-1">
              A customer appears here once they send you a service request on CarUp.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {customers.map((c) => (
          <Card key={c.user_id} className="border-0 card-shadow" data-testid="customer-row">
            <CardContent className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="font-semibold" data-testid="customer-name">
                  {c.display_name || 'Unnamed customer'}
                </p>
                <p className="text-sm text-gray-600" data-testid="customer-spend">{spendLabel(c.spend_by_currency)}</p>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-2">
                <span>{c.vehicle_count} {c.vehicle_count === 1 ? 'vehicle' : 'vehicles'}</span>
                <span data-testid="customer-jobs">{c.case_count} {c.case_count === 1 ? 'job' : 'jobs'}, {c.completed_count} completed</span>
                <span>Last seen {whenLabel(c.last_service_at)}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
