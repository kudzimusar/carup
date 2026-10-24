/**
 * GARAGE-1.0 — the Garage operating hub (`/garage/cases/:caseId`).
 *
 * The screen is driven by ONE read model, `fetchGarageCaseHub`, whose `allowed_actions` is the backend's own
 * statement of what it will accept from THIS caller right now. These tests assert both halves for each stage of a
 * job: what IS offered, and — the half that keeps an operator from a 409 — what is NOT.
 *
 * They also pin the truth rules that have bitten this codebase:
 *   - money is an amount WITH its currency, "Not recorded" when null, and a 0 is never invented;
 *   - a payment is something the garage RECORDED outside CarUp, and the screen says so beside it;
 *   - a money/stock form sends the same idempotency key on a retry, so a double-click records once;
 *   - a mechanic sees no invoice, price or payment anywhere;
 *   - a refusal is shown in the server's own words.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GarageCaseDetail from './GarageCaseDetail'
import { NEXT_ACTION_LABEL } from '@/lib/garageBusiness'
import type {
  AllowedAction, CaseHub, Closeout, GarageEstimate, GarageInvoice, GaragePart, HubServiceRecord, NextAction, PartUsage,
} from '@/lib/garageBusiness'

const CASE_ID = 'case-1'
const WO_ID = 'wo-1'
const VIN = 'HUBVIN0000000001'
const SOURCE_LABEL = 'Recorded by the garage. CarUp has not processed or verified this payment.'

const fetchGarageCaseHub = vi.fn()
const fetchGarageMechanics = vi.fn()
const fetchGarageStock = vi.fn()
const acceptServiceCase = vi.fn()
const declineServiceCase = vi.fn()
const startServiceCase = vi.fn()
const completeGarageJob = vi.fn()
const createCaseEstimate = vi.fn()
const saveEstimateDraft = vi.fn()
const sendGarageEstimate = vi.fn()
const reviseGarageEstimate = vi.fn()
const cancelGarageEstimate = vi.fn()
const assignMechanicToWorkOrder = vi.fn()
const unassignMechanicFromWorkOrder = vi.fn()
const recordServiceOnWorkOrder = vi.fn()
const recordMileageObservation = vi.fn()
const useGaragePartOnJob = vi.fn()
const reverseGaragePartUsage = vi.fn()
const issueGarageInvoice = vi.fn()
const recordGaragePayment = vi.fn()
const reverseGaragePayment = vi.fn()
const voidGarageInvoice = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchGarageCaseHub, fetchGarageMechanics, fetchGarageStock,
    acceptServiceCase, declineServiceCase, startServiceCase, completeGarageJob,
    createCaseEstimate, saveEstimateDraft, sendGarageEstimate, reviseGarageEstimate, cancelGarageEstimate,
    assignMechanicToWorkOrder, unassignMechanicFromWorkOrder, recordServiceOnWorkOrder, recordMileageObservation,
    useGaragePartOnJob, reverseGaragePartUsage,
    issueGarageInvoice, recordGaragePayment, reverseGaragePayment, voidGarageInvoice,
  }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useParams: () => ({ caseId: CASE_ID }) }
})

// ───────────────────────────── fixtures ─────────────────────────────

const estimate = (o: Partial<GarageEstimate> = {}): GarageEstimate => ({
  id: 'est-1', service_case_id: CASE_ID, work_order_id: WO_ID, version: 1, status: 'draft', currency: 'USD',
  customer_note: null, internal_note: null, valid_until: null, expired: false, sent_at: null, decided_at: null,
  decision_basis: null, decision_reason: null, total_amount: '90.00', total_state: 'draft_total', line_count: 1,
  lines: [{ line_no: 1, category: 'labour', description: 'Front brake pads, fitted', quantity: '1', unit_price: '90.00', line_total: '90.00', price_recorded: true }],
  created_at: '2026-10-20T07:00:00.000Z', updated_at: '2026-10-20T08:00:00.000Z',
  ...o,
})

const workOrder = (auth: 'pending' | 'authorized' | 'declined' | 'revoked', assigned: string | null = null, status = 'In Progress'): NonNullable<CaseHub['work_order']> => ({
  id: WO_ID, status, owner_authorization: auth, owner_authorized_at: auth === 'authorized' ? '2026-10-21T09:00:00.000Z' : null, assigned_mechanic_user_id: assigned,
})

const record = (o: Partial<HubServiceRecord> = {}): HubServiceRecord => ({
  id: 'rec-1', service_category: 'brakes', service_authority: 'garage_stated', work_performed: 'Fitted front pads',
  cost: { amount: '240.00', currency: 'USD' }, performed_at: '2026-10-22T10:00:00.000Z', recorded_by_user_id: 'admin-1', ...o,
})

const usage = (o: Partial<PartUsage> = {}): PartUsage => ({
  id: 'use-1', service_record_id: 'rec-1', part_id: 'part-1', quantity: 2, part_name_snapshot: 'Brake pad set', part_sku_snapshot: 'BP-1',
  unit_cost_snapshot: '10.00', sell_price_snapshot: '15.00', price_currency_snapshot: 'USD', partsentry_log_id: null, reversed_at: null, active: true, ...o,
})

const closeout = (status: string, o: Partial<Closeout> = {}): Closeout => ({
  service_case_id: CASE_ID, case_status: status, work_order: null, estimate: null, actual_work: [], parts_used: [],
  recorded_cost_by_currency: [], suggested_invoice: null, invoice: null, variance: { state: 'no_estimate' },
  can_issue_invoice: false, payment_source_label: SOURCE_LABEL, ...o,
})

function hub(status: string, allowed: AllowedAction[], next: NextAction, o: Partial<CaseHub> = {}): CaseHub {
  return {
    case: {
      id: CASE_ID, status, vin: VIN, service_category: 'brakes', request_summary: 'Grinding noise when braking',
      requested_at: '2026-10-19T09:00:00.000Z', accepted_at: null, started_at: null, completed_at: null, branch_id: null,
    },
    vehicle: { vin: VIN, make: 'Toyota', model: 'Hilux', year: 2019 },
    work_order: null,
    appointment: null,
    estimates: { latest: null, versions: [] },
    service_records: [],
    parts_used: [],
    money_visible: true,
    closeout: closeout(status),
    mechanics: [],
    history: [{ event_type: 'accepted', from_status: 'requested', to_status: 'accepted', at: '2026-10-19T10:00:00.000Z' }],
    next_action: next,
    allowed_actions: allowed,
    viewer: { role: 'admin', is_admin: true },
    ...o,
  }
}

const invoice = (o: Partial<GarageInvoice> = {}): GarageInvoice => ({
  id: 'inv-1', invoice_number: 'INV-0001', service_case_id: CASE_ID, work_order_id: WO_ID, status: 'issued', currency: 'USD',
  total_amount: '100.00', line_count: 1, customer_note: null, internal_note: null, due_date: null, issued_at: '2026-10-23T09:00:00.000Z',
  voided_at: null, void_reason: null, estimate: { version: 1, total_amount: '90.00', currency: 'USD' },
  variance: { state: 'comparable', currency: 'USD', estimate_total: '90.00', invoice_total: '100.00', difference: '10.00', direction: 'over_estimate' },
  payment_status: 'unpaid', paid_amount: '0.00', balance_amount: '100.00', payment_source_label: SOURCE_LABEL,
  lines: [{ line_no: 1, category: 'labour', description: 'Service — brakes', quantity: '1', unit_price: '100.00', line_total: '100.00' }],
  payments: [], receipts: [], ...o,
})

const part = (o: Partial<GaragePart> = {}): GaragePart => ({
  id: 'part-1', name: 'Brake pad set', sku: 'BP-1', stock_level: 5, stock_state: 'in_stock', counted: true, min_stock: 2, supplier: null,
  unit_cost: '10.00', sell_price: '15.00', price_currency: 'USD', legacy_unit_price: null, legacy_price_currency_unknown: false,
  is_active: true, last_movement_at: null, updated_at: null, ...o,
})

const open = () => render(<MemoryRouter><GarageCaseDetail /></MemoryRouter>)
const hubReturns = (h: CaseHub) => fetchGarageCaseHub.mockResolvedValue(h)

/** Every control this suite names, so "NOT offered" can be asserted as a set rather than one at a time. */
const ALL_ACTION_IDS = [
  'accept-case', 'decline-case', 'prepare-estimate', 'edit-estimate', 'send-estimate', 'cancel-estimate', 'revise-estimate',
  'mechanic-select', 'unassign-mechanic', 'start-work', 'submit-record', 'complete-case', 'use-part', 'submit-invoice',
  'record-payment', 'void-invoice', 'reverse-payment',
]
function expectOffered(offered: string[]) {
  for (const id of ALL_ACTION_IDS) {
    if (offered.includes(id)) expect(screen.queryByTestId(id), `${id} should be offered`).not.toBeNull()
    else expect(screen.queryByTestId(id), `${id} must NOT be offered`).toBeNull()
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  fetchGarageMechanics.mockResolvedValue({ mechanics: [{ user_id: 'm-1', display_name: 'Tendai', role: 'mechanic' }], total: 1 })
  fetchGarageStock.mockResolvedValue({ parts: [], summary: { total: 0, out: 0, low: 0, uncounted: 0, unknown: 0 } })
  for (const fn of [acceptServiceCase, declineServiceCase, startServiceCase, completeGarageJob, createCaseEstimate, saveEstimateDraft,
    sendGarageEstimate, reviseGarageEstimate, cancelGarageEstimate, assignMechanicToWorkOrder, unassignMechanicFromWorkOrder,
    useGaragePartOnJob, reverseGaragePartUsage, issueGarageInvoice, recordGaragePayment, reverseGaragePayment, voidGarageInvoice]) {
    fn.mockResolvedValue({ success: true })
  }
  recordServiceOnWorkOrder.mockResolvedValue({ record: { id: 'rec-9' } })
  recordMileageObservation.mockResolvedValue({ observation: { id: 'obs-1' } })
})

