import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CaseHub, CustomerInvoice } from '@/lib/garageBusiness'
import { hubSteps } from '@/lib/garageWorkspace'
import JourneyProgress from '@/components/owner/serviceJourney/JourneyProgress'
import { InvoicesSection } from '@/components/garage/operations/InvoicesSection'

/**
 * CARUP-PAY-04 — found in physical UAT (headed Chromium): the Garage Hub's step list said "Partly paid (recorded by the
 * garage)" while 100.00 of the counted money was confirmed by the garage's payment provider. Every surface that states
 * how an invoice was paid must name the source that actually counts; OPS07's own wording stays wherever only the
 * garage's declarations count.
 */
const PROVIDER_PARTLY = 'Partly paid (confirmed by the garage’s payment provider)'
const providerMoney = { declared_paid: '0.00', provider_paid: '100.00', provider_reserved: '0.00', uncommitted_balance: '35.00' }
const invoice = {
  id: 'inv-1', invoice_number: 'INV-000001', service_case_id: 'case-1', work_order_id: 'wo-1', status: 'issued', currency: 'USD',
  total_amount: '135.00', line_count: 2, customer_note: null, due_date: null, issued_at: '2026-11-02T00:00:00Z', voided_at: null,
  estimate: null, variance: { state: 'no_estimate' }, payment_status: 'partially_paid', paid_amount: '100.00', balance_amount: '35.00',
  payment_source_label: 'Confirmed by the garage’s payment provider. The money is paid to the garage, not to CarUp.',
  lines: [], payments: [], receipts: [], money: providerMoney, provider_payments_supported: true, provider_payments: [], provider_receipts: [],
}

describe('PAY-04: where provider money counts, no surface says "recorded by the garage" alone', () => {
  it('the Garage Hub payment step', () => {
    const hub = {
      case: { status: 'completed' }, work_order: { owner_authorization: 'authorized', assigned_mechanic_user_id: 'm1' },
      estimates: { latest: { status: 'accepted', version: 1 } }, service_records: [{}], parts_used: [], appointment: null,
      money_visible: true, next_action: 'await_payment', closeout: { invoice },
    } as unknown as CaseHub
    expect(hubSteps(hub).find((s) => s.key === 'payment')?.detail).toBe(PROVIDER_PARTLY)
  })

  it('the customer’s journey progress', () => {
    render(<JourneyProgress
      request={{ status: 'completed', requested_at: '2026-11-01T00:00:00Z', accepted_at: '2026-11-01T01:00:00Z', declined_at: null,
        started_at: '2026-11-01T02:00:00Z', completed_at: '2026-11-01T03:00:00Z', cancelled_at: null }}
      appointments={[]} estimates={{ status: 'ready', items: [] }}
      invoices={{ status: 'ready', items: [invoice as unknown as CustomerInvoice] }} />)
    const progress = screen.getByTestId('journey-progress')
    expect(progress).toHaveTextContent(PROVIDER_PARTLY)
    expect(progress).not.toHaveTextContent('recorded by the garage)')
  })

  it('the garage’s invoices list: status, amounts by source and the section note', () => {
    render(<MemoryRouter><InvoicesSection state="ready" status="all" error={null} onStatusChange={vi.fn()} onRetry={vi.fn()}
      data={{ invoices: [invoice], summary: { issued: 1, unpaid: 0, partially_paid: 1, paid: 0, outstanding_by_currency: [{ currency: 'USD', balance: '35.00' }] } } as never} />
    </MemoryRouter>)
    const row = screen.getByTestId('invoice-row')
    expect(row).toHaveTextContent(PROVIDER_PARTLY)
    expect(row).not.toHaveTextContent('Recorded payments 100.00')
    expect(row).toHaveTextContent('confirmed by its payment provider 100.00 USD')
    expect(screen.getByTestId('invoice-source-label')).not.toHaveTextContent(/^Recorded by the garage/)
  })
})
