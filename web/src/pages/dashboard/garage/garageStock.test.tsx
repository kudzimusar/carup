import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fetchGarageStock = vi.fn()
const fetchGaragePart = vi.fn()
const createGaragePart = vi.fn()
const updateGaragePart = vi.fn()
const receiveGarageStock = vi.fn()
const countGarageStock = vi.fn()
let activeTenantRole = 'admin'

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', active_tenant: { type: 'garage', role: activeTenantRole } } }),
}))

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchGarageStock, fetchGaragePart, createGaragePart, updateGaragePart, receiveGarageStock, countGarageStock }),
}))

const { default: GarageStock } = await import('./GarageStock')

function part(over: Record<string, unknown>) {
  return {
    id: 'p-x', name: 'Part', sku: 'SKU', stock_level: 5, stock_state: 'in_stock', counted: true, min_stock: null,
    supplier: null, unit_cost: null, sell_price: null, price_currency: null, legacy_unit_price: null,
    legacy_price_currency_unknown: false, is_active: true, last_movement_at: '2026-10-20T08:00:00Z', updated_at: '2026-10-20T08:00:00Z',
    ...over,
  }
}

const unknownPart = part({ id: 'p-unknown', name: 'Wiper blade', sku: 'WB-1', stock_level: null, stock_state: 'unknown', counted: null, last_movement_at: null })
const uncountedPart = part({ id: 'p-uncounted', name: 'Oil filter', sku: 'OF-1', stock_level: 14, stock_state: 'uncounted', counted: false, legacy_unit_price: '5.50', legacy_price_currency_unknown: true, last_movement_at: null })
const outPart = part({ id: 'p-out', name: 'Brake disc', sku: 'BD-1', stock_level: 0, stock_state: 'out', min_stock: 2 })
const lowPart = part({
  id: 'p-low', name: 'Alternator', sku: 'ALT-9', stock_level: 1, stock_state: 'low', min_stock: 3,
  supplier: 'Zim Auto Spares', unit_cost: '15.00', sell_price: '25.00', price_currency: 'USD',
})
const noThresholdPart = part({ id: 'p-ok', name: 'Spark plug', sku: 'SP-4', stock_level: 1, stock_state: 'in_stock', min_stock: null })

const stockList = {
  money_visible: true,
  parts: [unknownPart, uncountedPart, outPart, lowPart, noThresholdPart],
  // deliberately not the counts of the rows above: the page must show the SERVER's numbers
  summary: { total: 5, out: 3, low: 2, uncounted: 4, unknown: 6 },
}

const movements = [
  { id: 'm2', seq: 2, movement_type: 'receipt', quantity_delta: 5, balance_before: 7, balance_after: 12, reason_code: 'supplier_delivery', note: 'Van load', work_order_id: null, service_record_id: null, actor_user_id: 'u1', created_at: '2026-10-21T08:00:00Z' },
  { id: 'm1', seq: 1, movement_type: 'opening', quantity_delta: 7, balance_before: 0, balance_after: 7, reason_code: null, note: null, work_order_id: null, service_record_id: null, actor_user_id: 'u1', created_at: '2026-10-20T08:00:00Z' },
]

function renderPage() {
  return render(<MemoryRouter><GarageStock /></MemoryRouter>)
}

function cardOf(name: string): HTMLElement {
  const card = screen.getByRole('heading', { name, level: 3 }).closest('[data-testid="stock-part"]')
  if (!card) throw new Error(`no card for ${name}`)
  return card as HTMLElement
}

