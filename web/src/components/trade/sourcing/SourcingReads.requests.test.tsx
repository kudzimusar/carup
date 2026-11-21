/**
 * RX-06 — /diaspora/rfq and /diaspora/containers request lifecycle (both presentations).
 *
 * useCarUpApi() returns a NEW object on every render and owns loading state, so a page whose load
 * callbacks are keyed on that object re-creates them on every render and its mount effect re-fires on
 * its own state changes: an unbounded request loop (the defect pull request 130 fixed on the trade profile, and
 * the Drive and Subscription pages fixed since). The mock below reproduces the hazard — a fresh object
 * literal per call — so only a REQUEST COUNT can prove the loop is gone. StrictMode double-invokes
 * effects on mount, so 2 is the honest ceiling. Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const auth = vi.hoisted(() => ({ user: { id: 'fictional-admin', role: 'admin' }, isAuthenticated: true, loading: false }))
const fns = vi.hoisted(() => ({
  fetchDiasporaBuyerOrders: vi.fn(),
  fetchDiasporaRfqs: vi.fn(),
  fetchDiasporaMarketplaceContainers: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
// The real hazard: a fresh object literal on every render.
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ ...fns }) }))

const settle = () => new Promise((resolve) => setTimeout(resolve, 200))

async function mount(path: 'DiasporaReverseRfq' | 'DiasporaContainerMarketplace', unified: boolean) {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = unified ? true : undefined
  const { default: Page } = await import(`@/pages/diaspora/${path}.tsx`)
  return render(<StrictMode><MemoryRouter><Page /></MemoryRouter></StrictMode>)
}

beforeEach(() => {
  vi.clearAllMocks()
  // Each answer is a NEW array, so every response changes state and re-renders the page.
  fns.fetchDiasporaBuyerOrders.mockImplementation(async () => [])
  fns.fetchDiasporaRfqs.mockImplementation(async () => [])
  fns.fetchDiasporaMarketplaceContainers.mockImplementation(async () => [])
})
afterEach(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined })

describe.each([false, true])('bounded mount reads (unified=%s)', (unified) => {
  it('Reverse RFQ reads buyer orders and open RFQs a bounded number of times', async () => {
    await mount('DiasporaReverseRfq', unified)
    await waitFor(() => expect(fns.fetchDiasporaBuyerOrders).toHaveBeenCalled())
    await settle()
    expect(fns.fetchDiasporaBuyerOrders.mock.calls.length, 'buyer orders re-requested on every render — the unbounded loop').toBeLessThanOrEqual(2)
    expect(fns.fetchDiasporaRfqs.mock.calls.length, 'open RFQs re-requested on every render — the unbounded loop').toBeLessThanOrEqual(2)
  })

  it('the container board reads open containers a bounded number of times', async () => {
    await mount('DiasporaContainerMarketplace', unified)
    await waitFor(() => expect(fns.fetchDiasporaMarketplaceContainers).toHaveBeenCalled())
    await settle()
    expect(fns.fetchDiasporaMarketplaceContainers.mock.calls.length, 'containers re-requested on every render — the unbounded loop').toBeLessThanOrEqual(2)
  })

  it('a failing read does not loop either', async () => {
    fns.fetchDiasporaBuyerOrders.mockImplementation(async () => { throw Object.assign(new Error('Too many requests'), { status: 429 }) })
    fns.fetchDiasporaMarketplaceContainers.mockImplementation(async () => { throw Object.assign(new Error('Too many requests'), { status: 429 }) })
    const a = await mount('DiasporaReverseRfq', unified)
    await waitFor(() => expect(fns.fetchDiasporaBuyerOrders).toHaveBeenCalled())
    await settle()
    expect(fns.fetchDiasporaBuyerOrders.mock.calls.length).toBeLessThanOrEqual(2)
    a.unmount()
    await mount('DiasporaContainerMarketplace', unified)
    await waitFor(() => expect(fns.fetchDiasporaMarketplaceContainers).toHaveBeenCalled())
    await settle()
    expect(fns.fetchDiasporaMarketplaceContainers.mock.calls.length).toBeLessThanOrEqual(2)
  })
})
