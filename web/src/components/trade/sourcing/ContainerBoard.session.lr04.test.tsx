/**
 * RX06-LR04 — /diaspora/containers unified board: an ended session (401) is said as an ended session with the way
 * back (sign in again, returning here), never as a failure to retry. Same harness as ContainerBoard.unified.test.tsx.
 * Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const auth = vi.hoisted(() => ({ user: { id: 'fictional-buyer', role: 'owner' } as { id: string; role: string }, isAuthenticated: true, loading: false }))
const api = vi.hoisted(() => ({
  fetchDiasporaMarketplaceContainers: vi.fn(),
  fetchDiasporaContainerReservations: vi.fn(),
  fetchDiasporaContainerCapacity: vi.fn(),
  requestDiasporaReservation: vi.fn(),
  approveDiasporaMarketplaceReservation: vi.fn(),
  rejectDiasporaMarketplaceReservation: vi.fn(),
  closeDiasporaContainerBooking: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })

async function mount(unified = true) {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = unified ? true : undefined
  const { default: Page } = await import('@/pages/diaspora/DiasporaContainerMarketplace')
  return render(<MemoryRouter><Page /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchDiasporaContainerReservations.mockResolvedValue([])
  api.fetchDiasporaContainerCapacity.mockResolvedValue(null)
})
afterEach(() => { delete (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ })

describe('containers: an ended session', () => {
  it('401 → "Your session has ended" with Sign in again (returning here), and no retry', async () => {
    api.fetchDiasporaMarketplaceContainers.mockRejectedValueOnce(httpError(401, 'Session expired'))
    await mount()
    const box = await screen.findByTestId('trade-containers-failed')
    expect(box).toHaveTextContent('Your session has ended')
    expect(box).toHaveTextContent('Nothing has been booked or changed.')
    expect(within(box).getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/login?returnTo=%2Fdiaspora%2Fcontainers')
    expect(within(box).queryByRole('button', { name: /Try again/ })).toBeNull()
  })
})
