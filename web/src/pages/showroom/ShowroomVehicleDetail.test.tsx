import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useHonourBottomBarClaim } from '@/lib/bottomBarClaim'

// The full public-listing render mounts every buyer panel; give jsdom room on a loaded machine.
vi.setConfig({ testTimeout: 30_000 })

/**
 * RX03-P1A-R2 — the recomposed Vehicle Detail ("showroom") keeps ONE decision rail.
 *
 * The previous page offered the same inquiry in four clusters (hero, a "Contact & inquire" box
 * inside the governed panels, and the dark sidebar). These tests pin the recomposition: each buyer
 * action exists once in the rail; the phone contact bar reuses the rail's contact path under a
 * different label; it never appears without a public listing or in Seller Preview; it docks per the
 * bottom-bar claim; the dossier rail points at sections that exist. Identifiers are fictional.
 */

const VIN = 'RX3SHOWROOMVIN001'

const fetchVehicle = vi.fn()
const fetchVehiclePassport = vi.fn()
const lookupVehiclePassport = vi.fn()
const fetchMarketplaceListingDetail = vi.fn()
const fetchOwnedVehicles = vi.fn()
const saveMarketplaceListing = vi.fn()
const unsaveMarketplaceListing = vi.fn()
const fetchSavedMarketplaceListings = vi.fn()
const fetchEvidenceTaxonomy = vi.fn()
const fetchEvidenceSources = vi.fn()
const fetchTemporalFindings = vi.fn()
const fetchDisclosureConflicts = vi.fn()
const fetchVehicleReport = vi.fn()
const generateReportVersion = vi.fn()
const createReportShareLink = vi.fn()
const fetchVehicleTrustDecision = vi.fn()
const fetchVehicleEvidence = vi.fn()
const fetchVehicleSourceCoverage = vi.fn()
const createMarketplaceInquiry = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchVehicle, fetchVehiclePassport, lookupVehiclePassport, fetchMarketplaceListingDetail,
    fetchOwnedVehicles, saveMarketplaceListing, unsaveMarketplaceListing, fetchSavedMarketplaceListings,
    fetchEvidenceTaxonomy, fetchEvidenceSources, fetchTemporalFindings, fetchDisclosureConflicts,
    fetchVehicleReport, generateReportVersion, createReportShareLink, fetchVehicleTrustDecision,
    fetchVehicleEvidence, fetchVehicleSourceCoverage, createMarketplaceInquiry,
  }),
}))

const auth = { user: null as null | { role: string }, isAuthenticated: false, loading: false }
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/components/DisputePanel', () => ({ default: () => null }))
vi.mock('@/components/EvidenceUploadModal', () => ({ default: () => null }))

const VehicleDetail = (await import('./ShowroomVehicleDetail')).default

function httpError(status: number): Error {
  const err = new Error(`HTTP error! status: ${status}`) as Error & { status: number }
  err.status = status
  return err
}

function passportFixture(tenantPhone: string | null = null) {
  return {
    vehicle: {
      vin: VIN, make: 'Toyota', model: 'Corolla', year: 2018, price: 12500, currency: 'USD', mileage: 45000, features: [],
      tenant: tenantPhone ? { name: 'Harare Motors', phone: tenantPhone, logo_url: null } : undefined,
    },
    timeline: [],
    evidenceTimeline: [],
    evidenceVault: [],
    trustReport: undefined,
    chainVerification: { verified: true, count: 0, chain: [] },
    identity: { vin: VIN, identifiersRedacted: true },
    plateHistory: [],
    ownershipSummary: { previousOwnerCount: 1 },
  }
}

const image = (url: string, id: string) => ({
  media_id: id, url, url_form: 'absolute_https', type: 'image', position: 0, is_primary: false,
})

