/**
 * GMO-6 — the garage's own people.
 *
 * The link is shown exactly once and never again. That is not an inconvenience to design around —
 * it is what allows the token to be stored hashed, so a leaked database reveals who was invited but
 * never how to accept.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import GarageTeam from './GarageTeam'

const listGarageInvitations = vi.fn()
const createGarageInvitation = vi.fn()
const revokeGarageInvitation = vi.fn()
// GMO-7
const listGarageMembers = vi.fn()
const removeGarageMember = vi.fn()
const changeGarageMemberRole = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    listGarageInvitations, createGarageInvitation, revokeGarageInvitation,
    listGarageMembers, removeGarageMember, changeGarageMemberRole,
  }),
}))

const MEMBER = (over = {}) => ({
  membershipId: 'm1', userId: 'u_mech', displayName: 'Thabo', email: 't@example.com',
  role: 'mechanic', joinedAt: '2026-01-01', removable: true, ...over,
})

const INVITATION = (over = {}) => ({
  id: 'inv-1', invited_email: 'thabo@example.com', invited_name: 'Thabo', role: 'mechanic',
  expires_at: '2026-09-13T10:00:00Z', status: 'pending', created_at: '2026-09-06T10:00:00Z', ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  listGarageInvitations.mockResolvedValue({ invitations: [] })
  createGarageInvitation.mockResolvedValue({ invitation: INVITATION(), token: 'raw-token-abc' })
  listGarageMembers.mockResolvedValue({ members: [MEMBER()], adminCount: 2 })
  removeGarageMember.mockResolvedValue({ removed: true })
  changeGarageMemberRole.mockResolvedValue({ changed: true })
})

describe('inviting someone', () => {
  it('sends the address, name and role', async () => {
    render(<GarageTeam />)
    await screen.findByTestId('invite-form')
    fireEvent.change(screen.getByTestId('invite-email'), { target: { value: 'thabo@example.com' } })
    fireEvent.change(screen.getByTestId('invite-name'), { target: { value: 'Thabo' } })
    fireEvent.change(screen.getByTestId('invite-role'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByTestId('send-invite'))
    await waitFor(() => expect(createGarageInvitation).toHaveBeenCalledWith({
      email: 'thabo@example.com', name: 'Thabo', role: 'admin',
    }))
  })

  it('explains that the address is what makes the link safe', async () => {
    render(<GarageTeam />)
    expect(await screen.findByTestId('invite-form'))
      .toHaveTextContent(/what stops the link working for anyone else/i)
  })

  it('offers only garage roles', async () => {
    render(<GarageTeam />)
    const select = await screen.findByTestId('invite-role') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value).sort()).toEqual(['admin', 'mechanic'])
  })
})

describe('the link is shown once, and CarUp does not pretend to send it', () => {
  it('shows the link and says plainly that nothing was sent', async () => {
    render(<GarageTeam />)
    await screen.findByTestId('invite-form')
    fireEvent.change(screen.getByTestId('invite-email'), { target: { value: 'thabo@example.com' } })
    fireEvent.click(screen.getByTestId('send-invite'))

    const panel = await screen.findByTestId('issued-link')
    expect(screen.getByTestId('invite-link')).toHaveTextContent('raw-token-abc')
    expect(screen.getByTestId('invite-link')).toHaveTextContent('/join-garage?token=')
    // Implying CarUp sent a message nobody sent leaves a mechanic waiting for something that will
    // never arrive.
    expect(panel).toHaveTextContent(/CarUp has not sent them anything/i)
    expect(panel).toHaveTextContent(/will not be able to see this link again/i)
  })

  it('does not show a link when the server returned none', async () => {
    createGarageInvitation.mockResolvedValue({ invitation: INVITATION() })
    render(<GarageTeam />)
    await screen.findByTestId('invite-form')
    fireEvent.change(screen.getByTestId('invite-email'), { target: { value: 'thabo@example.com' } })
    fireEvent.click(screen.getByTestId('send-invite'))
    await waitFor(() => expect(createGarageInvitation).toHaveBeenCalled())
    expect(screen.queryByTestId('issued-link')).toBeNull()
  })

  it('a refused invitation is reported', async () => {
    createGarageInvitation.mockRejectedValue(new Error('This person already has an invitation to this garage that has not been used yet.'))
    render(<GarageTeam />)
    await screen.findByTestId('invite-form')
    fireEvent.change(screen.getByTestId('invite-email'), { target: { value: 'thabo@example.com' } })
    fireEvent.click(screen.getByTestId('send-invite'))
    expect(await screen.findByTestId('invite-error')).toHaveTextContent(/already has an invitation/i)
  })
})

describe('the list', () => {
  it('shows each invitation and where it stands', async () => {
    listGarageInvitations.mockResolvedValue({
      invitations: [
        INVITATION(),
        INVITATION({ id: 'inv-2', status: 'accepted', invited_email: 'joined@example.com' }),
        INVITATION({ id: 'inv-3', status: 'expired', invited_email: 'old@example.com' }),
      ],
    })
    render(<GarageTeam />)
    await screen.findByTestId('invitation-list')
    const statuses = screen.getAllByTestId('invitation-status').map((n) => n.textContent)
    expect(statuses).toEqual(['Waiting for them', 'Joined', 'Expired'])
  })

  it('offers cancel only for one still waiting', async () => {
    listGarageInvitations.mockResolvedValue({
      invitations: [INVITATION(), INVITATION({ id: 'inv-2', status: 'accepted' })],
    })
    render(<GarageTeam />)
    await screen.findByTestId('invitation-list')
    // Cancelling something already accepted would suggest membership can be undone here; it cannot.
    expect(screen.getAllByTestId('revoke-invite')).toHaveLength(1)
  })

  it('cancels the one that was clicked', async () => {
    listGarageInvitations.mockResolvedValue({ invitations: [INVITATION()] })
    revokeGarageInvitation.mockResolvedValue({})
    render(<GarageTeam />)
    fireEvent.click(await screen.findByTestId('revoke-invite'))
    await waitFor(() => expect(revokeGarageInvitation).toHaveBeenCalledWith('inv-1'))
  })

  it('a failed read is a loading problem, not "you have invited nobody"', async () => {
    listGarageInvitations.mockRejectedValue(new Error('network'))
    render(<GarageTeam />)
    expect(await screen.findByTestId('invitations-error'))
      .toHaveTextContent(/does not mean you have invited nobody/i)
    expect(screen.queryByTestId('invitations-empty')).toBeNull()
  })

  it('genuinely nobody invited says so plainly', async () => {
    render(<GarageTeam />)
    expect(await screen.findByTestId('invitations-empty')).toHaveTextContent(/have not invited anyone/i)
  })
})

describe('GMO-7 — who works here, and who no longer does', () => {
  it('lists the people in the garage with their role', async () => {
    render(<GarageTeam />)
    const item = await screen.findByTestId('member-item')
    expect(item).toHaveTextContent('Thabo')
    expect(item).toHaveTextContent('mechanic')
  })

  it('removing someone says plainly that their past work survives', async () => {
    render(<GarageTeam />)
    await screen.findByTestId('member-item')
    // The whole point of GMO-7: ending future authority is not erasing history.
    expect(screen.getByTestId('members-panel'))
      .toHaveTextContent(/work they have already done stays on every car's service record/i)
  })

  it('removes the person who was clicked', async () => {
    render(<GarageTeam />)
    fireEvent.click(await screen.findByTestId('remove-member'))
    await waitFor(() => expect(removeGarageMember).toHaveBeenCalledWith('u_mech'))
  })

  it('the last administrator is not offered a remove button', async () => {
    listGarageMembers.mockResolvedValue({
      members: [MEMBER({ userId: 'u_admin', displayName: 'Rutendo', role: 'admin', removable: false })],
      adminCount: 1,
    })
    render(<GarageTeam />)
    await screen.findByTestId('member-item')
    // `removable` is the SERVER's answer; the browser does not work it out.
    expect(screen.queryByTestId('remove-member')).toBeNull()
    expect(screen.getByTestId('not-removable')).toHaveTextContent(/only administrator/i)
  })

  it('changes a role through the server', async () => {
    render(<GarageTeam />)
    await screen.findByTestId('member-item')
    fireEvent.change(screen.getByTestId('member-role'), { target: { value: 'admin' } })
    await waitFor(() => expect(changeGarageMemberRole).toHaveBeenCalledWith('u_mech', 'admin'))
  })

  it('a refused removal is reported, naming who it was', async () => {
    removeGarageMember.mockRejectedValue(new Error('This is the only administrator.'))
    render(<GarageTeam />)
    fireEvent.click(await screen.findByTestId('remove-member'))
    expect(await screen.findByTestId('invite-error')).toHaveTextContent(/Thabo was not removed.*only administrator/is)
  })

  it('a failed member read is a loading problem, not an empty team', async () => {
    listGarageMembers.mockRejectedValue(new Error('network'))
    render(<GarageTeam />)
    expect(await screen.findByTestId('members-error'))
      .toHaveTextContent(/does not mean your team is empty/i)
    expect(screen.queryByTestId('members-empty')).toBeNull()
  })

  it('an unresolved name reads as unnamed, never invented', async () => {
    listGarageMembers.mockResolvedValue({ members: [MEMBER({ displayName: null, email: null })], adminCount: 2 })
    render(<GarageTeam />)
    const item = await screen.findByTestId('member-item')
    expect(item).toHaveTextContent(/Unnamed member/i)
    expect(item).toHaveTextContent(/No email recorded/i)
  })
})
