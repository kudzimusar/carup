import type { ReactElement } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Owner UAT request-loop regressions (Issue #127).
 *
 * useCarUpApi() owns request state and therefore returns a newly allocated aggregate object after
 * request-driven renders. The production defect occurred when a page put that aggregate object in a
 * useCallback/useEffect dependency list. This mock deliberately returns a fresh object every time;
 * each initial collection request must nevertheless remain bounded to one call per ordinary mount.
 */

const authState = { role: 'admin' }

const fetchDiasporaBuyerOrders = vi.fn()
const fetchDiasporaRfqs = vi.fn()
const fetchDiasporaBuyerOrder = vi.fn()
const fetchDiasporaOrderMatches = vi.fn()
const createDiasporaBuyerOrder = vi.fn()
const publishDiasporaRfq = vi.fn()
const acceptDiasporaQuote = vi.fn()
const createDiasporaQuote = vi.fn()

const fetchDiasporaMarketplaceContainers = vi.fn()
const fetchDiasporaContainerReservations = vi.fn()
const fetchDiasporaContainerCapacity = vi.fn()
const requestDiasporaReservation = vi.fn()
const approveDiasporaMarketplaceReservation = vi.fn()
const rejectDiasporaMarketplaceReservation = vi.fn()
const closeDiasporaContainerBooking = vi.fn()

const fetchDiasporaAiCommands = vi.fn()
const parseDiasporaAiCommand = vi.fn()
const createDiasporaAiCommand = vi.fn()
const approveDiasporaAiCommand = vi.fn()
const confirmDiasporaAiCommand = vi.fn()
const executeDiasporaAiCommand = vi.fn()

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'uat-user', name: 'UAT User', role: authState.role },
    isAuthenticated: true,
    loading: false,
  }),
}))

vi.mock('@/hooks/useCarUpApi', () => ({
  // A fresh object literal on every render is intentional: this reproduces the real hook contract
  // that caused the previous dependency loop while retaining stable individual request functions.
  useCarUpApi: () => ({
    fetchDiasporaBuyerOrders,
    fetchDiasporaRfqs,
    fetchDiasporaBuyerOrder,
    fetchDiasporaOrderMatches,
    createDiasporaBuyerOrder,
    publishDiasporaRfq,
    acceptDiasporaQuote,
    createDiasporaQuote,
    fetchDiasporaMarketplaceContainers,
    fetchDiasporaContainerReservations,
    fetchDiasporaContainerCapacity,
    requestDiasporaReservation,
    approveDiasporaMarketplaceReservation,
    rejectDiasporaMarketplaceReservation,
    closeDiasporaContainerBooking,
    fetchDiasporaAiCommands,
    parseDiasporaAiCommand,
    createDiasporaAiCommand,
    approveDiasporaAiCommand,
    confirmDiasporaAiCommand,
    executeDiasporaAiCommand,
  }),
}))

const DiasporaReverseRfq = (await import('./DiasporaReverseRfq')).default
const DiasporaContainerMarketplace = (await import('./DiasporaContainerMarketplace')).default
const DiasporaAiCommandCenter = (await import('./DiasporaAiCommandCenter')).default

function renderPage(page: ReactElement) {
  return render(<MemoryRouter>{page}</MemoryRouter>)
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.role = 'admin'
  fetchDiasporaBuyerOrders.mockResolvedValue([])
  fetchDiasporaRfqs.mockResolvedValue([])
  fetchDiasporaMarketplaceContainers.mockResolvedValue([])
  fetchDiasporaAiCommands.mockResolvedValue([])
})

afterEach(() => cleanup())

describe('Diaspora P1 request-count regression', () => {
  it('loads Reverse RFQ buyer and seller collections once and does not re-enter after rerenders', async () => {
    const { rerender } = renderPage(<DiasporaReverseRfq />)

    await waitFor(() => {
      expect(fetchDiasporaBuyerOrders).toHaveBeenCalledTimes(1)
      expect(fetchDiasporaRfqs).toHaveBeenCalledTimes(1)
    })

    for (let index = 0; index < 5; index += 1) {
      rerender(<MemoryRouter><DiasporaReverseRfq /></MemoryRouter>)
    }
    await settle()

    expect(fetchDiasporaBuyerOrders).toHaveBeenCalledTimes(1)
    expect(fetchDiasporaRfqs).toHaveBeenCalledTimes(1)
  })

  it('loads the Container Marketplace collection once and does not re-enter after rerenders', async () => {
    const { rerender } = renderPage(<DiasporaContainerMarketplace />)

    await waitFor(() => expect(fetchDiasporaMarketplaceContainers).toHaveBeenCalledTimes(1))
    for (let index = 0; index < 5; index += 1) {
      rerender(<MemoryRouter><DiasporaContainerMarketplace /></MemoryRouter>)
    }
    await settle()

    expect(fetchDiasporaMarketplaceContainers).toHaveBeenCalledTimes(1)
  })

  it('loads the AI Command Center queue once and does not re-enter after rerenders', async () => {
    const { rerender } = renderPage(<DiasporaAiCommandCenter />)

    await waitFor(() => expect(fetchDiasporaAiCommands).toHaveBeenCalledTimes(1))
    for (let index = 0; index < 5; index += 1) {
      rerender(<MemoryRouter><DiasporaAiCommandCenter /></MemoryRouter>)
    }
    await settle()

    expect(fetchDiasporaAiCommands).toHaveBeenCalledTimes(1)
  })
})
