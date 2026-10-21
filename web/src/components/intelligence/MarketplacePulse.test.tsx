/**
 * CARUP-MVP-STAB-01 F-027 — Marketplace Pulse on the Owner Dashboard.
 *
 * Seller rollups are produced only by POST /api/internal/intelligence/rollup and nothing schedules it,
 * so for an owner with vehicles the backend answers `availability: 'unavailable'` with
 * `reason: 'never_computed'` — and a `message` reading "could not be read". The card printed that
 * message, so a capability that is simply not computed yet looked like a fault. The payloads below
 * are the exact envelopes intelligenceProjectionService / intelligenceProjectionRoutes return.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import MarketplacePulse from './MarketplacePulse'

const fetchSellerIntelligence = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchSellerIntelligence }),
}))

const NOT_COMPUTED = "Not available yet — Marketplace insights aren't being calculated for your listings yet."
const BACKEND_UNREADABLE_MESSAGE = 'Intelligence for this period could not be read. These figures are NOT zero.'

/** emptyWindowEnvelope(reason) as getSellerPulse returns it. */
const unavailable = (reason: string) => ({
  ok: true,
  window_days: 7,
  availability: 'unavailable',
  reason,
  calculation_version: 'rollup@2',
  message: BACKEND_UNREADABLE_MESSAGE,
})

beforeEach(() => {
  fetchSellerIntelligence.mockReset()
})

describe('Marketplace Pulse — "not computed yet" is not a fault (F-027)', () => {
  it.each(['never_computed', 'not_computed'])('reason %s: "Not available yet", never "could not be read"', async (reason) => {
    fetchSellerIntelligence.mockResolvedValue(unavailable(reason))
    render(<MarketplacePulse />)

    const message = await screen.findByTestId('marketplace-pulse-message')
    expect(message.textContent).toBe(NOT_COMPUTED)
    const section = screen.getByTestId('marketplace-pulse-unavailable')
    expect(section.getAttribute('data-state')).toBe('not_computed')
    expect(section.textContent).not.toMatch(/could not be (read|loaded)/i)
    // Never a figure, and never a zero.
    expect(section.textContent).not.toMatch(/\d/)
    expect(fetchSellerIntelligence).toHaveBeenCalledWith(7)
  })

  it('a rollup run still in progress is "not available yet", not a failure', async () => {
    fetchSellerIntelligence.mockResolvedValue(unavailable('last_run_running'))
    render(<MarketplacePulse />)

    expect((await screen.findByTestId('marketplace-pulse-message')).textContent).toMatch(/^Not available yet/)
    expect(screen.getByTestId('marketplace-pulse-unavailable').getAttribute('data-state')).toBe('computing')
  })

  it.each(['rollup_unreadable', 'freshness_unreadable', 'last_run_failed', 'intelligence_read_failed', 'something_new'])(
    'a real read failure (%s) is still stated as a failure, never as zeros',
    async (reason) => {
      fetchSellerIntelligence.mockResolvedValue(unavailable(reason))
      render(<MarketplacePulse />)

      const message = await screen.findByTestId('marketplace-pulse-message')
      expect(message.textContent).toMatch(/could not be loaded/i)
      expect(message.textContent).not.toBe(NOT_COMPUTED)
      expect(screen.getByTestId('marketplace-pulse-unavailable').getAttribute('data-state')).toBe('failed')
      expect(screen.queryByTestId('pulse-views-value')).toBeNull()
    },
  )

  it('a request that fails outright is a failure', async () => {
    fetchSellerIntelligence.mockRejectedValue(new Error('backend down'))
    render(<MarketplacePulse />)

    expect((await screen.findByTestId('marketplace-pulse-message')).textContent).toMatch(/could not be loaded/i)
    expect(screen.getByTestId('marketplace-pulse-unavailable').getAttribute('data-state')).toBe('failed')
  })

  it('an owner with no vehicles is told to publish one', async () => {
    fetchSellerIntelligence.mockResolvedValue({
      ok: true,
      window_days: 7,
      availability: 'not_applicable',
      reason: 'no_listings',
      message: 'Publish a vehicle to start receiving Marketplace insights.',
      calculation_version: 'rollup@2',
    })
    render(<MarketplacePulse />)

    expect((await screen.findByTestId('marketplace-pulse-message')).textContent)
      .toBe('Publish a vehicle to start receiving Marketplace insights.')
    expect(screen.getByTestId('marketplace-pulse-unavailable').getAttribute('data-state')).toBe('no_listings')
  })

  it('computed figures are still shown as figures', async () => {
    const value = (n: number) => ({ availability: 'value', value: n, unit: 'count' })
    fetchSellerIntelligence.mockResolvedValue({
      ok: true,
      window_days: 7,
      availability: 'value',
      calculation_version: 'rollup@2',
      as_of: '2026-10-20T04:00:00.000Z',
      metrics: { views: value(12), saves: value(3), shares_confirmed: value(0), inquiries: value(2) },
      coverage: { days_with_data: 7, days_requested: 7 },
    })
    render(<MarketplacePulse />)

    expect((await screen.findByTestId('pulse-views-value')).textContent).toBe('12')
    expect(screen.queryByTestId('marketplace-pulse-unavailable')).toBeNull()
  })
})
