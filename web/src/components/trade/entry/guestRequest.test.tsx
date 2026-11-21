/**
 * RX-06 LR02 — preparing an import request while signed out (`/diaspora/imports/new`, unified UI on).
 *
 * A guest moves through the real page and flow; "Send" never calls the API — it writes the draft to
 * this tab and opens the sign-in boundary (focus-managed; Escape or Cancel returns focus). After
 * signing in, the account finds the draft on the review with a notice and sends it only by pressing
 * Send, through the same handler and body. Drafts of another account, or expired ones, are discarded.
 * With the flags OFF the legacy page still sends a guest to sign in. Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { buildLoginRedirect, isSafeReturnTo } from '@/lib/returnTo'
import { IMPORT_DRAFT_KEY, INITIAL_IMPORT_REQUEST, writeImportDraft } from './importRequest'

const fx = vi.hoisted(() => ({
  unified: true,
  authenticated: false,
  user: null as { id: string; role: string; name: string } | null,
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
}))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: fx.user, isAuthenticated: fx.authenticated, loading: false, token: fx.authenticated ? 'synthetic' : null }) }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => fx.api }))
vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => fx.unified }))
vi.mock('@/components/intelligence/TradeIntelligence', () => ({ default: () => <div data-testid="intel-stub" /> }))

const BUYER = { id: 'fx-buyer', role: 'owner', name: 'Fictional Buyer' }
const FILLED = {
  ...INITIAL_IMPORT_REQUEST,
  origin_country: 'Japan', origin_city: 'Yokohama', destination_city: 'Harare',
  requested_make: 'Toyota', requested_model: 'Aqua', requested_year_min: 2018, budget_amount: 9000,
}
const LEGACY_BODY = {
  order_type: 'vehicle', origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare',
  requested_make: 'Toyota', requested_model: 'Aqua', requested_year_min: 2018, requested_year_max: 2018, budget_amount: 9000, budget_currency: 'USD',
}
const SIGN_IN_HREF = '/login?returnTo=%2Fdiaspora%2Fimports%2Fnew'
const REGISTER_HREF = '/register?returnTo=%2Fdiaspora%2Fimports%2Fnew'

function signInAs(user: typeof BUYER | null) {
  fx.authenticated = user !== null
  fx.user = user
}
const storedDraft = () => JSON.parse(sessionStorage.getItem(IMPORT_DRAFT_KEY) ?? 'null')
const apiCalls = () => Object.values(fx.api).reduce((n, fn) => n + fn.mock.calls.length, 0)

beforeEach(() => {
  fx.unified = true
  signInAs(null)
  sessionStorage.clear()
  fx.api = {
    createDiasporaImportOrder: vi.fn(async () => ({ id: 'fx-new-order' })),
    fetchDiasporaImportOrders: vi.fn(async () => []),
  }
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Where({ id }: { id: string }) {
  const location = useLocation()
  return <p data-testid={id}>{`${location.pathname}${location.search}`}</p>
}

async function openRequest() {
  const { NewDiasporaImportOrder } = await import('@/pages/diaspora/DiasporaTrade')
  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/diaspora/imports/new']}>
        <Routes>
          <Route path="/diaspora/imports/new" element={<NewDiasporaImportOrder />} />
          <Route path="/diaspora/imports/:id" element={<Where id="landed-on-order" />} />
          <Route path="/login" element={<Where id="landed-on-sign-in" />} />
          <Route path="/register" element={<Where id="landed-on-register" />} />
        </Routes>
      </MemoryRouter>,
    )
  })
}

/** Every step as a person would: one goal at a time, with a Back on the way to show answers are kept. */
function fillEveryStep() {
  fireEvent.click(screen.getByTestId('trade-request-continue')) // cargo: a vehicle (default)
  fireEvent.change(screen.getByTestId('diaspora-make-input'), { target: { value: 'Toyota' } })
  fireEvent.change(screen.getByTestId('diaspora-model-input'), { target: { value: 'Aqua' } })
  fireEvent.change(screen.getByTestId('diaspora-year-input'), { target: { value: '2018' } })
  fireEvent.click(screen.getByTestId('trade-request-continue'))
  fireEvent.click(screen.getByTestId('trade-request-back'))
  expect(screen.getByTestId('diaspora-make-input')).toHaveValue('Toyota')
  fireEvent.click(screen.getByTestId('trade-request-continue'))
  fireEvent.change(screen.getByTestId('diaspora-origin-country-input'), { target: { value: 'Japan' } })
  fireEvent.change(screen.getByTestId('diaspora-origin-city-input'), { target: { value: 'Yokohama' } })
  fireEvent.change(screen.getByTestId('diaspora-destination-city-input'), { target: { value: 'Harare' } })
  fireEvent.click(screen.getByTestId('trade-request-continue'))
  fireEvent.change(screen.getByTestId('diaspora-budget-input'), { target: { value: '9000' } })
  fireEvent.click(screen.getByTestId('trade-request-continue'))
  expect(screen.getByTestId('diaspora-import-form')).toHaveAttribute('data-step', 'review')
}