// ───────────────────────────── the header and the headline ─────────────────────────────

describe('the hub header and headline', () => {
  it('names the vehicle and VIN, the status, the appointment, and the server’s next action', async () => {
    hubReturns(hub('accepted', ['prepare_estimate'], 'prepare_estimate', {
      appointment: {
        id: 'a-1', status: 'confirmed', starts_at: '2026-10-26T06:00:00.000Z', ends_at: '2026-10-26T07:00:00.000Z',
        appointment_timezone: 'Africa/Harare', branch_id: 'b-1', planned_workforce_profile_id: null,
      },
    }))
    open()
    expect(await screen.findByTestId('case-vehicle')).toHaveTextContent('2019 Toyota Hilux')
    expect(screen.getByTestId('case-vin')).toHaveTextContent(VIN)
    expect(screen.getByTestId('case-status')).toHaveTextContent('Accepted')
    expect(screen.getByTestId('case-appointment')).toHaveTextContent(/confirmed/i)
    expect(screen.getByTestId('case-appointment')).toHaveTextContent('Africa/Harare')
    expect(screen.getByTestId('case-summary')).toHaveTextContent('Grinding noise when braking')
    expect(screen.getByTestId('case-next-action')).toHaveTextContent(NEXT_ACTION_LABEL.prepare_estimate)
  })

  it('a vehicle the server could not resolve is named by VIN, never a placeholder', async () => {
    hubReturns(hub('requested', ['accept_case', 'decline_case'], 'accept_or_decline', { vehicle: null }))
    open()
    expect(await screen.findByTestId('case-vehicle')).toHaveTextContent(`VIN ${VIN}`)
    expect(screen.getByTestId('case-vehicle')).not.toHaveTextContent(/unknown/i)
  })

  it('the old “CarUp does not carry quotes” copy is gone', async () => {
    hubReturns(hub('requested', ['accept_case', 'decline_case'], 'accept_or_decline'))
    open()
    await screen.findByTestId('accept-case')
    expect(document.body.textContent).not.toMatch(/does not carry quotes/i)
  })

  it('reads the hub once per load', async () => {
    hubReturns(hub('requested', ['accept_case', 'decline_case'], 'accept_or_decline'))
    open()
    await screen.findByTestId('accept-case')
    expect(fetchGarageCaseHub).toHaveBeenCalledTimes(1)
    expect(fetchGarageCaseHub).toHaveBeenCalledWith(CASE_ID)
    // stock and the team list are not fetched until something needs them
    expect(fetchGarageStock).not.toHaveBeenCalled()
    expect(fetchGarageMechanics).not.toHaveBeenCalled()
  })
})

// ───────────────────────────── stage by stage: offered / not offered ─────────────────────────────

describe('what is offered at each stage, and what is not', () => {
  it('(a) accepted, no work order: only “prepare an estimate”, and it says why the work cannot start', async () => {
    hubReturns(hub('accepted', ['prepare_estimate'], 'prepare_estimate'))
    open()
    await screen.findByTestId('prepare-estimate')
    expectOffered(['prepare-estimate'])
    expect(screen.getByTestId('start-blocked')).toHaveTextContent(/not authorized/i)
    expect(screen.getByTestId('case-next-action')).toHaveTextContent('Prepare an estimate')
    expect(screen.getByTestId('step-estimate')).toHaveAttribute('data-state', 'current')
  })

  it('(b) draft estimate: edit, send and cancel — not start, not a second estimate', async () => {
    hubReturns(hub('accepted', ['edit_estimate', 'send_estimate', 'cancel_estimate'], 'send_estimate', {
      work_order: workOrder('pending'),
      estimates: { latest: estimate(), versions: [estimate()] },
    }))
    open()
    await screen.findByTestId('send-estimate')
    expectOffered(['edit-estimate', 'send-estimate', 'cancel-estimate'])
    expect(screen.getByTestId('estimate-status')).toHaveTextContent('Draft')
    expect(screen.getByTestId('start-blocked')).toHaveTextContent(/not authorized/i)
  })

  it('(c) estimate sent: waiting for the customer — revise/cancel only, no send, no start', async () => {
    hubReturns(hub('accepted', ['revise_estimate', 'cancel_estimate'], 'await_customer', {
      work_order: workOrder('pending'),
      estimates: { latest: estimate({ status: 'sent', sent_at: '2026-10-21T08:00:00.000Z', total_state: 'frozen_at_send' }), versions: [] },
    }))
    open()
    await screen.findByTestId('revise-estimate')
    expectOffered(['revise-estimate', 'cancel-estimate'])
    expect(screen.getByTestId('case-next-action')).toHaveTextContent(NEXT_ACTION_LABEL.await_customer)
    expect(screen.getByTestId('owner-authorization')).toHaveTextContent(/has not authorized/i)
    expect(screen.getByTestId('step-decision')).toHaveAttribute('data-state', 'current')
    expect(screen.getByTestId('start-blocked')).toHaveTextContent(/not authorized/i)
  })

  it('shows the customer’s decision and reason when they declined, and offers a revision', async () => {
    hubReturns(hub('accepted', ['prepare_estimate', 'revise_estimate'], 'revise_estimate', {
      work_order: workOrder('declined'),
      estimates: {
        latest: estimate({ status: 'declined', decided_at: '2026-10-21T12:00:00.000Z', decision_basis: 'owner', decision_reason: 'Too expensive', total_state: 'frozen_at_send' }),
        versions: [],
      },
    }))
    open()
    await screen.findByTestId('revise-estimate')
    expect(screen.getByTestId('estimate-decision')).toHaveTextContent(/declined/i)
    expect(screen.getByTestId('estimate-decision')).toHaveTextContent('Too expensive')
    expect(screen.getByTestId('owner-authorization')).toHaveTextContent(/declined the estimate/i)
    expect(screen.getByTestId('start-blocked')).toHaveTextContent(/declined/i)
    expect(screen.queryByTestId('start-work')).toBeNull()
  })

  it('(d) authorized but unassigned: assign is offered, start is NOT, and the page says to assign first', async () => {
    hubReturns(hub('accepted', ['assign_mechanic'], 'assign_mechanic', {
      work_order: workOrder('authorized'),
      estimates: { latest: estimate({ status: 'accepted', decided_at: '2026-10-21T09:00:00.000Z', total_state: 'frozen_at_send' }), versions: [] },
    }))
    open()
    await screen.findByTestId('mechanic-select')
    expectOffered(['mechanic-select'])
    expect(screen.getByTestId('start-blocked')).toHaveTextContent('Assign a mechanic first.')
    expect(screen.getByTestId('owner-authorization')).toHaveTextContent('Authorized by the customer')
    expect(screen.getByTestId('estimate-decision')).toHaveTextContent(/accepted/i)
    expect(screen.getByTestId('step-decision')).toHaveAttribute('data-state', 'done')
    expect(screen.getByTestId('step-assign')).toHaveAttribute('data-state', 'current')
  })

  it('(e) authorized and assigned: start is offered', async () => {
    hubReturns(hub('accepted', ['assign_mechanic', 'unassign_mechanic', 'start_work'], 'start_work', { work_order: workOrder('authorized', 'm-1') }))
    open()
    await screen.findByTestId('start-work')
    expectOffered(['start-work', 'unassign-mechanic'])
    expect(screen.queryByTestId('start-blocked')).toBeNull()
    fireEvent.click(screen.getByTestId('start-work'))
    await waitFor(() => expect(startServiceCase).toHaveBeenCalledWith(CASE_ID))
  })

  it('(f) active with no records: record is offered, complete and “use a part” are NOT, with the reason', async () => {
    hubReturns(hub('active', ['assign_mechanic', 'unassign_mechanic', 'record_service'], 'record_service', { work_order: workOrder('authorized', 'm-1') }))
    open()
    await screen.findByTestId('submit-record')
    expectOffered(['submit-record', 'unassign-mechanic'])
    expect(screen.getByTestId('complete-blocked')).toHaveTextContent(/record at least one piece of work/i)
    expect(screen.getByTestId('use-part-blocked')).toHaveTextContent(/record the work first/i)
  })

  it('(g) active with records: complete and “use a part” are offered, and the records are listed', async () => {
    hubReturns(hub('active', ['assign_mechanic', 'unassign_mechanic', 'record_service', 'use_part', 'complete_job'], 'complete_job', {
      work_order: workOrder('authorized', 'm-1'), service_records: [record()],
    }))
    open()
    await screen.findByTestId('complete-case')
    expectOffered(['submit-record', 'complete-case', 'use-part', 'unassign-mechanic'])
    expect(screen.getByTestId('service-record')).toHaveTextContent('Fitted front pads')
    expect(screen.getByTestId('service-record-cost')).toHaveTextContent('240.00 USD')
    // it says what completing does
    expect(screen.getByTestId('complete-job-block')).toHaveTextContent(/finishes the job and closes the customer’s request/i)
    fireEvent.click(screen.getByTestId('complete-case'))
    await waitFor(() => expect(completeGarageJob).toHaveBeenCalledWith(CASE_ID))
  })

  it('the customer withdrawing authorization is a blocked step, with nothing to press', async () => {
    hubReturns(hub('active', [], 'authorization_revoked', { work_order: workOrder('revoked', 'm-1'), service_records: [record()] }))
    open()
    await screen.findByTestId('case-next-action')
    expect(screen.getByTestId('case-next-action')).toHaveTextContent(NEXT_ACTION_LABEL.authorization_revoked)
    expect(screen.getByTestId('step-decision')).toHaveAttribute('data-state', 'blocked')
    expectOffered([])
    expect(screen.getByTestId('complete-blocked')).toHaveTextContent(/withdrew their authorization/i)
  })

  it('a declined or withdrawn request is history with nothing to do', async () => {
    hubReturns(hub('declined', [], 'none'))
    open()
    expect(await screen.findByTestId('case-closed')).toHaveTextContent(/declined/i)
    expectOffered([])
    expect(screen.getByTestId('step-request')).toHaveAttribute('data-state', 'blocked')
  })
})

