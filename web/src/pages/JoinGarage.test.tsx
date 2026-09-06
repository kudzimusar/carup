/**
 * GMO-6 — the page an invited mechanic lands on.
 *
 * Most people arriving here have never used CarUp. The page has to answer, before asking anything:
 * which garage, what role, and which email address. Being told the last of those only after
 * registering is a wasted account and a person who gives up.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import JoinGarage from './JoinGarage'

const peekGarageInvitation = vi.fn()
const acceptGarageInvitation = vi.fn()
const navigate = vi.fn()
let auth: Record<string, unknown> = { isAuthenticated: false, user: null }
let search = 'token=raw-token'

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ peekGarageInvitation, acceptGarageInvitation }),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigate,
    useSearchParams: () => [new URLSearchParams(search), vi.fn()],
  }
})

const PEEK = {
  garageName: 'Mbare Motors', role: 'mechanic', invitedName: 'Thabo',
  invitedEmail: 'thabo@example.com', status: 'pending' as const, usable: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  auth = { isAuthenticated: false, user: null }
  search = 'token=raw-token'
  peekGarageInvitation.mockResolvedValue(PEEK)
  acceptGarageInvitation.mockResolvedValue({ tenantId: 't-1', created: true })
})

const view = () => render(<MemoryRouter><JoinGarage /></MemoryRouter>)

describe('what a stranger is told before signing in', () => {
  it('names the garage, the role and the email BEFORE asking for an account', async () => {
    view()
    const card = await screen.findByTestId('invitation-card')
    expect(card).toHaveTextContent('Mbare Motors')
    expect(card).toHaveTextContent('mechanic')
    expect(screen.getByTestId('invited-email')).toHaveTextContent('thabo@example.com')
    expect(screen.getByTestId('sign-in-first')).toBeTruthy()
  })

  it('does not leak anything operational about the garage', async () => {
    view()
    await screen.findByTestId('invitation-card')
    const text = document.body.textContent ?? ''
    for (const leak of [/customer/i, /revenue/i, /case #/i, /other members/i]) {
      expect(text, `a forwarded link must not be a reconnaissance tool: ${leak}`).not.toMatch(leak)
    }
  })
})

describe('the return path is built, never taken from the URL', () => {
  it('sends sign-in back to this page with its own token', async () => {
    view()
    await screen.findByTestId('sign-in-first')
    const href = screen.getByTestId('go-sign-in').closest('a')?.getAttribute('href') ?? ''
    expect(href).toContain('/login?next=')
    expect(decodeURIComponent(href)).toContain('/join-garage?token=raw-token')
  })

  it('ignores an attacker-supplied next parameter entirely', async () => {
    // An invitation link is exactly the kind of thing that gets forwarded and rewritten. A `next=`
    // honoured after sign-in is an open redirect with a captive audience.
    search = 'token=raw-token&next=https://evil.example.com/steal'
    view()
    await screen.findByTestId('sign-in-first')
    for (const id of ['go-sign-in', 'go-register']) {
      const href = decodeURIComponent(screen.getByTestId(id).closest('a')?.getAttribute('href') ?? '')
      expect(href).not.toContain('evil.example.com')
      expect(href).toContain('/join-garage?token=raw-token')
    }
  })
})

describe('accepting', () => {
  it('offers acceptance to the right person', async () => {
    auth = { isAuthenticated: true, user: { email: 'thabo@example.com' } }
    view()
    fireEvent.click(await screen.findByTestId('accept-invitation'))
    await waitFor(() => expect(acceptGarageInvitation).toHaveBeenCalledWith('raw-token'))
    expect(navigate).toHaveBeenCalledWith('/dashboard')
  })

  it('tells the WRONG account which address to use, and offers no accept button', async () => {
    auth = { isAuthenticated: true, user: { email: 'someone.else@example.com' } }
    view()
    expect(await screen.findByTestId('wrong-account'))
      .toHaveTextContent(/signed in as someone\.else@example\.com.*sent to thabo@example\.com/is)
    expect(screen.queryByTestId('accept-invitation')).toBeNull()
  })

  it('matches the address case-insensitively', async () => {
    auth = { isAuthenticated: true, user: { email: 'Thabo@Example.COM' } }
    view()
    expect(await screen.findByTestId('accept-invitation')).toBeTruthy()
    expect(screen.queryByTestId('wrong-account')).toBeNull()
  })

  it('a refused acceptance is reported and does not navigate', async () => {
    auth = { isAuthenticated: true, user: { email: 'thabo@example.com' } }
    acceptGarageInvitation.mockRejectedValue(new Error('This invitation has already been used.'))
    view()
    fireEvent.click(await screen.findByTestId('accept-invitation'))
    expect(await screen.findByTestId('accept-error')).toHaveTextContent(/already been used/i)
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('an invitation that cannot be used says which kind of cannot', () => {
  it.each([
    ['accepted', /already been used/i],
    ['revoked', /cancelled this invitation/i],
    ['expired', /expired.*ask the garage/i],
  ])('%s', async (status, expected) => {
    auth = { isAuthenticated: true, user: { email: 'thabo@example.com' } }
    peekGarageInvitation.mockResolvedValue({ ...PEEK, status, usable: false })
    view()
    expect(await screen.findByTestId('invitation-unusable')).toHaveTextContent(expected)
    expect(screen.queryByTestId('accept-invitation')).toBeNull()
  })
})

describe('the two kinds of "no"', () => {
  it('an invalid link says so plainly', async () => {
    peekGarageInvitation.mockRejectedValue(new Error('This invitation link is not valid.'))
    view()
    expect(await screen.findByTestId('invitation-invalid')).toHaveTextContent(/not valid/i)
  })

  it('a failed check is NOT reported as an invalid invitation', async () => {
    // A person who was genuinely invited must not be told their invitation is fake because a
    // request timed out.
    peekGarageInvitation.mockRejectedValue(new Error('network timeout'))
    view()
    expect(await screen.findByTestId('invitation-error'))
      .toHaveTextContent(/does not mean your invitation is not real/i)
    expect(screen.queryByTestId('invitation-invalid')).toBeNull()
  })

  it('no token at all is an invalid link, and asks nothing of the server', async () => {
    search = ''
    view()
    expect(await screen.findByTestId('invitation-invalid')).toBeTruthy()
    expect(peekGarageInvitation).not.toHaveBeenCalled()
  })
})
