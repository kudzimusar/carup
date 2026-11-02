/**
 * OC-5D — the person chooses the organisation; the client never does.
 *
 *   · a person with one membership is OFFERED it (one tap), never placed in it;
 *   · an organisation that is not active is never offered as a choice;
 *   · when the organisation the person was acting for is no longer available, they are told so and
 *     asked again — and that notice cannot be dismissed away;
 *   · every choice goes through selectActiveTenant (the server's verified selection), including
 *     "act for yourself".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AuthUser } from '@shared/types'

const selectActiveTenant = vi.fn()
const refreshSession = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()
let currentUser: AuthUser | null = null

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, selectActiveTenant, refreshSession }),
}))
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))

const { ActiveOrganisationPrompt, OrganisationBadge, OrganisationMenuSection } = await import('./OrganisationSwitcher')
const { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } = await import('@/components/ui/dropdown-menu')

const GARAGE = { id: 't-garage', name: 'Mbare Motors', type: 'garage', status: 'active', role: 'mechanic', selectable: true }
const DEALER = { id: 't-dealer', name: 'Avondale Dealers', type: 'dealership', status: 'active', role: 'dealer', selectable: true }
const CLOSED = { id: 't-closed', name: 'Closed Garage', type: 'garage', status: 'suspended', role: 'admin', selectable: false }

function person(overrides: Partial<AuthUser> = {}): AuthUser {
  return { id: 'u-1', name: 'Farai', email: 'f@example.invalid', role: 'owner', active_tenant_id: null, memberships: [], ...overrides }
}

/** Radix menus render their content only when open; open it the way a person does. */
function renderOpenMenu() {
  render(
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <OrganisationMenuSection />
      </DropdownMenuContent>
    </DropdownMenu>,
  )
}

beforeEach(() => {
  selectActiveTenant.mockReset().mockResolvedValue(undefined)
  refreshSession.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
  currentUser = null
  try { sessionStorage.clear() } catch { /* jsdom */ }
})

describe('ActiveOrganisationPrompt', () => {
  it('offers a SOLE membership as one tap — and selects nothing until it is tapped', async () => {
    currentUser = person({ memberships: [GARAGE] })
    render(<ActiveOrganisationPrompt />)
    expect(screen.getByTestId('organisation-prompt-message')).toHaveTextContent('You are acting for yourself.')
    expect(selectActiveTenant).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('organisation-prompt-select-t-garage'))
    await waitFor(() => expect(selectActiveTenant).toHaveBeenCalledWith('t-garage'))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('You are now acting for Mbare Motors.'))
  })

  it('never offers an organisation that is not active', () => {
    currentUser = person({ memberships: [GARAGE, CLOSED] })
    render(<ActiveOrganisationPrompt />)
    expect(screen.getByTestId('organisation-prompt-select-t-garage')).toBeInTheDocument()
    expect(screen.queryByTestId('organisation-prompt-select-t-closed')).toBeNull()
  })

  it('stays out of the way: nothing for a person with no organisations, or already acting for one', () => {
    currentUser = person({ memberships: [] })
    const { unmount } = render(<ActiveOrganisationPrompt />)
    expect(screen.queryByTestId('organisation-prompt')).toBeNull()
    unmount()
    currentUser = person({ memberships: [GARAGE], active_tenant_id: 't-garage', tenant_context: 'selected' })
    render(<ActiveOrganisationPrompt />)
    expect(screen.queryByTestId('organisation-prompt')).toBeNull()
  })

  it('a REVOKED selection is said plainly, re-offers the remaining choices, and cannot be dismissed', () => {
    currentUser = person({ memberships: [DEALER], tenant_context: 'revoked' })
    render(<ActiveOrganisationPrompt />)
    expect(screen.getByTestId('organisation-prompt-message')).toHaveTextContent('Your access to the organisation you were acting for has changed.')
    expect(screen.getByTestId('organisation-prompt-select-t-dealer')).toBeInTheDocument()
    expect(screen.queryByTestId('organisation-prompt-dismiss')).toBeNull()
  })

  it('a revoked selection with nothing left to choose still says so', () => {
    currentUser = person({ memberships: [CLOSED], tenant_context: 'revoked' })
    render(<ActiveOrganisationPrompt />)
    expect(screen.getByTestId('organisation-prompt-message')).toHaveTextContent('You have no other organisation to act for.')
  })

  it('the ordinary prompt can be dismissed for this tab', () => {
    currentUser = person({ memberships: [GARAGE] })
    render(<ActiveOrganisationPrompt />)
    fireEvent.click(screen.getByTestId('organisation-prompt-dismiss'))
    expect(screen.queryByTestId('organisation-prompt')).toBeNull()
  })

  it('a refused selection is reported, not swallowed', async () => {
    selectActiveTenant.mockRejectedValueOnce(new Error('This organisation is not active.'))
    currentUser = person({ memberships: [GARAGE] })
    render(<ActiveOrganisationPrompt />)
    fireEvent.click(screen.getByTestId('organisation-prompt-select-t-garage'))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not change organisation. This organisation is not active.'))
  })
})

describe('OrganisationMenuSection', () => {
  it('names who the person is acting for and offers the other ACTIVE organisations, plus "yourself"', async () => {
    currentUser = person({
      memberships: [GARAGE, DEALER, CLOSED],
      active_tenant_id: 't-garage',
      active_tenant: { id: 't-garage', name: 'Mbare Motors', type: 'garage', status: 'active', role: 'mechanic' },
      tenant_context: 'selected',
    })
    renderOpenMenu()
    expect(screen.getByTestId('organisation-current')).toHaveTextContent('Mbare Motors')
    expect(screen.queryByTestId('organisation-select-t-garage')).toBeNull()
    expect(screen.getByTestId('organisation-select-t-dealer')).toHaveTextContent('Act for Avondale Dealers (dealer)')
    expect(screen.getByTestId('organisation-unavailable-t-closed')).toHaveAttribute('data-disabled')
    fireEvent.click(screen.getByTestId('organisation-clear'))
    await waitFor(() => expect(selectActiveTenant).toHaveBeenCalledWith(null))
  })

  it('a person acting for themselves sees "Yourself" and no clear option', () => {
    currentUser = person({ memberships: [GARAGE] })
    renderOpenMenu()
    expect(screen.getByTestId('organisation-current')).toHaveTextContent('Yourself')
    expect(screen.queryByTestId('organisation-clear')).toBeNull()
  })

  it('memberships that could not be read are retried, never shown as "no organisations"', () => {
    currentUser = person({ memberships: [], memberships_unavailable: true })
    renderOpenMenu()
    fireEvent.click(screen.getByTestId('organisation-retry'))
    expect(refreshSession).toHaveBeenCalled()
  })

  it('renders nothing for a person with no organisations at all', () => {
    currentUser = person({ memberships: [] })
    renderOpenMenu()
    expect(screen.queryByTestId('organisation-menu')).toBeNull()
  })
})

describe('OrganisationBadge', () => {
  it('shows who the person is acting for; hidden without organisations', () => {
    currentUser = person({
      memberships: [GARAGE],
      active_tenant_id: 't-garage',
      active_tenant: { id: 't-garage', name: 'Mbare Motors', type: 'garage', status: 'active', role: 'mechanic' },
    })
    const { unmount } = render(<OrganisationBadge />)
    expect(screen.getByTestId('organisation-badge')).toHaveAccessibleName('Acting for Mbare Motors. Change organisation')
    unmount()
    currentUser = person({ memberships: [] })
    render(<OrganisationBadge />)
    expect(screen.queryByTestId('organisation-badge')).toBeNull()
  })
})
