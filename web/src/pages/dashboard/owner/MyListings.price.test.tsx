/**
 * Seller Journey 1.0 / S8 — the seller changes their own price, through the UI.
 *
 * The narrow price route was certified in the previous slice: amount only, no currency, positive
 * numbers, ownership-scoped, audited server-side. What was missing was the human-facing half — the
 * seller still had no control, so the "complete lifecycle without a database write" gate was only
 * true for someone holding an API client.
 *
 * The UI must not loosen a single rule the API tightened:
 *   · it sends the AMOUNT only, and never a currency — the listing's currency is displayed so the
 *     seller can see what they are pricing in, but it is not editable here, because redenominating
 *     an existing listing is not a price change;
 *   · it refuses zero, negative and non-numeric input before the request, and refuses again on the
 *     server — a coerced 0 would publish a free car;
 *   · it changes nothing else. Trust, availability and publication state are untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Vehicle } from '@/types'

vi.setConfig({ testTimeout: 30_000 })

const fetchOwnedVehicles = vi.fn()
const updateVehicleStatus = vi.fn()
const fetchCommunicationThreads = vi.fn()
const publishVehicleListing = vi.fn()
const unpublishVehicleListing = vi.fn()
const updateVehiclePrice = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchOwnedVehicles,
    updateVehicleStatus,
    fetchCommunicationThreads,
    publishVehicleListing,
    unpublishVehicleListing,
    updateVehiclePrice,
  }),
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/components/marketplace/SellerInquiriesCard', () => ({ SellerInquiriesCard: () => null }))

const MyListings = (await import('./MyListings')).default

const VIN = 'JTDKARFP0H3000731'

const listing = (over: Partial<Vehicle> = {}): Vehicle => ({
  vin: VIN,
  make: 'Toyota',
  model: 'Hilux',
  year: 2021,
  price: 28500,
  currency: 'USD',
  status: 'Available',
  publication_status: 'published',
  ...over,
} as Vehicle)

const renderListings = () => render(<MemoryRouter><MyListings /></MemoryRouter>)

async function openPriceEditor() {
  renderListings()
  await waitFor(() => expect(screen.getByTestId(`change-price-${VIN}`)).toBeTruthy())
  fireEvent.click(screen.getByTestId(`change-price-${VIN}`))
  await waitFor(() => expect(screen.getByTestId(`price-input-${VIN}`)).toBeTruthy())
}

const setPrice = (value: string) =>
  fireEvent.change(screen.getByTestId(`price-input-${VIN}`), { target: { value } })

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
  fetchOwnedVehicles.mockResolvedValue([listing()])
  fetchCommunicationThreads.mockResolvedValue({ threads: [] })
  updateVehiclePrice.mockResolvedValue({ success: true, vin: VIN, price: 26000, previous_price: 28500 })
})

describe('S8 seller price change', () => {
  it('offers a price control on a listing the seller owns', async () => {
    renderListings()
    await waitFor(() => expect(screen.getByTestId(`change-price-${VIN}`)).toBeTruthy())
  })

  it('sends the amount alone, never a currency', async () => {
    await openPriceEditor()
    setPrice('26000')
    fireEvent.click(screen.getByTestId(`price-save-${VIN}`))

    await waitFor(() => expect(updateVehiclePrice).toHaveBeenCalled())
    // Exactly two arguments: the VIN and a number. A currency here would let a seller silently
    // redenominate an existing listing.
    expect(updateVehiclePrice).toHaveBeenCalledWith(VIN, 26000)
    expect(updateVehiclePrice.mock.calls[0]).toHaveLength(2)
  })

  it('shows the currency it is pricing in without making it editable', async () => {
    await openPriceEditor()
    const editor = screen.getByTestId(`price-editor-${VIN}`)
    expect(editor.textContent).toContain('USD')
    // A second editable currency field is exactly the redenomination the API refuses.
    expect(screen.queryByTestId(`price-currency-input-${VIN}`)).toBeNull()
  })

  it('refuses a zero, negative or non-numeric price before it reaches the server', async () => {
    await openPriceEditor()
    for (const rejected of ['0', '-100', 'abc', '']) {
      setPrice(rejected)
      fireEvent.click(screen.getByTestId(`price-save-${VIN}`))
      await waitFor(() => expect(toastError).toHaveBeenCalled())
      expect(updateVehiclePrice).not.toHaveBeenCalled()
      toastError.mockClear()
    }
  })

  it('reflects the price the server confirmed, not the one that was typed', async () => {
    // The server is authoritative. Echoing the typed value would show a seller a price that was
    // never stored if the write were adjusted or refused.
    updateVehiclePrice.mockResolvedValue({ success: true, vin: VIN, price: 26000, previous_price: 28500 })
    await openPriceEditor()
    setPrice('26000')
    fireEvent.click(screen.getByTestId(`price-save-${VIN}`))

    await waitFor(() => expect(screen.getByTestId(`listing-price-${VIN}`).textContent).toContain('26,000'))
  })

  it('leaves the displayed price untouched when the server refuses', async () => {
    updateVehiclePrice.mockRejectedValue(new Error('price must be a positive number'))
    await openPriceEditor()
    setPrice('26000')
    fireEvent.click(screen.getByTestId(`price-save-${VIN}`))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(screen.getByTestId(`listing-price-${VIN}`).textContent).toContain('28,500')
  })

  it('changes nothing but the price', async () => {
    await openPriceEditor()
    setPrice('26000')
    fireEvent.click(screen.getByTestId(`price-save-${VIN}`))
    await waitFor(() => expect(updateVehiclePrice).toHaveBeenCalled())

    // A price change is not a publication event, not a sale, and not a trust event.
    expect(publishVehicleListing).not.toHaveBeenCalled()
    expect(unpublishVehicleListing).not.toHaveBeenCalled()
    expect(updateVehicleStatus).not.toHaveBeenCalled()
  })

  it('does not offer a price change on a sold listing', async () => {
    fetchOwnedVehicles.mockResolvedValue([listing({ status: 'Sold' })])
    renderListings()
    await waitFor(() => expect(screen.getByTestId(`my-listing-card-${VIN}`)).toBeTruthy())
    expect(screen.queryByTestId(`change-price-${VIN}`)).toBeNull()
  })

  it('can be cancelled without sending anything', async () => {
    await openPriceEditor()
    setPrice('26000')
    fireEvent.click(screen.getByTestId(`price-cancel-${VIN}`))

    await waitFor(() => expect(screen.queryByTestId(`price-input-${VIN}`)).toBeNull())
    expect(updateVehiclePrice).not.toHaveBeenCalled()
    expect(screen.getByTestId(`listing-price-${VIN}`).textContent).toContain('28,500')
  })
})