async function openHistory(name: string, row = lowPart) {
  fetchGaragePart.mockResolvedValue({ part: row, movements })
  fireEvent.click(await screen.findByRole('button', { name: `Show stock history for ${name}` }))
  await screen.findByTestId('stock-ledger')
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

beforeEach(() => {
  vi.clearAllMocks()
  activeTenantRole = 'admin'
  fetchGarageStock.mockResolvedValue(structuredClone(stockList))
  fetchGaragePart.mockResolvedValue({ part: lowPart, movements })
  createGaragePart.mockResolvedValue({ part: lowPart, movements })
  updateGaragePart.mockResolvedValue({ part: lowPart, movements })
  receiveGarageStock.mockResolvedValue({ part: lowPart, movements })
  countGarageStock.mockResolvedValue({ part: lowPart, movements })
})

describe('GARAGE-1.0 stock: what a quantity says', () => {
  it('shows an unknown quantity as unknown, never as 0', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Wiper blade' })
    const card = within(cardOf('Wiper blade'))
    expect(screen.getByTestId('stock-state-p-unknown')).toHaveTextContent('Quantity unknown')
    const quantity = screen.getByTestId('part-quantity-p-unknown')
    expect(quantity).toHaveTextContent('No quantity on record')
    expect(quantity.textContent).not.toMatch(/\d/)
    expect(card.queryByText(/on hand/i)).toBeNull()
  })

  it('shows an uncounted quantity as not counted yet, with the legacy number labelled unverified', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Oil filter' })
    expect(screen.getByTestId('stock-state-p-uncounted')).toHaveTextContent('Not counted yet')
    const quantity = screen.getByTestId('part-quantity-p-uncounted')
    expect(quantity).toHaveTextContent(/legacy quantity 14/i)
    expect(quantity).toHaveTextContent(/unverified/i)
    expect(quantity.textContent).not.toMatch(/14 on hand/)
  })

  it('shows out of stock as a real zero, and low only because the server said low', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Brake disc' })
    expect(screen.getByTestId('stock-state-p-out')).toHaveTextContent('Out of stock')
    expect(screen.getByTestId('part-quantity-p-out')).toHaveTextContent('0 on hand')
    expect(screen.getByTestId('stock-state-p-low')).toHaveTextContent('Low stock')
    expect(screen.getByTestId('part-reorder-p-low')).toHaveTextContent('3')
  })

  it('never calls a part without a reorder level "low", even with one unit left', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Spark plug' })
    expect(screen.getByTestId('stock-state-p-ok')).toHaveTextContent('In stock')
    expect(screen.getByTestId('part-reorder-p-ok')).toHaveTextContent('No reorder level set')
    expect(within(cardOf('Spark plug')).queryByText(/low stock/i)).toBeNull()
  })

  it('shows the server\'s summary counts, not counts worked out in the browser', async () => {
    renderPage()
    await screen.findByTestId('stock-summary')
    expect(screen.getByTestId('stock-chip-out')).toHaveTextContent('Out of stock3')
    expect(screen.getByTestId('stock-chip-low')).toHaveTextContent('Low stock2')
    expect(screen.getByTestId('stock-chip-uncounted')).toHaveTextContent('Not counted yet4')
    expect(screen.getByTestId('stock-chip-unknown')).toHaveTextContent('Quantity unknown6')
  })

  it('states supplier exactly as given or "Not stated", prices with their currency, and the legacy price as not money', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Alternator' })
    expect(screen.getByTestId('part-supplier-p-low')).toHaveTextContent('Zim Auto Spares')
    expect(screen.getByTestId('part-supplier-p-out')).toHaveTextContent('Not stated')
    expect(screen.getByTestId('part-sell-price-p-low')).toHaveTextContent('25.00 USD')
    expect(screen.getByTestId('part-unit-cost-p-low')).toHaveTextContent('15.00 USD')
    expect(screen.getByTestId('part-sell-price-p-out')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('part-unit-cost-p-out')).toHaveTextContent('Not recorded')
    const legacy = screen.getByTestId('part-legacy-price-p-uncounted')
    expect(legacy).toHaveTextContent('Legacy price (currency unknown)')
    expect(legacy).toHaveTextContent('5.50')
    expect(legacy.textContent).not.toMatch(/USD|ZWG|ZAR|\$/)
    expect(screen.queryByTestId('part-legacy-price-p-out')).toBeNull()
    expect(document.body.textContent).not.toMatch(/verified supplier|internal supplier/i)
  })

  it('does not render a failed read as an empty store room', async () => {
    fetchGarageStock.mockRejectedValue(new Error('network'))
    renderPage()
    expect(await screen.findByTestId('stock-load-error')).toHaveTextContent(/loading problem/i)
    expect(screen.queryByTestId('stock-empty')).toBeNull()
    expect(screen.queryByTestId('stock-summary')).toBeNull()
  })

  it('says a store with no parts is empty only after a successful read', async () => {
    fetchGarageStock.mockResolvedValue({ parts: [], summary: { total: 0, out: 0, low: 0, uncounted: 0, unknown: 0 } })
    renderPage()
    expect(await screen.findByTestId('stock-empty')).toHaveTextContent('No parts are recorded yet')
  })
})

