/**
 * R5 — the garage operator must be able to run a job from request to service record.
 *
 * THE DEFECT THIS PINS. `/api/garage/queue`, accept, decline, start, complete, job cards, mechanic
 * assignment and service records were all certified in Foundation 1.0 and NONE of them had a
 * screen. A garage tenant-member who signed in was shown the OWNER dashboard — "sell your car",
 * "your listings" — while their real work sat in a queue nothing rendered.
 *
 * These tests walk the product path a garage actually takes, and assert two rules that keep the
 * workspace honest:
 *   - only the action the case is WAITING for is offered, so no operator is handed a button that
 *     comes back 409;
 *   - a terminal case is history: it is shown and it is not editable.
 *
 * GARAGE-1.0 moved the case screen onto ONE read model (`fetchGarageCaseHub`, whose `allowed_actions` is the
 * backend's own list of what it will accept). These tests keep every invariant above, now driven by hub
 * fixtures instead of the queue + service-case reads: the point of each assertion is unchanged, and where
 * the product changed (a job card is opened by preparing an estimate; starting needs the customer's
 * authorization and an assigned mechanic; completing needs a recorded piece of work) the fixture says so.
 * The per-stage offered / not-offered matrix, money and payment rules live in garageCaseHub.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GarageWorkspace from './GarageWorkspace'
import GarageCaseDetail from './GarageCaseDetail'
import { nextActionFor } from '@/lib/garageWorkspace'
import type { AllowedAction, CaseHub, HubServiceRecord, NextAction } from '@/lib/garageBusiness'

const CASE_ID = 'c-77'
const WO_ID = 'wo-9'
const VIN = 'SNCLOSE020359VIN1'

const fetchGarageQueue = vi.fn()
const fetchGarageCaseHub = vi.fn()
const fetchGarageMechanics = vi.fn()
const listGarageSites = vi.fn()
const acceptServiceCase = vi.fn()
const declineServiceCase = vi.fn()
const startServiceCase = vi.fn()
const completeGarageJob = vi.fn()
const openWorkOrderForCase = vi.fn()
const assignMechanicToWorkOrder = vi.fn()
const unassignMechanicFromWorkOrder = vi.fn()
const recordServiceOnWorkOrder = vi.fn()
const recordMileageObservation = vi.fn()
const fetchGarageCustomers = vi.fn()
const createCaseEstimate = vi.fn()

/**
 * The case screen is now driven by ONE read model, `fetchGarageCaseHub`. The old data sources (the queue
 * filtered to a status, the service-case read, a separate assignment read) are gone from the page, and the
 * page must not reach for them: this mock does not provide them, so a regression would throw.
 */
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchGarageQueue, fetchGarageCaseHub, fetchGarageMechanics, listGarageSites,
    acceptServiceCase, declineServiceCase, startServiceCase, completeGarageJob,
    openWorkOrderForCase, assignMechanicToWorkOrder, unassignMechanicFromWorkOrder,
    recordServiceOnWorkOrder, recordMileageObservation, fetchGarageCustomers, createCaseEstimate,
  }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useParams: () => ({ caseId: CASE_ID }) }
})

/** A hub as an ADMIN of the garage sees it; `allowed` is what the backend would allow at that moment. */
function hubAt(status: string, allowed: AllowedAction[], next: NextAction, extra: Partial<CaseHub> = {}): CaseHub {
  return {
    case: {
      id: CASE_ID, vin: VIN, status, service_category: 'brakes',
      request_summary: 'Brakes grinding at low speed',
      requested_at: '2026-09-06T09:00:00.000Z',
      accepted_at: null, started_at: null, completed_at: null, branch_id: null,
    },
    vehicle: { vin: VIN, make: 'Isuzu', model: 'D-Max', year: 2021 },
    site: null,
    work_order: null,
    appointment: null,
    estimates: { latest: null, versions: [] },
    service_records: [],
    parts_used: [],
    money_visible: true,
    closeout: {
      service_case_id: CASE_ID, case_status: status, work_order: null, estimate: null, actual_work: [], parts_used: [],
      recorded_cost_by_currency: [], suggested_invoice: null, invoice: null, variance: { state: 'no_estimate' },
      can_issue_invoice: false, payment_source_label: 'Recorded by the garage. CarUp has not processed or verified this payment.',
    },
    mechanics: [],
    history: [],
    next_action: next,
    allowed_actions: allowed,
    viewer: { role: 'admin', is_admin: true },
    ...extra,
  }
}

const authorizedOrder = (assigned: string | null = null): CaseHub['work_order'] => ({
  id: WO_ID, status: 'In Progress', owner_authorization: 'authorized',
  owner_authorized_at: '2026-09-06T10:30:00.000Z', assigned_mechanic_user_id: assigned,
})

