/**
 * RX03-P2-R5 REVIEW-01 — the claim workbench fails closed. Private case data (queue entries,
 * selected claim, evidence, signed preview, step-up password, confirmations, findings) is rendered
 * only while the CURRENT actor's latest authoritative queue read succeeded. Refusal, failure,
 * session expiry, actor change and late responses from a former actor all clear it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

type Auth = { user: { id: string; name: string; email: string; role: string; phone: string } | null; token: string | null }
let auth: Auth
const actor = (id: string, role = 'reviewer', token = 'tok-' + id): Auth => ({
  user: { id, name: 'Fictional ' + id, email: id + '@example.invalid', role, phone: '' }, token,
})
const queueOf = (...ids: string[]) => ({ claims: ids.map((id, i) => ({
  claim_id: 'c-' + id, seed_dealer_id: id, claimed_scope: 'BRANCH', claim_status: 'AWAITING_DOCUMENTARY_EVIDENCE', created_at: `2026-11-1${i}T10:00:00Z`,
})) })
const EVIDENCE = { evidence: [{ evidence_id: 'e-1', document_class: 'COMPANY_REGISTRATION', created_at: '2026-11-15T10:00:00Z', content_sha256: 'x', mime_type: 'image/png', file_bytes: 2048 }] }
const refused = (status: number) => Object.assign(new Error(status === 401 ? 'Session expired' : 'Forbidden'), { status })

/** Per-actor queue responders; evidence and preview answer for whoever asks. */
let queue: Record<string, () => Promise<unknown>> = {}
let previewFails = false
function apiMock() {
  return {
    apiRequest: async ({ path, authHeaders }: { path: string; authHeaders: Record<string, string> }) => {
      const who = authHeaders['x-user-id']
      if (path.endsWith('/claims/queue')) return queue[who]()
      if (path.endsWith('/preview') && previewFails) throw Object.assign(new Error('Unauthorized. No active user context.'), { name: 'SessionExpiredError' })
      if (path.endsWith('/preview')) return { preview: { signed_url: 'https://signed.example.invalid/' + who, expires_seconds: 60 } }
      return EVIDENCE
    },
    resolveApiBaseUrl: () => '/api',
  }
}
async function load() {
  vi.resetModules()
  vi.doMock('@/context/AuthContext', () => ({ useAuth: () => ({ ...auth, isAuthenticated: !!auth.user, loading: false, login: () => {}, logout: () => {} }) }))
  vi.doMock('@/lib/apiClient', apiMock)
  const Page = (await import('./DealerClaimReview')).default
  const { ReviewWorkbenchContext } = await import('@/components/dealer/reviewWorkbenchContext')
  const view = (workbench: boolean) => (
    <MemoryRouter>{workbench ? <ReviewWorkbenchContext.Provider value={true}><Page /></ReviewWorkbenchContext.Provider> : <Page />}</MemoryRouter>
  )
  return { view }
}
afterEach(() => { vi.doUnmock('@/context/AuthContext'); vi.doUnmock('@/lib/apiClient'); queue = {}; previewFails = false })

/** Nothing private from `dealers` may be anywhere in the document, and no consequential control. */
function expectNoPrivateCase(dealers: string[]) {
  for (const d of dealers) expect(screen.queryAllByText(d, { exact: false })).toHaveLength(0)
  expect(screen.queryByTestId('claim-case-identity')).toBeNull()
  expect(screen.queryByTestId('claim-decision')).toBeNull()
  expect(screen.queryByText('COMPANY REGISTRATION')).toBeNull()
  expect(document.getElementById('claim-reviewer-password')).toBeNull()
  expect(screen.queryByRole('button', { name: /Record immutable review decision|View selected original securely/ })).toBeNull()
  expect(screen.queryByRole('link', { name: /Open private original/ })).toBeNull()
}

