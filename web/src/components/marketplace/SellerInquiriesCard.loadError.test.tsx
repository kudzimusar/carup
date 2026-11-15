import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * RX-02 TI-13 — a failed inquiries read must be visible, not silently removed.
 * On main the card returned null on any error, so a seller could not tell "no buyers wrote"
 * from "CarUp could not read your inquiries".
 */
vi.setConfig({ testTimeout: 30_000 })

const fetchMyMarketplaceInquiries = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ fetchMyMarketplaceInquiries }) }))

const { SellerInquiriesCard } = await import('./SellerInquiriesCard')
const renderCard = () => render(<MemoryRouter><SellerInquiriesCard /></MemoryRouter>)

beforeEach(() => { vi.clearAllMocks() })

describe('SellerInquiriesCard — failed read (TI-13)', () => {
  it('stays on screen and announces the failure, with no inquiry count', async () => {
    fetchMyMarketplaceInquiries.mockRejectedValue(new Error('HTTP 503'))
    renderCard()

    const alert = await screen.findByTestId('seller-inquiries-unavailable')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert.textContent).toMatch(/could not be loaded/i)
    const card = screen.getByTestId('seller-inquiries-card')
    expect(card.textContent).not.toMatch(/\d/)
    expect(card.textContent).not.toContain('No inquiries yet')
  })

  it('a successful empty read shows the honest empty copy and a measured zero', async () => {
    fetchMyMarketplaceInquiries.mockResolvedValue({ inquiries: [] })
    renderCard()
    await waitFor(() => expect(screen.getByTestId('seller-inquiries-card').textContent).toContain('No inquiries yet'))
    expect(screen.getByTestId('seller-inquiries-card').textContent).toContain('0')
    expect(screen.queryByTestId('seller-inquiries-unavailable')).toBeNull()
  })
})
