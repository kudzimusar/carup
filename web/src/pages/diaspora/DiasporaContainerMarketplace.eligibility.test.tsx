import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * CARUP-MVP-STAB-01 F-022 — what the Container Co-Loading screen says about a sailing's booking
 * window.
 *
 * A stored BOOKING_OPEN is not the same as bookable: nothing closes a sailing on its own, so a sailing
 * past its cut-off — or past its departure — can still be stored as open. The screen must never
 * offer a request the server will refuse, must never show a participant a departed sailing, and
 * must tell the operator who runs an expired open sailing to close it.
 */

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  containers: [] as unknown[],
  capacity: new Map<string, unknown>(),
  reserveError: null as (Error & { code?: string }) | null,
  calls: { list: 0, close: [] as string[], reserve: 0 },
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: state.user, isAuthenticated: true, loading: false }),
}))

vi.mock('./SharedChargeAllocation', () => ({ SharedChargeAllocationPanel: () => null }))

// The real hook's hazard, reproduced: a fresh aggregate object on every render, stable individual
// methods, and a state change on every settled request.
let bump: ((fn: (n: number) => number) => void) | null = null
const settle = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
  try { return await fn(...args) } finally { bump?.((n) => n + 1) }
}
const stable = {
  fetchDiasporaMarketplaceContainers: settle(async (status?: string) => {
    state.calls.list += 1
    return status ? [] : state.containers
  }),
  createDiasporaMarketplaceContainer: settle(async () => ({})),
  fetchDiasporaTradeCorridors: settle(async () => []),
  openDiasporaContainerBooking: settle(async () => ({})),
  cancelDiasporaContainerSailing: settle(async () => ({})),
  fetchDiasporaContainerCapacity: settle(async (id: string) => state.capacity.get(id)),
  fetchDiasporaContainerReservations: settle(async () => []),
  requestDiasporaReservation: settle(async () => {
    state.calls.reserve += 1
    if (state.reserveError) throw state.reserveError
    return { id: 'res-new', reservation_status: 'REQUESTED' }
  }),
  approveDiasporaMarketplaceReservation: settle(async () => ({})),
  rejectDiasporaMarketplaceReservation: settle(async () => ({})),
  cancelDiasporaMarketplaceReservation: settle(async () => ({})),
  closeDiasporaContainerBooking: settle(async (id: string) => {
    state.calls.close.push(id)
    return {}
  }),
  fetchDiasporaImportOrders: settle(async () => []),
  readContainerSharedCharges: settle(async () => []),
  allocateSharedCharge: settle(async () => ({})),
  ensureDiasporaContainerConversation: settle(async () => ({})),
}
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => {
    const [, setTick] = useState(0)
    bump = setTick
    return { ...stable }
  },
}))

const DiasporaContainerMarketplace = (await import('./DiasporaContainerMarketplace')).default

const settleTime = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })

const BUYER = { id: 'buyer-1', name: 'Buyer', role: 'owner' }
const OPERATOR = { id: 'op-1', name: 'Operator', role: 'owner', active_tenant_id: 'tenant-op', tenant_role: 'admin' }

function sailing(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, tenant_id: 'tenant-op', coordinator_id: 'op-1', status: 'BOOKING_OPEN',
    origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare',
    container_type: '40HC', booking_deadline: '2099-01-10T00:00:00Z', departure_date: '2099-02-01T00:00:00Z',
    total_capacity_volume: 60, used_capacity_volume: 0, available_capacity_volume: 60, metadata: {},
    booking_eligibility: { state: 'open', bookable: true, reason: null },
    ...overrides,
  }
}

const CUTOFF = {
  booking_deadline: '2026-10-08T00:00:00Z', departure_date: '2099-02-01T00:00:00Z',
  booking_eligibility: { state: 'deadline_passed', bookable: false, reason: 'Booking for this sailing closed on 8 Oct 2026.' },
}
const DEPARTED = {
  booking_deadline: '2026-09-20T00:00:00Z', departure_date: '2026-10-15T00:00:00Z',
  booking_eligibility: { state: 'departed', bookable: false, reason: 'This sailing departed on 15 Oct 2026 and no longer takes bookings.' },
}

