import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * Issue #164 Phase 3 — ONE VIN, ONE NUMBER, on the surfaces a shopper and an owner actually see.
 *
 * Executing the real paths for a single VIN used to produce three different answers: the
 * marketplace card said 84 (the raw `vehicles.trust_score` column, unversioned), the trust-decision
 * route said 50 (versioned), and the passport said 90 (the deprecated 70-baseline trustGraph
 * engine). Both pages under test now render `toPublicTrust()`'s ten-field projection and nothing
 * else, so the fixtures below deliberately carry all three of the old numbers — 84 on the raw
 * column, 90 on a legacy-shaped trust report, and a canonical projection that disagrees with both.
 * A page that leaks either legacy number fails here.
 *
 * The four properties these tests exist to hold:
 *   1. `score: null` never renders as 0 (or as a 0%-filled bar).
 *   2. `insufficient_evidence` — an evaluated band — reads differently from `not_evaluated`, and
 *      differently from a genuinely low score.
 *   3. A `stale` evaluation is never presented as a current score.
 *   4. No invented tier ('Excellent', 'Good', 'Fair', 'High Trust') appears on any surface.
 */

const VIN = 'JTDKARFP0H3000731'
const CALCULATION_VERSION = 'trust-decision-v2'

/** The numbers that must never reach a surface again. */
const LEGACY_RAW_COLUMN_SCORE = 84
const LEGACY_PASSPORT_ENGINE_SCORE = 90

const reserveVehicle = vi.fn()
const createSafePayEscrow = vi.fn()
const submitFinancing = vi.fn()
const fetchVehicle = vi.fn()
const fetchVehiclePassport = vi.fn()
const lookupVehiclePassport = vi.fn()
const fetchMarketplaceListingDetail = vi.fn()
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

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    reserveVehicle, createSafePayEscrow, submitFinancing, fetchVehicle, fetchVehiclePassport,
    lookupVehiclePassport, fetchMarketplaceListingDetail, saveMarketplaceListing,
    unsaveMarketplaceListing, fetchSavedMarketplaceListings, fetchEvidenceTaxonomy,
    fetchEvidenceSources, fetchTemporalFindings, fetchDisclosureConflicts, fetchVehicleReport,
    generateReportVersion, createReportShareLink, fetchVehicleTrustDecision, fetchVehicleEvidence,
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'buyer-1', name: 'Buyer', email: 'buyer@staging.carup.local', role: 'buyer' },
    isAuthenticated: true,
    loading: false,
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

// These children fetch their own data through the API hook; they are not what is under test.
vi.mock('@/components/DisputePanel', () => ({ default: () => null }))
vi.mock('@/components/EvidenceUploadModal', () => ({ default: () => null }))

const VehicleDetail = (await import('./VehicleDetail')).default
const VehicleProfile = (await import('./dashboard/owner/VehicleProfile')).default

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Source assertions below target CODE, not prose. Both pages document the defects they removed by
 * quoting them (`trustReport?.trustScore || 0`), and a comment naming a fault is the opposite of
 * committing it — so comments are stripped before matching.
 */
