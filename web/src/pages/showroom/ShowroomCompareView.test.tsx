/** RX04-B / I-03 — Buyer Decision Desk: differences, provenance, unknowns; never a "best car" score. */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ShowroomCompareView, type CompareVehicle } from './ShowroomCompareView'

const base: CompareVehicle = {
  vin: 'AAA00000000000001', make: 'Toyota', model: 'Hilux', year: 2018, price: 18500, currency: 'USD', mileage: 120000,
  condition_category: 'used', trust: { score: 72, band: 'good', evaluation_state: 'evaluated', confidence: 'high' },
  trust_summary: { trust_badges: [], risk_status: 'clear', partsentry_public_status: 'not_checked', evidence_status: 'partial' },
  verification_summary: { seller_verified: true, identity_status: 'verified', vehicle_evidence_verified: true, inspection_available: true, inspection_verified: true },
}
const other: CompareVehicle = {
  ...base, vin: 'BBB00000000000002', model: 'Fortuner', price: 21000, mileage: null,
  trust: { score: null, band: null, evaluation_state: 'not_evaluated', confidence: null },
  verification_summary: { seller_verified: false, identity_status: 'unverified', vehicle_evidence_verified: false, inspection_available: false, inspection_verified: false },
}

function renderDesk(entries = [base, other]) {
  render(<MemoryRouter><ShowroomCompareView state="ready" requestedCount={entries.length} entries={entries} onRetry={vi.fn()} onRemove={vi.fn()} /></MemoryRouter>)
}

describe('ShowroomCompareView — Buyer Decision Desk', () => {
  it('marks differing facts and can show only the differences', () => {
    renderDesk()
    const desktop = screen.getByTestId('compare-desktop')
    const yearRow = within(desktop).getByRole('rowheader', { name: /^Year/ }).closest('[role="row"]')!
    const priceRow = within(desktop).getByRole('rowheader', { name: /^Asking price/ }).closest('[role="row"]')!
    expect(yearRow.getAttribute('data-differs')).toBe('false')
    expect(priceRow.getAttribute('data-differs')).toBe('true')
    fireEvent.click(screen.getByTestId('compare-differences-toggle'))
    expect(within(screen.getByTestId('compare-desktop')).queryByRole('rowheader', { name: /^Year/ })).toBeNull()
    expect(within(screen.getByTestId('compare-desktop')).getByRole('rowheader', { name: /^Asking price/ })).toBeInTheDocument()
  })

  it('labels where each fact comes from', () => {
    renderDesk()
    const desktop = screen.getByTestId('compare-desktop')
    expect(within(desktop).getByRole('rowheader', { name: /^Asking price/ })).toHaveTextContent('Seller-stated')
    expect(within(desktop).getByRole('rowheader', { name: /^All-in estimate/ })).toHaveTextContent('Estimate')
    expect(within(desktop).getByRole('rowheader', { name: /^Inspection/ })).toHaveTextContent('Governed record')
  })

  it('lists each car\'s unknowns as questions with a way to ask the seller, and never ranks the cars', () => {
    renderDesk()
    const unknowns = screen.getByTestId('compare-unknowns-BBB00000000000002')
    expect(unknowns).toHaveTextContent('What does the odometer read?')
    expect(unknowns).toHaveTextContent('Will you allow an inspection?')
    expect(screen.getByTestId('compare-ask-BBB00000000000002')).toHaveAttribute('href', '/marketplace/BBB00000000000002#vd-ask')
    expect(screen.getByTestId('compare-unknowns-AAA00000000000001')).toHaveTextContent('No gaps in the facts compared here.')
    expect(document.body.textContent).not.toMatch(/best (car|choice|pick)|winner|recommended/i)
  })
})
