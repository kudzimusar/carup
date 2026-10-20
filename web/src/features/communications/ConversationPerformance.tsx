import type { CommunicationProductAnalytics } from '@/hooks/useCommunicationProductApi'
import { describeFirstResponse } from './firstResponseSummary'

export type AnalyticsReadState = 'loading' | 'ready' | 'unavailable'

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
