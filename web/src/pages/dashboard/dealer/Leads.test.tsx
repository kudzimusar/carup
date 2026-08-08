import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Dealer leads de-mock (S9): the Leads page previously seeded four hardcoded prototype leads and
 * merged them under any real API rows. It must now render only real data — the SellerInquiriesCard
 * (ownership-scoped marketplace inquiries) plus fetchDealerLeads — with an honest empty state.
 */

const fetchDealerLeads = vi.fn()
const fetchMyMarketplaceInquiries = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchDealerLeads, fetchMyMarketplaceInquiries, loading: false }),
}))

const Leads = (await import('./Leads')).default
const SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'Leads.tsx'), 'utf8')

// The four prototype leads dealers saw regardless of their real pipeline.
const MOCK_LEAD_NAMES = ['Tendai Moyo', 'Sarah Chikomo', 'James Ncube', 'Grace Mupfumi']

function renderLeads() {
  return render(<MemoryRouter><Leads /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchDealerLeads.mockResolvedValue([])
  fetchMyMarketplaceInquiries.mockResolvedValue({ inquiries: [] })
})

describe('dealer Leads de-mock', () => {
  it('the source no longer contains the prototype lead constants', () => {
    expect(SRC).not.toContain('mockLeadsData')
    for (const name of MOCK_LEAD_NAMES) {
      expect(SRC).not.toContain(name)
    }
  })

  it('renders no hardcoded mock lead names for a dealer with an empty pipeline', async () => {
    const { container } = renderLeads()
    await waitFor(() => expect(fetchDealerLeads).toHaveBeenCalled())

    const text = container.textContent || ''
    for (const name of MOCK_LEAD_NAMES) {
      expect(text, `rendered page must not contain mock lead ${name}`).not.toContain(name)
    }
  })

  it('mounts the SellerInquiriesCard so real marketplace inquiries are visible', async () => {
    renderLeads()
    await waitFor(() => expect(fetchMyMarketplaceInquiries).toHaveBeenCalled())
    expect(screen.getByTestId('seller-inquiries-card')).toBeTruthy()
  })

  it('shows an honest empty state when there are no leads at all', async () => {
    renderLeads()
    await waitFor(() => expect(fetchDealerLeads).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('dealer-leads-empty').textContent).toContain('No leads yet'))
    expect(screen.getByTestId('dealer-leads-empty').textContent).toContain('marketplace listings')
  })

  it('renders real leads returned by the API without any mock backfill', async () => {
    fetchDealerLeads.mockResolvedValue([
      {
        id: 'inq-1',
        buyer_name: 'Real Buyer',
        email: 'real-buyer@example.test',
        buyer_phone: '+263772000001',
        vin: 'JTDKARFP0H3000731',
        status: 'new',
        source: 'web',
        message: 'Is this still available?',
        created_at: '2026-08-01T00:00:00.000Z',
      },
    ])
    const { container } = renderLeads()

    await waitFor(() => expect(container.textContent).toContain('Real Buyer'))
    expect(container.textContent).toContain('VIN: JTDKARFP0H3000731')
    for (const name of MOCK_LEAD_NAMES) {
      expect(container.textContent).not.toContain(name)
    }
  })
})
