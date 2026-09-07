/**
 * GMO-5 — entering a garage you belong to.
 *
 * The founder's workspace exists the moment activation succeeds, but the browser only learned about
 * memberships at login. So the person who had just been approved could not open the garage they had
 * just been given. This surface closes that, and lets a person with several garages choose.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GarageContextSwitcher from './GarageContextSwitcher'

const fetchMyMemberships = vi.fn()
const switchRole = vi.fn()
const navigate = vi.fn()
let currentUser: Record<string, unknown> = { id: 'u1', role: 'owner', active_tenant_id: null }

vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ fetchMyMemberships }) }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: currentUser, switchRole }) }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const GARAGE = {
  tenantId: 't-1', tenantName: 'Mbare Motors', tenantType: 'garage',
  tenantStatus: 'active', role: 'admin', canOperate: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  currentUser = { id: 'u1', role: 'owner', active_tenant_id: null }
  switchRole.mockResolvedValue(undefined)
  fetchMyMemberships.mockResolvedValue({ garages: [GARAGE] })
})

const view = () => render(<MemoryRouter><GarageContextSwitcher /></MemoryRouter>)

describe('opening a garage', () => {
  it('lists a garage the person belongs to, with their role in it', async () => {
    view()
    expect(await screen.findByTestId('garage-item')).toHaveTextContent('Mbare Motors')
    expect(screen.getByTestId('garage-item')).toHaveTextContent(/Your role here: admin/i)
  })

  it('establishes the tenant context BEFORE navigating', async () => {
    view()
    fireEvent.click(await screen.findByTestId('enter-garage'))
    // A plain link to /garage lands on a 403: the context has to be switched first.
    await waitFor(() => expect(switchRole).toHaveBeenCalledWith('owner', 't-1'))
    expect(navigate).toHaveBeenCalledWith('/garage')
  })

  it('keeps the PLATFORM role and only changes the tenant', async () => {
    currentUser = { id: 'u1', role: 'owner', active_tenant_id: null }
    view()
    fireEvent.click(await screen.findByTestId('enter-garage'))
    await waitFor(() => expect(switchRole).toHaveBeenCalled())
    const [role] = switchRole.mock.calls[0]
    // A garage admin is not a CarUp admin. Switching must never request 'admin'.
    expect(role).toBe('owner')
    expect(role).not.toBe('admin')
  })

  it('does not navigate when the switch is refused', async () => {
    switchRole.mockRejectedValue(new Error('You do not belong to this organization.'))
    view()
    fireEvent.click(await screen.findByTestId('enter-garage'))
    expect(await screen.findByTestId('enter-garage-error'))
      .toHaveTextContent(/could not open Mbare Motors/i)
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('PO-6 — more than one garage', () => {
  const SECOND = { ...GARAGE, tenantId: 't-2', tenantName: 'Second Garage', role: 'mechanic' }

  it('offers every garage, not only the one login picked', async () => {
    fetchMyMemberships.mockResolvedValue({ garages: [GARAGE, SECOND] })
    view()
    await screen.findByTestId('garage-list')
    expect(screen.getAllByTestId('garage-item')).toHaveLength(2)
    expect(screen.getByTestId('garage-context-switcher')).toHaveTextContent(/more than one garage/i)
  })

  it('marks which one is currently open', async () => {
    currentUser = { id: 'u1', role: 'owner', active_tenant_id: 't-2' }
    fetchMyMemberships.mockResolvedValue({ garages: [GARAGE, SECOND] })
    view()
    await screen.findByTestId('garage-list')
    const items = screen.getAllByTestId('garage-item')
    expect(items[1]).toHaveTextContent(/currently open/i)
    expect(items[0]).not.toHaveTextContent(/currently open/i)
  })

  it('switching to the second garage sends that tenant, not the first', async () => {
    fetchMyMemberships.mockResolvedValue({ garages: [GARAGE, SECOND] })
    view()
    await screen.findByTestId('garage-list')
    fireEvent.click(screen.getAllByTestId('enter-garage')[1])
    await waitFor(() => expect(switchRole).toHaveBeenCalledWith('owner', 't-2'))
  })
})

describe('the states stay honest', () => {
  it('a failed read is a loading problem, not "you belong to no garage"', async () => {
    fetchMyMemberships.mockRejectedValue(new Error('network'))
    view()
    expect(await screen.findByTestId('garages-error'))
      .toHaveTextContent(/does not mean you belong to none/i)
    expect(screen.queryByTestId('garage-list')).toBeNull()
  })

  it('a person in no garage renders nothing at all', async () => {
    fetchMyMemberships.mockResolvedValue({ garages: [] })
    const { container } = view()
    await waitFor(() => expect(fetchMyMemberships).toHaveBeenCalled())
    // Not an error, not an empty-state scold — there is simply nothing to show them here.
    await waitFor(() => expect(container.querySelector('[data-testid="garage-context-switcher"]')).toBeNull())
    expect(screen.queryByTestId('garages-error')).toBeNull()
  })

  it('a member who cannot operate is told so, and offered no way in', async () => {
    fetchMyMemberships.mockResolvedValue({ garages: [{ ...GARAGE, role: 'member', canOperate: false }] })
    view()
    await screen.findByTestId('garage-item')
    // `canOperate` is the SERVER's answer; the browser does not decide who may work.
    expect(screen.getByTestId('cannot-operate')).toHaveTextContent(/cannot work in it yet/i)
    expect(screen.queryByTestId('enter-garage')).toBeNull()
    expect(screen.getByTestId('no-operable-garage')).toHaveTextContent(/can change your role/i)
  })

  it('an unrecorded role reads as unrecorded, never as a guess', async () => {
    fetchMyMemberships.mockResolvedValue({ garages: [{ ...GARAGE, role: null }] })
    view()
    expect(await screen.findByTestId('garage-item')).toHaveTextContent(/role here is not recorded/i)
  })
})
