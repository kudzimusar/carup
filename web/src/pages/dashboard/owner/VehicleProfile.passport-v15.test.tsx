import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

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
const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'VehicleProfile.tsx'),
  'utf8',
)

function passport() {
  return {
    vehicle: {
      vin: 'CARUPGLDNB0000002',
      make: 'Nissan',
      model: 'NP200',
      year: 2017,
      mileage: 0,
      color: 'White',
      price: 9800,
    },
    claims: {},
    timeline: [],
    evidenceTimeline: [],
    listing_media: { items: [] },
    trustReport: {
      score: null,
      band: null,
      evaluation_state: 'not_evaluated',
      confidence: 'not_evaluated',
      calculation_version: null,
      evaluated_at: null,
      known_limitations: ['No governed vehicle fact is backed by an authoritative record.'],
    },
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

describe('V15 — mobile, low-bandwidth and accessibility parity', () => {
  it('announces Passport loading without relying on animation', () => {
    fetchVehiclePassport.mockReturnValue(new Promise(() => {}))
    fetchVehicleEvidence.mockReturnValue(new Promise(() => {}))

    renderPage()

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('Loading Vehicle Passport')).toBeInTheDocument()
  })

  it('fails honestly with an accessible retry instead of an endless spinner', async () => {
    fetchVehiclePassport
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(passport())
    fetchVehicleEvidence
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([])

    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('does not mean the vehicle has no records')

    fireEvent.click(screen.getByRole('button', { name: 'Retry Passport' }))
    await screen.findByRole('heading', { name: /2017 Nissan NP200/i })
    expect(fetchVehiclePassport).toHaveBeenCalledTimes(2)
  })

  it('distinguishes an evidence read failure from a genuine empty result', async () => {
    fetchVehiclePassport.mockResolvedValue(passport())
    fetchVehicleEvidence.mockRejectedValue(new Error('evidence offline'))

    renderPage()

    const status = await screen.findByTestId('passport-evidence-unavailable')
    expect(status).toHaveTextContent('not a statement that no evidence exists')
    expect(screen.queryByText('No evidence records available to CarUp')).not.toBeInTheDocument()
  })

  it('empty evidence uses conservative coverage language', async () => {
    fetchVehiclePassport.mockResolvedValue(passport())
    fetchVehicleEvidence.mockResolvedValue([])

    renderPage()

    await screen.findByRole('heading', { name: /2017 Nissan NP200/i })
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence & Media' }))

    expect(await screen.findByText('No evidence records available to CarUp')).toBeInTheDocument()
    expect(screen.getByText(/does not prove that no evidence exists/i)).toBeInTheDocument()
  })

  it('keeps compact navigation keyboard-addressable with named tabs', async () => {
    fetchVehiclePassport.mockResolvedValue(passport())
    fetchVehicleEvidence.mockResolvedValue([])

    renderPage()
    await screen.findByRole('heading', { name: /2017 Nissan NP200/i })

    for (const name of ['Documents', 'Service History', 'Insurance', 'Parts', 'Evidence & Media']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument()
    }
  })

  it('source contract preserves compact/accessibility and low-bandwidth primitives', () => {
    expect(SRC).toContain('aria-labelledby="vehicle-passport-title"')
    expect(SRC).toContain('motion-reduce:animate-none')
    expect(SRC).toContain('grid-cols-2')
    expect(SRC).toContain('min-h-11')
    expect(SRC).toContain('loading="lazy"')
    expect(SRC).toContain('<caption className="sr-only">Vehicle parts history</caption>')
    expect(SRC).toContain('scope="col"')
    expect(SRC).toContain('overflow-x-auto')
    expect(SRC).toContain('tabIndex={0}')
  })

  it('status semantics are text-labelled rather than color-only', () => {
    for (const label of ['Verified', 'Rejected', 'Pending Review', 'Public', 'Restricted', 'Private']) {
      expect(SRC).toContain(label)
    }
  })
})
