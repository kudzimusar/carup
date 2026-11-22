/**
 * LR02 — /diaspora/rfq for a signed-out visitor (unified presentation): a public explainer instead of a
 * dead end. How a reverse request works, what sellers see (including a budget, if one is added — the
 * seller list returns the published request as recorded), that quotes are only what sellers submit and
 * that accepting needs an account; two real actions (prepare a request; a safe sign-in redirect). The page
 * container reads NOTHING for a guest. A signed-in account without a buying or selling role keeps its
 * refusal. Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildLoginRedirect, isSafeReturnTo } from '@/lib/returnTo'

const auth = vi.hoisted(() => ({ user: null as { id: string; role: string } | null, isAuthenticated: false, loading: false }))
const api = vi.hoisted(() => ({
  fetchDiasporaBuyerOrders: vi.fn(),
  fetchDiasporaRfqs: vi.fn(),
  fetchDiasporaBuyerOrder: vi.fn(),
  fetchDiasporaOrderMatches: vi.fn(),
  createDiasporaBuyerOrder: vi.fn(),
  publishDiasporaRfq: vi.fn(),
  acceptDiasporaQuote: vi.fn(),
  createDiasporaQuote: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))

const fetchSpy = vi.fn(() => Promise.reject(new Error('a guest must not cause a request')))
const settle = () => new Promise(resolve => setTimeout(resolve, 150))

async function mountRfq() {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = true
  const { default: Page } = await import('@/pages/diaspora/DiasporaReverseRfq')
  return render(<MemoryRouter><Page /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.user = null
  auth.isAuthenticated = false
  auth.loading = false
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined
})

describe('Sourcing requests — guest explainer', () => {
  it('explains reverse requests, what sellers see, quotes and accepting, with two real actions — and reads no API', async () => {
    await mountRfq()
    const guest = screen.getByTestId('trade-rfq-guest')
    expect(screen.queryByText('Sign in to use sourcing requests')).toBeNull()

    for (const step of ['describe', 'publish', 'quote', 'choose']) expect(screen.getByTestId(`trade-rfq-guest-step-${step}`)).toBeInTheDocument()
    expect(screen.getByTestId('trade-rfq-guest-step-publish')).toHaveTextContent('Sellers cannot see a request until you publish it')
    expect(screen.getByTestId('trade-rfq-guest-step-quote')).toHaveTextContent('A quote is only what a seller submits')
    expect(screen.getByTestId('trade-rfq-guest-step-choose')).toHaveTextContent('only when you are signed in')
    // The seller list returns the published request as recorded, so the page never claims the budget is hidden.
    const sellersSee = screen.getByTestId('trade-rfq-guest-sellers-see')
    expect(sellersSee).toHaveTextContent('the budget you stated')
    // TF-71: the request flow this page opens requires a budget, so nothing here says it is optional or can be left out.
    expect(screen.getByTestId('trade-rfq-guest')).not.toHaveTextContent(/budget is optional|leave the budget out|if you add one/i)
    expect(screen.getByTestId('trade-rfq-guest-step-describe')).toHaveTextContent('where it should arrive and your budget')
    expect(sellersSee).not.toHaveTextContent(/never see your budget|budget is hidden|budget stays private/i)

    expect(screen.getByTestId('trade-rfq-guest-prepare')).toHaveAttribute('href', '/diaspora/imports/new')
    expect(screen.getByTestId('trade-rfq-guest-prepare')).toHaveTextContent('Prepare a request — no account needed to start')
    const signIn = screen.getByTestId('trade-rfq-guest-signin')
    expect(signIn).toHaveTextContent('Sign in to see your requests')
    expect(signIn).toHaveAttribute('href', buildLoginRedirect('/diaspora/rfq'))
    expect(isSafeReturnTo(new URL(signIn.getAttribute('href')!, 'http://carup.invalid').searchParams.get('returnTo'))).toBe(true)
    expect(screen.getByTestId('trade-rfq-guest-sample')).toHaveAttribute('href', '/diaspora/sample?order=request&mode=quotes')

    // Nothing to compose, publish or accept here.
    expect(guest.querySelectorAll('form, input, select, textarea, button')).toHaveLength(0)
    expect(within(guest).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual([
      '/diaspora/imports/new', buildLoginRedirect('/diaspora/rfq'), '/diaspora/sample?order=request&mode=quotes',
    ])

    await settle()
    for (const [name, fn] of Object.entries(api)) expect(fn, `${name} was called for a guest`).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('while the session is being checked, it waits (no explainer, no read)', async () => {
    auth.loading = true
    await mountRfq()
    expect(screen.getByTestId('trade-rfq-auth-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-rfq-guest')).toBeNull()
    await settle()
    expect(api.fetchDiasporaBuyerOrders).not.toHaveBeenCalled()
  })

  it('signed in without a buying or selling role: still the refusal, not the guest explainer', async () => {
    auth.user = { id: 'fictional-mechanic', role: 'mechanic' }
    auth.isAuthenticated = true
    await mountRfq()
    expect(screen.getByTestId('trade-rfq-denied')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-rfq-guest')).toBeNull()
  })
})
