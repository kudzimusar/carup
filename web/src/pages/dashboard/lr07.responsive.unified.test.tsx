/**
 * RX06-LR07 — responsive S1 presentation (unified only): Work Orders, Fraud/Duplicate Queue, Lending Queue and the
 * Governance review queue are laid out for a phone without changing a single decision.
 *
 * What these tests hold:
 *  - every action keeps its label, its handler and its values (the legacy action-flow tests are repeated here against
 *    the unified layout: same PATCH bodies, same resolutions, same lending states, same governance payloads);
 *  - nothing is invented: a recorded cost has no currency it does not carry, a missing severity is said so;
 *  - the active Governance tab points at a panel that exists (aria-controls is valid);
 *  - the legacy presentation (flags off) still renders its own markup — each section pins that.
 * Fictional data only.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const fx = vi.hoisted(() => ({
  unified: true,
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => fx.unified }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ ...fx.api, loading: false }) }))
vi.mock('sonner', () => ({ toast: fx.toast }))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'fx-reviewer', name: 'Fictional Reviewer', role: 'admin' }, token: 'tok', isAuthenticated: true, loading: false,
    login: () => {}, logout: () => {}, switchRole: async () => {} }),
}))

const settle = (probe: () => boolean) => waitFor(() => expect(probe()).toBe(true), { timeout: 2500 })
const bodyText = () => document.body.textContent || ''
const FX_VIN = 'FXVIN00000000L07A'

beforeEach(() => { fx.unified = true; fx.api = {}; fx.toast.success.mockReset(); fx.toast.error.mockReset() })
afterEach(() => cleanup())
beforeAll(async () => {
  await Promise.all(['./mechanic/WorkOrders', './admin/FraudQueue', './bank/LendingQueue', './shared/GovernanceReviewQueue']
    .map(m => import(/* @vite-ignore */ m)))
}, 60000)
const page = async (path: string) => (await import(/* @vite-ignore */ `./${path}`)).default
const mount = (el: JSX.Element) => render(<MemoryRouter>{el}</MemoryRouter>)

// ── Work Orders (mechanic) ──────────────────────────────────────────────────────────────────────────────────────
// Full DB id — the PATCH route resolves by it, so the UI must never send the shortened display id.
const ORDER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const IN_PROGRESS = { id: ORDER_ID, vin: FX_VIN, customer_name: 'Fictional Customer', issue_description: 'Fictional brake pads worn',
  status: 'In Progress', created_at: '2026-08-01T09:00:00Z', mechanic_id: 'fx-mech-1234' }
const workOrdersApi = (rows: unknown[]) => ({
  fetchMechanicWorkOrders: vi.fn().mockResolvedValue(rows),
  createMechanicWorkOrder: vi.fn(),
  updateMechanicWorkOrder: vi.fn().mockResolvedValue({ success: true }),
})

