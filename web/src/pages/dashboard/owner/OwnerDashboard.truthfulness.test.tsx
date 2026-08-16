import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Issue #128 Fix B — the Owner Dashboard must never present prototype values as this user's
 * authoritative account state. A fresh owner account (no vehicles, no escrows, no notifications)
 * previously saw a hardcoded USD balance, a hardcoded ZiG balance, a fixed trust percentage, a
 * "verified" status label, seeded sample documents and a fabricated valuation trend.
 */

const fetchSafePayEscrows = vi.fn()
const fetchOwnedVehicles = vi.fn()
const fetchCommunicationNotifications = vi.fn()
const fetchSavedMarketplaceListings = vi.fn()
const fetchCommunicationThreads = vi.fn()
const runOcrParsing = vi.fn()

// Capture every toast so a fabricated "document uploaded/parsed" success cannot slip back in.
const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'fresh-owner-1', name: 'Fresh Owner', email: 'fresh@staging.carup.local', role: 'owner' },
    isAuthenticated: true,
  }),
}))

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    runOcrParsing,
    fetchSafePayEscrows,
    fetchOwnedVehicles,
    fetchCommunicationNotifications,
    fetchSavedMarketplaceListings,
    fetchCommunicationThreads,
  }),
}))

const OwnerDashboard = (await import('./OwnerDashboard')).default
const SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'OwnerDashboard.tsx'), 'utf8')

// Values the owner saw during the 2026-07-27 UAT that were not their data.
const FORBIDDEN_RENDERED = ['$350', '350.00', '4,800 ZiG', '4800', '92.5%', 'Verified Buyer & Seller']
const FORBIDDEN_DOCUMENTS = ['ZIMRA Customs Cleared Form 21.pdf', 'NicozDiamond Policy.pdf']

function renderFreshDashboard() {
  return render(<MemoryRouter><OwnerDashboard /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  // A brand-new account: every authoritative source is legitimately empty.
  fetchSafePayEscrows.mockResolvedValue([])
  fetchOwnedVehicles.mockResolvedValue([])
  fetchCommunicationNotifications.mockResolvedValue({ notifications: [] })
  fetchSavedMarketplaceListings.mockResolvedValue({ listings: [] })
  fetchCommunicationThreads.mockResolvedValue({ threads: [] })
})

