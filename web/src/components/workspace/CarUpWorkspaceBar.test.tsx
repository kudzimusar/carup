import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { canRoleAccessRoute } from '@/config/featureRegistry'
import type { UserRole } from '@shared/types'

let authUser: { id?: string; name?: string; role?: string } | null = { id: 'u1', name: 'Kingston Musarurwa', role: 'owner' }

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: authUser, isAuthenticated: Boolean(authUser) }),
}))

const { CarUpWorkspaceBar } = await import('./CarUpWorkspaceBar')
const { WorkspaceBarProvidedContext } = await import('./workspaceBarContext')

const renderBar = (props: Parameters<typeof CarUpWorkspaceBar>[0] = {}) =>
  render(<MemoryRouter><CarUpWorkspaceBar {...props} /></MemoryRouter>)

describe('CarUpWorkspaceBar', () => {
  beforeEach(() => {
    authUser = { id: 'u1', name: 'Kingston Musarurwa', role: 'owner' }
  })

  it('shows the three workspaces as one navigation landmark, in order, each a real link to its root', () => {
    renderBar({ active: 'vehicles' })
    const nav = screen.getByRole('navigation', { name: 'CarUp workspaces' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['My Vehicles', 'Marketplace', 'Trade & Imports'])
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/dashboard/garage', '/dashboard/listings', '/diaspora/imports'])
  })

  it('marks exactly the active workspace as the current page, and nothing else', () => {
    renderBar({ active: 'trade' })
    const current = screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('Trade & Imports')
    expect(screen.getByTestId('workspace-bar')).toHaveAttribute('data-active-workspace', 'trade')
  })

  it('marks no workspace current on a page that belongs to none (the shared inbox)', () => {
    renderBar({ active: null })
    expect(screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current'))).toHaveLength(0)
    expect(screen.getByTestId('workspace-bar')).toHaveAttribute('data-active-workspace', '')
  })

  it('shows the signed-in account once — it is one account across all three workspaces', () => {
    renderBar({ active: 'marketplace' })
    expect(screen.getByTestId('workspace-account')).toHaveTextContent('Kingston Musarurwa')
  })

  it('leaves the account line out when the shell already prints identity, or when there is no name', () => {
    renderBar({ active: 'trade', showAccount: false })
    expect(screen.queryByTestId('workspace-account')).toBeNull()
  })

  it('does not break when the session has no name or no user yet', () => {
    authUser = { id: 'u1', role: 'owner' }
    const { unmount } = renderBar({ active: 'vehicles' })
    expect(screen.queryByTestId('workspace-account')).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(3)
    unmount()
    authUser = null
    renderBar({ active: 'vehicles' })
    expect(screen.getByTestId('workspace-bar')).toBeInTheDocument()
  })

  it('offers only the workspaces the role can open, but never hides the one the page is already in', () => {
    // The role is chosen from the registry, so this test cannot pass vacuously.
    const roles: UserRole[] = ['dealer', 'mechanic', 'bank', 'insurance', 'government', 'admin']
    const restricted = roles.find((role) => !canRoleAccessRoute(role, '/dashboard/listings'))
    expect(restricted, 'expected at least one role without Marketplace access').toBeDefined()
    authUser = { id: 'u2', name: 'Someone Else', role: restricted }

    renderBar({ active: null })
    expect(screen.queryByRole('link', { name: 'Marketplace' })).toBeNull()

    // On a page IN that workspace, it stays visible as the current page — as text, not a dead link.
    renderBar({ active: 'marketplace' })
    const current = screen.getAllByText('Marketplace').find((node) => node.getAttribute('aria-current') === 'page')
    expect(current).toBeDefined()
    expect(current?.tagName).toBe('SPAN')
  })

  it('declines to draw a second bar inside a shell that already drew one', () => {
    render(
      <MemoryRouter>
        <WorkspaceBarProvidedContext.Provider value={true}>
          <CarUpWorkspaceBar active="trade" />
        </WorkspaceBarProvidedContext.Provider>
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('workspace-bar')).toBeNull()
  })

  it('keeps all three names on screen at phone width: an equal three-column grid, no sideways scroll', () => {
    renderBar({ active: 'vehicles' })
    const list = screen.getByTestId('workspace-bar').querySelector('ul')
    expect(list?.className).toContain('grid-cols-3')
    expect(list?.className).not.toMatch(/overflow-x/)
    for (const link of screen.getAllByRole('link')) expect(link.className).toContain('min-h-11')
  })

  it('has a dark tone for the Trade shell header without changing behaviour', () => {
    renderBar({ active: 'trade', tone: 'dark' })
    expect(screen.getByTestId('workspace-bar').className).toContain('border-slate-800')
    expect(screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')).toHaveLength(1)
  })
})
