/**
 * CarUp Intelligence 1.0 — I12 parts intelligence surface.
 *
 * The surface's job here is mostly to be honest about how little CarUp can
 * measure: no parts catalogue, no fitment data, no supplier principal. So the
 * unmeasurable list must be as visible as the counts, and the two scopes must
 * stay apart.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import PartsIntelligence from './PartsIntelligence'

const fetchPartsIntelligence = vi.fn()
const fetchPlatformPartsIntelligence = vi.fn()

let hookValue: Record<string, unknown> = { fetchPartsIntelligence, fetchPlatformPartsIntelligence }

vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => hookValue }))

const value = (n: number, unit = 'count') => ({ availability: 'value', value: n, unit })

const provenance = {
  logs_recorded: value(2),
  parts_verified: value(1),
  awaiting_verification: value(1),
  publicly_shareable: value(1),
  flagged_for_review: value(1),
  verification_rate: { availability: 'insufficient_data', reason: 'denominator_below_10' },
}

const notMeasurable = [
  { key: 'compatibility', label: 'Compatibility and fitment', reason: 'no_catalogue_or_fitment_data', detail: 'There is no parts catalogue and no table relating a part to the vehicles it fits.' },
  { key: 'supplier_performance', label: 'Supplier performance', reason: 'no_supplier_principal', detail: 'CarUp holds no supplier registry and no supplier login.' },
]

const mechanicPayload = {
  ok: true,
  scope: 'mechanic',
  availability: 'value',
  calculation_version: 'parts_demand@1',
  window_days: 30,
  provenance,
  inventory: {
    part_types_tracked: value(2),
    out_of_stock: value(1),
    below_reorder_threshold: { availability: 'insufficient_data', reason: 'no_reorder_threshold_recorded' },
    stock_value: value(30, 'currency'),
    valuation_coverage: { priced_parts: 1, total_parts: 2, note: 'Parts with no recorded price or stock level are excluded from this value, so the true total is higher.' },
  },
  scope_note: "Your own PartSentry records, and your organization's stock. Not the whole platform.",
  not_measurable: notMeasurable,
}

const platformPayload = {
  ok: true,
  scope: 'platform',
  availability: 'value',
  calculation_version: 'parts_demand@1',
  window_days: 30,
  provenance,
  rfq_demand: {
    requests_received: value(5),
    responded: value(2),
    awaiting_response: value(3),
    response_rate: { availability: 'insufficient_data', reason: 'denominator_below_10' },
    by_status: { new: 3, contacted: 2 },
  },
  not_measurable: notMeasurable,
  domain_boundary: 'Parts demand and provenance only. Fraud adjudication on a flagged part is a separate governed domain and is not decided here.',
}

beforeEach(() => {
  fetchPartsIntelligence.mockReset()
  fetchPlatformPartsIntelligence.mockReset()
  hookValue = { fetchPartsIntelligence, fetchPlatformPartsIntelligence }
})

describe('the two scopes stay apart', () => {
  it('a practitioner view says it is their own work, and carries no RFQ demand', async () => {
    fetchPartsIntelligence.mockResolvedValue(mechanicPayload)
    render(<PartsIntelligence scope="mechanic" />)
    expect(await screen.findByTestId('parts-scope-note')).toHaveTextContent(/not the whole platform/i)
    expect(screen.queryByTestId('parts-rfq')).toBeNull()
    expect(fetchPlatformPartsIntelligence).not.toHaveBeenCalled()
  })

  it('a platform view carries RFQ demand and no organization stock', async () => {
    fetchPlatformPartsIntelligence.mockResolvedValue(platformPayload)
    render(<PartsIntelligence scope="platform" />)
    expect(await screen.findByTestId('parts-rfq')).toBeInTheDocument()
    expect(screen.queryByTestId('parts-inventory')).toBeNull()
    expect(fetchPartsIntelligence).not.toHaveBeenCalled()
  })

  it('a practitioner with no organization is told stock is an organization question', async () => {
    fetchPartsIntelligence.mockResolvedValue({
      ...mechanicPayload,
      inventory: { unavailable: true, reason: 'no_organization_context', note: 'A parts inventory belongs to an organization. You are not currently in one.' },
    })
    render(<PartsIntelligence scope="mechanic" />)
    expect(await screen.findByTestId('parts-inventory-unavailable')).toHaveTextContent(/belongs to an organization/i)
    expect(screen.queryByTestId('parts-inventory-part_types_tracked-value')).toBeNull()
  })
})

describe('a failed read is never a zero', () => {
  it('a rejected fetch says the figures are not zero', async () => {
    fetchPartsIntelligence.mockRejectedValue(new Error('down'))
    render(<PartsIntelligence scope="mechanic" />)
    expect(await screen.findByTestId('parts-intelligence-message')).toHaveTextContent(/NOT zero/i)
    expect(screen.queryByTestId('parts-provenance-grid')).toBeNull()
  })

  it('a hook that never exposes the fetcher reads as unavailable, not as empty', async () => {
    hookValue = {}
    render(<PartsIntelligence scope="mechanic" />)
    expect(await screen.findByTestId('parts-intelligence-message')).toHaveTextContent(/NOT zero/i)
  })
})

describe('what CarUp cannot measure is as visible as what it can', () => {
  it('lists compatibility and supplier performance with their reasons', async () => {
    fetchPartsIntelligence.mockResolvedValue(mechanicPayload)
    render(<PartsIntelligence scope="mechanic" />)
    expect(await screen.findByTestId('parts-missing-compatibility')).toHaveTextContent(/no parts catalogue/i)
    expect(screen.getByTestId('parts-missing-supplier_performance')).toHaveTextContent(/no supplier registry/i)
    expect(screen.getByTestId('parts-not-measurable')).toHaveTextContent(/not zero/i)
  })

  it('says an RFQ count cannot be broken down by supplier or part', async () => {
    fetchPlatformPartsIntelligence.mockResolvedValue(platformPayload)
    render(<PartsIntelligence scope="platform" />)
    expect(await screen.findByTestId('parts-rfq')).toHaveTextContent(/cannot be broken down/i)
  })
})

describe('provenance is not a fraud verdict', () => {
  it('describes a flagged record as awaiting review', async () => {
    fetchPartsIntelligence.mockResolvedValue(mechanicPayload)
    render(<PartsIntelligence scope="mechanic" />)
    await screen.findByTestId('parts-provenance-grid')
    expect(screen.getByTestId('parts-intelligence')).not.toHaveTextContent(/fraud finding|counterfeit/i)
  })

  it('renders an insufficient-data rate as a qualifier, not a percentage', async () => {
    fetchPartsIntelligence.mockResolvedValue(mechanicPayload)
    render(<PartsIntelligence scope="mechanic" />)
    const grid = await screen.findByTestId('parts-provenance-grid')
    expect(grid).not.toHaveTextContent('%')
  })

  it('renders a threshold with no data as a qualifier rather than zero', async () => {
    fetchPartsIntelligence.mockResolvedValue(mechanicPayload)
    render(<PartsIntelligence scope="mechanic" />)
    const cell = await screen.findByTestId('parts-inventory-below_reorder_threshold-value')
    expect(cell).not.toHaveTextContent('0')
  })
})
