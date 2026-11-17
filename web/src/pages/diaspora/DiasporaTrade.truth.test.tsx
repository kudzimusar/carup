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

/* ── RX03-P2-R5 TRADE-01 — next step, documents and lifecycle never overstate progress ─────── */
import { act, cleanup } from '@testing-library/react'

const ALL_TYPES = ['passport', 'commercial_invoice', 'export_certificate', 'bill_of_lading', 'customs_declaration']
const doc = (id: string, type: string, status: string, created_at = '2026-11-10T10:00:00Z') => ({ id, document_type: type, verification_status: status, created_at })
const allVerified = () => ALL_TYPES.map((t, i) => doc('v' + i, t, 'VERIFIED'))
let unified = false
vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => unified }))

async function renderWith(order: Record<string, unknown>, opts: { unified?: boolean } = {}) {
  unified = !!opts.unified
  Object.assign(ORDER, { status: 'DOCUMENTS_PENDING', diaspora_trade_documents: [] }, order)
  const { DiasporaImportDetail } = await import('./DiasporaTrade')
  let view: ReturnType<typeof render> | null = null
  await act(async () => {
    view = render(
      <MemoryRouter initialEntries={[`/diaspora/imports/${ORDER.id}`]}>
        <Routes><Route path="/diaspora/imports/:id" element={<DiasporaImportDetail />} /></Routes>
      </MemoryRouter>,
    )
  })
  await screen.findByTestId('diaspora-document-checklist')
  return view!
}
const nextStep = () => screen.getByTestId('trade-next-step').textContent || ''
const rows = () => [0, 1, 2, 3, 4].map(i => screen.getByTestId(`diaspora-document-status-${i}`).textContent)
const lit = () => screen.getAllByTestId('diaspora-timeline-item').filter(i => i.querySelector('.bg-orange-600')).length

describe('TRADE-01 — truthful next step (unified order workbench)', () => {
  it('1 · all required documents genuinely verified → verified result, waiting for a booking', async () => {
    await renderWith({ status: 'DOCUMENTS_VERIFIED', diaspora_trade_documents: allVerified() }, { unified: true })
    expect(rows()).toEqual(['Verified', 'Verified', 'Verified', 'Verified', 'Verified'])
    expect(nextStep()).toMatch(/Required documents are verified/)
  })
  it('2 · one REJECTED, all others verified → never "verified"; asks for that document again', async () => {
    const docs = allVerified(); docs[2] = doc('x', 'export_certificate', 'REJECTED')
    await renderWith({ status: 'DOCUMENTS_PENDING', diaspora_trade_documents: docs }, { unified: true })
    expect(rows()[2]).toBe('Rejected')
    expect(nextStep()).not.toMatch(/verified/i)
    expect(nextStep()).toMatch(/rejected/i)
    expect(nextStep()).toMatch(/export certificate/i)
    expect(screen.getByTestId('trade-next-step-action')).toHaveAttribute('href', `/diaspora/imports/${ORDER.id}/documents`)
  })
  it('3 · rejected AND missing together → the rejection leads; no completed-documents conclusion', async () => {
    await renderWith({ diaspora_trade_documents: [doc('r', 'bill_of_lading', 'REJECTED')] }, { unified: true })
    expect(nextStep()).toMatch(/rejected/i)
    expect(nextStep()).toMatch(/missing|not uploaded/i)
    expect(nextStep()).not.toMatch(/are verified|with CarUp for review/i)
  })
  it('4 · uploaded but not reviewed → awaiting review, never verified', async () => {
    await renderWith({ diaspora_trade_documents: ALL_TYPES.map((t, i) => doc('u' + i, t, i % 2 ? 'PENDING_REVIEW' : 'UPLOADED')) }, { unified: true })
    expect(rows().every(r => r === 'Uploaded')).toBe(true)
    expect(nextStep()).toMatch(/with CarUp for review/)
  })
  it('5 · several submissions for one requirement → the LATEST decides (a later rejection beats an earlier verification); undatable duplicates are "Review needed"', async () => {
    await renderWith({ diaspora_trade_documents: [
      doc('old', 'bill_of_lading', 'VERIFIED', '2026-11-01T10:00:00Z'),
      doc('new', 'bill_of_lading', 'REJECTED', '2026-11-12T10:00:00Z'),
      doc('a', 'export_certificate', 'VERIFIED', ''), doc('b', 'export_certificate', 'REJECTED', ''),
      { ...doc('gone', 'passport', 'VERIFIED'), deleted_at: '2026-11-13T00:00:00Z' },
    ] }, { unified: true })
    expect(rows()[3]).toBe('Rejected')
    expect(rows()[2]).toBe('Review needed')
    expect(rows()[0]).toBe('Pending') // a soft-deleted upload is not a document
  })
  it('6 · an UNKNOWN status → no milestone, no progress, no next action', async () => {
    await renderWith({ status: 'TELEPORTED', diaspora_trade_documents: allVerified() }, { unified: true })
    expect(nextStep()).toMatch(/status .*unavailable|does not recognise/i)
    expect(screen.queryByTestId('trade-next-step-action')).toBeNull()
    expect(lit()).toBe(0)
    expect(screen.getByTestId('trade-shipment-state')).not.toHaveTextContent('Scheduled')
  })
  it.each([['CANCELLED', /cancelled/i], ['DISPUTED', /dispute/i], ['FLAGGED_FOR_REVIEW', /hold|review/i]])('7 · %s → its real outcome, no shipment-progress action, no lit progress', async (status, re) => {
    await renderWith({ status, diaspora_trade_documents: allVerified() }, { unified: true })
    expect(nextStep()).toMatch(re)
    expect(screen.queryByTestId('trade-next-step-action')).toBeNull()
    expect(lit()).toBe(0)
  })
  it('8 · a status BETWEEN milestones lights only the milestones genuinely passed', async () => {
    await renderWith({ status: 'QUOTE_ISSUED', diaspora_trade_documents: [] }, { unified: true })
    expect(lit()).toBe(1)
    cleanup()
    await renderWith({ status: 'ARRIVED_AT_BORDER', diaspora_trade_documents: allVerified() }, { unified: true })
    expect(screen.getAllByTestId('diaspora-timeline-item').filter(i => i.querySelector('.bg-orange-600')).length).toBeGreaterThanOrEqual(5)
  })
  it('10 · flags OFF uses the same corrected document truth (no new controls)', async () => {
    const docs = allVerified(); docs[2] = doc('x', 'export_certificate', 'REJECTED')
    await renderWith({ status: 'TELEPORTED', diaspora_trade_documents: docs })
    expect(rows()[2]).toBe('Rejected')
    expect(screen.queryByTestId('trade-next-step')).toBeNull()
    expect(lit()).toBe(0)
  })
})
