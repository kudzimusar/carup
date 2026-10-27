/**
 * T11-CAP-LR01-R3 — the chrome every page of an import order shares.
 *
 * Its promises: the trail is complete; every link is one this role can open (a step it cannot is plain text);
 * the way up is the order for a page of the order and the list for the order itself; exits are dropped unless
 * the role can open them; and a page that carries its own labelled way back can suppress the chrome's.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const auth = vi.hoisted(() => ({ role: 'owner' as string | undefined }))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Kingston Musarurwa', ...(auth.role ? { role: auth.role } : {}) }, isAuthenticated: true }),
}))

import { TradeOrderChrome } from './TradeOrderChrome'
import { WorkspaceBarProvidedContext } from '@/components/workspace'

const ORDER = '3e2b66a0-1e8b-43c9-bd48-507f88016f71'
const show = (props: Partial<React.ComponentProps<typeof TradeOrderChrome>> = {}) =>
  render(
    <MemoryRouter>
      <TradeOrderChrome orderId={ORDER} orderLabel="2018 Honda Vezel" page="Trade documents" {...props} />
    </MemoryRouter>,
  )
const trail = () => screen.getByRole('navigation', { name: 'Breadcrumb' })
const hrefs = () => within(trail()).queryAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])

beforeEach(() => { auth.role = 'owner' })
afterEach(cleanup)

describe('a page of an import order', () => {
  it('shows the workspace, the full trail, and the way up to the order', () => {
    show()
    expect(screen.getByTestId('workspace-bar')).toHaveAttribute('data-active-workspace', 'trade')
    expect(hrefs()).toEqual([
      ['Trade & Imports', '/diaspora/imports'],
      ['Import Orders', '/diaspora/imports'],
      ['2018 Honda Vezel', `/diaspora/imports/${ORDER}`],
    ])
    expect(within(trail()).getByTestId('workspace-crumb-current')).toHaveTextContent('Trade documents')
    expect(screen.getByRole('link', { name: 'Back to import order' })).toHaveAttribute('href', `/diaspora/imports/${ORDER}`)
  })

  it('encodes the order id in every address it builds', () => {
    show({ orderId: 'a b/1' })
    expect(screen.getByRole('link', { name: 'Back to import order' })).toHaveAttribute('href', '/diaspora/imports/a%20b%2F1')
  })
})

describe('the order itself', () => {
  it('ends the trail on the order (not a link) and the way up is the list', () => {
    show({ page: null })
    expect(hrefs()).toEqual([['Trade & Imports', '/diaspora/imports'], ['Import Orders', '/diaspora/imports']])
    expect(within(trail()).getByTestId('workspace-crumb-current')).toHaveTextContent('2018 Honda Vezel')
    expect(screen.getByRole('link', { name: 'Back to import orders' })).toHaveAttribute('href', '/diaspora/imports')
    expect(screen.queryByRole('link', { name: 'Back to import order' })).toBeNull()
  })

  it('still names itself when the caller has nothing to call it', () => {
    show({ page: null, orderLabel: null })
    expect(within(trail()).getByTestId('workspace-crumb-current')).toHaveTextContent('Import order')
  })
})

describe('no order to go up to', () => {
  it('a page with no order leaves the order step out, and the way up is the list', () => {
    show({ orderId: null, orderLabel: null })
    expect(hrefs()).toEqual([['Trade & Imports', '/diaspora/imports'], ['Import Orders', '/diaspora/imports']])
    expect(screen.getByRole('link', { name: 'Back to import orders' })).toHaveAttribute('href', '/diaspora/imports')
  })

  it('a vehicle with no single order: the vehicle is a plain step and nothing links to a guessed order', () => {
    show({ orderId: null, orderLabel: '2018 Honda Vezel' })
    expect(within(trail()).getByText('2018 Honda Vezel').closest('a')).toBeNull()
    expect(hrefs().map(([, href]) => href)).toEqual(['/diaspora/imports', '/diaspora/imports'])
  })
})

describe('a role that cannot open the owner pages', () => {
  it('gets the whole trail as text, no way up it would be turned away from, and no exit it cannot open', () => {
    auth.role = 'dealer'
    show({ exits: [{ label: 'View Vehicle Passport', href: '/dashboard/garage/V1' }, { label: 'Journey & arrival', href: `/diaspora/journey/import_order/${ORDER}` }] })
    expect(hrefs()).toEqual([])
    for (const text of ['Trade & Imports', 'Import Orders', '2018 Honda Vezel']) expect(within(trail()).getByText(text)).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-parent-link')).toBeNull()
    // The dealer may open the journey, not the owner's Vehicle Passport.
    const exits = screen.getByRole('navigation', { name: 'Elsewhere for this order' })
    expect(within(exits).getAllByRole('link').map((a) => a.textContent)).toEqual(['Journey & arrival'])
  })

  it('a session with no role is read as an owner, the same default the workspace bar applies', () => {
    auth.role = undefined
    show()
    expect(screen.getByRole('link', { name: 'Back to import order' })).toBeInTheDocument()
  })
})

describe('exits', () => {
  it('are a labelled navigation of real links, and absent entirely when there are none', () => {
    show({ exits: [{ label: 'View Vehicle Passport', href: '/dashboard/garage/V1', testId: 'x' }], exitsLabel: 'Elsewhere for this vehicle' })
    const exits = screen.getByRole('navigation', { name: 'Elsewhere for this vehicle' })
    expect(within(exits).getByRole('link', { name: 'View Vehicle Passport' })).toHaveAttribute('href', '/dashboard/garage/V1')
    cleanup()
    show()
    expect(screen.queryByTestId('workspace-exit-actions')).toBeNull()
  })

  it('an exit the role cannot open is dropped, and when all are dropped the navigation is not drawn', () => {
    auth.role = 'dealer'
    show({ exits: [{ label: 'View Vehicle Passport', href: '/dashboard/garage/V1' }] })
    expect(screen.queryByTestId('workspace-exit-actions')).toBeNull()
  })
})

describe('hideParent', () => {
  it('suppresses the chrome’s own way up for a page that carries a labelled control of its own', () => {
    show({ hideParent: true })
    expect(screen.queryByTestId('workspace-parent-link')).toBeNull()
    expect(hrefs()).toHaveLength(3)
  })
})

describe('inside the Trade shell', () => {
  it('draws no second workspace bar but keeps the trail and the way up', () => {
    render(
      <MemoryRouter>
        <WorkspaceBarProvidedContext.Provider value={true}>
          <TradeOrderChrome orderId={ORDER} orderLabel="2018 Honda Vezel" page="Trade documents" />
        </WorkspaceBarProvidedContext.Provider>
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('workspace-bar')).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.getByTestId('workspace-parent-link')).toBeInTheDocument()
  })
})
