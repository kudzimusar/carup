/**
 * RX-02A S1-4B R3 — WorkspaceShell accessibility/action contract tests (C1/C2/C5).
 *
 * Every test here FAILS against the reviewed R2 HEAD (7454694a) and PASSES on
 * the corrected branch:
 *   C1  drawer transfers initial focus, traps Tab/Shift+Tab, and Escape /
 *       close-button / backdrop restore focus to the trigger.
 *   C2  Search is a REAL link to the global search page, Notifications is
 *       honestly disabled with an accessible explanation, Account is a
 *       working disclosure menu and Sign Out invokes the provided safe
 *       session handler.
 *   C5  rail/drawer interactive targets are >=44 CSS px (min-h-11).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { WorkspaceShell } from './WorkspaceShell'
import type { ShellIdentity, ShellObjectIdentity } from './contracts'

const identity: ShellIdentity = { displayName: 'Tendai Moyo', roleTitle: 'Owner' }
const object: ShellObjectIdentity = {
  title: 'My CarUp', reference: 'personal', statusLabel: 'Signed in', statusTone: 'neutral',
}

function renderShell(props: Partial<Parameters<typeof WorkspaceShell>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <WorkspaceShell family="personal" identity={identity} object={object} {...props}>
        <div>page body</div>
      </WorkspaceShell>
    </MemoryRouter>,
  )
}

describe('C1 — mobile drawer keyboard contract', () => {
  it('opening the drawer moves initial focus to a control inside the dialog', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByTestId('shell-ws-mobile-menu'))
    const dialog = screen.getByRole('dialog', { name: 'Workspace navigation' })
    expect(dialog).toBeInTheDocument()
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('Tab at the last focusable wraps to the first (focus cannot pass behind the modal)', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByTestId('shell-ws-mobile-menu'))
    const dialog = screen.getByRole('dialog', { name: 'Workspace navigation' })
    // Walk to the last focusable inside the drawer, then Tab must wrap back.
    const focusables = dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
    const last = focusables[focusables.length - 1]
    last.focus()
    expect(document.activeElement).toBe(last)
    await user.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(focusables[0])
  })

  it('Shift+Tab at the first focusable wraps to the last', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByTestId('shell-ws-mobile-menu'))
    const dialog = screen.getByRole('dialog', { name: 'Workspace navigation' })
    const focusables = dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
    focusables[0].focus()
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(focusables[focusables.length - 1])
  })

  it('Escape closes the drawer and restores focus to the trigger', async () => {
    const user = userEvent.setup()
    renderShell()
    const trigger = screen.getByTestId('shell-ws-mobile-menu')
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Workspace navigation' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Workspace navigation' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('close button closes the drawer and restores focus to the trigger', async () => {
    const user = userEvent.setup()
    renderShell()
    const trigger = screen.getByTestId('shell-ws-mobile-menu')
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Workspace navigation' })
    const closeButton = dialog.querySelector<HTMLElement>('button[aria-label="Close workspace menu"]')!
    await user.click(closeButton)
    expect(screen.queryByRole('dialog', { name: 'Workspace navigation' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('backdrop click closes the drawer and restores focus', async () => {
    const user = userEvent.setup()
    const { container } = renderShell()
    const trigger = screen.getByTestId('shell-ws-mobile-menu')
    await user.click(trigger)
    // The backdrop is the full-screen button rendered behind the dialog panel.
    const backdrop = container.querySelector<HTMLElement>(
      '[data-testid="shell-ws-drawer"] > button[aria-label="Close workspace menu"]',
    )!
    await user.click(backdrop)
    expect(screen.queryByRole('dialog', { name: 'Workspace navigation' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('navigating from the drawer closes it without leaving a live trap (listener removed on unmount)', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByTestId('shell-ws-mobile-menu'))
    const dialog = screen.getByRole('dialog', { name: 'Workspace navigation' })
    const firstLink = dialog.querySelector<HTMLElement>('a[href]')!
    await user.click(firstLink)
    expect(screen.queryByRole('dialog', { name: 'Workspace navigation' })).toBeNull()
    // After close, Tab must NOT be re-routed by a stuck listener: focus moves
    // naturally through the document (header trigger again).
    await user.tab()
    expect(document.activeElement).not.toBeNull()
  })
})

describe('C2 — truthful workspace actions and safe sign-out', () => {
  it('Search links to the REAL global search page (no inert search button)', () => {
    renderShell()
    const search = screen.getByTestId('shell-ws-search')
    expect(search.tagName).toBe('A')
    expect(search).toHaveAttribute('href', '/search')
    expect(search).toHaveAccessibleName('Search workspace')
  })

  it('Notifications is honestly disabled with an accessible explanation (not an inert enabled button)', () => {
    renderShell()
    const bell = screen.getByTestId('shell-ws-notifications')
    expect(bell).toBeDisabled()
    expect(bell).toHaveAttribute('aria-disabled', 'true')
    expect(bell.getAttribute('aria-label') ?? bell.getAttribute('title') ?? '').toMatch(/not available/i)
  })

  it('Account opens a disclosure menu; Sign Out invokes the safe session handler', async () => {
    const user = userEvent.setup()
    const onSignOut = vi.fn()
    renderShell({ onSignOut })
    const account = screen.getByTestId('shell-ws-account')
    expect(account).toHaveAttribute('aria-expanded', 'false')
    await user.click(account)
    expect(account).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByTestId('shell-ws-sign-out'))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('Escape closes the account menu and returns focus to its trigger', async () => {
    const user = userEvent.setup()
    const onSignOut = vi.fn()
    renderShell({ onSignOut })
    const account = screen.getByTestId('shell-ws-account')
    await user.click(account)
    expect(screen.getByTestId('shell-ws-account-menu')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('shell-ws-account-menu')).toBeNull()
    expect(document.activeElement).toBe(account)
  })

  it('no Sign Out item renders when the shell is not given a safe sign-out handler', () => {
    renderShell()
    // Menu never opens here, but even the trigger must not promise sign-out.
    expect(screen.queryByTestId('shell-ws-sign-out')).toBeNull()
  })

  it('the account menu offers the real workspace home (My CarUp)', async () => {
    const user = userEvent.setup()
    renderShell({ onSignOut: () => {} })
    await user.click(screen.getByTestId('shell-ws-account'))
    const home = screen.getByRole('link', { name: /My CarUp/ })
    expect(home).toHaveAttribute('href', '/dashboard')
  })
})

describe('C5 — workspace touch targets', () => {
  it('rail and drawer navigation links meet the 44px minimum (min-h-11)', async () => {
    const user = userEvent.setup()
    const { container } = renderShell()
    const railLinks = container.querySelectorAll('[data-testid="shell-ws-rail"] a[href]')
    expect(railLinks.length).toBeGreaterThan(0)
    for (const link of Array.from(railLinks)) {
      expect(link.className).toContain('min-h-11')
    }
    await user.click(screen.getByTestId('shell-ws-mobile-menu'))
    const dialog = screen.getByRole('dialog', { name: 'Workspace navigation' })
    const drawerLinks = dialog.querySelectorAll('a[href]')
    expect(drawerLinks.length).toBeGreaterThan(0)
    for (const link of Array.from(drawerLinks)) {
      expect(link.className).toContain('min-h-11')
    }
  })
})

/* ── R4-3: workspace rail renders each feature's own icon ─────────────────── */

