/** RX05-C — shared Dealer OS primitives: tone mapping never defaults to green; empty/error states are truthful. */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StatusChip } from './StatusChip'
import { toneFor } from './statusTone'
import { EmptyState, WorkspaceNotice } from './EmptyState'
import { DealerObjectHeader } from './DealerObjectHeader'
import { humanizeCode } from './format'

describe('toneFor', () => {
  const map = { APPROVED: 'success', PENDING: 'warning' } as const
  it('maps only the statuses the caller names; unknown, missing and pending are never success', () => {
    expect(toneFor('APPROVED', map)).toBe('success')
    expect(toneFor('PENDING', map)).toBe('warning')
    expect(toneFor('SOMETHING_NEW', map)).toBe('neutral')
    expect(toneFor(null, map)).toBe('neutral')
    expect(toneFor('toString', map)).toBe('neutral') // prototype keys are not statuses
    expect(toneFor('x', map, 'warning')).toBe('warning')
  })
})

describe('StatusChip', () => {
  it('exposes its tone for audit and defaults to neutral', () => {
    render(<><StatusChip testId="a">Recorded</StatusChip><StatusChip testId="b" tone="warning">Awaiting review</StatusChip></>)
    expect(screen.getByTestId('a')).toHaveAttribute('data-tone', 'neutral')
    expect(screen.getByTestId('b')).toHaveAttribute('data-tone', 'warning')
  })
})

describe('EmptyState / WorkspaceNotice', () => {
  it('an error state is an alert with a retry; an empty state is not an alert', () => {
    const retry = vi.fn()
    render(<>
      <EmptyState kind="error" title="Could not load" onRetry={retry} testId="err">Outage is not absence.</EmptyState>
      <EmptyState title="Nothing yet" testId="empty">What creates one.</EmptyState>
    </>)
    expect(screen.getByTestId('err')).toHaveAttribute('role', 'alert')
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('empty')).not.toHaveAttribute('role')
  })
  it('a receipt notice is a polite status; a problem is an alert', () => {
    render(<><WorkspaceNotice testId="ok">Saved privately.</WorkspaceNotice><WorkspaceNotice testId="bad" tone="danger">Refused.</WorkspaceNotice></>)
    expect(screen.getByTestId('ok')).toHaveAttribute('role', 'status')
    expect(screen.getByTestId('bad')).toHaveAttribute('role', 'alert')
  })
})

describe('DealerObjectHeader', () => {
  it('renders the single page h1 with eyebrow, description, meta and actions', () => {
    render(<DealerObjectHeader eyebrow="Dealer OS · Test" title="Inventory" description="Desc" meta={<span>meta</span>} actions={<button type="button">Act</button>} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Inventory' })).toBeInTheDocument()
    expect(screen.getByText('Dealer OS · Test')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument()
  })
})

describe('humanizeCode', () => {
  it('re-cases recorded codes without changing them', () => {
    expect(humanizeCode('OWNER_APPROVED_DEALER_PRODUCT_TARIFF')).toBe('Owner approved dealer product tariff')
    expect(humanizeCode('PAY03B_CANONICAL_ENTITLEMENT')).toBe('PAY03B canonical entitlement')
    expect(humanizeCode('DEALER_PAYS_CARUP')).toBe('Dealer pays CarUp')
    expect(humanizeCode(null)).toBe('Not recorded')
  })
})
