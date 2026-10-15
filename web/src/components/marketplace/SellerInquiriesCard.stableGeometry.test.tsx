import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// OC-LAUNCH R4-C: the inquiries card sits ABOVE the seller's listing cards and its data arrives after
// render. Its body must occupy the same space in every state, or every listing below it moves after
// the seller (or a test) has scrolled to it.
const api = vi.hoisted(() => ({ resolve: (() => {}) as (value: unknown) => void }))
vi.mock('@/hooks/useCarUpApi', () => {
  const fetchMyMarketplaceInquiries = () => new Promise(resolve => { api.resolve = resolve })
  return { useCarUpApi: () => ({ fetchMyMarketplaceInquiries }) }
})

const { SellerInquiriesCard } = await import('./SellerInquiriesCard')

const inquiry = (n: number) => ({
  id: `inq-${n}`, listing_id: `VIN${n}`, inquiry_type: 'vehicle_purchase_interest', status: 'new',
  message: `Question ${n}`, contact_name: `Buyer ${n}`, created_at: '2026-10-11T00:00:00.000Z',
})

describe('SellerInquiriesCard keeps a stable geometry', () => {
  it('uses one fixed-height scroll region for loading and for any number of inquiries', async () => {
    render(<MemoryRouter><SellerInquiriesCard /></MemoryRouter>)
    const loadingBody = screen.getByTestId('seller-inquiries-body')
    const loadingClass = loadingBody.className
    expect(loadingClass).toMatch(/\bh-\d+\b/)
    expect(loadingClass).toContain('overflow-y-auto')
    expect(loadingBody.textContent).toMatch(/Loading/)

    await act(async () => { api.resolve({ inquiries: Array.from({ length: 30 }, (_, i) => inquiry(i)) }) })
    // The list renders the latest eight; that alone is ~1,600px of rows, which is why the body is bounded.
    await waitFor(() => expect(screen.getByTestId('seller-inquiries-body').textContent).toContain('Question 7'))
    expect(screen.getByTestId('seller-inquiries-body').textContent).not.toContain('Question 8')

    const loadedBody = screen.getByTestId('seller-inquiries-body')
    expect(loadedBody).toBe(loadingBody)
    expect(loadedBody.className).toBe(loadingClass)
    expect(loadedBody.getAttribute('role')).toBe('region')
    expect(loadedBody.getAttribute('tabindex')).toBe('0')
  })
})
