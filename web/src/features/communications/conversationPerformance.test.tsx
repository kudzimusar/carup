import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import type { CommunicationProductAnalytics } from '@/hooks/useCommunicationProductApi'
import { ConversationPerformance } from './ConversationPerformance'

/**
 * OC-NATIVE-FINAL-02-R1 D4 — the Owner was shown "Median first response 0 min" while 35 enquiries had
 * had no reply. The 0 was the median of CarUp's own notification stamps; the unanswered enquiries were
 * not in the population at all, and a failed analytics read was shown as "will appear as conversations
 * accumulate". The card now states only what was measured, with its denominator, and says plainly when
 * nothing could be measured or read.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const page = readFileSync(path.resolve(here, '../../pages/dashboard/owner/Communications.tsx'), 'utf8')

type ResponseTime = NonNullable<CommunicationProductAnalytics['response_time']>

function analyticsWith(responseTime: Partial<ResponseTime> | undefined): CommunicationProductAnalytics {
  return {
    bounded: true,
    row_cap: 1000,
    conversations: { total: 35, active: 35, converted: 0, conversion_rate_pct: 0, by_workflow: {}, by_funnel_stage: {} },
    response_time: responseTime as ResponseTime | undefined,
    events: { total: 0, by_type: {} },
    delivery: { total: 3, successful: 3, failed: 0, suppressed: 0, success_rate_pct: 100, by_channel: {}, by_status: {} },
    attribution: { by_source: {}, by_referral_code: {}, by_campaign_code: {} },
    ai: { derivations: 0, human_reviewed: 0, by_type: {} },
  }
}

const measured = (replied: number, unreplied: number, median: number): Partial<ResponseTime> => ({
  state: 'measured',
  eligible: replied + unreplied,
  replied,
  unreplied,
  measured: replied,
  median_minutes: median,
  average_minutes: median,
  p95_minutes: median,
})

function renderCard(state: 'loading' | 'ready' | 'unavailable', analytics: CommunicationProductAnalytics | null) {
  return render(<ConversationPerformance state={state} analytics={analytics} />)
}

describe('Conversation performance — first response is stated only when measured (OC-NATIVE-FINAL-02-R1 D4)', () => {
  it('while loading, states nothing about responses', () => {
    const { container } = renderCard('loading', null)
    expect(screen.getByTestId('conversation-performance-loading')).toBeTruthy()
    expect(container.textContent).not.toMatch(/\bmin\b/)
  })

  it('a failed analytics read is a failure, not an empty account and not a zero', () => {
    const { container } = renderCard('unavailable', null)
    expect(screen.getByTestId('conversation-performance-unavailable').textContent).toMatch(/could not be loaded/i)
    expect(container.textContent).not.toMatch(/will appear as conversations accumulate/i)
    expect(container.textContent).not.toMatch(/0 min/)
  })

  it('no conversations: Not available, and says why', () => {
    renderCard('ready', analyticsWith({ state: 'no_conversations', eligible: 0, replied: 0, unreplied: 0, measured: 0, median_minutes: null, average_minutes: null, p95_minutes: null }))
    expect(screen.getByTestId('first-response-value').textContent).toBe('Not available')
    expect(screen.getByTestId('first-response-detail').textContent).toMatch(/No customer conversations yet/i)
  })

  it('only unreplied conversations: Not available, with every waiting conversation counted', () => {
    const { container } = renderCard('ready', analyticsWith({ state: 'no_replies', eligible: 32, replied: 0, unreplied: 32, measured: 0, median_minutes: null, average_minutes: null, p95_minutes: null }))
    expect(screen.getByTestId('first-response-value').textContent).toBe('Not available')
    expect(screen.getByTestId('first-response-detail').textContent).toBe('No replies yet · 32 conversations awaiting a first reply')
    expect(container.textContent).not.toMatch(/0 min/)
  })

  it('replied: the measured median with its denominator', () => {
    renderCard('ready', analyticsWith(measured(1, 0, 30)))
    expect(screen.getByTestId('first-response-value').textContent).toBe('30 min')
    expect(screen.getByTestId('first-response-detail').textContent).toBe('Across 1 replied conversation')
  })

  it('mixed: the median of replied conversations, and the unreplied ones are not hidden', () => {
    renderCard('ready', analyticsWith(measured(3, 2, 20)))
    expect(screen.getByTestId('first-response-value').textContent).toBe('20 min')
    expect(screen.getByTestId('first-response-detail').textContent).toBe('Across 3 replied conversations · 2 awaiting a first reply')
  })

  it('a reply within seconds is "Under 1 min", and long waits are stated in hours or days', () => {
    const { unmount } = renderCard('ready', analyticsWith(measured(1, 0, 0.4)))
    expect(screen.getByTestId('first-response-value').textContent).toBe('Under 1 min')
    unmount()
    const second = renderCard('ready', analyticsWith(measured(1, 0, 150)))
    expect(screen.getByTestId('first-response-value').textContent).toBe('2.5 h')
    second.unmount()
    renderCard('ready', analyticsWith(measured(1, 0, 4320)))
    expect(screen.getByTestId('first-response-value').textContent).toBe('3 days')
  })

  it('the backend could not read response times: Not available, never 0', () => {
    renderCard('ready', analyticsWith({ state: 'unavailable', eligible: null, replied: null, unreplied: null, measured: null, median_minutes: null, average_minutes: null, p95_minutes: null }))
    expect(screen.getByTestId('first-response-value').textContent).toBe('Not available')
    expect(screen.getByTestId('first-response-detail').textContent).toMatch(/could not be read/i)
  })

  it('a response without a measurement state (an older backend) is never shown as its 0 median', () => {
    const { container } = renderCard('ready', analyticsWith({ measured: 3, median_minutes: 0, average_minutes: 18105.5, p95_minutes: 54316.3 } as Partial<ResponseTime>))
    expect(screen.getByTestId('first-response-value').textContent).toBe('Not available')
    expect(container.textContent).not.toMatch(/0 min/)
  })

  it('the Communications page renders this card and no longer prints the raw median or the old empty line', () => {
    expect(page).toMatch(/<ConversationPerformance state=\{analyticsState\} analytics=\{analytics\} \/>/)
    expect(page).not.toMatch(/analytics\.response_time\.median_minutes\} min/)
    expect(page).not.toMatch(/Analytics will appear as conversations accumulate/)
  })
})