// ───────────────────────────── the estimate ─────────────────────────────

describe('the estimate form', () => {
  const openForm = async () => {
    hubReturns(hub('accepted', ['prepare_estimate'], 'prepare_estimate'))
    open()
    fireEvent.click(await screen.findByTestId('prepare-estimate'))
    await screen.findByTestId('estimate-form')
  }

  it('has NO default currency, and refuses to save without one', async () => {
    await openForm()
    expect(screen.getByLabelText('Currency (three-letter code)')).toHaveValue('')
    const line = within(screen.getAllByTestId('estimate-line')[0])
    fireEvent.change(line.getByLabelText('Description'), { target: { value: 'Brake pads' } })
    fireEvent.click(screen.getByTestId('submit-estimate'))
    expect(await screen.findByTestId('estimate-form-error')).toHaveTextContent(/three-letter code/i)
    expect(screen.getByTestId('estimate-form-error')).toHaveTextContent(/no default currency/i)
    expect(createCaseEstimate).not.toHaveBeenCalled()
  })

  it('sends a blank price as null (not recorded) and 0 as the string "0" (free) — never mixing them up', async () => {
    await openForm()
    fireEvent.change(screen.getByLabelText('Currency (three-letter code)'), { target: { value: 'usd' } })
    const first = within(screen.getAllByTestId('estimate-line')[0])
    fireEvent.change(first.getByLabelText('Description'), { target: { value: 'Diagnosis' } })
    // unit price left blank: not recorded yet
    fireEvent.click(screen.getByTestId('add-line'))
    const second = within(screen.getAllByTestId('estimate-line')[1])
    fireEvent.change(second.getByLabelText('Kind of line'), { target: { value: 'fee' } })
    fireEvent.change(second.getByLabelText('Description'), { target: { value: 'Courtesy check' } })
    fireEvent.change(second.getByLabelText('Unit price'), { target: { value: '0' } })
    fireEvent.change(screen.getByTestId('estimate-customer-note'), { target: { value: 'Parts extra' } })
    fireEvent.click(screen.getByTestId('submit-estimate'))

    await waitFor(() => expect(createCaseEstimate).toHaveBeenCalledTimes(1))
    const [caseId, body] = createCaseEstimate.mock.calls[0]
    expect(caseId).toBe(CASE_ID)
    expect(body.currency).toBe('USD')
    expect(body.lines).toEqual([
      { category: 'labour', description: 'Diagnosis', quantity: '1', unit_price: null },
      { category: 'fee', description: 'Courtesy check', quantity: '1', unit_price: '0' },
    ])
    expect(body.customer_note).toBe('Parts extra')
    expect(body.internal_note).toBeNull()
    expect(body.valid_until).toBeNull()
    expect(body).not.toHaveProperty('expected_updated_at')
  })

  it('editing a draft saves with the draft’s expected_updated_at, pre-filled from the server’s version', async () => {
    const draft = estimate({ customer_note: 'Hello', updated_at: '2026-10-20T08:15:00.000Z' })
    hubReturns(hub('accepted', ['edit_estimate', 'send_estimate', 'cancel_estimate'], 'send_estimate', {
      work_order: workOrder('pending'), estimates: { latest: draft, versions: [draft] },
    }))
    open()
    fireEvent.click(await screen.findByTestId('edit-estimate'))
    expect(screen.getByLabelText('Currency (three-letter code)')).toHaveValue('USD')
    const line = within(screen.getAllByTestId('estimate-line')[0])
    expect(line.getByLabelText('Description')).toHaveValue('Front brake pads, fitted')
    fireEvent.change(line.getByLabelText('Unit price'), { target: { value: '95.50' } })
    fireEvent.click(screen.getByTestId('submit-estimate'))
    await waitFor(() => expect(saveEstimateDraft).toHaveBeenCalledTimes(1))
    const [id, body] = saveEstimateDraft.mock.calls[0]
    expect(id).toBe('est-1')
    expect(body.expected_updated_at).toBe('2026-10-20T08:15:00.000Z')
    expect(body.lines[0].unit_price).toBe('95.50')
    expect(body.currency).toBe('USD')
  })

  it('shows an unpriced line and total as “Not recorded”, never 0', async () => {
    const unpriced = estimate({
      total_amount: null, total_state: 'not_recorded',
      lines: [{ line_no: 1, category: 'labour', description: 'Diagnosis', quantity: '1', unit_price: null, line_total: null, price_recorded: false }],
    })
    hubReturns(hub('accepted', ['edit_estimate', 'send_estimate', 'cancel_estimate'], 'send_estimate', {
      work_order: workOrder('pending'), estimates: { latest: unpriced, versions: [unpriced] },
    }))
    open()
    await screen.findByTestId('estimate-total')
    expect(screen.getByTestId('estimate-total')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('estimate-total')).not.toHaveTextContent(/\b0\b/)
    expect(screen.getByTestId('estimate-line-total')).toHaveTextContent('Not recorded')
  })

  it('shows the total as the server gives it, with its currency and its state', async () => {
    const sent = estimate({ status: 'sent', total_amount: '90.00', total_state: 'frozen_at_send', sent_at: '2026-10-21T08:00:00.000Z' })
    hubReturns(hub('accepted', ['revise_estimate', 'cancel_estimate'], 'await_customer', {
      work_order: workOrder('pending'), estimates: { latest: sent, versions: [sent] },
    }))
    open()
    expect(await screen.findByTestId('estimate-total')).toHaveTextContent('Total: 90.00 USD')
    expect(screen.getByTestId('estimate-total')).toHaveTextContent(/fixed when it was sent/i)
  })

  it('cancelling an estimate sends the optional reason', async () => {
    hubReturns(hub('accepted', ['edit_estimate', 'send_estimate', 'cancel_estimate'], 'send_estimate', {
      work_order: workOrder('pending'), estimates: { latest: estimate(), versions: [estimate()] },
    }))
    open()
    fireEvent.click(await screen.findByTestId('cancel-estimate'))
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Customer rang to withdraw' } })
    fireEvent.click(screen.getByTestId('confirm-cancel-estimate'))
    await waitFor(() => expect(cancelGarageEstimate).toHaveBeenCalledWith('est-1', 'Customer rang to withdraw'))
  })

  it('(k) a refused send shows the server’s own words (an unpriced line), and the hub is not “patched”', async () => {
    sendGarageEstimate.mockRejectedValue(new Error('Every line needs a price before the estimate can be sent. A line with no price is "not recorded", not free.'))
    hubReturns(hub('accepted', ['edit_estimate', 'send_estimate', 'cancel_estimate'], 'send_estimate', {
      work_order: workOrder('pending'), estimates: { latest: estimate(), versions: [estimate()] },
    }))
    open()
    fireEvent.click(await screen.findByTestId('send-estimate'))
    expect(await screen.findByTestId('case-action-error')).toHaveTextContent(/Every line needs a price before the estimate can be sent/)
    // nothing changed on the server, so nothing was re-read and the draft is still a draft
    expect(fetchGarageCaseHub).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('estimate-status')).toHaveTextContent('Draft')
    expect(screen.queryByTestId('case-notice')).toBeNull()
  })

  it('after a successful send the hub is RE-READ and the screen shows what the server now says', async () => {
    const draft = estimate()
    const sent = estimate({ status: 'sent', sent_at: '2026-10-21T08:00:00.000Z', total_state: 'frozen_at_send' })
    fetchGarageCaseHub
      .mockResolvedValueOnce(hub('accepted', ['edit_estimate', 'send_estimate', 'cancel_estimate'], 'send_estimate', { work_order: workOrder('pending'), estimates: { latest: draft, versions: [draft] } }))
      .mockResolvedValue(hub('accepted', ['revise_estimate', 'cancel_estimate'], 'await_customer', { work_order: workOrder('pending'), estimates: { latest: sent, versions: [sent] } }))
    open()
    fireEvent.click(await screen.findByTestId('send-estimate'))
    await waitFor(() => expect(sendGarageEstimate).toHaveBeenCalledWith('est-1'))
    expect(await screen.findByTestId('revise-estimate')).toBeTruthy()
    expect(screen.queryByTestId('send-estimate')).toBeNull()
    expect(screen.getByTestId('case-next-action')).toHaveTextContent(NEXT_ACTION_LABEL.await_customer)
    expect(fetchGarageCaseHub).toHaveBeenCalledTimes(2)
  })
})

