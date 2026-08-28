/**
 * CarUp Intelligence 1.0 — I7 listing insights.
 *
 * The invariants under test are the ones a seller could be misled by:
 * completeness must never read as Trust, an unmeasured figure must never read as
 * zero, a withheld trust score must never appear, the score must publish what it
 * could not assess, and a lost-opportunity line must talk about matching rather
 * than about lost sales.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ListingInsights from './ListingInsights'

const fetchListingIntelligence = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchListingIntelligence }),
}))

const value = (n: number, unit = 'count') => ({ availability: 'value', value: n, unit })

const fullPayload = {
  ok: true,
  availability: 'value',
  calculation_version: 'rollup@1',
  as_of: '2026-08-27T04:00:00.000Z',
  window_days: 7,
  metrics: {
    impressions: value(120),
    unique_reach: { availability: 'value', value: 44, unit: 'count', basis: 'peak_day' },
    views: value(60),
    unique_viewers: { availability: 'value', value: 38, unit: 'count', basis: 'peak_day' },
    engaged_views: value(14),
    saves: value(9),
    inquiries: value(4),
  },
  conversion: {
    impression_to_view: value(50, 'percent'),
    view_to_save: value(15, 'percent'),
    view_to_inquiry: { availability: 'insufficient_data', value: null, reason: 'denominator_below_20', unit: 'percent' },
  },
  coverage: { days_with_data: 5, days_requested: 7 },
  completeness: {
    calculation_version: 'completeness@LC1',
    percent: 74,
    earned_points: 13,
    total_points: 18,
    groups: [
      { key: 'pricing', label: 'Asking price', weight: 2, earned: 2, complete: true, missing_fields: [], guidance: null },
      {
        key: 'selling_location', label: 'Selling location', weight: 2, earned: 0, complete: false,
        missing_fields: ['listing_city', 'listing_country'], guidance: 'Add where the vehicle is being sold.',
      },
    ],
    not_measurable: [
      { key: 'description', label: 'Listing description', reason: 'no_description_field', detail: 'CarUp does not currently store a listing description, so description completeness cannot be measured.' },
    ],
    displayed_separately: {
      trust: { state: 'not_evaluated', band: null, score: null },
      transaction_readiness: { safe_pay_ready: false, inspection_ready: false, publication_status: 'published' },
    },
  },
  lost_opportunity: {
    calculation_version: 'lost_opportunity@LO1',
    total_missed_searches: 42,
    dimensions: [{
      filter: 'condition', missing_field: 'vehicle_condition_category', missed_searches: 42,
      message: 'Your listing could not be confidently matched to condition searches because the vehicle condition is missing.',
    }],
    not_yet_measurable: [{ filter: 'location', reason: 'location_is_not_a_search_filter', detail: 'not a filter yet' }],
    searches_considered: 130,
  },
  next_best_actions: [
    {
      priority: 'high', basis: 'observed_missed_searches', action: 'add_vehicle_condition_category',
      evidence: { missed_searches: 42 },
      message: 'Your listing could not be confidently matched to condition searches because the vehicle condition is missing.',
    },
    {
      priority: 'medium', basis: 'listing_completeness', action: 'complete_selling_location',
      evidence: { missing_fields: ['listing_city'], points_available: 2 },
      message: 'Add where the vehicle is being sold.',
    },
  ],
}

beforeEach(() => {
  fetchListingIntelligence.mockReset()
})

describe('performance', () => {
  it('renders the discovery funnel from measured values', async () => {
    fetchListingIntelligence.mockResolvedValue(fullPayload)
    render(<ListingInsights vin="VIN1" />)
    expect(await screen.findByTestId('funnel-views-value')).toHaveTextContent('60')
    expect(screen.getByTestId('funnel-impressions-value')).toHaveTextContent('120')
    expect(screen.getByTestId('funnel-saves-value')).toHaveTextContent('9')
  })

  it('qualifies a peak-day unique instead of implying a window total', async () => {
    fetchListingIntelligence.mockResolvedValue(fullPayload)
    render(<ListingInsights vin="VIN1" />)
    const block = await screen.findByTestId('funnel-unique_viewers')
    expect(block).toHaveTextContent('38')
    expect(block).toHaveTextContent(/busiest day/i)
  })

  it('withholds a conversion rate below the reporting floor', async () => {
    fetchListingIntelligence.mockResolvedValue(fullPayload)
    render(<ListingInsights vin="VIN1" />)
    const rate = await screen.findByTestId('conversion-view_to_inquiry-value')
    expect(rate).toHaveTextContent('Not enough activity yet')
    expect(rate).not.toHaveTextContent('0%')
  })

  it('states partial coverage, so a gap is not mistaken for a quiet week', async () => {
    fetchListingIntelligence.mockResolvedValue(fullPayload)
    render(<ListingInsights vin="VIN1" />)
    expect(await screen.findByTestId('insights-coverage')).toHaveTextContent('Measured on 5 of the last 7 days.')
  })

  it('shows when the figures were computed', async () => {
    fetchListingIntelligence.mockResolvedValue(fullPayload)
    render(<ListingInsights vin="VIN1" />)
    expect(await screen.findByTestId('insights-as-of')).toHaveTextContent(/As of/)
  })
})

describe('an unreadable read never becomes zero', () => {
  it('reports performance as unavailable rather than an empty funnel', async () => {
    fetchListingIntelligence.mockResolvedValue({
      ok: true, availability: 'unavailable', reason: 'never_computed',
      message: 'Intelligence for this period could not be read. These figures are NOT zero.',
    })
    render(<ListingInsights vin="VIN1" />)
    const message = await screen.findByTestId('listing-performance-unavailable')
    expect(message).toHaveTextContent(/NOT zero/)
    expect(screen.queryByTestId('listing-funnel')).not.toBeInTheDocument()
  })

  it('says so when the request fails outright', async () => {
    fetchListingIntelligence.mockRejectedValue(new Error('backend down'))
    render(<ListingInsights vin="VIN1" />)
    expect(await screen.findByTestId('listing-insights-message')).toHaveTextContent(/NOT zero/)
  })

  it('still shows guidance when only PERFORMANCE is unreadable', async () => {
    // Completeness needs no rollup, so a rollup outage must not hide the advice
    // a seller can act on today.
    fetchListingIntelligence.mockResolvedValue({
      ok: true, availability: 'unavailable', reason: 'never_computed',
      completeness: fullPayload.completeness,
      next_best_actions: fullPayload.next_best_actions,
    })
    render(<ListingInsights vin="VIN1" />)
    expect(await screen.findByTestId('listing-completeness')).toBeInTheDocument()
    expect(screen.getByTestId('listing-performance-unavailable')).toBeInTheDocument()
  })

  it('does not crash the surface when the API is unavailable to this render', async () => {
    render(<ListingInsights vin="" />)
    expect(await screen.findByTestId('listing-insights-unavailable')).toBeInTheDocument()
  })
})

describe('completeness is not Trust', () => {
  it('says so in words, next to the score', async () => {
    fetchListingIntelligence.mockResolvedValue(fullPayload)
    render(<ListingInsights vin="VIN1" />)
    expect(await screen.findByTestId('completeness-percent')).toHaveTextContent('74%')
    expect(screen.getByTestId('completeness-not-trust')).toHaveTextContent(/not a Trust score/i)
  })

  it('renders trust in a SEPARATE block, never inside the score', async () => {
    fetchListingIntelligence.mockResolvedValue(fullPayload)
    render(<ListingInsights vin="VIN1" />)
    const completenessBlock = await screen.findByTestId('listing-completeness')
    const trustBlock = screen.getByTestId('listing-trust-separate')
    expect(completenessBlock).toContainElement(trustBlock)
    // The score itself is unaffected by the trust state.
    expect(screen.getByTestId('completeness-percent')).toHaveTextContent('74%')
  })

  it('keeps not_evaluated as words and shows no number', async () => {
    fetchListingIntelligence.mockResolvedValue(fullPayload)
    render(<ListingInsights vin="VIN1" />)
    const trust = await screen.findByTestId('listing-trust-state')
    expect(trust).toHaveTextContent('Not evaluated')
    expect(trust.textContent).not.toMatch(/\d/)
  })

  it('never displays a score the backend withheld', async () => {
    fetchListingIntelligence.mockResolvedValue({
      ...fullPayload,
      completeness: {
        ...fullPayload.completeness,
        displayed_separately: {
          ...fullPayload.completeness.displayed_separately,
          trust: { state: 'stale', band: 'high', score: 88 },
        },
      },
    })
    render(<ListingInsights vin="VIN1" />)
    const trust = await screen.findByTestId('listing-trust-state')
    expect(trust.textContent).not.toMatch(/88/)
    expect(trust).toHaveTextContent(/out of date/i)
  })

  it('publishes what it could NOT assess, so 100% never means everything', async () => {
    fetchListingIntelligence.mockResolvedValue(fullPayload)
    render(<ListingInsights vin="VIN1" />)
    const notAssessed = await screen.findByTestId('completeness-not-measurable')
    expect(notAssessed).toHaveTextContent(/does not currently store a listing description/i)
  })

  it('explains each incomplete group instead of showing a bare percentage', async () => {
    fetchListingIntelligence.mockResolvedValue(fullPayload)
    render(<ListingInsights vin="VIN1" />)
    const group = await screen.findByTestId('completeness-group-selling_location')
    expect(group).toHaveTextContent('Selling location')
    expect(group).toHaveTextContent('Add where the vehicle is being sold.')
  })
})

describe('lost opportunity and next best action', () => {
  it('phrases the loss as a matching statement, not a lost sale', async () => {
    fetchListingIntelligence.mockResolvedValue(fullPayload)
    render(<ListingInsights vin="VIN1" />)
    const line = await screen.findByTestId('lost-condition')
    expect(line).toHaveTextContent(/could not be confidently matched/i)
    expect(line.textContent).not.toMatch(/lost sale|would have sold|missed buyers/i)
  })

  it('shows the observed count behind the claim', async () => {
    fetchListingIntelligence.mockResolvedValue(fullPayload)
    render(<ListingInsights vin="VIN1" />)
    expect(await screen.findByTestId('lost-condition')).toHaveTextContent('42 searches')
  })

  it('marks an evidence-based action as observed', async () => {
    fetchListingIntelligence.mockResolvedValue(fullPayload)
    render(<ListingInsights vin="VIN1" />)
    const action = await screen.findByTestId('action-add_vehicle_condition_category')
    expect(action).toHaveTextContent(/Based on searches we observed/i)
  })

  it('promises no benefit CarUp has not measured', async () => {
    fetchListingIntelligence.mockResolvedValue(fullPayload)
    render(<ListingInsights vin="VIN1" />)
    const actions = await screen.findByTestId('listing-next-best-actions')
    const text = (actions.textContent || '').toLowerCase()
    for (const forbidden of ['sell faster', 'more sales', 'guarantee', '% more', 'more buyers']) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('shows no lost-opportunity block when nothing was missed', async () => {
    fetchListingIntelligence.mockResolvedValue({
      ...fullPayload,
      lost_opportunity: { ...fullPayload.lost_opportunity, total_missed_searches: 0, dimensions: [] },
    })
    render(<ListingInsights vin="VIN1" />)
    await waitFor(() => expect(screen.getByTestId('listing-insights')).toBeInTheDocument())
    expect(screen.queryByTestId('listing-lost-opportunity')).not.toBeInTheDocument()
  })

  it('does not nag a complete listing', async () => {
    fetchListingIntelligence.mockResolvedValue({ ...fullPayload, next_best_actions: [] })
    render(<ListingInsights vin="VIN1" />)
    await waitFor(() => expect(screen.getByTestId('listing-insights')).toBeInTheDocument())
    expect(screen.queryByTestId('listing-next-best-actions')).not.toBeInTheDocument()
  })
})

describe('scope', () => {
  it('requests only the listing it was given, with the stated window', async () => {
    fetchListingIntelligence.mockResolvedValue(fullPayload)
    render(<ListingInsights vin="VIN-SCOPED" windowDays={30} />)
    await waitFor(() => expect(fetchListingIntelligence).toHaveBeenCalledWith('VIN-SCOPED', 30))
    expect(fetchListingIntelligence).toHaveBeenCalledTimes(1)
  })
})
