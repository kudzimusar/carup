/**
 * RX05-C — /dealers/staff unified Dealer OS view: who has access (role, branch grants, invitation
 * states incl. pending/revoked), destructive actions behind an explicit confirmation, and the same
 * canonical endpoints as the legacy console. Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fx = vi.hoisted(() => ({
  requests: [] as Array<{ path: string; method: string; body: unknown }>,
  ownerReads: true,
  allDown: false,
}))
const auth = vi.hoisted(() => ({ user: { id: 'fictional-owner', role: 'member' }, token: 'synthetic-session' }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
const BRANCH = '11111111-2222-4333-8444-555555555555'
vi.mock('@/lib/apiClient', () => ({
  resolveApiBaseUrl: () => 'http://127.0.0.1:3001/api',
  apiRequest: async (request: { path: string; options?: { method?: string; body?: string } }) => {
    const method = request.options?.method || 'GET'
    fx.requests.push({ path: request.path, method, body: request.options?.body ? JSON.parse(request.options.body) : null })
    const deny = () => { throw Object.assign(new Error('HTTP 403'), { status: 403 }) }
    if (fx.allDown) throw Object.assign(new Error('HTTP 503'), { status: 503 })
    switch (request.path) {
      case '/dealer/operational-staff':
        if (!fx.ownerReads) deny()
        return { staff: { tenant_id: 't', branch_role_scope_not_configured: true, staff_listing_authority: false,
          members: [
            { user_id: 'fictional-owner', role: 'dealer', joined_at: '2026-10-01T10:00:00Z', belongs_to_canonical_tenant: true },
            { user_id: 'fictional-staff', role: 'member', joined_at: '2026-11-01T10:00:00Z', belongs_to_canonical_tenant: true },
          ],
          invitations: [
            { invite_id: 'inv-accepted', invited_user_id: 'fictional-staff', requested_role: 'member', status: 'ACCEPTED', created_at: '2026-10-30T10:00:00Z', expires_at: '2026-12-30T10:00:00Z' },
            { invite_id: 'inv-pending', invited_user_id: 'fictional-pending', requested_role: 'member', status: 'PENDING', created_at: '2026-11-10T10:00:00Z', expires_at: '2026-12-10T10:00:00Z' },
            { invite_id: 'inv-revoked', invited_user_id: 'fictional-former', requested_role: 'member', status: 'REVOKED', created_at: '2026-09-10T10:00:00Z', expires_at: '2026-10-10T10:00:00Z' },
          ] } }
      case '/dealer/staff-invitations/mine': return { invitations: [] }
      case '/dealer/staff-branches/mine': return { scopes: { branches: [] } }
      case '/dealer/staff-branch-scopes/owner':
        if (!fx.ownerReads) deny()
        return { ledger: { scopes: [{ scope_id: 'scope-1', invite_id: 'inv-accepted', branch_id: BRANCH, permission: 'EDIT_BRANCH_DETAILS', status: 'ACTIVE' }] } }
      case '/dealer/operational-workspace':
        if (!fx.ownerReads) deny()
        return { workspace: { branches: [{ id: BRANCH, name: 'Fictional Harare Yard' }] } }
      case '/dealer/staff-invitations/inv-pending/revoke': return { receipt: { status: 'REVOKED' } }
      case '/dealer/staff-branch-scopes/scope-1/revoke': return { receipt: { status: 'REVOKED' } }
      case '/dealer/staff-invitations': return { receipt: { invite_id: 'inv-new', status: 'PENDING' } }
    }
    throw Error('Unexpected request ' + method + ' ' + request.path)
  },
}))

async function mount(unified = true) {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = unified ? true : undefined
  const { default: Page } = await import('@/pages/DealerStaffConsole')
  return render(<MemoryRouter><Page /></MemoryRouter>)
}
const writes = () => fx.requests.filter(r => r.method === 'POST')
beforeEach(() => { fx.requests = []; fx.ownerReads = true; fx.allDown = false })
afterEach(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined })

describe('DealerStaffConsole — unified Dealer OS view', () => {
  it('flag OFF keeps the legacy console', async () => {
    await mount(false)
    expect(await screen.findByRole('heading', { name: 'Dealership staff and access' })).toBeInTheDocument()
    expect(screen.queryByTestId('dealer-ws-staff')).toBeNull()
  })

  it('shows who has access, their role and branch grant, and every invitation state', async () => {
    await mount()
    const staffRow = await screen.findByTestId('dealer-ws-member-fictional-staff')
    expect(staffRow).toHaveTextContent('Tenant role: member')
    expect(staffRow).toHaveTextContent('Edit branch details · Fictional Harare Yard')
    expect(screen.getByTestId('dealer-ws-member-fictional-owner')).toHaveTextContent('Tenant role: dealer')
    expect(screen.getByTestId('dealer-ws-staff-members-count')).toHaveTextContent('2 with access')
    expect(screen.getByTestId('dealer-ws-invitation-status-inv-pending')).toHaveAttribute('data-tone', 'warning')
    expect(screen.getByTestId('dealer-ws-invitation-status-inv-revoked')).toHaveTextContent('Revoked')
    expect(screen.getByTestId('dealer-ws-invitation-status-inv-revoked')).not.toHaveAttribute('data-tone', 'success')
    // A revoked invitation offers no further action.
    expect(within(screen.getByTestId('dealer-ws-invitation-inv-revoked')).queryByRole('button')).toBeNull()
    expect(document.querySelector('[data-tone="success"]')).toBeNull()
  })

  it('revoking an invitation needs an explicit confirmation; cancelling sends nothing', async () => {
    await mount()
    const pending = await screen.findByTestId('dealer-ws-invitation-inv-pending')
    fireEvent.click(within(pending).getByRole('button', { name: 'Revoke…' }))
    expect(writes()).toHaveLength(0)
    fireEvent.click(within(pending).getByRole('button', { name: 'Keep access' }))
    expect(within(pending).queryByTestId('dealer-ws-revoke-confirm-inv-pending')).toBeNull()
    expect(writes()).toHaveLength(0)

    fireEvent.click(within(pending).getByRole('button', { name: 'Revoke…' }))
    fireEvent.click(within(pending).getByRole('button', { name: 'Revoke invitation or staff membership' }))
    await waitFor(() => expect(writes().map(r => r.path)).toEqual(['/dealer/staff-invitations/inv-pending/revoke']))
    expect(await screen.findByTestId('dealer-ws-staff-notice')).toHaveTextContent('Invitation or canonical limited membership revoked and recorded.')
  })

  it('branch-scope revocation is also confirmed, and branch grants require a recorded reason', async () => {
    await mount()
    const scope = await screen.findByTestId('dealer-ws-scope-scope-1')
    fireEvent.click(within(scope).getByRole('button', { name: 'Revoke…' }))
    expect(writes()).toHaveLength(0)
    fireEvent.click(within(scope).getByRole('button', { name: 'Revoke branch operating scope' }))
    await waitFor(() => expect(writes().map(r => r.path)).toEqual(['/dealer/staff-branch-scopes/scope-1/revoke']))

    const accepted = screen.getByTestId('dealer-ws-invitation-inv-accepted')
    fireEvent.click(within(accepted).getByRole('button', { name: /Grant branch editing/ }))
    const grant = within(accepted).getByRole('button', { name: 'Grant limited branch edit access' })
    expect(grant).toBeDisabled()
    fireEvent.change(document.querySelector('#staff-branch-grant-reason')!, { target: { value: 'too short' } })
    expect(grant).toBeDisabled()
  })

  it('invites through the same canonical endpoint as a limited member only', async () => {
    await mount()
    fireEvent.click(await screen.findByTestId('dealer-ws-invite-toggle'))
    fireEvent.change(document.querySelector('#staff-existing-user')!, { target: { value: 'fictional-new-staff' } })
    fireEvent.click(screen.getByRole('button', { name: 'Issue private staff invitation' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ path: '/dealer/staff-invitations', body: { invited_user_id: 'fictional-new-staff', role: 'member' } })
  })

  it('a non-owner account sees only its own invitations and branch operations', async () => {
    fx.ownerReads = false
    await mount()
    expect(await screen.findByTestId('dealer-ws-my-invitations')).toHaveTextContent('No invitations are currently assigned to your authenticated account.')
    expect(screen.getByTestId('dealer-ws-my-branches')).toHaveTextContent('No active branch-operating scope was delegated to this account.')
    expect(screen.queryByTestId('dealer-ws-members')).toBeNull()
    expect(screen.queryByTestId('dealer-ws-invite-toggle')).toBeNull()
  })

  it('when every read fails it says so (not "no staff") and retries the same reads', async () => {
    fx.allDown = true
    await mount()
    const error = await screen.findByTestId('dealer-ws-staff-error')
    expect(error).toHaveTextContent('not proof that your dealership has no staff')
    fx.allDown = false
    fireEvent.click(within(error).getByRole('button', { name: /Try again/ }))
    expect(await screen.findByTestId('dealer-ws-member-fictional-staff')).toBeInTheDocument()
  })
})
