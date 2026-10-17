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
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GarageWorkspace from './GarageWorkspace'
import GarageCaseDetail from './GarageCaseDetail'
import { nextActionFor } from '@/lib/garageWorkspace'

const CASE_ID = 'c-77'
const WO_ID = 'wo-9'
const VIN = 'SNCLOSE020359VIN1'

const fetchGarageQueue = vi.fn()
const fetchServiceRequest = vi.fn()
const fetchGarageMechanics = vi.fn()
const fetchWorkOrderAssignment = vi.fn()
const acceptServiceCase = vi.fn()
const declineServiceCase = vi.fn()
const startServiceCase = vi.fn()
const completeServiceCase = vi.fn()
const openWorkOrderForCase = vi.fn()
const assignMechanicToWorkOrder = vi.fn()
const unassignMechanicFromWorkOrder = vi.fn()
const recordServiceOnWorkOrder = vi.fn()
const recordMileageObservation = vi.fn()
const fetchGarageCustomers = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchGarageQueue, fetchServiceRequest, fetchGarageMechanics, fetchWorkOrderAssignment,
    acceptServiceCase, declineServiceCase, startServiceCase, completeServiceCase,
    openWorkOrderForCase, assignMechanicToWorkOrder, unassignMechanicFromWorkOrder,
    recordServiceOnWorkOrder, recordMileageObservation, fetchGarageCustomers,
  }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useParams: () => ({ caseId: CASE_ID }) }
})