function listingFixture() {
  const media = [
    image('https://cdn.example.test/one.jpg', '11111111-1111-4111-8111-111111111111'),
    image('https://cdn.example.test/two.jpg', '22222222-2222-4222-8222-222222222222'),
  ]
  return {
    vin: VIN, make: 'Toyota', model: 'Corolla', year: 2018, price: 12500, currency: 'USD', mileage: 45000,
    status: 'available', location: 'Harare', created_at: '2026-06-01T00:00:00.000Z',
    listing_media: { state: 'published', items: media, unpublishable_count: 0, empty_statement: null },
    media,
    seller_summary: { display_label: 'Harare Motors', seller_type: 'dealer', public_profile_enabled: true },
    trust_summary: {
      trust_badges: [], public_badge_copy: [], evidence_status: 'none', vehicle_passport_available: true,
      identity_verified: false, dealer_verified: false, partsentry_public_status: 'not_applicable',
      suspicion_status: 'clear', risk_status: 'clear', risk_reasons: [], safe_public_copy: '',
    },
    verification_summary: {
      seller_verified: false, identity_status: 'unverified', vehicle_evidence_verified: false,
      part_provenance_verified: false, inspection_available: false, inspection_verified: false,
      verification_notes_public: [],
    },
    pricing_summary: {
      asking_price: 12500, asking_price_state: 'recorded', currency: 'USD', currency_state: 'recorded',
      price_confidence: 'low', price_warnings: [], estimate_basis: 'deterministic',
    },
    reservation_summary: { state: 'none', reserved: false, reserved_at: null, expires_at: null, reason: null },
    safety_warnings: [],
  }
}

function NavThatHonoursClaims() {
  useHonourBottomBarClaim()
  return null
}

