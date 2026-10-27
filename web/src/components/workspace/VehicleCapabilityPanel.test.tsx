import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { VehicleCapabilities } from '@/types'
import { VehicleCapabilityCells, VehicleCapabilityPanel } from './VehicleCapabilityPanel'

const SERENA = 'GFC27-027051'
const VEZEL = 'RU3-1316558'
const ORDER = '3e2b66a0-1e8b-43c9-bd48-507f88016f71'

const renderPanel = (vin: string, capabilities: VehicleCapabilities | null | undefined) =>
  render(<MemoryRouter><VehicleCapabilityPanel vin={vin} capabilities={capabilities} /></MemoryRouter>)

describe('VehicleCapabilityPanel — Serena: an owned vehicle with a local Marketplace sale', () => {
  const capabilities: VehicleCapabilities = { marketplace: { state: 'published' }, trade_import: { state: 'none' } }

  it('shows the Marketplace state and Manage listing, and NOTHING about an import journey', () => {
    renderPanel(SERENA, capabilities)
    expect(screen.getByTestId('capability-marketplace')).toHaveAttribute('data-state', 'published')
    expect(screen.getByRole('link', { name: /Manage listing/ })).toHaveAttribute('href', '/dashboard/listings')
    expect(screen.queryByTestId('capability-trade-import')).toBeNull()
    expect(screen.queryByText(/CAP/)).toBeNull()
    expect(screen.queryByText(/import/i)).toBeNull()
    expect(screen.queryByRole('link', { name: /journey|CAP/i })).toBeNull()
  })

  it('keeps the Seller Studio reachable — "Edit listing details" follows the primary action and opens the Studio for THIS vehicle', () => {
    renderPanel(SERENA, capabilities)
    const links = within(screen.getByTestId('capability-marketplace')).getAllByRole('link')
    expect(links.map((link) => link.textContent?.trim())).toEqual(['Manage listing', 'Edit listing details'])
    expect(screen.getByTestId('capability-action-edit-details')).toHaveAttribute('href', `/dashboard/sell-vehicle?vin=${SERENA}`)
  })

  it('a sold vehicle offers no edit entry, and a failed read offers no action at all', () => {
    const sold = renderPanel(SERENA, { marketplace: { state: 'sold' }, trade_import: { state: 'none' } })
    expect(screen.queryByTestId('capability-action-edit-details')).toBeNull()
    sold.unmount()
    renderPanel(SERENA, { marketplace: { state: 'unavailable' }, trade_import: { state: 'none' } })
    expect(within(screen.getByTestId('capability-marketplace')).queryAllByRole('link')).toHaveLength(0)
  })
})

describe('VehicleCapabilityPanel — Vezel: an owned vehicle with an import journey', () => {
  it('shows two independent capabilities, each with its own state and action', () => {
    renderPanel(VEZEL, { marketplace: { state: 'not_listed' }, trade_import: { state: 'single', order_id: ORDER } })
    expect(screen.getByTestId('capability-marketplace')).toHaveAttribute('data-state', 'not_listed')
    expect(screen.getByTestId('capability-trade-import')).toHaveAttribute('data-state', 'single')
    expect(screen.getByRole('link', { name: /Sell this vehicle/ })).toHaveAttribute('href', `/dashboard/sell-vehicle?vin=${VEZEL}`)
    expect(screen.getByRole('link', { name: /View CAP/ })).toHaveAttribute('href', `/diaspora/journey/import_order/${ORDER}`)
    expect(screen.getByRole('link', { name: 'Import order' })).toHaveAttribute('href', `/diaspora/imports/${ORDER}`)
  })

  it('the Vezel and the Serena share the SAME Marketplace cell structure — only the facts differ', () => {
    const serena = renderPanel(SERENA, { marketplace: { state: 'published' }, trade_import: { state: 'none' } })
    const serenaShape = Array.from(serena.container.querySelectorAll('[data-testid="capability-marketplace"] > *')).map((node) => node.tagName)
    serena.unmount()
    const vezel = renderPanel(VEZEL, { marketplace: { state: 'not_listed' }, trade_import: { state: 'single', order_id: ORDER } })
    const vezelShape = Array.from(vezel.container.querySelectorAll('[data-testid="capability-marketplace"] > *')).map((node) => node.tagName)
    expect(vezelShape).toEqual(serenaShape)
  })

  it('several import journeys -> one chooser link, not a guess', () => {
    renderPanel(VEZEL, { marketplace: { state: 'not_listed' }, trade_import: { state: 'multiple', count: 2 } })
    expect(screen.getByRole('link', { name: /Choose import journey/ })).toHaveAttribute('href', `/diaspora/journey/vehicle/${VEZEL}`)
    expect(screen.queryByRole('link', { name: /View CAP/ })).toBeNull()
  })

  it('an import check that failed is shown as a fault, offers no CAP link, and leaves Marketplace untouched', () => {
    renderPanel(VEZEL, { marketplace: { state: 'not_listed' }, trade_import: { state: 'unavailable' } })
    const trade = screen.getByTestId('capability-trade-import')
    expect(trade).toHaveAttribute('data-state', 'unavailable')
    expect(trade).toHaveTextContent(/not a report that there are none/)
    expect(screen.queryByRole('link', { name: /CAP/ })).toBeNull()
    expect(screen.getByRole('link', { name: /Sell this vehicle/ })).toBeInTheDocument()
  })

  it('a Marketplace read that failed does not hide a real import journey', () => {
    renderPanel(VEZEL, { marketplace: { state: 'unavailable' }, trade_import: { state: 'single', order_id: ORDER } })
    expect(screen.getByTestId('capability-marketplace')).toHaveAttribute('data-state', 'unavailable')
    expect(screen.queryByRole('link', { name: /Sell this vehicle/ })).toBeNull()
    expect(screen.getByRole('link', { name: /View CAP/ })).toBeInTheDocument()
  })
})

describe('VehicleCapabilityPanel — absence', () => {
  it('renders nothing when the server sent no capabilities (not the owner): absent is not "none"', () => {
    for (const capabilities of [null, undefined]) {
      const view = renderPanel(VEZEL, capabilities)
      expect(view.container).toBeEmptyDOMElement()
      view.unmount()
    }
  })
})

describe('VehicleCapabilityCells — embedded in a host grid', () => {
  it('lets the host keep its own stable test ids for the actions', () => {
    render(
      <MemoryRouter>
        <div>
          <VehicleCapabilityCells
            vin={SERENA}
            capabilities={{ marketplace: { state: 'published' }, trade_import: { state: 'none' } }}
            actionTestId={(action) => `garage-${action.kind}-${SERENA}`}
          />
        </div>
      </MemoryRouter>,
    )
    expect(screen.getByTestId(`garage-manage-${SERENA}`)).toHaveAttribute('href', '/dashboard/listings')
  })
})