async function pressSend() {
  await act(async () => { fireEvent.click(screen.getByTestId('diaspora-submit-import-button')) })
}

describe('a guest prepares the request (no sign-in wall)', () => {
  it('starts without an account and is told, from the first step, that this is an unsent draft', async () => {
    await openRequest()
    expect(screen.queryByTestId('landed-on-sign-in')).toBeNull()
    expect(screen.getByTestId('diaspora-new-import-route')).toHaveAttribute('data-visitor', 'guest')
    // The task's h1 comes from the focused flow shell (unifiedRouteShell.test.tsx covers the visitor chrome).
    expect(screen.getByTestId('trade-request-step-label')).toHaveTextContent('Step 1 of 5')
    expect(screen.getByTestId('trade-request-guest-badge')).toHaveTextContent('Draft · not sent')
    expect(screen.getByTestId('trade-request-guest-intro')).toHaveTextContent('No account needed to prepare this')
    expect(screen.getByTestId('trade-request-guest-intro')).toHaveTextContent('nothing reaches CarUp or any seller until you sign in and press Send')
    // A guest leaves to the public Trade entry, not to the account's order ledger.
    expect(screen.getByTestId('diaspora-cancel-import-button')).toHaveAttribute('href', '/diaspora')
    expect(apiCalls()).toBe(0)
  })

  it('pressing Send never calls the API: the draft is kept in this tab and the sign-in boundary opens with the safe routes', async () => {
    await openRequest()
    fillEveryStep()
    expect(screen.getByTestId('trade-request-guest-draft')).toHaveTextContent('Draft — not sent. Nothing reaches CarUp or any seller until you sign in and press Send.')
    await pressSend()

    expect(fx.api.createDiasporaImportOrder).not.toHaveBeenCalled()
    expect(apiCalls()).toBe(0)
    const boundary = screen.getByRole('dialog', { name: 'Sign in to send your request' })
    expect(boundary).toBe(screen.getByTestId('trade-request-guest-boundary'))
    expect(document.activeElement).toBe(boundary)
    expect(boundary).toHaveTextContent('A free personal account is all you need — not a dealership or company account.')
    expect(boundary).toHaveTextContent('Your draft is kept in this browser tab only. It is not in a CarUp account until you send it.')
    expect(boundary).toHaveTextContent('Closing this tab discards it')

    const signIn = screen.getByTestId('trade-request-guest-sign-in')
    expect(signIn).toHaveAttribute('href', SIGN_IN_HREF)
    expect(signIn.getAttribute('href')).toBe(buildLoginRedirect('/diaspora/imports/new'))
    const register = screen.getByTestId('trade-request-guest-register')
    expect(register).toHaveAttribute('href', REGISTER_HREF)
    expect(register).toHaveTextContent('Create a free account')
    for (const href of [SIGN_IN_HREF, REGISTER_HREF]) {
      expect(isSafeReturnTo(new URL(href, 'http://carup.invalid').searchParams.get('returnTo'))).toBe(true)
    }
    // Only one primary action at a time: the boundary takes the place of "Send".
    expect(screen.queryByTestId('diaspora-submit-import-button')).toBeNull()

    // The draft is in this tab, owned by the guest, with an expiry — and nothing else.
    const draft = storedDraft()
    expect(draft).toMatchObject({ owner: 'guest', step: 4, form: { requested_make: 'Toyota', origin_city: 'Yokohama', budget_amount: 9000 } })
    expect(typeof draft.expiresAt).toBe('string')
    expect(draft.form).not.toHaveProperty('metadata')
  })

  it('Escape or Cancel closes the boundary and returns focus to Send; the Escape does not leak to the page', async () => {
    const documentKeys = vi.fn()
    document.addEventListener('keydown', documentKeys)
    try {
      await openRequest()
      fillEveryStep()
      await pressSend()
      await act(async () => { fireEvent.keyDown(screen.getByTestId('trade-request-guest-cancel'), { key: 'Escape' }) })
      expect(screen.queryByTestId('trade-request-guest-boundary')).toBeNull()
      expect(document.activeElement).toBe(screen.getByTestId('diaspora-submit-import-button'))
      expect(documentKeys).not.toHaveBeenCalled() // a focused shell's own Escape (leave the task) would not fire

      await pressSend()
      expect(document.activeElement).toBe(screen.getByTestId('trade-request-guest-boundary'))
      await act(async () => { fireEvent.click(screen.getByTestId('trade-request-guest-cancel')) })
      expect(screen.queryByTestId('trade-request-guest-boundary')).toBeNull()
      expect(document.activeElement).toBe(screen.getByTestId('diaspora-submit-import-button'))
      expect(fx.api.createDiasporaImportOrder).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', documentKeys)
    }
  })

  it('"Sign in" writes the draft before leaving, then goes to sign-in with this flow as the return', async () => {
    await openRequest()
    fillEveryStep()
    await pressSend()
    sessionStorage.clear() // prove the click itself persists the latest answers
    await act(async () => { fireEvent.click(screen.getByTestId('trade-request-guest-sign-in')) })
    expect(screen.getByTestId('landed-on-sign-in')).toHaveTextContent(SIGN_IN_HREF)
    expect(storedDraft()).toMatchObject({ owner: 'guest', step: 4, form: { requested_model: 'Aqua' } })
    expect(fx.api.createDiasporaImportOrder).not.toHaveBeenCalled()
  })

  it('an incomplete draft is not offered to sign in: Send goes to the step that needs an answer', async () => {
    writeImportDraft({ ...FILLED, budget_amount: undefined }, 4, sessionStorage, 'guest')
    await openRequest()
    expect(screen.getByTestId('diaspora-import-form')).toHaveAttribute('data-step', 'review')
    await pressSend()
    expect(screen.getByTestId('diaspora-import-form')).toHaveAttribute('data-step', 'budget')
    expect(screen.getByTestId('diaspora-import-validation-error')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-request-guest-boundary')).toBeNull()
    expect(apiCalls()).toBe(0)
  })

  it('when this browser will not keep drafts, the boundary says the answers will have to be entered again', async () => {
    await openRequest()
    fillEveryStep()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError (fictional)') })
    await pressSend()
    expect(screen.getByTestId('trade-request-guest-not-kept')).toHaveTextContent('you would need to enter these answers again after signing in')
    expect(screen.queryByTestId('trade-request-guest-boundary-storage')).toBeNull()
    expect(fx.api.createDiasporaImportOrder).not.toHaveBeenCalled()
  })
})

describe('flags OFF: the legacy page, unchanged', () => {
  it('a guest is still sent to sign in, with the request as the return', async () => {
    fx.unified = false
    await openRequest()
    expect(screen.getByTestId('landed-on-sign-in')).toHaveTextContent(SIGN_IN_HREF)
    expect(screen.queryByTestId('diaspora-import-form')).toBeNull()
    expect(apiCalls()).toBe(0)
  })
})

describe('after signing in', () => {
  it('a guest draft opens on the review with the restored notice, and is sent only when the account presses Send', async () => {
    writeImportDraft(FILLED, 4, sessionStorage, 'guest')
    signInAs(BUYER)
    await openRequest()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) // nothing auto-submits
    expect(screen.getByTestId('trade-request-restored')).toHaveTextContent('We restored the draft you started before signing in — check it, then send.')
    expect(screen.getByTestId('diaspora-import-form')).toHaveAttribute('data-step', 'review')
    expect(screen.getByTestId('diaspora-new-import-route')).toHaveAttribute('data-visitor', 'account')
    expect(screen.getByTestId('trade-request-review')).toHaveTextContent('Toyota Aqua 2018')
    expect(screen.queryByTestId('trade-request-guest-draft')).toBeNull()
    expect(fx.api.createDiasporaImportOrder).not.toHaveBeenCalled()
    expect(storedDraft()).toMatchObject({ owner: 'fx-buyer' }) // the account now holds it

    await pressSend()
    expect(fx.api.createDiasporaImportOrder).toHaveBeenCalledTimes(1)
    expect(fx.api.createDiasporaImportOrder).toHaveBeenCalledWith(LEGACY_BODY)
    expect(await screen.findByTestId('landed-on-order')).toHaveTextContent('/diaspora/imports/fx-new-order')
    expect(sessionStorage.getItem(IMPORT_DRAFT_KEY)).toBeNull()
  })

  it('a create failure shows the error, keeps the draft and never shows success', async () => {
    fx.api.createDiasporaImportOrder.mockRejectedValueOnce(new Error('Request refused (fictional)'))
    writeImportDraft(FILLED, 4, sessionStorage, 'guest')
    signInAs(BUYER)
    await openRequest()
    await pressSend()
    expect(await screen.findByTestId('diaspora-import-form-error')).toHaveTextContent('Order not created. Request refused (fictional)')
    expect(screen.queryByTestId('landed-on-order')).toBeNull()
    expect(screen.getByTestId('diaspora-import-form')).toHaveAttribute('data-step', 'review')
    expect(screen.getByTestId('diaspora-submit-import-button')).toBeEnabled()
    expect(storedDraft()).toMatchObject({ owner: 'fx-buyer', step: 4, form: { requested_make: 'Toyota', budget_amount: 9000 } })
  })

  it('a draft owned by a different account is discarded, not shown', async () => {
    writeImportDraft(FILLED, 4, sessionStorage, 'fx-other-account')
    signInAs(BUYER)
    await openRequest()
    expect(screen.getByTestId('diaspora-import-form')).toHaveAttribute('data-step', 'cargo')
    expect(screen.queryByTestId('trade-request-restored')).toBeNull()
    expect(sessionStorage.getItem(IMPORT_DRAFT_KEY)).toBeNull()
    fireEvent.click(screen.getByTestId('trade-request-continue'))
    expect(screen.getByTestId('diaspora-make-input')).toHaveValue('')
  })

  it('an expired guest draft is discarded, not shown', async () => {
    writeImportDraft(FILLED, 4, sessionStorage, 'guest', Date.now() - 13 * 60 * 60 * 1000)
    signInAs(BUYER)
    await openRequest()
    expect(screen.getByTestId('diaspora-import-form')).toHaveAttribute('data-step', 'cargo')
    expect(screen.queryByTestId('trade-request-restored')).toBeNull()
    expect(sessionStorage.getItem(IMPORT_DRAFT_KEY)).toBeNull()
  })

  it('a guest never sees an account’s draft left in this tab', async () => {
    writeImportDraft(FILLED, 4, sessionStorage, 'fx-buyer')
    await openRequest()
    expect(screen.getByTestId('diaspora-import-form')).toHaveAttribute('data-step', 'cargo')
    expect(sessionStorage.getItem(IMPORT_DRAFT_KEY)).toBeNull()
  })
})
