/**
 * OC-5R-REL-02 C — self → explicit organisation selection → active organisation, end to end in the UI.
 *
 * OC-5D's product contract is authoritative and is NOT changed by REL-02: login never silently
 * selects an organisation, not even where exactly one selectable membership exists. The person is
 * OFFERED it and must choose it. The deployed Trade OS spec (45) used to assume the operator was
 * already "inside" Hikari Co-Load after login; it now asks for the organisation the way a person does
 * (tests/agents/staging-helpers.ts → ensureActingForOrganisation).
 *
 * This suite pins the PRODUCT half of that helper's contract against the real prompt, switcher and
 * badge, with a session stand-in that behaves like the server's verified selection:
 *
 *   · after login the person acts for THEMSELVES — nothing was selected for them;
 *   · the prompt offers "Act for <organisation>"; tapping it sends exactly that organisation id;
 *   · once the selection holds the prompt is gone and the badge names the organisation;
 *   · a refused selection leaves the person acting for themselves, and says so;
 *   · a membership that is not active is never offered as something to act for.
 *
 * The exact test ids / accessible names asserted here are the ones the Playwright helper locates; the
 * backend contract test (oc5r-rel02-uat-harness-contracts) holds the helper to the same strings.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AuthUser, TenantMembership } from '@shared/types'

const toastSuccess = vi.fn()
const toastError = vi.fn()
const refreshSession = vi.fn()

let currentUser: AuthUser
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const publish = (next: AuthUser) => { currentUser = next; listeners.forEach((l) => l()) }

/** What the server does on PUT /api/auth/active-tenant: verify, then record on the session. */
const selectActiveTenant = vi.fn(async (tenantId: string | null) => {
  const membership = tenantId ? (currentUser.memberships ?? []).find((m) => m.id === tenantId) : null
  if (tenantId && (!membership || !membership.selectable)) throw new Error('That organisation is not available to you.')
  publish({
    ...currentUser,
    active_tenant_id: tenantId,
    active_tenant: membership ? { id: membership.id, name: membership.name, type: membership.type, status: membership.status } : null,
    tenant_role: membership?.role ?? null,
    tenant_context: tenantId ? 'selected' : 'none',
  })
})

vi.mock('@/context/AuthContext', async () => {
  const React = await import('react')
  return {
    useAuth: () => ({
      user: React.useSyncExternalStore(subscribe, () => currentUser),
      selectActiveTenant,
      refreshSession,
    }),
  }
})
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))

const { ActiveOrganisationPrompt, OrganisationBadge, OrganisationMenuSection } = await import('./OrganisationSwitcher')
const { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } = await import('@/components/ui/dropdown-menu')

const HIKARI: TenantMembership = {
  id: 'c0106a0e-1a11-4a6a-9e01-000000000a01', name: 'SYNTHETIC Hikari Co-Load Logistics', type: 'import', status: 'active', role: 'admin', selectable: true,
} as TenantMembership
const SUSPENDED: TenantMembership = {
  id: 't-suspended', name: 'SYNTHETIC Suspended Freight', type: 'import', status: 'suspended', role: 'admin', selectable: false,
} as TenantMembership

const actingForSelf = (memberships: TenantMembership[]): AuthUser => ({
  id: 'u_tradeos_operator', name: 'SYNTHETIC Hikari Co-Load Operator', email: 'tradeos.operator@carup-staging.test', role: 'owner',
  active_tenant_id: null, active_tenant: null, tenant_context: 'none', memberships,
})

/** The Playwright helper matches the badge by this accessible-name shape. */
const badgeName = (organisation: string) => `Acting for ${organisation}. Change organisation`

function Shell() {
  // The dashboard shell hosts the badge in its header and the prompt beneath it.
  return (<><OrganisationBadge /><ActiveOrganisationPrompt /></>)
}

beforeEach(() => {
  selectActiveTenant.mockClear()
  toastSuccess.mockReset()
  toastError.mockReset()
  refreshSession.mockReset()
  listeners.clear()
  try { sessionStorage.clear() } catch { /* jsdom */ }
})

