import type { CommunicationProductAnalytics } from '@/hooks/useCommunicationProductApi'

export type AnalyticsReadState = 'loading' | 'ready' | 'unavailable'

const conversations = (count: number) => `${count} ${count === 1 ? 'conversation' : 'conversations'}`

function formatMinutes(minutes: number): string {
  if (minutes < 1) return 'Under 1 min'
  if (minutes < 60) return `${Math.round(minutes)} min`
  if (minutes < 1440) return `${Math.round((minutes / 60) * 10) / 10} h`
  const days = Math.round((minutes / 1440) * 10) / 10
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

/**
 * OC-NATIVE-FINAL-02-R1 D4 — the first-response line states a time only when one was measured, and
 * always with its denominator. The Owner was shown "0 min" while 32 enquiry conversations were still
 * waiting: the 0 came from CarUp's own notification stamps. A response without a measurement `state`
 * comes from a backend that still computes that polluted median, so it is not shown at all.
 */
export function describeFirstResponse(
  responseTime: CommunicationProductAnalytics['response_time'],
): { value: string; detail: string } {
  const notAvailable = (detail: string) => ({ value: 'Not available', detail })
  switch (responseTime?.state) {
    case 'measured': {
      const { median_minutes: median, replied, unreplied } = responseTime
      if (typeof median !== 'number' || typeof replied !== 'number' || replied < 1) {
        return notAvailable('Response times could not be read.')
      }
      const waiting = typeof unreplied === 'number' && unreplied > 0 ? ` · ${unreplied} awaiting a first reply` : ''
      return { value: formatMinutes(median), detail: `Across ${replied} replied ${replied === 1 ? 'conversation' : 'conversations'}${waiting}` }
    }
    case 'no_replies':
      return notAvailable(`No replies yet · ${conversations(responseTime.unreplied ?? 0)} awaiting a first reply`)
    case 'no_conversations':
      return notAvailable('No customer conversations yet.')
    case 'unavailable':
      return notAvailable('Response times could not be read.')
    default:
      return notAvailable('Response times were not measured.')
  }
}

export function ConversationPerformance({
  state,
  analytics,
}: {
  state: AnalyticsReadState
  analytics: CommunicationProductAnalytics | null
}) {
  if (state === 'loading') {
    return <p className="text-gray-500" data-testid="conversation-performance-loading">Loading conversation performance…</p>
  }
  if (state === 'unavailable' || !analytics) {
    return (
      <p className="text-gray-500" data-testid="conversation-performance-unavailable">
        Conversation performance could not be loaded. Nothing is shown rather than a guess.
      </p>
    )
  }
  const firstResponse = describeFirstResponse(analytics.response_time)
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-gray-50 p-2"><p className="text-lg font-semibold">{analytics.conversations.total}</p><p className="text-[11px] text-gray-500">Conversations</p></div>
        <div className="rounded-lg bg-gray-50 p-2"><p className="text-lg font-semibold">{analytics.conversations.active}</p><p className="text-[11px] text-gray-500">Active</p></div>
        <div className="rounded-lg bg-gray-50 p-2"><p className="text-lg font-semibold">{analytics.conversations.conversion_rate_pct}%</p><p className="text-[11px] text-gray-500">Conversion</p></div>
        <div className="rounded-lg bg-gray-50 p-2"><p className="text-lg font-semibold">{analytics.delivery.success_rate_pct}%</p><p className="text-[11px] text-gray-500">Delivery success</p></div>
      </div>
      <div data-testid="first-response">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Median first response</span>
          <span data-testid="first-response-value">{firstResponse.value}</span>
        </div>
        <p className="text-[10px] text-gray-400" data-testid="first-response-detail">{firstResponse.detail}</p>
      </div>
      {analytics.marketplace && <div className="flex items-center justify-between text-xs text-gray-500"><span>Marketplace next step</span><span>{analytics.marketplace.inquiry_to_next_step_pct}%</span></div>}
      {analytics.campaigns && <div className="flex items-center justify-between text-xs text-gray-500"><span>Campaign conversions</span><span>{analytics.campaigns.converted}</span></div>}
      <div className="flex items-center justify-between text-xs text-gray-500"><span>AI assists</span><span>{analytics.ai.derivations}</span></div>
      <div className="flex items-center justify-between text-xs text-gray-500"><span>Failed deliveries</span><span>{analytics.delivery.failed}</span></div>
      <p className="text-[10px] text-gray-400">Operational analytics are derived from canonical conversation, attribution and delivery events.</p>
    </>
  )
}