// ───────────────────────────── parts ─────────────────────────────

describe('parts used', () => {
  const activeHub = (extra: Partial<CaseHub> = {}) => hub('active', ['assign_mechanic', 'unassign_mechanic', 'record_service', 'use_part', 'reverse_usage', 'complete_job'], 'complete_job', {
    work_order: workOrder('authorized', 'm-1'), service_records: [record()], ...extra,
  })

  it('fetches stock only when the form is opened, and does not allow a part that is out, unknown or uncounted', async () => {
    fetchGarageStock.mockResolvedValue({
      parts: [
        part(),
        part({ id: 'part-2', name: 'Oil filter', sku: 'OF-1', stock_level: 0, stock_state: 'out' }),
        part({ id: 'part-3', name: 'Wiper blade', sku: 'WB-1', stock_level: null, stock_state: 'unknown', counted: null }),
        part({ id: 'part-4', name: 'Spark plug', sku: 'SP-1', stock_level: 12, stock_state: 'uncounted', counted: false }),
      ],
      summary: { total: 4, out: 1, low: 0, uncounted: 1, unknown: 1 },
    })
    hubReturns(activeHub())
    open()
    const button = await screen.findByTestId('use-part')
    expect(fetchGarageStock).not.toHaveBeenCalled()
    fireEvent.click(button)
    await screen.findByTestId('part-select')
    expect(fetchGarageStock).toHaveBeenCalledTimes(1)

    const options = within(screen.getByTestId('part-select')).getAllByRole('option') as HTMLOptionElement[]
    const byText = (text: RegExp) => options.find((o) => text.test(o.textContent ?? ''))!
    expect(byText(/Brake pad set/).disabled).toBe(false)
    expect(byText(/Oil filter/).disabled).toBe(true)
    expect(byText(/Wiper blade/).disabled).toBe(true)
    expect(byText(/Spark plug/).disabled).toBe(true)
    // an unknown quantity is never shown as 0, and the reason each part cannot be chosen is stated
    expect(byText(/Wiper blade/).textContent).not.toMatch(/\b0\b/)
    const why = screen.getByTestId('parts-unavailable')
    expect(why).toHaveTextContent(/Oil filter .* out of stock/i)
    expect(why).toHaveTextContent(/Wiper blade .* quantity is unknown/i)
    expect(why).toHaveTextContent(/Spark plug .* not been counted/i)
  })

  it('records a part with a stable idempotency key: the same key on a retry after a failure', async () => {
    fetchGarageStock.mockResolvedValue({ parts: [part()], summary: { total: 1, out: 0, low: 0, uncounted: 0, unknown: 0 } })
    useGaragePartOnJob.mockRejectedValueOnce(new Error('Not enough stock')).mockResolvedValueOnce({ usage_id: 'use-9' })
    hubReturns(activeHub())
    open()
    fireEvent.click(await screen.findByTestId('use-part'))
    await screen.findByTestId('part-select')
    // one piece of work: it is the only choice, so it is pre-selected rather than guessed
    expect(screen.getByTestId('part-record')).toHaveValue('rec-1')
    fireEvent.change(screen.getByTestId('part-select'), { target: { value: 'part-1' } })
    fireEvent.change(screen.getByTestId('part-quantity'), { target: { value: '2' } })
    fireEvent.click(screen.getByTestId('submit-part'))
    expect(await screen.findByTestId('case-action-error')).toHaveTextContent('Not enough stock')
    fireEvent.click(screen.getByTestId('submit-part'))
    await waitFor(() => expect(useGaragePartOnJob).toHaveBeenCalledTimes(2))
    const [first, second] = useGaragePartOnJob.mock.calls
    expect(first[0]).toBe('rec-1')
    expect(first[1]).toMatchObject({ part_id: 'part-1', quantity: 2 })
    expect(first[1].idempotency_key).toBeTruthy()
    expect(second[1].idempotency_key).toBe(first[1].idempotency_key)
  })

  it('lists parts used with their price snapshot or “Not recorded”, and marks a reversed one', async () => {
    hubReturns(activeHub({
      parts_used: [
        usage(),
        usage({ id: 'use-2', part_name_snapshot: 'Oil filter', part_sku_snapshot: 'OF-1', sell_price_snapshot: null, price_currency_snapshot: null }),
        usage({ id: 'use-3', part_name_snapshot: 'Wiper blade', part_sku_snapshot: 'WB-1', reversed_at: '2026-10-23T10:00:00.000Z', active: false }),
      ],
    }))
    open()
    await screen.findByTestId('parts-used')
    const rows = screen.getAllByTestId('part-usage')
    expect(rows[0]).toHaveTextContent('15.00 USD')
    expect(rows[1]).toHaveTextContent('Not recorded')
    expect(rows[2]).toHaveAttribute('data-reversed', 'true')
    expect(screen.getByTestId('part-usage-reversed')).toBeTruthy()
    // only a live usage can be reversed
    expect(screen.getAllByTestId('reverse-usage')).toHaveLength(2)
  })

  it('reversing a usage needs a reason and sends a key', async () => {
    hubReturns(activeHub({ parts_used: [usage()] }))
    open()
    fireEvent.click(await screen.findByTestId('reverse-usage'))
    fireEvent.click(screen.getByTestId('submit-reverse-usage'))
    expect(await screen.findByTestId('reverse-usage-error')).toHaveTextContent(/give a reason/i)
    expect(reverseGaragePartUsage).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId('reverse-usage-reason'), { target: { value: 'Wrong part' } })
    fireEvent.click(screen.getByTestId('submit-reverse-usage'))
    await waitFor(() => expect(reverseGaragePartUsage).toHaveBeenCalledTimes(1))
    expect(reverseGaragePartUsage.mock.calls[0][0]).toBe('use-1')
    expect(reverseGaragePartUsage.mock.calls[0][1]).toMatchObject({ reason: 'Wrong part' })
    expect(reverseGaragePartUsage.mock.calls[0][1].idempotency_key).toBeTruthy()
  })
})

