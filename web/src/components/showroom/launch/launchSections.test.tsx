import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ShowroomListingCardModel } from '@/components/showroom/ShowroomListingCard'
import type { CinematicFilm } from '@/content/media/homeFilm'

const marketplaceAiBuyerAssistant = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ marketplaceAiBuyerAssistant }) }))

const { AskCarUp } = await import('./AskCarUp')
const { ScanToStart } = await import('./ScanToStart')
const { VehicleStory } = await import('./VehicleStory')
const { SourcingJourney } = await import('./SourcingJourney')
const { EditorialFilm } = await import('@/components/showroom/EditorialFilm')

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('Ask CarUp', () => {
  it('turns a sentence into removable filters, a real Marketplace link and labelled advice', async () => {
    marketplaceAiBuyerAssistant.mockResolvedValue({ guidance: ['Request an inspection before paying.'], ai_available: false })
    wrap(<AskCarUp />)
    fireEvent.change(screen.getByTestId('ask-carup-input'), { target: { value: 'An automatic diesel pickup under $25,000 for the farm' } })
    fireEvent.click(screen.getByTestId('ask-carup-submit'))
    const result = await screen.findByTestId('ask-carup-result')
    expect(marketplaceAiBuyerAssistant).toHaveBeenCalledWith({ budget: 25000, use_case: 'An automatic diesel pickup under $25,000 for the farm' })
    expect(within(result).getByTestId('ask-carup-show-cars')).toHaveAttribute('href', '/marketplace?bodyStyle=Pickup&fuel=Diesel&transmission=Automatic&maxPrice=25000')
    expect(within(result).getByTestId('ask-carup-guidance')).toHaveTextContent('rules-based (AI not connected)')
    expect(within(result).getByTestId('ask-carup-guidance')).toHaveTextContent('cannot verify a vehicle')
    fireEvent.click(within(result).getByRole('button', { name: 'Remove Diesel' }))
    expect(within(result).getByTestId('ask-carup-show-cars')).toHaveAttribute('href', '/marketplace?bodyStyle=Pickup&transmission=Automatic&maxPrice=25000')
  })

  it('labels AI guidance as AI when the provider answered, and survives an outage with safe advice', async () => {
    marketplaceAiBuyerAssistant.mockResolvedValueOnce({ guidance: ['x'], ai_available: true })
    wrap(<AskCarUp />)
    fireEvent.click(screen.getAllByTestId('ask-carup-example')[0])
    expect(await screen.findByTestId('ask-carup-guidance')).toHaveTextContent('CarUp AI · advice')
    marketplaceAiBuyerAssistant.mockRejectedValueOnce(new Error('down'))
    fireEvent.click(screen.getAllByTestId('ask-carup-example')[1])
    await waitFor(() => expect(screen.getByTestId('ask-carup-guidance')).toHaveTextContent('never pay outside CarUp'))
  })

  it('says plainly when it understood nothing, and offers the full Marketplace', async () => {
    marketplaceAiBuyerAssistant.mockResolvedValue({ guidance: [], ai_available: false })
    wrap(<AskCarUp />)
    fireEvent.change(screen.getByTestId('ask-carup-input'), { target: { value: 'something nice' } })
    fireEvent.click(screen.getByTestId('ask-carup-submit'))
    expect(await screen.findByTestId('ask-carup-nothing-understood')).toBeInTheDocument()
    expect(screen.getByTestId('ask-carup-show-cars')).toHaveAttribute('href', '/marketplace')
  })
})

