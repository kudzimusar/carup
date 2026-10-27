/**
 * R3 — the Trade shell names its workspace and offers a way out that is not the public Home logo.
 *
 * Before: the shell called itself "Trade OS" and the only exits were the Trade tabs and the CarUp logo
 * (which goes to the public site). A buyer reading the CAP could not reach their own Vehicle Passport
 * without the browser Back button. Now the shell draws the workspace bar (active: Trade & Imports),
 * and a page inside it that also asks for a bar does not get a second one.
 */
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { canRoleAccessRoute } from '@/config/featureRegistry'
import type { UserRole } from '@shared/types'

const fetchDiasporaTradeContext = vi.fn()
let authUser: { id: string; name: string; role: string } = { id: 'u1', name: 'Kingston Musarurwa', role: 'owner' }

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, loading: false, user: authUser }),
}))
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchDiasporaTradeContext }),
}))
vi.mock('@/components/routing/RegistryRouteBoundary', () => ({
  RegistryRouteBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/pages/diaspora/TradeShippingWorkspace', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const { default: TradeOSWorkspaceLayout } = await import('./TradeOSWorkspaceLayout')
const { CarUpWorkspaceBar } = await import('@/components/workspace/CarUpWorkspaceBar')
const { WorkspaceChrome } = await import('@/components/workspace/WorkspaceChrome')
const { ActiveWorkspaceContext } = await import('@/components/workspace/workspaceBarContext')

function PageThatReadsTheShellsWorkspace() {
  const { useContext } = React
  return <p data-testid="hosting-workspace">{useContext(ActiveWorkspaceContext) ?? 'none'}</p>
}

function PageThatAsksForItsOwnBar() {
  return (
    <div data-testid="page-body">
      <CarUpWorkspaceBar active="trade" />
      <WorkspaceChrome workspace="trade" breadcrumbs={[{ label: 'Trade & Imports', href: '/diaspora/imports' }, { label: 'Import Orders' }]} />
    </div>
  )
}

const renderShell = () =>
  render(
    <MemoryRouter initialEntries={['/diaspora/imports']}>
      <Routes>
        <Route element={<TradeOSWorkspaceLayout />}>
          <Route path="/diaspora/imports" element={<PageThatAsksForItsOwnBar />} />
          <Route path="/diaspora/messages" element={<PageThatReadsTheShellsWorkspace />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

describe('Trade shell — workspace identity', () => {
  beforeEach(() => {
    authUser = { id: 'u1', name: 'Kingston Musarurwa', role: 'owner' }
    fetchDiasporaTradeContext.mockReset()
    fetchDiasporaTradeContext.mockResolvedValue({ user: { name: 'Kingston Musarurwa' }, country_of_residence: 'Zimbabwe', organisation: null })
  })

  it('names the workspace "Trade & Imports" and no longer calls itself "Trade OS"', async () => {
    renderShell()
    await screen.findByTestId('tradeos-identity-participant')
    const bar = screen.getAllByTestId('workspace-bar')[0]
    expect(within(bar).getByText('Trade & Imports')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByText('Trade OS', { exact: true })).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Trade & Imports sections' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Trade OS' })).toBeNull()
  })

  it('offers My Vehicles and Marketplace as real exits, so the public Home logo is not the only way out', async () => {
    renderShell()
    await screen.findByTestId('tradeos-identity-participant')
    const bar = screen.getAllByTestId('workspace-bar')[0]
    expect(within(bar).getByRole('link', { name: 'My Vehicles' })).toHaveAttribute('href', '/dashboard/garage')
    expect(within(bar).getByRole('link', { name: 'Marketplace' })).toHaveAttribute('href', '/dashboard/listings')
    expect(screen.getByRole('link', { name: 'CarUp home' })).toHaveAttribute('href', '/')
  })

  it('draws exactly ONE workspace bar even when the page inside asks for its own', async () => {
    renderShell()
    await screen.findByTestId('tradeos-identity-participant')
    expect(screen.getByTestId('page-body')).toBeInTheDocument()
    expect(screen.getAllByTestId('workspace-bar')).toHaveLength(1)
    // …while the page's own trail is kept.
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
  })

  it('offers a role only the workspaces it may open, and keeps Trade & Imports as the current page', async () => {
    // A logistics provider is a `dealer`-role account: it has no Garage or Marketplace. The precondition is
    // asserted, so if the registry ever changes this test fails loudly instead of passing vacuously.
    const role: UserRole = 'dealer'
    expect(canRoleAccessRoute(role, '/dashboard/garage')).toBe(false)
    expect(canRoleAccessRoute(role, '/dashboard/listings')).toBe(false)
    authUser = { id: 'u2', name: 'Provider User', role }
    renderShell()
    await screen.findByTestId('tradeos-identity')
    const bar = screen.getAllByTestId('workspace-bar')[0]
    expect(within(bar).queryByRole('link', { name: 'My Vehicles' })).toBeNull()
    expect(within(bar).queryByRole('link', { name: 'Marketplace' })).toBeNull()
    // The current workspace is still named — as text, because this role cannot open its root.
    expect(within(bar).getByText('Trade & Imports')).toHaveAttribute('aria-current', 'page')
  })

  it('calls the import-order list "Import orders" in its section navigation, the same words as the page and its trail', async () => {
    renderShell()
    await screen.findByTestId('tradeos-identity-participant')
    const sections = screen.getByRole('navigation', { name: 'Trade & Imports sections' })
    expect(within(sections).getByRole('link', { name: 'Import orders' })).toHaveAttribute('href', '/diaspora/imports')
    expect(within(sections).queryByRole('link', { name: 'Orders' })).toBeNull()
  })

  it('tells the pages it hosts which workspace they are in (for the one inbox mounted in two shells)', async () => {
    render(
      <MemoryRouter initialEntries={['/diaspora/messages']}>
        <Routes>
          <Route element={<TradeOSWorkspaceLayout />}>
            <Route path="/diaspora/messages" element={<PageThatReadsTheShellsWorkspace />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('hosting-workspace')).toHaveTextContent('trade')
  })

  it('keeps the identity block and the business context honest when the context cannot be read', async () => {
    fetchDiasporaTradeContext.mockRejectedValue(new Error('down'))
    renderShell()
    const identity = await screen.findByTestId('tradeos-identity')
    expect(identity).toHaveTextContent('Business context could not be loaded')
    expect(identity).toHaveTextContent('Trade & Imports')
    expect(identity).not.toHaveTextContent('Trade OS')
  })
})