// ───────────────────────────── closeout: invoice, payment ─────────────────────────────

const completedHub = (allowed: AllowedAction[], next: NextAction, co: Closeout, extra: Partial<CaseHub> = {}) =>
  hub('completed', allowed, next, {
    work_order: workOrder('authorized', 'm-1', 'Completed'), service_records: [record()], closeout: co, ...extra,
  })

const suggestedUsd: NonNullable<Closeout['suggested_invoice']> = {
  currency: 'USD',
  lines: [
    { category: 'labour', description: 'Service — brakes', quantity: '1', unit_price: '240.00', source_kind: 'service_record', source_id: 'rec-1' },
    { category: 'part', description: 'Brake pad set', quantity: '2', unit_price: null, source_kind: 'part_usage', source_id: 'use-1' },
  ],
  notes: ['Brake pad set: no sell price was recorded — price it yourself; it is not free.'],
}

describe('(h) completed job, administrator: issuing the invoice', () => {
  const co = (suggested: Closeout['suggested_invoice'] = suggestedUsd) => closeout('completed', {
    work_order: { id: WO_ID, status: 'Completed', owner_authorization: 'authorized' },
    estimate: { id: 'est-1', version: 1, currency: 'USD', total_amount: '90.00' },
    actual_work: [{ service_record_id: 'rec-1', service_category: 'brakes', service_authority: 'garage_stated', performed_at: '2026-10-22T10:00:00.000Z', cost: { amount: '240.00', currency: 'USD' } }],
    parts_used: [usage()],
    recorded_cost_by_currency: [{ currency: 'USD', total: '240.00' }],
    suggested_invoice: suggested, variance: { state: 'awaiting_invoice' }, can_issue_invoice: true,
  })

  it('shows the closeout facts side by side, and offers the invoice form pre-filled from the suggestion', async () => {
    hubReturns(completedHub(['issue_invoice'], 'issue_invoice', co()))
    open()
    await screen.findByTestId('invoice-form')
    expectOffered(['submit-invoice'])
    expect(screen.getByTestId('closeout-estimate')).toHaveTextContent('Version 1: 90.00 USD')
    expect(screen.getByTestId('closeout-recorded-cost')).toHaveTextContent('Recorded cost in USD: 240.00 USD')
    expect(screen.getByTestId('closeout-part')).toHaveTextContent('Brake pad set × 2: 15.00 USD')
    expect(screen.getByTestId('closeout-variance')).toHaveTextContent(/compared once an invoice is issued/i)
    expect(screen.getByLabelText('Invoice currency (three-letter code)')).toHaveValue('USD')
    expect(screen.getAllByTestId('invoice-line')).toHaveLength(2)
    expect(screen.getByTestId('invoice-suggestion-notes')).toHaveTextContent(/price it yourself/i)
    // the line the server could not price is flagged and left blank — not defaulted to 0
    expect(screen.getAllByTestId('invoice-line-unpriced')).toHaveLength(1)
    expect(within(screen.getAllByTestId('invoice-line')[1]).getByLabelText('Unit price')).toHaveValue('')
    expect(screen.getByTestId('case-next-action')).toHaveTextContent(NEXT_ACTION_LABEL.issue_invoice)
  })

  it('refuses an unpriced line, then issues with every amount as a decimal string and the source of each line', async () => {
    hubReturns(completedHub(['issue_invoice'], 'issue_invoice', co()))
    open()
    await screen.findByTestId('invoice-form')
    fireEvent.click(screen.getByTestId('submit-invoice'))
    expect(await screen.findByTestId('invoice-form-error')).toHaveTextContent(/line 2 needs a price/i)
    expect(issueGarageInvoice).not.toHaveBeenCalled()

    fireEvent.change(within(screen.getAllByTestId('invoice-line')[1]).getByLabelText('Unit price'), { target: { value: '15.00' } })
    fireEvent.change(screen.getByTestId('invoice-due-date'), { target: { value: '2026-11-15' } })
    fireEvent.click(screen.getByTestId('submit-invoice'))
    await waitFor(() => expect(issueGarageInvoice).toHaveBeenCalledTimes(1))
    const [caseId, body] = issueGarageInvoice.mock.calls[0]
    expect(caseId).toBe(CASE_ID)
    expect(body).toEqual({
      currency: 'USD',
      lines: [
        { category: 'labour', description: 'Service — brakes', quantity: '1', unit_price: '240.00', source_kind: 'service_record', source_id: 'rec-1' },
        { category: 'part', description: 'Brake pad set', quantity: '2', unit_price: '15.00', source_kind: 'part_usage', source_id: 'use-1' },
      ],
      customer_note: null,
      internal_note: null,
      due_date: '2026-11-15',
    })
    for (const l of body.lines) expect(typeof l.unit_price).toBe('string')
  })

  it('when the server found no single currency, the currency is blank and REQUIRED — never defaulted', async () => {
    const mixed: NonNullable<Closeout['suggested_invoice']> = {
      currency: null,
      lines: [
        { category: 'labour', description: 'Service — brakes', quantity: '1', unit_price: null, source_kind: 'service_record', source_id: 'rec-1' },
      ],
      notes: ['Amounts were recorded in different currencies (USD, ZWG). They are never converted: choose one invoice currency and price the lines in it.'],
    }
    hubReturns(completedHub(['issue_invoice'], 'issue_invoice', co(mixed)))
    open()
    await screen.findByTestId('invoice-form')
    expect(screen.getByLabelText('Invoice currency (three-letter code)')).toHaveValue('')
    expect(screen.getByTestId('invoice-suggestion-notes')).toHaveTextContent(/never converted: choose one invoice currency/i)
    fireEvent.change(within(screen.getAllByTestId('invoice-line')[0]).getByLabelText('Unit price'), { target: { value: '240' } })
    fireEvent.click(screen.getByTestId('submit-invoice'))
    expect(await screen.findByTestId('invoice-form-error')).toHaveTextContent(/currency as a three-letter code/i)
    expect(issueGarageInvoice).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Invoice currency (three-letter code)'), { target: { value: 'zwg' } })
    fireEvent.click(screen.getByTestId('submit-invoice'))
    await waitFor(() => expect(issueGarageInvoice).toHaveBeenCalledTimes(1))
    expect(issueGarageInvoice.mock.calls[0][1].currency).toBe('ZWG')
  })

  it('a voided invoice stays on record as voided and a new one can be issued', async () => {
    const voided = invoice({ status: 'voided', voided_at: '2026-10-24T09:00:00.000Z', void_reason: 'Wrong customer name', payment_status: 'voided' })
    hubReturns(completedHub(['issue_invoice'], 'issue_invoice', { ...co(), invoice: voided }))
    open()
    expect(await screen.findByTestId('invoice-status')).toHaveTextContent('Voided')
    expect(screen.getByTestId('invoice-void-reason')).toHaveTextContent('Wrong customer name')
    expect(screen.getByTestId('invoice-form')).toBeTruthy()
    expectOffered(['submit-invoice'])
  })
})

