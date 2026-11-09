/**
 * F11 — the owner dashboard must not overflow a 393px screen.
 *
 * THE DEFECT THIS PINS, AND A CORRECTION. The exploratory UAT measured 27px of horizontal overflow
 * at 393px and attributed it to the metrics table. That attribution was wrong — or at least
 * incomplete. The table was constrained, and Round 2 measured the SAME 27px still there. Walking
 * every box against the viewport found the real source: the header action row, three controls
 * totalling 404px in a flex that could not wrap.
 *
 * A NOTE ON WHAT THIS FILE CAN AND CANNOT PROVE. jsdom does no layout: every width here is zero, so
 * no unit test can measure overflow. That is precisely why the first fix passed review and failed
 * in a browser. The load-bearing evidence is the Round 2 browser measurement
 * (`document.documentElement.scrollWidth` vs `clientWidth` at 393px); this file is the cheap
 * structural guard that the row is still ALLOWED to wrap, so the fix cannot be undone silently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import OwnerDashboard from './OwnerDashboard'

const fetchOwnedVehicles = vi.fn()
const fetchNotifications = vi.fn()
const fetchSafePayEscrows = vi.fn()
const fetchMyGarageProfile = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchOwnedVehicles, fetchNotifications, fetchSafePayEscrows, fetchMyGarageProfile }),
}))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Owner', email: 'o@x.test', role: 'owner' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/components/intelligence/MarketplacePulse', () => ({ default: () => null }))
vi.mock('@/components/intelligence/NextBestActions', () => ({ default: () => null }))
vi.mock('@/components/intelligence/PeriodicReport', () => ({ default: () => null }))

beforeEach(() => {
  vi.clearAllMocks()
  fetchOwnedVehicles.mockResolvedValue([])
  fetchNotifications.mockResolvedValue([])
  fetchSafePayEscrows.mockResolvedValue([])
  fetchMyGarageProfile.mockRejectedValue(new Error('not a garage tenant'))
})

describe('F11 — the dashboard header can wrap on a narrow screen', () => {
  it('the action row is allowed to wrap rather than forcing the page wider', async () => {
    render(<MemoryRouter><OwnerDashboard /></MemoryRouter>)
    const row = await screen.findByTestId('dashboard-header-actions')
    const cls = row.className
    expect(cls, 'the row that overflowed must be able to wrap').toContain('flex-wrap')
    // And it must not be able to force its parent wider than the viewport.
    expect(cls).toContain('min-w-0')
  })

  it('no control was removed to achieve it', async () => {
    // The cheap way to stop an overflow is to hide something. Nothing here was hidden.
    render(<MemoryRouter><OwnerDashboard /></MemoryRouter>)
    const row = await screen.findByTestId('dashboard-header-actions')
    await waitFor(() => expect(row.textContent).toContain('Low-Bandwidth Mode'))
    expect(row.textContent).toContain('My Garage')
    expect(row.textContent).toContain('Ask Gutu AI')
  })
})
