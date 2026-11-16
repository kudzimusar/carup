/**
 * RX03-P2-R4 — claim review: honest queue states, no inaccessible /admin link for a reviewer, and
 * the queue → case → evidence → decision workbench composition inside the ReviewWorkbench.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

function auth(role: string) {
  return {
    useAuth: () => ({
      user: { id: 'r1', name: 'Fictional Reviewer', email: 'r@example.invalid', role, phone: '' },
      token: 'tok', isAuthenticated: true, loading: false, login: () => {}, logout: () => {},
    }),
  }
}
const QUEUE = { claims: [
  { claim_id: 'c-1', seed_dealer_id: 'ZW-DEAL-0002', claimed_scope: 'BRANCH', claim_status: 'AWAITING_DOCUMENTARY_EVIDENCE', created_at: '2026-11-15T10:00:00Z' },
  { claim_id: 'c-2', seed_dealer_id: 'ZW-DEAL-0001', claimed_scope: 'BRANCH', claim_status: 'CLAIM_APPROVED', created_at: '2026-11-14T10:00:00Z' },
] }
function api(queue: () => Promise<unknown>) {
  return {
    apiRequest: async ({ path }: { path: string }) => {
      if (path.endsWith('/claims/queue')) return queue()
      return { evidence: [{ evidence_id: 'e-1', document_class: 'COMPANY_REGISTRATION', created_at: '2026-11-15T10:00:00Z', content_sha256: 'x', mime_type: 'application/pdf', file_bytes: 2048 }] }
    },
    resolveApiBaseUrl: () => '/api',
  }
}
async function load(role: string, queue: () => Promise<unknown>) {
  vi.resetModules()
  vi.doMock('@/context/AuthContext', () => auth(role))
  vi.doMock('@/lib/apiClient', () => api(queue))
  const page = (await import('./DealerClaimReview')).default
  const ctx = await import('@/components/dealer/reviewWorkbenchContext')
  return { Page: page, ReviewWorkbenchContext: ctx.ReviewWorkbenchContext }
}
afterEach(() => { vi.doUnmock('@/context/AuthContext'); vi.doUnmock('@/lib/apiClient') })

describe('legacy composition (flags OFF)', () => {
  it('a reviewer is never linked to the administrators-only /admin dashboard', async () => {
    const { Page } = await load('reviewer', async () => QUEUE)
    render(<MemoryRouter><Page /></MemoryRouter>)
    expect(await screen.findAllByText('ZW-DEAL-0002')).not.toHaveLength(0)
    expect(screen.queryByRole('link', { name: 'Admin dashboard' })).toBeNull()
  })
  it('an administrator still gets the Admin dashboard link', async () => {
    const { Page } = await load('admin', async () => QUEUE)
    render(<MemoryRouter><Page /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Admin dashboard' })).toHaveAttribute('href', '/admin')
  })
  it('a refused queue read is NOT presented as an empty queue', async () => {
    const { Page } = await load('reviewer', async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }) })
    render(<MemoryRouter><Page /></MemoryRouter>)
    expect(await screen.findByTestId('claim-queue-unavailable')).toHaveTextContent('This is not an empty queue')
    expect(screen.queryByText('No pending/recorded claims in this queue.')).toBeNull()
  })
})

describe('ReviewWorkbench composition (unified)', () => {
  it('queue → selected case → evidence → step-up and decision, with no sibling links or nested <main>', async () => {
    const { Page, ReviewWorkbenchContext } = await load('reviewer', async () => QUEUE)
    const { container } = render(
      <MemoryRouter><ReviewWorkbenchContext.Provider value={true}><Page /></ReviewWorkbenchContext.Provider></MemoryRouter>,
    )
    const queue = await screen.findByTestId('claim-queue')
    expect(within(queue).getByText('ZW-DEAL-0002')).toBeInTheDocument()
    expect(within(queue).getByText(/Queue/)).toHaveTextContent('· 2')
    expect(screen.getByTestId('claim-case-identity')).toHaveTextContent('ZW-DEAL-0002')
    expect(await screen.findByText('COMPANY REGISTRATION')).toBeInTheDocument()
    const decision = screen.getByTestId('claim-decision')
    expect(within(decision).getByLabelText('Re-enter your own CarUp account password')).toBeInTheDocument()
    expect(within(decision).getByRole('button', { name: 'Record immutable review decision' })).toBeDisabled()
    expect(container.querySelector('main')).toBeNull()
    expect(screen.queryByRole('link', { name: /Admin dashboard|Review the 104/ })).toBeNull()
    await userEvent.click(within(queue).getByText('ZW-DEAL-0001'))
    expect(screen.getByTestId('claim-case-identity')).toHaveTextContent('ZW-DEAL-0001')
  })
  it('a failed queue read says so inside the workbench queue', async () => {
    const { Page, ReviewWorkbenchContext } = await load('reviewer', async () => { throw Object.assign(new Error('down'), { status: 503 }) })
    render(<MemoryRouter><ReviewWorkbenchContext.Provider value={true}><Page /></ReviewWorkbenchContext.Provider></MemoryRouter>)
    expect(await screen.findByTestId('claim-queue-unavailable')).toHaveTextContent('could not be loaded')
  })
})