const oneRecord: HubServiceRecord = {
  id: 'rec-1', service_category: 'brakes', service_authority: 'garage_stated',
  work_performed: 'Replaced front pads and discs', cost: { amount: '240.00', currency: 'USD' },
  performed_at: '2026-09-06T12:00:00.000Z', recorded_by_user_id: 'admin-1',
}

function queueWith(status: string, workOrder: { id: string; status: string } | null) {
  return {
    queue: [{
      id: CASE_ID, status, vin: VIN,
      vehicle: { make: 'Isuzu', model: 'D-Max', year: 2021 },
      service_category: 'brakes', requested_at: '2026-09-06T09:00:00.000Z',
      work_order: workOrder,
      next_action: nextActionFor(status, Boolean(workOrder)),
    }],
    total: 1,
    counts: { requested: status === 'requested' ? 1 : 0, accepted: status === 'accepted' ? 1 : 0, active: status === 'active' ? 1 : 0 },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  fetchGarageMechanics.mockResolvedValue({ mechanics: [{ user_id: 'm-1', display_name: 'Tendai', role: 'mechanic' }], total: 1 })
  listGarageSites.mockResolvedValue({ sites: [] })
  acceptServiceCase.mockResolvedValue({ case: { status: 'accepted' } })
  declineServiceCase.mockResolvedValue({ case: { status: 'declined' } })
  startServiceCase.mockResolvedValue({ case: { status: 'active' } })
  completeGarageJob.mockResolvedValue({ success: true, case: { status: 'completed' }, service_record_count: 1 })
  openWorkOrderForCase.mockResolvedValue({ workOrder: { id: WO_ID, status: 'In Progress' }, created: true })
  assignMechanicToWorkOrder.mockResolvedValue({ success: true })
  unassignMechanicFromWorkOrder.mockResolvedValue({ success: true })
  recordServiceOnWorkOrder.mockResolvedValue({ record: { id: 'rec-1' } })
  recordMileageObservation.mockResolvedValue({ observation: { id: 'obs-1' }, canonical_mileage: null, disagrees_with_canonical: null })
})

const openCase = () => render(<MemoryRouter><GarageCaseDetail /></MemoryRouter>)

describe('R5 — the workshop shows the garage its real work', () => {
  it('lists the queue with counts the SERVER produced', async () => {
    fetchGarageQueue.mockResolvedValue(queueWith('requested', null))
    render(<MemoryRouter><GarageWorkspace /></MemoryRouter>)

    expect(await screen.findByTestId('queue-case')).toBeTruthy()
    expect(screen.getByTestId('count-requested')).toHaveTextContent('1')
    expect(screen.getByTestId('queue-vehicle')).toHaveTextContent('2021 Isuzu D-Max')
    expect(screen.getByTestId('queue-next-action')).toHaveTextContent(/accept or decline/i)
  })

  it('a vehicle it cannot resolve is named by VIN, never given a placeholder', async () => {
    const q = queueWith('requested', null)
    q.queue[0].vehicle = null
    fetchGarageQueue.mockResolvedValue(q)
    render(<MemoryRouter><GarageWorkspace /></MemoryRouter>)
    expect(await screen.findByTestId('queue-vehicle')).toHaveTextContent(`VIN ${VIN}`)
    expect(screen.getByTestId('queue-vehicle')).not.toHaveTextContent(/unknown vehicle/i)
  })

  it('a failed queue read is a failure, never reported as "no work"', async () => {
    fetchGarageQueue.mockRejectedValue(new Error('network'))
    render(<MemoryRouter><GarageWorkspace /></MemoryRouter>)
    expect(await screen.findByTestId('queue-error')).toHaveTextContent(/not a statement that you have no work/i)
    expect(screen.queryByTestId('queue-empty')).toBeNull()
    // And no zeroes are shown, because zero is a claim this page cannot support.
    expect(screen.queryByTestId('count-requested')).toBeNull()
  })
})

