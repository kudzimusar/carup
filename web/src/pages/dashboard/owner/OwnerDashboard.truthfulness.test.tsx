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
const fetchNotifications = vi.fn()
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
  useCarUpApi: () => ({ runOcrParsing, fetchSafePayEscrows, fetchOwnedVehicles, fetchNotifications }),
}))

const OwnerDashboard = (await import('./OwnerDashboard')).default
const SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'OwnerDashboard.tsx'), 'utf8')

// Values the owner saw during the 2026-07-27 UAT that were not their data.
const FORBIDDEN_RENDERED = ['$350', '350.00', '4,800 ZiG', '4800', '92.5%', 'Verified Buyer & Seller']
const FORBIDDEN_DOCUMENTS = ['ZIMRA Customs Cleared Form 21.pdf', 'NicozDiamond Policy.pdf']

function renderFreshDashboard() {
  return render(<MemoryRouter><OwnerDashboard /></MemoryRouter>)
}

/** One row exactly as `/api/safepay/list` returns it (toPublicMarketplaceEscrowSession). */
function safePaySession(status: string, listingAmount: number | null, listingCurrency: string | null = 'USD') {
  return {
    transaction_intent_id: `tx-${status}-${listingAmount}`,
    vin: 'TESTVINSAFEPAY001',
    status,
    listing_amount: listingAmount,
    listing_currency: listingCurrency,
    gate_reasons: [],
    payment_state: 'not_started',
    reservation_state: null,
    deposit_eligibility: null,
    created_at: '2026-10-20T00:00:00.000Z',
    updated_at: '2026-10-20T00:00:00.000Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // A brand-new account: every authoritative source is legitimately empty.
  fetchSafePayEscrows.mockResolvedValue([])
  fetchOwnedVehicles.mockResolvedValue([])
  fetchNotifications.mockResolvedValue([])
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

    // A fresh account owns no vehicle, so no document can be attached to a Passport yet. That is
    // the measured state; a blanket "no documents" line is not (OC-NATIVE-FINAL-02-R1 D3).
    expect((await screen.findByTestId('document-vault-no-vehicles')).textContent).toMatch(/no vehicle/i)
    const text = container.textContent || ''
    for (const doc of FORBIDDEN_DOCUMENTS) {
      expect(text).not.toContain(doc)
    }
    expect(text).not.toMatch(/No documents uploaded yet/i)
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

  // CARUP-MVP-STAB-01 F-024: these rows used to be `{ id, amount, currency }` — a shape
  // `/api/safepay/list` stopped returning in Issue #164 Phase 6. The mock agreed with the card and
  // disagreed with the API, which is how a card that always read $0 stayed green. The rows are now the
  // live public projection (`toPublicMarketplaceEscrowSession`).
  it('states the in-progress SafePay purchases from the live session shape', async () => {
    fetchSafePayEscrows.mockResolvedValue([
      safePaySession('initiated', 1200),
      safePaySession('funds_held', 800),
    ])
    renderFreshDashboard()

    await waitFor(() => expect(screen.getByTestId('safepay-summary-value').textContent).toBe('2 in progress'))
    expect(screen.getByTestId('safepay-summary-detail').textContent).toBe('Listing value USD 2,000')
  })

  it('does not flash demo data before the escrow request settles', async () => {
    let release: (value: unknown) => void = () => {}
    fetchSafePayEscrows.mockImplementation(() => new Promise(resolve => { release = resolve }))

    const { container } = renderFreshDashboard()
    // Before the request resolves the card must read as loading, never as a balance.
    expect(screen.getByTestId('safepay-summary-value').textContent).toMatch(/Loading/i)
    expect(screen.getByTestId('safepay-card').textContent).not.toMatch(/\d/)
    const text = container.textContent || ''
    for (const forbidden of FORBIDDEN_RENDERED) {
      expect(text).not.toContain(forbidden)
    }
    release([])
  })

  it('reports SafePay as unavailable when the authoritative call fails — never as a zero', async () => {
    fetchSafePayEscrows.mockRejectedValue(new Error('backend down'))
    renderFreshDashboard()

    await waitFor(() => expect(screen.getByTestId('safepay-summary-detail').textContent).toBe('SafePay status could not be loaded'))
    expect(screen.getByTestId('safepay-summary-value').textContent).toMatch(/Not available/i)
    expect(screen.getByTestId('safepay-card').textContent).not.toMatch(/\d/)
  })

  it('does not leak another user\'s records: only this session\'s scoped calls are made', async () => {
    renderFreshDashboard()
    await waitFor(() => expect(fetchSafePayEscrows).toHaveBeenCalled())

    // These endpoints are all caller-scoped server-side; the dashboard must not pass any
    // user/tenant selector that could widen them.
    expect(fetchOwnedVehicles).toHaveBeenCalledWith()
    expect(fetchNotifications).toHaveBeenCalledWith()
    expect(fetchSafePayEscrows).toHaveBeenCalledWith()
  })

  it('still renders real vehicles and notifications when the account has them', async () => {
    fetchOwnedVehicles.mockResolvedValue([
      { vin: 'VIN123', year: 2019, make: 'Toyota', model: 'Hilux', mileage: 45000, trust_score: 88 },
    ])
    fetchNotifications.mockResolvedValue([
      { id: 'n1', title: 'Service due', message: 'Book a service', type: 'info', read: false },
    ])
    const { container } = renderFreshDashboard()

    await waitFor(() => expect(container.textContent).toContain('Toyota'))
    expect(container.textContent).toContain('Service due')
  })

  it('the source no longer contains the prototype constants', () => {
    expect(SRC).not.toMatch(/usd:\s*350/)
    expect(SRC).not.toMatch(/zig:\s*4800/)
    expect(SRC).not.toContain('>92.5%<')
    expect(SRC).not.toContain('ZIMRA Customs Cleared Form 21.pdf')
    expect(SRC).not.toContain('NicozDiamond Policy.pdf')
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

    // The control used to be permanently disabled, which guaranteed truthfulness by making the
    // dashboard do nothing at all. Owner UAT called that out: a dead, unexplained control was the
    // page's only action. It now routes to the Evidence Vault, where uploading genuinely works.
    //
    // The property this test exists for is unchanged and is what is asserted: this dashboard never
    // starts a document operation and never claims one happened. It now sends the owner somewhere
    // real instead of pretending — the honest alternative to a disabled button is a true
    // destination, not a simulated upload.
    const control = screen.getByTestId('ocr-upload-btn')
    expect(control.closest('a')?.getAttribute('href') ?? control.getAttribute('href'))
      .toBe('/dashboard/evidence')
    await act(async () => { fireEvent.click(control) })

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

    expect((await screen.findByTestId('document-vault-no-vehicles')).textContent).toMatch(/no vehicle/i)
    expect(screen.getByTestId('document-vault-unavailable').textContent)
      .toMatch(/not available from this dashboard yet/i)
  })
})

