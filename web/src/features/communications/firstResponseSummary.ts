import type { CommunicationProductAnalytics } from '@/hooks/useCommunicationProductApi'

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
 *
 * Lives in its own module because a module that exports a component may export nothing else (Fast
 * Refresh), the same rule threadLabel.ts documents.
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