describe('R5 — one job, request to service record', () => {
  it('a new request offers accept and decline, and nothing else', async () => {
    fetchGarageCaseHub.mockResolvedValue(hubAt('requested', ['accept_case', 'decline_case'], 'accept_or_decline'))
    openCase()

    await screen.findByTestId('no-sites')
    expect(screen.getByTestId('decline-case')).toBeTruthy()
    // Nothing further is possible yet, so nothing further is offered.
    expect(screen.queryByTestId('prepare-estimate')).toBeNull()
    expect(screen.queryByTestId('start-work')).toBeNull()
    expect(screen.queryByTestId('submit-record')).toBeNull()
    expect(screen.queryByTestId('complete-case')).toBeNull()

    fireEvent.click(screen.getByTestId('accept-case'))
    await waitFor(() => expect(acceptServiceCase).toHaveBeenCalledWith(CASE_ID, undefined))
  })

  it('an accepted case with no job card offers only the estimate (a job card is no longer opened by hand)', async () => {
    fetchGarageCaseHub.mockResolvedValue(hubAt('accepted', ['prepare_estimate'], 'prepare_estimate'))
    openCase()

    await screen.findByTestId('prepare-estimate')
    expect(screen.queryByTestId('start-work')).toBeNull()
    expect(screen.queryByTestId('accept-case')).toBeNull()
    expect(screen.queryByTestId('open-work-order')).toBeNull()
    expect(screen.queryByTestId('mechanic-select')).toBeNull()
  })

  it('viewing a case NEVER creates or changes anything as a side effect', async () => {
    fetchGarageCaseHub.mockResolvedValue(hubAt('accepted', ['prepare_estimate'], 'prepare_estimate'))
    openCase()
    await screen.findByTestId('prepare-estimate')
    // The job-card create endpoint is idempotent, which makes it a tempting way to discover the job card.
    // It would also CREATE one for every operator who merely looked at the case. The page now reads ONE
    // hub and calls nothing that writes.
    for (const writer of [
      openWorkOrderForCase, acceptServiceCase, declineServiceCase, startServiceCase, completeGarageJob,
      assignMechanicToWorkOrder, unassignMechanicFromWorkOrder, recordServiceOnWorkOrder, createCaseEstimate,
    ]) {
      expect(writer).not.toHaveBeenCalled()
    }
    expect(fetchGarageCaseHub).toHaveBeenCalledTimes(1)
  })

  it('once the customer has authorized, a mechanic can be picked by name rather than by UUID', async () => {
    fetchGarageCaseHub.mockResolvedValue(hubAt('accepted', ['assign_mechanic'], 'assign_mechanic', { work_order: authorizedOrder() }))
    openCase()

    const select = await screen.findByTestId('mechanic-select')
    expect(screen.getByText('Tendai')).toBeTruthy()
    fireEvent.change(select, { target: { value: 'm-1' } })
    await waitFor(() => expect(assignMechanicToWorkOrder).toHaveBeenCalledWith(WO_ID, 'm-1'))
  })

  it('and the assignment then SHOWS — the call is not the outcome', async () => {
    /**
     * THE DEFECT THIS PINS. The test above asserted the API was CALLED and passed while the screen
     * showed nothing: the assignment is keyed on the work-order id, which does not change when a
     * mechanic is assigned, so the effect that reads it never re-ran. A real operator assigned
     * someone, saw no change, assigned again, and got "this work order already has an assigned
     * mechanic; unassign first". Round 2 found it in a browser; this suite could not, because it
     * was asserting the wrong half of the interaction.
     *
     * The hub makes the same trap different but no less real: the screen must show what the server
     * says AFTER the assignment, which means the hub has to be re-read. The server reports nobody
     * assigned until the assignment happens, then reports Tendai.
     */
    fetchGarageCaseHub
      .mockResolvedValueOnce(hubAt('accepted', ['assign_mechanic'], 'assign_mechanic', { work_order: authorizedOrder() }))
      .mockResolvedValue(hubAt('accepted', ['assign_mechanic', 'unassign_mechanic', 'start_work'], 'start_work', { work_order: authorizedOrder('m-1') }))
    openCase()

    fireEvent.change(await screen.findByTestId('mechanic-select'), { target: { value: 'm-1' } })
    const assigned = await screen.findByTestId('assigned-mechanic')
    expect(assigned).toHaveTextContent('Tendai')
    // And the picker is replaced by the assignment, so nobody assigns twice.
    expect(screen.queryByTestId('mechanic-select')).toBeNull()
    expect(screen.getByTestId('unassign-mechanic')).toBeTruthy()
    expect(fetchGarageCaseHub).toHaveBeenCalledTimes(2)
  })

  it('a garage with nobody else on CarUp is told so, not shown an empty picker', async () => {
    fetchGarageMechanics.mockResolvedValue({ mechanics: [], total: 0 })
    fetchGarageCaseHub.mockResolvedValue(hubAt('accepted', ['assign_mechanic'], 'assign_mechanic', { work_order: authorizedOrder() }))
    openCase()
    // The old copy promised "you can still record the work yourself". That is no longer true — the work
    // cannot start until a mechanic is assigned — so the point it made (say so, show no empty picker)
    // is kept with the true sentence.
    expect(await screen.findByTestId('no-mechanics')).toHaveTextContent(/no one to assign this to/i)
    expect(screen.getByTestId('no-mechanics')).toHaveTextContent(/assigned before the work can start/i)
    expect(screen.queryByTestId('mechanic-select')).toBeNull()
  })

  it('an authorized, assigned job offers start', async () => {
    fetchGarageCaseHub.mockResolvedValue(hubAt('accepted', ['assign_mechanic', 'unassign_mechanic', 'start_work'], 'start_work', { work_order: authorizedOrder('m-1') }))
    openCase()
    fireEvent.click(await screen.findByTestId('start-work'))
    await waitFor(() => expect(startServiceCase).toHaveBeenCalledWith(CASE_ID))
  })

  it('an active case records work, cost and a mileage OBSERVATION, then completes', async () => {
    // Before anything is recorded the backend offers recording and NOT completion; after the record it
    // offers completion (and parts). The hub is re-read between the two.
    fetchGarageCaseHub
      .mockResolvedValueOnce(hubAt('active', ['assign_mechanic', 'unassign_mechanic', 'record_service'], 'record_service', { work_order: authorizedOrder('m-1') }))
      .mockResolvedValue(hubAt('active', ['assign_mechanic', 'unassign_mechanic', 'record_service', 'use_part', 'complete_job'], 'complete_job', {
        work_order: authorizedOrder('m-1'), service_records: [oneRecord],
      }))
    openCase()

    await screen.findByTestId('submit-record')
    expect(screen.queryByTestId('complete-case')).toBeNull()
    fireEvent.change(screen.getByTestId('work-performed'), { target: { value: 'Replaced front pads and discs' } })
    fireEvent.change(screen.getByTestId('record-cost'), { target: { value: '240' } })
    fireEvent.change(screen.getByTestId('record-currency'), { target: { value: 'usd' } })
    fireEvent.change(screen.getByTestId('record-mileage'), { target: { value: '148320' } })
    fireEvent.click(screen.getByTestId('submit-record'))

    await waitFor(() => expect(recordServiceOnWorkOrder).toHaveBeenCalled())
    expect(recordServiceOnWorkOrder.mock.calls[0][0]).toBe(WO_ID)
    const payload = recordServiceOnWorkOrder.mock.calls[0][1]
    expect(payload.work_performed).toBe('Replaced front pads and discs')
    expect(payload.total_cost).toBe(240)
    // The backend requires ISO-4217 uppercase; the operator should not have to know that.
    expect(payload.currency).toBe('USD')

    // Mileage is attached to the RECORD, as an observation.
    await waitFor(() => expect(recordMileageObservation).toHaveBeenCalledWith('rec-1', 148320))

    fireEvent.click(await screen.findByTestId('complete-case'))
    await waitFor(() => expect(completeGarageJob).toHaveBeenCalledWith(CASE_ID))
  })

  it('says plainly that a mileage reading does not change the odometer', async () => {
    fetchGarageCaseHub.mockResolvedValue(hubAt('active', ['record_service'], 'record_service', { work_order: authorizedOrder('m-1') }))
    openCase()
    expect(await screen.findByTestId('mileage-note')).toHaveTextContent(/does not change the vehicle/i)
  })

  it('refuses a cost with no currency BEFORE sending it', async () => {
    fetchGarageCaseHub.mockResolvedValue(hubAt('active', ['record_service'], 'record_service', { work_order: authorizedOrder('m-1') }))
    openCase()

    await screen.findByTestId('submit-record')
    fireEvent.change(screen.getByTestId('record-cost'), { target: { value: '240' } })
    fireEvent.click(screen.getByTestId('submit-record'))

    expect(await screen.findByTestId('record-form-error')).toHaveTextContent(/three-letter code/i)
    expect(recordServiceOnWorkOrder).not.toHaveBeenCalled()
  })

  it('a completed case is history: shown, and not editable', async () => {
    fetchGarageCaseHub.mockResolvedValue(hubAt('completed', [], 'none', {
      work_order: { ...authorizedOrder('m-1'), status: 'Completed' }, service_records: [oneRecord],
    }))
    openCase()

    expect(await screen.findByTestId('case-closed')).toHaveTextContent(/cannot be reopened/i)
    for (const id of [
      'accept-case', 'decline-case', 'open-work-order', 'prepare-estimate', 'start-work', 'submit-record',
      'complete-case', 'mechanic-select', 'submit-invoice', 'record-payment',
    ]) {
      expect(screen.queryByTestId(id), `${id} must not be offered on a closed job`).toBeNull()
    }
    // What was recorded stays visible.
    expect(screen.getByTestId('service-record')).toHaveTextContent('Replaced front pads and discs')
  })

  it('a refusal from the server is shown in full, not swallowed', async () => {
    acceptServiceCase.mockRejectedValue(new Error('This case is not in a state that can be accepted'))
    fetchGarageCaseHub.mockResolvedValue(hubAt('requested', ['accept_case', 'decline_case'], 'accept_or_decline'))
    openCase()

    fireEvent.click(await screen.findByTestId('accept-case'))
    expect(await screen.findByTestId('case-action-error')).toHaveTextContent(/not in a state that can be accepted/i)
  })

  it('a hub that cannot be read is a failure, never an empty job', async () => {
    fetchGarageCaseHub.mockRejectedValue(new Error('network'))
    openCase()
    expect(await screen.findByTestId('case-error')).toHaveTextContent(/could not be opened/i)
    expect(screen.queryByTestId('case-status')).toBeNull()
  })
})

