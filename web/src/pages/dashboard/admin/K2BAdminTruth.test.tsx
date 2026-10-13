/**
 * PC01-K2B — Admin truth on the page: operational records only, what was set aside is stated,
 * a failed read is never an empty list, and account suspension is not offered while the product
 * has no governed authority for it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

let api: Record<string, unknown> = {}
const hook = new Proxy({} as Record<string, unknown>, {
  get: (_t, key: string) => (key in api ? api[key] : (api[key] = vi.fn().mockResolvedValue([]))),
})
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => hook }))

const UserManagement = (await import('./UserManagement')).default
const FraudQueue = (await import('./FraudQueue')).default
const EvidenceReview = (await import('./EvidenceReview')).default
const MarketplaceModeration = (await import('./MarketplaceModeration')).default

const provenance = { raw: 319, operational: 2, excluded_non_operational: 300, unknown_requires_review: 17, by_class: { uat: 120, ci_automation: 180 }, view: 'operational_only' as const }

beforeEach(() => { api = {} })

describe('Users', () => {
  it('a failed read is stated, never rendered as an empty directory', async () => {
    api.fetchUsers = vi.fn().mockRejectedValue(new Error('HTTP 500'))
    render(<MemoryRouter><UserManagement /></MemoryRouter>)
    expect(await screen.findByTestId('read-failed-notice')).toHaveTextContent('Users could not be loaded. This is not an empty list')
    expect(screen.queryByText('No users found.')).toBeNull()
    expect(screen.queryByText('No operational users.')).toBeNull()
  })

  it('lists operational users and states how many test / certification accounts were excluded', async () => {
    api.fetchUsers = vi.fn().mockResolvedValue({
      users: [{ id: 'u_66cace85aa', name: 'Serena Owner', email: 's•••@example', role: 'owner', created_at: '2026-09-01T00:00:00Z' }],
      provenance,
    })
    render(<MemoryRouter><UserManagement /></MemoryRouter>)
    expect(await screen.findByText('Serena Owner')).toBeInTheDocument()
    const notice = screen.getByTestId('provenance-notice')
    expect(notice).toHaveTextContent('Test / certification data excluded: 300')
    expect(notice).toHaveTextContent('Needs review (not counted): 17')
  })

  it('account suspension is not offered — it is named as unavailable and cannot be activated', async () => {
    api.fetchUsers = vi.fn().mockResolvedValue({ users: [{ id: 'u_66cace85aa', name: 'Serena Owner', email: 'x', role: 'owner' }], provenance: null })
    render(<MemoryRouter><UserManagement /></MemoryRouter>)
    await userEvent.click(await screen.findByTestId('user-actions-u_66cace85aa'))
    const item = await screen.findByTestId('suspension-unavailable-u_66cace85aa')
    expect(item).toHaveTextContent('Account suspension — not available yet')
    expect(item).toHaveAttribute('data-disabled')
    expect(screen.queryByRole('menuitem', { name: /^suspend user$/i })).toBeNull()
    expect('suspendUser' in api).toBe(false)
  })
})

describe('Fraud queue', () => {
  it('shows investigating cases alongside open ones (no status filter is sent)', async () => {
    api.fetchFraudCases = vi.fn().mockResolvedValue({
      cases: [
        { id: 'c-open', vin: 'JTDBR32E720012345', status: 'open', highest_severity: 'high', open_signal_count: 1, blocks_publication: false, created_at: '2026-10-01T00:00:00Z' },
        { id: 'c-inv', vin: 'JTDBR32E720067890', status: 'investigating', highest_severity: 'critical', open_signal_count: 2, blocks_publication: true, created_at: '2026-10-02T00:00:00Z' },
      ],
      provenance: { raw: 5, operational: 2, excluded_non_operational: 3, unknown_requires_review: 0 },
    })
    render(<FraudQueue />)
    expect(await screen.findAllByTestId('fraud-case-card')).toHaveLength(2)
    expect(screen.getByText(/VIN JTDBR32E720067890/)).toBeInTheDocument()
    expect(api.fetchFraudCases).toHaveBeenCalledWith()
    expect(screen.getByTestId('provenance-notice')).toHaveTextContent('Test / certification data excluded: 3')
  })

  it('a failed read is not "no cases"', async () => {
    api.fetchFraudCases = vi.fn().mockRejectedValue(new Error('HTTP 500'))
    render(<FraudQueue />)
    expect(await screen.findByTestId('read-failed-notice')).toHaveTextContent('Fraud cases could not be loaded')
    expect(screen.queryByText(/No open or investigating fraud cases/)).toBeNull()
  })
})

describe('Evidence review', () => {
  const row = (id: string) => ({
    id, vin: 'JTDBR32E720012345', evidence_type: 'damage_photo', file_url: null, verification_status: 'pending', uploader_role: 'owner',
    uploaded_at: '2026-10-04T00:00:00Z', event_type: 'inspection', checksum: null, trust_score_impact: 0, linked_registry_event_id: null, metadata: {},
  })

  it('states the true total and the page shown — never "the first 100" as everything', async () => {
    api.fetchEvidenceReviewQueue = vi.fn().mockImplementation(async (_status: string, page: number) => (page === 1
      ? { items: Array.from({ length: 50 }, (_, i) => row(`e${i}`)), page: 1, page_size: 50, total: 60, has_more: true, provenance: { raw: 130, operational: 60, excluded_non_operational: 50, unknown_requires_review: 20 } }
      : { items: Array.from({ length: 10 }, (_, i) => row(`f${i}`)), page: 2, page_size: 50, total: 60, has_more: false, provenance: { raw: 130, operational: 60, excluded_non_operational: 50, unknown_requires_review: 20 } }))
    render(<MemoryRouter><EvidenceReview /></MemoryRouter>)
    const range = await screen.findByTestId('evidence-page-range')
    expect(range).toHaveTextContent('Showing 1–50 of 60')
    expect(screen.getByTestId('provenance-notice')).toHaveTextContent('Test / certification data excluded: 50')
    expect(screen.getByTestId('provenance-notice')).toHaveTextContent('Needs review (not counted): 20')
    await userEvent.click(within(range).getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByTestId('evidence-page-range')).toHaveTextContent('Showing 51–60 of 60'))
    expect(api.fetchEvidenceReviewQueue).toHaveBeenLastCalledWith('pending', 2, 50)
  })

  it('a failed read clears the queue and says so', async () => {
    api.fetchEvidenceReviewQueue = vi.fn().mockRejectedValue(new Error('HTTP 500'))
    render(<MemoryRouter><EvidenceReview /></MemoryRouter>)
    expect(await screen.findByTestId('read-failed-notice')).toHaveTextContent(/could not be loaded/)
    expect(screen.queryByTestId('evidence-page-range')).toBeNull()
  })

  it('an unreadable response is a failure, not an empty queue', async () => {
    api.fetchEvidenceReviewQueue = vi.fn().mockResolvedValue([row('legacy')])
    render(<MemoryRouter><EvidenceReview /></MemoryRouter>)
    expect(await screen.findByTestId('read-failed-notice')).toHaveTextContent(/unreadable response/)
  })
})

describe('Marketplace moderation', () => {
  const listing = { vin: 'GFC27027051', make: 'Nissan', model: 'Serena', year: 2018, price: 9000, currency: 'USD', trust_score: 70, public_status: 'public', risk_status: 'clear' }

  it('stat cards equal the operational queue, and set-aside listings are stated', async () => {
    api.fetchAdminMarketplaceListings = vi.fn().mockResolvedValue({ listings: [listing], total: 1, provenance: { raw: 364, operational: 1, excluded_non_operational: 361, unknown_requires_review: 2 } })
    api.fetchMarketplaceAnalytics = vi.fn().mockResolvedValue({ listings: { total: 1, public: 1, suppressed: 0, rejected: 0 }, inquiries: { available: true, total: 0 } })
    api.fetchAdminMarketplaceInquiries = vi.fn().mockResolvedValue({ inquiries: [], provenance: null })
    render(<MemoryRouter><MarketplaceModeration /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('stat-total')).toHaveTextContent('1'))
    expect(screen.getAllByTestId('provenance-notice')[0]).toHaveTextContent('Test / certification data excluded: 361')
  })

  it('unavailable analytics and inquiries show "—", never 0', async () => {
    api.fetchAdminMarketplaceListings = vi.fn().mockResolvedValue({ listings: [listing], total: 1, provenance: null })
    api.fetchMarketplaceAnalytics = vi.fn().mockResolvedValue({ listings: { total: 1, public: 1, suppressed: 0, rejected: 0 }, inquiries: { available: false, total: null } })
    api.fetchAdminMarketplaceInquiries = vi.fn().mockResolvedValue({ inquiries: [], provenance: null })
    render(<MemoryRouter><MarketplaceModeration /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('stat-inquiries')).toHaveTextContent('—'))
    expect(screen.getByTestId('stat-inquiries')).not.toHaveTextContent('0')
  })

  it('an analytics failure is stated and the cards do not fall back to a number', async () => {
    api.fetchAdminMarketplaceListings = vi.fn().mockResolvedValue({ listings: [listing], total: 1, provenance: null })
    api.fetchMarketplaceAnalytics = vi.fn().mockRejectedValue(new Error('HTTP 500'))
    api.fetchAdminMarketplaceInquiries = vi.fn().mockResolvedValue({ inquiries: [], provenance: null })
    render(<MemoryRouter><MarketplaceModeration /></MemoryRouter>)
    expect(await screen.findByText(/Marketplace analytics could not be loaded/)).toBeInTheDocument()
    expect(screen.getByTestId('stat-total')).toHaveTextContent('—')
  })

  it('a listings failure is not "No operational listings"', async () => {
    api.fetchAdminMarketplaceListings = vi.fn().mockRejectedValue(new Error('HTTP 500'))
    api.fetchMarketplaceAnalytics = vi.fn().mockResolvedValue({ listings: { total: 1, public: 1, suppressed: 0, rejected: 0 }, inquiries: { available: true, total: 0 } })
    api.fetchAdminMarketplaceInquiries = vi.fn().mockResolvedValue({ inquiries: [], provenance: null })
    render(<MemoryRouter><MarketplaceModeration /></MemoryRouter>)
    expect(await screen.findByText(/Listings could not be loaded/)).toBeInTheDocument()
    expect(screen.queryByText(/No operational listings/)).toBeNull()
  })
})