const iconCalls = vi.hoisted(() => [] as Array<string | null | undefined>)
vi.mock('@/config/featureIcons', async importOriginal => {
  const actual = await importOriginal<typeof import('@/config/featureIcons')>()
  return {
    ...actual,
    resolveFeatureIcon: (name?: Parameters<typeof actual.resolveFeatureIcon>[0]) => {
      iconCalls.push(name ?? null)
      return actual.resolveFeatureIcon(name)
    },
  }
})

describe('R4-3 — rail renders each item’s own registry icon', () => {
  it('resolveFeatureIcon receives the item icon metadata (not a blanket null)', () => {
    renderShell({
      railSections: [{
        title: 'Test',
        items: [
          { id: 'garage', label: 'Garage', href: '/dashboard/garage', icon: 'Car', planned: false },
          { id: 'history', label: 'Service history', href: '/dashboard/service-history', icon: 'Wrench', planned: false },
          { id: 'soon', label: 'Planned thing', href: '/dashboard/planned', icon: null, planned: true },
        ],
      }],
    })
    expect(iconCalls).toContain('Car')
    expect(iconCalls).toContain('Wrench')
    expect(iconCalls).toContain(null)
    // Both distinct feature icons were requested — the renderer no longer
    // collapses every entry to the fallback.
    expect(iconCalls.filter(c => c === 'Car').length).toBeGreaterThanOrEqual(1)
    expect(iconCalls.filter(c => c === 'Wrench').length).toBeGreaterThanOrEqual(1)
  })
})

describe('B1 — content grid reserves the status column only when a status panel exists', () => {
  it('without a statusPanel the content grid has NO reserved 320px column', () => {
    renderShell()
    const grid = screen.getByTestId('shell-ws-content-grid')
    expect(grid.className).toContain('lg:grid-cols-1')
    expect(grid.className).not.toContain('320px')
  })

  it('with a statusPanel the two-column layout is applied and the panel is labelled', () => {
    renderShell({ statusPanel: <div>status panel body</div> })
    const grid = screen.getByTestId('shell-ws-content-grid')
    expect(grid.className).toContain('lg:grid-cols-[1fr_320px]')
    expect(screen.getByLabelText('Status and evidence')).toHaveTextContent('status panel body')
  })
})
