/**
 * RX05-A — the correction request and private buyer feedback pages in the showroom presentation:
 * same requests, calm forms, and no state that overclaims (no "none" after a failed read, no rating
 * or verified purchase).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DealerResearchCorrection from '@/pages/DealerResearchCorrection'
import DealerBuyerFeedback from '@/pages/DealerBuyerFeedback'

type Call = { path: string; method: string; body?: unknown }
const fixture = vi.hoisted(() => ({
  showroom: true,
  signedIn: true,
  failFeedbackRead: false,
  calls: [] as Call[],
}))

vi.mock('@/lib/presentationFlags', () => ({ isShowroomPagesEnabled: () => fixture.showroom }))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => fixture.signedIn ? { user: { id: 'fictional-buyer', role: 'member' }, token: 'synthetic-session' } : { user: null, token: null },
}))
vi.mock('@/lib/apiClient', () => ({
  resolveApiBaseUrl: () => 'http://127.0.0.1:3001/api',
  apiRequest: async ({ path, options }: { path: string; options?: { method?: string; body?: string } }) => {
    const method = options?.method || 'GET'
    fixture.calls.push({ path, method, body: options?.body ? JSON.parse(options.body) : undefined })
    if (path.endsWith('/corrections')) return { receipt: { state: 'RECORDED' } }
    if (path === '/dealership/buyer-feedback/mine') {
      if (fixture.failFeedbackRead) throw new Error('Too many requests. Please try again later.')
      return {
        private_cases_only: true, public_ratings_activated: false,
        entries: [{ transaction_id: 'txn-fictional-1', seed_dealer_id: 'ZW-DEAL-0001', canonical_status: 'SANDBOX_RELEASED', can_submit_complaint: true, can_submit_review_candidate: false, verified_real_purchase: false, public_review_enabled: false }],
        cases: [],
      }
    }
    throw new Error('unexpected path ' + path)
  },
}))

beforeEach(() => {
  fixture.showroom = true
  fixture.signedIn = true
  fixture.failFeedbackRead = false
  fixture.calls = []
})

function renderCorrection(path = '/dealers/zw-deal-0002/correction') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/dealers/:seedId/correction" element={<DealerResearchCorrection />} /></Routes>
    </MemoryRouter>,
  )
}

describe('DealerResearchCorrection — showroom presentation', () => {
  it('sends the same private request and never asserts a publication change', async () => {
    renderCorrection()
    expect(screen.getByTestId('dealer-correction-showroom')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Correct or request removal of a researched listing' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Request category'), { target: { value: 'REMOVAL' } })
    fireEvent.change(screen.getByLabelText('Information requiring review'), { target: { value: 'This fictional listing should be removed for this test case only.' } })
    fireEvent.change(screen.getByLabelText('Contact email (optional, private)'), { target: { value: 'rep@example.invalid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit private review request' }))
    expect(await screen.findByTestId('dealer-correction-recorded')).toHaveTextContent('No publication change is asserted.')
    expect(fixture.calls).toEqual([{
      path: '/dealership/research/ZW-DEAL-0002/corrections', method: 'POST',
      body: { request_type: 'REMOVAL', request_summary: 'This fictional listing should be removed for this test case only.', contact_email: 'rep@example.invalid' },
    }])
  })

  it('refuses an invalid reference without a form', () => {
    renderCorrection('/dealers/not-a-dealer/correction')
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid dealership research reference.')
    expect(screen.queryByRole('button', { name: 'Submit private review request' })).toBeNull()
  })

  it('keeps the accepted form when the flag is OFF', () => {
    fixture.showroom = false
    renderCorrection()
    expect(screen.queryByTestId('dealer-correction-showroom')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Correct or request removal of a researched listing' })).toBeInTheDocument()
  })
})

function renderFeedback() {
  return render(<MemoryRouter><DealerBuyerFeedback /></MemoryRouter>)
}

describe('DealerBuyerFeedback — showroom presentation', () => {
  it('lets a signed-in buyer file a private complaint; a review candidate stays disabled when not allowed', async () => {
    renderFeedback()
    expect(await screen.findByRole('heading', { name: 'Submit a private case' })).toBeInTheDocument()
    expect(screen.getByTestId('dealer-feedback-showroom')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Unverified review candidate/ })).toBeDisabled()
    const submit = screen.getByRole('button', { name: 'Submit private buyer case' })
    expect(submit).toBeDisabled()
    expect(screen.getByText('No private cases have been submitted.')).toBeInTheDocument()
    expect(screen.queryByText(/★/)).toBeNull()
  })

  it('never says "no cases" after a failed read, and retries the same read', async () => {
    fixture.failFeedbackRead = true
    renderFeedback()
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests')
    expect(screen.queryByText('No private cases have been submitted.')).toBeNull()
    fixture.failFeedbackRead = false
    fireEvent.click(screen.getByTestId('dealer-feedback-retry'))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Submit a private case' })).toBeInTheDocument())
  })

  it('asks a guest to sign in', () => {
    fixture.signedIn = false
    renderFeedback()
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in to access only your own transaction-linked private cases.')
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })
})
