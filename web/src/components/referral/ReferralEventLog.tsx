import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw } from 'lucide-react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import type { ReferralEvent } from '@/types/referral'

/**
 * Interim activity panel for admin referral surfaces that have NO dedicated
 * GET-list endpoint yet (codes, coupons, local leads, import routes). It reads the
 * real referral event log via getReferralAdminEvents — never fabricated rows — and
 * clearly labels itself as pending the additive Phase E list endpoints.
 */
export default function ReferralEventLog({
  title = 'Activity (from event log)',
  eventType,
  limit = 25,
}: {
  title?: string
  eventType?: string
  limit?: number
}) {
  const { getReferralAdminEvents } = useCarUpApi()
  const [events, setEvents] = useState<ReferralEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getReferralAdminEvents(eventType ? { event_type: eventType, limit } : { limit })
      setEvents(res.events ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load activity.')
    } finally {
      setLoading(false)
    }
  }, [getReferralAdminEvents, eventType, limit])

  useEffect(() => {
    load()
  }, [load])

  return (
    <Card className="border-0 card-shadow">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold">{title}</h2>
            <p className="text-xs text-amber-600">Dedicated list endpoint pending Phase E — showing recent events from the audit log.</p>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="w-3 h-3 mr-1" />Refresh
          </Button>
        </div>
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-gray-500">{loading ? 'Loading…' : 'No recent events.'}</p>
        ) : (
          <div className="space-y-1 max-h-72 overflow-auto">
            {events.map((ev) => (
              <div key={ev.id} className="flex items-center justify-between text-xs border-b border-gray-50 py-1.5">
                <Badge variant="outline" className="text-[10px] shrink-0">{ev.event_type}</Badge>
                <span className="text-gray-500 truncate mx-2 flex-1">{[ev.subject_type, ev.subject_id].filter(Boolean).join(' ')}</span>
                <span className="text-gray-400 shrink-0">{ev.occurred_at ? new Date(ev.occurred_at).toLocaleString() : ''}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
