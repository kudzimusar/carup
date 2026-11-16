import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { MarketplaceListingSummary } from '@/types'

/**
 * RX03-P1a — the cinematic Home keeps the truth contracts of the page it replaced:
 * live inventory only, an outage is never shown as an empty showroom, the reel only uses
 * renderable seller media and marks synthetic demo photos, and search hands off to Marketplace.
 */
vi.setConfig({ testTimeout: 30_000 })

const fetchMarketplaceListings = vi.fn()
const marketplaceAiBuyerAssistant = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ fetchMarketplaceListings, marketplaceAiBuyerAssistant }) }))
// The reel/plate behaviour is tested with no film in the manifest; film playback has its own tests.
vi.mock('@/content/media/homeFilms.data', () => ({
  HOME_FILM: null, SOURCING_FILM: null, SCAN_FILM: null,
  HOME_FILM_STATUS: { state: 'hold', reason: 'test' },
}))
vi.mock('@/components/marketplace/BuyerAssistantDrawer', () => ({
  BuyerAssistantDrawer: ({ triggerLabel }: { triggerLabel: string }) => <button type="button" data-testid="marketplace-ai-assistant-open">{triggerLabel}</button>,
}))

const { default: Landing } = await import('./ShowroomLanding')
const { reelFramesFrom } = await import('@/lib/homeReel')

function listing(vin: string, overrides: Partial<MarketplaceListingSummary> = {}) {
  return {
    vin,
    make: 'Toyota',
    model: 'Hilux',
    year: 2019,
    price: 32500,
    currency: 'USD',
    mileage: 86000,
    body_style: 'Pickup',
    location: 'Harare',
    location_state: 'recorded',
    condition_category: 'locally_used',
    marketplace_tags: [],
    seller_display_label: 'Private seller',
    primary_image_url: `https://media.example.test/${vin}.jpg`,
    primary_image_state: 'first_published',
    ...overrides,
  } as unknown as MarketplaceListingSummary
}

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname}{location.search}</p>
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  fetchMarketplaceListings.mockReset()
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
})

describe('reelFramesFrom', () => {
  it('uses only renderable seller media, varies body styles first, caps at five and marks demo media', () => {
    const frames = reelFramesFrom([
      listing('P1'),
      listing('P2'),
      listing('S1', { body_style: 'Sedan', model: 'Corolla' }),
      listing('NOIMG', { primary_image_url: null, primary_image_state: 'none' } as Partial<MarketplaceListingSummary>),
      listing('HELD', { body_style: 'Van', primary_image_state: 'none' } as Partial<MarketplaceListingSummary>),
      listing('DEMO', { body_style: 'SUV', primary_image_url: 'https://x.test/vehicle-images/marketplace-reference-synthetic/v1/DEMO/a.png' }),
      listing('H1', { body_style: 'Hatchback' }),
      listing('C1', { body_style: 'Coupe' }),
    ])
    expect(frames.map(frame => frame.id)).toEqual(['P1', 'S1', 'DEMO', 'H1', 'C1'])
    expect(frames.find(frame => frame.id === 'DEMO')?.badge).toBe('Demo media')
    expect(frames.find(frame => frame.id === 'P1')?.badge).toBeUndefined()
    expect(frames[0].href).toBe('/marketplace/P1')
  })
})

