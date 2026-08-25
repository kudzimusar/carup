import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Issue #164 Phase 8, Run 4 — **D4**: the three claim badges on the owner vehicle page.
 *
 * `Logbook Verified`, `Insurance Active` and `PartSentry Active` rendered UNCONDITIONALLY, with no
 * data binding of any kind. The physical UAT caught it on Golden B — a vehicle whose logbook
 * evidence is `pending`, with no insurance policy and no PartSentry log — where the page asserted
 * "Logbook Verified" in green with a checkmark, immediately beneath the governed trust panel that
 * says, on the same screen, "No governed vehicle fact is backed by an authoritative record."
 *
 * The Golden-B negative case below is the one that matters: it is the exact shape that used to
 * publish three fabricated verifications, and it is why every assertion here is about ABSENCE.
 */

const fetchVehiclePassport = vi.fn()
const fetchVehicleEvidence = vi.fn()
const fetchEvidenceTaxonomy = vi.fn()
const fetchEvidenceSources = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchVehiclePassport,
    fetchVehicleEvidence,
    fetchEvidenceTaxonomy,
    fetchEvidenceSources,
  }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useParams: () => ({ id: 'CARUPGLDNB0000002' }) }
})

const VehicleProfile = (await import('./VehicleProfile')).default

/**
 * Comments are stripped before the source is scanned. The prose above the badge block explains the
 * defect and necessarily quotes the badge labels; without this, the guard below matched its own
 * documentation and reported a pass/fail about a comment rather than about the JSX.
 */
const SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'VehicleProfile.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '')

const TRUST = {
  score: 50,
  band: 'moderate',
  evaluation_state: 'evaluated',
  confidence: 'low',
  calculation_version: 'trust-decision-1.0.0',
  evaluated_at: '2026-08-24T02:35:46.874+00:00',
  known_limitations: ['No governed vehicle fact is backed by an authoritative record.'],
  evidence_basis: {
    governed_facts_total: 7,
    governed_facts_substantiated: 0,
    governed_facts_adverse: 0,
    connected_sources: 0,
    unbacked_legacy_claims: 0,
  },
}

function passport({ timeline = [] as unknown[] } = {}) {
  return {
    vehicle: { vin: 'CARUPGLDNB0000002', make: 'Nissan', model: 'NP200', year: 2017, mileage: 132900, color: 'White', price: 9800 },
    claims: {},
    timeline,
    evidenceTimeline: [],
    trustReport: TRUST,
    chainVerification: { verified: false },
  }
}

function renderPage() {
  return render(<MemoryRouter><VehicleProfile /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchEvidenceTaxonomy.mockResolvedValue({ classes: [] })
  fetchEvidenceSources.mockResolvedValue({ sources: [] })
})

const BADGES = ['badge-logbook-verified', 'badge-insurance-active', 'badge-partsentry-active']

describe('D4 — claim badges render only when a governed fact supports them', () => {
  it('GOLDEN B (the regression): pending logbook, no insurance, no parts → NO positive claim renders', async () => {
    fetchVehiclePassport.mockResolvedValue(passport())
    fetchVehicleEvidence.mockResolvedValue([
      { id: 'e1', evidence_type: 'registration_document', verification_status: 'pending', uploaded_at: '2026-08-24T00:00:00Z' },
    ])

    renderPage()
    await waitFor(() => expect(screen.getByTestId('vehicle-claim-badges')).toBeInTheDocument())

    for (const id of BADGES) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument()
    }
    // And the words themselves are gone, not merely the test ids.
    expect(screen.queryByText('Logbook Verified')).not.toBeInTheDocument()
    expect(screen.queryByText('Insurance Active')).not.toBeInTheDocument()
    expect(screen.queryByText('PartSentry Active')).not.toBeInTheDocument()
  })

  it('GOLDEN A shape: a verified logbook, an ACTIVE policy and a part log render all three', async () => {
    fetchVehiclePassport.mockResolvedValue(passport({
      timeline: [
        { id: 'insurance:POL-1', event_source: 'insurance', timestamp: '2026-01-01', label: 'Insurance Insured', details: { active: true } },
        { id: 'partsentry:1', event_source: 'service', timestamp: '2026-02-01', label: 'Fitted', details: {} },
      ],
    }))
    fetchVehicleEvidence.mockResolvedValue([
      { id: 'e1', evidence_type: 'registration_document', verification_status: 'verified', uploaded_at: '2026-08-24T00:00:00Z' },
    ])

    renderPage()
    await waitFor(() => expect(screen.getByTestId('badge-logbook-verified')).toBeInTheDocument())
    expect(screen.getByTestId('badge-insurance-active')).toBeInTheDocument()
    expect(screen.getByTestId('badge-partsentry-active')).toBeInTheDocument()
  })

  it('a policy ROW is not an ACTIVE policy: active:false must not render "Insurance Active"', async () => {
    fetchVehiclePassport.mockResolvedValue(passport({
      timeline: [
        { id: 'insurance:POL-OLD', event_source: 'insurance', timestamp: '2020-01-01', label: 'Insurance Insured', details: { active: false } },
      ],
    }))
    fetchVehicleEvidence.mockResolvedValue([])

    renderPage()
    await waitFor(() => expect(screen.getByTestId('vehicle-claim-badges')).toBeInTheDocument())
    expect(screen.queryByTestId('badge-insurance-active')).not.toBeInTheDocument()
  })

  it('a MISSING active flag is not active either — an absent column never reads as a verification', async () => {
    fetchVehiclePassport.mockResolvedValue(passport({
      timeline: [
        { id: 'insurance:POL-X', event_source: 'insurance', timestamp: '2026-01-01', label: 'Insurance Insured', details: {} },
      ],
    }))
    fetchVehicleEvidence.mockResolvedValue([])

    renderPage()
    await waitFor(() => expect(screen.getByTestId('vehicle-claim-badges')).toBeInTheDocument())
    expect(screen.queryByTestId('badge-insurance-active')).not.toBeInTheDocument()
  })

  it('a REJECTED logbook is not a verified one', async () => {
    fetchVehiclePassport.mockResolvedValue(passport())
    fetchVehicleEvidence.mockResolvedValue([
      { id: 'e1', evidence_type: 'registration_document', verification_status: 'rejected', uploaded_at: '2026-08-24T00:00:00Z' },
    ])

    renderPage()
    await waitFor(() => expect(screen.getByTestId('vehicle-claim-badges')).toBeInTheDocument())
    expect(screen.queryByTestId('badge-logbook-verified')).not.toBeInTheDocument()
  })

  /**
   * Source-level guard. The assertions above would all still pass if someone deleted the badges
   * entirely, so this one asserts the PRODUCER: each badge must be behind a condition. A future
   * edit that reintroduces an unconditional `<Badge …>Logbook Verified</Badge>` fails here even if
   * it never reaches a rendered test.
   */
  it('no claim badge is rendered unconditionally in the source', () => {
    for (const [flag, label] of [
      ['hasVerifiedLogbook', 'Logbook Verified'],
      ['hasActiveInsurance', 'Insurance Active'],
      ['hasPartSentryActivity', 'PartSentry Active'],
    ]) {
      const idx = SRC.indexOf(label)
      expect(idx, `${label} is not present in the source at all`).toBeGreaterThan(-1)
      // The guard must appear within the JSX block immediately preceding the label.
      const preceding = SRC.slice(Math.max(0, idx - 400), idx)
      expect(preceding, `${label} must render only under ${flag}`).toContain(`{${flag} && (`)
    }
  })
})
