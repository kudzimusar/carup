import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Issue #128 Fix A — /diaspora/trade-profile request lifecycle.
 *
 * The page used to hold the aggregate object returned by useCarUpApi(). That hook returns a NEW
 * object every render AND owns loading/error state, so each request re-rendered the page, changed
 * the `api` identity, recreated loadOwn/loadQueue and re-fired their effects — an unbounded
 * /trade-profiles/me loop that only stopped when the global limiter returned 429.
 *
 * These tests assert REQUEST COUNTS (not just rendered text), which is what actually proves the
 * loop is gone.
 */

const fetchOwnDiasporaTradeProfiles = vi.fn()
const listDiasporaTradeProfiles = vi.fn()
const updateDiasporaTradeProfile = vi.fn()
const createDiasporaTradeProfile = vi.fn()
const submitDiasporaTradeProfileForReview = vi.fn()
const verifyDiasporaTradeProfile = vi.fn()
const suspendDiasporaTradeProfile = vi.fn()

let authUser: { id: string; name: string; role: string } = { id: 'u-1', name: 'Fresh Owner', role: 'owner' }

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: authUser, isAuthenticated: true, loading: false }),
}))

// Reproduces the real hook's hazard: a fresh object literal on every render. If the page held this
// aggregate (or derived its effect deps from it), the effects would re-fire on every state change.
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchOwnDiasporaTradeProfiles,
    listDiasporaTradeProfiles,
    updateDiasporaTradeProfile,
    createDiasporaTradeProfile,
    submitDiasporaTradeProfileForReview,
    verifyDiasporaTradeProfile,
    suspendDiasporaTradeProfile,
  }),
}))

const DiasporaTradeProfile = (await import('./DiasporaTradeProfile')).default

const PROFILE = {
  id: 'p-1',
  role_type: 'buyer',
  country: 'Zimbabwe',
  city: 'Harare',
  verification_status: 'PENDING_REVIEW',
  updated_at: '2026-07-27T10:00:00.000Z',
}