describe('(i) an issued invoice: recording a payment the garage received OUTSIDE CarUp', () => {
  const unpaid = () => completedHub(['record_payment', 'void_invoice'], 'await_payment', closeout('completed', {
    invoice: invoice(), estimate: { id: 'est-1', version: 1, currency: 'USD', total_amount: '90.00' },
    variance: invoice().variance,
  }))

  it('shows the invoice, the server’s payment status, and the figures as the server gives them', async () => {
    hubReturns(unpaid())
    open()
    await screen.findByTestId('invoice')
    expect(screen.getByTestId('invoice-number')).toHaveTextContent('INV-0001')
    expect(screen.getByTestId('invoice-total')).toHaveTextContent('100.00 USD')
    expect(screen.getByTestId('invoice-balance')).toHaveTextContent('100.00 USD')
    expect(screen.getByTestId('invoice-payment-status')).toHaveTextContent('No payment recorded')
    expect(screen.getByTestId('payment-source-label')).toHaveTextContent(SOURCE_LABEL)
    expect(screen.getByTestId('closeout-variance')).toHaveTextContent('Difference 10.00 USD — over the estimate')
    expectOffered(['record-payment', 'void-invoice'])
    // an invoice is not a payment, and the page never says so
    expect(screen.getByTestId('invoice-payment-status')).not.toHaveTextContent(/paid/i)
    expect(screen.getByTestId('case-next-action')).toHaveTextContent(NEXT_ACTION_LABEL.await_payment)
  })

  it('states plainly that the money is outside CarUp and not verified by it', async () => {
    hubReturns(unpaid())
    open()
    fireEvent.click(await screen.findByTestId('record-payment'))
    const note = await screen.findByTestId('payment-unverified-note')
    expect(note).toHaveTextContent(/outside CarUp/i)
    expect(note).toHaveTextContent(/does not take, hold or verify/i)
    // the currency is the invoice’s own, shown and not typed
    expect(screen.getByTestId('payment-form')).toHaveTextContent('Currency: USD')
  })

  it('sends the amount as a string with a method, and the SAME idempotency key on a retry after a failure', async () => {
    recordGaragePayment
      .mockRejectedValueOnce(new Error('The payment could not be recorded. Try again.'))
      .mockResolvedValueOnce({ payment_id: 'pay-1', replayed: false })
    hubReturns(unpaid())
    open()
    fireEvent.click(await screen.findByTestId('record-payment'))
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '50.00' } })
    fireEvent.change(screen.getByLabelText('How it was received'), { target: { value: 'cash' } })
    fireEvent.change(screen.getByTestId('payment-reference'), { target: { value: 'Receipt book 12' } })
    fireEvent.click(screen.getByTestId('submit-payment'))

    expect(await screen.findByTestId('case-action-error')).toHaveTextContent('The payment could not be recorded. Try again.')
    // the form is still open for the retry, and the hub was not re-read as if it had worked
    expect(screen.getByTestId('payment-form')).toBeTruthy()
    expect(fetchGarageCaseHub).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('submit-payment'))
    await waitFor(() => expect(recordGaragePayment).toHaveBeenCalledTimes(2))
    const [first, second] = recordGaragePayment.mock.calls
    expect(first[0]).toBe('inv-1')
    expect(first[1]).toMatchObject({ amount: '50.00', method: 'cash', reference: 'Receipt book 12', paid_at: null })
    expect(typeof first[1].amount).toBe('string')
    expect(first[1].idempotency_key).toBeTruthy()
    expect(second[1].idempotency_key).toBe(first[1].idempotency_key)
    expect(second[1].amount).toBe('50.00')
  })

  it('requires an amount and a method before anything is sent', async () => {
    hubReturns(unpaid())
    open()
    fireEvent.click(await screen.findByTestId('record-payment'))
    fireEvent.click(screen.getByTestId('submit-payment'))
    expect(await screen.findByTestId('payment-form-error')).toHaveTextContent(/amount/i)
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '0' } })
    fireEvent.click(screen.getByTestId('submit-payment'))
    expect(screen.getByTestId('payment-form-error')).toHaveTextContent(/greater than zero/i)
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '10' } })
    fireEvent.click(screen.getByTestId('submit-payment'))
    expect(screen.getByTestId('payment-form-error')).toHaveTextContent(/how it was received/i)
    expect(recordGaragePayment).not.toHaveBeenCalled()
  })

  it('a successful payment re-reads the hub, closes the form, and a NEW form gets a NEW key', async () => {
    const partly = completedHub(['record_payment', 'reverse_payment'], 'await_payment', closeout('completed', {
      invoice: invoice({
        payment_status: 'partially_paid', paid_amount: '50.00', balance_amount: '50.00',
        payments: [{
          id: 'pay-1', kind: 'payment', amount: '50.00', currency: 'USD', method: 'cash', reference: null, paid_at: '2026-10-24T08:00:00.000Z',
          recorded_at: '2026-10-24T08:01:00.000Z', source: 'garage_recorded_external', source_label: SOURCE_LABEL, reverses_payment_id: null,
        }],
        receipts: [{
          id: 'rc-1', receipt_number: 'RCT-0001', payment_id: 'pay-1', amount: '50.00', currency: 'USD', status: 'issued',
          issued_at: '2026-10-24T08:01:00.000Z', voided_at: null, payment_source: 'garage_recorded_external', payment_source_label: SOURCE_LABEL,
        }],
      }),
    }))
    fetchGarageCaseHub.mockResolvedValueOnce(unpaid()).mockResolvedValue(partly)
    open()
    fireEvent.click(await screen.findByTestId('record-payment'))
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('How it was received'), { target: { value: 'cash' } })
    fireEvent.click(screen.getByTestId('submit-payment'))
    await waitFor(() => expect(recordGaragePayment).toHaveBeenCalledTimes(1))

    // what is shown now is what the server holds: a partial payment, its balance, and its source on every row
    expect(await screen.findByTestId('payment-row')).toBeTruthy()
    expect(screen.queryByTestId('payment-form')).toBeNull()
    expect(screen.getByTestId('invoice-payment-status')).toHaveTextContent('Partly paid (recorded by the garage)')
    expect(screen.getByTestId('invoice-balance')).toHaveTextContent('50.00 USD')
    expect(screen.getByTestId('payment-source')).toHaveTextContent(SOURCE_LABEL)
    expect(screen.getByTestId('receipt-source')).toHaveTextContent(SOURCE_LABEL)
    expect(screen.getByTestId('receipt-row')).toHaveTextContent('RCT-0001')
    expectOffered(['record-payment', 'reverse-payment'])
    // void is not offered once a payment is recorded (the backend withholds it)
    expect(screen.queryByTestId('void-invoice')).toBeNull()

    const firstKey = recordGaragePayment.mock.calls[0][1].idempotency_key
    fireEvent.click(screen.getByTestId('record-payment'))
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('How it was received'), { target: { value: 'bank_transfer' } })
    fireEvent.click(screen.getByTestId('submit-payment'))
    await waitFor(() => expect(recordGaragePayment).toHaveBeenCalledTimes(2))
    expect(recordGaragePayment.mock.calls[1][1].idempotency_key).not.toBe(firstKey)
  })

  it('reversing a payment needs a reason, sends a key, and is not offered on a payment already reversed', async () => {
    const pay = {
      id: 'pay-1', kind: 'payment' as const, amount: '50.00', currency: 'USD', method: 'cash' as const, reference: null, paid_at: '2026-10-24T08:00:00.000Z',
      recorded_at: '2026-10-24T08:01:00.000Z', source: 'garage_recorded_external' as const, source_label: SOURCE_LABEL, reverses_payment_id: null,
    }
    const paid = completedHub(['reverse_payment'], 'none', closeout('completed', {
      invoice: invoice({
        payment_status: 'paid', paid_amount: '100.00', balance_amount: '0.00',
        payments: [pay, { ...pay, id: 'pay-2', amount: '50.00' }, { ...pay, id: 'rev-1', kind: 'reversal', reverses_payment_id: 'pay-2', reason: 'Bounced' }],
      }),
    }))
    hubReturns(paid)
    open()
    await screen.findAllByTestId('payment-row')
    // pay-1 can be reversed; pay-2 already has a reversal; the reversal row itself is not a payment
    expect(screen.getAllByTestId('reverse-payment')).toHaveLength(1)
    expect(screen.getByTestId('invoice-payment-status')).toHaveTextContent('Paid in full (recorded by the garage)')
    expect(screen.queryByTestId('record-payment')).toBeNull()
    fireEvent.click(screen.getByTestId('reverse-payment'))
    fireEvent.click(screen.getByTestId('reverse-payment-form-submit'))
    expect(await screen.findByTestId('reverse-payment-form-error')).toHaveTextContent(/give a reason/i)
    fireEvent.change(screen.getByTestId('reverse-payment-form-reason'), { target: { value: 'Entered twice' } })
    fireEvent.click(screen.getByTestId('reverse-payment-form-submit'))
    await waitFor(() => expect(reverseGaragePayment).toHaveBeenCalledTimes(1))
    expect(reverseGaragePayment.mock.calls[0][0]).toBe('pay-1')
    expect(reverseGaragePayment.mock.calls[0][1]).toMatchObject({ reason: 'Entered twice' })
    expect(reverseGaragePayment.mock.calls[0][1].idempotency_key).toBeTruthy()
  })

  it('voiding an invoice needs a reason', async () => {
    hubReturns(unpaid())
    open()
    fireEvent.click(await screen.findByTestId('void-invoice'))
    fireEvent.click(screen.getByTestId('void-invoice-form-submit'))
    expect(await screen.findByTestId('void-invoice-form-error')).toHaveTextContent(/give a reason/i)
    expect(voidGarageInvoice).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId('void-invoice-form-reason'), { target: { value: 'Issued to the wrong customer' } })
    fireEvent.click(screen.getByTestId('void-invoice-form-submit'))
    await waitFor(() => expect(voidGarageInvoice).toHaveBeenCalledWith('inv-1', 'Issued to the wrong customer'))
  })

  it('a refused payment shows the server’s message beside the closeout', async () => {
    recordGaragePayment.mockRejectedValue(new Error('That is more than the invoice balance.'))
    hubReturns(unpaid())
    open()
    fireEvent.click(await screen.findByTestId('record-payment'))
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '999' } })
    fireEvent.change(screen.getByLabelText('How it was received'), { target: { value: 'cash' } })
    fireEvent.click(screen.getByTestId('submit-payment'))
    expect(await within(screen.getByTestId('closeout-panel')).findByTestId('case-action-error')).toHaveTextContent('That is more than the invoice balance.')
  })

  it('a fully recorded invoice offers no new payment', async () => {
    hubReturns(completedHub(['reverse_payment'], 'none', closeout('completed', {
      invoice: invoice({ payment_status: 'paid', paid_amount: '100.00', balance_amount: '0.00' }),
    })))
    open()
    await screen.findByTestId('invoice')
    expect(screen.queryByTestId('record-payment')).toBeNull()
    expect(screen.getByTestId('case-next-action')).toHaveTextContent(NEXT_ACTION_LABEL.none)
  })
})