describe('Scan to Start (launch preview design)', () => {
  it('reads only a labelled sample; every reading is a suggestion until the person confirms or corrects it', async () => {
    wrap(<ScanToStart film={null} />)
    expect(screen.getByTestId('scan-demo')).toHaveTextContent('sample — not a real vehicle')
    fireEvent.click(screen.getByTestId('scan-read-sample'))
    await waitFor(() => expect(screen.getAllByTestId('scan-field').every(f => f.getAttribute('data-field-state') === 'suggested')).toBe(true))
    expect(screen.getByText('Please check')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Make is right' }))
    fireEvent.click(screen.getByRole('button', { name: 'Correct Model' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Correct Model' }), { target: { value: 'Hilux 2.4 GD-6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Hilux 2.4 GD-6')).toBeInTheDocument()
    expect(screen.getByTestId('scan-progress')).toHaveTextContent('2 of 6 confirmed')
    expect(screen.getByTestId('scan-scope')).toHaveTextContent('document reading switches on when it is certified')
  })
})

const vehicle = (overrides: Partial<ShowroomListingCardModel> = {}): ShowroomListingCardModel => ({
  vin: 'VIN1', name: '2019 Toyota Hilux', price: 32500, currency: 'USD', primaryImage: 'https://x.test/a.jpg', primaryImageState: 'first_published',
  mileage: 98400, transmission: 'Manual', fuel: 'Diesel', sellerLabel: 'Seller identity not published', locationLabel: 'Harare',
  plateStatus: 'Plate status unknown', plateVerified: false, reserved: false, partSentryChecked: false, labels: [],
  trust: { evaluation_state: 'evaluated', score: 19, band: 'low', confidence: 'low' }, syntheticDemo: true, ...overrides,
} as ShowroomListingCardModel)

describe('Vehicle Story', () => {
  it('states recorded facts and open questions from the public summary — never fills a gap', () => {
    wrap(<VehicleStory vehicle={vehicle()} />)
    expect(screen.getByTestId('vehicle-story-recorded')).toHaveTextContent('$32,500')
    const gaps = screen.getByTestId('vehicle-story-gaps')
    expect(gaps).toHaveTextContent('Trust 19/100 — low confidence')
    expect(gaps).toHaveTextContent('Plate status unknown.')
    expect(gaps).toHaveTextContent('No PartSentry parts record yet.')
    expect(gaps).toHaveTextContent('demo media, not evidence')
    expect(screen.getByTestId('vehicle-story-open')).toHaveAttribute('href', '/marketplace/VIN1')
  })

  it('an unevaluated car says so instead of showing a score', () => {
    wrap(<VehicleStory vehicle={vehicle({ trust: null, syntheticDemo: false })} />)
    expect(screen.getByTestId('vehicle-story-gaps')).toHaveTextContent('Trust has not been evaluated yet.')
  })
})

const HASH = 'a'.repeat(64)
const film = (review: 'approved' | 'owner-review'): CinematicFilm => ({
  id: 'f', review, disclosure: 'Editorial film · AI-generated, not a shipment record',
  landscape: { sources: [{ src: '/media/home-film/s.webm', type: 'video/webm', sha256: HASH, bytes: 1 }], poster: { src: '/media/home-film/s.jpg', sha256: HASH, bytes: 1 }, width: 16, height: 9, durationSeconds: 9 },
  provenance: { generator: 'g', model: 'm', generationIds: ['x'], generatedAt: 'd', approvedBy: '', approvedAt: '', approvalRef: 'ref' },
  rights: { owner: 'o', licence: 'l', licenceRef: 'r' },
})

describe('International sourcing + editorial film', () => {
  it('opens only real import routes and labels the film as editorial, not a shipment record', () => {
    wrap(<SourcingJourney film={film('owner-review')} />)
    expect(screen.getByTestId('import-start')).toHaveAttribute('href', '/diaspora/imports/new')
    expect(screen.getByTestId('import-how')).toHaveAttribute('href', '/diaspora')
    expect(screen.getByTestId('sourcing-film-disclosure')).toHaveTextContent('not a shipment record')
    expect(screen.getByTestId('sourcing-film-disclosure')).toHaveTextContent('Owner review cut')
  })

  it('reduced motion gets the poster only — the video is never requested', () => {
    const original = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    try {
      wrap(<EditorialFilm film={film('approved')} label="the film" testId="ef" />)
      expect(screen.getByTestId('ef')).toHaveAttribute('data-film-mode', 'poster')
      expect(screen.queryByTestId('ef-video')).toBeNull()
      expect(screen.queryByTestId('ef-toggle')).toBeNull()
    } finally {
      window.matchMedia = original
    }
  })

  it('a moving film has a labelled Pause control', () => {
    wrap(<EditorialFilm film={film('approved')} label="the film" testId="ef" />)
    const toggle = screen.getByTestId('ef-toggle')
    expect(toggle).toHaveAttribute('aria-label', 'Pause the film')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-label', 'Play the film')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })
})
