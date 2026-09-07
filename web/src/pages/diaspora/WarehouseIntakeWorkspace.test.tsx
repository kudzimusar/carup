/**
 * T9.3 — the operator's warehouse intake workspace.
 *
 * Two things are being proven here that no backend test can prove: that the central act of the phase
 * is reachable through the product at all, and that it cannot be performed by accident on somebody
 * else's consignment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({
  queue: null as unknown,
  err: null as Error | null,
  received: [] as unknown[],
  measured: [] as unknown[],
  assigned: [] as unknown[],
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: { id: 'op1' } }) }))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({
  useTradeLogisticsApi: () => ({
    listIntakeQueue: vi.fn(async () => { if (state.err) throw state.err; return state.queue }),
    receiveIntake: vi.fn(async (id: string, payload: unknown) => { state.received.push({ id, payload }); return {} }),
    recordMeasurement: vi.fn(async (id: string, payload: unknown) => { state.measured.push({ id, payload }); return {} }),
    assignStorageLocation: vi.fn(async (id: string, location: string) => { state.assigned.push({ id, location }); return {} }),
  }),
}))

import WarehouseIntakeWorkspace from './WarehouseIntakeWorkspace'

const SUBJECT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const REQUIRED_REF = 'A1B2C3D4'

const estimate = (over = {}) => ({
  volume_cbm: 3, weight_kg: 800, completeness: 'COMPLETE', items_total: 1, items_with_volume: 1, source: 'x', ...over,
})
const intake = (over = {}) => ({
  id: 'in-1', reference: 'WHIN-A1B2C3D4', warehouse_id: 'wh-1',
  subject: { type: 'cargo_reservation', id: SUBJECT_ID },
  status: 'EXPECTED', status_sentence: 'The warehouse is expecting your cargo. Nothing has arrived yet.',
  received_at: null, received_at_source: null, condition: null, outcome_reason: null,
  observed_package_count: null, storage_location: null,
  estimate: estimate(), actual: null, earlier_measurements: 0,
  discrepancy: { status: 'NOT_MEASURED', volume: null, weight: null, commercial_effect: 'none', note: 'A difference … does not by itself change the price, the booking or the space reserved.' },
  ...over,
})
const queue = (intakes: unknown[] = [intake()]) => ({
  warehouses: [{ id: 'wh-1', name: 'Durban Consolidation', country: 'South Africa', city: 'Durban' }],
  intakes,
})

const open = async (testId = 'warehouse-intake-workspace') => {
  render(<MemoryRouter><WarehouseIntakeWorkspace /></MemoryRouter>)
  await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument())
}

const select = async (user: ReturnType<typeof userEvent.setup>, id = 'in-1') => {
  await user.click(screen.getByTestId(`intake-row-${id}`))
  await waitFor(() => expect(screen.getByTestId('intake-detail')).toBeInTheDocument())
}

beforeEach(() => { state.err = null; state.queue = queue(); state.received = []; state.measured = []; state.assigned = [] })

describe('the queue', () => {
  it('lists what is expected, with what it was booked as', async () => {
    await open()
    const row = screen.getByTestId('intake-row-in-1')
    expect(row).toHaveTextContent('WHIN-A1B2C3D4')
    expect(row).toHaveTextContent('Booked as 3.000 CBM')
    expect(row).toHaveTextContent('not measured')
  })

  it('tells somebody with no warehouse that there is nothing here, not that they are locked out', async () => {
    state.queue = { warehouses: [], intakes: [] }
    await open('intake-no-warehouse')
    expect(screen.getByTestId('intake-no-warehouse')).toHaveTextContent('not set up to receive cargo at any warehouse')
  })

  it('a read failure is not reported as an empty queue', async () => {
    state.err = new Error('Network unreachable')
    await open('intake-unreadable')
    expect(screen.getByTestId('intake-unreadable')).toHaveTextContent('not a report that there is nothing to receive')
  })

  it('an unrecognised payload does not crash the screen', async () => {
    state.queue = { data: [] }
    await open('intake-unreadable')
    expect(screen.getByTestId('intake-unreadable')).toBeInTheDocument()
  })
})

describe('receiving is confirmed, not clicked', () => {
  it('will not submit until the operator names the right consignment', async () => {
    const user = userEvent.setup()
    await open()
    await select(user)
    const submit = screen.getByTestId('intake-receive-submit')
    expect(submit).toBeDisabled()

    await user.type(screen.getByTestId('intake-confirm'), 'WRONGREF')
    expect(submit).toBeDisabled()
    expect(state.received).toHaveLength(0)

    await user.clear(screen.getByTestId('intake-confirm'))
    await user.type(screen.getByTestId('intake-confirm'), REQUIRED_REF)
    expect(submit).toBeEnabled()
  })

  it('records the receipt with the operator\'s own observation', async () => {
    const user = userEvent.setup()
    await open()
    await select(user)
    await user.selectOptions(screen.getByTestId('intake-condition'), 'minor_damage')
    await user.type(screen.getByTestId('intake-packages'), '4')
    await user.type(screen.getByTestId('intake-reason'), 'Corner crushed')
    await user.type(screen.getByTestId('intake-confirm'), REQUIRED_REF)
    await user.click(screen.getByTestId('intake-receive-submit'))

    await waitFor(() => expect(state.received).toHaveLength(1))
    const { payload } = state.received[0] as { payload: Record<string, unknown> }
    expect(payload.condition).toBe('minor_damage')
    expect(payload.observedPackageCount).toBe(4)
    expect(payload.outcomeReason).toBe('Corner crushed')
    // The client never names the receiver. It has no field for it, and the server would ignore one.
    expect(payload).not.toHaveProperty('receivedBy')
    expect(payload).not.toHaveProperty('received_by')
  })

  it('offers refusal as a first-class outcome, not a failure', async () => {
    const user = userEvent.setup()
    await open()
    await select(user)
    await user.click(screen.getByTestId('intake-outcome-REFUSED'))
    expect(screen.getByTestId('intake-receive-form')).toHaveTextContent('the customer has to be able to act on it')
  })

  it('says a condition is the operator\'s own observation, not read off a photo', async () => {
    const user = userEvent.setup()
    await open()
    await select(user)
    expect(screen.getByTestId('intake-receive-form')).toHaveTextContent('Not read off a photo')
  })

  it('does not offer a receive form for cargo already received', async () => {
    state.queue = queue([intake({ status: 'RECEIVED', received_at: '2026-09-10T09:00:00Z', condition: 'good' })])
    const user = userEvent.setup()
    await open()
    await select(user)
    expect(screen.queryByTestId('intake-receive-form')).not.toBeInTheDocument()
    expect(screen.getByTestId('intake-detail-status')).toHaveTextContent('Received')
  })
})

describe('measuring', () => {
  const held = () => queue([intake({ status: 'RECEIVED', received_at: '2026-09-10T09:00:00Z', condition: 'good' })])

  it('is NOT offered for cargo that has not arrived', async () => {
    const user = userEvent.setup()
    await open()
    await select(user)
    // Measuring something nobody has taken delivery of would be recording an observation of an
    // object that is not in the building.
    expect(screen.queryByTestId('intake-measure-form')).not.toBeInTheDocument()
  })

  it('is offered once the warehouse actually holds the cargo', async () => {
    state.queue = held()
    const user = userEvent.setup()
    await open()
    await select(user)
    expect(screen.getByTestId('intake-measure-form')).toBeInTheDocument()
  })

  it('sends the measured dimensions and never a client-computed volume', async () => {
    state.queue = held()
    const user = userEvent.setup()
    await open()
    await select(user)
    await user.type(screen.getByTestId('measure-length'), '200')
    await user.type(screen.getByTestId('measure-width'), '100')
    await user.type(screen.getByTestId('measure-height'), '190')
    await user.click(screen.getByTestId('intake-measure-submit'))

    await waitFor(() => expect(state.measured).toHaveLength(1))
    const { payload } = state.measured[0] as { payload: Record<string, unknown> }
    expect(payload).toMatchObject({ lengthValue: 200, widthValue: 100, heightValue: 190, dimensionUnit: 'cm' })
    // The server derives it. A browser-computed 3.8 would be a claim.
    expect(payload).not.toHaveProperty('actualVolumeCbm')
    expect(payload).not.toHaveProperty('volume_cbm')
  })

  it('does NOT pre-fill the estimate into the measurement fields', async () => {
    state.queue = held()
    const user = userEvent.setup()
    await open()
    await select(user)
    // A pre-filled 3.0 that nobody re-measured is how an estimate quietly becomes an observation.
    for (const id of ['measure-length', 'measure-width', 'measure-height', 'measure-weight']) {
      expect(screen.getByTestId(id)).toHaveValue(null)
    }
  })

  it('says the dimensions describe the whole consignment, not one carton', async () => {
    state.queue = held()
    const user = userEvent.setup()
    await open()
    await select(user)
    expect(screen.getByTestId('intake-measure-form')).toHaveTextContent('not one carton')
  })

  it('shows the estimate beside the measurement so a difference is visible', async () => {
    state.queue = queue([intake({
      status: 'RECEIVED', received_at: '2026-09-10T09:00:00Z',
      actual: { id: 'm1', length_value: 200, width_value: 100, height_value: 190, dimension_unit: 'cm', weight_value: null, weight_unit: null, package_count: null, volume_cbm: 3.8, measured_at: '2026-09-10T10:00:00Z', method: 'manual' },
      discrepancy: { status: 'DIFFERS', volume: { estimated_cbm: 3, actual_cbm: 3.8, difference_cbm: 0.8, direction: 'LARGER' }, weight: null, commercial_effect: 'none', note: 'It does not by itself change the price, the booking or the space reserved.' },
    })])
    const user = userEvent.setup()
    await open()
    await select(user)
    expect(screen.getByTestId('intake-estimate')).toHaveTextContent('3.000 CBM')
    expect(screen.getByTestId('intake-actual')).toHaveTextContent('3.800 CBM')
    expect(screen.getByTestId('intake-discrepancy')).toHaveTextContent('Larger than estimated')
    expect(screen.getByTestId('intake-discrepancy')).toHaveTextContent('does not by itself change the price')
  })
})

describe('storage location', () => {
  it('is only offered for cargo actually held, and warns against inventing one', async () => {
    state.queue = queue([intake({ status: 'RECEIVED', received_at: '2026-09-10T09:00:00Z' })])
    const user = userEvent.setup()
    await open()
    await select(user)
    const form = screen.getByTestId('intake-storage-form')
    expect(form).toHaveTextContent('somebody will later go and look')
    expect(screen.getByTestId('storage-submit')).toBeDisabled()
    await user.type(screen.getByTestId('storage-input'), 'Bay 4, rack C')
    await user.click(screen.getByTestId('storage-submit'))
    await waitFor(() => expect(state.assigned).toEqual([{ id: 'in-1', location: 'Bay 4, rack C' }]))
  })

  it('reports an unassigned position as unassigned', async () => {
    state.queue = queue([intake({ status: 'RECEIVED', received_at: '2026-09-10T09:00:00Z' })])
    const user = userEvent.setup()
    await open()
    await select(user)
    expect(screen.getByTestId('intake-storage')).toHaveTextContent('not assigned')
  })
})

describe('evidence and the phase firewall', () => {
  it('links to the ONE governed documents workspace', async () => {
    const user = userEvent.setup()
    await open()
    await select(user)
    expect(screen.getByTestId('intake-evidence-link')).toHaveAttribute('href', '/diaspora/documents/warehouse_intake/in-1')
  })

  it('says a refusal leaves the booking untouched', async () => {
    state.queue = queue([intake({ status: 'REFUSED', received_at: '2026-09-10T09:00:00Z', outcome_reason: 'Crate open' })])
    const user = userEvent.setup()
    await open()
    await select(user)
    expect(screen.getByTestId('intake-refused-note')).toHaveTextContent('booking and its history are untouched')
  })

  it('never offers a loading, shipping or departure action', async () => {
    state.queue = queue([intake({ status: 'RECEIVED', received_at: '2026-09-10T09:00:00Z', storage_location: 'Bay 4' })])
    const user = userEvent.setup()
    await open()
    await select(user)
    const text = screen.getByTestId('warehouse-intake-workspace').textContent?.toLowerCase() || ''
    for (const later of ['ready to load', 'load plan', 'loaded', 'shipped', 'departed', 'customs', 'in transit']) {
      expect(text).not.toContain(later)
    }
  })
})