describe('WorkOrders — unified phone layout keeps every action', () => {
  it("Complete → cost → Confirm sends the DB-legal 'Completed' status, the entered total_cost and the FULL id", async () => {
    fx.api = workOrdersApi([IN_PROGRESS])
    const Page = await page('mechanic/WorkOrders'); mount(<Page />)
    fireEvent.click(await screen.findByTestId(`workorder-complete-${ORDER_ID}`))
    fireEvent.change(screen.getByTestId(`workorder-cost-input-${ORDER_ID}`), { target: { value: '450' } })
    fireEvent.click(screen.getByTestId(`workorder-confirm-complete-${ORDER_ID}`))
    await waitFor(() => expect(fx.api.updateMechanicWorkOrder).toHaveBeenCalledWith(ORDER_ID, { status: 'Completed', total_cost: 450 }))
    await waitFor(() => expect(fx.api.fetchMechanicWorkOrders).toHaveBeenCalledTimes(2))
  })

  it('completes without total_cost when the optional input is left empty', async () => {
    fx.api = workOrdersApi([IN_PROGRESS])
    const Page = await page('mechanic/WorkOrders'); mount(<Page />)
    fireEvent.click(await screen.findByTestId(`workorder-complete-${ORDER_ID}`))
    fireEvent.click(screen.getByTestId(`workorder-confirm-complete-${ORDER_ID}`))
    await waitFor(() => expect(fx.api.updateMechanicWorkOrder).toHaveBeenCalledWith(ORDER_ID, { status: 'Completed' }))
  })

  it("Cancel order sends the DB-legal 'Cancelled' status", async () => {
    fx.api = workOrdersApi([IN_PROGRESS])
    const Page = await page('mechanic/WorkOrders'); mount(<Page />)
    fireEvent.click(await screen.findByTestId(`workorder-cancel-${ORDER_ID}`))
    await waitFor(() => expect(fx.api.updateMechanicWorkOrder).toHaveBeenCalledWith(ORDER_ID, { status: 'Cancelled' }))
  })

  it('a negative total_cost is refused client-side, without calling the API', async () => {
    fx.api = workOrdersApi([IN_PROGRESS])
    const Page = await page('mechanic/WorkOrders'); mount(<Page />)
    fireEvent.click(await screen.findByTestId(`workorder-complete-${ORDER_ID}`))
    fireEvent.change(screen.getByTestId(`workorder-cost-input-${ORDER_ID}`), { target: { value: '-5' } })
    fireEvent.click(screen.getByTestId(`workorder-confirm-complete-${ORDER_ID}`))
    await waitFor(() => expect(fx.toast.error).toHaveBeenCalledWith('Total cost must be a non-negative number'))
    expect(fx.api.updateMechanicWorkOrder).not.toHaveBeenCalled()
  })

  it('Back leaves the completion step without sending anything', async () => {
    fx.api = workOrdersApi([IN_PROGRESS])
    const Page = await page('mechanic/WorkOrders'); mount(<Page />)
    fireEvent.click(await screen.findByTestId(`workorder-complete-${ORDER_ID}`))
    fireEvent.click(screen.getByTestId(`workorder-complete-back-${ORDER_ID}`))
    expect(screen.getByTestId(`workorder-complete-${ORDER_ID}`)).toBeInTheDocument()
    expect(fx.api.updateMechanicWorkOrder).not.toHaveBeenCalled()
  })

  it('an update failure is said honestly and the row is actionable again', async () => {
    fx.api = workOrdersApi([IN_PROGRESS])
    fx.api.updateMechanicWorkOrder.mockRejectedValue(new Error('Work order not found'))
    const Page = await page('mechanic/WorkOrders'); mount(<Page />)
    fireEvent.click(await screen.findByTestId(`workorder-cancel-${ORDER_ID}`))
    await waitFor(() => expect(fx.toast.error).toHaveBeenCalledWith('Work order not found'))
    expect(await screen.findByTestId(`workorder-complete-${ORDER_ID}`)).toBeTruthy()
    expect(fx.api.fetchMechanicWorkOrders).toHaveBeenCalledTimes(1)
  })

  it('terminal rows offer no actions', async () => {
    fx.api = workOrdersApi([{ ...IN_PROGRESS, status: 'Completed' }])
    const Page = await page('mechanic/WorkOrders'); mount(<Page />)
    await settle(() => !!screen.queryByTestId(`workorder-row-${ORDER_ID}`))
    expect(screen.queryByTestId(`workorder-actions-${ORDER_ID}`)).toBeNull()
    expect(screen.queryByTestId(`workorder-complete-${ORDER_ID}`)).toBeNull()
    expect(screen.queryByTestId(`workorder-cancel-${ORDER_ID}`)).toBeNull()
  })

  it('the status reads as words, and a recorded cost carries no currency the record does not hold', async () => {
    fx.api = workOrdersApi([IN_PROGRESS, { ...IN_PROGRESS, id: 'b2c3d4e5-f6a7-8901-bcde-f23456789012', status: 'Completed', total_cost: 150 }])
    const Page = await page('mechanic/WorkOrders'); mount(<Page />)
    await settle(() => !!screen.queryByTestId(`workorder-status-${ORDER_ID}`))
    expect(screen.getByTestId(`workorder-status-${ORDER_ID}`)).toHaveTextContent(/^In progress$/)
    expect(screen.getByTestId('workorder-cost-b2c3d4e5-f6a7-8901-bcde-f23456789012')).toHaveTextContent('150 · currency not recorded')
    expect(bodyText()).not.toMatch(/IN-PROGRESS|\$/)
  })

  it('the filters say which one is on (aria-pressed) and still filter', async () => {
    fx.api = workOrdersApi([IN_PROGRESS, { ...IN_PROGRESS, id: 'b2c3d4e5-f6a7-8901-bcde-f23456789012', status: 'Cancelled' }])
    const Page = await page('mechanic/WorkOrders'); mount(<Page />)
    await settle(() => !!screen.queryByTestId(`workorder-row-${ORDER_ID}`))
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelled' }))
    expect(screen.getByRole('button', { name: 'Cancelled' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId(`workorder-row-${ORDER_ID}`)).toBeNull()
    expect(screen.getByTestId('workorder-row-b2c3d4e5-f6a7-8901-bcde-f23456789012')).toBeTruthy()
  })

  it('flags OFF: the legacy row is unchanged (upper-case badge, no unified status chip, no aria-pressed)', async () => {
    fx.unified = false
    fx.api = workOrdersApi([IN_PROGRESS])
    const Page = await page('mechanic/WorkOrders'); mount(<Page />)
    await settle(() => !!screen.queryByTestId(`workorder-row-${ORDER_ID}`))
    expect(bodyText()).toContain('IN-PROGRESS')
    expect(screen.queryByTestId(`workorder-status-${ORDER_ID}`)).toBeNull()
    expect(screen.getByRole('button', { name: 'All' })).not.toHaveAttribute('aria-pressed')
  })
})

// ── Fraud / duplicate queue (admin) ─────────────────────────────────────────────────────────────────────────────
const CASE = { id: 'c1', vin: FX_VIN, status: 'open', highest_severity: 'high', open_signal_count: 2, blocks_publication: true, created_at: '2026-06-26T00:00:00Z' }

describe('FraudCaseCard — unified phone layout keeps both resolutions', () => {
  it("False positive and Block listing call onResolve with the same id and resolution values", async () => {
    const { FraudCaseCard } = await import('./admin/FraudQueue')
    const onResolve = vi.fn()
    render(<FraudCaseCard fraudCase={CASE} onResolve={onResolve} busy={false} />)
    const actions = within(screen.getByTestId('fraud-case-actions'))
    fireEvent.click(actions.getByRole('button', { name: /False positive/ }))
    fireEvent.click(actions.getByRole('button', { name: /Block listing/ }))
    expect(onResolve.mock.calls).toEqual([['c1', 'false_positive'], ['c1', 'blocked']])
  })

  it('while busy, both resolutions are disabled', async () => {
    const { FraudCaseCard } = await import('./admin/FraudQueue')
    render(<FraudCaseCard fraudCase={CASE} onResolve={vi.fn()} busy />)
    for (const name of [/False positive/, /Block listing/]) expect(screen.getByRole('button', { name })).toBeDisabled()
  })

  it('shows the recorded severity in words; a missing one is said so; VIN visibility unchanged (D6 HOLD)', async () => {
    const { FraudCaseCard } = await import('./admin/FraudQueue')
    const { rerender } = render(<FraudCaseCard fraudCase={CASE} onResolve={vi.fn()} busy={false} />)
    expect(screen.getByTestId('fraud-case-severity')).toHaveTextContent(/^high$/)
    expect(bodyText()).toContain(`VIN ${FX_VIN}`)
    rerender(<FraudCaseCard fraudCase={{ ...CASE, highest_severity: '' }} onResolve={vi.fn()} busy={false} />)
    expect(screen.getByTestId('fraud-case-severity')).toHaveTextContent('Severity not recorded')
  })

  it('a closed case offers no resolution and shows its recorded status', async () => {
    const { FraudCaseCard } = await import('./admin/FraudQueue')
    render(<FraudCaseCard fraudCase={{ ...CASE, status: 'resolved' }} onResolve={vi.fn()} busy={false} />)
    expect(screen.queryByTestId('fraud-case-actions')).toBeNull()
    expect(bodyText()).toContain('resolved')
  })

  it('flags OFF: the legacy card markup is unchanged', async () => {
    fx.unified = false
    const { FraudCaseCard } = await import('./admin/FraudQueue')
    const html = renderToStaticMarkup(<FraudCaseCard fraudCase={CASE} onResolve={vi.fn()} busy={false} />)
    expect(html).toContain('bg-orange-500 text-white')
    expect(html).not.toContain('fraud-case-actions')
    expect(html).not.toContain('fraud-case-severity')
  })
})

// ── Lending queue (bank) ────────────────────────────────────────────────────────────────────────────────────────
const APP_BASE = { year: 2019, make: 'Fictional', model: 'Roadster', vin: FX_VIN, users: { name: 'Fictional Applicant' } }
const APP_PENDING = { ...APP_BASE, id: 'fx-app-1', requested_amount: 9000, requested_currency: null, monthly_payment: null, apr: null,
  trust_score: null, trust_evaluation_state: 'not_evaluated', status: 'Pending' }
const APP_REVIEW = { ...APP_BASE, id: 'fx-app-2', requested_amount: 12000, requested_currency: 'USD', monthly_payment: 410.5, apr: 11,
  trust_score: 72, trust_evaluation_state: 'evaluated', status: 'Under Review' }
const APP_APPROVED = { ...APP_BASE, id: 'fx-app-3', requested_amount: 5000, requested_currency: 'ZWG', monthly_payment: 200, apr: 9,
  trust_score: 88, trust_evaluation_state: 'evaluated', status: 'Approved' }
const APP_ESCROW = { ...APP_APPROVED, id: 'fx-app-4', status: 'Escrow Pending' }
const APP_ACTIVE = { ...APP_APPROVED, id: 'fx-app-5', status: 'Active Loan' }
const APP_CLOSED = { ...APP_APPROVED, id: 'fx-app-6', status: 'Closed' }
const LENDING = [APP_PENDING, APP_REVIEW, APP_APPROVED, APP_ESCROW, APP_ACTIVE, APP_CLOSED]
// The legacy decision ladder, verbatim: [application, button label, the state it requests].
const LADDER: Array<[string, string, string]> = [
  ['fx-app-1', 'Review', 'Under Review'], ['fx-app-1', 'Reject', 'Rejected'], ['fx-app-2', 'Approve Loan', 'Approved'],
  ['fx-app-3', 'Disburse to Escrow', 'Escrow Pending'], ['fx-app-4', 'Activate Asset', 'Active Loan'], ['fx-app-5', 'Close Loan', 'Closed'],
]

describe('LendingQueue — unified phone cards carry the same decisions as the table', () => {
  it('each card shows the recorded amount, terms and trust exactly as the table row does', async () => {
    fx.api = { fetchFinanceApplications: vi.fn(async () => LENDING), updateFinanceApplicationStatus: vi.fn().mockResolvedValue({}) }
    const Page = await page('bank/LendingQueue'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('lending-card-fx-app-1'))
    for (const id of ['fx-app-1', 'fx-app-2']) {
      const card = within(screen.getByTestId(`lending-card-${id}`)), row = within(screen.getByTestId(`lending-row-${id}`))
      for (const t of ['lending-amount', 'lending-terms', 'lending-trust']) expect(card.getByTestId(t).textContent).toBe(row.getByTestId(t).textContent)
    }
    expect(within(screen.getByTestId('lending-card-fx-app-1')).getByTestId('lending-terms')).toHaveTextContent('Terms not set')
  })

  it.each(LADDER)('card of %s: "%s" requests %s (the legacy value)', async (id, label, next) => {
    fx.api = { fetchFinanceApplications: vi.fn(async () => LENDING), updateFinanceApplicationStatus: vi.fn().mockResolvedValue({}) }
    const Page = await page('bank/LendingQueue'); mount(<Page />)
    await settle(() => !!screen.queryByTestId(`lending-card-${id}`))
    fireEvent.click(within(screen.getByTestId(`lending-card-${id}`)).getByRole('button', { name: label }))
    await waitFor(() => expect(fx.api.updateFinanceApplicationStatus).toHaveBeenCalledWith(id, next))
  })

  it('every application offers the same decision labels in its card and in its table row', async () => {
    fx.api = { fetchFinanceApplications: vi.fn(async () => LENDING), updateFinanceApplicationStatus: vi.fn() }
    const Page = await page('bank/LendingQueue'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('lending-card-fx-app-6'))
    const labels = (el: HTMLElement) => within(el).queryAllByRole('button').map(b => b.textContent?.trim()).sort()
    for (const app of LENDING) expect(labels(screen.getByTestId(`lending-card-${app.id}`))).toEqual(labels(screen.getByTestId(`lending-row-${app.id}`)))
    expect(within(screen.getByTestId('lending-card-fx-app-6')).getByText('No actions')).toBeInTheDocument()
  })

  it('flags OFF: the legacy table has no cards', async () => {
    fx.unified = false
    fx.api = { fetchFinanceApplications: vi.fn(async () => [{ ...APP_REVIEW, user_name: 'Fictional Applicant' }]), updateFinanceApplicationStatus: vi.fn() }
    const Page = await page('bank/LendingQueue'); mount(<Page />)
    await settle(() => bodyText().includes('Approve Loan'))
    expect(screen.queryByTestId('lending-card-fx-app-2')).toBeNull()
  })
})

// ── Governance review queue (reviewer) ──────────────────────────────────────────────────────────────────────────
const ITEM = { target_type: 'temporal_finding', target_id: 'fx-item-1', vin: FX_VIN, task_type: 'temporal_finding', summary: 'Fictional finding', severity: 'medium', status: 'pending' }
const DECISIONS: Array<[string, string]> = [['Confirm', 'confirm'], ['Reject', 'reject'], ['Amend', 'amend'], ['Request more', 'request_more'], ['Inconclusive', 'inconclusive'], ['Escalate', 'escalate']]

describe('GovernanceReviewQueue — unified tab panel and phone cards', () => {
  it('the active tab controls a panel that exists (valid aria-controls)', async () => {
    fx.api = { fetchReviewQueue: vi.fn().mockResolvedValue({ queue: [ITEM] }), submitGovernanceDecision: vi.fn() }
    const Page = await page('shared/GovernanceReviewQueue'); mount(<Page />)
    await settle(() => bodyText().includes('Fictional finding'))
    const active = screen.getByRole('tab', { selected: true })
    const panel = document.getElementById(active.getAttribute('aria-controls') || '')
    expect(panel).not.toBeNull()
    expect(panel).toHaveAttribute('role', 'tabpanel')
    expect(screen.getByRole('tablist')).toHaveAccessibleName('Review task types')
  })

  it.each(DECISIONS)('card: "%s" records decision %s with the same target, VIN and notes as the table', async (label, decision) => {
    fx.api = { fetchReviewQueue: vi.fn().mockResolvedValue({ queue: [ITEM] }), submitGovernanceDecision: vi.fn().mockResolvedValue({}) }
    const Page = await page('shared/GovernanceReviewQueue'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('governance-item-temporal_finding:fx-item-1'))
    const card = within(screen.getByTestId('governance-item-temporal_finding:fx-item-1'))
    fireEvent.change(card.getByRole('textbox'), { target: { value: 'Fictional reviewer note' } })
    fireEvent.click(card.getByRole('button', { name: label }))
    await waitFor(() => expect(fx.api.submitGovernanceDecision).toHaveBeenCalledWith({
      targetType: 'temporal_finding', targetId: 'fx-item-1', vin: FX_VIN, decision, notes: 'Fictional reviewer note' }))
  })

  it('card and table offer the same six decisions', async () => {
    fx.api = { fetchReviewQueue: vi.fn().mockResolvedValue({ queue: [ITEM] }), submitGovernanceDecision: vi.fn() }
    const Page = await page('shared/GovernanceReviewQueue'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('governance-item-temporal_finding:fx-item-1'))
    const labels = (el: HTMLElement) => within(el).getAllByRole('button').map(b => b.textContent?.trim()).sort()
    expect(labels(screen.getByTestId('governance-item-temporal_finding:fx-item-1'))).toEqual(labels(screen.getByRole('table')))
  })

  it('flags OFF: the legacy page has no tab panel and no cards', async () => {
    fx.unified = false
    fx.api = { fetchReviewQueue: vi.fn().mockResolvedValue({ queue: [ITEM] }), submitGovernanceDecision: vi.fn() }
    const Page = await page('shared/GovernanceReviewQueue'); mount(<Page />)
    await settle(() => bodyText().includes('Fictional finding'))
    expect(screen.queryByRole('tabpanel')).toBeNull()
    expect(screen.queryByTestId('governance-item-temporal_finding:fx-item-1')).toBeNull()
  })
})
