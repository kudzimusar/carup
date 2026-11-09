/**
 * T9.3 — what the customer's cargo page is allowed to CLAIM.
 *
 * The failure this guards against is a person reading "0.000 CBM" beside their 3.0 CBM estimate and
 * concluding their cargo shrank, or reading "+0.8 CBM" and concluding they are about to be charged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({ view: null as unknown, err: null as Error | null }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: { id: 'u1' } }) }))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({
  useTradeLogisticsApi: () => ({
    getMyCargo: vi.fn(async () => { if (state.err) throw state.err; return state.view }),
  }),
}))

import MyCargoIntake from './MyCargoIntake'

const estimate = (over = {}) => ({
  volume_cbm: 3, weight_kg: 800, completeness: 'COMPLETE', items_total: 1, items_with_volume: 1,
  source: 'The volume this booking was approved against', ...over,
})

const intake = (over = {}) => ({
  id: 'in-1', reference: 'WHIN-A1B2C3D4', warehouse_id: 'wh-1',
  subject: { type: 'cargo_reservation', id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
  status: 'RECEIVED', status_sentence: 'The warehouse has your cargo.',
  received_at: '2026-09-10T09:30:00Z', received_at_source: 'server_clock',
  condition: 'good', outcome_reason: null, observed_package_count: 4, storage_location: null,
  estimate: estimate(), actual: null, earlier_measurements: 0,
  discrepancy: { status: 'NOT_MEASURED', volume: null, weight: null, commercial_effect: 'none', note: 'A difference between the estimate and the measurement is a record of what was found. It does not by itself change the price, the booking or the space reserved.' },
  ...over,
})

const view = (over = {}) => ({
  subject: { type: 'cargo_reservation', id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
  intake: intake(), estimate: estimate(),
  status_sentence: 'The warehouse has your cargo.',
  eligible_for_intake: true, eligibility_note: null, ...over,
})

const open = async (testId = 'my-cargo') => {
  render(
    <MemoryRouter initialEntries={['/diaspora/cargo/cargo_reservation/a1b2c3d4-e5f6-7890-abcd-ef1234567890']}>
      <Routes><Route path="/diaspora/cargo/:subjectType/:subjectId" element={<MyCargoIntake />} /></Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument())
}

beforeEach(() => { state.err = null; state.view = view() })

describe('has it arrived', () => {
  it('says the warehouse has it, with the arrival time it actually recorded', async () => {
    await open()
    expect(screen.getByTestId('cargo-status-badge')).toHaveTextContent('Received')
    expect(screen.getByTestId('cargo-received-at')).not.toHaveTextContent('Not recorded')
  })

  it('says nothing has been booked in rather than implying movement', async () => {
    state.view = view({ intake: null, status_sentence: 'No warehouse has booked this cargo in yet.' })
    await open()
    expect(screen.getByTestId('cargo-status-sentence')).toHaveTextContent('No warehouse has booked this cargo in yet.')
    expect(screen.getByTestId('cargo-arrival')).toHaveTextContent('Not booked in anywhere yet')
  })

  it('tells a customer WHY their cargo cannot be booked in yet', async () => {
    state.view = view({
      intake: null, eligible_for_intake: false,
      eligibility_note: 'This booking is requested, not approved. Cargo can only be received against an approved booking.',
      status_sentence: 'No warehouse has booked this cargo in yet.',
    })
    await open()
    expect(screen.getByTestId('cargo-arrival')).toHaveTextContent('not approved')
  })

  it('shows the reason when the warehouse refused the cargo', async () => {
    state.view = view({
      intake: intake({ status: 'REFUSED', outcome_reason: 'Crate was open and contents were loose', condition: null }),
      status_sentence: 'The warehouse did not take your cargo in.',
    })
    await open()
    expect(screen.getByTestId('cargo-status-badge')).toHaveTextContent('Not taken in')
    expect(screen.getByTestId('cargo-outcome-reason')).toHaveTextContent('Crate was open')
  })

  it('a read failure is not reported as "nothing arrived"', async () => {
    state.err = new Error('Network unreachable')
    await open('cargo-unreadable')
    expect(screen.getByTestId('cargo-unreadable')).toHaveTextContent('not a report that nothing has arrived')
  })
})

describe('storage location', () => {
  it('says a position has not been assigned rather than inventing one', async () => {
    await open()
    const storage = screen.getByTestId('cargo-storage')
    expect(storage).toHaveTextContent('Not assigned a position yet')
    for (const invented of ['Bay A', 'Rack 1', 'Zone']) expect(storage).not.toHaveTextContent(invented)
  })

  it('shows the position once somebody actually assigned one', async () => {
    state.view = view({ intake: intake({ storage_location: 'Bay 4, rack C' }) })
    await open()
    expect(screen.getByTestId('cargo-storage')).toHaveTextContent('Bay 4, rack C')
  })
})

describe('estimated versus actual', () => {
  it('shows BOTH, and calls an unmeasured actual "Not measured" rather than zero', async () => {
    await open()
    expect(screen.getByTestId('cargo-estimate')).toHaveTextContent('3.000 CBM')
    const actual = screen.getByTestId('cargo-actual')
    expect(actual).toHaveTextContent('Not measured')
    expect(actual).not.toHaveTextContent('0.000')
  })

  it('shows the 3.0 → 3.8 case as +0.800 CBM with the estimate intact', async () => {
    state.view = view({
      intake: intake({
        actual: { id: 'm1', length_value: 200, width_value: 100, height_value: 190, dimension_unit: 'cm', weight_value: null, weight_unit: null, package_count: null, volume_cbm: 3.8, measured_at: '2026-09-10T10:00:00Z', method: 'manual' },
        discrepancy: {
          status: 'DIFFERS',
          volume: { estimated_cbm: 3, actual_cbm: 3.8, difference_cbm: 0.8, direction: 'LARGER' },
          weight: null, commercial_effect: 'none',
          note: 'A difference between the estimate and the measurement is a record of what was found. It does not by itself change the price, the booking or the space reserved.',
        },
      }),
    })
    await open()
    expect(screen.getByTestId('cargo-estimate')).toHaveTextContent('3.000 CBM')
    expect(screen.getByTestId('cargo-actual')).toHaveTextContent('3.800 CBM')
    expect(screen.getByTestId('cargo-discrepancy-detail')).toHaveTextContent('+0.800 CBM')
  })

  it('says out loud that a difference does not change the price', async () => {
    state.view = view({
      intake: intake({
        actual: { id: 'm1', length_value: 200, width_value: 100, height_value: 190, dimension_unit: 'cm', weight_value: null, weight_unit: null, package_count: null, volume_cbm: 3.8, measured_at: '2026-09-10T10:00:00Z', method: 'manual' },
        discrepancy: {
          status: 'DIFFERS', volume: { estimated_cbm: 3, actual_cbm: 3.8, difference_cbm: 0.8, direction: 'LARGER' },
          weight: null, commercial_effect: 'none',
          note: 'A difference between the estimate and the measurement is a record of what was found. It does not by itself change the price, the booking or the space reserved.',
        },
      }),
    })
    await open()
    // Without this sentence a customer told their 3.0 booking measured 3.8 assumes a bill is coming.
    expect(screen.getByTestId('cargo-discrepancy-note')).toHaveTextContent('does not by itself change the price')
    expect(screen.getByTestId('my-cargo').textContent).not.toMatch(/\$|USD|surcharge|additional charge/i)
  })

  it('marks a partial estimate as a floor', async () => {
    state.view = view({
      estimate: estimate({ completeness: 'PARTIAL', items_total: 5, items_with_volume: 3 }),
      intake: intake({ estimate: estimate({ completeness: 'PARTIAL', items_total: 5, items_with_volume: 3 }) }),
    })
    await open()
    expect(screen.getByTestId('cargo-estimate')).toHaveTextContent('At least 3.000 CBM')
    expect(screen.getByTestId('cargo-estimate-caveat')).toHaveTextContent('2 of 5')
  })

  it('says how many times it was measured when there is more than one observation', async () => {
    state.view = view({ intake: intake({ earlier_measurements: 1, actual: { id: 'm2', length_value: 200, width_value: 100, height_value: 190, dimension_unit: 'cm', weight_value: null, weight_unit: null, package_count: null, volume_cbm: 3.8, measured_at: '2026-09-10T11:00:00Z', method: 'manual' } }) })
    await open()
    expect(screen.getByTestId('cargo-earlier-measurements')).toHaveTextContent('measured this 2 times')
  })
})

describe('condition', () => {
  it('presents a condition as one person\'s observation, not an assessment', async () => {
    state.view = view({ intake: intake({ status: 'CONDITIONALLY_RECEIVED', condition: 'minor_damage', outcome_reason: 'Corner of the crate was crushed' }) })
    await open()
    expect(screen.getByTestId('cargo-condition-label')).toHaveTextContent('Minor damage noted')
    expect(screen.getByTestId('cargo-condition')).toHaveTextContent('not an inspection, an insurance')
  })

  it('says nobody has looked yet rather than implying it is fine', async () => {
    state.view = view({ intake: intake({ status: 'EXPECTED', condition: null, received_at: null }) })
    await open()
    expect(screen.getByTestId('cargo-condition')).toHaveTextContent('Nobody has looked at this cargo yet')
  })

  it('links evidence to the ONE governed documents workspace', async () => {
    await open()
    expect(screen.getByTestId('cargo-evidence-link')).toHaveAttribute('href', '/diaspora/documents/warehouse_intake/in-1')
  })
})

describe('the T10/T11 firewall', () => {
  it('never says loaded, shipped, departed or ready to load', async () => {
    state.view = view({
      intake: intake({
        actual: { id: 'm1', length_value: 200, width_value: 100, height_value: 190, dimension_unit: 'cm', weight_value: 900, weight_unit: 'kg', package_count: 4, volume_cbm: 3.8, measured_at: '2026-09-10T10:00:00Z', method: 'manual' },
        storage_location: 'Bay 4',
      }),
    })
    await open()
    const text = screen.getByTestId('my-cargo').textContent?.toLowerCase() || ''
    for (const later of ['ready to load', 'loaded', 'shipped', 'departed', 'in transit', 'customs', 'delivered']) {
      expect(text).not.toContain(later)
    }
  })

  it('says explicitly that what happens next is decided elsewhere', async () => {
    await open()
    expect(screen.getByTestId('cargo-disclaimer')).toHaveTextContent('decided separately and is not shown here')
  })
})
