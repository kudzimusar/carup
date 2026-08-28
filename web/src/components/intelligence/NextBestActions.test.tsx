/**
 * CarUp Intelligence 1.0 — I17 next-best-action surface.
 *
 * The distinction this surface must never lose: "nothing needs doing" and "the
 * check could not run" look identical if you only show recommendations. One is a
 * clean bill of health; the other is an absence of measurement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import NextBestActions from './NextBestActions'

const fetchMyRecommendations = vi.fn()
let hookValue: Record<string, unknown> = { fetchMyRecommendations }

vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => hookValue }))

const fired = {
  rule: 'unanswered_leads',
  label: 'Leads are waiting for a reply',
  explanation: '3 enquiries have had no reply, the oldest for 6 days.',
  action: 'Reply to the waiting enquiries.',
  evidence: { unanswered_leads: 3, oldest_lead_age_days: 6 },
  cooldown_days: 3,
}

beforeEach(() => {
  fetchMyRecommendations.mockReset()
  hookValue = { fetchMyRecommendations }
})

describe('advice can be argued with', () => {
  it('shows the explanation, the action and the evidence behind it', async () => {
    fetchMyRecommendations.mockResolvedValue({ ok: true, availability: 'value', recommendations: [fired], abstentions: [] })
    render(<NextBestActions />)
    expect(await screen.findByTestId('recommendation-unanswered_leads-explanation'))
      .toHaveTextContent('3 enquiries have had no reply')
    expect(screen.getByTestId('recommendation-unanswered_leads-action')).toHaveTextContent(/reply to the waiting/i)
    expect(screen.getByTestId('recommendation-unanswered_leads-evidence'))
      .toHaveTextContent(/3 unanswered leads, 6 days waiting/i)
  })
})

describe('quiet and unmeasured are not the same', () => {
  it('a clean result says so plainly when every check ran', async () => {
    fetchMyRecommendations.mockResolvedValue({
      ok: true, availability: 'value', recommendations: [],
      abstentions: [{ rule: 'unanswered_leads', label: 'Leads are waiting for a reply', abstained: 'below_threshold' }],
    })
    render(<NextBestActions />)
    expect(await screen.findByTestId('next-best-actions-none')).toHaveTextContent(/nothing needs your attention right now\./i)
    expect(screen.queryByTestId('next-best-actions-could-not-run')).toBeNull()
  })

  it('qualifies the clean result when a check could not run', async () => {
    fetchMyRecommendations.mockResolvedValue({
      ok: true, availability: 'value', recommendations: [],
      abstentions: [{
        rule: 'traffic_without_conversion',
        label: 'Views are not turning into enquiries',
        abstained: 'input_unavailable',
        missing_inputs: ['views'],
      }],
    })
    render(<NextBestActions />)
    expect(await screen.findByTestId('next-best-actions-none'))
      .toHaveTextContent(/from the checks that could run/i)
    expect(screen.getByTestId('abstention-traffic_without_conversion')).toHaveTextContent(/needs views, which is not recorded/i)
  })

  it('does not list a rule that merely stayed below its threshold as unrunnable', async () => {
    fetchMyRecommendations.mockResolvedValue({
      ok: true, availability: 'value', recommendations: [],
      abstentions: [{ rule: 'unanswered_leads', label: 'Leads', abstained: 'below_threshold' }],
    })
    render(<NextBestActions />)
    await screen.findByTestId('next-best-actions-none')
    expect(screen.queryByTestId('abstention-unanswered_leads')).toBeNull()
  })

  it('does not list a suppressed rule as unrunnable', async () => {
    fetchMyRecommendations.mockResolvedValue({
      ok: true, availability: 'value', recommendations: [],
      abstentions: [{ rule: 'unanswered_leads', label: 'Leads', abstained: 'suppressed_by_cooldown', cooldown_until: '2026-09-01T00:00:00Z' }],
    })
    render(<NextBestActions />)
    await screen.findByTestId('next-best-actions-none')
    expect(screen.queryByTestId('next-best-actions-could-not-run')).toBeNull()
  })
})

describe('a failed read is never a clean bill of health', () => {
  it('a rejected fetch says so rather than showing nothing to do', async () => {
    fetchMyRecommendations.mockRejectedValue(new Error('down'))
    render(<NextBestActions />)
    expect(await screen.findByTestId('next-best-actions-message'))
      .toHaveTextContent(/not a finding that there is nothing to do/i)
    expect(screen.queryByTestId('next-best-actions-none')).toBeNull()
  })

  it('an unavailable payload carries its own message', async () => {
    fetchMyRecommendations.mockResolvedValue({
      ok: true, availability: 'unavailable',
      message: 'Recommendations could not be produced because the underlying data could not be read. This is not a finding that there is nothing to do.',
      recommendations: [], abstentions: [],
    })
    render(<NextBestActions />)
    expect(await screen.findByTestId('next-best-actions-message')).toHaveTextContent(/could not be read/i)
  })

  it('a hook that never exposes the fetcher reads as unavailable', async () => {
    hookValue = {}
    render(<NextBestActions />)
    expect(await screen.findByTestId('next-best-actions-message')).toBeInTheDocument()
    expect(screen.queryByTestId('next-best-actions-none')).toBeNull()
  })
})
