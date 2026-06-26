import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, BarChart2 } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'

/**
 * Referral Analytics (/admin/referrals/analytics)
 * Computed from real referral_attribution_journeys, touches, trade_events, wallet_transactions.
 * No hardcoded values.
 */

type Analytics = {
  visits: number
  leads: number
  qualified_leads: number
  conversions: number
  conversion_rate: string
  pending_reward_cost: number
  paid_reward_cost: number
  local_market_events: number
  import_events: number
  container_bookings: number
  channel_performance: Record<string, number>
  fraud_checks: number
}

export default function Analytics() {
  const { getReferralAnalytics } = useCarUpApi()
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getReferralAnalytics()
      setData(res.analytics ?? null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [getReferralAnalytics])

  useEffect(() => { load() }, [load])

  const stat = (label: string, value: string | number, sub?: string) => (
    <Card key={label}>
      <CardContent className="p-4">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart2 className="h-6 w-6" /> Referral Analytics
        </h1>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>
      <p className="text-xs text-gray-400">Computed from live referral events, journeys, wallet transactions. No sample data.</p>

      {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</p>}

      {!data && !loading && <p className="text-sm text-gray-500">No data yet. Run referral flows to see analytics.</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stat('Visits / Touches', data.visits)}
            {stat('Leads (Journeys)', data.leads)}
            {stat('Qualified Leads', data.qualified_leads)}
            {stat('Conversions', data.conversions, `Rate: ${data.conversion_rate}`)}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {stat('Pending Reward Cost', `$${data.pending_reward_cost.toLocaleString()}`)}
            {stat('Paid Reward Cost', `$${data.paid_reward_cost.toLocaleString()}`)}
            {stat('Fraud Checks', data.fraud_checks)}
          </div>

          <div className="grid grid-cols-3 gap-4">
            {stat('Local Market Events', data.local_market_events)}
            {stat('Import Events', data.import_events)}
            {stat('Container Bookings', data.container_bookings)}
          </div>

          {Object.keys(data.channel_performance).length > 0 && (
            <Card>
              <CardContent className="p-5">
                <p className="font-medium mb-3">Channel Performance</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.channel_performance).map(([ch, count]) => (
                    <div key={ch} className="flex items-center gap-1">
                      <Badge className="bg-blue-100 text-blue-700">{ch}</Badge>
                      <span className="text-sm font-semibold">{count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}