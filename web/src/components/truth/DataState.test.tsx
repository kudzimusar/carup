import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DataState } from './DataState'
import { DATA_STATE_HEADLINES } from './dataStates'

describe('DataState — all six states', () => {
  it('loading renders neutral skeletons in a polite labelled live region', () => {
    render(<DataState state="loading" subject="Service history" />)
    const region = screen.getByTestId('data-state')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveAccessibleName(/Loading — Service history/)
    expect(region.querySelectorAll('[aria-hidden="true"]')).not.toHaveLength(0)
  })

  it('empty invites a next action and is not an alert', () => {
    const onClick = vi.fn()
    render(<DataState state="empty" subject="Saved vehicles" action={{ label: 'Browse marketplace', onClick }} />)
    expect(screen.getByTestId('data-state')).toHaveAttribute('data-state', 'empty')
    expect(screen.getByText('Nothing here yet — Saved vehicles')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Browse marketplace' })
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('error is announced with role="alert" and offers retry — a failed read is never empty', () => {
    const onClick = vi.fn()
    const { container } = render(<DataState state="error" subject="Valuation" action={{ label: 'Retry', onClick }} />)
    const alert = screen.getByTestId('data-state')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).not.toHaveAttribute('data-state', 'empty')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-state="empty"]')).toBeNull()
  })

  it('forbidden is explicit and honest — no fabricated data, no retry theatre', () => {
    render(<DataState state="forbidden" subject="Dealer ledger" />)
    expect(screen.getByText(/don’t have access/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('not-measured is labelled unknown and never renders as 0 — negative case', () => {
    render(<DataState state="not-measured" subject="Emissions rating" />)
    const el = screen.getByTestId('data-state')
    expect(el).toHaveTextContent('Not measured — Emissions rating')
    expect(el.textContent).not.toMatch(/\b0\b/)
  })

  it('unavailable is honest held-capability copy and does not render a dead control', () => {
    render(<DataState state="unavailable" subject="Trade-in valuation" action={{ label: 'Get estimate', onClick: vi.fn() }} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/not offered in this context/)).toBeInTheDocument()
  })

  it('action is keyboard operable (real button, focusable)', () => {
    const onClick = vi.fn()
    render(<DataState state="error" action={{ label: 'Retry', onClick }} />)
    const button = screen.getByRole('button', { name: 'Retry' })
    button.focus()
    expect(button).toHaveFocus()
    fireEvent.keyDown(button, { key: 'Enter' })
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('headline registry covers exactly the six contract states', () => {
    expect(Object.keys(DATA_STATE_HEADLINES).sort()).toEqual(
      ['empty', 'error', 'forbidden', 'loading', 'not-measured', 'unavailable'].sort()
    )
  })
})