function caseAt(status: string, extra: Record<string, unknown> = {}) {
  return {
    case: {
      id: CASE_ID, vin: VIN, status, service_category: 'brakes',
      request_summary: 'Brakes grinding at low speed',
      requested_at: '2026-09-06T09:00:00.000Z',
      accepted_at: null, started_at: null, completed_at: null, declined_at: null, cancelled_at: null,
      conversation_thread_id: null, ...extra,
    },
    history: [],
  }
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
  vi.clearAllMocks()
  fetchGarageMechanics.mockResolvedValue({ mechanics: [{ user_id: 'm-1', display_name: 'Tendai', role: 'mechanic' }] })
  fetchWorkOrderAssignment.mockResolvedValue({ assigned_mechanic_user_id: null, assigned: false, history: [] })
  acceptServiceCase.mockResolvedValue({ case: { status: 'accepted' } })
  declineServiceCase.mockResolvedValue({ case: { status: 'declined' } })
  startServiceCase.mockResolvedValue({ case: { status: 'active' } })
  completeServiceCase.mockResolvedValue({ case: { status: 'completed' } })
  openWorkOrderForCase.mockResolvedValue({ workOrder: { id: WO_ID, status: 'In Progress' }, created: true })
  assignMechanicToWorkOrder.mockResolvedValue({ assignment: { mechanic_user_id: 'm-1' }, created: true })
  unassignMechanicFromWorkOrder.mockResolvedValue({ assignment: {} })
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
    fetchServiceRequest.mockResolvedValue(caseAt('requested'))
    fetchGarageQueue.mockResolvedValue(queueWith('requested', null))
    openCase()

    await screen.findByTestId('accept-case')
    expect(screen.getByTestId('decline-case')).toBeTruthy()
    // Nothing further is possible yet, so nothing further is offered.
    expect(screen.queryByTestId('open-work-order')).toBeNull()
    expect(screen.queryByTestId('start-work')).toBeNull()
    expect(screen.queryByTestId('submit-record')).toBeNull()
    expect(screen.queryByTestId('complete-case')).toBeNull()

    fireEvent.click(screen.getByTestId('accept-case'))
    await waitFor(() => expect(acceptServiceCase).toHaveBeenCalledWith(CASE_ID))
  })

  it('an accepted case with no job card offers only the job card', async () => {
    fetchServiceRequest.mockResolvedValue(caseAt('accepted', { accepted_at: '2026-09-06T10:00:00.000Z' }))
    fetchGarageQueue.mockResolvedValue(queueWith('accepted', null))
    openCase()

    await screen.findByTestId('open-work-order')
    expect(screen.queryByTestId('start-work')).toBeNull()
    expect(screen.queryByTestId('accept-case')).toBeNull()

    fireEvent.click(screen.getByTestId('open-work-order'))
    await waitFor(() => expect(openWorkOrderForCase).toHaveBeenCalledWith(CASE_ID))
  })

  it('viewing a case NEVER opens a job card as a side effect', async () => {
    fetchServiceRequest.mockResolvedValue(caseAt('accepted'))
    fetchGarageQueue.mockResolvedValue(queueWith('accepted', null))
    openCase()
    await screen.findByTestId('open-work-order')
    // The create endpoint is idempotent, which makes it a tempting way to discover the job card.
    // It would also CREATE one for every operator who merely looked at the case.
    expect(openWorkOrderForCase).not.toHaveBeenCalled()
  })

  it('once a job card exists, a mechanic can be picked by name rather than by UUID', async () => {
    fetchServiceRequest.mockResolvedValue(caseAt('accepted'))
    fetchGarageQueue.mockResolvedValue(queueWith('accepted', { id: WO_ID, status: 'In Progress' }))
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
     */
    fetchServiceRequest.mockResolvedValue(caseAt('accepted'))
    fetchGarageQueue.mockResolvedValue(queueWith('accepted', { id: WO_ID, status: 'In Progress' }))
    // The server reports nobody assigned until the assignment happens, then reports Tendai.
    fetchWorkOrderAssignment.mockResolvedValue({ assigned_mechanic_user_id: null, assigned: false, history: [] })
    assignMechanicToWorkOrder.mockImplementation(async () => {
      fetchWorkOrderAssignment.mockResolvedValue({ assigned_mechanic_user_id: 'm-1', assigned: true, history: [] })
      return { success: true }
    })
    openCase()

    fireEvent.change(await screen.findByTestId('mechanic-select'), { target: { value: 'm-1' } })
    const assigned = await screen.findByTestId('assigned-mechanic')
    expect(assigned).toHaveTextContent('Tendai')
    // And the picker is replaced by the assignment, so nobody assigns twice.
    expect(screen.queryByTestId('mechanic-select')).toBeNull()
    expect(screen.getByTestId('unassign-mechanic')).toBeTruthy()
  })

  it('a garage with nobody else on CarUp is told so, not shown an empty picker', async () => {
    fetchGarageMechanics.mockResolvedValue({ mechanics: [] })
    fetchServiceRequest.mockResolvedValue(caseAt('accepted'))
    fetchGarageQueue.mockResolvedValue(queueWith('accepted', { id: WO_ID, status: 'In Progress' }))
    openCase()
    expect(await screen.findByTestId('no-mechanics')).toHaveTextContent(/still record the work yourself/i)
    expect(screen.queryByTestId('mechanic-select')).toBeNull()
  })

  it('an accepted case WITH a job card offers start', async () => {
    fetchServiceRequest.mockResolvedValue(caseAt('accepted'))
    fetchGarageQueue.mockResolvedValue(queueWith('accepted', { id: WO_ID, status: 'In Progress' }))
    openCase()
    fireEvent.click(await screen.findByTestId('start-work'))
    await waitFor(() => expect(startServiceCase).toHaveBeenCalledWith(CASE_ID))
  })

  it('an active case records work, cost and a mileage OBSERVATION, then completes', async () => {
    fetchServiceRequest.mockResolvedValue(caseAt('active', { started_at: '2026-09-06T11:00:00.000Z' }))
    fetchGarageQueue.mockResolvedValue(queueWith('active', { id: WO_ID, status: 'In Progress' }))
    openCase()

    await screen.findByTestId('submit-record')
    fireEvent.change(screen.getByTestId('work-performed'), { target: { value: 'Replaced front pads and discs' } })
    fireEvent.change(screen.getByTestId('record-cost'), { target: { value: '240' } })
    fireEvent.change(screen.getByTestId('record-currency'), { target: { value: 'usd' } })
    fireEvent.change(screen.getByTestId('record-mileage'), { target: { value: '148320' } })
    fireEvent.click(screen.getByTestId('submit-record'))

    await waitFor(() => expect(recordServiceOnWorkOrder).toHaveBeenCalled())
    const payload = recordServiceOnWorkOrder.mock.calls[0][1]
    expect(payload.work_performed).toBe('Replaced front pads and discs')
    expect(payload.total_cost).toBe(240)
    // The backend requires ISO-4217 uppercase; the operator should not have to know that.
    expect(payload.currency).toBe('USD')

    // Mileage is attached to the RECORD, as an observation.
    await waitFor(() => expect(recordMileageObservation).toHaveBeenCalledWith('rec-1', 148320))

    fireEvent.click(screen.getByTestId('complete-case'))
    await waitFor(() => expect(completeServiceCase).toHaveBeenCalledWith(CASE_ID))
  })

  it('says plainly that a mileage reading does not change the odometer', async () => {
    fetchServiceRequest.mockResolvedValue(caseAt('active'))
    fetchGarageQueue.mockResolvedValue(queueWith('active', { id: WO_ID, status: 'In Progress' }))
    openCase()
    expect(await screen.findByTestId('mileage-note')).toHaveTextContent(/does not change the vehicle/i)
  })

  it('refuses a cost with no currency BEFORE sending it', async () => {
    fetchServiceRequest.mockResolvedValue(caseAt('active'))
    fetchGarageQueue.mockResolvedValue(queueWith('active', { id: WO_ID, status: 'In Progress' }))
    openCase()

    await screen.findByTestId('submit-record')
    fireEvent.change(screen.getByTestId('record-cost'), { target: { value: '240' } })
    fireEvent.click(screen.getByTestId('submit-record'))

    expect(await screen.findByTestId('record-form-error')).toHaveTextContent(/three-letter code/i)
    expect(recordServiceOnWorkOrder).not.toHaveBeenCalled()
  })

  it('a completed case is history: shown, and not editable', async () => {
    fetchServiceRequest.mockResolvedValue(caseAt('completed', { completed_at: '2026-09-06T12:00:00.000Z' }))
    fetchGarageQueue.mockResolvedValue(queueWith('completed', { id: WO_ID, status: 'Completed' }))
    openCase()

    expect(await screen.findByTestId('case-closed')).toHaveTextContent(/cannot be reopened/i)
    for (const id of ['accept-case', 'decline-case', 'open-work-order', 'start-work', 'submit-record', 'complete-case', 'mechanic-select']) {
      expect(screen.queryByTestId(id), `${id} must not be offered on a closed job`).toBeNull()
    }
  })

  it('a refusal from the server is shown in full, not swallowed', async () => {
    acceptServiceCase.mockRejectedValue(new Error('This case is not in a state that can be accepted'))
    fetchServiceRequest.mockResolvedValue(caseAt('requested'))
    fetchGarageQueue.mockResolvedValue(queueWith('requested', null))
    openCase()

    fireEvent.click(await screen.findByTestId('accept-case'))
    expect(await screen.findByTestId('case-action-error')).toHaveTextContent(/not in a state that can be accepted/i)
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
})