function code(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const DETAIL_SRC = code(readFileSync(resolve(HERE, 'VehicleDetail.tsx'), 'utf8'))
const PROFILE_SRC = code(readFileSync(resolve(HERE, 'dashboard/owner/VehicleProfile.tsx'), 'utf8'))
const MARKETPLACE_SRC = code(readFileSync(resolve(HERE, 'Marketplace.tsx'), 'utf8'))

// ── Fixtures ────────────────────────────────────────────────────────────────

/** The canonical ten-field projection. Overrides let each test state one lifecycle exactly. */
function publicTrust(overrides: Record<string, unknown> = {}) {
  return {
    vin: VIN,
    score: null,
    band: null,
    evaluation_state: 'not_evaluated',
    confidence: 'not_evaluated',
    evidence_basis: null,
    calculation_version: null,
    evaluated_at: null,
    known_limitations: ['No canonical trust evaluation exists for this vehicle.'],
    source: 'cache',
    ...overrides,
  }
}

/**
 * The passport body as `server.js` now publishes it: `trustReport` IS the canonical projection and
 * the non-score signals moved to `trustSignals`. `vehicle.trust_score` still carries the
 * unversioned 84, because the column still exists and the page must still ignore it.
 */
function passportFixture(trust: unknown = publicTrust(), signals: unknown = undefined) {
  return {
    vehicle: {
      vin: VIN,
      make: 'Toyota',
      model: 'Corolla',
      year: 2018,
      price: 12500,
      currency: 'USD',
      mileage: 45000,
      trust_score: LEGACY_RAW_COLUMN_SCORE,
      images: [],
      features: [],
      created_at: '2026-06-01T00:00:00.000Z',
    },
    timeline: [],
    evidenceTimeline: [],
    evidenceVault: [],
    trustReport: trust,
    trustSignals: signals,
    chainVerification: { verified: true, count: 0, chain: [] },
    identity: { vin: VIN, plateStatus: 'registered' },
    plateHistory: [],
    ownershipSummary: { previousOwnerCount: 1, previousOwnersPublicLabel: '1 previous owner' },
  }
}

/** The pre-#164 passport body: the deprecated engine's 90 under the old key set. */
function legacyPassportFixture() {
  return passportFixture({
    vin: VIN,
    trustScore: LEGACY_PASSPORT_ENGINE_SCORE,
    metrics: { maintenance_logs_count: 2, stolen_alert_active: false },
  })
}

/**
 * The trust-decision route. Its `decision.overall_trust` is deliberately a DIFFERENT number from
 * the projection's — any page reading it instead of the projection shows 50 and fails.
 */
function trustResponse(trust?: unknown) {
  return {
    decision: {
      vin: VIN,
      calculation_version: CALCULATION_VERSION,
      last_updated: '2026-08-17T00:00:00.000Z',
      overall_trust: { status: 'moderate', value: 50 },
      dimensions: { evidence_confidence: { status: 'evaluated', value: 'low', reason_codes: ['EVIDENCE_THIN'] } },
      known_limitations: [],
    },
    ...(trust === undefined ? {} : { trust }),
  }
}

/** Point every passport transport at one projection. */
function servePassportTrust(trust: unknown, signals?: unknown) {
  lookupVehiclePassport.mockResolvedValue(passportFixture(trust, signals))
  fetchVehiclePassport.mockResolvedValue(passportFixture(trust, signals))
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={[`/marketplace/${VIN}`]}>
      <Routes>
        <Route path="/marketplace/:id" element={<VehicleDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderOwnerProfile() {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/garage/${VIN}`]}>
      <Routes>
        <Route path="/dashboard/garage/:id" element={<VehicleProfile />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** The trust badge, the sidebar line and the "what this is based on" card. */
function trustSurfaceText() {
  const badge = screen.getByTestId('trust-score-badge').textContent || ''
  const sidebar = screen.getByTestId('sidebar-trust').textContent || ''
  const basis = screen.queryByTestId('trust-basis')?.textContent || ''
  return `${badge} ${sidebar} ${basis}`
}

const evaluated = (score: number, band: string, extra: Record<string, unknown> = {}) => publicTrust({
  score,
  band,
  evaluation_state: 'evaluated',
  confidence: 'low',
  calculation_version: CALCULATION_VERSION,
  evaluated_at: '2026-08-17T00:00:00.000Z',
  known_limitations: [],
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  servePassportTrust(publicTrust())
  fetchVehicle.mockResolvedValue(passportFixture().vehicle)
  // Not a public marketplace listing: the page renders the passport view, which is the path that
  // used to read the raw column and the deprecated engine.
  fetchMarketplaceListingDetail.mockRejectedValue(new Error('not a marketplace listing'))
  fetchSavedMarketplaceListings.mockResolvedValue({ listings: [] })
  fetchEvidenceTaxonomy.mockResolvedValue({ classes: [] })
  fetchEvidenceSources.mockResolvedValue({ sources: [] })
  fetchTemporalFindings.mockResolvedValue({ findings: [] })
  fetchDisclosureConflicts.mockResolvedValue({ conflicts: [] })
  fetchVehicleReport.mockResolvedValue(null)
  fetchVehicleEvidence.mockResolvedValue([])
  // The route publishes the decision (reason codes). It is NOT the trust claim.
  fetchVehicleTrustDecision.mockResolvedValue(trustResponse())
})

// ────────────────────────────────────────────────────────────────────────────
describe('VehicleDetail — a null canonical score never renders as 0', () => {
  it('renders the not-evaluated state with no number at all', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('trust-score-label')).toBeTruthy())

    // The score element only exists when a score was published.
    expect(screen.queryByTestId('trust-score-value')).toBeNull()
    expect(screen.getByTestId('trust-score-label').textContent).toMatch(/Not evaluated/i)
    // Nothing numeric may appear in the trust badge: not "0", not "0/100", not "0%".
    expect(screen.getByTestId('trust-score-badge').textContent).not.toMatch(/\d/)
    expect(screen.getByTestId('sidebar-trust').textContent).toMatch(/Not evaluated/i)
    expect(screen.getByTestId('sidebar-trust').textContent).not.toMatch(/\d/)
  })

  it('says a missing evaluation is not a zero and not a finding about the vehicle', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('trust-basis')).toBeTruthy())

    expect(screen.getByTestId('trust-state-detail').textContent).toMatch(/not\s+a score of zero/i)
    expect(screen.getByTestId('trust-evaluation-state').textContent).toMatch(/Not evaluated/i)
  })

  it('never renders the raw trust_score column or the deprecated passport engine score', async () => {
    // A vehicle whose canonical evaluation says 37 while the legacy sources say 84 and 90.
    servePassportTrust(evaluated(37, 'low'))
    const { container } = renderDetail()
    await waitFor(() => expect(screen.getByTestId('trust-score-value')).toBeTruthy())

    expect(screen.getByTestId('trust-score-value').textContent).toBe('37')
    const page = container.textContent || ''
    expect(page, 'the unversioned raw column must not reach the page').not.toContain(String(LEGACY_RAW_COLUMN_SCORE))
    expect(page, 'the deprecated engine score must not reach the page').not.toContain(String(LEGACY_PASSPORT_ENGINE_SCORE))
    // The decision's own overall_trust value (50) is not the public contract either.
    expect(trustSurfaceText()).not.toContain('50')
  })

  it('refuses a legacy-shaped trust report outright rather than republishing its score', async () => {
    // A server that has not been updated still sends `{vin, trustScore: 90, metrics}`. That shape
    // carries no `evaluation_state`, so it is not a canonical projection and yields no claim.
    lookupVehiclePassport.mockResolvedValue(legacyPassportFixture())
    fetchVehiclePassport.mockResolvedValue(legacyPassportFixture())
    const { container } = renderDetail()
    await waitFor(() => expect(screen.getByTestId('trust-score-label')).toBeTruthy())

    expect(screen.queryByTestId('trust-score-value')).toBeNull()
    expect(container.textContent || '').not.toContain(String(LEGACY_PASSPORT_ENGINE_SCORE))
  })

  it('accepts the projection from the trust-decision route when the passport carries none', async () => {
    servePassportTrust(null)
    fetchVehicleTrustDecision.mockResolvedValue(trustResponse(evaluated(63, 'moderate')))
    renderDetail()

    await waitFor(() => expect(screen.getByTestId('trust-score-value').textContent).toBe('63'))
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('VehicleDetail — insufficient evidence is its own state, not a low score', () => {
  const insufficient = evaluated(0, 'insufficient_evidence', {
    // The authority publishes a REAL 0 for this band. Suppressing it was the second forked
    // contract; the page shows it and says what it means.
    evidence_basis: {
      governed_facts_total: 7,
      governed_facts_substantiated: 0,
      governed_facts_adverse: 0,
      connected_sources: 0,
      unbacked_legacy_claims: 2,
    },
    known_limitations: [
      'No governed vehicle fact is backed by an authoritative record.',
      "The stored 'zimra_verified' flag on this vehicle is not supported by any authoritative record and is not published.",
    ],
  })

  it('renders an evaluated 0 as a measured result, labelled insufficient evidence', async () => {
    servePassportTrust(insufficient)
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('trust-score-value')).toBeTruthy())

    expect(screen.getByTestId('trust-score-value').textContent).toBe('0')
    expect(screen.getByTestId('trust-score-label').textContent).toMatch(/Insufficient evidence/i)
    expect(screen.getByTestId('trust-state-detail').textContent).toMatch(/measured result, not a missing one/i)
  })

  it('reads differently from a genuinely low score', async () => {
    servePassportTrust(insufficient)
    const insufficientRender = renderDetail()
    await waitFor(() => expect(screen.getByTestId('trust-score-label')).toBeTruthy())
    const insufficientLabel = screen.getByTestId('trust-score-label').textContent
    insufficientRender.unmount()

    servePassportTrust(evaluated(22, 'low'))
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('trust-score-value').textContent).toBe('22'))

    expect(screen.getByTestId('trust-score-label').textContent).toMatch(/Low trust/i)
    expect(screen.getByTestId('trust-score-label').textContent).not.toBe(insufficientLabel)
  })

  it('reads differently from "not evaluated" — an evaluated zero is not an absent evaluation', async () => {
    servePassportTrust(publicTrust())
    const notEvaluated = renderDetail()
    await waitFor(() => expect(screen.getByTestId('trust-score-label')).toBeTruthy())
    const notEvaluatedLabel = screen.getByTestId('trust-score-label').textContent
    expect(screen.queryByTestId('trust-score-value')).toBeNull()
    notEvaluated.unmount()

    servePassportTrust(insufficient)
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('trust-score-value')).toBeTruthy())

    expect(screen.getByTestId('trust-score-label').textContent).not.toBe(notEvaluatedLabel)
  })

  it('surfaces the evidence basis, the confidence and the unbacked legacy claim', async () => {
    servePassportTrust(insufficient)
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('trust-evidence-basis')).toBeTruthy())

    expect(screen.getByTestId('trust-evidence-basis').textContent).toMatch(/0 of 7/)
    expect(screen.getByTestId('trust-unbacked-claims').textContent).toBe('2')
    // Confidence is floored by the evidence that exists, and the page publishes that axis.
    expect(screen.getByTestId('trust-confidence').textContent).toMatch(/Low confidence/i)
    // The disclosure that a stored legacy flag is unbacked must actually reach a shopper.
    expect(screen.getByTestId('trust-known-limitations').textContent)
      .toMatch(/'zimra_verified' flag .* is not supported by any authoritative record/i)
  })

  it('prints "Not recorded", never 0, for an evidence count that was never resolved', async () => {
    servePassportTrust(evaluated(41, 'low', {
      evidence_basis: {
        governed_facts_total: null,
        governed_facts_substantiated: null,
        governed_facts_adverse: null,
        connected_sources: 1,
        unbacked_legacy_claims: null,
      },
    }))
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('trust-evidence-basis')).toBeTruthy())

    expect(screen.getByTestId('trust-unbacked-claims').textContent).toMatch(/Not recorded/i)
    expect(screen.getByTestId('trust-unbacked-claims').textContent).not.toBe('0')
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('VehicleDetail — a stale evaluation is never shown as a current score', () => {
  const staleLimitation = 'The stored trust score was produced by calculation version '
    + `trust-decision-v1; the current version is ${CALCULATION_VERSION}. It is not published as canonical.`

  const stale = publicTrust({
    evaluation_state: 'stale',
    calculation_version: 'trust-decision-v1',
    evaluated_at: '2026-01-01T00:00:00.000Z',
    known_limitations: [staleLimitation],
  })

  it('withholds the number and names the superseded rules', async () => {
    servePassportTrust(stale)
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('trust-score-label')).toBeTruthy())

    expect(screen.queryByTestId('trust-score-value')).toBeNull()
    expect(screen.getByTestId('trust-score-label').textContent).toMatch(/out of date/i)
    expect(screen.getByTestId('trust-score-badge').textContent).not.toMatch(/\d/)
    expect(screen.getByTestId('trust-state-detail').textContent).toMatch(/superseded rules/i)
    expect(screen.getByTestId('trust-known-limitations').textContent).toContain('trust-decision-v1')
  })

  it('fails closed: a score arriving with a non-evaluated state is still not printed', async () => {
    // The contract makes this shape impossible. The page refuses it anyway, so a route that ever
    // published a raw decision here shows the lifecycle state rather than an ungoverned number.
    servePassportTrust(publicTrust({
      ...stale,
      score: LEGACY_RAW_COLUMN_SCORE,
      band: 'high',
    }))
    const { container } = renderDetail()
    await waitFor(() => expect(screen.getByTestId('trust-score-label')).toBeTruthy())

    expect(screen.queryByTestId('trust-score-value')).toBeNull()
    expect(container.textContent || '').not.toContain(String(LEGACY_RAW_COLUMN_SCORE))
  })

  it('states no evaluation date beside a withheld score', async () => {
    servePassportTrust(stale)
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('trust-basis')).toBeTruthy())

    // A date belongs to a number the page is deliberately not showing; only the limitation, which
    // explains the withholding, may name the superseded version.
    expect(screen.queryByTestId('trust-evaluated-at')).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('VehicleDetail — no invented tier vocabulary', () => {
  const FORBIDDEN_TIERS = ['Excellent', 'High Trust', 'Featured']

  it('renders no client-side tier for a high canonical score', async () => {
    servePassportTrust(evaluated(96, 'high', { confidence: 'high' }))
    const { container } = renderDetail()
    await waitFor(() => expect(screen.getByTestId('trust-score-value').textContent).toBe('96'))

    const page = container.textContent || ''
    for (const tier of FORBIDDEN_TIERS) {
      expect(page, `no invented tier "${tier}" may appear`).not.toContain(tier)
    }
    // Only the authority's own band vocabulary is used as a label.
    expect(screen.getByTestId('trust-score-label').textContent).toMatch(/High trust/)
  })

  it('renders no tier for a mid-range canonical score either', async () => {
    servePassportTrust(evaluated(78, 'moderate', { confidence: 'medium' }))
    const { container } = renderDetail()
    await waitFor(() => expect(screen.getByTestId('trust-score-value').textContent).toBe('78'))

    const page = container.textContent || ''
    for (const tier of [...FORBIDDEN_TIERS, 'Good', 'Fair']) {
      expect(page, `no invented tier "${tier}" may appear`).not.toContain(tier)
    }
    expect(screen.getByTestId('trust-score-label').textContent).toMatch(/Moderate trust/)
  })

  it('the source carries no score-threshold ladder on either page', () => {
    // The tiers were produced by client-side comparisons against the score. No such comparison
    // may exist: a threshold is a trust claim, and the page has no authority to set one.
    for (const [name, src] of [['VehicleDetail', DETAIL_SRC], ['VehicleProfile', PROFILE_SRC]] as const) {
      expect(src, `${name} must not bucket a score client-side`).not.toMatch(/trustScore\s*>=/)
      expect(src, `${name} must not bucket a score client-side`).not.toMatch(/trust\.score\s*[><]/)
      expect(src, `${name} must not default a trust score to 0`).not.toMatch(/trustScore\s*\|\|\s*0/)
      expect(src, `${name} must not read the raw trust_score column for display`)
        .not.toMatch(/\{[^}]*vehicle\.trust_score[^}]*\}/)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('VehicleDetail — absent passport signals claim nothing in either direction', () => {
  async function openVerificationTab() {
    const { container } = renderDetail()
    await waitFor(() => expect(screen.getByTestId('trust-score-label')).toBeTruthy())
    // Radix TabsTrigger switches on mousedown (and on focus in automatic activation mode); a bare
    // click event does not dispatch mousedown in jsdom.
    const trigger = screen.getByRole('tab', { name: /Verification/i })
    await act(async () => {
      fireEvent.mouseDown(trigger, { button: 0 })
      fireEvent.focus(trigger)
    })
    await waitFor(() => expect(trigger.getAttribute('data-state')).toBe('active'))
    return container
  }

  it('does not certify a clean police check off a passport that reported no signals', async () => {
    // `trustSignals` is absent — the non-score signals moved off `trustReport` and this passport
    // carried none. "No active stolen vehicle alert" would be a safety claim made from a missing
    // field, which is the same absence-as-proof as a hand-set score.
    servePassportTrust(publicTrust(), undefined)
    const container = await openVerificationTab()

    const page = container.textContent || ''
    expect(page).not.toContain('No active stolen vehicle alert')
    expect(page).not.toContain('CID check passed')
    expect(page).toMatch(/reported no registry, clearance or odometer signals/i)
  })

  it('still reports the real signals when the passport carries them', async () => {
    servePassportTrust(publicTrust(), {
      cvr_synced: true,
      zimra_duty: true,
      zrp_police_cleared: true,
      odometer_consistent: true,
      maintenance_logs_count: 2,
      stolen_alert_active: false,
    })
    const container = await openVerificationTab()

    expect(container.textContent || '').toContain('Vehicle registered in Central Vehicle Registry')
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('Marketplace list — the card makes no trust claim and no trust ranking', () => {
  it('renders no score, no tier badge and no evidence tier on a card', () => {
    for (const claim of ['High Trust', 'Low Evidence', 'Trust {', 'Excellent']) {
      expect(MARKETPLACE_SRC, `the card must not render "${claim}"`).not.toContain(claim)
    }
  })

  it('does not re-rank the server-ordered page by the unversioned cached column', () => {
    // `sort=trust` is ranked by the backend from canonical scores only. A client-side re-sort on
    // `trust_score` would put the hand-set 84 back on top of a page the backend just ordered
    // honestly — the same defect, one layer up.
    expect(MARKETPLACE_SRC).not.toMatch(/sortBy\s*===\s*'trust'/)
    expect(MARKETPLACE_SRC).not.toMatch(/trustSortKey/)
    expect(MARKETPLACE_SRC).not.toMatch(/getCachedTrustScore/)
    // The card model still carries `trust_score` only because the shared Vehicle type requires it;
    // no code path may READ it back off a vehicle.
    expect(MARKETPLACE_SRC).not.toMatch(/vehicle\.trust_score/)
    expect(MARKETPLACE_SRC).not.toMatch(/vehicle\.trustScore/)
  })

  it('keeps the disclosure that a trust-sorted page may not be trust-ordered', () => {
    expect(MARKETPLACE_SRC).toContain('marketplace-trust-ranking-notice')
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('VehicleProfile (owner garage) — the same one number', () => {
  it('draws no progress bar and no percentage when nothing canonical exists', async () => {
    servePassportTrust(publicTrust())
    const { container } = renderOwnerProfile()
    await waitFor(() => expect(screen.getByTestId('owner-trust')).toBeTruthy())

    expect(screen.queryByTestId('owner-trust-score')).toBeNull()
    expect(screen.getByTestId('owner-trust-state').textContent).toMatch(/Not evaluated/i)
    expect(screen.getByTestId('owner-trust').textContent).not.toMatch(/\d\s*%/)
    // A bar drawn at 0% is a measurement of nothing. There must be no bar at all.
    expect(container.querySelector('[data-testid="owner-trust"] [role="progressbar"]')).toBeNull()
    expect(screen.getByTestId('owner-trust-detail').textContent).toMatch(/not a score of zero/i)
  })

  it('never renders the deprecated passport engine score, even when the server still sends it', async () => {
    lookupVehiclePassport.mockResolvedValue(legacyPassportFixture())
    fetchVehiclePassport.mockResolvedValue(legacyPassportFixture())
    const { container } = renderOwnerProfile()
    await waitFor(() => expect(screen.getByTestId('owner-trust')).toBeTruthy())

    expect(screen.queryByTestId('owner-trust-score')).toBeNull()
    expect(container.textContent || '').not.toContain(String(LEGACY_PASSPORT_ENGINE_SCORE))
  })

  it('renders the canonical score, its band and its confidence when one is published', async () => {
    servePassportTrust(evaluated(37, 'low'))
    const { container } = renderOwnerProfile()
    await waitFor(() => expect(screen.getByTestId('owner-trust-score')).toBeTruthy())

    expect(screen.getByTestId('owner-trust-score').textContent).toBe('37 / 100')
    expect(screen.getByTestId('owner-trust-band').textContent).toMatch(/Low trust/)
    expect(screen.getByTestId('owner-trust-band').textContent).toMatch(/Low confidence/)
    expect(container.textContent || '').not.toContain(String(LEGACY_PASSPORT_ENGINE_SCORE))
  })

  it('withholds a stale score from the owner too', async () => {
    servePassportTrust(publicTrust({
      evaluation_state: 'stale',
      calculation_version: 'trust-decision-v1',
      known_limitations: ['The stored trust score was produced by calculation version trust-decision-v1.'],
    }))
    renderOwnerProfile()
    await waitFor(() => expect(screen.getByTestId('owner-trust-state')).toBeTruthy())

    expect(screen.queryByTestId('owner-trust-score')).toBeNull()
    expect(screen.getByTestId('owner-trust-state').textContent).toMatch(/out of date/i)
    expect(screen.getByTestId('owner-trust-limitations').textContent).toContain('trust-decision-v1')
  })

  it('reports trust as unavailable when the passport publishes no projection', async () => {
    servePassportTrust(null)
    renderOwnerProfile()
    await waitFor(() => expect(screen.getByTestId('owner-trust-state')).toBeTruthy())

    expect(screen.getByTestId('owner-trust-state').textContent).toMatch(/unavailable/i)
    expect(screen.queryByTestId('owner-trust-score')).toBeNull()
  })
})