/**
 * OC-NATIVE-FINAL-02-R1 D3 — the Owner was told "No documents uploaded yet" here while the Evidence
 * Vault listed five verified documents for the same vehicle. The dashboard line was a literal with
 * no read behind it. The card now states, per vehicle, the governed count the Evidence Vault and My
 * Garage already read (`/api/vehicles/me` → `counts.verified_documents`), so they cannot disagree.
 */
const EvidenceVault = (await import('./EvidenceVault')).default

const VIN_A = 'TESTVINDOCS000001'
const VIN_B = 'TESTVINDOCS000002'

function vaultVehicle(vin: string, verified: number | null, extra: Record<string, unknown> = {}) {
  return {
    vin,
    year: 2016,
    make: 'Nissan',
    model: 'Serena',
    counts: { verified_documents: verified, services: null, parts: null, active_insurance: null },
    ...extra,
  }
}

describe('OwnerDashboard document card — one authority with the Evidence Vault (OC-NATIVE-FINAL-02-R1 D3)', () => {
  it('states each vehicle’s governed verified-document count, never a blanket "none uploaded"', async () => {
    fetchOwnedVehicles.mockResolvedValue([
      vaultVehicle(VIN_A, 5),
      vaultVehicle(VIN_B, 1, { make: 'Toyota', model: 'Aqua' }),
    ])
    const { container } = renderFreshDashboard()

    await waitFor(() => expect(screen.getByTestId(`document-vault-count-${VIN_A}`)).toBeTruthy())
    expect(screen.getByTestId(`document-vault-count-${VIN_A}`).textContent).toBe('5 verified documents')
    expect(screen.getByTestId(`document-vault-count-${VIN_B}`).textContent).toBe('1 verified document')
    expect(screen.getByTestId(`document-vault-vehicle-${VIN_B}`).textContent).toContain('2016 Toyota Aqua')
    expect(screen.getByTestId('document-vault-scope').textContent).toMatch(/Evidence Vault/)
    expect(container.textContent).not.toMatch(/No documents uploaded yet/i)
  })

  it('agrees with the Evidence Vault for every vehicle, because both read the same count', async () => {
    const owned = [vaultVehicle(VIN_A, 5), vaultVehicle(VIN_B, 0, { make: 'Toyota', model: 'Aqua' })]
    fetchOwnedVehicles.mockResolvedValue(owned)
    const dashboard = renderFreshDashboard()
    await waitFor(() => expect(screen.getByTestId(`document-vault-count-${VIN_B}`)).toBeTruthy())
    const dashboardCounts = owned.map((vehicle) => screen.getByTestId(`document-vault-count-${vehicle.vin}`).textContent)
    dashboard.unmount()

    render(<MemoryRouter><EvidenceVault /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId(`evidence-vehicle-${VIN_B}`)).toBeTruthy())
    owned.forEach((vehicle, index) => {
      expect(screen.getByTestId(`evidence-vehicle-${vehicle.vin}`).textContent).toContain(dashboardCounts[index])
    })
    // ANTI-VACUITY: both surfaces really published the read values, not two matching blanks.
    expect(dashboardCounts).toEqual(['5 verified documents', '0 verified documents'])
  })

  it('a count CarUp did not read is stated in words, never as zero', async () => {
    fetchOwnedVehicles.mockResolvedValue([vaultVehicle(VIN_A, null)])
    renderFreshDashboard()

    await waitFor(() => expect(screen.getByTestId(`document-vault-count-${VIN_A}`)).toBeTruthy())
    expect(screen.getByTestId(`document-vault-count-${VIN_A}`).textContent).toBe('verified documents not recorded')
  })

  it('a failed vehicle read is a read failure, not an empty vault', async () => {
    fetchOwnedVehicles.mockRejectedValue(new Error('network down'))
    const { container } = renderFreshDashboard()

    await waitFor(() => expect(screen.getByTestId('document-vault-read-failed')).toBeTruthy())
    expect(container.querySelector('[data-testid^="document-vault-count-"]')).toBeNull()
    expect(screen.queryByTestId('document-vault-no-vehicles')).toBeNull()
    expect(container.textContent).not.toMatch(/No documents uploaded yet/i)
  })

  it('states no count while the vehicle read is still pending', () => {
    fetchOwnedVehicles.mockReturnValue(new Promise(() => {}))
    const { container } = renderFreshDashboard()

    expect(screen.getByTestId('document-vault-loading')).toBeTruthy()
    expect(container.querySelector('[data-testid^="document-vault-count-"]')).toBeNull()
    expect(screen.queryByTestId('document-vault-no-vehicles')).toBeNull()
  })

  it('carries no document literal and reads the governed count', () => {
    expect(SRC).not.toMatch(/No documents uploaded yet/)
    expect(SRC).toMatch(/statedCount\(vehicle\.counts\?\.verified_documents, 'verified document'\)/)
  })
})