function renderPage(strict = false) {
  const tree = <MemoryRouter><DiasporaTradeProfile /></MemoryRouter>
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

function rateLimitError() {
  const err = new Error('HTTP error! status: 429') as Error & { status?: number }
  err.status = 429
  return err
}

beforeEach(() => {
  vi.clearAllMocks()
  authUser = { id: 'u-1', name: 'Fresh Owner', role: 'owner' }
  fetchOwnDiasporaTradeProfiles.mockResolvedValue([PROFILE])
  listDiasporaTradeProfiles.mockResolvedValue([])
  updateDiasporaTradeProfile.mockResolvedValue(PROFILE)
  createDiasporaTradeProfile.mockResolvedValue(PROFILE)
})

describe('DiasporaTradeProfile request lifecycle (issue #128 Fix A)', () => {
  it('performs exactly one own-profile request on initial mount', async () => {
    renderPage()
    await screen.findByTestId('diaspora-trade-profile-own-list')
    expect(fetchOwnDiasporaTradeProfiles).toHaveBeenCalledTimes(1)
  })

  it('does not loop: the request count stays at one across settle time and re-renders', async () => {
    const { rerender } = renderPage()
    await screen.findByTestId('diaspora-trade-profile-own-list')

    // Re-render the page repeatedly — the historical bug re-fired the effect on every render.
    for (let i = 0; i < 5; i += 1) {
      rerender(<MemoryRouter><DiasporaTradeProfile /></MemoryRouter>)
    }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })

    expect(fetchOwnDiasporaTradeProfiles).toHaveBeenCalledTimes(1)
  })

  it('does not create an uncontrolled loop under StrictMode double-invoked effects', async () => {
    renderPage(true)
    await screen.findByTestId('diaspora-trade-profile-own-list')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })

    // StrictMode intentionally double-invokes effects; the single-flight guard collapses the
    // duplicate into the in-flight request, so this is bounded (never the unbounded loop).
    expect(fetchOwnDiasporaTradeProfiles.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('keeps the reviewer queue request stable (one call, no loop)', async () => {
    authUser = { id: 'admin-1', name: 'Reviewer', role: 'admin' }
    listDiasporaTradeProfiles.mockResolvedValue([])
    renderPage()
    await screen.findByTestId('diaspora-trade-profile-queue-empty')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })

    expect(listDiasporaTradeProfiles).toHaveBeenCalledTimes(1)
  })

  it('suppresses overlapping duplicate loads while a request is in flight', async () => {
    let release: (value: unknown) => void = () => {}
    fetchOwnDiasporaTradeProfiles.mockImplementation(
      () => new Promise(resolve => { release = resolve })
    )
    const { rerender } = renderPage()
    // While the first request is unresolved, force more renders that would re-enter the loader.
    for (let i = 0; i < 3; i += 1) {
      rerender(<MemoryRouter><DiasporaTradeProfile /></MemoryRouter>)
    }
    expect(fetchOwnDiasporaTradeProfiles).toHaveBeenCalledTimes(1)
    await act(async () => { release([PROFILE]) })
    expect(fetchOwnDiasporaTradeProfiles).toHaveBeenCalledTimes(1)
  })

  it('on 429: stops loading, shows a truthful rate-limit state, and never auto-retries', async () => {
    fetchOwnDiasporaTradeProfiles.mockRejectedValue(rateLimitError())
    renderPage()

    const panel = await screen.findByTestId('diaspora-trade-profile-rate-limited')
    expect(panel.textContent).toMatch(/Too many requests/i)
    expect(panel.textContent).toMatch(/wait/i)
    expect(screen.queryByText('Loading…')).toBeNull()

    // The decisive assertion: no background retry loop after the 429.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)) })
    expect(fetchOwnDiasporaTradeProfiles).toHaveBeenCalledTimes(1)
  })

  it('manual retry after a 429 issues exactly one new request', async () => {
    fetchOwnDiasporaTradeProfiles.mockRejectedValueOnce(rateLimitError())
    renderPage()
    await screen.findByTestId('diaspora-trade-profile-rate-limited')
    expect(fetchOwnDiasporaTradeProfiles).toHaveBeenCalledTimes(1)

    fetchOwnDiasporaTradeProfiles.mockResolvedValue([PROFILE])
    await act(async () => { fireEvent.click(screen.getByTestId('diaspora-trade-profile-retry')) })

    await screen.findByTestId('diaspora-trade-profile-own-list')
    expect(fetchOwnDiasporaTradeProfiles).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('diaspora-trade-profile-rate-limited')).toBeNull()
  })

  it('a non-429 load failure also leaves loading and exposes a manual retry', async () => {
    fetchOwnDiasporaTradeProfiles.mockRejectedValueOnce(new Error('Network down'))
    renderPage()

    const alert = await screen.findByTestId('diaspora-trade-profile-load-error')
    expect(alert.textContent).toContain('Network down')
    expect(screen.queryByText('Loading…')).toBeNull()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)) })
    expect(fetchOwnDiasporaTradeProfiles).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('diaspora-trade-profile-retry')).toBeTruthy()
  })

  it('editing performs exactly one PATCH plus one authoritative refresh', async () => {
    renderPage()
    await screen.findByTestId('diaspora-trade-profile-own-list')
    expect(fetchOwnDiasporaTradeProfiles).toHaveBeenCalledTimes(1)

    await act(async () => { fireEvent.click(screen.getByTestId('diaspora-trade-profile-edit')) })
    await act(async () => { fireEvent.click(screen.getByTestId('diaspora-trade-profile-submit')) })

    await waitFor(() => expect(screen.getByTestId('diaspora-trade-profile-result')).toBeTruthy())
    expect(updateDiasporaTradeProfile).toHaveBeenCalledTimes(1)
    // One controlled refresh after the write — not a re-triggered effect loop.
    expect(fetchOwnDiasporaTradeProfiles).toHaveBeenCalledTimes(2)
  })

  it('preserves optimistic concurrency: the PATCH carries expected_updated_at', async () => {
    renderPage()
    await screen.findByTestId('diaspora-trade-profile-own-list')
    await act(async () => { fireEvent.click(screen.getByTestId('diaspora-trade-profile-edit')) })
    await act(async () => { fireEvent.click(screen.getByTestId('diaspora-trade-profile-submit')) })

    await waitFor(() => expect(updateDiasporaTradeProfile).toHaveBeenCalled())
    expect(updateDiasporaTradeProfile.mock.calls[0][0]).toBe('p-1')
    expect(updateDiasporaTradeProfile.mock.calls[0][1]).toMatchObject({
      expected_updated_at: '2026-07-27T10:00:00.000Z',
    })
  })

  it('rapid double-save cannot duplicate the PATCH', async () => {
    let release: (value: unknown) => void = () => {}
    updateDiasporaTradeProfile.mockImplementation(() => new Promise(resolve => { release = resolve }))

    renderPage()
    await screen.findByTestId('diaspora-trade-profile-own-list')
    await act(async () => { fireEvent.click(screen.getByTestId('diaspora-trade-profile-edit')) })

    const submit = screen.getByTestId('diaspora-trade-profile-submit')
    await act(async () => {
      fireEvent.click(submit)
      fireEvent.click(submit)
      fireEvent.click(submit)
    })

    expect(updateDiasporaTradeProfile).toHaveBeenCalledTimes(1)
    await act(async () => { release(PROFILE) })
    expect(updateDiasporaTradeProfile).toHaveBeenCalledTimes(1)
  })

  it('creating a profile issues one POST and one refresh', async () => {
    fetchOwnDiasporaTradeProfiles.mockResolvedValue([])
    renderPage()
    await screen.findByTestId('diaspora-trade-profile-empty')

    fireEvent.change(screen.getByTestId('diaspora-trade-profile-country'), { target: { value: 'Zimbabwe' } })
    fireEvent.change(screen.getByTestId('diaspora-trade-profile-city'), { target: { value: 'Harare' } })
    await act(async () => { fireEvent.click(screen.getByTestId('diaspora-trade-profile-submit')) })

    await waitFor(() => expect(createDiasporaTradeProfile).toHaveBeenCalledTimes(1))
    expect(fetchOwnDiasporaTradeProfiles).toHaveBeenCalledTimes(2)
    // Identity/tenant and verification status stay server-controlled: the client never sends them.
    const payload = createDiasporaTradeProfile.mock.calls[0][0]
    expect(payload).not.toHaveProperty('verification_status')
    expect(payload).not.toHaveProperty('user_id')
    expect(payload).not.toHaveProperty('tenant_id')
    expect(payload).not.toHaveProperty('trust_score')
  })
})
