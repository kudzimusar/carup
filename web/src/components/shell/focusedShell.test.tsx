/**
 * RX-02A S1-4B R3 — FocusedShell skip-link keyboard contract (C5 reconciliation).
 *
 * Fails against reviewed R2 HEAD (7454694a), passes on the corrected branch:
 * the shell no longer steals focus into <main> on mount, so the FIRST Tab from
 * page load lands on the skip link exactly as claimed in the R2 Owner packet
 * ("Tab → skip link"). The R2 capture harness observed first-focusable=INPUT
 * (live Tab order after the mount focus transfer) while the static DOM probe
 * saw the skip link first — the two measurements encoded conflicting
 * contracts; removing the focus transfer makes both agree.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { FocusedShell } from './FocusedShell'

function renderShell(onExit = () => {}) {
  return render(
    <MemoryRouter>
      <FocusedShell
        identity={{ displayName: 'Visitor', roleTitle: 'Visitor' }}
        title="Sign in to CarUp"
        onExit={onExit}
      >
        <form data-testid="task-form">
          <input aria-label="Email" />
        </form>
      </FocusedShell>
    </MemoryRouter>,
  )
}

describe('C5 — skip link is the first keyboard stop', () => {
  it('the shell does not steal focus on mount (focus stays on the document root)', () => {
    renderShell()
    // Old behavior focused <main tabindex="-1"> on mount; corrected behavior
    // leaves focus alone so the tab order starts at the skip link.
    expect(document.activeElement).toBe(document.body)
  })

  it('the first Tab from load lands on the skip link', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.tab()
    const skip = screen.getByRole('link', { name: 'Skip to content' })
    expect(document.activeElement).toBe(skip)
  })

  it('the skip link targets the focused main region', () => {
    renderShell()
    const skip = screen.getByRole('link', { name: 'Skip to content' })
    expect(skip).toHaveAttribute('href', '#shell-focused-main')
    const main = document.getElementById('shell-focused-main')
    expect(main).not.toBeNull()
    expect(main).toHaveAttribute('tabindex', '-1')
  })

  it('continued tabbing reaches the task form (natural order, no trap)', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.tab() // skip link
    await user.tab() // exit button (header)
    expect(document.activeElement).toBe(screen.getByTestId('shell-focused-exit'))
    await user.tab() // into the task content
    expect(document.activeElement).toBe(screen.getByLabelText('Email'))
  })
})

describe('FocusedShell — bounded Escape behavior preserved', () => {
  it('Escape does NOT exit while focus is in a form control', async () => {
    const user = userEvent.setup()
    const onExit = vi.fn()
    renderShell(onExit)
    screen.getByLabelText('Email').focus()
    await user.keyboard('{Escape}')
    expect(onExit).not.toHaveBeenCalled()
    expect(screen.getByTestId('shell-focused-exit')).toBeInTheDocument()
  })

  it('Escape exits when focus is on chrome, not in a form control', async () => {
    const user = userEvent.setup()
    const onExit = vi.fn()
    renderShell(onExit)
    screen.getByTestId('shell-focused-exit').focus()
    await user.keyboard('{Escape}')
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})
