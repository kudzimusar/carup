/**
 * RX06-LR07 — PROPOSAL tests for the shared legacy chrome (DashboardLayout), unified presentation only.
 * Owner authorization required before this is applied (shared chrome outside S1).
 *
 * On a phone the drawer must behave like the unified WorkspaceShell drawer: closed, it is out of the tab order and
 * hidden from assistive technology; open, it is a named modal dialog that takes focus, keeps Tab inside, closes on
 * Escape and returns focus to the menu button. The icon-only header links get names; the nav gets a name; a skip
 * link reaches the content. With the flag OFF none of this is present (legacy markup unchanged). Role-specific
 * navigation items are not changed. Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const fx = vi.hoisted(() => ({ unified: true, desktop: false }))
vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => fx.unified }))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'fx-mechanic', name: 'Fictional Mechanic', role: 'mechanic' }, token: 'tok', isAuthenticated: true, loading: false,
    login: () => {}, logout: () => {}, switchRole: async () => {} }),
}))
vi.mock('@/context/featureGovernanceStore', async importOriginal => ({ ...(await importOriginal<object>()), useFeatureEffectiveStates: () => ({}) }))
vi.mock('@/components/owner/OwnerNotificationBell', () => ({ OwnerNotificationBell: () => null }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  fx.unified = true; fx.desktop = false
  window.matchMedia = ((query: string) => ({ matches: fx.desktop && query.includes('min-width: 1024px'), media: query,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
})
afterEach(() => cleanup())
// Bounded below the 5 s test timeout (asyncUtilTimeout is 5 s), so a wrong state fails on its assertion, not a timeout.
const W = { timeout: 2500 }

async function mountChrome() {
  const { default: DashboardLayout } = await import('@/components/layout/DashboardLayout')
  render(
    <MemoryRouter initialEntries={['/mechanic']}>
      <Routes><Route element={<DashboardLayout role="mechanic" />}><Route path="/mechanic" element={<div>mechanic body</div>} /></Route></Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(document.body.textContent).toContain('mechanic body'), { timeout: 2500 })
  return { aside: document.querySelector('aside') as HTMLElement, menu: screen.getByRole('button', { name: 'Open sidebar menu', hidden: true }) }
}

describe('DashboardLayout chrome — unified phone drawer (proposal)', () => {
  it('closed on a phone: the drawer is inert and hidden from assistive technology', async () => {
    const { aside, menu } = await mountChrome()
    expect(aside).toHaveAttribute('inert')
    expect(aside).toHaveAttribute('aria-hidden', 'true')
    expect(menu).toHaveAttribute('aria-controls', 'dashboard-portal-menu')
    expect(menu).toHaveAttribute('aria-expanded', 'false')
  })

  it('open: a named modal dialog that takes focus', async () => {
    const { aside, menu } = await mountChrome()
    fireEvent.click(menu)
    await waitFor(() => expect(aside).toHaveAttribute('role', 'dialog'), W)
    expect(aside).toHaveAttribute('aria-modal', 'true')
    expect(aside).toHaveAttribute('aria-label', 'Portal menu')
    expect(aside).not.toHaveAttribute('inert')
    await waitFor(() => expect(aside.contains(document.activeElement)).toBe(true), W)
  })

  it('Tab from the last item wraps to the first; Shift+Tab from the first wraps to the last', async () => {
    const { aside, menu } = await mountChrome()
    fireEvent.click(menu)
    await waitFor(() => expect(aside.contains(document.activeElement)).toBe(true), W)
    const items = [...aside.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    items[items.length - 1].focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(items[items.length - 1])
  })

  it('Escape closes the drawer and returns focus to the menu button', async () => {
    const { aside, menu } = await mountChrome()
    fireEvent.click(menu)
    await waitFor(() => expect(aside).toHaveAttribute('role', 'dialog'), W)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(aside).toHaveAttribute('inert'), W)
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(menu)
  })

  it('on a desktop the sidebar is never inert or modal', async () => {
    fx.desktop = true
    const { aside } = await mountChrome()
    expect(aside).not.toHaveAttribute('inert')
    expect(aside).not.toHaveAttribute('role')
  })

  it('the icon-only header links have names; the nav has a name; a skip link reaches the content', async () => {
    await mountChrome()
    expect(screen.getByRole('link', { name: 'Dashboard home', hidden: true })).toHaveAttribute('href', '/dashboard')
    expect(screen.getByRole('link', { name: 'Back to site', hidden: true })).toHaveAttribute('href', '/')
    expect(document.querySelector('nav')).toHaveAttribute('aria-label', 'Portal navigation')
    expect(screen.getByTestId('dashboard-skip-link')).toHaveAttribute('href', '#dashboard-main')
    expect(document.querySelector('main')).toHaveAttribute('id', 'dashboard-main')
  })

  it('role-specific navigation is unchanged: the same items, in the same order, with and without the proposal', async () => {
    await mountChrome()
    const unifiedItems = [...document.querySelectorAll('nav a')].map(a => a.getAttribute('href'))
    cleanup()
    fx.unified = false
    await mountChrome()
    const legacyItems = [...document.querySelectorAll('nav a')].map(a => a.getAttribute('href'))
    expect(unifiedItems).toEqual(legacyItems)
  })

  it('flags OFF: none of the proposal is present (legacy chrome unchanged)', async () => {
    fx.unified = false
    const { aside, menu } = await mountChrome()
    for (const attr of ['inert', 'aria-hidden', 'role', 'aria-modal', 'aria-label', 'id']) expect(aside).not.toHaveAttribute(attr)
    expect(menu).not.toHaveAttribute('aria-controls')
    expect(screen.queryByTestId('dashboard-skip-link')).toBeNull()
    expect(document.querySelector('nav')).not.toHaveAttribute('aria-label')
    expect(document.querySelector('main')).not.toHaveAttribute('id')
    expect(document.body.innerHTML).toContain('text-gray-400 mt-1">Active portal')
  })
})
