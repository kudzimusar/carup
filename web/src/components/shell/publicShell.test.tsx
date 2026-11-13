/**
 * RX-02A S1-4B R3 — PublicShell role/feature truth + disclosure semantics (C4/C5).
 *
 * Fails against reviewed R2 HEAD (7454694a), passes on the corrected branch:
 *   C4  the session role is projected from the caller (never assumed 'owner');
 *       the workspace entry leads to the role's REAL dashboard; while the
 *       session bootstraps no role-gated surface is projected; the mobile
 *       bottom bar is manifest-derived and honors feature effective states.
 *   C5  the mega-menu is a standard labelled disclosure (no role=menu), with
 *       Escape closing and returning focus to its trigger.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { PublicShell } from './PublicShell'
import type { PublicIdentity } from './PublicShell'
import { FeatureGovernanceContext } from '@/context/featureGovernanceStore'
import { getDashboardRoute } from '@/config/featureRegistry'
import type { EffectiveFeatureState } from '@/config/featureRegistry'

const guest: PublicIdentity = { displayName: 'Visitor', isAuthenticated: false }

function renderShell(identity: PublicIdentity, states: Record<string, EffectiveFeatureState> = {}) {
  return render(
    <FeatureGovernanceContext.Provider value={states}>
      <MemoryRouter initialEntries={['/marketplace']}>
        <PublicShell identity={identity} currentPath="/marketplace">
          <div>page body</div>
        </PublicShell>
      </MemoryRouter>
    </FeatureGovernanceContext.Provider>,
  )
}

describe('C4 — role-aware navigation (never assumes owner)', () => {
  it('guest sees the public CTA, not a workspace entry', () => {
    renderShell(guest)
    expect(screen.queryByTestId('shell-workspace-entry')).toBeNull()
    expect(screen.getByRole('link', { name: 'Sell Your Car' })).toBeInTheDocument()
  })

  it('authenticated dealer is offered THEIR dashboard, not the owner dashboard', () => {
    renderShell({ displayName: 'Croco Motors', isAuthenticated: true, role: 'dealer' })
    const entry = screen.getByTestId('shell-workspace-entry')
    expect(entry).toHaveAttribute('href', getDashboardRoute('dealer'))
    expect(entry).not.toHaveAttribute('href', getDashboardRoute('owner'))
  })

  it('authenticated mechanic is offered the mechanic dashboard', () => {
    renderShell({ displayName: 'Simba', isAuthenticated: true, role: 'mechanic' })
    expect(screen.getByTestId('shell-workspace-entry')).toHaveAttribute(
      'href', getDashboardRoute('mechanic'),
    )
  })

  it('bootstrapping session shows an honest busy placeholder and projects no role-gated surface', () => {
    renderShell({ displayName: 'Tendai', isAuthenticated: true, role: 'owner', bootstrapping: true })
    expect(screen.queryByTestId('shell-workspace-entry')).toBeNull()
    expect(screen.getByLabelText('Account — checking your session')).toBeInTheDocument()
    expect(screen.getByLabelText('Account — checking your session')).toHaveAttribute('aria-busy', 'true')
  })
})

describe('C4 — manifest-derived mobile bottom bar', () => {
  it('bottom bar slots come from the authoritative mobile-primary manifest', () => {
    renderShell(guest)
    const nav = screen.getByTestId('shell-public-bottom-nav')
    const links = Array.from(nav.querySelectorAll<HTMLElement>('a[href]')).map(a => ({
      label: a.textContent?.trim() ?? '',
      href: a.getAttribute('href'),
    }))
    expect(links[0]).toMatchObject({ label: 'Home', href: '/' })
    // First three ACTIVE manifest items after Home (Buy/Sell/Verify by order).
    expect(links.slice(1, 4).map(l => l.label)).toEqual(['Buy', 'Sell', 'Verify'])
    expect(links[1]).toMatchObject({ href: '/marketplace' })
    expect(links[3]).toMatchObject({ href: '/search' })
    expect(links[4]).toMatchObject({ label: 'Account', href: '/login' })
  })

  it('guest Sell slot resolves to the manifest guest destination (register)', () => {
    renderShell(guest)
    const nav = screen.getByTestId('shell-public-bottom-nav')
    const sell = Array.from(nav.querySelectorAll<HTMLElement>('a[href]')).find(
      a => a.textContent?.trim() === 'Sell',
    )!
    expect(sell.getAttribute('href')).toBe('/register')
  })

  it('authenticated user Account slot leads to their real workspace', () => {
    renderShell({ displayName: 'Croco', isAuthenticated: true, role: 'dealer' })
    const nav = screen.getByTestId('shell-public-bottom-nav')
    const account = Array.from(nav.querySelectorAll<HTMLElement>('a[href]')).find(
      a => a.textContent?.trim() === 'Account',
    )!
    expect(account.getAttribute('href')).toBe(getDashboardRoute('dealer'))
  })

  it('a feature disabled by governance disappears from the bottom bar (never an active action)', () => {
    const disabled: EffectiveFeatureState = {
      featureId: 'product.marketplace', state: 'disabled',
      enabled: false, visible: true, accessible: false, beta: false,
    }
    renderShell(guest, { 'product.marketplace': disabled })
    const nav = screen.getByTestId('shell-public-bottom-nav')
    const labels = Array.from(nav.querySelectorAll('a[href]')).map(a => a.textContent?.trim())
    expect(labels).not.toContain('Buy')
  })
})

describe('C5 — mega-menu is a labelled disclosure, not an ARIA menu', () => {
  it('opening Buy shows a disclosure panel with NO role=menu semantics', async () => {
    const user = userEvent.setup()
    renderShell(guest)
    const trigger = screen.getByRole('button', { name: /Buy/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    // Keyboard-open (Enter) — the same control path a keyboard user takes.
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const controls = trigger.getAttribute('aria-controls')!
    expect(controls).toBeTruthy()
    // The preferred site-navigation semantics: NO ARIA menu/menuitem roles.
    expect(screen.queryByRole('menu')).toBeNull()
    const panel = document.getElementById(controls)!
    expect(panel).not.toBeNull()
    expect(panel.querySelectorAll('ul a[href]').length).toBeGreaterThan(0)
  })

  it('Escape closes the disclosure and returns focus to its trigger', async () => {
    const user = userEvent.setup()
    renderShell(guest)
    const trigger = screen.getByRole('button', { name: /Buy/ })
    trigger.focus()
    await user.keyboard('{Enter}')
    await user.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(trigger)
  })

  it('click outside closes the disclosure', async () => {
    const user = userEvent.setup()
    const { container } = renderShell(guest)
    const trigger = screen.getByRole('button', { name: /Buy/ })
    trigger.focus()
    await user.keyboard('{Enter}')
    await user.click(container.querySelector('[data-testid="shell-public-header"]')!)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})