describe('R5 — the state→action rule itself', () => {
  it('offers exactly one thing per state, and nothing on a closed case', () => {
    expect(nextActionFor('requested', false)).toBe('accept_or_decline')
    expect(nextActionFor('requested', true)).toBe('accept_or_decline')
    expect(nextActionFor('accepted', false)).toBe('open_work_order')
    expect(nextActionFor('accepted', true)).toBe('start_work')
    expect(nextActionFor('active', true)).toBe('record_service')
    for (const closed of ['completed', 'declined', 'cancelled']) {
      expect(nextActionFor(closed, true)).toBe('none')
    }
  })

  it('the legacy two-argument answer is untouched by the facts parameter', () => {
    // An existing caller (the queue's fixtures) passes two arguments and must keep getting the legacy rule.
    expect(nextActionFor('accepted', true)).toBe('start_work')
    expect(nextActionFor('accepted', true, undefined)).toBe('start_work')
    // Passing facts selects the full rule: a job card alone is NOT "start" any more.
    expect(nextActionFor('accepted', true, {})).toBe('prepare_estimate')
  })

  it('with facts, mirrors the backend rule row by row', () => {
    // The same table the backend pins in garage-hub.test.js ("pure ladder"). If the two drift, a screen
    // would explain a job one way while the server allows another.
    const rows: Array<[string, boolean, Parameters<typeof nextActionFor>[2], string]> = [
      ['requested', false, {}, 'accept_or_decline'],
      ['accepted', false, {}, 'prepare_estimate'],
      ['accepted', true, { ownerAuthorization: 'pending' }, 'prepare_estimate'],
      ['accepted', true, { ownerAuthorization: 'pending', latestEstimateStatus: 'draft' }, 'send_estimate'],
      ['accepted', true, { ownerAuthorization: 'pending', latestEstimateStatus: 'sent' }, 'await_customer'],
      ['accepted', true, { ownerAuthorization: 'declined', latestEstimateStatus: 'declined' }, 'revise_estimate'],
      ['accepted', true, { ownerAuthorization: 'authorized' }, 'assign_mechanic'],
      ['accepted', true, { ownerAuthorization: 'authorized', assignedMechanicUserId: 'm' }, 'start_work'],
      ['accepted', true, { ownerAuthorization: 'revoked' }, 'authorization_revoked'],
      ['active', true, { ownerAuthorization: 'authorized', serviceRecordCount: 0 }, 'record_service'],
      ['active', true, { ownerAuthorization: 'authorized', serviceRecordCount: 2 }, 'complete_job'],
      ['active', true, { ownerAuthorization: 'revoked', serviceRecordCount: 2 }, 'authorization_revoked'],
      ['completed', true, {}, 'issue_invoice'],
      ['completed', true, { invoice: { status: 'issued', payment_status: 'unpaid' } }, 'await_payment'],
      ['completed', true, { invoice: { status: 'issued', payment_status: 'partially_paid' } }, 'await_payment'],
      ['completed', true, { invoice: { status: 'issued', payment_status: 'paid' } }, 'none'],
      ['completed', true, { invoice: { status: 'voided' } }, 'issue_invoice'],
      ['declined', false, {}, 'none'],
      ['cancelled', true, {}, 'none'],
    ]
    for (const [status, hasWorkOrder, facts, expected] of rows) {
      expect(nextActionFor(status, hasWorkOrder, facts), `${status} ${JSON.stringify(facts)}`).toBe(expected)
    }
    // a missing authorization reads as pending, never authorized
    expect(nextActionFor('accepted', true, { assignedMechanicUserId: 'm' })).toBe('prepare_estimate')
  })
})