/**
 * SJO-5 — "unknown is not zero" on the Notifications card.
 *
 * The badge was rendered unconditionally from `recentNotifications`, which is `[]` both BEFORE the
 * read settles and AFTER it fails. A pending or broken read therefore published a measured
 * "0 new" beside an empty list — indistinguishable from "you have no notifications". The same file
 * already gated `unreadNotifications` on `notificationsState`; this pins that rule on the surface
 * the owner actually reads.
 */
describe('OwnerDashboard notifications — unknown is not zero (SJO-5)', () => {
  it('publishes no count while the notifications read is still pending', async () => {
    // A read that never settles: the card must say nothing has been counted.
    fetchNotifications.mockReturnValue(new Promise(() => {}))
    const { container } = renderFreshDashboard()

    expect(screen.getByTestId('owner-notifications-not-read')).toBeTruthy()
    expect(container.textContent || '').not.toContain('0 new')
  })

  it('a FAILED notifications read is never presented as "no notifications"', async () => {
    fetchNotifications.mockRejectedValue(new Error('network down'))
    const { container } = renderFreshDashboard()

    await waitFor(() => expect(screen.getByTestId('owner-notifications-unavailable')).toBeTruthy())
    const text = container.textContent || ''
    expect(text).not.toContain('0 new')
    expect(screen.getByTestId('owner-notifications-unavailable').textContent)
      .toMatch(/could not read/i)
    // The failure must not be dressed up as an empty inbox.
    expect(screen.queryByTestId('owner-notifications-none')).toBeNull()
  })

  it('a SUCCESSFUL empty read may say zero — that is a measured zero, and it is correct', async () => {
    fetchNotifications.mockResolvedValue([])
    renderFreshDashboard()

    await waitFor(() => expect(screen.getByTestId('owner-notifications-none')).toBeTruthy())
    // ANTI-VACUITY: the badge exists again once something has actually been counted, so the gate
    // above suppresses an UNMEASURED count rather than the count itself.
    expect(screen.getByText('0 new')).toBeTruthy()
  })

  it('a successful non-empty read publishes the real unread count', async () => {
    fetchNotifications.mockResolvedValue([
      { id: 'n1', title: 'A', message: 'a', type: 'info', read: false },
      { id: 'n2', title: 'B', message: 'b', type: 'info', read: true },
    ])
    renderFreshDashboard()

    await waitFor(() => expect(screen.getByText('1 new')).toBeTruthy())
  })
})

