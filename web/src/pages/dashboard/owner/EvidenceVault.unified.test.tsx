/** RX04-C2 — Evidence (unified): add evidence to the right car; only a review counts as verified; a failed read is not zero. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/components/listing/OwnerListingMedia', () => ({ OwnerListingMedia: () => <div>media</div> }))

const api = { fetchOwnedVehicles: vi.fn() }
const car = (vin: string, verified: number | null) => ({ vin, year: 2018, make: 'Toyota', model: 'Hilux', counts: { verified_documents: verified, services: null, parts: null, active_insurance: null } })

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = true
  vi.doMock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))
})
afterEach(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined; vi.doUnmock('@/hooks/useCarUpApi') })

async function renderPage() {
  const { default: EvidenceVault } = await import('./EvidenceVault')
  return render(<MemoryRouter><EvidenceVault /></MemoryRouter>)
}

describe('EvidenceVault — unified', () => {
  it('keeps the vault ids, links each car to the Passport upload, and states each verified count honestly', async () => {
    const photographed = { ...car('VERIFIED000000001', 2), listing_media: { state: 'published', items: [{ media_id: 'm1', url: 'https://example.invalid/p.jpg', url_form: 'absolute', position: 0, is_primary: true }], unpublishable_count: 0, empty_statement: null } }
    api.fetchOwnedVehicles.mockResolvedValue([photographed, car('NONE0000000000002', 0), car('UNREAD00000000003', null)])
    await renderPage()
    expect(await screen.findByTestId('evidence-vehicle-VERIFIED000000001')).toBeInTheDocument()
    expect(screen.getByTestId('owner-evidence-vault')).toHaveAttribute('data-presentation', 'rx04')
    expect(screen.getByTestId('evidence-add-VERIFIED000000001')).toHaveAttribute('href', '/dashboard/garage/VERIFIED000000001?upload=1')
    expect(screen.getByTestId('evidence-verified-VERIFIED000000001')).toHaveTextContent('2 verified documents')
    expect(screen.getByTestId('evidence-verified-NONE0000000000002')).toHaveTextContent('No verified documents yet')
    expect(screen.getByTestId('evidence-verified-UNREAD00000000003')).toHaveTextContent('Verified count not recorded')
    // A listing photo is never presented as evidence: where one is shown, it is labelled as such.
    expect(screen.getAllByText('Listing photo · not evidence')).toHaveLength(1)
    expect(screen.getByTestId('evidence-vehicle-VERIFIED000000001')).toHaveTextContent('Listing photo · not evidence')

    // The header action asks which car first, then opens that car's upload.
    fireEvent.click(screen.getByTestId('evidence-add-primary'))
    const chooser = screen.getByTestId('evidence-car-chooser')
    expect(chooser.querySelector('a[href="/dashboard/garage/NONE0000000000002?upload=1"]')).not.toBeNull()
  })

  it('a single car goes straight to its upload', async () => {
    api.fetchOwnedVehicles.mockResolvedValue([car('ONLY0000000000001', 0)])
    await renderPage()
    expect(await screen.findByTestId('evidence-add-primary')).toHaveAttribute('href', '/dashboard/garage/ONLY0000000000001?upload=1')
  })

  it('a failed read is an error, not zero documents, and can be retried', async () => {
    api.fetchOwnedVehicles.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([car('ONLY0000000000001', 0)])
    await renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('has not converted that failure into zero documents')
    expect(screen.queryByTestId('evidence-empty')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByTestId('evidence-vehicle-ONLY0000000000001')).toBeInTheDocument())
  })

  it('no cars yet: says evidence needs a car first', async () => {
    api.fetchOwnedVehicles.mockResolvedValue([])
    await renderPage()
    expect(await screen.findByTestId('evidence-empty')).toHaveTextContent('No car to attach evidence to yet')
  })
})
