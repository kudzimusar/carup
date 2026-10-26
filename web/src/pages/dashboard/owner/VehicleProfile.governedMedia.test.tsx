import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * T11-CAP-LR01-R2 — the owner's Vehicle Passport shows the owner's own private photographs.
 *
 * The passport route attaches the governed-media block (the WHOLE gallery) only when the viewer is entitled to the vehicle. Held here: the page
 * draws that gallery; the header uses its hero when there is no published listing photograph; it renders nothing for a passport that carries no
 * block; a stored price of 0 with no currency is not "$0"; and nothing about where the bytes live reaches the page.
 */

const fetchVehiclePassport = vi.fn()
const fetchVehicleEvidence = vi.fn()
const fetchEvidenceTaxonomy = vi.fn()
const fetchEvidenceSources = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ fetchVehiclePassport, fetchVehicleEvidence, fetchEvidenceTaxonomy, fetchEvidenceSources }) }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useParams: () => ({ id: 'FRAME-0000123' }) }
})

const VehicleProfile = (await import('./VehicleProfile')).default

const photo = (rank: number, over: Record<string, unknown> = {}) => ({
  gallery_item_id: `g${rank}`, gallery_rank: rank, designated_primary: rank === 1, designation_basis: rank === 1 ? 'SOURCE_FIRST_IMAGE' : null, caption: null, review_status: 'pending',
  view: { href: `https://signed.example.test/p${rank}.jpg?token=abc`, expires_at: '2026-10-26T06:00:00Z' }, ...over,
})

function passport(over: Record<string, unknown> = {}) {
  return {
    vehicle: { vin: 'FRAME-0000123', make: 'Make', model: 'Model', year: 2018, mileage: 134741, color: 'Pearl', price: 0, currency: null },
    claims: {}, timeline: [], evidenceTimeline: [], listing_media: { state: 'none', items: [] },
    governed_media: { state: 'available', items: [photo(1), photo(2), photo(3)], total_count: 50, unavailable_count: 0, empty_statement: null },
    trustReport: { score: null, band: null, evaluation_state: 'not_evaluated', confidence: 'not_evaluated', calculation_version: null, evaluated_at: null, known_limitations: [] },
    chainVerification: { verified: false }, ...over,
  }
}

const renderPage = () => render(<MemoryRouter><VehicleProfile /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  fetchVehicleEvidence.mockResolvedValue([])
  fetchEvidenceTaxonomy.mockResolvedValue({ classes: [] })
  fetchEvidenceSources.mockResolvedValue({ sources: [] })
})

describe('Vehicle Passport (owner) — the private gallery', () => {
  it('draws the whole private gallery, with its position, review state and privacy statement', async () => {
    fetchVehiclePassport.mockResolvedValue(passport())
    renderPage()
    const gallery = await screen.findByTestId('governed-gallery')
    expect(within(gallery).getByTestId('governed-gallery-private').textContent).toMatch(/private to you/i)
    expect(within(gallery).getByTestId('governed-gallery-position').textContent).toBe('Photograph 1 of 50')
    expect(within(gallery).getByTestId('governed-gallery-review').textContent).toBe('Awaiting review')
    expect(within(within(gallery).getByTestId('governed-gallery-thumbs')).getAllByRole('button')).toHaveLength(3)
  })

  it('with no published listing photograph, the header uses the owner\'s private hero', async () => {
    fetchVehiclePassport.mockResolvedValue(passport())
    renderPage()
    await screen.findByTestId('governed-gallery')
    const header = document.querySelector('.h-56')
    expect(header?.querySelector('img')?.getAttribute('src')).toBe('https://signed.example.test/p1.jpg?token=abc')
  })

  it('a published listing photograph keeps the header — the private hero does not replace it', async () => {
    fetchVehiclePassport.mockResolvedValue(passport({
      listing_media: { state: 'published', items: [{ media_id: 'm1', url: 'https://cdn.example.test/listing.jpg', url_form: 'absolute_https', position: 0, is_primary: true }], unpublishable_count: 0, empty_statement: null },
    }))
    renderPage()
    await screen.findByTestId('governed-gallery')
    const header = document.querySelector('.h-56')
    expect(header?.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.test/listing.jpg')
  })

  it('a passport that carries no private block shows no gallery and no trace of one', async () => {
    fetchVehiclePassport.mockResolvedValue(passport({ governed_media: undefined }))
    renderPage()
    await screen.findByRole('heading', { name: /2018 Make Model/i })
    expect(screen.queryByTestId('governed-gallery')).toBeNull()
    expect(document.body.innerHTML).not.toMatch(/Private to you/i)
  })

  it('an unpriced record is not shown as $0, and the page names no storage', async () => {
    fetchVehiclePassport.mockResolvedValue(passport())
    renderPage()
    await screen.findByTestId('governed-gallery')
    expect(screen.getByText('Recorded Price').parentElement?.textContent).toMatch(/Price not recorded/)
    expect(screen.getByText('Recorded Price').parentElement?.textContent).not.toMatch(/\$\s*0/)
    for (const leaked of ['ocr-documents', 'storage_bucket', 'file_path', 'evidence_id']) expect(document.body.innerHTML).not.toContain(leaked)
  })
})
