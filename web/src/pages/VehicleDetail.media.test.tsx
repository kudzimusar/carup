import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * Issue #164 Phase 5 — LISTING MEDIA AND VERIFIED EVIDENCE ARE TWO THINGS, ON THE PAGE THAT
 * COMPOSES BOTH.
 *
 * THE DEFECT. Marketplace served a card image for a VIN while Vehicle Detail said "No verified
 * images uploaded yet" for the same VIN. `lookupVehiclePassport` runs first and RETURNS EARLY on
 * success, and the gallery was hydrated from `passportData.vehicle.images` — a key the passport
 * body does not have, because `buildVehiclePassport` projects `vehicles` through
 * `PUBLIC_VEHICLE_FIELDS` and `vehicles` has no image column. Photos live in `listing_images`,
 * which that path never reads. So the gallery went empty for a car whose photos were sitting on
 * its own Marketplace card.
 *
 * THE SENTENCE WAS THE SECOND DEFECT AND THE WORSE ONE. It answered a question about EVIDENCE with
 * a control that renders LISTING MEDIA. Fixing only the plumbing would have left it in place and
 * made it false in the other direction: three seller snapshots rendering under a control that had
 * just called them unverified.
 *
 * The five properties this suite exists to hold:
 *   1. A photo that reaches the Marketplace card reaches this gallery — from the same rows, on the
 *      passport early-return path, and NOT from `vehicle.images`.
 *   2. Nothing in the listing block claims governance. Checked against the contract's own
 *      trust-language list, so the guard cannot drift from the contract it enforces.
 *   3. The two empty states are different sentences and NEITHER implies the other; and a block this
 *      page never read says `not_loaded`, not "none" — the defect turned into a state.
 *   4. Evidence renders as governed artifacts and never leaks an internal identity.
 *   5. Phase 0/3/4 still hold on this page.
 */

/*
 * A TIMEOUT BUDGET, NOT AN ASSERTION. VehicleDetail is a heavy page — six data effects, a Radix tab
 * set, and a full marketplace panel row — and one render of it exceeds vitest's 5s default when the
 * whole 95-file suite runs in parallel on a loaded machine. Alone this file finishes 41 tests in
 * ~90s. Nothing about the product is asserted by the deadline, so raising it weakens no check; the
 * precedent in this repo is FeatureGovernanceConsole.test.tsx, which already carries 15s.
 */
vi.setConfig({ testTimeout: 30_000 })

const VIN = 'JTDKARFP0H3000731'

/** The image the Marketplace card is built from. It must be the one this gallery shows. */
const CARD_IMAGE = 'https://cdn.carup.dev/listings/JTDKARFP0H3000731/exterior-front.jpg'
const SECOND_IMAGE = 'https://cdn.carup.dev/listings/JTDKARFP0H3000731/interior.jpg'

/**
 * Planted on the passport vehicle. The page must render the marketplace rows and never this: it is
 * how the test proves the gallery stopped reading `d.images` rather than merely stopped being empty.
 */
const PASSPORT_GHOST_IMAGE = 'https://ghost.example.test/passport-images-key.jpg'

/** The sentence that shipped. It may not appear anywhere on the page again. */
const SHIPPED_DEFECT_SENTENCE = 'No verified images uploaded yet'

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
const fetchVehicleSourceCoverage = vi.fn()
const createMarketplaceInquiry = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    reserveVehicle, createSafePayEscrow, submitFinancing, fetchVehicle, fetchVehiclePassport,
    lookupVehiclePassport, fetchMarketplaceListingDetail, saveMarketplaceListing,
    unsaveMarketplaceListing, fetchSavedMarketplaceListings, fetchEvidenceTaxonomy,
    fetchEvidenceSources, fetchTemporalFindings, fetchDisclosureConflicts, fetchVehicleReport,
    generateReportVersion, createReportShareLink, fetchVehicleTrustDecision,
    fetchVehicleSourceCoverage, createMarketplaceInquiry,
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'buyer-1', name: 'Buyer', email: 'buyer@carup.dev', role: 'buyer' },
    isAuthenticated: true,
    loading: false,
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

/**
 * These children are not under test. Unlike the trust suite, this one needs the marketplace detail
 * to RESOLVE — that response is the only path by which `listing_images` reaches this page — which
 * also mounts the governed marketplace panels. They fetch their own data and publish the marketplace
 * trust contract, which `VehicleDetail.trust.test.tsx` owns. Stubbing them keeps this suite's
 * subject the media composition rather than a second copy of that contract.
 */
vi.mock('@/components/DisputePanel', () => ({ default: () => null }))
vi.mock('@/components/EvidenceUploadModal', () => ({ default: () => null }))
vi.mock('@/components/TrustDecisionPanel', () => ({ TrustDecisionPanel: () => null }))
vi.mock('@/components/SourceCoveragePanel', () => ({ SourceCoveragePanel: () => null }))
vi.mock('@/components/marketplace/TrustSummaryPanel', () => ({ TrustSummaryPanel: () => null }))
vi.mock('@/components/marketplace/AllInPricePanel', () => ({ AllInPricePanel: () => null }))
vi.mock('@/components/marketplace/SafetyWarnings', () => ({ SafetyWarnings: () => null }))
vi.mock('@/components/marketplace/InquiryModal', () => ({ InquiryModal: () => null }))

const VehicleDetail = (await import('./VehicleDetail')).default

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')

/**
 * `web/` resolves only `@/*` and `@shared/*`, so VehicleDetail.tsx cannot IMPORT the canonical media
 * contract from `backend/`. It mirrors it instead — and a mirror that nobody checks is a fork. These
 * two sources are read so the checks below bind the page to the contract's actual text: the exported
 * sentences, the trust-language list, and Phase 0's evidence allow-list.
 */
const CONTRACT_SRC = readFileSync(resolve(REPO, 'backend/utils/vehicleMediaProjection.js'), 'utf8')
const PHASE0_SRC = readFileSync(resolve(REPO, 'backend/utils/publicVehicleProjection.js'), 'utf8')

/**
 * Source assertions target CODE, not prose. VehicleDetail.tsx documents the defect it removed by
 * quoting it, and a comment naming a fault is the opposite of committing it — so comments are
 * stripped before matching. (Same helper, same reason, as VehicleDetail.trust.test.tsx.)
 */
function code(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const DETAIL_SRC = readFileSync(resolve(HERE, 'VehicleDetail.tsx'), 'utf8')
const DETAIL_CODE = code(DETAIL_SRC)

/** Pull `export const NAME = '…'` out of a backend module. */
function exportedString(src: string, name: string): string {
  const match = new RegExp(`export const ${name} = '([^']*)'`).exec(src)
  if (!match) throw new Error(`${name} is not an exported single-quoted string constant`)
  return match[1]
}

/** Pull `export const NAME = Object.freeze([ 'a', 'b', … ])` out of a backend module. */
function exportedStringArray(src: string, name: string): string[] {
  const block = new RegExp(`export const ${name} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`).exec(src)
  if (!block) throw new Error(`${name} is not an exported frozen array`)
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

const CONTRACT_LISTING_EMPTY = exportedString(CONTRACT_SRC, 'LISTING_MEDIA_EMPTY_STATEMENT')
const CONTRACT_EVIDENCE_EMPTY = exportedString(CONTRACT_SRC, 'VERIFIED_EVIDENCE_EMPTY_STATEMENT')
const CONTRACT_TRUST_LANGUAGE = exportedStringArray(CONTRACT_SRC, 'TRUST_LANGUAGE')
const PHASE0_EVIDENCE_FIELDS = exportedStringArray(PHASE0_SRC, 'PUBLIC_EVIDENCE_FIELDS')

/** The field list VehicleDetail.tsx publishes on an evidence item, read back out of the page. */
function detailEvidenceFields(): string[] {
  const block = /const VEHICLE_DETAIL_EVIDENCE_FIELDS = \[([\s\S]*?)\] as const/.exec(DETAIL_SRC)
  if (!block) throw new Error('VEHICLE_DETAIL_EVIDENCE_FIELDS not found in VehicleDetail.tsx')
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** Every trust-language stem the contract forbids, found in `text`. */
function trustLanguageIn(text: string): string[] {
  const lower = text.toLowerCase()
  return CONTRACT_TRUST_LANGUAGE.filter((stem) => lower.includes(stem))
}

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A canonical projection, so the trust surfaces render their Phase 3 states unchanged. */
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
    known_limitations: [],
    source: 'cache',
    ...overrides,
  }
}

/**
 * The passport as `server.js` publishes it. `images` is PLANTED here and is not a real key of the
 * body — the point is that the gallery must ignore it. `evidenceVault` is passed explicitly by each
 * test, including as `undefined`, because absent-vs-empty is a distinction this page now keeps.
 */
function passportFixture(opts: {
  evidenceVault?: unknown
  identity?: Record<string, unknown>
  policeVerified?: boolean
} = {}) {
  const body: Record<string, unknown> = {
    vehicle: {
      vin: VIN,
      make: 'Toyota',
      model: 'Corolla',
      year: 2018,
      price: 12500,
      currency: 'USD',
      mileage: 45000,
      images: [PASSPORT_GHOST_IMAGE],
      features: [],
      police_verified: opts.policeVerified === true,
      created_at: '2026-06-01T00:00:00.000Z',
    },
    timeline: [],
    evidenceTimeline: [],
    trustReport: publicTrust(),
    chainVerification: { verified: true, count: 0, chain: [] },
    identity: { vin: VIN, plateStatus: 'registered', ...(opts.identity ?? {}) },
    plateHistory: [],
    ownershipSummary: { previousOwnerCount: 1, previousOwnersPublicLabel: '1 previous owner' },
  }
  // Assigned only when the caller supplied one: `evidenceVault: undefined` and "no evidenceVault
  // key" are the same thing to the page, and both must mean `not_loaded`.
  if ('evidenceVault' in opts) body.evidenceVault = opts.evidenceVault
  return body
}

/** The governed marketplace detail. `media` is built from the same `listing_images` rows as the card. */
function detailFixture(media: unknown[] | undefined) {
  return {
    vin: VIN,
    make: 'Toyota',
    model: 'Corolla',
    year: 2018,
    price: 12500,
    currency: 'USD',
    mileage: 45000,
    status: 'available',
    location: 'Harare',
    created_at: '2026-06-01T00:00:00.000Z',
    ...(media === undefined ? {} : { media }),
    seller_summary: { display_label: 'Harare Motors', seller_type: 'dealer', public_profile_enabled: true },
    trust_summary: {},
    verification_summary: {},
    pricing_summary: {},
    safety_warnings: [],
  }
}

const image = (url: string, extra: Record<string, unknown> = {}) => ({ url, type: 'image', ...extra })

/** A verified, public-safe evidence row carrying the internal identity that must never be published. */
function evidenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ev-73',
    vin: VIN,
    evidence_type: 'inspection_report',
    evidence_class: 'roadworthiness',
    evidence_subtype: null,
    event_type: 'inspection',
    event_date: '2026-05-02T00:00:00.000Z',
    captured_at: '2026-05-02T00:00:00.000Z',
    uploaded_at: '2026-05-03T00:00:00.000Z',
    verified_at: '2026-05-04T00:00:00.000Z',
    verification_status: 'verified',
    visibility_level: 'public_safe',
    file_url: 'https://cdn.carup.dev/evidence/inspection-73.pdf',
    mime_type: 'application/pdf',
    source_name: 'VID Eastlea',
    checksum: 'sha256-abc',
    image_hash: null,
    // ── Internal identity. Phase 0 allow-listed every one of these OUT of public bodies. ──
    uploaded_by: 'IDENTITY-UPLOADER-8a1f',
    verified_by: 'IDENTITY-REVIEWER-4c2d',
    uploader_role: 'IDENTITY-ROLE-inspector',
    tenant_id: 'IDENTITY-TENANT-77b0',
    source_id: 'IDENTITY-SOURCE-31aa',
    file_path: 'IDENTITY-PATH-qa/evidence-73.jpg',
    storage_bucket: 'IDENTITY-BUCKET-vehicle-images',
    verification_notes: 'IDENTITY-NOTES-reviewed by desk 4',
    metadata: { operator: 'IDENTITY-METADATA-desk4' },
    ...overrides,
  }
}

/** Every planted identity value, so a leak of any one of them fails loudly. */
const IDENTITY_VALUES = [
  'IDENTITY-UPLOADER-8a1f', 'IDENTITY-REVIEWER-4c2d', 'IDENTITY-ROLE-inspector',
  'IDENTITY-TENANT-77b0', 'IDENTITY-SOURCE-31aa', 'IDENTITY-PATH-qa/evidence-73.jpg',
  'IDENTITY-BUCKET-vehicle-images', 'IDENTITY-NOTES-reviewed by desk 4',
  'IDENTITY-METADATA-desk4',
]

function servePassport(body: unknown) {
  lookupVehiclePassport.mockResolvedValue(body)
  fetchVehiclePassport.mockResolvedValue(body)
}

/** The marketplace detail resolved with these media rows. */
function serveListingMedia(media: unknown[] | undefined) {
  fetchMarketplaceListingDetail.mockResolvedValue(detailFixture(media))
}

/** The marketplace detail did NOT resolve — so `listing_images` was never consulted. */
function serveNoListingRead() {
  fetchMarketplaceListingDetail.mockRejectedValue(new Error('not a public marketplace listing'))
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

/** Wait until the page has left its loading state and both media blocks exist. */
async function renderSettled() {
  const result = renderDetail()
  await waitFor(() => {
    expect(screen.getByTestId('listing-media-block')).toBeTruthy()
    expect(screen.getByTestId('verified-evidence-block')).toBeTruthy()
  })
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  servePassport(passportFixture({ evidenceVault: [] }))
  fetchVehicle.mockResolvedValue((passportFixture() as { vehicle: unknown }).vehicle)
  serveListingMedia([image(CARD_IMAGE)])
  fetchSavedMarketplaceListings.mockResolvedValue({ listings: [] })
  fetchEvidenceTaxonomy.mockResolvedValue({ classes: [] })
  fetchEvidenceSources.mockResolvedValue({ sources: [] })
  fetchTemporalFindings.mockResolvedValue({ findings: [] })
  fetchDisclosureConflicts.mockResolvedValue({ conflicts: [] })
  fetchVehicleReport.mockResolvedValue(null)
  fetchVehicleTrustDecision.mockResolvedValue({ decision: null })
  fetchVehicleSourceCoverage.mockResolvedValue({ sources: [] })
})

