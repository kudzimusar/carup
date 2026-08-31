/**
 * Parts tracking — CarUp Intelligence I12.
 *
 * This page had no test coverage at all, which is how it kept four separate
 * assertions nobody recorded: a failed read shown as an empty shelf, an invented
 * supplier, an invented reorder level driving a real alert, and unknown numbers
 * coerced to zero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import PartsTracking from './PartsTracking'

const fetchMechanicParts = vi.fn()
const createMechanicPart = vi.fn()
const fetchPartsIntelligence = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchMechanicParts, createMechanicPart, fetchPartsIntelligence, loading: false }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  fetchMechanicParts.mockReset()
  createMechanicPart.mockReset()
  // The projection is mounted here; these tests are about the stock table, so it
  // is given a readable-but-irrelevant payload rather than left undefined.
  fetchPartsIntelligence.mockReset()
  fetchPartsIntelligence.mockResolvedValue({
    ok: true, availability: 'value', window_days: 30, scope: 'mechanic',
    provenance: { logs_recorded: { availability: 'value', value: 0, unit: 'count' } },
    not_measurable: [],
  })
})

describe('an unread inventory is not an empty shelf either', () => {
  it('states nothing at all until the read has actually settled', async () => {
    // Before this gate existed the tiles rendered on first paint from the empty initial
    // state: `parts-total` said 0, `parts-value` said $0 and `parts-low-stock` said
    // "No reorder level set" — unrecorded facts presented as measured values. It also made
    // every `findByTestId(...)`-then-assert-content test in this file racy, because those
    // testids already existed before the data arrived, so the assertion could run against
    // the pre-read paint. Both are fixed at the source rather than waited around.
    let settleRead: (value: unknown) => void = () => {}
    fetchMechanicParts.mockReturnValue(new Promise(resolve => { settleRead = resolve }))

    render(<PartsTracking />)

    expect(screen.getByTestId('parts-not-yet-counted')).toBeInTheDocument()
    for (const id of ['parts-total', 'parts-value', 'parts-low-stock', 'parts-out-of-stock', 'no-parts-state']) {
      expect(screen.queryByTestId(id)).toBeNull()
    }

    settleRead([{ id: 'p1', name: 'Filter', sku: 'F-1', stock_level: 1, unit_price: 10, min_stock: 5 }])

    expect(await screen.findByTestId('parts-low-stock')).toHaveTextContent('1')
    expect(screen.queryByTestId('parts-not-yet-counted')).toBeNull()
  })
})

describe('a failed read is not an empty shelf', () => {
  it('says the inventory could not be loaded, and shows no tiles', async () => {
    fetchMechanicParts.mockRejectedValue(new Error('backend down'))
    render(<PartsTracking />)
    expect(await screen.findByTestId('parts-load-failed')).toHaveTextContent(/NOT zero/i)
    expect(screen.queryByTestId('parts-total')).toBeNull()
    expect(screen.queryByTestId('no-parts-state')).toBeNull()
  })

  it('a genuinely empty inventory still says so', async () => {
    fetchMechanicParts.mockResolvedValue([])
    render(<PartsTracking />)
    expect(await screen.findByTestId('no-parts-state')).toBeInTheDocument()
    expect(screen.getByTestId('parts-total')).toHaveTextContent('0')
    expect(screen.queryByTestId('parts-load-failed')).toBeNull()
  })
})

describe('nothing unrecorded is filled in', () => {
  it('a part with no supplier says so rather than claiming internal sourcing', async () => {
    fetchMechanicParts.mockResolvedValue([
      { id: 'p1', name: 'Brake Pads', sku: 'BP-1', stock_level: 4, unit_price: 20, supplier: null },
    ])
    render(<PartsTracking />)
    expect(await screen.findByTestId('part-row-p1')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('part-row-p1')).not.toHaveTextContent('Internal')
  })

  it('an unrecorded stock level is not shown as zero and is not counted out of stock', async () => {
    fetchMechanicParts.mockResolvedValue([
      { id: 'p1', name: 'Filter', sku: 'F-1', stock_level: null, unit_price: 10 },
      { id: 'p2', name: 'Belt', sku: 'B-1', stock_level: 0, unit_price: 10 },
    ])
    render(<PartsTracking />)
    await waitFor(() => expect(screen.getByTestId('parts-out-of-stock')).toHaveTextContent('1'))
    expect(screen.getByTestId('part-row-p1')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('part-row-p1')).not.toHaveTextContent('0 units')
  })

  it('no low-stock alert is raised for a part whose reorder level nobody set', async () => {
    fetchMechanicParts.mockResolvedValue([
      { id: 'p1', name: 'Filter', sku: 'F-1', stock_level: 1, unit_price: 10, min_stock: null },
    ])
    render(<PartsTracking />)
    const row = await screen.findByTestId('part-row-p1')
    expect(screen.getByTestId('parts-low-stock')).toHaveTextContent(/no reorder level set/i)
    expect(row).not.toHaveTextContent('Low Stock')
  })

  it('a reorder level the garage did set is honoured', async () => {
    fetchMechanicParts.mockResolvedValue([
      { id: 'p1', name: 'Filter', sku: 'F-1', stock_level: 1, unit_price: 10, min_stock: 5 },
    ])
    render(<PartsTracking />)
    // `parts-low-stock` now only exists once the read has settled, so finding it IS
    // waiting for the counted state — there is no earlier paint to race against.
    const lowStock = await screen.findByTestId('parts-low-stock')
    await waitFor(() => expect(lowStock).toHaveTextContent('1'))
    expect(screen.getByTestId('part-row-p1')).toHaveTextContent('Low Stock')
  })
})

describe('the inventory value states what it covers', () => {
  it('excludes an unpriced part and says the total is higher', async () => {
    fetchMechanicParts.mockResolvedValue([
      { id: 'p1', name: 'A', sku: 'A-1', stock_level: 3, unit_price: 10 },
      { id: 'p2', name: 'B', sku: 'B-1', stock_level: 100, unit_price: null },
    ])
    render(<PartsTracking />)
    expect(await screen.findByTestId('parts-value')).toHaveTextContent('$30')
    expect(screen.getByTestId('parts-value-coverage')).toHaveTextContent(/1 of 2/)
    expect(screen.getByTestId('parts-value-coverage')).toHaveTextContent(/higher/i)
  })

  it('states no coverage shortfall when every part is priced', async () => {
    fetchMechanicParts.mockResolvedValue([
      { id: 'p1', name: 'A', sku: 'A-1', stock_level: 2, unit_price: 5 },
    ])
    render(<PartsTracking />)
    expect(await screen.findByTestId('parts-value')).toHaveTextContent('$10')
    expect(screen.queryByTestId('parts-value-coverage')).toBeNull()
  })
})

describe('no control confirms an action it did not perform', () => {
  it('offers no invoice upload, because nothing stored the file', async () => {
    fetchMechanicParts.mockResolvedValue([
      { id: 'p1', name: 'A', sku: 'A-1', stock_level: 2, unit_price: 5 },
    ])
    render(<PartsTracking />)
    await screen.findByTestId('part-row-p1')
    expect(screen.queryByText(/upload invoice/i)).toBeNull()
  })
})