function card(id: string) {
  const found = document.querySelector(`[data-testid="diaspora-container-card"][data-container-id="${id}"]`)
  return found as HTMLElement | null
}

async function renderPage(user: Record<string, unknown>, containers: unknown[]) {
  state.user = user
  state.containers = containers
  render(<MemoryRouter><DiasporaContainerMarketplace /></MemoryRouter>)
  await settleTime()
}

async function openCard(id: string) {
  const target = card(id)
  expect(target, `card ${id} is rendered`).not.toBeNull()
  fireEvent.click(within(target as HTMLElement).getByTestId('diaspora-container-open'))
  await settleTime()
}

beforeEach(() => {
  state.user = null
  state.containers = []
  state.capacity = new Map()
  state.reserveError = null
  state.calls = { list: 0, close: [], reserve: 0 }
})

describe('a participant', () => {
  it('never sees a departed sailing, and sees a past-cut-off sailing as closed — with no request form', async () => {
    await renderPage(BUYER, [
      sailing('sail-future'),
      sailing('sail-cutoff', CUTOFF),
      // Even if a server ever sent one, a departed sailing must not reach a participant.
      sailing('sail-departed', DEPARTED),
    ])

    expect(card('sail-future')).not.toBeNull()
    expect(card('sail-departed')).toBeNull()
    expect(screen.getByTestId('diaspora-container-open-count').textContent).toBe('1 open · 1 not taking requests')

    const closed = card('sail-cutoff') as HTMLElement
    expect(within(closed).getByTestId('diaspora-container-booking-closed').textContent).toBe('Booking closed — the cut-off passed on 8 Oct 2026')
    expect(within(closed).getByTestId('diaspora-container-status').textContent).toBe('BOOKING CLOSED')
    expect(within(closed).queryByTestId('diaspora-container-cutoff-passed')).toBeNull()

    await openCard('sail-cutoff')
    expect(screen.getByTestId('diaspora-container-booking-unavailable').textContent).toContain('Booking closed — the cut-off passed on 8 Oct 2026')
    expect(screen.queryByTestId('diaspora-container-request-form')).toBeNull()
    expect(screen.queryByTestId('diaspora-container-reserve-submit')).toBeNull()
    expect(screen.queryByText('Request cargo space')).toBeNull()
    expect(screen.queryByTestId('diaspora-container-close-booking')).toBeNull()

    await openCard('sail-future')
    expect(screen.getByTestId('diaspora-container-request-form')).toBeTruthy()
    expect(screen.getByTestId('diaspora-container-reserve-submit')).toBeTruthy()
    expect(screen.queryByTestId('diaspora-container-booking-unavailable')).toBeNull()

    // The page must not loop on its loaders (the useCarUpApi aggregate hazard).
    expect(state.calls.list).toBeLessThanOrEqual(2)
  })

  it('a full sailing offers no request form either', async () => {
    await renderPage(BUYER, [sailing('sail-full', {
      used_capacity_volume: 59, available_capacity_volume: 1,
      metadata: { capacity: { fillPercent: 0.983, readyToClose: true, full: true } },
      booking_eligibility: { state: 'full', bookable: false, reason: 'This sailing is full and cannot take more bookings.' },
    })])
    expect(within(card('sail-full') as HTMLElement).getByTestId('diaspora-container-full')).toBeTruthy()
    await openCard('sail-full')
    expect(screen.getByTestId('diaspora-container-booking-unavailable').textContent).toContain('This sailing is full')
    expect(screen.queryByTestId('diaspora-container-request-form')).toBeNull()
  })

  it('without a server annotation (an older backend) an expired sailing still never looks bookable', async () => {
    const unannotated = (row: Record<string, unknown>) => {
      const copy = { ...row }
      delete copy.booking_eligibility
      return copy
    }
    await renderPage(BUYER, [
      unannotated(sailing('raw-cutoff', CUTOFF)),
      unannotated(sailing('raw-departed', DEPARTED)),
      unannotated(sailing('raw-future')),
    ])

    expect(card('raw-departed')).toBeNull()
    expect(within(card('raw-cutoff') as HTMLElement).getByTestId('diaspora-container-booking-closed').textContent)
      .toBe('Booking closed — the cut-off passed on 8 Oct 2026')
    await openCard('raw-cutoff')
    expect(screen.queryByTestId('diaspora-container-request-form')).toBeNull()
    await openCard('raw-future')
    expect(screen.getByTestId('diaspora-container-request-form')).toBeTruthy()
  })

  it('when the cut-off passes while the form is open, the refusal is shown and the form gives way', async () => {
    await renderPage(BUYER, [sailing('sail-live')])
    await openCard('sail-live')
    expect(screen.getByTestId('diaspora-container-request-form')).toBeTruthy()

    const refusal = Object.assign(new Error('Booking for this sailing closed on 21 Oct 2026.'), { code: 'DIASPORA_CONTAINER/BOOKING_DEADLINE_PASSED' })
    state.reserveError = refusal
    const expired = sailing('sail-live', {
      booking_deadline: '2026-10-21T00:00:00Z',
      booking_eligibility: { state: 'deadline_passed', bookable: false, reason: 'Booking for this sailing closed on 21 Oct 2026.' },
    })
    state.capacity.set('sail-live', { container: expired, capacity: {} })
    state.containers = [expired]

    fireEvent.change(screen.getByTestId('diaspora-container-reserve-volume'), { target: { value: '4' } })
    fireEvent.click(screen.getByTestId('diaspora-container-reserve-submit'))
    await settleTime()

    expect(state.calls.reserve).toBe(1)
    expect(screen.getByTestId('diaspora-container-reserve-error').textContent).toBe('Booking for this sailing closed on 21 Oct 2026.')
    expect(screen.queryByTestId('diaspora-container-request-form')).toBeNull()
    expect(screen.getByTestId('diaspora-container-booking-unavailable').textContent).toContain('Booking closed — the cut-off passed on 21 Oct 2026')
  })
})