// ────────────────────────────────────────────────────────────────────────────
describe('VehicleDetail — a photo on the Marketplace card is a photo on this page', () => {
  it('renders the listing image on the passport early-return path, which is where the defect lived', async () => {
    // The passport resolves, so `load()` sets the vehicle and RETURNS. Under the shipped code that
    // was the page's final answer, and it contained no photo.
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(lookupVehiclePassport).toHaveBeenCalled()
    expect(screen.getByTestId('vehicle-image').getAttribute('src')).toBe(CARD_IMAGE)
    expect(screen.queryByTestId('no-images-placeholder')).toBeNull()
  })

  it('takes the gallery from the listing rows, never from the passport vehicle’s images key', async () => {
    // `vehicle.images` is planted with a value the page must not use. It is not a real passport key;
    // reading it is what produced an empty gallery, and reading it again would produce a wrong one.
    const { container } = await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(container.innerHTML).not.toContain(PASSPORT_GHOST_IMAGE)
    expect(screen.getByTestId('vehicle-image').getAttribute('src')).toBe(CARD_IMAGE)
  })

  it('renders every listing photo, with thumbnails and a counter', async () => {
    serveListingMedia([image(CARD_IMAGE), image(SECOND_IMAGE)])
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    const block = screen.getByTestId('listing-media-block').innerHTML
    expect(block).toContain(CARD_IMAGE)
    expect(block).toContain(SECOND_IMAGE)
    expect(screen.getByTestId('image-gallery').textContent).toContain('1 / 2')
  })

  it('no longer reads a vehicle images array for the gallery anywhere in the source', () => {
    // The proximate cause, removed rather than worked around. `d.images` was read on BOTH load
    // branches and `vehicleFromMarketplaceDetail` flattened `media` into a second lossy copy.
    expect(DETAIL_CODE).not.toMatch(/d\.images/)
    expect(DETAIL_CODE).not.toMatch(/vehicle\.images/)
    expect(DETAIL_CODE).not.toMatch(/allImages/)
    // And the gallery is fed by the block, not by a re-derived array.
    expect(DETAIL_CODE).toMatch(/toListingMediaBlock\(/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('VehicleDetail — listing media is never labelled verified', () => {
  it('has removed the shipped sentence from the page entirely', async () => {
    serveListingMedia([])
    const { container } = await renderSettled()

    expect(container.textContent || '').not.toContain(SHIPPED_DEFECT_SENTENCE)
    expect(DETAIL_CODE).not.toContain(SHIPPED_DEFECT_SENTENCE)
  })

  // One test per state rather than one test rendering three times: each state is then reported and
  // budgeted independently, and a failure names the state without needing the loop variable.
  const LISTING_STATES: Array<[string, () => void]> = [
    ['published', () => serveListingMedia([image(CARD_IMAGE)])],
    ['none', () => serveListingMedia([])],
    ['not_loaded', () => serveNoListingRead()],
  ]

  for (const [label, serve] of LISTING_STATES) {
    it(`carries no governance language in the listing block — state ${label}`, async () => {
      serve()
      await renderSettled()
      // `queryByTestId`, not `getByTestId`: the getter THROWS when absent, and exactly one of these
      // two is absent in every state, so a `get || get` would throw before the fallback was reached.
      await waitFor(() => {
        const rendered = screen.queryByTestId('vehicle-image') ?? screen.queryByTestId('no-images-placeholder')
        expect(rendered, `the gallery rendered nothing in state ${label}`).toBeTruthy()
      })
      // innerHTML, not textContent: an attribute or a class name may not smuggle a claim in either.
      const found = trustLanguageIn(screen.getByTestId('listing-media-block').innerHTML)
      expect(found, `listing block (${label}) must assert no governance: found ${found.join(', ')}`)
        .toEqual([])
    })
  }

  it('does not stamp the Police Checked badge onto the seller’s photo', async () => {
    // The badge is a registry claim about the VEHICLE. Overlaid on the gallery it read as a claim
    // about the picture underneath it, which is the conflation this phase removes. It still renders
    // — it moved to the identity row — so this is a placement assertion, not a deletion.
    servePassport(passportFixture({ evidenceVault: [], policeVerified: true }))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('police-checked-badge')).toBeTruthy())

    expect(screen.getByTestId('listing-media-block').innerHTML).not.toContain('Police Checked')
  })

  it('flags planted governance language, so the guard above is not measuring nothing', async () => {
    await renderSettled()
    // The evidence block's whole job is to speak this language. A scanner silent there would be
    // silent everywhere, and the assertion above would prove nothing.
    expect(trustLanguageIn(screen.getByTestId('verified-evidence-block').innerHTML).length)
      .toBeGreaterThan(0)
    expect(trustLanguageIn('a Verified inspection certificate')).toContain('verif')
    expect(CONTRACT_TRUST_LANGUAGE.length).toBeGreaterThan(5)
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('VehicleDetail — the two empty states are distinct and neither implies the other', () => {
  it('says "no photos" about photos, and says nothing about evidence while doing it', async () => {
    serveListingMedia([])
    servePassport(passportFixture({ evidenceVault: [evidenceRow()] }))
    const { container } = await renderSettled()
    await waitFor(() => expect(screen.getByTestId('listing-media-empty')).toBeTruthy())

    expect(screen.getByTestId('listing-media-empty').textContent).toContain(CONTRACT_LISTING_EMPTY)
    // A vehicle with evidence and no photos is ordinary. The evidence sentence must NOT appear.
    expect(container.textContent || '').not.toContain(CONTRACT_EVIDENCE_EMPTY)
    expect(screen.getByTestId('verified-evidence-list')).toBeTruthy()
  })

  it('says "no verified evidence" about evidence, and says nothing about photos while doing it', async () => {
    serveListingMedia([image(CARD_IMAGE)])
    servePassport(passportFixture({ evidenceVault: [] }))
    const { container } = await renderSettled()
    await waitFor(() => expect(screen.getByTestId('verified-evidence-empty')).toBeTruthy())

    expect(screen.getByTestId('verified-evidence-empty').textContent).toContain(CONTRACT_EVIDENCE_EMPTY)
    expect(container.textContent || '').not.toContain(CONTRACT_LISTING_EMPTY)
    expect(screen.getByTestId('vehicle-image')).toBeTruthy()
  })

  it('states both, separately, when a vehicle has neither', async () => {
    serveListingMedia([])
    servePassport(passportFixture({ evidenceVault: [] }))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('listing-media-empty')).toBeTruthy())

    expect(screen.getByTestId('listing-media-empty').textContent).toContain(CONTRACT_LISTING_EMPTY)
    expect(screen.getByTestId('verified-evidence-empty').textContent).toContain(CONTRACT_EVIDENCE_EMPTY)
    // Two findings, two sentences. One sentence answering both is what shipped.
    expect(CONTRACT_LISTING_EMPTY).not.toBe(CONTRACT_EVIDENCE_EMPTY)
  })

  it('uses the contract’s sentences verbatim rather than wording of its own', () => {
    // The mirror is checked against the module it mirrors. "No verified images uploaded yet" was
    // authored in this .tsx file, which is exactly how a gallery came to publish a finding about
    // governance; the wording now belongs to the contract and drift fails here.
    expect(DETAIL_SRC).toContain(`const LISTING_MEDIA_EMPTY_STATEMENT = '${CONTRACT_LISTING_EMPTY}'`)
    expect(DETAIL_SRC).toContain(`const VERIFIED_EVIDENCE_EMPTY_STATEMENT = '${CONTRACT_EVIDENCE_EMPTY}'`)
    // ANTI-VACUITY, RE-PINNED TO THE CURRENT CONTRACT. Two lines above compare the page against the
    // module; these two exist so the pair cannot drift TOGETHER into something nobody chose. The
    // listing sentence changed at the contract under Rule 1b — an unpublished listing's gallery is
    // now gated, and the gated block is byte-identical to a published-and-empty one, so the sentence
    // had to stop asserting the seller's behaviour and state only that nothing is published. The
    // literal is updated to the new text rather than removed: without it, a future edit that changed
    // both the module and the page would still pass.
    expect(CONTRACT_LISTING_EMPTY).toBe('No photos are published for this listing.')
    expect(CONTRACT_EVIDENCE_EMPTY).toBe('No verified evidence has been published for this vehicle.')
    // And the page must not restate the withdrawn claim in its own supporting copy — which is
    // exactly where it survived: "The seller has not added any photos." sat one line below the
    // corrected sentence.
    expect(DETAIL_CODE).not.toMatch(/seller has not added/i)
    expect(DETAIL_CODE).not.toMatch(/have been added to this listing/i)
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('VehicleDetail — a source this page never read may not be reported as empty', () => {
  it('reports not_loaded, not "no photos", when the listing read did not resolve', async () => {
    // THE ORIGINAL DEFECT AS A STATE. A passport-only vehicle has no marketplace detail, so
    // `listing_images` is never consulted. The page used to answer that with a confident negative
    // about a table it had never queried.
    serveNoListingRead()
    const { container } = await renderSettled()
    await waitFor(() => expect(screen.getByTestId('no-images-placeholder')).toBeTruthy())

    expect(screen.getByTestId('no-images-placeholder').getAttribute('data-media-state')).toBe('not_loaded')
    expect(screen.getByTestId('listing-media-not-loaded')).toBeTruthy()
    expect(screen.queryByTestId('listing-media-empty')).toBeNull()
    expect(container.textContent || '').not.toContain(CONTRACT_LISTING_EMPTY)
  })

  it('reports not_loaded for evidence when the passport body carried no evidenceVault key', async () => {
    // Same rule, other table. `?? []` on a body that never carried the key would turn "we did not
    // read it" into "this vehicle has none" — the gallery's defect, one table over.
    servePassport(passportFixture())
    const { container } = await renderSettled()
    await waitFor(() => expect(screen.getByTestId('verified-evidence-not-loaded')).toBeTruthy())

    expect(screen.queryByTestId('verified-evidence-empty')).toBeNull()
    expect(container.textContent || '').not.toContain(CONTRACT_EVIDENCE_EMPTY)
  })

  it('distinguishes an empty array from an absent one for both blocks', async () => {
    // `[]` means the source was consulted and holds nothing. That IS a finding and gets a sentence.
    serveListingMedia([])
    servePassport(passportFixture({ evidenceVault: [] }))
    const consulted = await renderSettled()
    await waitFor(() => expect(screen.getByTestId('listing-media-empty')).toBeTruthy())
    expect(screen.getByTestId('no-images-placeholder').getAttribute('data-media-state')).toBe('none')
    expect(screen.getByTestId('verified-evidence-empty')).toBeTruthy()
    consulted.unmount()

    serveNoListingRead()
    servePassport(passportFixture())
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('listing-media-not-loaded')).toBeTruthy())
    expect(screen.getByTestId('no-images-placeholder').getAttribute('data-media-state')).toBe('not_loaded')
    expect(screen.getByTestId('verified-evidence-not-loaded')).toBeTruthy()
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('VehicleDetail — evidence renders as a governed artifact, never as an identity', () => {
  it('publishes no uploader, reviewer, tenant, path, notes or metadata', async () => {
    servePassport(passportFixture({ evidenceVault: [evidenceRow()] }))
    const { container } = await renderSettled()
    await waitFor(() => expect(screen.getByTestId('verified-evidence-item')).toBeTruthy())

    for (const planted of IDENTITY_VALUES) {
      expect(container.innerHTML, `evidence must not publish ${planted}`).not.toContain(planted)
    }
    // Non-vacuous: the row DID render, so the absence above is a projection, not an empty page.
    expect(screen.getByTestId('verified-evidence-item').textContent).toContain('VID Eastlea')
  })

  it('builds an evidence item field by field, and never by spreading the row', () => {
    /*
     * This one is asserted on the SOURCE, deliberately, and the reason is worth recording: it was
     * found by mutation. Replacing the allow-list loop with `{ ...row }` leaves the rendered page
     * BYTE-IDENTICAL — the renderer reads named fields, so no uploader id reaches the DOM either
     * way — and the identity assertion above passed against the mutant. The DOM genuinely cannot
     * tell the difference, which is precisely why the guarantee has to be structural: the moment a
     * later edit maps over an item's keys, dumps it into a `title`, or serialises it for a
     * download, a spread item leaks `uploaded_by`, `verified_by`, `tenant_id`, `verification_notes`,
     * `file_path`, `storage_bucket` and `metadata` all at once.
     */
    const projection = /function pickPublicEvidenceFields\([\s\S]*?\n}/.exec(DETAIL_CODE)
    expect(projection, 'pickPublicEvidenceFields not found').toBeTruthy()
    const body = (projection as RegExpExecArray)[0]

    expect(body, 'the evidence item must not be built by spreading the raw row')
      .not.toMatch(/\.\.\.\s*\(?\s*(row|source|entry)\b/)
    expect(body).toMatch(/for \(const field of VEHICLE_DETAIL_EVIDENCE_FIELDS\)/)
    // And BOTH transports go through it, so there is one allow-list, not one per read path.
    expect(DETAIL_CODE.match(/pickPublicEvidenceFields\(/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('publishes only fields Phase 0 already cleared', async () => {
    const fields = detailEvidenceFields()
    expect(fields.length).toBeGreaterThan(10)
    for (const field of fields) {
      expect(PHASE0_EVIDENCE_FIELDS, `${field} is not in Phase 0's public evidence allow-list`)
        .toContain(field)
    }
    // Narrowing is safe; widening is not. The page may publish a subset and never a superset.
    for (const withheld of ['uploaded_by', 'verified_by', 'tenant_id', 'file_path', 'storage_bucket', 'metadata']) {
      expect(fields).not.toContain(withheld)
      expect(PHASE0_EVIDENCE_FIELDS).not.toContain(withheld)
    }
  })

  it('keeps the two item shapes key-disjoint, which is what makes them unconflatable', () => {
    const evidenceFields = [...detailEvidenceFields(), 'file_url_form']
    // CORRECTED, AND STRENGTHENED: this list used to be a hardcoded copy of the listing item shape,
    // which meant the page's disjointness could drift from the contract's without failing anything.
    // It is now read out of the backend contract itself, so adding a key on either side is checked
    // here rather than assumed. (It gained `media_id` in the stable-identity change.)
    const listingFields = exportedStringArray(CONTRACT_SRC, 'LISTING_MEDIA_ITEM_FIELDS')
    expect(listingFields).toContain('media_id')
    // The identity is `media_id` and NOT `id` precisely because `id` is already the first field of
    // Phase 0's evidence allow-list; one key name on both shapes would end the disjointness proof.
    expect(PHASE0_EVIDENCE_FIELDS).toContain('id')
    expect(listingFields).not.toContain('id')
    const shared = evidenceFields.filter((f) => listingFields.includes(f))
    expect(shared, 'a shared key name is how the two concepts start being read as one').toEqual([])
    // Specifically: the evidence classification is `file_url_form`, not `url_form`.
    expect(evidenceFields).toContain('file_url_form')
    expect(evidenceFields).not.toContain('url_form')
  })

  it('renders evidence as records, distinct from the photo carousel', async () => {
    servePassport(passportFixture({ evidenceVault: [evidenceRow()] }))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('verified-evidence-item')).toBeTruthy())

    const item = screen.getByTestId('verified-evidence-item')
    expect(item.textContent).toContain('Inspection report')
    expect(screen.getByTestId('verified-evidence-status').textContent).toMatch(/verified/i)
    // Provenance a buyer can act on; a date that was never recorded says so.
    expect(screen.getByTestId('verified-evidence-provenance').textContent).toMatch(/Captured .*reviewed /)
    // The evidence list is not the gallery, and the gallery is not the evidence list.
    expect(screen.getByTestId('listing-media-block').innerHTML).not.toContain('verified-evidence-item')
    expect(screen.getByTestId('verified-evidence-block').innerHTML).not.toContain('vehicle-image')
  })

  it('states that a recorded date is missing rather than back-filling it', async () => {
    servePassport(passportFixture({
      evidenceVault: [evidenceRow({ captured_at: null, verified_at: null, source_name: null })],
    }))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('verified-evidence-provenance')).toBeTruthy())

    const provenance = screen.getByTestId('verified-evidence-provenance').textContent || ''
    expect(provenance).toContain('Captured not recorded')
    expect(provenance).toContain('reviewed not recorded')
    expect(provenance).toContain('source not recorded')
    // `uploaded_at` exists on the row and is NOT a capture time. Substituting it would fabricate one.
    expect(provenance).not.toContain('2026')
  })

  it('applies the public gate: unverified and non-public rows do not reach a buyer', async () => {
    servePassport(passportFixture({
      evidenceVault: [
        evidenceRow({ id: 'ev-pending', verification_status: 'pending', file_url: 'https://cdn.carup.dev/evidence/pending.pdf' }),
        evidenceRow({ id: 'ev-restricted', visibility_level: 'restricted', file_url: 'https://cdn.carup.dev/evidence/restricted.pdf' }),
        // Neither column present at all. Absence is not permission — and this is also what stops a
        // `listing_images` row, which has neither column, from being rendered as evidence.
        { id: 'ev-bare', file_url: 'https://cdn.carup.dev/evidence/bare.pdf' },
      ],
    }))
    const { container } = await renderSettled()
    await waitFor(() => expect(screen.getByTestId('verified-evidence-empty')).toBeTruthy())

    expect(screen.queryAllByTestId('verified-evidence-item')).toHaveLength(0)
    expect(container.innerHTML).not.toContain('pending.pdf')
    expect(container.innerHTML).not.toContain('restricted.pdf')
    expect(container.innerHTML).not.toContain('bare.pdf')
    // A withheld row is not counted anywhere: "3 withheld" would tell a visitor that restricted
    // evidence exists, which is the question the gate refuses to answer.
    expect(screen.queryByTestId('verified-evidence-unpublishable')).toBeNull()
  })

  it('says a dealer-listing artifact attests the advertisement, not the vehicle', async () => {
    servePassport(passportFixture({
      evidenceVault: [evidenceRow({
        evidence_type: 'dealer_listing_photo',
        evidence_class: 'dealer_listing',
        evidence_subtype: 'listing_photograph',
        mime_type: 'image/jpeg',
      })],
    }))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('verified-evidence-advertisement-note')).toBeTruthy())

    expect(screen.getByTestId('verified-evidence-advertisement-note').textContent)
      .toMatch(/attests the\s+advertisement, not the vehicle/)
    // It stays in the evidence block and is never copied into the gallery: the gallery is the
    // seller's CURRENT presentation, and a captured historical advertisement is not that.
    expect(screen.getByTestId('listing-media-block').innerHTML).not.toContain('inspection-73')
  })

  it('shows no advertisement note on ordinary evidence', async () => {
    servePassport(passportFixture({ evidenceVault: [evidenceRow()] }))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('verified-evidence-item')).toBeTruthy())

    expect(screen.queryByTestId('verified-evidence-advertisement-note')).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('VehicleDetail — url honesty and the seller’s own choices', () => {
  it('counts a photo it cannot publish instead of dropping it', async () => {
    serveListingMedia([
      image(CARD_IMAGE),
      image('data:image/png;base64,AAAA'),
      image('photo.jpg'),
      image(''),
    ])
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('listing-media-unpublishable')).toBeTruthy())

    expect(screen.getByTestId('listing-media-unpublishable').textContent).toContain('3 recorded photo(s)')
    // A short gallery that hid what it could not render would pass our defect off as the seller's
    // omission — the same lie as the empty-state sentence, one layer down.
    expect(screen.getByTestId('vehicle-image').getAttribute('src')).toBe(CARD_IMAGE)
  })

  it('reports "none" with a non-zero count when every recorded photo is unpublishable', async () => {
    serveListingMedia([image('javascript:alert(1)'), image('blob:https://x/y')])
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('listing-media-empty')).toBeTruthy())

    expect(screen.getByTestId('listing-media-unpublishable').textContent).toContain('2 recorded photo(s)')
    expect(screen.getByTestId('listing-media-empty').textContent).toContain(CONTRACT_LISTING_EMPTY)
  })

  it('classifies the string, and publishes a site-relative path as what it is', async () => {
    // All three listing rows on staging are site-relative (`/uat/owner/…`) and dangle. The contract
    // publishes them and says what form they are; it does not pretend they resolve.
    serveListingMedia([image('/uat/owner/toyota-corolla.svg')])
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(screen.getByTestId('vehicle-image').getAttribute('data-url-form')).toBe('site_relative')
  })

  it('honours a primacy claim once and invents one never', async () => {
    serveListingMedia([image(SECOND_IMAGE), image(CARD_IMAGE, { is_primary: true })])
    const claimed = await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())
    // The seller's claim wins position 0 even though the payload listed it second.
    expect(screen.getByTestId('vehicle-image').getAttribute('src')).toBe(CARD_IMAGE)
    expect(screen.getByTestId('listing-media-primary')).toBeTruthy()
    claimed.unmount()

    serveListingMedia([image(CARD_IMAGE), image(SECOND_IMAGE)])
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())
    // Nobody claimed primacy, so no photo is the seller's "main" one. Electing `sorted[0]` — which
    // `buildMarketplaceListingSummary` still does for its own `primary_image_url` — would publish a
    // choice the seller never made.
    expect(screen.queryByTestId('listing-media-primary')).toBeNull()
    expect(screen.getByTestId('vehicle-image').getAttribute('src')).toBe(CARD_IMAGE)
  })

  it('ignores non-image media without counting it as a fault', async () => {
    serveListingMedia([image(CARD_IMAGE), { url: 'https://cdn.carup.dev/x.mp4', type: 'video' }])
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(screen.getByTestId('listing-media-block').innerHTML).not.toContain('x.mp4')
    // A video is not a broken photo. Counting it would overstate a fault that does not exist.
    expect(screen.queryByTestId('listing-media-unpublishable')).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('VehicleDetail — the contract reaches this page by two transports', () => {
  /** The canonical block as `buildVehiclePassport` now spreads it onto the passport body. */
  const listingBlock = (items: unknown[], state = 'published', unpublishable = 0) => ({
    state, items, unpublishable_count: unpublishable, empty_statement: state === 'none' ? CONTRACT_LISTING_EMPTY : null,
  })
  const evidenceBlock = (items: unknown[], state = 'published', unpublishable = 0) => ({
    state, items, unpublishable_count: unpublishable, empty_statement: state === 'none' ? CONTRACT_EVIDENCE_EMPTY : null,
  })

  it('answers for a vehicle with no marketplace listing at all, which the fallback cannot', async () => {
    // This is the case the derived transport can only ever call `not_loaded`: no public listing, so
    // no marketplace detail, so nothing on this page had read `listing_images` before the passport
    // started carrying the block.
    serveNoListingRead()
    servePassport({
      ...passportFixture({ evidenceVault: [] }),
      listing_media: listingBlock([{ url: CARD_IMAGE, url_form: 'absolute_https', position: 0, is_primary: true }]),
    })
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(screen.getByTestId('vehicle-image').getAttribute('src')).toBe(CARD_IMAGE)
    expect(screen.getByTestId('listing-media-primary')).toBeTruthy()
    expect(screen.queryByTestId('listing-media-not-loaded')).toBeNull()
  })

  it('falls back to the marketplace detail when the passport carries no media keys', async () => {
    // A server that has not been updated. BOTH KEYS ABSENT is not an empty gallery.
    servePassport(passportFixture({ evidenceVault: [] }))
    serveListingMedia([image(CARD_IMAGE)])
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(screen.getByTestId('vehicle-image').getAttribute('src')).toBe(CARD_IMAGE)
  })

  it('refuses a block with no state discriminator and falls back rather than publishing it', async () => {
    // `state` is required, exactly as `evaluation_state` is for the trust projection. A shape
    // without it parses as NOTHING — it must not be read as an empty gallery.
    servePassport({
      ...passportFixture({ evidenceVault: [] }),
      listing_media: { items: [], unpublishable_count: 0, empty_statement: 'anything at all' },
    })
    serveListingMedia([image(SECOND_IMAGE)])
    const { container } = await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(screen.getByTestId('vehicle-image').getAttribute('src')).toBe(SECOND_IMAGE)
    expect(container.textContent || '').not.toContain('anything at all')
  })

  it('prefers the transport that actually looked, never a not_loaded one', async () => {
    servePassport({
      ...passportFixture({ evidenceVault: [] }),
      listing_media: listingBlock([], 'not_loaded'),
    })
    serveListingMedia([image(CARD_IMAGE)])
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    // Preferring the passport's `not_loaded` over a detail that DID read the table would reinstate
    // the defect with extra steps.
    expect(screen.getByTestId('vehicle-image').getAttribute('src')).toBe(CARD_IMAGE)
  })

  it('reports not_loaded only when neither transport looked', async () => {
    servePassport({
      ...passportFixture(),
      listing_media: listingBlock([], 'not_loaded'),
      verified_evidence: evidenceBlock([], 'not_loaded'),
    })
    serveNoListingRead()
    const { container } = await renderSettled()
    await waitFor(() => expect(screen.getByTestId('listing-media-not-loaded')).toBeTruthy())

    expect(screen.getByTestId('verified-evidence-not-loaded')).toBeTruthy()
    expect(container.textContent || '').not.toContain(CONTRACT_LISTING_EMPTY)
    expect(container.textContent || '').not.toContain(CONTRACT_EVIDENCE_EMPTY)
  })

  it('re-picks the allow-list off the wire, so a regressed server cannot push an identity through', async () => {
    // The canonical block is already allow-listed server-side. It is re-picked anyway: a canonical
    // ENVELOPE is not a reason to render whatever the items happen to contain.
    servePassport({
      ...passportFixture(),
      verified_evidence: evidenceBlock([{
        ...evidenceRow(),
        file_url_form: 'absolute_https',
      }]),
    })
    const { container } = await renderSettled()
    await waitFor(() => expect(screen.getByTestId('verified-evidence-item')).toBeTruthy())

    for (const planted of IDENTITY_VALUES) {
      expect(container.innerHTML, `the wire must not carry ${planted} onto the page`).not.toContain(planted)
    }
    expect(screen.getByTestId('verified-evidence-item').textContent).toContain('VID Eastlea')
  })

  it('re-classifies URLs off the wire and counts what it will not publish', async () => {
    servePassport({
      ...passportFixture({ evidenceVault: [] }),
      listing_media: listingBlock([
        { url: CARD_IMAGE, url_form: 'absolute_https', position: 0, is_primary: false },
        // A canonical envelope claiming a form it does not have. The string is what decides.
        { url: 'javascript:alert(1)', url_form: 'absolute_https', position: 1, is_primary: false },
      ]),
    })
    serveNoListingRead()
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(screen.getByTestId('vehicle-image').getAttribute('src')).toBe(CARD_IMAGE)
    expect(screen.getByTestId('listing-media-unpublishable').textContent).toContain('1 recorded photo(s)')
  })

  it('downgrades a canonical "published" to "none" when nothing in it survives our own checks', async () => {
    // Found by mutation: `stateFor` returning the envelope's state verbatim kept every one of the
    // other tests green, because they all leave at least one publishable item. The state that
    // matters is the one where NONE survives — a block reporting `published` with an empty list
    // would then render the `not_loaded` copy, telling a buyer this page never looked at a gallery
    // it had in fact read and rejected.
    servePassport({
      ...passportFixture({ evidenceVault: [] }),
      listing_media: listingBlock([
        { url: 'javascript:alert(1)', url_form: 'absolute_https', position: 0, is_primary: false },
        { url: 'data:image/png;base64,AAAA', url_form: 'absolute_https', position: 1, is_primary: false },
      ]),
    })
    serveNoListingRead()
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('listing-media-empty')).toBeTruthy())

    expect(screen.getByTestId('no-images-placeholder').getAttribute('data-media-state')).toBe('none')
    expect(screen.queryByTestId('listing-media-not-loaded')).toBeNull()
    expect(screen.getByTestId('listing-media-unpublishable').textContent).toContain('2 recorded photo(s)')
  })

  it('renders the contract sentence, not a sentence the server supplied', async () => {
    servePassport({
      ...passportFixture(),
      listing_media: { state: 'none', items: [], unpublishable_count: 0, empty_statement: SHIPPED_DEFECT_SENTENCE },
      verified_evidence: evidenceBlock([], 'none'),
    })
    serveNoListingRead()
    const { container } = await renderSettled()
    await waitFor(() => expect(screen.getByTestId('listing-media-empty')).toBeTruthy())

    // A server-supplied string rendered into a governance-sensitive empty state is how the shipped
    // sentence would come back through a new door.
    expect(container.textContent || '').not.toContain(SHIPPED_DEFECT_SENTENCE)
    expect(screen.getByTestId('listing-media-empty').textContent).toContain(CONTRACT_LISTING_EMPTY)
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('VehicleDetail — Phase 0/3/4 still hold on the page this phase edited', () => {
  it('keeps withheld and unrecorded as different identifier states', async () => {
    servePassport(passportFixture({
      evidenceVault: [],
      identity: { identifiersRedacted: true, chassisNumber: null, engineNumber: null },
    }))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('identity-plate-withheld')).toBeTruthy())

    expect(screen.getByTestId('plate-advisory-withheld')).toBeTruthy()
    expect(screen.getAllByTestId('identity-field-withheld').length).toBeGreaterThan(0)
    // Colour is public, so its absence can only mean unrecorded — never withheld.
    expect(screen.getAllByTestId('identity-field-unrecorded').length).toBeGreaterThan(0)
  })

  it('keeps the canonical trust projection as the only trust input', async () => {
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('trust-score-label')).toBeTruthy())

    expect(screen.queryByTestId('trust-score-value')).toBeNull()
    expect(screen.getByTestId('trust-score-label').textContent).toMatch(/Not evaluated/i)
    expect(screen.getByTestId('trust-score-badge').textContent).not.toMatch(/\d/)
  })

  it('keeps the transaction controls failing closed without a resolved seller', async () => {
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('reserve-unavailable')).toBeTruthy())

    expect(screen.getByTestId('seller-contact-unavailable')).toBeTruthy()
  })

  it('keeps the de-fabricated seller state', async () => {
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('seller-name')).toBeTruthy())

    // No passport ownership record and no tenant: "Not recorded", never an invented label.
    expect(screen.getByTestId('seller-name').textContent).toMatch(/Not recorded/i)
    expect(screen.getByTestId('seller-phone-unavailable')).toBeTruthy()
  })
})

// ────────────────────────────────────────────────────────────────────────────
/**
 * STABLE MEDIA IDENTITY on the page (Rule 6b).
 *
 * The page's continuity with the backend was previously proven by comparing rendered URL STRINGS.
 * That is the weaker claim: a URL survives a CDN rewrite, an origin swap or a resize suffix and is
 * still the same photograph, while two different photographs can collide on one site-relative path
 * — and 3 of 3 rows in staging are exactly such paths. `media_id` is `listing_images.id`, so it says
 * WHICH PHOTOGRAPH rather than which characters.
 *
 * The page re-validates it rather than trusting it, on this file's standing rule that nothing
 * crosses the wire unchecked: a regressed server must not be able to put a storage path in the
 * `media_id` slot and have the page adopt it.
 */
describe('VehicleDetail — listing media carries a stable opaque identity', () => {
  const UUID_A = '6a4b5b86-fbf2-448e-856e-9fa14299c2d7'
  const UUID_B = '5596b493-f21a-40eb-aba5-947b26e76cd5'
  const listingBlock = (items: unknown[], state = 'published', unpublishable = 0) => ({
    state, items, unpublishable_count: unpublishable, empty_statement: state === 'none' ? CONTRACT_LISTING_EMPTY : null,
  })
  const passportWithMedia = (items: unknown[]) => ({
    ...passportFixture({ evidenceVault: [] }),
    listing_media: listingBlock(items),
  })

  beforeEach(() => serveNoListingRead())

  it('renders the identity of the photograph on screen', async () => {
    servePassport(passportWithMedia([
      { media_id: UUID_A, url: CARD_IMAGE, url_form: 'absolute_https', position: 0, is_primary: true },
    ]))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(screen.getByTestId('vehicle-image').getAttribute('data-media-id')).toBe(UUID_A)
  })

  it('is STABLE across two independent renders of the same row', async () => {
    const item = { media_id: UUID_A, url: CARD_IMAGE, url_form: 'absolute_https', position: 0, is_primary: true }

    servePassport(passportWithMedia([item]))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())
    const first = screen.getByTestId('vehicle-image').getAttribute('data-media-id')
    cleanup()

    // Second render, same row arriving alongside a NEW sibling that takes slot 0. The photograph
    // moves to position 1; its identity must not move with it.
    servePassport(passportWithMedia([
      { media_id: UUID_B, url: SECOND_IMAGE, url_form: 'absolute_https', position: 0, is_primary: true },
      { ...item, position: 1, is_primary: false },
    ]))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    const thumbs = screen.getAllByTestId('listing-media-thumb')
    const ids = thumbs.map((t) => t.getAttribute('data-media-id'))
    expect(ids).toContain(first)
    expect(first).toBe(UUID_A)
    // ANTI-VACUITY: the photograph genuinely changed slot between the two renders.
    expect(screen.getByTestId('vehicle-image').getAttribute('data-media-id')).toBe(UUID_B)
  })

  it('is DISTINCT per item, so two thumbnails can never be confused', async () => {
    servePassport(passportWithMedia([
      { media_id: UUID_A, url: CARD_IMAGE, url_form: 'absolute_https', position: 0, is_primary: true },
      { media_id: UUID_B, url: SECOND_IMAGE, url_form: 'absolute_https', position: 1, is_primary: false },
    ]))
    await renderSettled()
    await waitFor(() => expect(screen.getAllByTestId('listing-media-thumb').length).toBe(2))

    const ids = screen.getAllByTestId('listing-media-thumb').map((t) => t.getAttribute('data-media-id'))
    expect(new Set(ids).size).toBe(2)
    expect(ids).toEqual([UUID_A, UUID_B])
  })

  it('REFUSES a private locator in the media_id slot — a regressed server cannot plant one', async () => {
    // Every one of these is a real private locator from the two media tables, or a shape that could
    // carry one. None may reach the DOM, and none may be adopted as an identity.
    const LOCATORS = [
      'vehicle-images/qa/evidence-73.jpg',
      'qa/evidence-73.jpg',
      'ocr-documents/private/passport.pdf',
      'tenant-73',
      `${UUID_A}.jpg`,
      '',
    ]
    for (const locator of LOCATORS) {
      servePassport(passportWithMedia([
        { media_id: locator, url: CARD_IMAGE, url_form: 'absolute_https', position: 0, is_primary: true },
      ]))
      await renderSettled()
      await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

      const img = screen.getByTestId('vehicle-image')
      expect(img.getAttribute('data-media-id'), `${locator} was adopted as an identity`).toBeNull()
      // The photo still renders — a bad identity is not a reason to blank the gallery, and it is
      // certainly not a reason to say the seller added no photos.
      expect(img.getAttribute('src')).toBe(CARD_IMAGE)
      expect(screen.queryByTestId('listing-media-empty')).toBeNull()
      const block = screen.getByTestId('listing-media-block')
      expect(block.innerHTML).not.toContain('vehicle-images')
      expect(block.innerHTML).not.toContain('ocr-documents')
      expect(block.innerHTML).not.toContain('tenant-73')
      cleanup()
    }
  })

  it('normalises case, so one photograph is one identity however the server serialised it', async () => {
    servePassport(passportWithMedia([
      { media_id: UUID_A.toUpperCase(), url: CARD_IMAGE, url_form: 'absolute_https', position: 0, is_primary: true },
    ]))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(screen.getByTestId('vehicle-image').getAttribute('data-media-id')).toBe(UUID_A)
  })

  it('says NOTHING rather than fabricating one when the transport carries no identity', async () => {
    // The marketplace fallback: `marketplaceListingDetailService` maps listing_images to
    // {url, type, is_primary} and drops `id`. A synthesised identity would be worse than an absent
    // one, because consumers would trust it.
    fetchMarketplaceListingDetail.mockResolvedValue(detailFixture([image(CARD_IMAGE)]))
    servePassport(passportFixture({ evidenceVault: [] }))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    const img = screen.getByTestId('vehicle-image')
    expect(img.getAttribute('src')).toBe(CARD_IMAGE)
    expect(img.getAttribute('data-media-id')).toBeNull()
  })

  it('keys the gallery on the identity, not on the slot', () => {
    // React reconciles on this key. Keyed on `position`, the previous thumbnail's DOM node and its
    // decoded bitmap are reused for a DIFFERENT photograph whenever the payload re-orders — which is
    // how a gallery briefly shows the wrong car.
    expect(DETAIL_CODE).toContain('key={item.media_id ?? `${item.position}-${item.url}`}')
    expect(DETAIL_CODE).not.toContain('key={`${item.position}-${item.url}`}')
  })

  it('re-validates the identity instead of trusting the wire', () => {
    // The page must own a grammar check. Reading `entry.media_id` straight into the item would let a
    // regressed server choose what the page treats as an identity.
    // CORRECTED SPELLING, SAME PROPERTY. This asserted the literal
    // `media_id: toMediaIdentity(entry.media_id)`, which stopped matching when the reader began
    // binding the identity to a const so the uniqueness check could consult it before the item is
    // built. The property being pinned is that the value is READ from the entry and put through the
    // grammar — never hardcoded — so the call is what to assert, and a hardcoded null is asserted
    // against directly.
    expect(DETAIL_CODE).toContain('toMediaIdentity(entry.media_id)')
    expect(DETAIL_CODE).not.toMatch(/media_id:\s*null/)
    expect(DETAIL_CODE).toMatch(/MEDIA_IDENTITY_PATTERN\s*=\s*\/\^\[0-9a-f\]\{8\}-/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
/**
 * BOTH BLOCKS PUBLISHED AT ONCE — THE STATE THE SUITE DID NOT HAVE.
 *
 * FOUND BY MUTATION, AND THE GAP WAS STRUCTURAL RATHER THAN INCIDENTAL. Merging the evidence block
 * into the gallery (`galleryItems = [...listingMedia.items, ...verifiedEvidence.items]`) SURVIVED
 * the whole web suite — an independent certification measured 942/942 across 95 files with zero
 * named deaths, and the mutation was re-run here against the 52 tests THIS file held, which are the
 * ones that would have to catch it: 52/52 green, both as an append and as a prepend.
 *
 * Not because the page was wrong, but because no test in this repository ever rendered a body with
 * `listing_media` published AND `verified_evidence` published at the same time. `hasListingPhotos`
 * keys off `listingMedia.state`, so an appended artifact never reached a rendered assertion — every
 * existing test either had no evidence to merge (`evidenceVault: []`, which the shared `beforeEach`
 * sets) or no gallery to merge it into (`serveListingMedia([])`, which sends `hasListingPhotos`
 * false and renders the placeholder instead).
 *
 * SEPARATION WAS THEREFORE PROVEN AT THE CONTRACT LAYER AND NOT AT THE RENDER LAYER. The item shapes
 * are key-disjoint by construction and a backend test pins that; but "no key name in common" is a
 * statement about two object literals, and the defect this phase closes was a statement about what a
 * buyer SEES. A gallery that shows an inspection certificate as photo 3 of 3 is the conflation, and
 * disjoint keys do not prevent one array from being concatenated onto another.
 *
 * Every fixture below publishes BOTH, and each test asserts both blocks rendered before asserting
 * what is absent from each — an absence measured on a page that rendered nothing proves nothing.
 */
describe('VehicleDetail — BOTH blocks published at once, which is where a merge would hide', () => {
  const UUID_A = '6a4b5b86-fbf2-448e-856e-9fa14299c2d7'
  const UUID_B = '5596b493-f21a-40eb-aba5-947b26e76cd5'
  const EVIDENCE_URL = 'https://cdn.carup.dev/evidence/inspection-73.pdf'

  const listingBlock = (items: unknown[], state = 'published', unpublishable = 0) => ({
    state, items, unpublishable_count: unpublishable, empty_statement: state === 'none' ? CONTRACT_LISTING_EMPTY : null,
  })
  const evidenceBlock = (items: unknown[], state = 'published', unpublishable = 0) => ({
    state, items, unpublishable_count: unpublishable, empty_statement: state === 'none' ? CONTRACT_EVIDENCE_EMPTY : null,
  })

  const photo = (media_id: string, url: string, position: number, is_primary = false) =>
    ({ media_id, url, url_form: 'absolute_https', position, is_primary })
  const artifact = (overrides: Record<string, unknown> = {}) =>
    ({ ...evidenceRow(overrides), file_url_form: 'absolute_https' })

  /** Both canonical blocks on one passport body. The marketplace read is switched off entirely so
   *  the only inputs are the two blocks under test. */
  const bothPublished = (photos: unknown[], artifacts: unknown[]) => ({
    ...passportFixture(),
    listing_media: listingBlock(photos),
    verified_evidence: evidenceBlock(artifacts),
  })

  beforeEach(() => serveNoListingRead())

  it('the gallery holds ONLY listing photos when BOTH blocks are published', async () => {
    servePassport(bothPublished(
      [photo(UUID_A, CARD_IMAGE, 0, true), photo(UUID_B, SECOND_IMAGE, 1)],
      [artifact()],
    ))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    // ANTI-VACUITY FIRST: the evidence block really did publish an item, so everything asserted
    // absent below is absent from a page that had something to conflate.
    expect(screen.getAllByTestId('verified-evidence-item')).toHaveLength(1)

    const gallery = screen.getByTestId('image-gallery')
    // The counter is the arithmetic of the merge: two photos plus one artifact reads "1 / 3".
    expect(gallery.textContent).toContain('1 / 2')
    // The frame holds the seller's own first photo — not an artifact that has no `url` key at all.
    const active = screen.getByTestId('vehicle-image')
    expect(active.getAttribute('src')).toBe(CARD_IMAGE)
    expect(active.getAttribute('data-media-id')).toBe(UUID_A)
    expect(active.getAttribute('data-url-form')).toBe('absolute_https')

    // The thumbnail strip is the gallery's own census: exactly the two photographs, named.
    const thumbs = screen.getAllByTestId('listing-media-thumb')
    expect(thumbs).toHaveLength(2)
    expect(thumbs.map((t) => t.getAttribute('data-media-id'))).toEqual([UUID_A, UUID_B])

    // And nothing of the artifact's — neither its file nor its identity — reached the gallery.
    const block = screen.getByTestId('listing-media-block').innerHTML
    expect(block).not.toContain(EVIDENCE_URL)
    expect(block).not.toContain('ev-73')
  })

  it('renders no carousel for a single photo, however many artifacts sit beside it', async () => {
    // A one-photo gallery is where an append is most invisible: the counter and the thumbnail strip
    // both render only when `galleryItems.length > 1`, so a merge does not merely mis-count here —
    // it MANUFACTURES a carousel over a listing that has one picture.
    servePassport(bothPublished(
      [photo(UUID_A, CARD_IMAGE, 0, true)],
      [artifact(), artifact({ id: 'ev-74' }), artifact({ id: 'ev-75' })],
    ))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(screen.getAllByTestId('verified-evidence-item')).toHaveLength(3)
    expect(screen.getByTestId('vehicle-image').getAttribute('src')).toBe(CARD_IMAGE)
    expect(screen.getByTestId('vehicle-image').getAttribute('data-media-id')).toBe(UUID_A)
    expect(screen.queryAllByTestId('listing-media-thumb')).toHaveLength(0)
    expect(screen.getByTestId('image-gallery').textContent).not.toMatch(/1 \/ \d/)
    expect(screen.queryByLabelText('Next photo')).toBeNull()
  })

  it('the evidence list holds ONLY governed artifacts when BOTH blocks are published', async () => {
    // The same separation, proven in the OTHER direction. A photo appended to the evidence list is
    // the worse conflation of the two: it does not merely mis-order a gallery, it publishes a
    // seller's unreviewed advertising picture inside a control that carries a review decision.
    servePassport(bothPublished(
      [photo(UUID_A, CARD_IMAGE, 0, true), photo(UUID_B, SECOND_IMAGE, 1)],
      [artifact()],
    ))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('verified-evidence-item')).toBeTruthy())

    expect(screen.getByTestId('vehicle-image').getAttribute('src')).toBe(CARD_IMAGE)

    expect(screen.getAllByTestId('verified-evidence-item')).toHaveLength(1)
    expect(screen.getByTestId('verified-evidence-item').textContent).toContain('Inspection report')
    expect(screen.getByTestId('verified-evidence-item').textContent).toContain('VID Eastlea')

    const evidence = screen.getByTestId('verified-evidence-block').innerHTML
    expect(evidence).not.toContain(CARD_IMAGE)
    expect(evidence).not.toContain(SECOND_IMAGE)
    expect(evidence).not.toContain(UUID_A)
    expect(evidence).not.toContain(UUID_B)
  })

  it('counts each block’s unpublishable rows against that block alone', async () => {
    // Pooling the counts is a quieter merge than concatenating the items, and it makes the same
    // false statement: "3 recorded photo(s) could not be shown" over a listing that recorded one.
    servePassport({
      ...passportFixture(),
      listing_media: listingBlock([
        photo(UUID_A, CARD_IMAGE, 0, true),
        { media_id: UUID_B, url: 'javascript:alert(1)', url_form: 'absolute_https', position: 1, is_primary: false },
      ]),
      verified_evidence: evidenceBlock([
        artifact(),
        artifact({ id: 'ev-76', file_url: 'data:application/pdf;base64,AAAA' }),
        artifact({ id: 'ev-77', file_url: 'blob:https://x/y' }),
      ]),
    })
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(screen.getByTestId('listing-media-unpublishable').textContent).toContain('1 recorded photo(s)')
    expect(screen.getByTestId('verified-evidence-unpublishable').textContent).toContain('2 reviewed item(s)')
    // Two counts, two nouns, two blocks. The gallery says "photo(s)" and never "item(s)".
    expect(screen.getByTestId('listing-media-unpublishable').textContent).not.toContain('reviewed item')
    expect(screen.getByTestId('verified-evidence-unpublishable').textContent).not.toContain('recorded photo')
  })

  it('keeps the two blocks distinct in the DOM when both are published, not merely in the contract', async () => {
    // Rule 7 is proven on the ITEM SHAPES by the backend contract test. This is the same claim one
    // layer out: the rendered controls do not contain each other, in the state where they both have
    // something to render. Every earlier version of this assertion ran with one block empty.
    servePassport(bothPublished([photo(UUID_A, CARD_IMAGE, 0, true)], [artifact()]))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('verified-evidence-item')).toBeTruthy())

    const listing = screen.getByTestId('listing-media-block').innerHTML
    const evidence = screen.getByTestId('verified-evidence-block').innerHTML
    expect(listing).not.toContain('verified-evidence-item')
    expect(listing).not.toContain('verified-evidence-list')
    expect(evidence).not.toContain('vehicle-image')
    expect(evidence).not.toContain('listing-media-thumb')
    // Neither empty-state sentence may appear on a page where both blocks published something.
    const page = document.body.textContent || ''
    expect(page).not.toContain(CONTRACT_LISTING_EMPTY)
    expect(page).not.toContain(CONTRACT_EVIDENCE_EMPTY)
  })
})

// ────────────────────────────────────────────────────────────────────────────
/**
 * MARKETPLACE → DETAIL CONTINUITY, PROVEN ON THE CLIENT.
 *
 * CORRECTED, AND THE CORRECTION IS THE POINT. `toListingMediaBlock` used to hardcode
 * `media_id: null` with a comment stating that `marketplaceListingDetailService` "maps
 * `listing_images` to `{url, type, is_primary}` and drops `id`". That was true when it was written
 * and it is NOT true at this SHA: the marketplace lane now publishes the canonical `listing_media`
 * envelope on the detail payload AND widens `media` into a compatibility view carrying `media_id`,
 * `url_form` and `position`. The page was discarding an identity that was on the wire.
 *
 * `null` STILL HAS TO MEAN SOMETHING, so it is now READ rather than decided: every transport is
 * asked for `media_id` and `toMediaIdentity` answers. A server that predates the widened view
 * carries none, `toMediaIdentity` refuses what it was given, and the attribute is absent — the same
 * outcome as before, arrived at as a fact about the payload instead of as an assumption about the
 * server. The test below pins WHY it is null, not merely that it is.
 */
describe('VehicleDetail — the marketplace transport names the photograph it publishes', () => {
  const UUID_A = '6a4b5b86-fbf2-448e-856e-9fa14299c2d7'
  const UUID_B = '5596b493-f21a-40eb-aba5-947b26e76cd5'
  /** The same photograph after a CDN rewrite: a different string, the same picture. */
  const REWRITTEN_CARD_IMAGE = 'https://images.carup.dev/w800/JTDKARFP0H3000731/exterior-front.jpg'

  /** The marketplace detail as the service now publishes it: envelope first, compat view derived. */
  function detailWithMedia(items: Array<Record<string, unknown>>, opts: { envelope?: boolean } = {}) {
    const withEnvelope = opts.envelope !== false
    return {
      ...detailFixture(items.map((item) => ({ ...item, type: 'image' }))),
      ...(withEnvelope
        ? { listing_media: { state: 'published', items, unpublishable_count: 0, empty_statement: null } }
        : {}),
    }
  }

  beforeEach(() => {
    // The passport carries NO media keys, so the marketplace detail is the only transport with an
    // answer. That is the arrangement this describe is about.
    servePassport(passportFixture({ evidenceVault: [] }))
  })

  it('reads the identity off the marketplace detail’s canonical envelope', async () => {
    fetchMarketplaceListingDetail.mockResolvedValue(detailWithMedia([
      { media_id: UUID_A, url: CARD_IMAGE, url_form: 'absolute_https', position: 0, is_primary: true },
      { media_id: UUID_B, url: SECOND_IMAGE, url_form: 'absolute_https', position: 1, is_primary: false },
    ]))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(screen.getByTestId('vehicle-image').getAttribute('src')).toBe(CARD_IMAGE)
    expect(screen.getByTestId('vehicle-image').getAttribute('data-media-id')).toBe(UUID_A)
    expect(screen.getAllByTestId('listing-media-thumb').map((t) => t.getAttribute('data-media-id')))
      .toEqual([UUID_A, UUID_B])
  })

  it('reads it off the legacy compatibility array too, when only that key arrives', async () => {
    // A deploy that publishes the widened `media` view without the envelope beside it. The identity
    // is on the wire either way and the page may not throw it away because it came by the older key.
    fetchMarketplaceListingDetail.mockResolvedValue(detailWithMedia([
      { media_id: UUID_A, url: CARD_IMAGE, url_form: 'absolute_https', position: 0, is_primary: true },
    ], { envelope: false }))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(screen.getByTestId('vehicle-image').getAttribute('data-media-id')).toBe(UUID_A)
  })

  it('names the same photograph after a CDN rewrite moves its URL and a sibling moves its slot', async () => {
    // THE CONTINUITY CLAIM, CLIENT-SIDE. Comparing rendered URL STRINGS proves two surfaces printed
    // the same characters; it does not prove they showed the same picture, and on staging every
    // listing row is a site-relative path with no uniqueness constraint behind it. Here the string
    // AND the slot both change between two renders of the one row, and the identity does not.
    fetchMarketplaceListingDetail.mockResolvedValue(detailWithMedia([
      { media_id: UUID_A, url: CARD_IMAGE, url_form: 'absolute_https', position: 0, is_primary: true },
    ]))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())
    const first = screen.getByTestId('vehicle-image').getAttribute('data-media-id')
    const firstUrl = screen.getByTestId('vehicle-image').getAttribute('src')
    cleanup()

    fetchMarketplaceListingDetail.mockResolvedValue(detailWithMedia([
      { media_id: UUID_B, url: SECOND_IMAGE, url_form: 'absolute_https', position: 0, is_primary: true },
      { media_id: UUID_A, url: REWRITTEN_CARD_IMAGE, url_form: 'absolute_https', position: 1, is_primary: false },
    ]))
    await renderSettled()
    await waitFor(() => expect(screen.getAllByTestId('listing-media-thumb').length).toBe(2))

    const thumbs = screen.getAllByTestId('listing-media-thumb')
    const moved = thumbs.find((t) => t.getAttribute('data-media-id') === first)
    expect(moved, 'the photograph lost its name when its URL and slot changed').toBeTruthy()
    expect(first).toBe(UUID_A)
    // ANTI-VACUITY: both the URL and the slot genuinely changed between the two renders, so the
    // identity survived a change rather than merely a repetition.
    expect(firstUrl).toBe(CARD_IMAGE)
    expect((moved as HTMLElement).querySelector('img')?.getAttribute('src')).toBe(REWRITTEN_CARD_IMAGE)
    expect(screen.getByTestId('vehicle-image').getAttribute('data-media-id')).toBe(UUID_B)
  })

  it('says nothing rather than fabricating one, BECAUSE the entry carried no identity to read', async () => {
    // The `null` case is legitimate and must stay — but it is now a READING, not a decision. Both
    // halves are asserted: the DOM says nothing, and the source arrives at that by asking
    // `toMediaIdentity` what the entry carried instead of writing the answer in.
    fetchMarketplaceListingDetail.mockResolvedValue(detailFixture([image(CARD_IMAGE)]))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(screen.getByTestId('vehicle-image').getAttribute('src')).toBe(CARD_IMAGE)
    expect(screen.getByTestId('vehicle-image').getAttribute('data-media-id')).toBeNull()

    // WHY it is null. A hardcoded `media_id: null` is indistinguishable from this in the DOM, which
    // is exactly how a stale comment kept a discarded identity looking correct for a whole phase.
    // Spelling corrected with the uniqueness check (see the note on the canonical reader above);
    // the property — read it, do not decide it — is unchanged and both halves still fail on a
    // hardcoded answer.
    expect(DETAIL_CODE).toContain('toMediaIdentity(row?.media_id)')
    expect(DETAIL_CODE).not.toMatch(/media_id:\s*null/)
  })

  it('REFUSES a private locator in the media_id slot on the marketplace transport too', async () => {
    // The canonical passport transport re-validates the identity. So must this one: a re-projection
    // that trusted the wire would leave one door open on a page whose other door is bolted.
    fetchMarketplaceListingDetail.mockResolvedValue(detailWithMedia([
      { media_id: 'vehicle-images/qa/evidence-73.jpg', url: CARD_IMAGE, url_form: 'absolute_https', position: 0, is_primary: true },
    ], { envelope: false }))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    const img = screen.getByTestId('vehicle-image')
    expect(img.getAttribute('data-media-id')).toBeNull()
    // The photo still renders. A bad identity is not a reason to blank a gallery, and it is
    // certainly not a reason to tell a buyer the seller added no photos.
    expect(img.getAttribute('src')).toBe(CARD_IMAGE)
    expect(screen.queryByTestId('listing-media-empty')).toBeNull()
    expect(screen.getByTestId('listing-media-block').innerHTML).not.toContain('vehicle-images')
  })

  it('normalises case on the marketplace transport, so one photograph is one identity', async () => {
    fetchMarketplaceListingDetail.mockResolvedValue(detailWithMedia([
      { media_id: UUID_A.toUpperCase(), url: CARD_IMAGE, url_form: 'absolute_https', position: 0, is_primary: true },
    ], { envelope: false }))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(screen.getByTestId('vehicle-image').getAttribute('data-media-id')).toBe(UUID_A)
  })

  it('keeps the marketplace envelope’s "we did not look" instead of demoting it to "no photos"', async () => {
    // FOUND BY MUTATION ON THIS LANE'S OWN WIRING, AND IT WAS A REAL DEFECT, NOT A MISSING TEST.
    // `marketplaceListingDetailService` publishes the envelope AND derives `media` from it — and it
    // says so in its own header: "`not_loaded` cannot be expressed in an array, so it arrives here
    // as `[]` — indistinguishable from 'no photos' to a consumer reading only this key". A flat
    // three-transport fallback therefore read the envelope's `not_loaded`, skipped it as "did not
    // look", and then answered from the SAME PAYLOAD's `[]` — publishing "No photos have been added
    // to this listing." about a table the request had never successfully read. That is Rule 1's
    // defect restored through the compatibility key.
    //
    // The rule this pins: WITHIN ONE PAYLOAD the envelope is the authority. The array is a strictly
    // weaker view of the same read, so it is a fallback for a payload that has NO envelope, never a
    // second opinion about a payload that has one.
    fetchMarketplaceListingDetail.mockResolvedValue({
      ...detailFixture([]),
      listing_media: { state: 'not_loaded', items: [], unpublishable_count: 0, empty_statement: null },
    })
    const { container } = await renderSettled()
    await waitFor(() => expect(screen.getByTestId('no-images-placeholder')).toBeTruthy())

    expect(screen.getByTestId('no-images-placeholder').getAttribute('data-media-state')).toBe('not_loaded')
    expect(screen.getByTestId('listing-media-not-loaded')).toBeTruthy()
    expect(screen.queryByTestId('listing-media-empty')).toBeNull()
    expect(container.textContent || '').not.toContain(CONTRACT_LISTING_EMPTY)
  })

  it('keeps the envelope’s unpublishable count, which the compatibility array cannot carry', async () => {
    // The other fact the array cannot express. Two rows recorded, neither publishable: the envelope
    // says `none` WITH a count of 2, while `media` is `[]` and says only "none". Answering from the
    // array passes our own inability to render a stored address off as the seller's omission —
    // Rule 5's silent drop, arriving by the compatibility key rather than by a filter.
    fetchMarketplaceListingDetail.mockResolvedValue({
      ...detailFixture([]),
      listing_media: {
        state: 'none', items: [], unpublishable_count: 2, empty_statement: CONTRACT_LISTING_EMPTY,
      },
    })
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('listing-media-empty')).toBeTruthy())

    expect(screen.getByTestId('no-images-placeholder').getAttribute('data-media-state')).toBe('none')
    expect(screen.getByTestId('listing-media-unpublishable').textContent).toContain('2 recorded photo(s)')
    expect(screen.getByTestId('listing-media-empty').textContent).toContain(CONTRACT_LISTING_EMPTY)
  })

  it('prefers the passport’s canonical block over the marketplace one, and reads them with one function', async () => {
    // Three transports, one contract, in declared precedence. The passport is canonical because it
    // can answer for a vehicle with no public listing at all; the marketplace envelope is the same
    // shape read by the same function, which is what stops the two from drifting into two contracts.
    servePassport({
      ...passportFixture({ evidenceVault: [] }),
      listing_media: {
        state: 'published', unpublishable_count: 0, empty_statement: null,
        items: [{ media_id: UUID_B, url: SECOND_IMAGE, url_form: 'absolute_https', position: 0, is_primary: true }],
      },
    })
    fetchMarketplaceListingDetail.mockResolvedValue(detailWithMedia([
      { media_id: UUID_A, url: CARD_IMAGE, url_form: 'absolute_https', position: 0, is_primary: true },
    ]))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())

    expect(screen.getByTestId('vehicle-image').getAttribute('data-media-id')).toBe(UUID_B)
    expect(screen.getByTestId('vehicle-image').getAttribute('src')).toBe(SECOND_IMAGE)
    // Both canonical transports go through the ONE reader; a second parser is a second contract.
    expect(DETAIL_CODE).toContain('readListingMediaBlock(passportMedia?.listing_media)')
    expect(DETAIL_CODE).toContain('readListingMediaBlock(detailMedia?.listing_media)')
  })
})

// ────────────────────────────────────────────────────────────────────────────
/**
 * THE CLIENT MIRROR IS PINNED TO THE BACKEND SOURCE.
 *
 * `web/` resolves only `@/*` and `@shared/*`, so `VehicleDetail.tsx` cannot IMPORT the contract from
 * `backend/`; it mirrors `classifyMediaUrl` and `MEDIA_IDENTITY_PATTERN` instead. Until now the
 * mirror was pinned only where it was made of DATA — the two sentences, `TRUST_LANGUAGE`,
 * `LISTING_MEDIA_ITEM_FIELDS`, `PUBLIC_EVIDENCE_FIELDS` are all asserted against the backend source
 * above. The two pieces of BEHAVIOUR were not pinned at all. They agree today; nothing made them.
 *
 * That is the more dangerous half. A divergence in the sentence list fails a rendered assertion the
 * moment it happens. A divergence in the classifier does not: the server would publish a URL the
 * client silently reclassifies, or the client would adopt an identity the server would have refused,
 * and every existing test would stay green because each side is only ever exercised alone.
 *
 * The pin below reads BOTH implementations out of their source files, evaluates them side by side,
 * and requires identical answers over one shared adversarial table. Source text, not an import,
 * because the import is the thing that is impossible; evaluated behaviour, not a text diff, because
 * the two files legitimately differ in syntax (`MEDIA_URL_FORMS.SITE_RELATIVE` against the literal
 * `'site_relative'`) and a text comparison would fail on formatting while passing on semantics.
 *
 * SCOPE, STATED SO THE PIN IS NOT OVER-READ. It covers `classifyMediaUrl` and the identity grammar —
 * the two functions the client re-implements. It deliberately does NOT claim the two
 * `toListingMediaBlock`s agree: the backend refuses an identity-less row because it reads
 * `listing_images`, where `id` is a stored uuid and its absence means a malformed row; the client
 * keeps the photograph and drops only the name, because it reads a WIRE payload where a server
 * predating the identity legitimately carries none, and blanking those galleries would re-enter the
 * original defect through a new door. That divergence is deliberate, documented at both sites, and
 * asserted below so it cannot be mistaken for drift.
 */
describe('VehicleDetail — the client mirror of the media contract cannot drift silently', () => {
  /**
   * The body of `function <name>(…)`, brace-matched. Quoted strings are skipped so a brace inside a
   * literal cannot unbalance the count. Both bodies are plain expressions and statements — the
   * TypeScript in the client copy is confined to the SIGNATURE, which is why the body is extracted
   * rather than the whole declaration: no type-stripping step is needed, so none can go wrong.
   */
  function functionBody(src: string, name: string): string {
    const pattern = new RegExp(`function ${name}\\s*\\(`, 'g')
    const found = [...src.matchAll(pattern)]
    if (found.length !== 1) throw new Error(`${name}: expected exactly 1 declaration, found ${found.length}`)
    const open = src.indexOf('{', (found[0].index as number) + found[0][0].length)
    if (open === -1) throw new Error(`${name} has no body`)
    let depth = 0
    let quote: string | null = null
    for (let i = open; i < src.length; i += 1) {
      const ch = src[i]
      if (quote) {
        if (ch === '\\') { i += 1; continue }
        if (ch === quote) quote = null
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
      if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) return src.slice(open + 1, i)
      }
    }
    throw new Error(`${name}: unbalanced body`)
  }

  /**
   * The `MEDIA_IDENTITY_PATTERN` regex literal from either source, split into source and flags.
   *
   * Split rather than sliced. The first draft of this helper did `literal.slice(1, -1)`, which
   * removes the leading delimiter and THE FLAG — leaving a stray `/` after the `$` anchor, so both
   * reconstructed patterns matched nothing and the drift comparison passed on two empty answers.
   * The anti-vacuity assertion below is what caught it, which is the entire reason it is there.
   */
  function identityPattern(src: string): { source: string; flags: string } {
    const match = /const MEDIA_IDENTITY_PATTERN = \/(.+)\/([a-z]*)/.exec(src)
    if (!match) throw new Error('MEDIA_IDENTITY_PATTERN literal not found')
    return { source: match[1], flags: match[2] }
  }

  function identityPatternLiteral(src: string): string {
    const { source, flags } = identityPattern(src)
    return `/${source}/${flags}`
  }

  function identityRegExp(src: string): RegExp {
    const { source, flags } = identityPattern(src)
    return new RegExp(source, flags)
  }

  /** The backend's url-form enum, evaluated out of its own source. */
  const MEDIA_URL_FORMS = (() => {
    const match = /export const MEDIA_URL_FORMS = (Object\.freeze\(\{[\s\S]*?\}\));/.exec(CONTRACT_SRC)
    if (!match) throw new Error('MEDIA_URL_FORMS not found in the contract source')
    return new Function(`return ${match[1]}`)() as Record<string, string>
  })()

  type Classifier = (url: unknown) => string | null
  type Identifier = (value: unknown) => string | null

  const backendClassify: Classifier = (() => {
    const body = functionBody(CONTRACT_SRC, 'classifyMediaUrl')
    const fn = new Function('MEDIA_URL_FORMS', 'url', body) as (forms: unknown, url: unknown) => string | null
    return (url: unknown) => fn(MEDIA_URL_FORMS, url)
  })()

  const clientClassify: Classifier = (() => {
    const body = functionBody(DETAIL_SRC, 'classifyMediaUrl')
    return new Function('url', body) as Classifier
  })()

  const backendIdentity: Identifier = (() => {
    const body = functionBody(CONTRACT_SRC, 'toMediaIdentity')
    const fn = new Function('MEDIA_IDENTITY_PATTERN', 'value', body) as (p: RegExp, v: unknown) => string | null
    return (value: unknown) => fn(identityRegExp(CONTRACT_SRC), value)
  })()

  const clientIdentity: Identifier = (() => {
    const body = functionBody(DETAIL_SRC, 'toMediaIdentity')
    const fn = new Function('MEDIA_IDENTITY_PATTERN', 'value', body) as (p: RegExp, v: unknown) => string | null
    return (value: unknown) => fn(identityRegExp(DETAIL_SRC), value)
  })()

  const UUID = '6a4b5b86-fbf2-448e-856e-9fa14299c2d7'

  /**
   * THE SHARED ADVERSARIAL TABLE. Every entry is either a form the contract publishes, a scheme
   * Rule 5 refuses, a shape from the two real media tables, or a boundary between two branches.
   * Both implementations see exactly these and must agree on every one.
   */
  const URL_INPUTS: unknown[] = [
    // The four published forms, each at its boundary.
    'https://cdn.carup.dev/listings/a.jpg', 'HTTPS://CDN.CARUP.DEV/A.JPG',
    'http://cdn.carup.dev/a.jpg', 'HtTp://cdn.carup.dev/a.jpg',
    '//evil.example.test/a.jpg', '///triple.example.test/a.jpg',
    '/uat/owner/toyota-corolla.svg', '/',
    // The ordering trap: `//` must be decided before `/`, or a foreign host publishes as our own.
    '//', '//a',
    // Whitespace, which is trimmed before anything is decided.
    '  https://cdn.carup.dev/a.jpg  ', '\t/uat/owner/a.svg\n', '   ', '',
    // Schemes Rule 5 refuses.
    'data:image/png;base64,AAAA', 'blob:https://carup.dev/8a1f', 'javascript:alert(1)',
    'JavaScript:alert(1)', 'file:///etc/passwd', 'ftp://cdn.carup.dev/a.jpg',
    'mailto:seller@carup.dev', 'about:blank',
    // Path-relative, which resolves against whatever route the viewer is on.
    'photo.jpg', './photo.jpg', '../photo.jpg', 'cdn.carup.dev/a.jpg',
    // A scheme-looking string that is not one, and one that only looks safe.
    'https:/cdn.carup.dev/a.jpg', 'https:cdn.carup.dev/a.jpg', ' https://a.test/x ',
    // Non-strings, which no branch may coerce.
    null, undefined, 0, 1, {}, [], ['https://cdn.carup.dev/a.jpg'], true, NaN,
    { toString: () => 'https://cdn.carup.dev/a.jpg' },
  ]

  /** The identity table: real private locators from both media tables, plus grammar boundaries. */
  const IDENTITY_INPUTS: unknown[] = [
    UUID, UUID.toUpperCase(), `  ${UUID}  `, `${UUID}.jpg`, `${UUID}/thumb`, `x${UUID}`, `${UUID}x`,
    UUID.slice(0, -1), `${UUID}-`, UUID.replace(/-/g, ''),
    '6a4b5b86-fbf2-448e-856e-9fa14299c2dg', '6a4b5b86fbf2448e856e9fa14299c2d7',
    'vehicle-images/qa/evidence-73.jpg', 'qa/evidence-73.jpg', 'ocr-documents/private/passport.pdf',
    'vehicle-images', 'tenant-73', 'ev-73', '', '   ', '00000000-0000-0000-0000-000000000000',
    null, undefined, 0, {}, [], [UUID], true,
  ]

  it('classifies every adversarial URL exactly as the backend contract does', () => {
    const drift: string[] = []
    for (const input of URL_INPUTS) {
      const mine = clientClassify(input)
      const theirs = backendClassify(input)
      if (mine !== theirs) drift.push(`${JSON.stringify(input)}: client=${mine} backend=${theirs}`)
    }
    expect(drift, `the client classifier has drifted from the contract:\n${drift.join('\n')}`).toEqual([])

    // ANTI-VACUITY: agreeing on nothing is not agreement. The table must exercise every branch on
    // both sides, so a classifier that returned `null` for everything could not pass this.
    const answers = new Set(URL_INPUTS.map((i) => String(backendClassify(i))))
    expect([...answers].sort()).toEqual(
      ['absolute_http', 'absolute_https', 'null', 'protocol_relative', 'site_relative'],
    )
    expect(URL_INPUTS.filter((i) => clientClassify(i) !== null).length).toBeGreaterThan(8)
    expect(URL_INPUTS.filter((i) => clientClassify(i) === null).length).toBeGreaterThan(15)
  })

  it('publishes exactly the four url forms the contract names, and no fifth', () => {
    const clientForms = new Set(URL_INPUTS.map(clientClassify).filter((f): f is string => f !== null))
    expect([...clientForms].sort()).toEqual([...Object.values(MEDIA_URL_FORMS)].sort())
    // The page's own union type is the same four names, so a fifth cannot be added on one side.
    const union = /type MediaUrlForm = (.+)/.exec(DETAIL_SRC)
    expect(union, 'MediaUrlForm not found on the page').toBeTruthy()
    const declared = [...(union as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
    expect(declared).toEqual([...Object.values(MEDIA_URL_FORMS)].sort())
  })

  it('applies the identity grammar exactly as the backend contract does', () => {
    // A POSITIVE ANSWER FIRST. Two inert regexes agree on every input by returning `null` to all of
    // them, and that is not a mirror — it is two broken mirrors. The first draft of the extraction
    // helper produced exactly that, and this line is what a repeat of it would hit first.
    expect(clientIdentity(UUID)).toBe(UUID)
    expect(backendIdentity(UUID)).toBe(UUID)

    const drift: string[] = []
    for (const input of IDENTITY_INPUTS) {
      const mine = clientIdentity(input)
      const theirs = backendIdentity(input)
      if (mine !== theirs) drift.push(`${JSON.stringify(input)}: client=${mine} backend=${theirs}`)
    }
    expect(drift, `the client identity grammar has drifted:\n${drift.join('\n')}`).toEqual([])

    // ANTI-VACUITY: the table separates accepted from refused on both sides, so a grammar that
    // refused everything — or accepted everything — could not pass.
    expect(IDENTITY_INPUTS.filter((i) => clientIdentity(i) !== null)).toHaveLength(4)
    expect(IDENTITY_INPUTS.filter((i) => clientIdentity(i) === null).length).toBeGreaterThan(20)
    expect(clientIdentity(UUID.toUpperCase())).toBe(UUID)
  })

  it('mirrors the identity grammar character for character, anchors included', () => {
    // Behaviour over a finite table is the substantive check; the literal is pinned as well because
    // a table cannot enumerate every string, and the anchors are what make "no path, no bucket, no
    // extension" a grammar rather than a habit.
    expect(identityPatternLiteral(DETAIL_SRC)).toBe(identityPatternLiteral(CONTRACT_SRC))
    expect(identityPatternLiteral(DETAIL_SRC)).toMatch(/^\/\^/)
    expect(identityPatternLiteral(DETAIL_SRC)).toMatch(/\$\/i$/)
  })

  it('records the ONE deliberate divergence, so it cannot be mistaken for drift', () => {
    // The backend refuses an identity-less row; the client keeps the photograph and drops the name.
    // Both are correct FOR THEIR INPUT, and the difference is load-bearing: reading a DB row with no
    // `id` means the row is malformed, while reading a wire payload with no `media_id` means the
    // server predates the identity. Asserted here so a future reader does not "fix" one into the
    // other and blank a gallery for every unupgraded deploy.
    const backendBlock = /export function toListingMediaBlock\([\s\S]*?\n}/.exec(CONTRACT_SRC)
    expect(backendBlock, 'backend toListingMediaBlock not found').toBeTruthy()
    expect((backendBlock as RegExpExecArray)[0]).toMatch(/mediaId === null/)

    const clientBlock = /function toListingMediaBlock\([\s\S]*?\n}/.exec(DETAIL_CODE)
    expect(clientBlock, 'client toListingMediaBlock not found').toBeTruthy()
    expect((clientBlock as RegExpExecArray)[0]).not.toMatch(/mediaId === null/)
    // Spelling corrected when the identity gained a const binding; property unchanged.
    expect((clientBlock as RegExpExecArray)[0]).toMatch(/toMediaIdentity\(row\?\.media_id\)/)
    // THE DIVERGENCE IS NOW NARROWER THAN IT WAS, AND THE NARROWING IS PART OF IT. The client
    // adopted the backend's UNIQUENESS rule (Rule 6b) while keeping the null exemption, so the two
    // now differ on exactly one thing: whether an identity-less row is publishable. The exemption
    // must be spelled as a null guard on the collision test, or "unnamed" becomes "already taken"
    // and every pre-identity deploy's gallery blanks from the second photo on.
    expect((clientBlock as RegExpExecArray)[0]).toMatch(/mediaId !== null && identitiesTaken\.has\(mediaId\)/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
/**
 * RULE 6b, THE UNIQUENESS HALF — THE HOLE IN "NOTHING IS TRUSTED ACROSS THE WIRE".
 *
 * REPRODUCED BEFORE IT WAS FIXED, on BOTH client transports. A payload carrying ONE `media_id` on
 * TWO different urls rendered TWO thumbnails with the SAME `data-media-id`, `unpublishable_count`
 * stayed at 0, and React logged "Encountered two children with the same key,
 * `6a4b5b86-fbf2-448e-856e-9fa14299c2d7`" — on the very key whose comment says it exists so that
 * "the node follows the picture rather than the slot". A gallery keyed on a name two photographs
 * share reuses one DOM node, and one decoded bitmap, for both of them.
 *
 * The client re-validated the identity GRAMMAR and re-arbitrated PRIMACY off the wire, and did not
 * re-check UNIQUENESS. That is not a missing test, it is a missing check: the backend block dedupes
 * (Rule 6b, first occurrence wins, the loser COUNTED not dropped), and a mirror that re-derives two
 * of three properties has stopped being a mirror. It is not reachable from today's server — `id` is
 * the primary key of `listing_images` — which is exactly why nothing caught it.
 *
 * MATCHED TO THE BACKEND RATHER THAN INVENTED. `toListingMediaBlock` in
 * `backend/utils/vehicleMediaProjection.js` gates on
 * `form === null || mediaId === null || identitiesTaken.has(mediaId)` — ONE increment of
 * `unpublishable_count`, resolution in INPUT order, before the sort. The client does the same, with
 * the one documented divergence carried through: a `null` identity is exempt from the uniqueness
 * test, because a server predating the widened contract carries none on ANY entry and treating
 * "unnamed" as "already taken" would blank every such gallery from the second photo on.
 */
describe('VehicleDetail — one media_id names one photograph, or it is not published', () => {
  const UUID_A = '6a4b5b86-fbf2-448e-856e-9fa14299c2d7'
  const UUID_B = '5596b493-f21a-40eb-aba5-947b26e76cd5'
  const THIRD_IMAGE = 'https://cdn.carup.dev/listings/JTDKARFP0H3000731/rear.jpg'

  const listingBlock = (items: unknown[], state = 'published', unpublishable = 0) => ({
    state, items, unpublishable_count: unpublishable, empty_statement: state === 'none' ? CONTRACT_LISTING_EMPTY : null,
  })

  /** React reports a duplicate key through `console.error`. Captured rather than merely hoped absent. */
  function captureConsoleErrors(): { messages: string[]; restore: () => void } {
    const messages: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      messages.push(args.map(String).join(' '))
    })
    return { messages, restore: () => spy.mockRestore() }
  }

  const duplicateKeyWarnings = (messages: string[]) =>
    messages.filter((m) => /two children with the same key/i.test(m))

  it('refuses a REPEATED identity on the canonical transport, first occurrence keeping the name', async () => {
    serveNoListingRead()
    servePassport({
      ...passportFixture({ evidenceVault: [] }),
      listing_media: listingBlock([
        { media_id: UUID_A, url: CARD_IMAGE, url_form: 'absolute_https', position: 0, is_primary: true },
        { media_id: UUID_A, url: SECOND_IMAGE, url_form: 'absolute_https', position: 1, is_primary: false },
      ]),
    })
    const captured = captureConsoleErrors()
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())
    captured.restore()

    // ONE photograph survives, and it is the FIRST occurrence — the same one the backend keeps.
    const hero = screen.getByTestId('vehicle-image')
    expect(hero.getAttribute('data-media-id')).toBe(UUID_A)
    expect(hero.getAttribute('src')).toBe(CARD_IMAGE)
    // A single item renders no thumbnail strip, so the second photograph reached the DOM nowhere.
    expect(screen.queryAllByTestId('listing-media-thumb')).toHaveLength(0)
    expect(screen.getByTestId('listing-media-block').innerHTML).not.toContain(SECOND_IMAGE)
    // COUNTED, never silently dropped: a short gallery that hides what it refused is our defect
    // passed off as the seller's omission.
    expect(screen.getByTestId('listing-media-unpublishable').textContent).toContain('1 recorded photo(s)')
    // The defect measured on the shipped page, as its own assertion.
    expect(duplicateKeyWarnings(captured.messages), 'React reported a duplicate gallery key').toEqual([])
  })

  it('refuses a REPEATED identity on the marketplace compatibility array too', async () => {
    servePassport(passportFixture({ evidenceVault: [] }))
    serveListingMedia([
      image(CARD_IMAGE, { media_id: UUID_A, url_form: 'absolute_https', position: 0, is_primary: true }),
      image(SECOND_IMAGE, { media_id: UUID_A, url_form: 'absolute_https', position: 1, is_primary: false }),
    ])
    const captured = captureConsoleErrors()
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('vehicle-image')).toBeTruthy())
    captured.restore()

    const hero = screen.getByTestId('vehicle-image')
    expect(hero.getAttribute('data-media-id')).toBe(UUID_A)
    expect(hero.getAttribute('src')).toBe(CARD_IMAGE)
    expect(screen.queryAllByTestId('listing-media-thumb')).toHaveLength(0)
    expect(screen.getByTestId('listing-media-unpublishable').textContent).toContain('1 recorded photo(s)')
    expect(duplicateKeyWarnings(captured.messages), 'React reported a duplicate gallery key').toEqual([])
  })

  it('resolves a repeat in INPUT order, so a duplicate cannot take the seller’s primacy claim', async () => {
    // THE ORDERING IS THE RULE, not an implementation detail. The backend dedupes BEFORE its sort;
    // deduping after it would let the SECOND occurrence — the one claiming primacy — sort to the
    // front and survive, so the page would publish a "main photo" the first occurrence outranked on
    // arrival. Rule 6 says primacy is the seller's choice; it does not say a repeated name may
    // relocate it.
    servePassport(passportFixture({ evidenceVault: [] }))
    serveListingMedia([
      image(CARD_IMAGE, { media_id: UUID_A, url_form: 'absolute_https', position: 0, is_primary: false }),
      image(SECOND_IMAGE, { media_id: UUID_A, url_form: 'absolute_https', position: 1, is_primary: true }),
      image(THIRD_IMAGE, { media_id: UUID_B, url_form: 'absolute_https', position: 2, is_primary: false }),
    ])
    await renderSettled()
    await waitFor(() => expect(screen.getAllByTestId('listing-media-thumb').length).toBe(2))

    expect(screen.getByTestId('vehicle-image').getAttribute('src')).toBe(CARD_IMAGE)
    expect(screen.getAllByTestId('listing-media-thumb').map((t) => t.getAttribute('data-media-id')))
      .toEqual([UUID_A, UUID_B])
    // Nobody claims primacy among the survivors, so no primary is published — and certainly not one
    // inherited from a row that was refused.
    expect(screen.queryByTestId('listing-media-primary')).toBeNull()
    expect(screen.getByTestId('listing-media-block').innerHTML).not.toContain(SECOND_IMAGE)
    expect(screen.getByTestId('listing-media-unpublishable').textContent).toContain('1 recorded photo(s)')
  })

  it('does NOT treat two ABSENT identities as a collision, on either transport', async () => {
    // THE ANTI-VACUITY PARTNER, and a real hazard rather than a hypothetical one. A dedupe that
    // keyed on the raw value would find `null` "already taken" on the second entry and drop every
    // photograph after the first — for every deploy predating the widened contract, which is the
    // whole population the client's documented divergence exists to protect. An unnamed photograph
    // is still a photograph; only the ability to NAME it is missing.
    servePassport(passportFixture({ evidenceVault: [] }))
    serveListingMedia([image(CARD_IMAGE), image(SECOND_IMAGE)])
    await renderSettled()
    await waitFor(() => expect(screen.getAllByTestId('listing-media-thumb').length).toBe(2))

    const thumbs = screen.getAllByTestId('listing-media-thumb')
    expect(thumbs.map((t) => t.getAttribute('data-media-id'))).toEqual([null, null])
    expect(thumbs.map((t) => t.querySelector('img')?.getAttribute('src'))).toEqual([CARD_IMAGE, SECOND_IMAGE])
    expect(screen.queryByTestId('listing-media-unpublishable')).toBeNull()
    cleanup()

    // The same, arriving through the canonical envelope.
    serveNoListingRead()
    servePassport({
      ...passportFixture({ evidenceVault: [] }),
      listing_media: listingBlock([
        { url: CARD_IMAGE, url_form: 'absolute_https', position: 0, is_primary: false },
        { url: SECOND_IMAGE, url_form: 'absolute_https', position: 1, is_primary: false },
      ]),
    })
    await renderSettled()
    await waitFor(() => expect(screen.getAllByTestId('listing-media-thumb').length).toBe(2))
    expect(screen.getAllByTestId('listing-media-thumb').map((t) => t.getAttribute('data-media-id')))
      .toEqual([null, null])
    expect(screen.queryByTestId('listing-media-unpublishable')).toBeNull()
  })

  it('re-checks uniqueness in BOTH readers, not only in the one a test happened to exercise', () => {
    // The grammar and the primacy arbitration were mirrored in both readers and uniqueness in
    // neither. Pinned structurally so a future reader cannot be added — or one of these two rewritten
    // — with two of the three checks.
    for (const [name, body] of [
      ['readListingMediaBlock', /function readListingMediaBlock\([\s\S]*?\n}/.exec(DETAIL_CODE)],
      ['toListingMediaBlock', /function toListingMediaBlock\([\s\S]*?\n}/.exec(DETAIL_CODE)],
    ] as Array<[string, RegExpExecArray | null]>) {
      expect(body, `${name} not found on the page`).toBeTruthy()
      const src = (body as RegExpExecArray)[0]
      expect(src, `${name} does not re-check identity uniqueness`).toMatch(/identitiesTaken\.has\(mediaId\)/)
      // The `null` exemption, which is what keeps the divergence from becoming a gallery-blanking bug.
      expect(src, `${name} treats an absent identity as a collision`).toMatch(/mediaId !== null && identitiesTaken\.has\(mediaId\)/)
    }
  })

  it('counts a duplicate under ONE sentence that names no single cause', async () => {
    // `unpublishable_count` has never counted only unrenderable urls — the backend increments it
    // once for `form === null`, once for a missing identity and once for a repeated one — and the
    // count arrives here already merged. The page therefore may not publish "the stored address is
    // not a form CarUp will publish" as a finding, which is what it used to do.
    serveNoListingRead()
    servePassport({
      ...passportFixture({ evidenceVault: [] }),
      listing_media: listingBlock([
        { media_id: UUID_A, url: CARD_IMAGE, url_form: 'absolute_https', position: 0, is_primary: true },
        { media_id: UUID_A, url: SECOND_IMAGE, url_form: 'absolute_https', position: 1, is_primary: false },
      ]),
    })
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('listing-media-unpublishable')).toBeTruthy())

    const sentence = screen.getByTestId('listing-media-unpublishable').textContent || ''
    expect(sentence).toContain('1 recorded photo(s)')
    // It attributes the fault to the RECORD, not to a field this surface never inspected.
    expect(sentence).toContain('That is a fault in the record, not a statement about the vehicle.')
    expect(sentence).not.toMatch(/because the\s+stored address is not a form/)
    // And it still asserts nothing about governance.
    expect(trustLanguageIn(sentence)).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────────
/**
 * THE SHARED CONTRACT NOW DECLARES WHAT THE SERVICE PUBLISHES.
 *
 * THE GAP, as Lane A recorded it and as this suite now closes it: `shared/types/marketplace.ts`
 * declared `MarketplaceMedia = { url, type, is_primary? }` and `MarketplaceListingDetail` declared no
 * `listing_media` key at all, while `marketplaceListingDetailService` published `media_id`,
 * `url_form` and `position` on every entry AND the canonical envelope beside it. The declared type
 * was a strict SUBSET of the wire, so `VehicleDetail.tsx` widened it locally to read an identity
 * that was already being sent — a page authoring a cross-surface contract, which is the shape of the
 * mistake that put a governance sentence in a .tsx file.
 *
 * The pins below bind the DECLARATION to the SERVICE, by reading both sources. A declaration checked
 * against nothing is how the previous one stayed wrong through a whole phase while every test passed.
 */
describe('Marketplace media — the declared contract matches the published one', () => {
  const SHARED_MARKETPLACE_SRC = readFileSync(resolve(REPO, 'shared/types/marketplace.ts'), 'utf8')
  const SHARED_MARKETPLACE_CODE = code(SHARED_MARKETPLACE_SRC)
  const DETAIL_SERVICE_SRC = readFileSync(
    resolve(REPO, 'backend/services/marketplace/marketplaceListingDetailService.js'), 'utf8')

  /** The OWN field names of a TS interface, comments stripped. None of these bodies nests a brace. */
  function interfaceKeys(src: string, name: string): string[] {
    const match = new RegExp(`interface ${name}(?: extends [\\w, ]+)? \\{([^}]*)\\}`).exec(src)
    if (!match) throw new Error(`interface ${name} not found in the shared contract`)
    return [...match[1].matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1])
  }

  /** The interfaces `name` extends, or [] when it extends nothing. */
  function interfaceExtends(src: string, name: string): string[] {
    const match = new RegExp(`interface ${name} extends ([\\w, ]+) \\{`).exec(src)
    return match ? match[1].split(',').map((s) => s.trim()).filter(Boolean) : []
  }

  /**
   * Every field `name` actually carries, INHERITANCE RESOLVED.
   *
   * MY FIRST DRAFT WAS PARTLY VACUOUS AND A MUTATION CAUGHT IT. It compared the wire against
   * `interfaceKeys('MarketplaceMedia')` CONCATENATED with `interfaceKeys('MarketplaceListingMediaItem')`
   * — a union taken by hand. Narrowing `MarketplaceMedia` straight back to the pre-Phase-5
   * `{url, type, is_primary?}` therefore left the assertion GREEN, because the union still picked up
   * `media_id`, `url_form` and `position` from the item interface the narrowed type no longer
   * extended. Resolving the chain is the difference between checking the declaration and checking
   * two declarations that happen to sit in the same file.
   */
  function resolvedInterfaceKeys(src: string, name: string, seen = new Set<string>()): string[] {
    if (seen.has(name)) return []
    seen.add(name)
    const inherited = interfaceExtends(src, name).flatMap((parent) => resolvedInterfaceKeys(src, parent, seen))
    return [...new Set([...inherited, ...interfaceKeys(src, name)])]
  }

  /** The keys the service actually puts on a `media` entry. */
  function serviceMediaKeys(): string[] {
    const match = /const media = listing_media\.items\.map\(\(item\) => \(\{([\s\S]*?)\}\)\);/
      .exec(DETAIL_SERVICE_SRC)
    if (!match) throw new Error('the compatibility view is not built where this test expects it')
    return [...match[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1])
  }

  it('declares every key the service publishes on a media entry, and no key it does not', () => {
    const published = serviceMediaKeys()
    // ANTI-VACUITY: an empty extraction agrees with everything. The service publishes six keys.
    expect(published.sort()).toEqual(['is_primary', 'media_id', 'position', 'type', 'url', 'url_form'])

    const declared = resolvedInterfaceKeys(SHARED_MARKETPLACE_CODE, 'MarketplaceMedia').sort()
    expect(declared, 'the declared media shape has drifted from the wire').toEqual(published.sort())
    // The identity is the key the declaration used to be missing, so it is named outright: a
    // set-equality assertion that passed on a lucky union once already.
    expect(declared).toContain('media_id')
  })

  it('declares the compatibility view as an EXTENSION of the item it is derived from', () => {
    // The service's own header: "`media` is not a second computation that could drift — every entry
    // is `listing_media.items[i]` plus the one legacy key". Declared as an extension, the compiler
    // says the same thing: a view cannot disagree with its source, and the two cannot be widened
    // apart by editing one of them.
    expect(SHARED_MARKETPLACE_CODE)
      .toMatch(/interface MarketplaceMedia extends MarketplaceListingMediaItem \{/)
  })

  it('declares the canonical envelope on the listing detail, with state as a required key', () => {
    const detail = interfaceKeys(SHARED_MARKETPLACE_CODE, 'MarketplaceListingDetail')
    expect(detail, 'MarketplaceListingDetail still does not declare listing_media').toContain('listing_media')
    expect(detail).toContain('media')
    expect(SHARED_MARKETPLACE_CODE).toMatch(/listing_media: MarketplaceListingMediaBlock;/)

    const block = interfaceKeys(SHARED_MARKETPLACE_CODE, 'MarketplaceListingMediaBlock')
    expect(block.sort()).toEqual(['empty_statement', 'items', 'state', 'unpublishable_count'])
    // `state` is the discriminator; optional, it could not distinguish "we did not look" from a body
    // that simply carried no gallery.
    expect(SHARED_MARKETPLACE_CODE).toMatch(/\n\s*state: MarketplaceMediaBlockState;/)
  })

  it('declares the same url forms and block states the backend contract names', () => {
    const declaredForms = (() => {
      const m = /type MarketplaceMediaUrlForm =([\s\S]*?);/.exec(SHARED_MARKETPLACE_CODE)
      if (!m) throw new Error('MarketplaceMediaUrlForm not declared')
      return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
    })()
    // MY OWN FIRST DRAFT WAS WRONG HERE AND IT IS WORTH RECORDING WHY. It reached for
    // `exportedStringArray(CONTRACT_SRC, 'MEDIA_URL_FORM_VALUES')`, which throws: that export is
    // `Object.freeze(Object.values(MEDIA_URL_FORMS))`, derived at runtime rather than written as a
    // literal array, so the frozen-array helper cannot see it. The OBJECT is the source of truth
    // and is what this reads.
    const contractFormValues = (() => {
      const m = /export const MEDIA_URL_FORMS = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(CONTRACT_SRC)
      if (!m) throw new Error('MEDIA_URL_FORMS not found in the contract source')
      return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
    })()
    expect(contractFormValues).toHaveLength(4)
    expect(declaredForms).toEqual(contractFormValues)

    const declaredStates = (() => {
      const m = /type MarketplaceMediaBlockState =(.*);/.exec(SHARED_MARKETPLACE_CODE)
      if (!m) throw new Error('MarketplaceMediaBlockState not declared')
      return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
    })()
    const contractStates = (() => {
      const m = /export const MEDIA_BLOCK_STATES = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(CONTRACT_SRC)
      if (!m) throw new Error('MEDIA_BLOCK_STATES not found in the contract source')
      return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
    })()
    expect(contractStates).toEqual(['none', 'not_loaded', 'published'])
    expect(declaredStates).toEqual(contractStates)
  })

  it('has retired the page’s local widening of the marketplace contract', () => {
    // The finding is closed AT THE CONTRACT, so the workaround must not survive it: a local widening
    // left in place is a second declaration, and it is the one that goes stale silently.
    expect(DETAIL_CODE).not.toMatch(/MarketplaceMedia\s*&\s*\{/)
    expect(DETAIL_CODE).not.toMatch(/type DetailMediaTransport/)
    // What replaced it re-widens every key to `unknown` and is DERIVED from the shared type, so the
    // page cannot go on reading a shape the contract has moved past.
    expect(DETAIL_CODE).toMatch(/type WireMarketplaceMedia = \{ \[K in keyof MarketplaceMedia\]\?: unknown \}/)
    // And the page still validates rather than trusts: a declaration binds the contract, not the bytes.
    expect(DETAIL_CODE).toContain('toMediaIdentity(row?.media_id)')
    expect(DETAIL_CODE).toContain('classifyMediaUrl(row?.url)')
  })
})

// ────────────────────────────────────────────────────────────────────────────
/**
 * `primary_image_state` — PUBLISHED, AND UNTIL NOW DECLARED NOWHERE AND READ BY NOBODY.
 *
 * The backend elects a cover image and labels where it came from, because the KEY NAME
 * `primary_image_url` asserts something the data often cannot support: with two rows neither of
 * which claims `is_primary`, the lower-`display_order` one was still published under a key called
 * "primary". Rule 6 says primacy is the seller's choice or it does not exist, and deleting the key
 * would blank every card that has photos and no claim — so the fact was LABELLED rather than
 * withdrawn.
 *
 * The label was then absent from `shared/types/index.ts`, `web/src/types/index.ts` and
 * `mobile/utils/marketplaceApi.ts`, while four surfaces put `primary_image_url` straight into an
 * `<img src>`. It is now DECLARED, and REQUIRED — a label a consumer may omit from its own type is a
 * label that changes nothing.
 *
 * ── THE DECISION: DECLARED, DELIBERATELY NOT YET CONSUMED, AND HERE IS WHY ────────────────────
 * Measured on the four surfaces rather than assumed:
 *   · Marketplace.tsx and VehicleSearch.tsx render through `ListingImage`, whose empty state is
 *     "Image unavailable" with `aria-label="… — image unavailable"`.
 *   · SavedCars.tsx renders "No image available".
 *   · MarketplaceCompare.tsx renders nothing at all when the URL is absent.
 * Every one of those is a statement about OUR ability to show a picture. NOT ONE of them says the
 * seller added no photos, and not one describes the picture as the seller's main photo. So the two
 * things the label exists to prevent — a false negative about the gallery (Rule 1) and a fabricated
 * primacy claim (Rule 6) — are not currently being asserted anywhere for it to correct.
 *
 * Consuming it now would mean inventing a caption or a card state nobody asked for, and every such
 * branch is a second place deciding what "primary" means. The election happens once, in
 * `electPrimaryImage`; a surface that re-derived it would have forked the contract to display a
 * label whose entire purpose is to stop exactly that. A declared field with a test pinning its
 * meaning is the honest stopping point.
 *
 * What IS pinned, so the stopping point cannot rot: the label's four states are the backend's own,
 * it is required, and NO surface may assert primacy without reading it. That last one survives a
 * future legitimate consumer — it forbids the fabrication, not the reading.
 */
describe('Marketplace listings — the cover image carries the label that qualifies it', () => {
  const SHARED_INDEX_SRC = readFileSync(resolve(REPO, 'shared/types/index.ts'), 'utf8')
  const SHARED_INDEX_CODE = code(SHARED_INDEX_SRC)
  const SUMMARY_SERVICE_SRC = readFileSync(
    resolve(REPO, 'backend/services/marketplace/listingSummaryService.js'), 'utf8')

  /** The states `electPrimaryImage` can actually return, read out of its body. */
  function electedStates(): string[] {
    const match = /function electPrimaryImage\(imageRows\) \{([\s\S]*?)\n\}/.exec(SUMMARY_SERVICE_SRC)
    if (!match) throw new Error('electPrimaryImage not found in the summary service')
    return [...new Set([...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))].sort()
  }

  function declaredStates(): string[] {
    const match = /type MarketplacePrimaryImageState =([\s\S]*?);/.exec(SHARED_INDEX_CODE)
    if (!match) throw new Error('MarketplacePrimaryImageState is not declared in the shared types')
    return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
  }

  it('declares exactly the four states the backend elects, and no fifth', () => {
    const elected = electedStates()
    // ANTI-VACUITY: two empty lists are equal. The election has four outcomes and they are named.
    expect(elected).toEqual(['first_published', 'none', 'not_loaded', 'seller_primary'])
    expect(declaredStates(), 'the declared label has drifted from the election').toEqual(elected)
  })

  it('declares it as REQUIRED, beside the url it qualifies', () => {
    // Optional, it is a label a consumer can omit from its own type — which is where it started.
    expect(SHARED_INDEX_CODE).toMatch(/\n\s*primary_image_state: MarketplacePrimaryImageState;/)
    expect(SHARED_INDEX_CODE).not.toMatch(/primary_image_state\?:/)
    expect(SHARED_INDEX_CODE).toMatch(/\n\s*primary_image_unpublishable_count: number;/)
    // Same interface as the url, so the fact and its qualifier cannot be read apart.
    const summary = /interface MarketplaceListingSummary \{([^}]*)\}/.exec(SHARED_INDEX_CODE)
    expect(summary, 'MarketplaceListingSummary not found').toBeTruthy()
    const keys = [...(summary as RegExpExecArray)[1].matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1])
    expect(keys).toContain('primary_image_url')
    expect(keys).toContain('primary_image_state')
    expect(keys).toContain('primary_image_unpublishable_count')
  })

  it('is reachable from web and from mobile, so neither has to invent it', () => {
    const webTypes = readFileSync(resolve(REPO, 'web/src/types/index.ts'), 'utf8')
    expect(code(webTypes)).toMatch(/MarketplacePrimaryImageState/)
    const mobileApi = readFileSync(resolve(REPO, 'mobile/utils/marketplaceApi.ts'), 'utf8')
    expect(code(mobileApi)).toMatch(/primary_image_state: MobilePrimaryImageState;/)
    // Mobile's own listing shapes carried the same subset defect and are widened with it.
    expect(code(mobileApi)).toMatch(/media_id: string;/)
    expect(code(mobileApi)).toMatch(/listing_media\?: MobileListingMediaBlock;/)
  })

  it('lets NO surface assert primacy without reading the contract that decides it', () => {
    // THE INVARIANT THE NON-CONSUMPTION RESTS ON, and it outlives the decision: a surface may render
    // the cover image without the label (it makes no claim by doing so), but it may NOT describe a
    // photograph as the seller's choice unless it read the fact from the contract.
    const SURFACES = [
      'web/src/pages/Marketplace.tsx',
      'web/src/pages/VehicleSearch.tsx',
      'web/src/pages/dashboard/owner/SavedCars.tsx',
      'web/src/pages/MarketplaceCompare.tsx',
      'web/src/components/marketplace/ListingImage.tsx',
      'web/src/pages/VehicleDetail.tsx',
    ]
    const claimsPrimacy = (src: string) => /main photo|primary photo|primary image\b(?! ?url|_)/i.test(src)
    const readsTheFact = (src: string) => /is_primary|primary_image_state/.test(src)

    const offenders: string[] = []
    let claimants = 0
    for (const file of SURFACES) {
      const src = code(readFileSync(resolve(REPO, file), 'utf8'))
      if (!claimsPrimacy(src)) continue
      claimants += 1
      if (!readsTheFact(src)) offenders.push(file)
    }
    expect(offenders, `these surfaces assert a primacy claim they never read: ${offenders.join(', ')}`)
      .toEqual([])
    // ANTI-VACUITY: a rule nothing triggers proves nothing. VehicleDetail DOES make the claim —
    // "Seller's main photo" — and it is the one surface that reads `is_primary` off the contract
    // before doing so, so the guard is exercised on its positive branch.
    expect(claimants, 'no surface makes a primacy claim, so this guard measured nothing')
      .toBeGreaterThan(0)
    const detail = code(readFileSync(resolve(REPO, 'web/src/pages/VehicleDetail.tsx'), 'utf8'))
    expect(claimsPrimacy(detail)).toBe(true)
    expect(readsTheFact(detail)).toBe(true)
  })

  it('has no surface stating a finding about the seller’s photos on a card', () => {
    // The other half of the justification, measured rather than asserted. A card that said "no
    // photos" would be publishing a negative about a gallery the card never read — Rule 1's defect,
    // one surface over — and THAT would make consuming `not_loaded` mandatory rather than optional.
    for (const file of [
      'web/src/components/marketplace/ListingImage.tsx',
      'web/src/pages/dashboard/owner/SavedCars.tsx',
      'web/src/pages/MarketplaceCompare.tsx',
    ]) {
      const src = code(readFileSync(resolve(REPO, file), 'utf8'))
      expect(src, `${file} publishes a finding about the seller's photos`)
        .not.toMatch(/no photos|has not added|added no|seller has no/i)
    }
    // And the sentence that IS rendered speaks about availability, which is true under `none` and
    // under `not_loaded` alike.
    const listingImage = readFileSync(resolve(REPO, 'web/src/components/marketplace/ListingImage.tsx'), 'utf8')
    expect(listingImage).toContain('Image unavailable')
  })
})