/**
 * CARUP-MVP-STAB-01 F-024 — the SafePay card states only what the live session list supports.
 *
 * It summed `e.amount` where `e.currency === 'USD'`, fields the API does not return, so every owner
 * read "$0"; and it labelled every session — settled and cancelled ones included — an "active
 * purchase escrow". Loading, a failed read, a successful empty read and real purchases are now four
 * different statements, and only sessions that can still move count as in progress.
 */
describe('OwnerDashboard SafePay card — live shape, in-progress only (CARUP-MVP-STAB-01 F-024)', () => {
  it('a successful empty read says "No SafePay purchases yet" — not $0', async () => {
    fetchSafePayEscrows.mockResolvedValue([])
    renderFreshDashboard()

    await waitFor(() => expect(screen.getByTestId('safepay-summary-value').textContent).toBe('No SafePay purchases yet'))
    expect(screen.getByTestId('safepay-card').textContent).not.toMatch(/\$|\d/)
  })

  it('settled and cancelled sessions are not counted, or priced, as in progress', async () => {
    fetchSafePayEscrows.mockResolvedValue([
      safePaySession('initiated', 1200),
      safePaySession('settled', 5000),
      safePaySession('cancelled', 9000),
    ])
    renderFreshDashboard()

    await waitFor(() => expect(screen.getByTestId('safepay-summary-value').textContent).toBe('1 in progress'))
    expect(screen.getByTestId('safepay-summary-detail').textContent).toBe('Listing value USD 1,200 · 2 completed or closed')
    expect(screen.getByTestId('safepay-card').textContent).not.toMatch(/active/i)
  })

  it('only closed sessions: none in progress, and the closed ones are still acknowledged', async () => {
    fetchSafePayEscrows.mockResolvedValue([safePaySession('settled', 5000), safePaySession('refunded', 300)])
    renderFreshDashboard()

    await waitFor(() => expect(screen.getByTestId('safepay-summary-value').textContent).toBe('None in progress'))
    expect(screen.getByTestId('safepay-summary-detail').textContent).toBe('2 completed or closed SafePay purchases')
    expect(screen.getByTestId('safepay-card').textContent).not.toMatch(/\$|5,000|300/)
  })

  it('keeps currencies apart and never prices an unpriced session as 0', async () => {
    fetchSafePayEscrows.mockResolvedValue([
      safePaySession('initiated', 1200, 'USD'),
      safePaySession('eligible', 1500000, 'JPY'),
      safePaySession('pending_eligibility', null),
    ])
    renderFreshDashboard()

    await waitFor(() => expect(screen.getByTestId('safepay-summary-value').textContent).toBe('3 in progress'))
    expect(screen.getByTestId('safepay-summary-detail').textContent)
      .toBe('Listing value USD 1,200 · JPY 1,500,000 · 1 without a recorded price')
  })

  it('the source reads listing_amount/listing_currency and no longer sums a USD-only amount', () => {
    expect(SRC).toContain('readSafePaySessions')
    expect(SRC).not.toMatch(/e\.currency === 'USD'/)
    expect(SRC).not.toMatch(/active purchase escrow/)
  })
})