describe('the operator running the sailing', () => {
  it('still sees its expired open sailings, and is told to close them next to Close booking', async () => {
    await renderPage(OPERATOR, [
      sailing('own-cutoff', CUTOFF),
      sailing('own-departed', DEPARTED),
      // Another organisation's sailing: here the operator is only a participant.
      sailing('rival-cutoff', { ...CUTOFF, tenant_id: 'tenant-rival', coordinator_id: 'rival-1' }),
    ])

    const departed = card('own-departed') as HTMLElement
    expect(departed).not.toBeNull()
    expect(within(departed).getByTestId('diaspora-container-cutoff-passed').textContent).toBe('Cut-off passed — close this sailing')
    expect(within(departed).getByTestId('diaspora-container-status').textContent).toBe('BOOKING OPEN')

    const rival = card('rival-cutoff') as HTMLElement
    expect(within(rival).queryByTestId('diaspora-container-cutoff-passed')).toBeNull()
    expect(within(rival).getByTestId('diaspora-container-booking-closed').textContent).toBe('Booking closed — the cut-off passed on 8 Oct 2026')

    await openCard('own-cutoff')
    expect(screen.getByTestId('diaspora-container-close-booking')).toBeTruthy()
    expect(screen.getByTestId('diaspora-container-cutoff-prompt').textContent?.trim()).toBe('Cut-off passed — close this sailing')
    expect(screen.getByTestId('diaspora-container-cutoff-detail').textContent).toContain('The booking cut-off was 8 Oct 2026.')
    expect(screen.queryByTestId('diaspora-container-request-form')).toBeNull()

    state.capacity.set('own-cutoff', { container: sailing('own-cutoff', { ...CUTOFF, status: 'BOOKING_CLOSED', booking_eligibility: { state: 'not_open', bookable: false, reason: 'This sailing is not open for booking.' } }), capacity: {} })
    fireEvent.click(screen.getByTestId('diaspora-container-close-booking'))
    await settleTime()
    expect(state.calls.close).toEqual(['own-cutoff'])
    expect(screen.queryByTestId('diaspora-container-cutoff-prompt')).toBeNull()
  })

  it('a live sailing carries no cut-off prompt', async () => {
    await renderPage(OPERATOR, [sailing('own-live')])
    await openCard('own-live')
    expect(screen.getByTestId('diaspora-container-close-booking')).toBeTruthy()
    expect(screen.queryByTestId('diaspora-container-cutoff-prompt')).toBeNull()
    expect(screen.getByTestId('diaspora-container-request-form')).toBeTruthy()
  })
})
