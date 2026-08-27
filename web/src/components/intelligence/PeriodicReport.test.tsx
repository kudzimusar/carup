/**
 * CarUp Intelligence 1.0 — I19 periodic summary surface.
 *
 * A report outlives the page that produced it, so the guarantees have to survive
 * the export. The sharpest one: an unmeasured figure must never look like a zero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import PeriodicReport from './PeriodicReport'

const fetchMyReport = vi.fn()
let hookValue: Record<string, unknown> = { fetchMyReport }

vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => hookValue }))

const base = {
  ok: true,
  availability: 'value',
  report_version: 'report@1',
  period: 'monthly',
  window_days: 30,
  generated_at: '2026-08-28T00:00:00.000Z',
  rows: [
    { key: 'inquiries', label: 'Enquiries', value: 4, unit: 'count', available: true, reason: null, means: 'How many people contacted you.', not: 'Not a sale, and not a viewing. It is the first contact.', calculation_version: 'rollup@1' },
    { key: 'listing_views', label: 'Listing views', value: null, unit: null, available: false, reason: 'ledger_instrumented_but_empty', means: 'How many times your listing was opened.', not: 'Not the number of PEOPLE who looked.', calculation_version: 'rollup@1' },
  ],
  coverage: { total: 2, available: 1, unavailable: 1, note: '1 of 2 figures could not be measured for this period and are reported as unavailable, not as zero.' },
}

beforeEach(() => {
  fetchMyReport.mockReset()
  hookValue = { fetchMyReport }
})

describe('an unmeasured figure never looks like a zero', () => {
  it('renders "Not measured" rather than a number', async () => {
    fetchMyReport.mockResolvedValue(base)
    render(<PeriodicReport />)
    expect(await screen.findByTestId('report-row-listing_views-value')).toHaveTextContent(/not measured/i)
    expect(screen.getByTestId('report-row-listing_views-value')).not.toHaveTextContent('0')
  })

  it('renders a real value normally', async () => {
    fetchMyReport.mockResolvedValue(base)
    render(<PeriodicReport />)
    expect(await screen.findByTestId('report-row-inquiries-value')).toHaveTextContent('4')
  })

  it('states the coverage gap before the table', async () => {
    fetchMyReport.mockResolvedValue(base)
    render(<PeriodicReport />)
    expect(await screen.findByTestId('periodic-report-coverage'))
      .toHaveTextContent(/1 of 2 figures could not be measured/i)
    expect(screen.getByTestId('periodic-report-provenance')).toHaveTextContent(/it is not zero/i)
  })

  it('carries no coverage banner when everything was measured', async () => {
    fetchMyReport.mockResolvedValue({
      ...base,
      rows: [base.rows[0]],
      coverage: { total: 1, available: 1, unavailable: 0, note: null },
    })
    render(<PeriodicReport />)
    await screen.findByTestId('periodic-report-table')
    expect(screen.queryByTestId('periodic-report-coverage')).toBeNull()
  })
})

describe('what each figure is not travels with it', () => {
  it('shows the near-miss for every row', async () => {
    fetchMyReport.mockResolvedValue(base)
    render(<PeriodicReport />)
    expect(await screen.findByTestId('report-row-inquiries')).toHaveTextContent(/not a sale/i)
    expect(screen.getByTestId('report-row-listing_views')).toHaveTextContent(/not the number of people/i)
  })
})

describe('the export comes from the server', () => {
  it('links to the API rather than building a CSV in the browser', async () => {
    fetchMyReport.mockResolvedValue(base)
    render(<PeriodicReport />)
    const link = await screen.findByTestId('periodic-report-download')
    expect(link).toHaveAttribute('href', expect.stringContaining('/api/marketplace/my-report'))
    expect(link).toHaveAttribute('href', expect.stringContaining('format=csv'))
  })
})

describe('a failed report is never a report of nothing', () => {
  it('says so on a rejected fetch', async () => {
    fetchMyReport.mockRejectedValue(new Error('down'))
    render(<PeriodicReport />)
    expect(await screen.findByTestId('periodic-report-message'))
      .toHaveTextContent(/not a report of zero activity/i)
    expect(screen.queryByTestId('periodic-report-table')).toBeNull()
  })

  it('carries the server message when the projection was unreadable', async () => {
    fetchMyReport.mockResolvedValue({
      ok: true, availability: 'unavailable',
      message: 'This report could not be produced because the underlying figures could not be read. It is not a report of zero activity.',
      rows: [],
    })
    render(<PeriodicReport />)
    expect(await screen.findByTestId('periodic-report-message')).toHaveTextContent(/could not be read/i)
  })

  it('a hook that never exposes the fetcher reads as unavailable', async () => {
    hookValue = {}
    render(<PeriodicReport />)
    expect(await screen.findByTestId('periodic-report-message')).toBeInTheDocument()
  })
})