describe('OwnerDashboard truthfulness for a fresh account (issue #128 Fix B)', () => {
  it('shows none of the prototype wallet/trust values', async () => {
    const { container } = renderFreshDashboard()
    await waitFor(() => expect(fetchSafePayEscrows).toHaveBeenCalled())

    const text = container.textContent || ''
    for (const forbidden of FORBIDDEN_RENDERED) {
      expect(text, `rendered dashboard must not contain ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('shows no sample documents and renders a truthful empty vault', async () => {
    const { container } = renderFreshDashboard()
    await waitFor(() => expect(fetchOwnedVehicles).toHaveBeenCalled())

    const text = container.textContent || ''
    for (const doc of FORBIDDEN_DOCUMENTS) {
      expect(text).not.toContain(doc)
    }
    expect(screen.getByTestId('document-vault-empty').textContent).toMatch(/No documents uploaded yet/i)
  })

  it('reports wallets as unavailable rather than inventing a balance', async () => {
    renderFreshDashboard()
    await waitFor(() => expect(fetchSafePayEscrows).toHaveBeenCalled())

    // No authoritative wallet endpoint exists, so a numeric balance (including a misleading $0)
    // must not be rendered.
    expect(screen.getByTestId('wallet-usd-value').textContent).toMatch(/Not available/i)
    expect(screen.getByTestId('wallet-zig-value').textContent).toMatch(/Not available/i)
    expect(screen.getByTestId('wallet-usd-value').textContent).not.toMatch(/\$\s*\d/)
    expect(screen.getByTestId('wallet-zig-value').textContent).not.toMatch(/\d/)
  })

  it('reports trust as not calculated rather than asserting a verified status', async () => {
    renderFreshDashboard()
    await waitFor(() => expect(fetchSafePayEscrows).toHaveBeenCalled())

    expect(screen.getByTestId('trust-index-value').textContent).toMatch(/Not calculated/i)
    expect(screen.getByTestId('trust-index-label').textContent).toMatch(/Verification pending/i)
    expect(screen.getByTestId('trust-index-value').textContent).not.toMatch(/%/)
  })

  it('does not plot a fabricated valuation trend', async () => {
    renderFreshDashboard()
    await waitFor(() => expect(fetchOwnedVehicles).toHaveBeenCalled())

    expect(screen.getByTestId('value-trend-unavailable').textContent).toMatch(/not available/i)
    expect(SRC).not.toMatch(/month:\s*'Jan'/)
  })

  it('renders the real escrow total once the authoritative call resolves', async () => {
    fetchSafePayEscrows.mockResolvedValue([
      { id: 'e1', amount: 1200, currency: 'USD' },
      { id: 'e2', amount: 800, currency: 'USD' },
    ])
    renderFreshDashboard()

    await waitFor(() => expect(screen.getByTestId('escrow-usd-value').textContent).toContain('$2,000'))
  })

  it('does not flash demo data before the escrow request settles', async () => {
    let release: (value: unknown) => void = () => {}
    fetchSafePayEscrows.mockImplementation(() => new Promise(resolve => { release = resolve }))

    const { container } = renderFreshDashboard()
    // Before the request resolves the card must read as loading, never as a balance.
    expect(screen.getByTestId('escrow-usd-value').textContent).toMatch(/Loading/i)
    const text = container.textContent || ''
    for (const forbidden of FORBIDDEN_RENDERED) {
      expect(text).not.toContain(forbidden)
    }
    release([])
  })

  it('reports escrow as unavailable when the authoritative call fails', async () => {
    fetchSafePayEscrows.mockRejectedValue(new Error('backend down'))
    renderFreshDashboard()

    await waitFor(() => expect(screen.getByTestId('escrow-usd-value').textContent).toMatch(/Not available/i))
  })

  it('does not leak another user\'s records: only this session\'s scoped calls are made', async () => {
    renderFreshDashboard()
    await waitFor(() => expect(fetchSafePayEscrows).toHaveBeenCalled())

    // These endpoints are all caller-scoped server-side; the dashboard must not pass any
    // user/tenant selector that could widen them.
    expect(fetchOwnedVehicles).toHaveBeenCalledWith()
    expect(fetchCommunicationNotifications).toHaveBeenCalledWith()
    expect(fetchSafePayEscrows).toHaveBeenCalledWith()
    expect(fetchSavedMarketplaceListings).toHaveBeenCalledWith()
    expect(fetchCommunicationThreads).toHaveBeenCalledWith()
  })

  it('still renders real vehicles, saved cars and canonical notifications when the account has them', async () => {
    fetchOwnedVehicles.mockResolvedValue([
      { vin: 'VIN123', year: 2019, make: 'Toyota', model: 'Hilux', mileage: 45000, trust_score: 88 },
    ])
    fetchSavedMarketplaceListings.mockResolvedValue({
      listings: [
        { vin: 'SAVE1', year: 2020, make: 'Mazda', model: 'CX-5', price: 18000, trust_score: 84 },
      ],
    })
    fetchCommunicationNotifications.mockResolvedValue({
      notifications: [
        { id: 'n1', title: 'Service due', message: 'Book a service', notification_type: 'service_due', read: false },
      ],
    })
    const { container } = renderFreshDashboard()

    await waitFor(() => expect(container.textContent).toContain('Toyota'))
    expect(container.textContent).toContain('Mazda')
    expect(container.textContent).toContain('Service due')
    expect(container.textContent).toContain('1 new')
  })

  it('routes unread notification attention into the canonical Communications center', async () => {
    fetchCommunicationNotifications.mockResolvedValue({
      notifications: [{ id: 'n1', title: 'Action required', message: 'Review this update', read: false }],
    })
    renderFreshDashboard()

    const reviewLink = await screen.findByRole('link', { name: /Review new activity/i })
    expect(reviewLink.getAttribute('href')).toBe('/dashboard/communications')
  })

  it('guides a fresh owner toward real next actions instead of unavailable system cards', async () => {
    const { container } = renderFreshDashboard()
    await waitFor(() => expect(fetchOwnedVehicles).toHaveBeenCalled())

    expect(container.textContent).toContain('Add your first vehicle')
    expect(container.textContent).toContain('Build your shortlist')
    expect(container.textContent).toContain('Start your CarUp journey')
    expect(container.textContent).toContain('Gutu AI Assistant')
  })

  it('the source no longer contains the prototype constants or legacy notification read', () => {
    expect(SRC).not.toMatch(/usd:\s*350/)
    expect(SRC).not.toMatch(/zig:\s*4800/)
    expect(SRC).not.toContain('>92.5%<')
    expect(SRC).not.toContain('ZIMRA Customs Cleared Form 21.pdf')
    expect(SRC).not.toContain('NicozDiamond Policy.pdf')
    expect(SRC).not.toContain('fetchNotifications')
    expect(SRC).toContain('fetchCommunicationNotifications')
  })
})

/**
 * Owner-review blocker (2026-07-27): the "Upload & Parse Logbook" control called the OCR endpoint
 * with a hardcoded mock payload, so a user who never selected a file still received a success
 * message and a fabricated document row. Labelling that row "Not stored" did not make the operation
 * truthful — the click itself fabricated the event. The control is now disabled and no simulated
 * upload path exists.
 */
describe('OwnerDashboard document upload truthfulness (no simulated OCR)', () => {
  it('the source contains no mock OCR payload and no OCR call at all', () => {
    expect(SRC).not.toContain('MOCK_BASE64_DOCUMENT_DATA')
    expect(SRC).not.toContain('MOCK_BASE64')
    expect(SRC).not.toContain('runOcrParsing')
    expect(SRC).not.toContain('handleOcrUpload')
  })

  it('never calls runOcrParsing — on mount or from the upload control', async () => {
    renderFreshDashboard()
    await waitFor(() => expect(fetchSafePayEscrows).toHaveBeenCalled())
    expect(runOcrParsing).not.toHaveBeenCalled()

    // The control is disabled, so a click cannot start a document operation without a real file.
    const button = screen.getByTestId('ocr-upload-btn') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await act(async () => { fireEvent.click(button) })

    expect(runOcrParsing).not.toHaveBeenCalled()
  })

  it('emits no success message claiming a document was uploaded or parsed', async () => {
    renderFreshDashboard()
    await waitFor(() => expect(fetchSafePayEscrows).toHaveBeenCalled())
    await act(async () => { fireEvent.click(screen.getByTestId('ocr-upload-btn')) })

    const claims = toastSuccess.mock.calls.flat().join(' ')
    expect(claims).not.toMatch(/upload|parsed|document|verified/i)
    // The source must not contain a document-success toast either.
    expect(SRC).not.toMatch(/toast\.success\([^)]*(?:parsed|uploaded|Document)/i)
  })

  it('cannot render a fabricated parsed-document row', async () => {
    const { container } = renderFreshDashboard()
    await waitFor(() => expect(fetchSafePayEscrows).toHaveBeenCalled())
    await act(async () => { fireEvent.click(screen.getByTestId('ocr-upload-btn')) })

    expect(container.querySelector('[data-testid^="doc-row-"]')).toBeNull()
    expect(container.textContent).not.toContain('Parsed logbook')
    expect(container.textContent).not.toContain('AI Verified')
    expect(container.textContent).not.toContain('Not stored')
  })

  it('keeps the truthful empty state and explains that upload is unavailable', async () => {
    renderFreshDashboard()
    await waitFor(() => expect(fetchSafePayEscrows).toHaveBeenCalled())

    expect(screen.getByTestId('document-vault-empty').textContent).toMatch(/No documents uploaded yet/i)
    expect(screen.getByTestId('document-vault-unavailable').textContent)
      .toMatch(/not available from this dashboard yet/i)
  })
})
