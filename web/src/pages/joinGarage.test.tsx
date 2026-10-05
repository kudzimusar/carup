/**
 * GMO-6 (OC-5E) — the page an invited person lands on.
 *
 * It says what is offered before asking anything; "not valid" and "could not check" are different
 * facts; a signed-out invitee is sent to sign in with `returnTo` (the parameter Login and Register
 * read — #209's `?next=` brought nobody back); and joining takes the person INTO the garage: the new
 * membership is selected (server-verified), the session re-read, then the Workshop opens.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const peekGarageInvitation = vi.fn()
const acceptGarageInvitation = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ peekGarageInvitation, acceptGarageInvitation }) }))

const calls: string[] = []
let auth: Record<string, unknown>
const selectActiveTenant = vi.fn(async (id: string | null) => { calls.push(`select:${id}`) })
const refreshSession = vi.fn(async () => { calls.push('refresh') })
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))

const { default: JoinGarage } = await import('./JoinGarage')

const PEEK = { garageName: 'Msasa Motors', role: 'mechanic', invitedName: null, invitedEmail: 'thabo@example.invalid', status: 'pending', usable: true }

function renderAt(token = 'tok-1') {
  return render(
    <MemoryRouter initialEntries={[`/join-garage?token=${token}`]}>
      <Routes>
        <Route path="/join-garage" element={<JoinGarage />} />
        <Route path="/garage" element={<span data-testid="workshop">workshop</span>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  peekGarageInvitation.mockResolvedValue(PEEK)
  acceptGarageInvitation.mockResolvedValue({ tenantId: 'garage-1', role: 'mechanic', created: true })
  auth = { isAuthenticated: true, user: { id: 'u', email: 'Thabo@example.invalid' }, selectActiveTenant, refreshSession }
})

describe('before anything is asked', () => {
  it('says which garage, what role, and which verified address', async () => {
    renderAt()
    expect(await screen.findByTestId('invitation-card')).toHaveTextContent('Msasa Motors has invited you')
    expect(screen.getByTestId('invited-email')).toHaveTextContent(/thabo@example.invalid.*verified/s)
  })

  it('"not valid" and "could not check" are different facts', async () => {
    peekGarageInvitation.mockRejectedValueOnce(new Error('This invitation link is not valid.'))
    const first = renderAt()
    expect(await screen.findByTestId('invitation-invalid')).toBeTruthy()
    first.unmount()
    peekGarageInvitation.mockRejectedValueOnce(new Error('network'))
    renderAt()
    expect(await screen.findByTestId('invitation-error')).toHaveTextContent(/does not mean your invitation is not real/)
  })
})

describe('signing in comes back here', () => {
  it('the sign-in and register links carry returnTo with this page and its token — never next', async () => {
    auth = { isAuthenticated: false, user: null, selectActiveTenant, refreshSession }
    renderAt('tok/2')
    await screen.findByTestId('sign-in-first')
    const back = encodeURIComponent('/join-garage?token=tok%2F2')
    expect(screen.getByTestId('go-sign-in').getAttribute('href')).toBe(`/login?returnTo=${back}`)
    expect(screen.getByTestId('go-register').getAttribute('href')).toBe(`/register?returnTo=${back}`)
    expect(document.body.innerHTML).not.toMatch(/[?&]next=/)
  })
})

describe('joining takes the person into the garage', () => {
  it('accept, select THIS garage, re-read the session, then the Workshop — in that order', async () => {
    renderAt()
    fireEvent.click(await screen.findByTestId('accept-invitation'))
    expect(await screen.findByTestId('workshop')).toBeTruthy()
    expect(acceptGarageInvitation).toHaveBeenCalledWith('tok-1')
    expect(calls).toEqual(['select:garage-1', 'refresh'])
  })

  it('a refused acceptance stays here and says why — nobody is moved', async () => {
    acceptGarageInvitation.mockRejectedValueOnce(new Error('Verify your email address first — CarUp has sent you a link — then open this invitation again.'))
    renderAt()
    fireEvent.click(await screen.findByTestId('accept-invitation'))
    expect(await screen.findByTestId('accept-error')).toHaveTextContent(/Verify your email address/)
    expect(screen.queryByTestId('workshop')).toBeNull()
    expect(selectActiveTenant).not.toHaveBeenCalled()
  })

  it('an acceptance that names no garage is not treated as a membership', async () => {
    acceptGarageInvitation.mockResolvedValueOnce({ created: true })
    renderAt()
    fireEvent.click(await screen.findByTestId('accept-invitation'))
    expect(await screen.findByTestId('accept-error')).toHaveTextContent(/did not confirm/)
    expect(selectActiveTenant).not.toHaveBeenCalled()
  })

  it('a different signed-in account is told so, and offered no Join button', async () => {
    auth = { isAuthenticated: true, user: { id: 'u2', email: 'someone@example.invalid' }, selectActiveTenant, refreshSession }
    renderAt()
    expect(await screen.findByTestId('wrong-account')).toBeTruthy()
    expect(screen.queryByTestId('accept-invitation')).toBeNull()
  })
})
