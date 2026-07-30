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
const runOcrParsing = vi.fn()
const notificationState = vi.hoisted(() => ({ notifications: [] as Array<Record<string, unknown>> }))

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

vi.mock('@/context/NotificationContext', () => ({
  useNotifications: () => ({
    notifications: notificationState.notifications,
    unreadCount: notificationState.notifications.filter(notification => !notification.read).length,
    loading: false,
    error: '',
    refresh: vi.fn(),
  }),
}))

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ runOcrParsing, fetchSafePayEscrows, fetchOwnedVehicles }),
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
  notificationState.notifications = []
  // A brand-new account: every authoritative source is legitimately empty.
  fetchSafePayEscrows.mockResolvedValue([])
  fetchOwnedVehicles.mockResolvedValue([])
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

  it('does not widen caller-scoped requests or fabricate notifications', async () => {
    renderFreshDashboard()
    await waitFor(() => expect(fetchSafePayEscrows).toHaveBeenCalled())

    expect(fetchOwnedVehicles).toHaveBeenCalledWith()
    expect(fetchSafePayEscrows).toHaveBeenCalledWith()
    expect(screen.getByTestId('owner-notifications-empty').textContent).toMatch(/No notifications/i)
  })

  it('renders real vehicles and the shared actionable notification state', async () => {
    fetchOwnedVehicles.mockResolvedValue([
      { vin: 'VIN123', year: 2019, make: 'Toyota', model: 'Hilux', mileage: 45000, trust_score: 88 },
    ])
    notificationState.notifications = [{
      id: 'n1',
      displayTitle: 'Service due',
      displayMessage: 'Book a service',
      displayTimestamp: 'Jul 30, 2026, 5:00 PM GMT+9',
      created_at: '2026-07-30T08:00:00.000Z',
      reference: 'VIN123',
      href: '/dashboard/service-history',
      read: false,
    }]
    const { container } = renderFreshDashboard()

    await waitFor(() => expect(container.textContent).toContain('Toyota'))
    expect(container.textContent).toContain('Service due')
    expect(container.textContent).toContain('VIN123')
    expect(screen.getByTestId('owner-notification-link').getAttribute('href')).toBe('/dashboard/service-history')
  })

  it('the source no longer contains the prototype constants', () => {
    expect(SRC).not.toMatch(/usd:\s*350/)
    expect(SRC).not.toMatch(/zig:\s*4800/)
    expect(SRC).not.toContain('>92.5%<')
    expect(SRC).not.toContain('ZIMRA Customs Cleared Form 21.pdf')
    expect(SRC).not.toContain('NicozDiamond Policy.pdf')
  })
})

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