describe.each([['workbench', true], ['legacy (flags OFF)', false]])('REVIEW-01 — %s', (_label, workbench) => {
  it('1 · a successful queue that is then REFUSED (403) leaves no list, case, evidence or decision behind', async () => {
    auth = actor('A')
    let call = 0
    queue.A = async () => (++call === 1 ? queueOf('ZW-DEAL-0002', 'ZW-DEAL-0001') : Promise.reject(refused(403)))
    const { view } = await load()
    render(view(workbench))
    expect(await screen.findAllByText('COMPANY REGISTRATION', { exact: false })).not.toHaveLength(0)
    await userEvent.click(screen.getAllByRole('button', { name: 'Refresh queue' })[0])
    expect(await screen.findByTestId('claim-queue-unavailable')).toHaveTextContent('not allowed')
    expectNoPrivateCase(['ZW-DEAL-0002', 'ZW-DEAL-0001'])
  })

  it('2 · a FAILED refresh (500) is an unavailable queue — not stale contents, not an empty queue', async () => {
    auth = actor('A')
    let call = 0
    queue.A = async () => (++call === 1 ? queueOf('ZW-DEAL-0002') : Promise.reject(refused(500)))
    const { view } = await load()
    render(view(workbench))
    expect(await screen.findAllByText('ZW-DEAL-0002')).not.toHaveLength(0)
    await userEvent.click(screen.getAllByRole('button', { name: 'Refresh queue' })[0])
    expect(await screen.findByTestId('claim-queue-unavailable')).toHaveTextContent('could not be loaded')
    expect(screen.queryByText('No pending/recorded claims in this queue.')).toBeNull()
    expectNoPrivateCase(['ZW-DEAL-0002'])
  })

  it('3 · reviewer A → reviewer B: A\'s selection, evidence and typed step-up never appear for B', async () => {
    auth = actor('A')
    queue.A = async () => queueOf('A-PRIVATE-DEALER')
    queue.B = async () => queueOf('B-DEALER')
    const { view } = await load()
    const r = render(view(workbench))
    expect(await screen.findAllByText('COMPANY REGISTRATION', { exact: false })).not.toHaveLength(0)
    await userEvent.type(document.getElementById('claim-reviewer-password')!, 'a-secret')
    auth = actor('B')
    r.rerender(view(workbench))
    expectNoPrivateCase(['A-PRIVATE-DEALER'])
    expect(await screen.findAllByText('B-DEALER')).not.toHaveLength(0)
    expect((document.getElementById('claim-reviewer-password') as HTMLInputElement | null)?.value ?? '').toBe('')
  })

  it('4 · session EXPIRY (401) while an original is open: no preview link, no step-up, no decision', async () => {
    auth = actor('A')
    let call = 0
    queue.A = async () => (++call === 1 ? queueOf('ZW-DEAL-0002') : Promise.reject(refused(401)))
    const { view } = await load()
    render(view(workbench))
    expect(await screen.findAllByText('COMPANY REGISTRATION', { exact: false })).not.toHaveLength(0)
    await userEvent.type(document.getElementById('claim-reviewer-password')!, 'pw')
    await userEvent.click(screen.getByRole('button', { name: 'View selected original securely' }))
    expect(await screen.findByRole('link', { name: /Open private original/ })).toBeInTheDocument()
    await userEvent.type(document.getElementById('claim-reviewer-password')!, 'pw-again')
    await userEvent.click(screen.getAllByRole('button', { name: 'Refresh queue' })[0])
    expect(await screen.findByTestId('claim-queue-unavailable')).toBeInTheDocument()
    expectNoPrivateCase(['ZW-DEAL-0002'])
  })

  it('5 · a LATE queue response from the former actor is ignored', async () => {
    auth = actor('A')
    let releaseA: (v: unknown) => void = () => {}
    queue.A = () => new Promise(res => { releaseA = res })
    queue.B = async () => queueOf('B-DEALER')
    const { view } = await load()
    const r = render(view(workbench))
    await waitFor(() => expect(typeof releaseA).toBe('function'))
    auth = actor('B')
    r.rerender(view(workbench))
    expect(await screen.findAllByText('B-DEALER')).not.toHaveLength(0)
    await act(async () => { releaseA(queueOf('A-LATE-DEALER')) })
    expect(screen.queryAllByText('A-LATE-DEALER')).toHaveLength(0)
    expect(screen.getAllByText('B-DEALER').length).toBeGreaterThan(0)
  })

  it('6 · an authorised retry after a refusal restores the CURRENT queue and its actions', async () => {
    auth = actor('A')
    let call = 0
    queue.A = async () => (++call === 2 ? Promise.reject(refused(403)) : queueOf('ZW-DEAL-0003'))
    const { view } = await load()
    render(view(workbench))
    expect(await screen.findAllByText('ZW-DEAL-0003')).not.toHaveLength(0)
    await userEvent.click(screen.getAllByRole('button', { name: 'Refresh queue' })[0])
    expect(await screen.findByTestId('claim-queue-unavailable')).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: /Refresh queue|Try again/ })[0])
    await waitFor(() => expect(screen.queryByTestId('claim-queue-unavailable')).toBeNull())
    expect(await screen.findAllByText('COMPANY REGISTRATION', { exact: false })).not.toHaveLength(0)
    const pw = document.getElementById('claim-reviewer-password') as HTMLInputElement
    expect(pw.value).toBe('')
    expect(screen.getByRole('button', { name: 'Record immutable review decision' })).toBeDisabled()
    if (workbench) expect(within(screen.getByTestId('claim-queue')).getByText('ZW-DEAL-0003')).toBeInTheDocument()
  })

  it('7 · a session that EXPIRES during a consequential action (signed preview) clears the case and every input', async () => {
    auth = actor('A')
    queue.A = async () => queueOf('ZW-DEAL-0002')
    previewFails = true
    const { view } = await load()
    render(view(workbench))
    expect(await screen.findAllByText('COMPANY REGISTRATION', { exact: false })).not.toHaveLength(0)
    await userEvent.type(document.getElementById('claim-reviewer-password')!, 'pw')
    await userEvent.click(screen.getByRole('button', { name: 'View selected original securely' }))
    expect(await screen.findByTestId('claim-queue-unavailable')).toHaveTextContent('session is no longer valid')
    expectNoPrivateCase(['ZW-DEAL-0002'])
  })
})