describe('REL-02 C — the person chooses the organisation; login never does', () => {
  it('after login with ONE selectable membership the person acts for themselves — nothing was selected for them', () => {
    currentUser = actingForSelf([HIKARI])
    render(<Shell />)
    expect(screen.getByTestId('organisation-badge')).toHaveAttribute('aria-label', badgeName('Yourself'))
    expect(screen.getByTestId('organisation-prompt')).toBeInTheDocument()
    expect(selectActiveTenant).not.toHaveBeenCalled()
  })

  it('self → explicit "Act for <organisation>" → the session acts for that organisation', async () => {
    currentUser = actingForSelf([HIKARI])
    render(<Shell />)

    const control = screen.getByRole('button', { name: /Act for .*Hikari Co-Load/i })
    expect(control).toHaveAttribute('data-testid', `organisation-prompt-select-${HIKARI.id}`)
    fireEvent.click(control)

    await waitFor(() => expect(selectActiveTenant).toHaveBeenCalledTimes(1))
    expect(selectActiveTenant).toHaveBeenCalledWith(HIKARI.id)
    // The product's own state, not a test-side write: the badge names the organisation and the prompt is gone.
    await waitFor(() => expect(screen.getByTestId('organisation-badge')).toHaveAttribute('aria-label', badgeName(HIKARI.name)))
    expect(screen.queryByTestId('organisation-prompt')).toBeNull()
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(`You are now acting for ${HIKARI.name}.`))
  })

  it('the badge name matches the shape the Playwright helper waits for', async () => {
    currentUser = actingForSelf([HIKARI])
    render(<Shell />)
    fireEvent.click(screen.getByTestId(`organisation-prompt-select-${HIKARI.id}`))
    await waitFor(() => expect(screen.getByTestId('organisation-badge').getAttribute('aria-label')).toMatch(
      new RegExp('^Acting for .*(?:Hikari Co-Load).*\\. Change organisation$', 'i'),
    ))
    // …and "Yourself" must NOT satisfy it (the helper must not treat "acting for self" as already-Hikari).
    expect(badgeName('Yourself')).not.toMatch(new RegExp('^Acting for .*(?:Hikari Co-Load).*\\. Change organisation$', 'i'))
  })

  it('a refused selection leaves the person acting for themselves, and says so', async () => {
    currentUser = actingForSelf([HIKARI])
    selectActiveTenant.mockRejectedValueOnce(new Error('Your access to this organisation has changed.'))
    render(<Shell />)
    fireEvent.click(screen.getByTestId(`organisation-prompt-select-${HIKARI.id}`))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not change organisation. Your access to this organisation has changed.'))
    expect(screen.getByTestId('organisation-badge')).toHaveAttribute('aria-label', badgeName('Yourself'))
    expect(screen.getByTestId('organisation-prompt'), 'still being asked: nothing was selected').toBeInTheDocument()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('an organisation that is not active is never offered as something to act for', () => {
    currentUser = actingForSelf([SUSPENDED])
    render(<Shell />)
    // Nothing selectable → no prompt at all, and certainly no "Act for" control for the suspended one.
    expect(screen.queryByRole('button', { name: /Act for/i })).toBeNull()
    expect(screen.queryByTestId('organisation-prompt')).toBeNull()
    expect(selectActiveTenant).not.toHaveBeenCalled()
  })

  it('in the switcher an inactive membership reads "not active" and cannot be chosen', () => {
    currentUser = actingForSelf([HIKARI, SUSPENDED])
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent><OrganisationMenuSection /></DropdownMenuContent>
      </DropdownMenu>,
    )
    expect(screen.getByTestId(`organisation-select-${HIKARI.id}`)).toHaveTextContent(/Act for SYNTHETIC Hikari Co-Load Logistics/)
    const unavailable = screen.getByTestId(`organisation-unavailable-${SUSPENDED.id}`)
    expect(unavailable).toHaveTextContent('not active')
    expect(unavailable).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByTestId(`organisation-select-${SUSPENDED.id}`)).toBeNull()
  })

  it('a server that refuses an unavailable organisation (a forged choice) changes nothing', async () => {
    currentUser = actingForSelf([HIKARI, SUSPENDED])
    await expect(selectActiveTenant(SUSPENDED.id)).rejects.toThrow('not available')
    expect(currentUser.active_tenant_id).toBeNull()
    expect(currentUser.tenant_context).toBe('none')
  })
})
