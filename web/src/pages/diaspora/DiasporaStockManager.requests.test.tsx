import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * /diaspora/stock request lifecycle — the same defect class as issue #128 Fix A.
 *
 * The deployed-staging gate (run 36268191057, tablet shard) recorded ~2,100 GET /diaspora/stock and
 * ~2,100 GET /diaspora/supply-documents in 19 s, and no PATCH: the page re-rendered continuously, so
 * the merchandising Save never reached the API. The loaders were keyed on the aggregate `api`
 * object, which useCarUpApi() recreates on every render — and every request re-renders the page
 * (the hook owns loading state). These tests assert REQUEST COUNTS, which is what proves the loop
 * is gone.
 */

const fetchItems = vi.fn()
const fetchDocs = vi.fn()
const fetchLedger = vi.fn()
const updateItem = vi.fn()
const createItem = vi.fn()

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'seller-1', name: 'Seller', role: 'dealer' }, isAuthenticated: true, loading: false }),
}))

// Reproduces the real hook's hazard faithfully: a fresh aggregate object on every render, stable
// individual methods, and a state change on every settled request (the real hook's setLoading).
let bump: ((fn: (n: number) => number) => void) | null = null
const settle = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
  try { return await fn(...args) } finally { bump?.((n) => n + 1) }
}
const stable = {
  fetchDiasporaStockItems: settle((...a: unknown[]) => fetchItems(...a)),
  fetchDiasporaSupplyDocuments: settle((...a: unknown[]) => fetchDocs(...a)),
  fetchDiasporaStockLedger: settle((...a: unknown[]) => fetchLedger(...a)),
  updateDiasporaStockItem: settle((...a: unknown[]) => updateItem(...a)),
  createDiasporaStockItem: settle((...a: unknown[]) => createItem(...a)),
}
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => {
    const [, setTick] = useState(0)
    bump = setTick
    return { ...stable }
  },
}))

const DiasporaStockManager = (await import('./DiasporaStockManager')).default

const ITEM = {
  id: 'stk-1', part_name: 'Brake pads', quantity_on_hand: 10, quantity_reserved: 0,
  balances: { onHand: 10, reserved: 0, available: 10 }, publication_status: 'PRIVATE',
  currency: 'USD', condition: null, part_number: null, vehicle_make: null, unit_price: null,
  updated_at: '2026-09-26T20:32:14.264224+00:00',
}

const settleTime = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)) })

beforeEach(() => {
  vi.clearAllMocks()
  fetchItems.mockResolvedValue([ITEM])
  fetchDocs.mockResolvedValue([])
  fetchLedger.mockResolvedValue([])
  createItem.mockResolvedValue(ITEM)
  updateItem.mockResolvedValue({ ...ITEM, unit_price: 250 })
})

describe('DiasporaStockManager request lifecycle', () => {
  it('loads the stock list and supply documents once on mount, and never loops', async () => {
    render(<MemoryRouter><DiasporaStockManager /></MemoryRouter>)
    await screen.findByTestId('diaspora-stock-page')
    await settleTime()
    expect(fetchItems).toHaveBeenCalledTimes(1)
    expect(fetchDocs).toHaveBeenCalledTimes(1)
  })

  it('create → auto-select → Save sends exactly one PATCH carrying the version it loaded', async () => {
    render(<MemoryRouter><DiasporaStockManager /></MemoryRouter>)
    await screen.findByTestId('diaspora-stock-page')
    await settleTime()

    fireEvent.change(screen.getByTestId('diaspora-stock-create-name'), { target: { value: 'Brake pads' } })
    fireEvent.change(screen.getByTestId('diaspora-stock-create-qty'), { target: { value: '10' } })
    await act(async () => { fireEvent.click(screen.getByTestId('diaspora-stock-create-submit')) })
    await screen.findByTestId('diaspora-stock-detail')
    await settleTime()
    // One reload after the create, nothing more: the list is not being refetched in a loop.
    expect(fetchItems).toHaveBeenCalledTimes(2)
    expect(fetchDocs).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByTestId('diaspora-stock-merch-unit-price'), { target: { value: '250' } })
    await act(async () => { fireEvent.click(screen.getByTestId('diaspora-stock-merch-save')) })
    expect(await screen.findByTestId('diaspora-stock-merch-result')).toHaveTextContent(/saved/i)
    expect(updateItem).toHaveBeenCalledTimes(1)
    expect(updateItem.mock.calls[0][0]).toBe('stk-1')
    expect(updateItem.mock.calls[0][1]).toMatchObject({ unit_price: 250, expected_updated_at: ITEM.updated_at })
  })
})
