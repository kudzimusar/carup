/**
 * GMO-6/7 (OC-5E) — a garage's own people, on the web.
 *
 * The team page renders the server's answers (who is removable, where each invitation stands); the
 * invitation link is shown exactly once; an outage is never shown as "nobody". `/garage/team` is the
 * SELECTED garage's admin's surface — a tenant scope, not a platform role. And every call reaches the
 * route the server mounts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, renderHook } from '@testing-library/react'
import { evaluateRouteAccess } from '@/lib/routeAccess'
import { getFeatureByRoute } from '@/config/featureRegistry'
import type { AuthUser } from '@shared/types'

const listGarageInvitations = vi.fn()
const createGarageInvitation = vi.fn()
const revokeGarageInvitation = vi.fn()
const listGarageMembers = vi.fn()
const removeGarageMember = vi.fn()
const changeGarageMemberRole = vi.fn()

vi.mock('@/hooks/useCarUpApi', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useCarUpApi')>('@/hooks/useCarUpApi')
  return {
    ...actual,
    useCarUpApi: () => ({
      listGarageInvitations, createGarageInvitation, revokeGarageInvitation,
      listGarageMembers, removeGarageMember, changeGarageMemberRole,
    }),
  }
})

const { default: GarageTeam } = await import('./GarageTeam')

const INVITATION = (status: string, id = `inv-${status}`) => ({
  id, invited_email: `${status}@example.invalid`, invited_name: null, role: 'mechanic',
  expires_at: '2026-10-12T00:00:00Z', status, created_at: '2026-10-05T00:00:00Z',
})
const MEMBERS = [
  { membershipId: 'm1', userId: 'founder', displayName: 'Tendai', email: 'founder@example.invalid', role: 'admin', joinedAt: 'x', removable: false },
  { membershipId: 'm2', userId: 'mech', displayName: null, email: 'mech@example.invalid', role: 'mechanic', joinedAt: 'x', removable: true },
]

beforeEach(() => {
  vi.clearAllMocks()
  listGarageInvitations.mockResolvedValue({ invitations: [INVITATION('pending'), INVITATION('expired'), INVITATION('accepted'), INVITATION('revoked')] })
  listGarageMembers.mockResolvedValue({ members: MEMBERS })
  createGarageInvitation.mockResolvedValue({ invitation: INVITATION('pending', 'inv-new'), token: 'tok/with spaces' })
  revokeGarageInvitation.mockResolvedValue({})
  removeGarageMember.mockResolvedValue({ removed: true })
  changeGarageMemberRole.mockResolvedValue({ changed: true })
})

describe('the team page renders what the server says', () => {
  it('the only administrator is not removable; others are; an unnamed member stays unnamed', async () => {
    render(<GarageTeam />)
    const items = await screen.findAllByTestId('member-item')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Tendai')
    expect(items[0].querySelector('[data-testid="not-removable"]')).not.toBeNull()
    expect(items[1]).toHaveTextContent('Unnamed member')
    expect(items[1].querySelector('[data-testid="remove-member"]')).not.toBeNull()
  })

  it('an outage is a loading problem, not an empty team', async () => {
    listGarageMembers.mockRejectedValue(new Error('network'))
    listGarageInvitations.mockRejectedValue(new Error('network'))
    render(<GarageTeam />)
    expect(await screen.findByTestId('members-error')).toHaveTextContent(/does not mean your team is empty/)
    expect(await screen.findByTestId('invitations-error')).toHaveTextContent(/does not mean you have invited nobody/)
    expect(screen.queryByTestId('members-empty')).toBeNull()
  })

  it('a pending OR expired invitation can be cancelled; a used or cancelled one cannot', async () => {
    render(<GarageTeam />)
    const items = await screen.findAllByTestId('invitation-item')
    const cancellable = items.map((li) => li.querySelector('[data-testid="revoke-invite"]') !== null)
    expect(cancellable).toEqual([true, true, false, false])
    fireEvent.click(items[1].querySelector('[data-testid="revoke-invite"]') as HTMLElement)
    await waitFor(() => expect(revokeGarageInvitation).toHaveBeenCalledWith('inv-expired'))
  })
})

describe('inviting', () => {
  it('the link is shown once, built for THIS site, carrying the token as a query value', async () => {
    render(<GarageTeam />)
    fireEvent.change(await screen.findByTestId('invite-email'), { target: { value: 'thabo@example.invalid' } })
    fireEvent.change(screen.getByTestId('invite-role'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByTestId('send-invite'))
    const link = await screen.findByTestId('invite-link')
    expect(link.textContent).toBe(`${window.location.origin}/join-garage?token=tok%2Fwith%20spaces`)
    expect(createGarageInvitation).toHaveBeenCalledWith({ email: 'thabo@example.invalid', name: undefined, role: 'admin' })
    expect(screen.getByTestId('issued-link')).toHaveTextContent(/CarUp has not sent them anything/)
  })

  it('a refusal is shown where the admin can read it', async () => {
    createGarageInvitation.mockRejectedValue(new Error('This person already has an invitation to this garage that was not used.'))
    render(<GarageTeam />)
    fireEvent.change(await screen.findByTestId('invite-email'), { target: { value: 'thabo@example.invalid' } })
    fireEvent.click(screen.getByTestId('send-invite'))
    expect(await screen.findByTestId('invite-error')).toHaveTextContent(/already has an invitation/)
    expect(screen.queryByTestId('issued-link')).toBeNull()
  })
})

describe('/garage/team is the selected garage\'s admin\'s', () => {
  const base = { isBootstrapping: false, isAuthenticated: true, effectiveStates: undefined }
  it('is tenant-scoped, with no platform role', () => {
    const feature = getFeatureByRoute('/garage/team')
    expect(feature?.roles).toEqual([])
    expect(feature?.tenantTypes).toEqual(['garage'])
    expect(feature?.tenantRoles).toEqual(['admin'])
  })
  it('opens for a garage admin, and for nobody else', () => {
    expect(evaluateRouteAccess({ ...base, route: '/garage/team', role: 'owner', activeTenant: { type: 'garage', role: 'admin' } }).kind).toBe('render')
    for (const activeTenant of [{ type: 'garage', role: 'mechanic' }, { type: 'dealership', role: 'admin' }, null]) {
      expect(evaluateRouteAccess({ ...base, route: '/garage/team', role: 'owner', activeTenant }).kind, JSON.stringify(activeTenant)).toBe('redirect')
    }
    expect(evaluateRouteAccess({ ...base, route: '/garage/team', role: 'admin', activeTenant: null }).kind, 'a platform admin is not a garage admin').toBe('redirect')
  })
})

// ── the wire ─────────────────────────────────────────────────────────────────────────────────────

let auth: { user: AuthUser | null; token: string | null }
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
const sent: Array<{ path: string; method: string; body?: string }> = []
vi.mock('@/lib/apiClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/apiClient')>('@/lib/apiClient')
  return {
    ...actual,
    apiRequest: vi.fn(async ({ path, options }: { path: string; options?: RequestInit }) => {
      sent.push({ path, method: String(options?.method || 'GET'), body: options?.body ? String(options.body) : undefined })
      return {}
    }),
  }
})

describe('the calls reach the routes the server mounts', () => {
  it('invitations, peek, accept and the team', async () => {
    auth = { user: { id: 'founder', name: 'F', email: 'f@example.invalid', role: 'owner' }, token: 'tok' }
    sent.length = 0
    const { useCarUpApi } = await vi.importActual<typeof import('@/hooks/useCarUpApi')>('@/hooks/useCarUpApi')
    const { result } = renderHook(() => useCarUpApi())
    await result.current.listGarageInvitations()
    await result.current.createGarageInvitation({ email: 'a@example.invalid', role: 'mechanic' })
    await result.current.revokeGarageInvitation('inv 1')
    await result.current.peekGarageInvitation('t/1')
    await result.current.acceptGarageInvitation('t/1')
    await result.current.listGarageMembers()
    await result.current.removeGarageMember('user 1')
    await result.current.changeGarageMemberRole('user 1', 'admin')
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual([
      'GET /garage/invitations',
      'POST /garage/invitations',
      'DELETE /garage/invitations/inv%201',
      'GET /garage/invitations/peek/t%2F1',
      'POST /garage/invitations/accept',
      'GET /garage/members',
      'DELETE /garage/members/user%201',
      'PATCH /garage/members/user%201/role',
    ])
    expect(JSON.parse(sent[4].body as string)).toEqual({ token: 't/1' })
    expect(JSON.parse(sent[7].body as string)).toEqual({ role: 'admin' })
  })
})
