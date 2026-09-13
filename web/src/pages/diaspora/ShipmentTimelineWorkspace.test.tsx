/**
 * T11.2 — the operator's shipment movement timeline.
 *
 * What no backend test can prove: that recording movement is reachable through the product, that
 * plan/estimate/observed are visibly three different things, and that the screen offers no way to
 * assert a customs outcome.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({ view: null as unknown, err: null as Error | null, recorded: [] as unknown[], actionError: null as Error | null }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: { id: 'op1' } }) }))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({
  useTradeLogisticsApi: () => ({
    getShipmentOperatorView: vi.fn(async () => { if (state.err) throw state.err; return state.view }),
    recordShipmentStage: vi.fn(async (id: string, payload: unknown) => {
      if (state.actionError) throw state.actionError
      state.recorded.push({ id, payload }); return {}
    }),
  }),
}))

import ShipmentTimelineWorkspace from './ShipmentTimelineWorkspace'

const dates = (over = {}) => ({
  planned_departure: '2026-09-20T00:00:00Z', planned_departure_source: 'stated_at_creation',
  observed_departure: null, estimated_arrival: '2026-10-01T00:00:00Z', observed_arrival: null,
  note: 'A planned departure is an intention.', ...over,
})

const view = (over = {}) => ({
  shipment: { id: 'ship-1', reference: 'SHPM-AB12CD34', stage: 'PLANNED', import_order_id: 'ord-a', container_id: 'cont-1' },
  dates: dates(),
  references: {
    carrier: 'Maersk', tracking_reference: 'TRK-999', origin_port: 'Durban', destination_port: 'Beira',
    container_number: 'MSKU7654321', seal_number: 'SEAL-A1',
    note: 'A carrier or tracking reference means the paperwork exists. It is not a record that anything has moved.',
  },
  load: { id: 'load-1', reference: 'LOAD-1', status: 'COMPLETED', completed_at: '2026-09-12T10:00:00Z', loaded_lines: 2, left_behind_lines: 1, actual_loaded_volume_cbm: 3.6 },
  timeline: [],
  note: 'Customs, duties and release are recorded separately and are not shown here.',
  ...over,
})

const open = async (testId = 'shipment-timeline-workspace') => {
  const user = userEvent.setup()
  render(<MemoryRouter><ShipmentTimelineWorkspace /></MemoryRouter>)
  await user.type(screen.getByTestId('shipment-input'), 'ship-1')
  await user.click(screen.getByTestId('shipment-submit'))
  await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument())
  return user
}

beforeEach(() => { state.err = null; state.actionError = null; state.view = view(); state.recorded = [] })

describe('plan, estimate and observation are three different things', () => {
  it('keeps departure and arrival in separate panels with different words', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('shipment-departure')).toBeInTheDocument())
    expect(screen.getByTestId('shipment-departure-headline')).toHaveTextContent('Not recorded as departed')
    expect(screen.getByTestId('shipment-departure-detail')).toHaveTextContent('That is a plan, not a record that it left')
    expect(screen.getByTestId('shipment-arrival-headline')).toHaveTextContent('Not recorded as arrived')
    expect(screen.getByTestId('shipment-arrival-detail')).toHaveTextContent('An estimate can move')
  })

  it('says departed only once it was observed', async () => {
    state.view = view({ dates: dates({ observed_departure: '2026-09-21T08:00:00Z' }) })
    await open()
    await waitFor(() => expect(screen.getByTestId('shipment-departure-headline')).toBeInTheDocument())
    expect(screen.getByTestId('shipment-departure-headline')).toHaveTextContent('Departed')
    expect(screen.getByTestId('shipment-departure-detail')).toHaveTextContent('actual departure')
  })
})

describe('where the shipment came from', () => {
  it('shows the completed load, and left-behind cargo as NOT travelling', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('shipment-load')).toBeInTheDocument())
    expect(screen.getByTestId('shipment-loaded-lines')).toHaveTextContent('2 consignment(s) loaded')
    expect(screen.getByTestId('shipment-left-behind-lines')).toHaveTextContent('1 left behind — not travelling')
  })

  it('reports an unrecorded loaded volume as unrecorded', async () => {
    state.view = view({ load: { id: 'load-1', reference: 'LOAD-1', status: 'COMPLETED', completed_at: null, loaded_lines: 1, left_behind_lines: 0, actual_loaded_volume_cbm: null } })
    await open()
    await waitFor(() => expect(screen.getByTestId('shipment-load')).toBeInTheDocument())
    expect(screen.getByTestId('shipment-load')).toHaveTextContent('loaded volume not recorded')
  })
})

describe('recording an observation', () => {
  it('says which fact each stage writes', async () => {
    const user = await open()
    await waitFor(() => expect(screen.getByTestId('stage-form')).toBeInTheDocument())
    await user.selectOptions(screen.getByTestId('stage-select'), 'IN_TRANSIT')
    expect(screen.getByTestId('stage-hint')).toHaveTextContent('records an ACTUAL departure')
    await user.selectOptions(screen.getByTestId('stage-select'), 'BOOKED')
    expect(screen.getByTestId('stage-hint')).toHaveTextContent('Nothing has moved')
  })

  it('sends the stage and an optional observed time', async () => {
    const user = await open()
    await waitFor(() => expect(screen.getByTestId('stage-form')).toBeInTheDocument())
    await user.selectOptions(screen.getByTestId('stage-select'), 'IN_TRANSIT')
    await user.type(screen.getByTestId('stage-notes'), 'Vessel departed Durban')
    await user.click(screen.getByTestId('stage-submit'))
    await waitFor(() => expect(state.recorded).toHaveLength(1))
    const payload = (state.recorded[0] as { payload: Record<string, unknown> }).payload
    expect(payload.stage).toBe('IN_TRANSIT')
    expect(payload.notes).toBe('Vessel departed Durban')
  })

  it('will not submit without a stage', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('stage-submit')).toBeInTheDocument())
    expect(screen.getByTestId('stage-submit')).toBeDisabled()
  })

  it('surfaces the server refusal rather than swallowing it', async () => {
    state.actionError = new Error('A shipment at ARRIVED cannot move to IN_TRANSIT. A shipment cannot go backwards.')
    const user = await open()
    await waitFor(() => expect(screen.getByTestId('stage-form')).toBeInTheDocument())
    await user.selectOptions(screen.getByTestId('stage-select'), 'IN_TRANSIT')
    await user.click(screen.getByTestId('stage-submit'))
    await waitFor(() => expect(screen.getByTestId('shipment-error')).toBeInTheDocument())
    expect(screen.getByTestId('shipment-error')).toHaveTextContent('cannot go backwards')
  })
})

describe('the T12 firewall', () => {
  it('offers NO way to record a customs decision', async () => {
    const user = await open()
    await waitFor(() => expect(screen.getByTestId('stage-select')).toBeInTheDocument())
    const options = [...(screen.getByTestId('stage-select') as HTMLSelectElement).options].map((o) => o.value)
    // RELEASED and COMPLETED are reachable in the underlying enum. Offering them here would invite
    // an operator to assert a customs outcome from a movement screen.
    for (const forbidden of ['RELEASED', 'COMPLETED']) expect(options).not.toContain(forbidden)
    // …and a hold IS offered, because where the goods are is T11's to record.
    expect(options).toContain('CUSTOMS_HOLD')
    await user.selectOptions(screen.getByTestId('stage-select'), 'CUSTOMS_HOLD')
    expect(screen.getByTestId('stage-hint')).toHaveTextContent('says nothing about what customs decided')
  })

  it('says in the form that customs cannot be entered here', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('stage-customs-note')).toBeInTheDocument())
    expect(screen.getByTestId('stage-customs-note')).toHaveTextContent('cannot be entered here')
  })

  it('says customs is recorded elsewhere', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('shipment-disclaimer')).toBeInTheDocument())
    expect(screen.getByTestId('shipment-disclaimer')).toHaveTextContent('recorded separately')
  })
})

describe('the timeline', () => {
  it('shows provenance for every event', async () => {
    state.view = view({
      timeline: [{ id: 'e1', stage: 'IN_TRANSIT', event_time: '2026-09-21T08:00:00Z', location: 'Durban', notes: 'Vessel departed', recorded_by: 'user-operator', recorded_at: '2026-09-21T08:05:00Z', source: 'carrier email' }],
    })
    await open()
    await waitFor(() => expect(screen.getByTestId('shipment-timeline')).toBeInTheDocument())
    expect(screen.getByTestId('event-provenance-e1')).toHaveTextContent('Recorded by user-operator')
    expect(screen.getByTestId('event-provenance-e1')).toHaveTextContent('source: carrier email')
  })

  it('says the history cannot be edited, before an operator tries', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('shipment-append-only-note')).toBeInTheDocument())
    expect(screen.getByTestId('shipment-append-only-note')).toHaveTextContent('cannot be edited or deleted')
    expect(screen.getByTestId('shipment-append-only-note')).toHaveTextContent('record what actually happened as a new event')
  })

  it('says nothing has been recorded rather than showing an empty box', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('shipment-timeline')).toBeInTheDocument())
    expect(screen.getByTestId('shipment-timeline')).toHaveTextContent('Nothing has been recorded about this shipment moving')
  })
})

describe('references and failure', () => {
  it('reports unrecorded references as unrecorded', async () => {
    state.view = view({ references: { carrier: null, tracking_reference: null, origin_port: null, destination_port: null, container_number: null, seal_number: null, note: 'A carrier or tracking reference means the paperwork exists. It is not a record that anything has moved.' } })
    await open()
    await waitFor(() => expect(screen.getByTestId('shipment-references')).toBeInTheDocument())
    expect(screen.getByTestId('shipment-references')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('shipment-reference-note')).toHaveTextContent('not a record that anything has moved')
  })

  it('a read failure is not reported as "nothing happened"', async () => {
    state.err = new Error('Network unreachable')
    await open('shipment-unreadable')
    expect(screen.getByTestId('shipment-unreadable')).toHaveTextContent('not a report that nothing has happened to it')
  })

  it('an unrecognised payload does not crash the screen', async () => {
    state.view = { data: [] }
    await open('shipment-unreadable')
    expect(screen.getByTestId('shipment-unreadable')).toBeInTheDocument()
  })
})