// ───────────────────────────── (j) a mechanic sees no money ─────────────────────────────

describe('(j) the mechanic’s hub has no money anywhere', () => {
  // Exactly what the SERVER sends a mechanic: money_visible false, every price/total/cost already null, the
  // estimate total_state 'hidden' (which is NOT 'not_recorded').
  const hiddenEstimate = () => estimate({
    status: 'accepted', decided_at: '2026-10-21T09:00:00.000Z', money_visible: false, total_amount: null, total_state: 'hidden',
    lines: [{ line_no: 1, category: 'labour', description: 'Front brake pads, fitted', quantity: '1', unit_price: null, line_total: null, price_recorded: true }],
  })
  const mechanicHub = (status: string, allowed: AllowedAction[], next: NextAction, extra: Partial<CaseHub> = {}) =>
    hub(status, allowed, next, {
      closeout: null,
      money_visible: false,
      viewer: { role: 'mechanic', is_admin: false },
      work_order: workOrder('authorized', 'm-1', status === 'completed' ? 'Completed' : 'In Progress'),
      estimates: { latest: hiddenEstimate(), versions: [hiddenEstimate()] },
      service_records: [record({ cost: null })],
      parts_used: [usage({ unit_cost_snapshot: null, sell_price_snapshot: null, price_currency_snapshot: null })],
      ...extra,
    })

  it('shows the work and the parts with no price, no invoice and no payment — and no “Not recorded” in a hidden price’s place', async () => {
    hubReturns(mechanicHub('active', ['record_service', 'use_part', 'reverse_usage', 'complete_job'], 'complete_job'))
    const { container } = open()
    await screen.findByTestId('complete-case')
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/invoice|payment|balance|price|receipt/i)
    expect(text).not.toMatch(/\bUSD\b/)
    // a hidden price is not an unrecorded price: saying "Not recorded" would be a false statement
    expect(text).not.toMatch(/not recorded/i)
    expect(text).not.toMatch(/not shown to your role|hidden/i)
    expect(screen.queryByTestId('closeout-panel')).toBeNull()
    expect(screen.queryByTestId('estimate-total')).toBeNull()
    expect(screen.queryByTestId('estimate-line-total')).toBeNull()
    expect(screen.queryByTestId('service-record-cost')).toBeNull()
    expect(screen.queryByTestId('step-invoice')).toBeNull()
    expect(screen.queryByTestId('step-payment')).toBeNull()
    // the scope of the approved work is still visible, without its prices
    expect(screen.getByTestId('estimate-lines')).toHaveTextContent('Front brake pads, fitted')
    expect(screen.getByTestId('part-usage')).toHaveTextContent('Brake pad set')
    // what a mechanic CAN do is exactly what the backend allows
    expectOffered(['submit-record', 'complete-case', 'use-part'])
    expect(screen.getByTestId('reverse-usage')).toBeTruthy()
    // admin-only reads are not made
    expect(fetchGarageMechanics).not.toHaveBeenCalled()
  })

  it('earlier estimate versions show no total either', async () => {
    const v1 = { ...hiddenEstimate(), id: 'est-0', version: 1, status: 'superseded' as const }
    const v2 = { ...hiddenEstimate(), id: 'est-1', version: 2 }
    hubReturns(mechanicHub('active', ['record_service'], 'record_service', { estimates: { latest: v2, versions: [v2, v1] }, service_records: [], parts_used: [] }))
    const { container } = open()
    await screen.findByTestId('estimate-versions')
    expect(screen.getByTestId('estimate-versions')).toHaveTextContent('Version 1')
    expect(container.textContent ?? '').not.toMatch(/USD|not recorded/i)
  })

  it('even an inconsistent hub (money_visible false but a closeout present) shows no closeout, invoice or payment step', async () => {
    hubReturns(completedHub(['issue_invoice'], 'issue_invoice', closeout('completed', { invoice: invoice() }), {
      money_visible: false, viewer: { role: 'mechanic', is_admin: false },
    }))
    const { container } = open()
    await screen.findByTestId('case-closed')
    expect(screen.queryByTestId('closeout-panel')).toBeNull()
    expect(screen.queryByTestId('step-invoice')).toBeNull()
    expect(screen.getByTestId('case-next-action')).toHaveTextContent(NEXT_ACTION_LABEL.none)
    expect(container.textContent ?? '').not.toMatch(/INV-0001|invoice/i)
  })

  it('the record form has no cost or currency fields, and sends no cost', async () => {
    hubReturns(mechanicHub('active', ['record_service'], 'record_service', { service_records: [], parts_used: [] }))
    open()
    await screen.findByTestId('submit-record')
    expect(screen.queryByTestId('record-cost')).toBeNull()
    expect(screen.queryByTestId('record-currency')).toBeNull()
    fireEvent.change(screen.getByTestId('work-performed'), { target: { value: 'Checked the pads' } })
    fireEvent.click(screen.getByTestId('submit-record'))
    await waitFor(() => expect(recordServiceOnWorkOrder).toHaveBeenCalledTimes(1))
    expect(recordServiceOnWorkOrder.mock.calls[0][1]).toEqual({ work_performed: 'Checked the pads', total_cost: null, currency: null })
  })

  it('a finished job reads as “nothing further”, not “issue the invoice”', async () => {
    // The backend derives issue_invoice from an invoice the mechanic cannot see; it must not leak.
    hubReturns(mechanicHub('completed', [], 'issue_invoice'))
    const { container } = open()
    await screen.findByTestId('case-closed')
    expect(screen.getByTestId('case-next-action')).toHaveTextContent(NEXT_ACTION_LABEL.none)
    expect(container.textContent ?? '').not.toMatch(/invoice|payment/i)
    expectOffered([])
  })

  it('a mechanic who cannot take the next step is told it is for an administrator', async () => {
    hubReturns(mechanicHub('accepted', [], 'prepare_estimate', { work_order: null, estimates: { latest: null, versions: [] }, service_records: [], parts_used: [] }))
    open()
    expect(await screen.findByTestId('next-step-not-yours')).toHaveTextContent(/garage administrator/i)
    expectOffered([])
  })

  it('and for an administrator, who CAN take the step, no such note appears', async () => {
    hubReturns(hub('accepted', ['prepare_estimate'], 'prepare_estimate'))
    open()
    await screen.findByTestId('prepare-estimate')
    expect(screen.queryByTestId('next-step-not-yours')).toBeNull()
  })
})