function renderAt(path: string, { honour = false } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      {honour && <NavThatHonoursClaims />}
      <Routes>
        <Route path="/marketplace/:id" element={<VehicleDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Visible-text exact matches for a trigger label, across the whole page. */
const triggers = (label: string) => screen.queryAllByRole('button', { name: label })

beforeEach(() => {
  vi.clearAllMocks()
  auth.user = null
  auth.isAuthenticated = false
  lookupVehiclePassport.mockResolvedValue(passportFixture())
  fetchVehiclePassport.mockResolvedValue(passportFixture())
  fetchVehicle.mockRejectedValue(httpError(500))
  fetchMarketplaceListingDetail.mockResolvedValue(listingFixture())
  fetchSavedMarketplaceListings.mockResolvedValue({ listings: [] })
  fetchEvidenceTaxonomy.mockResolvedValue({ classes: [] })
  fetchEvidenceSources.mockResolvedValue({ sources: [] })
  fetchTemporalFindings.mockResolvedValue({ findings: [] })
  fetchDisclosureConflicts.mockResolvedValue({ conflicts: [] })
  fetchVehicleReport.mockResolvedValue(null)
  fetchVehicleEvidence.mockResolvedValue([])
  fetchVehicleTrustDecision.mockResolvedValue({ decision: null })
  fetchOwnedVehicles.mockResolvedValue([])
  fetchVehicleSourceCoverage.mockRejectedValue(httpError(503))
})

describe('RX03-P1A-R2 — one decision rail', () => {
  it('offers each buyer action exactly once, inside the rail, and drops the duplicated inquiry box', async () => {
    renderAt(`/marketplace/${VIN}`)
    const rail = await screen.findByTestId('vehicle-detail-intelligence-hero', {}, { timeout: 15_000 })

    for (const label of ['Ask about this vehicle', 'Request an inspection', 'Contact through CarUp', 'Request reservation', 'Ask about financing']) {
      expect(triggers(label), `"${label}" must exist exactly once`).toHaveLength(1)
      expect(rail.contains(triggers(label)[0]), `"${label}" must live in the decision rail`).toBe(true)
    }
    // The old "Contact & inquire" box inside the governed panels.
    expect(triggers('Send inquiry')).toHaveLength(0)
    expect(triggers('Request inspection')).toHaveLength(0)
    expect(screen.queryByText('Contact & inquire')).toBeNull()

    // The governed panels are still there, inside the Trust section of the dossier.
    const panels = screen.getByTestId('marketplace-detail-panels')
    expect(document.getElementById('vd-trust')?.contains(panels)).toBe(true)
    expect(within(panels).queryAllByTestId('marketplace-inquiry-open')).toHaveLength(0)
    // R3 (Owner FIX): recomposed as open dossier sections by the page-scoped stylesheet — the shared
    // panel components themselves are untouched (the accepted page renders them unchanged).
    expect(panels).toHaveClass('vd-panels')
    expect(panels.className).not.toContain('[&_')
  })

  it('points every dossier pill at a section that exists', async () => {
    renderAt(`/marketplace/${VIN}`)
    const nav = await screen.findByTestId('vehicle-detail-dossier-nav', {}, { timeout: 15_000 })
    const links = within(nav).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(['Overview', 'Story', 'Trust', 'History', 'Evidence', 'Seller'])
    for (const a of links) {
      const id = a.getAttribute('href')!.slice(1)
      expect(document.getElementById(id), `#${id} must exist`).not.toBeNull()
    }
  })

  it('RX04-B Vehicle Story: every chapter points at content that exists, no tab hides a chapter, and evidence is only "reviewed" when reviewed records exist', async () => {
    renderAt(`/marketplace/${VIN}`)
    const story = await screen.findByTestId('vehicle-story', {}, { timeout: 15_000 })
    const chapters = within(story).getAllByRole('link')
    expect(chapters).toHaveLength(8)
    for (const a of chapters) {
      const id = a.getAttribute('href')!.slice(1)
      expect(document.getElementById(id), `#${id} must exist`).not.toBeNull()
    }
    expect(screen.queryByRole('tablist')).toBeNull()
    for (const id of ['history-tab-content', 'history-report-tab-content', 'evidence-timeline-tab-content', 'verification-tab-content', 'market-tab-content']) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }
    const evidence = screen.getByTestId('vehicle-story-chapter-evidence')
    const reviewed = screen.queryAllByTestId('verified-evidence-item').length
    expect(evidence.getAttribute('data-provenance')).toBe(reviewed > 0 ? 'reviewed' : 'none')
  })

  it('steps the photo stage from the keyboard when the stage has focus', async () => {
    renderAt(`/marketplace/${VIN}`)
    const stage = await screen.findByTestId('image-gallery', {}, { timeout: 15_000 })
    await screen.findByTestId('vehicle-image')
    expect(stage.textContent).toContain('1 / 2')
    fireEvent.keyDown(stage, { key: 'ArrowRight' })
    expect(stage.textContent).toContain('2 / 2')
    expect(screen.getByTestId('vehicle-image').getAttribute('data-media-id')).toBe('22222222-2222-4222-8222-222222222222')
    fireEvent.keyDown(stage, { key: 'ArrowLeft' })
    expect(stage.textContent).toContain('1 / 2')
  })
})

describe('RX03-P1A-R2 — phone contact bar', () => {
  it('reuses the governed seller-contact path under its own label, with the governed price', async () => {
    renderAt(`/marketplace/${VIN}`)
    const bar = await screen.findByTestId('vehicle-detail-contact-bar', {}, { timeout: 15_000 })
    expect(bar.textContent).toContain('$12,500')
    expect(within(bar).getByRole('button', { name: 'Contact' })).toBeTruthy()
    // The rail's trigger keeps its exact label and stays unique (e2e uses a /Contact through CarUp/ role query).
    expect(within(bar).queryByRole('button', { name: /Contact through CarUp/i })).toBeNull()
    expect(bar.getAttribute('data-docked')).toBe('above-nav')
  })

  it('docks at the screen edge when a shell navigation honours the claim', async () => {
    renderAt(`/marketplace/${VIN}`, { honour: true })
    const bar = await screen.findByTestId('vehicle-detail-contact-bar', {}, { timeout: 15_000 })
    expect(bar.getAttribute('data-docked')).toBe('bottom')
  })

  it('offers Call (and WhatsApp) when — and only when — the listing publishes a number', async () => {
    lookupVehiclePassport.mockResolvedValue(passportFixture('+263 77 000 0000'))
    renderAt(`/marketplace/${VIN}`)
    const bar = await screen.findByTestId('vehicle-detail-contact-bar', {}, { timeout: 15_000 })
    await within(bar).findByRole('link', { name: /Call/ })
    expect(within(bar).getByRole('link', { name: /Call/ }).getAttribute('href')).toBe('tel:+263 77 000 0000')
    expect(within(bar).getByRole('link', { name: 'WhatsApp the seller' }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/263770000000\?/)
    expect(within(bar).queryByRole('button', { name: 'Contact' })).toBeNull()
  })

  it('is absent when no public listing resolved', async () => {
    fetchMarketplaceListingDetail.mockRejectedValue(httpError(404))
    renderAt(`/marketplace/${VIN}`)
    await screen.findByTestId('marketplace-actions-unavailable', {}, { timeout: 15_000 })
    expect(screen.queryByTestId('vehicle-detail-contact-bar')).toBeNull()
  })

  it('is absent in Seller Preview', async () => {
    auth.user = { role: 'owner' }
    auth.isAuthenticated = true
    fetchOwnedVehicles.mockResolvedValue([{ vin: VIN }])
    renderAt(`/marketplace/${VIN}?mode=seller_preview`)
    await screen.findByTestId('seller-preview-sidebar-disabled', {}, { timeout: 15_000 })
    expect(screen.queryByTestId('vehicle-detail-contact-bar')).toBeNull()
    expect(screen.queryByTestId('vehicle-detail-primary-actions')).toBeNull()
  })
})
