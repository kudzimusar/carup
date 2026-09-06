/**
 * T6.8 — the allocation panel refuses to choose how somebody else's money is divided.
 *
 * The engine already refused a write without a stated basis. The risk on the screen is subtler: a
 * select that defaults to the first option makes the operator's choice for them and looks like
 * their decision afterwards. So the control starts on "not chosen", and the panel says why nothing
 * can be split when no booking is approved instead of offering a control that will fail.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { SharedChargeAllocationPanel } from './SharedChargeAllocation'
import type { SharedChargeSet } from './SharedChargeAllocation'

const charge = (over: Partial<SharedChargeSet['charges'][number]> = {}) => ({
  id: 'comp-1', cost_stage: 'ORIGIN_TERMINAL', stage_label: 'Origin port / terminal',
  label: 'Terminal handling', original: { amount: 900, currency: 'USD' },
  allocation: { allocated: false, note: 'Not allocated yet.', allocations: [] },
  ...over,
})

const mount = (data: SharedChargeSet, allocate = vi.fn(async () => ({}))) => {
  const read = vi.fn(async () => data)
  render(<SharedChargeAllocationPanel containerId="sail-1" read={read} allocate={allocate} />)
  return { read, allocate }
}

describe('shared charge allocation', () => {
  it('offers no default basis — the operator must state one', async () => {
    mount({ charges: [charge()], approved_reservations: 2, note: 'Only APPROVED reservations are charged.' })
    await waitFor(() => expect(screen.getByTestId('shared-charge-row')).toBeInTheDocument())
    const select = screen.getByTestId('shared-charge-basis-comp-1') as HTMLSelectElement
    expect(select.value).toBe('')
    expect(select.options[0].textContent).toBe('How should this be divided?')
  })

  it('refuses to send an allocation with no basis chosen, and says why', async () => {
    const { allocate } = mount({ charges: [charge()], approved_reservations: 2, note: 'n' })
    await waitFor(() => expect(screen.getByTestId('shared-charge-row')).toBeInTheDocument())
    screen.getByTestId('shared-charge-allocate-comp-1').click()
    await waitFor(() => expect(screen.getByTestId('shared-charges-error')).toBeInTheDocument())
    expect(screen.getByTestId('shared-charges-error').textContent).toContain('does not choose for you')
    expect(allocate).not.toHaveBeenCalled()
  })

  it('says why nothing can be split when no booking is approved, and offers no control', async () => {
    mount({ charges: [charge()], approved_reservations: 0,
            note: 'No APPROVED reservation on this sailing yet, so nothing can be split.' })
    await waitFor(() => expect(screen.getByTestId('shared-charge-nothing-to-split')).toBeInTheDocument())
    expect(screen.queryByTestId('shared-charge-basis-comp-1')).toBeNull()
    expect(screen.getByTestId('shared-charges-note').textContent).toContain('nothing can be split')
  })

  it('shows an existing split per booking rather than offering to redo it', async () => {
    mount({
      charges: [charge({ allocation: { allocated: true, allocations: [
        { reservation_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', allocated_amount: 600, currency: 'USD' },
        { reservation_id: 'ffffffff-1111-2222-3333-444444444444', allocated_amount: 300, currency: 'USD' },
      ] } })],
      approved_reservations: 2, note: 'n',
    })
    await waitFor(() => expect(screen.getByTestId('shared-charge-allocated')).toBeInTheDocument())
    expect(screen.getAllByTestId('shared-charge-allocation-line')).toHaveLength(2)
    expect(screen.queryByTestId('shared-charge-basis-comp-1')).toBeNull()
  })

  it('an unreadable list is not reported as an empty one', async () => {
    const read = vi.fn(async () => { throw new Error('network') })
    render(<SharedChargeAllocationPanel containerId="sail-1" read={read} allocate={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId('shared-charges-unreadable')).toBeInTheDocument())
    expect(screen.getByTestId('shared-charges-unreadable').textContent).toContain('not a report that there are none')
    expect(screen.queryByTestId('shared-charges-empty')).toBeNull()
  })

  it('never presents an allocation as an invoice or a payment', async () => {
    mount({ charges: [charge()], approved_reservations: 1, note: 'n' })
    await waitFor(() => expect(screen.getByTestId('shared-charge-allocation')).toBeInTheDocument())
    expect(screen.getByTestId('shared-charge-allocation').textContent)
      .toContain('not an invoice, a payment or a settlement')
  })
})