// ───────────────────────────── unassign / reverse are their own keys ─────────────────────────────

describe('unassign and reverse-usage are offered only on their own keys', () => {
  it('unassign needs unassign_mechanic — assign_mechanic alone does not show it, and the assignment is still shown', async () => {
    hubReturns(hub('accepted', ['assign_mechanic', 'start_work'], 'start_work', { work_order: workOrder('authorized', 'm-1') }))
    open()
    await screen.findByTestId('start-work')
    expect(screen.getByTestId('assigned-mechanic')).toBeTruthy()
    expect(screen.queryByTestId('unassign-mechanic')).toBeNull()
  })

  it('with unassign_mechanic the control is offered and calls the unassign route', async () => {
    hubReturns(hub('accepted', ['assign_mechanic', 'unassign_mechanic', 'start_work'], 'start_work', { work_order: workOrder('authorized', 'm-1') }))
    open()
    fireEvent.click(await screen.findByTestId('unassign-mechanic'))
    await waitFor(() => expect(unassignMechanicFromWorkOrder).toHaveBeenCalledWith(WO_ID))
  })

  it('a mechanic who is assigned sees who, and no unassign control', async () => {
    hubReturns(hub('accepted', ['start_work'], 'start_work', {
      work_order: workOrder('authorized', 'm-1'), money_visible: false, closeout: null, viewer: { role: 'mechanic', is_admin: false },
    }))
    open()
    await screen.findByTestId('start-work')
    expect(screen.getByTestId('assigned-mechanic')).toBeTruthy()
    expect(screen.queryByTestId('unassign-mechanic')).toBeNull()
    expect(screen.queryByTestId('mechanic-select')).toBeNull()
  })

  const withUsage = (allowed: AllowedAction[]) => hub('active', allowed, 'complete_job', {
    work_order: workOrder('authorized', 'm-1'), service_records: [record()], parts_used: [usage()],
  })

  it('use_part alone does not offer a reversal', async () => {
    hubReturns(withUsage(['record_service', 'use_part', 'complete_job']))
    open()
    await screen.findByTestId('use-part')
    expect(screen.getByTestId('part-usage')).toBeTruthy()
    expect(screen.queryByTestId('reverse-usage')).toBeNull()
  })

  it('reverse_usage offers the reversal even when no part can be added', async () => {
    hubReturns(withUsage(['record_service', 'reverse_usage']))
    open()
    expect(await screen.findByTestId('reverse-usage')).toBeTruthy()
    expect(screen.queryByTestId('use-part')).toBeNull()
  })
})

// ───────────────────────────── money truth ─────────────────────────────

describe('money is never invented', () => {
  it('a service record with no cost reads “Not recorded”, and no zero is shown', async () => {
    hubReturns(hub('active', ['record_service', 'use_part', 'complete_job'], 'complete_job', {
      work_order: workOrder('authorized', 'm-1'), service_records: [record({ cost: null })],
    }))
    open()
    expect(await screen.findByTestId('service-record-cost')).toHaveTextContent('Cost: Not recorded')
    expect(screen.getByTestId('service-record-cost')).not.toHaveTextContent(/\b0\b/)
  })

  it('the closeout states an unrecorded total per currency as “Not recorded”', async () => {
    hubReturns(completedHub(['issue_invoice'], 'issue_invoice', closeout('completed', {
      actual_work: [{ service_record_id: 'rec-1', service_category: 'brakes', service_authority: 'garage_stated', performed_at: null, cost: null }],
      recorded_cost_by_currency: [],
      suggested_invoice: { currency: null, lines: [], notes: [] },
      can_issue_invoice: true,
    })))
    open()
    expect(await screen.findByTestId('closeout-work-item')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('closeout-work')).toHaveTextContent(/1 piece of work with no cost recorded/i)
    expect(screen.getByTestId('closeout-work')).not.toHaveTextContent(/\b0\b/)
  })
})

// ───────────────────────────── the request decision ─────────────────────────────

describe('the request decision', () => {
  it('offers accept and decline only when the backend allows them, and sends the right calls', async () => {
    hubReturns(hub('requested', ['accept_case', 'decline_case'], 'accept_or_decline'))
    open()
    fireEvent.click(await screen.findByTestId('decline-case'))
    await waitFor(() => expect(declineServiceCase).toHaveBeenCalledWith(CASE_ID, 'garage_declined'))
  })

  it('a refusal is shown beside the decision and nothing is re-read', async () => {
    acceptServiceCase.mockRejectedValue(new Error('This request was withdrawn by the customer.'))
    hubReturns(hub('requested', ['accept_case', 'decline_case'], 'accept_or_decline'))
    open()
    fireEvent.click(await screen.findByTestId('accept-case'))
    expect(await within(screen.getByTestId('request-decision')).findByTestId('case-action-error'))
      .toHaveTextContent('This request was withdrawn by the customer.')
    expect(fetchGarageCaseHub).toHaveBeenCalledTimes(1)
  })

  it('if the page cannot be refreshed after an action, it says so rather than showing stale state as current', async () => {
    fetchGarageCaseHub
      .mockResolvedValueOnce(hub('requested', ['accept_case', 'decline_case'], 'accept_or_decline'))
      .mockRejectedValue(new Error('network'))
    open()
    fireEvent.click(await screen.findByTestId('accept-case'))
    expect(await screen.findByTestId('case-action-error')).toHaveTextContent(/went through, but this page could not be refreshed/i)
    expect(screen.getByTestId('case-vehicle')).toBeTruthy()
  })
})

// ───────────────────────────── progress ─────────────────────────────

describe('the progress list', () => {
  it('states each step from the recorded facts', async () => {
    hubReturns(hub('active', ['assign_mechanic', 'unassign_mechanic', 'record_service'], 'record_service', {
      work_order: workOrder('authorized', 'm-1'),
      estimates: { latest: estimate({ status: 'accepted', total_state: 'frozen_at_send' }), versions: [] },
      appointment: {
        id: 'a-1', status: 'fulfilled', starts_at: '2026-10-20T06:00:00.000Z', ends_at: '2026-10-20T07:00:00.000Z',
        appointment_timezone: 'Africa/Harare', branch_id: 'b-1', planned_workforce_profile_id: null,
      },
    }))
    open()
    await screen.findByTestId('hub-steps')
    const state = (k: string) => screen.getByTestId(`step-${k}`).getAttribute('data-state')
    expect(state('request')).toBe('done')
    expect(state('appointment')).toBe('done')
    expect(state('estimate')).toBe('done')
    expect(state('decision')).toBe('done')
    expect(state('assign')).toBe('done')
    expect(state('work')).toBe('current')
    expect(state('parts')).toBe('optional')
    expect(state('complete')).toBe('upcoming')
    expect(state('invoice')).toBe('upcoming')
    expect(state('payment')).toBe('upcoming')
  })

  it('no appointment is “none booked”, not a missing step', async () => {
    hubReturns(hub('accepted', ['prepare_estimate'], 'prepare_estimate'))
    open()
    await screen.findByTestId('hub-steps')
    expect(screen.getByTestId('step-appointment')).toHaveAttribute('data-state', 'optional')
    expect(screen.getByTestId('step-appointment')).toHaveTextContent('None booked')
  })
})