describe('GARAGE-1.0 stock: money is the admin\'s, and hidden is not "Not recorded"', () => {
  // what the server sends a mechanic: every cost and price redacted to null, money_visible false
  const redacted = (row: Record<string, unknown>) => ({
    ...row, unit_cost: null, sell_price: null, legacy_unit_price: null, legacy_price_currency_unknown: false,
  })
  const mechanicList = () => ({
    money_visible: false,
    parts: stockList.parts.map(redacted),
    summary: stockList.summary,
  })

  it('renders no price, cost or legacy-price UI at all for a mechanic', async () => {
    activeTenantRole = 'mechanic'
    fetchGarageStock.mockResolvedValue(mechanicList())
    renderPage()
    await screen.findByRole('heading', { name: 'Alternator' })
    expect(screen.getAllByTestId('stock-part')).toHaveLength(5)
    expect(screen.queryAllByTestId(/^part-sell-price-/)).toHaveLength(0)
    expect(screen.queryAllByTestId(/^part-unit-cost-/)).toHaveLength(0)
    expect(screen.queryAllByTestId(/^part-legacy-price-/)).toHaveLength(0)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/sell price|unit cost|legacy price|not recorded|price|cost/i)
    // what a mechanic is entitled to still shows
    expect(screen.getByTestId('part-quantity-p-low')).toHaveTextContent('1 on hand')
    expect(screen.getByTestId('part-supplier-p-low')).toHaveTextContent('Zim Auto Spares')
    expect(screen.getByTestId('stock-state-p-low')).toHaveTextContent('Low stock')
  })

  it('still shows a mechanic the quantities and states of every part', async () => {
    activeTenantRole = 'mechanic'
    fetchGarageStock.mockResolvedValue(mechanicList())
    renderPage()
    await screen.findByRole('heading', { name: 'Wiper blade' })
    expect(screen.getByTestId('stock-state-p-unknown')).toHaveTextContent('Quantity unknown')
    expect(screen.getByTestId('part-quantity-p-uncounted')).toHaveTextContent(/legacy quantity 14/i)
    expect(screen.getByTestId('part-quantity-p-out')).toHaveTextContent('0 on hand')
  })

  it('treats a response with no money_visible flag as hidden rather than inventing "Not recorded"', async () => {
    const { money_visible: _flag, ...withoutFlag } = mechanicList()
    fetchGarageStock.mockResolvedValue(withoutFlag)
    renderPage()
    await screen.findByRole('heading', { name: 'Alternator' })
    expect(screen.queryAllByTestId(/^part-sell-price-/)).toHaveLength(0)
    expect(document.body.textContent).not.toMatch(/not recorded/i)
  })

  it('still says "Not recorded" for a genuinely null price when the admin may see money', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Brake disc' })
    expect(screen.getByTestId('part-sell-price-p-out')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('part-unit-cost-p-out')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('part-sell-price-p-low')).toHaveTextContent('25.00 USD')
    expect(screen.getAllByTestId(/^part-sell-price-/)).toHaveLength(5)
  })

  it('hides prices for a part the server flags as redacted even inside a visible list', async () => {
    fetchGarageStock.mockResolvedValue({ ...structuredClone(stockList), parts: [{ ...lowPart, money_visible: false, sell_price: null, unit_cost: null }, outPart] })
    renderPage()
    await screen.findByRole('heading', { name: 'Alternator' })
    expect(screen.queryByTestId('part-sell-price-p-low')).toBeNull()
    expect(screen.getByTestId('part-sell-price-p-out')).toHaveTextContent('Not recorded')
  })
})

