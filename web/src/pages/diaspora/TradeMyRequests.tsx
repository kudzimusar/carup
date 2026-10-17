import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Loader2, Plus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { DiasporaBuyerOrder } from '@/types'

/** The buyer's sourcing requests. Empty state teaches the product rather than reporting "0 rows". */
export default function TradeMyRequests() {
  const { loading: authLoading } = useAuth()
  const { fetchDiasporaBuyerOrders } = useCarUpApi()
  const [orders, setOrders] = useState<DiasporaBuyerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [unreadable, setUnreadable] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setOrders(await fetchDiasporaBuyerOrders())
      setUnreadable(false)
    } catch {
      setOrders([])
      setUnreadable(true)
    } finally {
      setLoading(false)
    }
  }, [fetchDiasporaBuyerOrders])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading) void load() }, [authLoading, load])

  const statusOf = (o: DiasporaBuyerOrder) => {
    if (o.metadata?.rfq?.acceptedQuoteId) return { label: 'Supplier selected', tone: 'border-emerald-400 bg-emerald-50 text-emerald-900' }
    if (!o.metadata?.rfq?.published) return { label: 'Draft', tone: 'border-gray-300 bg-gray-100 text-gray-700' }
    return { label: 'Open for offers', tone: 'border-orange-300 bg-orange-50 text-orange-900' }
  }

  if (authLoading || loading) {
    return <div className="flex min-h-[50vh] items-center justify-center text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] min-w-0 px-4 py-8 sm:px-6 lg:px-10" data-testid="trade-my-requests">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-gray-950 pb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">My requests</h1>
          <p className="mt-1 text-sm text-gray-600">Sourcing requests you have created, and the offers they attracted.</p>
        </div>
        <Button asChild className="bg-orange-500 text-white hover:bg-orange-600">
          <Link to="/diaspora/request-quotes" data-testid="trade-new-request"><Plus className="mr-1.5 h-4 w-4" /> Request quotes</Link>
        </Button>
      </div>

      {unreadable && (
        <Alert className="mt-4 border-amber-200 bg-amber-50" data-testid="trade-requests-unreadable">
          <AlertTriangle className="h-4 w-4 text-amber-700" />
          <AlertDescription>
            Your requests could not be loaded. This is not a report that you have none.
          </AlertDescription>
        </Alert>
      )}

      {!unreadable && orders.length === 0 && (
        <div className="mt-6 border border-dashed border-gray-300 p-8" data-testid="trade-requests-empty">
          <h2 className="text-lg font-bold text-gray-950">You haven&apos;t requested any quotes yet</h2>
          <p className="mt-2 max-w-xl text-sm text-gray-600">
            Tell suppliers what you are looking for — a vehicle, a part, or several items — and
            compare their offers before choosing. You do not need a part number to start.
          </p>
          <Button asChild className="mt-4 bg-orange-500 text-white hover:bg-orange-600">
            <Link to="/diaspora/request-quotes">Request quotes</Link>
          </Button>
        </div>
      )}

      <div className="mt-4 divide-y divide-gray-200">
        {orders.map((o) => {
          const status = statusOf(o)
          const offers = (o.quotes || []).filter((q) => q.status !== 'DRAFT').length
          return (
            <Link
              key={o.id}
              to={`/diaspora/requests/${o.id}`}
              className="flex min-w-0 items-start justify-between gap-4 py-4 transition-colors hover:bg-gray-50"
              data-testid="trade-request-row"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-gray-950">
                  {(o.order_type === 'vehicle'
                    ? [o.requested_make, o.requested_model].filter(Boolean).join(' ')
                    : (o.request_lines as Array<{ item_description?: string }> | undefined)?.[0]?.item_description)
                    || [o.requested_make, o.requested_model].filter(Boolean).join(' ')
                    || `${o.order_type} request`}
                </p>
                <p className="font-mono text-xs text-gray-500">
                  RFQ-{String(o.id).replace(/-/g, '').slice(0, 8).toUpperCase()} · to {[o.destination_city, o.destination_country].filter(Boolean).join(', ')}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${status.tone}`}>{status.label}</span>
                {offers > 0 && <p className="mt-1 text-xs text-gray-600">{offers} offer{offers === 1 ? '' : 's'}</p>}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
