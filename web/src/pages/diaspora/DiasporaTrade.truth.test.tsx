/**
 * RX03-P2-R4 — Trade truth: the required-document checklist reflects the order's REAL documents,
 * and the timeline reads the full order lifecycle. Both modes (these were defects, not styling).
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const ORDER = {
  id: '298031dc-0000-4000-8000-000000000001', order_type: 'vehicle', origin_country: 'Japan', destination_country: 'Zimbabwe',
  requested_make: 'Toyota', requested_model: 'Aqua', status: 'DUTY_PAID',
  diaspora_trade_documents: [
    { id: 'd1', document_type: 'bill_of_lading', verification_status: 'VERIFIED' },
    { id: 'd2', document_type: 'passport', verification_status: 'UPLOADED' },
  ],
}
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: 'owner' }, isAuthenticated: true, loading: false }) }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ fetchDiasporaImportOrder: async () => ORDER }) }))
vi.mock('@/components/diaspora/PaymentMilestonesCard', () => ({ default: () => <div>payments</div> }))
vi.mock('@/components/intelligence/TradeIntelligence', () => ({ default: () => <div>intel</div> }))

async function renderDetail() {
  const { DiasporaImportDetail } = await import('./DiasporaTrade')
  render(
    <MemoryRouter initialEntries={[`/diaspora/imports/${ORDER.id}`]}>
      <Routes><Route path="/diaspora/imports/:id" element={<DiasporaImportDetail />} /></Routes>
    </MemoryRouter>,
  )
  await screen.findByTestId('diaspora-document-checklist')
}

describe('required documents and lifecycle (flags OFF)', () => {
  it('rows reflect matching uploaded types and their real review state', async () => {
    await renderDetail()
    expect(screen.getByTestId('diaspora-document-status-0')).toHaveTextContent('Uploaded') // passport → identity
    expect(screen.getByTestId('diaspora-document-status-1')).toHaveTextContent('Pending')
    expect(screen.getByTestId('diaspora-document-status-3')).toHaveTextContent('Verified') // bill of lading
    expect(screen.getByTestId('diaspora-document-status-4')).toHaveTextContent('Pending')
  })
  it('a status between milestones (DUTY_PAID) lights every milestone it has passed, not just the first', async () => {
    await renderDetail()
    const items = screen.getAllByTestId('diaspora-timeline-item')
    const reached = items.filter(i => i.querySelector('.bg-orange-600')).map(i => i.textContent)
    expect(reached).toEqual(['Import Requested', 'Documents Pending', 'Documents Verified', 'Container Booked', 'Shipped', 'Customs In Progress'])
  })
})
