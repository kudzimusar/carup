/**
 * T11.3 — what the participant's tracking page is allowed to CLAIM.
 *
 * The failures this guards against are all the same shape: a customer reading a date or a reference
 * and concluding something happened that nobody recorded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({ view: null as unknown, err: null as Error | null }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: { id: 'u1' } }) }))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({
  useTradeLogisticsApi: () => ({
    getMyTracking: vi.fn(async () => { if (state.err) throw state.err; return state.view }),
  }),
}))

import MyShipmentTracking from './MyShipmentTracking'

const SUBJECT = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

const dates = (over = {}) => ({
  planned_departure: '2026-09-20T00:00:00Z',
  planned_departure_source: 'stated_at_creation',
  observed_departure: null,
  estimated_arrival: '2026-10-01T00:00:00Z',
  observed_arrival: null,
  note: 'A planned departure is an intention. An estimated arrival is an estimate. Only the observed dates are records of something that happened.',
  ...over,
})

const view = (over = {}) => ({
  subject: { type: 'cargo_reservation', id: SUBJECT },
  state: 'SHIPMENT_CREATED',
  sentence: 'A shipment has been set up for your container. Nothing has been recorded as moving yet.',
  left_behind_reason: null,
  dates: dates(),
  references: {
    carrier: 'Maersk', tracking_reference: 'TRK-999', origin_port: 'Durban', destination_port: 'Beira',
    container_number: null, seal_number: null,
    note: 'A carrier or tracking reference means the paperwork exists. It is not a record that anything has moved.',
  },
  timeline: [],
  exception: null,
  note: 'Customs, duties and release are recorded separately and are not shown here.',
  ...over,
})

const open = async (testId = 'my-shipment-tracking') => {
  render(
    <MemoryRouter initialEntries={[`/diaspora/tracking/cargo_reservation/${SUBJECT}`]}>
      <Routes><Route path="/diaspora/tracking/:subjectType/:subjectId" element={<MyShipmentTracking />} /></Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument())
}

beforeEach(() => { state.err = null; state.view = view() })

describe('a plan is not a departure', () => {
  it('does not say departed when only a planned date exists', async () => {
    await open()
    expect(screen.getByTestId('tracking-departure-headline')).toHaveTextContent('Not recorded as departed')
    expect(screen.getByTestId('tracking-departure-detail')).toHaveTextContent('That is a plan, not a record that it left')
  })

  it('says departed once a departure was observed', async () => {
    state.view = view({ state: 'IN_TRANSIT', sentence: 'Your container has left and is on its way.', dates: dates({ observed_departure: '2026-09-21T08:00:00Z' }) })
    await open()
    expect(screen.getByTestId('tracking-departure-headline')).toHaveTextContent('Departed')
    expect(screen.getByTestId('tracking-badge')).toHaveTextContent('On its way')
  })
})

describe('an ETA is not an arrival', () => {
  it('does not say arrived for an ETA in the past', async () => {
    state.view = view({ state: 'IN_TRANSIT', dates: dates({ observed_departure: '2026-09-21T08:00:00Z', estimated_arrival: '2026-09-01T00:00:00Z' }) })
    await open()
    expect(screen.getByTestId('tracking-arrival-headline')).toHaveTextContent('Not recorded as arrived')
    expect(screen.getByTestId('tracking-arrival-detail')).toHaveTextContent('An estimate can move')
  })

  it('says arrived once an arrival was observed', async () => {
    state.view = view({ state: 'ARRIVED', sentence: 'Your container has arrived.', dates: dates({ observed_departure: '2026-09-21T08:00:00Z', observed_arrival: '2026-10-02T00:00:00Z' }) })
    await open()
    expect(screen.getByTestId('tracking-arrival-headline')).toHaveTextContent('Arrived')
  })
})

describe('a reference is not movement', () => {
  it('shows the carrier and says what it does not mean', async () => {
    await open()
    expect(screen.getByTestId('tracking-references')).toHaveTextContent('Maersk')
    expect(screen.getByTestId('tracking-reference-note')).toHaveTextContent('not a record that anything has moved')
  })

  it('reports an unrecorded reference as unrecorded', async () => {
    state.view = view({ references: { carrier: null, tracking_reference: null, origin_port: null, destination_port: null, container_number: null, seal_number: null, note: 'A carrier or tracking reference means the paperwork exists. It is not a record that anything has moved.' } })
    await open()
    expect(screen.getByTestId('tracking-references')).toHaveTextContent('Not recorded')
  })
})

describe('loaded is not sailed', () => {
  it('says so at the moment it matters', async () => {
    state.view = view({
      state: 'LOADED', sentence: 'Your cargo is inside the container. The container has not been recorded as leaving.',
      dates: null, references: null,
      note: 'Loaded means the cargo is inside the container. It does not mean the container has sailed.',
    })
    await open()
    expect(screen.getByTestId('tracking-badge')).toHaveTextContent('Loaded — not sailed')
    expect(screen.getByTestId('tracking-disclaimer')).toHaveTextContent('does not mean the container has sailed')
  })

  it('a shipment existing is not movement', async () => {
    await open()
    expect(screen.getByTestId('tracking-badge')).toHaveTextContent('nothing moving yet')
    expect(screen.getByTestId('tracking-sentence')).toHaveTextContent('Nothing has been recorded as moving yet')
  })
})

describe('a customs hold is not a customs decision', () => {
  it('shows the hold and refuses the verdict', async () => {
    state.view = view({
      state: 'EXCEPTION', sentence: 'Something has happened to your shipment that the organiser has recorded.',
      dates: dates({ observed_departure: '2026-09-21T08:00:00Z' }),
      exception: { stage: 'CUSTOMS_HOLD', recorded_at: '2026-09-30T00:00:00Z', note: 'This is what the organiser recorded about your shipment. It is not a customs decision.' },
    })
    await open()
    expect(screen.getByTestId('tracking-exception')).toHaveTextContent('Held at customs')
    expect(screen.getByTestId('tracking-exception-note')).toHaveTextContent('not a customs decision')
    const text = screen.getByTestId('my-shipment-tracking').textContent?.toLowerCase() || ''
    for (const forbidden of ['cleared', 'duty', 'assessed', 'released by']) {
      expect(text).not.toContain(forbidden)
    }
  })
})

describe('left behind', () => {
  it('gives the reason and no journey', async () => {
    state.view = view({
      state: 'LEFT_BEHIND', sentence: 'Your cargo was not loaded into this container.',
      left_behind_reason: 'NO_SPACE', dates: null, references: null, timeline: [],
      note: 'Your cargo is not on this container, so there is no journey to follow. What happens to it next is arranged with the organiser.',
    })
    await open()
    expect(screen.getByTestId('tracking-badge')).toHaveTextContent('Not on this container')
    expect(screen.getByTestId('tracking-left-behind')).toHaveTextContent('No room left in the container')
    expect(screen.queryByTestId('tracking-departure')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tracking-timeline')).not.toBeInTheDocument()
  })
})

describe('the timeline and the T12 firewall', () => {
  it('shows movement events with time and place, and nothing else', async () => {
    state.view = view({
      state: 'IN_TRANSIT', dates: dates({ observed_departure: '2026-09-21T08:00:00Z' }),
      timeline: [{ stage: 'IN_TRANSIT', event_time: '2026-09-21T08:00:00Z', location: 'Durban' }],
    })
    await open()
    expect(screen.getByTestId('tracking-timeline')).toHaveTextContent('On its way')
    expect(screen.getByTestId('tracking-timeline')).toHaveTextContent('Durban')
  })

  it('says customs is recorded elsewhere', async () => {
    await open()
    expect(screen.getByTestId('tracking-disclaimer')).toHaveTextContent('recorded separately')
  })

  it('links back to the loading record rather than duplicating it', async () => {
    await open()
    expect(screen.getByTestId('tracking-loading-link')).toHaveAttribute('href', `/diaspora/cargo-loading/cargo_reservation/${SUBJECT}`)
  })

  it('a read failure is not reported as "nothing has happened"', async () => {
    state.err = new Error('Network unreachable')
    await open('tracking-unreadable')
    expect(screen.getByTestId('tracking-unreadable')).toHaveTextContent('not a report that nothing has happened')
  })
})