describe('GARAGE-1.0 stock: finding parts', () => {
  it('filters by name or SKU and by stock state', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Alternator' })
    type('Search by name or SKU', 'alt-9')
    expect(screen.getAllByTestId('stock-part')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Alternator' })).toBeInTheDocument()
    type('Search by name or SKU', '')
    fireEvent.change(screen.getByLabelText('Stock state'), { target: { value: 'uncounted' } })
    expect(screen.getAllByTestId('stock-part')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Oil filter' })).toBeInTheDocument()
    expect(screen.getByTestId('stock-shown')).toHaveTextContent('1 of 5 shown')
  })

  it('lets a summary chip act as the state filter', async () => {
    renderPage()
    await screen.findByTestId('stock-summary')
    fireEvent.click(screen.getByTestId('stock-chip-out'))
    expect(screen.getByTestId('stock-chip-out')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByTestId('stock-part')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Brake disc' })).toBeInTheDocument()
  })

  it('asks the server for inactive parts only when asked', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Alternator' })
    expect(fetchGarageStock).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByLabelText('Show inactive parts'))
    await waitFor(() => expect(fetchGarageStock).toHaveBeenLastCalledWith(true))
  })
})

describe('GARAGE-1.0 stock: the ledger', () => {
  it('shows a part\'s movements as read-only history', async () => {
    renderPage()
    await openHistory('Alternator')
    const rows = screen.getAllByTestId('stock-movement')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Stock received')
    expect(rows[0]).toHaveTextContent('+5')
    expect(rows[0]).toHaveTextContent('Balance 7 to 12')
    expect(rows[0]).toHaveTextContent('Reason: supplier delivery')
    expect(rows[0]).toHaveTextContent('Van load')
    expect(rows[1]).toHaveTextContent('Opening quantity')
    expect(screen.getByTestId('stock-ledger').querySelectorAll('button, input, select, textarea, a')).toHaveLength(0)
    expect(fetchGaragePart).toHaveBeenCalledWith('p-low')
  })

  it('says so when a failed history read is a loading problem', async () => {
    fetchGaragePart.mockRejectedValue(new Error('history unavailable'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Show stock history for Alternator' }))
    expect(await screen.findByTestId('part-detail-error')).toHaveTextContent('history unavailable')
    expect(screen.queryByTestId('stock-ledger-empty')).toBeNull()
  })
})

describe('GARAGE-1.0 stock: who can manage', () => {
  it('offers a mechanic the stock to read and no way to change it', async () => {
    activeTenantRole = 'mechanic'
    renderPage()
    await openHistory('Alternator')
    expect(screen.getByTestId('stock-read-only-note')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add a part' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Receive stock' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Count stock' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit part' })).toBeNull()
    expect(screen.queryByTestId('part-admin-controls')).toBeNull()
  })

  it('offers the garage admin every management control', async () => {
    renderPage()
    await openHistory('Alternator')
    expect(screen.getByRole('button', { name: 'Add a part' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Receive stock' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Count stock' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit part' })).toBeInTheDocument()
    expect(screen.queryByTestId('stock-read-only-note')).toBeNull()
  })
})

describe('GARAGE-1.0 stock: adding a part', () => {
  async function openCreate() {
    renderPage()
    await screen.findByRole('heading', { name: 'Alternator' })
    fireEvent.click(screen.getByRole('button', { name: 'Add a part' }))
    return screen.getByTestId('create-part-form')
  }
  const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Add part' }))

  it('does not pre-fill the opening quantity and refuses to submit while it is blank', async () => {
    await openCreate()
    expect(screen.getByLabelText('Opening quantity')).toHaveValue('')
    type('Part name', 'Clutch kit')
    type('SKU', 'CK-1')
    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(/opening quantity/i)
    expect(createGaragePart).not.toHaveBeenCalled()
  })

  it('sends an opening quantity of 0 explicitly, with a stable key, and no price or currency it was not given', async () => {
    await openCreate()
    type('Part name', '  Clutch kit ')
    type('SKU', 'CK-1')
    type('Opening quantity', '0')
    submit()
    await waitFor(() => expect(createGaragePart).toHaveBeenCalledTimes(1))
    const body = createGaragePart.mock.calls[0][0]
    expect(body).toMatchObject({ name: 'Clutch kit', sku: 'CK-1', opening_quantity: 0 })
    expect(Object.is(body.opening_quantity, 0)).toBe(true)
    expect(typeof body.idempotency_key).toBe('string')
    expect(body.idempotency_key.length).toBeGreaterThanOrEqual(8)
    for (const key of ['unit_cost', 'sell_price', 'price_currency', 'min_stock', 'supplier']) expect(body).not.toHaveProperty(key)
    await waitFor(() => expect(screen.queryByTestId('create-part-form')).toBeNull())
    expect(await screen.findByTestId('stock-notice')).toHaveTextContent(/part was added/i)
  })

  it('blocks a price without a currency before any request is made', async () => {
    await openCreate()
    type('Part name', 'Clutch kit')
    type('SKU', 'CK-1')
    type('Opening quantity', '4')
    type('Sell price (optional)', '49.90')
    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(/currency/i)
    expect(createGaragePart).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Currency of the prices')).toHaveValue('')
  })

  it('sends prices as decimal strings with an upper-case currency once one is given', async () => {
    await openCreate()
    type('Part name', 'Clutch kit')
    type('SKU', 'CK-1')
    type('Opening quantity', '4')
    type('Reorder level (optional)', '2')
    type('Supplier (optional)', 'Harare Spares')
    type('Unit cost (optional)', '30')
    type('Sell price (optional)', '49.90')
    type('Currency of the prices', 'usd')
    submit()
    await waitFor(() => expect(createGaragePart).toHaveBeenCalledTimes(1))
    expect(createGaragePart.mock.calls[0][0]).toMatchObject({
      opening_quantity: 4, min_stock: 2, supplier: 'Harare Spares', unit_cost: '30', sell_price: '49.90', price_currency: 'USD',
    })
  })

  it('re-sends the SAME idempotency key on a retry, shows the server\'s message, and uses a new key for a new form', async () => {
    createGaragePart.mockRejectedValueOnce(new Error('A part with that SKU already exists in this garage.'))
    await openCreate()
    type('Part name', 'Clutch kit')
    type('SKU', 'CK-1')
    type('Opening quantity', '4')
    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent('A part with that SKU already exists in this garage.')
    fireEvent.change(screen.getByLabelText('SKU'), { target: { value: 'CK-2' } })
    submit()
    await waitFor(() => expect(createGaragePart).toHaveBeenCalledTimes(2))
    const [first, second] = createGaragePart.mock.calls.map((c) => c[0])
    expect(second.idempotency_key).toBe(first.idempotency_key)
    expect(second.sku).toBe('CK-2')

    await waitFor(() => expect(screen.queryByTestId('create-part-form')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Add a part' }))
    type('Part name', 'Gasket')
    type('SKU', 'G-1')
    type('Opening quantity', '1')
    submit()
    await waitFor(() => expect(createGaragePart).toHaveBeenCalledTimes(3))
    expect(createGaragePart.mock.calls[2][0].idempotency_key).not.toBe(first.idempotency_key)
  })

  it('reloads the totals from the server after a part is added', async () => {
    await openCreate()
    type('Part name', 'Clutch kit')
    type('SKU', 'CK-1')
    type('Opening quantity', '3')
    submit()
    await waitFor(() => expect(fetchGarageStock).toHaveBeenCalledTimes(2))
  })
})

describe('GARAGE-1.0 stock: receiving, counting, editing', () => {
  it('refuses a blank or zero received quantity, then sends the quantity and one stable key across a retry', async () => {
    receiveGarageStock.mockRejectedValueOnce(new Error('Only a garage administrator can manage stock.'))
    renderPage()
    await openHistory('Alternator')
    fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }))
    const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Record received stock' }))

    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(/whole number greater than zero/i)
    type('Quantity received', '0')
    submit()
    expect(receiveGarageStock).not.toHaveBeenCalled()

    type('Quantity received', '6')
    type('Reason (optional)', 'supplier delivery')
    submit()
    expect(await screen.findByText('Only a garage administrator can manage stock.')).toBeInTheDocument()
    submit()
    await waitFor(() => expect(receiveGarageStock).toHaveBeenCalledTimes(2))
    const [a, b] = receiveGarageStock.mock.calls
    expect(a[0]).toBe('p-low')
    expect(a[1]).toMatchObject({ quantity: 6, reason: 'supplier delivery' })
    expect(b[1].idempotency_key).toBe(a[1].idempotency_key)
    await waitFor(() => expect(screen.queryByTestId('receive-stock-form')).toBeNull())
    expect(await screen.findByTestId('stock-notice')).toHaveTextContent(/recorded as received/i)
  })

  it('sends a counted quantity of 0 as 0 and shows the server\'s reason rule if it refuses', async () => {
    countGarageStock.mockRejectedValueOnce(new Error('Give a reason.'))
    renderPage()
    await openHistory('Alternator')
    fireEvent.click(screen.getByRole('button', { name: 'Count stock' }))
    const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Record count' }))

    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter the quantity you counted/i)
    expect(countGarageStock).not.toHaveBeenCalled()

    type('Counted quantity', '0')
    submit()
    expect(await screen.findByText('Give a reason.')).toBeInTheDocument()
    type('Reason for the count', 'shelf recount')
    submit()
    await waitFor(() => expect(countGarageStock).toHaveBeenCalledTimes(2))
    const [a, b] = countGarageStock.mock.calls
    expect(Object.is(a[1].counted_quantity, 0)).toBe(true)
    expect(b[1]).toMatchObject({ counted_quantity: 0, reason: 'shelf recount' })
    expect(b[1].idempotency_key).toBe(a[1].idempotency_key)
  })

  it('edits everything except the quantity, and sends only what changed', async () => {
    renderPage()
    await openHistory('Alternator')
    fireEvent.click(screen.getByRole('button', { name: 'Edit part' }))
    const form = within(screen.getByTestId('edit-part-form'))
    expect(form.queryByLabelText(/quantity/i)).toBeNull()
    expect(form.getByLabelText('Part name')).toHaveValue('Alternator')
    expect(form.getByLabelText('Supplier')).toHaveValue('Zim Auto Spares')
    expect(form.getByLabelText('Reorder level')).toHaveValue('3')

    fireEvent.click(form.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing has changed.')
    expect(updateGaragePart).not.toHaveBeenCalled()

    fireEvent.change(form.getByLabelText('Reorder level'), { target: { value: '' } })
    fireEvent.change(form.getByLabelText('Sell price'), { target: { value: '27.50' } })
    fireEvent.click(form.getByLabelText('This part is active'))
    fireEvent.click(form.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(updateGaragePart).toHaveBeenCalledTimes(1))
    expect(updateGaragePart).toHaveBeenCalledWith('p-low', { min_stock: null, sell_price: '27.50', price_currency: 'USD', is_active: false })
  })

  it('keeps the currency of a recorded price fixed', async () => {
    renderPage()
    await openHistory('Alternator')
    fireEvent.click(screen.getByRole('button', { name: 'Edit part' }))
    expect(within(screen.getByTestId('edit-part-form')).getByLabelText('Currency of the prices')).toHaveAttribute('readonly')
  })

  it('blocks a price typed without a currency on an unpriced part', async () => {
    fetchGaragePart.mockResolvedValue({ part: noThresholdPart, movements: [] })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Show stock history for Spark plug' }))
    await screen.findByTestId('stock-ledger-empty')
    fireEvent.click(screen.getByRole('button', { name: 'Edit part' }))
    const form = within(screen.getByTestId('edit-part-form'))
    expect(form.getByLabelText('Currency of the prices')).not.toHaveAttribute('readonly')
    fireEvent.change(form.getByLabelText('Sell price'), { target: { value: '9.99' } })
    fireEvent.click(form.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/currency/i)
    expect(updateGaragePart).not.toHaveBeenCalled()
  })
})