describe('Landing — cinematic Open/Pocket Showroom', () => {
  it('opens on one h1 and the live reel, with real published cars below', async () => {
    fetchMarketplaceListings.mockResolvedValue({ listings: [listing('P1'), listing('S1', { body_style: 'Sedan' })] })
    renderHome()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    await waitFor(() => expect(screen.getByTestId('home-hero')).toHaveAttribute('data-hero-mode', 'reel'))
    const inventory = screen.getByTestId('home-live-inventory')
    expect(within(inventory).getAllByTestId('featured-verified-car')).toHaveLength(2)
    expect(fetchMarketplaceListings).toHaveBeenCalledWith({ limit: 12, sort: 'newest' })
  })

  it('says the Marketplace is unavailable on a failed read — no empty claim, no cards, brand plate only', async () => {
    fetchMarketplaceListings.mockRejectedValue(new Error('503'))
    renderHome()
    expect(await screen.findByTestId('featured-unavailable')).toHaveTextContent('CarUp has not substituted demo inventory')
    expect(screen.queryByTestId('featured-empty')).toBeNull()
    expect(screen.queryByTestId('featured-verified-car')).toBeNull()
    expect(screen.getByTestId('home-hero')).toHaveAttribute('data-hero-mode', 'plate')
  })

  it('keeps an honest empty state for a genuinely empty Marketplace', async () => {
    fetchMarketplaceListings.mockResolvedValue({ listings: [] })
    renderHome()
    expect(await screen.findByTestId('featured-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('featured-unavailable')).toBeNull()
  })

  it('hands a search to the Marketplace query string', async () => {
    fetchMarketplaceListings.mockResolvedValue({ listings: [] })
    renderHome()
    fireEvent.change(screen.getByTestId('home-buy-search'), { target: { value: 'Toyota Hilux' } })
    fireEvent.click(screen.getByTestId('home-search-submit'))
    expect(await screen.findByTestId('where')).toHaveTextContent('/marketplace?q=Toyota%20Hilux')
  })

  it('offers Buy, Sell, Verify and Import as one keyboard-reachable console', async () => {
    fetchMarketplaceListings.mockResolvedValue({ listings: [] })
    renderHome()
    const console = screen.getByTestId('home-primary-search')
    const tabs = within(console).getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual(['Buy', 'Sell', 'Verify', 'Import'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the trust vocabulary, body-style shortcuts, quick searches and help routes', async () => {
    fetchMarketplaceListings.mockResolvedValue({ listings: [] })
    renderHome()
    const strip = screen.getByTestId('home-trust-strip')
    for (const label of ['Plate Check', 'Evidence Timeline', 'Owner Privacy', 'Canonical Trust', 'SafePay routes']) {
      expect(strip).toHaveTextContent(label)
    }
    expect(screen.getByTestId('home-partsentry-trust-signal')).toHaveTextContent('PartSentry')
    expect(screen.getAllByTestId('home-body-style')[0]).toHaveAttribute('href', '/marketplace?bodyStyle=SUV')
    expect(screen.getAllByTestId('popular-search-chip')).toHaveLength(19)
    const help = screen.getByTestId('home-communications')
    expect(within(help).getByRole('link', { name: /Gutu AI/ })).toHaveAttribute('href', '#ask-carup')
    expect(within(help).getAllByTestId('whatsapp-glyph')).toHaveLength(2)
    expect(help).toHaveTextContent('not affiliated with or endorsed by Meta')
    expect(within(help).getByRole('link', { name: /Help centre/ })).toHaveAttribute('href', '/help')
    expect(within(help).getByRole('link', { name: /Contact CarUp/ })).toHaveAttribute('href', '/contact')
  })
})

describe('RX03 Addendum 05 — launch experience on Home', () => {
  it('places Ask CarUp, Vehicle Story, Import and Conversations; Scan to Start stays out without the preview switch', async () => {
    fetchMarketplaceListings.mockResolvedValue({ listings: [] })
    renderHome()
    expect(screen.getByTestId('home-ask-carup')).toBeInTheDocument()
    expect(screen.getByTestId('home-import-journey')).toBeInTheDocument()
    expect(screen.getByTestId('import-start')).toHaveAttribute('href', '/diaspora/imports/new')
    expect(screen.queryByTestId('home-scan-to-start')).toBeNull()
    expect(screen.getByTestId('home-conversion-studio')).toBeInTheDocument()
  })

  it('shows Scan to Start (labelled as a launch preview) only with the preview switch', async () => {
    ;(globalThis as Record<string, unknown>).__CARUP_LAUNCH_PREVIEW__ = true
    try {
      fetchMarketplaceListings.mockResolvedValue({ listings: [] })
      renderHome()
      expect(screen.getByTestId('home-scan-to-start')).toHaveAttribute('data-capability-state', 'launch-preview')
      expect(screen.getByTestId('scan-preview-badge')).toHaveTextContent('Launch preview')
      expect(screen.queryByTestId('home-conversion-studio')).toBeNull()
    } finally {
      delete (globalThis as Record<string, unknown>).__CARUP_LAUNCH_PREVIEW__
    }
  })

  it('the hero Import intent opens the real import routes', async () => {
    fetchMarketplaceListings.mockResolvedValue({ listings: [] })
    renderHome()
    const tab = screen.getByTestId('home-intent-import')
    fireEvent.mouseDown(tab)
    fireEvent.click(tab)
    await waitFor(() => expect(screen.getByTestId('home-import-start')).toHaveAttribute('href', '/diaspora/imports/new'))
  })
})
