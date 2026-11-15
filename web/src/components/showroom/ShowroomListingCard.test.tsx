import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import {
  ShowroomListingCard,
  type ShowroomListingCardModel,
} from '@/components/showroom/ShowroomListingCard'
import { marketplaceListingToCardModel } from '@/lib/marketplaceCardModel'
import type { MarketplaceListingSummary } from '@/types'

/**
 * RX03-P1a — the Showroom card is a visual rebuild of the ONE shared Marketplace card. These tests
 * pin the truth it must keep while its layout changes: canonical Trust only, explicit currency, the
 * governed status pills only when the data carries them, labelled 44 px actions, no card-wide link
 * wrapping other controls, and the Seller preview's dead-navigation guarantee.
 */

afterEach(cleanup)

function model(overrides: Partial<ShowroomListingCardModel> = {}): ShowroomListingCardModel {
  return {
    vin: 'VINSHOWROOM0000001',
    name: '2021 Toyota Land Cruiser Prado',
    price: 61500,
    currency: 'USD',
    primaryImage: null,
    primaryImageState: 'none',
    mileage: 38200,
    transmission: 'Automatic',
    fuel: 'Diesel',
    sellerLabel: 'Borrowdale Motor House',
    locationLabel: 'Harare',
    plateStatus: 'Plate status unknown',
    plateVerified: false,
    reserved: false,
    partSentryChecked: false,
    labels: ['Locally Used'],
    trust: null,
    ...overrides,
  }
}

function renderCard(props: Partial<React.ComponentProps<typeof ShowroomListingCard>> = {}) {
  return render(
    <MemoryRouter>
      <ShowroomListingCard vehicle={props.vehicle ?? model()} href="/marketplace/VINSHOWROOM0000001" {...props} />
    </MemoryRouter>,
  )
}

describe('ShowroomListingCard — canonical Trust line', () => {
  it('shows score, band and confidence only for an evaluated canonical projection', () => {
    renderCard({ vehicle: model({ trust: { evaluation_state: 'evaluated', score: 82, band: 'high', confidence: 'medium' } }) })
    const trust = screen.getByTestId('marketplace-card-trust')
    expect(trust.textContent).toContain('CarUp Trust 82/100')
    expect(trust.textContent).toContain('High')
    expect(trust.textContent).toContain('Medium confidence')
    expect(trust.textContent).not.toContain('No legacy score is substituted')
  })

  it.each([
    ['not_evaluated', 'Not evaluated yet'],
    ['stale', 'Evaluation update pending'],
    ['unavailable', 'Trust temporarily unavailable'],
  ])('a %s projection states its own sentence and never a number', (state, copy) => {
    renderCard({ vehicle: model({ trust: { evaluation_state: state, score: 91, band: 'high', confidence: 'high' } }) })
    const trust = screen.getByTestId('marketplace-card-trust')
    expect(trust.textContent).toContain(copy)
    expect(trust.textContent).toContain('No legacy score is substituted')
    expect(trust.textContent).not.toMatch(/\d+\/100/)
    expect(trust.textContent).not.toContain('91')
  })

  it('a card that never read the Trust authority sends the buyer to the Passport', () => {
    renderCard({ vehicle: model({ trust: null }) })
    expect(screen.getByTestId('marketplace-card-trust').textContent).toContain('Trust details on Vehicle Passport')
  })
})

describe('ShowroomListingCard — price and facts', () => {
  it.each([
    [{ price: 61500, currency: 'USD' }, '$61,500'],
    [{ price: 21500, currency: 'zig' }, 'ZiG 21,500'],
    [{ price: 9900, currency: 'zar' }, 'ZAR 9,900'],
    [{ price: 26900, currency: null }, '26,900 · currency not recorded'],
    [{ price: null, currency: 'USD' }, 'Price not recorded'],
  ])('formats %o as "%s"', (overrides, expected) => {
    renderCard({ vehicle: model(overrides) })
    expect(screen.getByTestId('marketplace-card-price').textContent).toBe(expected)
  })

  it('keeps mileage, gearbox and fuel on one spec line and honours showMissingMileage', () => {
    const { unmount } = renderCard({ vehicle: model(), mileageTestId: 'card-mileage' })
    expect(screen.getByTestId('card-mileage').textContent).toBe('38,200 km')
    expect(screen.getByText('Automatic')).toBeInTheDocument()
    expect(screen.getByText('Diesel')).toBeInTheDocument()
    unmount()

    renderCard({ vehicle: model({ mileage: null }), mileageTestId: 'card-mileage', showMissingMileage: true })
    expect(screen.getByTestId('card-mileage').textContent).toBe('Mileage not recorded')
  })

  it('keeps location, seller and plate status as exact, separately addressable facts', () => {
    renderCard({ vehicle: model({ plateStatus: 'Plate confirmed' }), locationTestId: 'card-location' })
    expect(screen.getByTestId('card-location').textContent).toBe('Harare')
    expect(screen.getByTestId('marketplace-plate-status').textContent).toBe('Plate confirmed')
    expect(screen.getByText('Borrowdale Motor House')).toBeInTheDocument()
  })

  it('renders at most three condition tags', () => {
    renderCard({ vehicle: model({ labels: ['Locally Used', 'Dealer Verified', 'Passport Verified', 'Low Mileage'] }) })
    expect(screen.getAllByTestId('marketplace-condition-tag').map(tag => tag.textContent)).toEqual([
      'Locally Used', 'Dealer Verified', 'Passport Verified',
    ])
  })
})

describe('ShowroomListingCard — status pills come only from the data', () => {
  it('renders no governed pill for a listing that carries no signal', () => {
    renderCard()
    for (const id of ['carup-gold-badge', 'synthetic-demo-media-badge', 'marketplace-plate-confirmed-badge', 'marketplace-partsentry-badge']) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
    expect(screen.queryByText('Reserved')).toBeNull()
  })

  it('renders each pill when, and only when, its signal is present', () => {
    renderCard({ vehicle: model({ carupGold: true, syntheticDemo: true, plateVerified: true, reserved: true, partSentryChecked: true }) })
    expect(screen.getByTestId('carup-gold-badge').textContent).toContain('CarUp Gold')
    expect(screen.getByTestId('synthetic-demo-media-badge').textContent).toContain('Demo media')
    expect(screen.getByTestId('marketplace-plate-confirmed-badge').textContent).toContain('Plate confirmed')
    expect(screen.getByTestId('marketplace-partsentry-badge').textContent).toContain('PartSentry checked')
    expect(screen.getByText('Reserved')).toBeInTheDocument()
  })
})

describe('ShowroomListingCard — actions and navigation', () => {
  it('labels every round action, exposes pressed state and keeps them out of the links', () => {
    const onCompare = vi.fn()
    const onShare = vi.fn()
    const onFavorite = vi.fn()
    renderCard({ isCompared: true, isFavorite: false, onCompare, onShare, onFavorite })

    const compare = screen.getByTestId('marketplace-compare-toggle')
    expect(compare).toHaveAttribute('aria-label', 'Remove from compare')
    expect(compare).toHaveAttribute('aria-pressed', 'true')
    const save = screen.getByTestId('marketplace-save-toggle')
    expect(save).toHaveAttribute('aria-label', 'Save listing')
    expect(save).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('marketplace-share-button')).toHaveAttribute('aria-label', 'Share listing')

    for (const button of [compare, save, screen.getByTestId('marketplace-share-button')]) {
      expect(button.className).toContain('h-11')
      expect(button.className).toContain('w-11')
      expect(button.closest('a')).toBeNull()
    }
    // The card itself is not one giant link: image, title and CTA are three separate links.
    const card = screen.getByTestId('marketplace-vehicle-card')
    expect(card.tagName).toBe('ARTICLE')
    expect(card.closest('a')).toBeNull()
    const links = within(card).getAllByRole('link')
    expect(links).toHaveLength(3)
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/marketplace/VINSHOWROOM0000001')
      expect(link.querySelector('button, a')).toBeNull()
    }
    expect(screen.getByTestId('marketplace-view-passport')).toHaveAttribute('aria-label', 'View 2021 Toyota Land Cruiser Prado')
    expect(screen.getByRole('link', { name: 'Open 2021 Toyota Land Cruiser Prado' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Explore vehicle & Passport/ })).toBeInTheDocument()
  })

  it('renders no action buttons when no handlers are passed', () => {
    renderCard()
    expect(screen.queryByTestId('marketplace-compare-toggle')).toBeNull()
    expect(screen.queryByTestId('marketplace-share-button')).toBeNull()
    expect(screen.queryByTestId('marketplace-save-toggle')).toBeNull()
  })

  it('preview mode keeps the real layout but has no navigation at all', () => {
    renderCard({ previewMode: true, ctaLabel: 'Draft buyer preview' })
    const card = screen.getByTestId('marketplace-vehicle-card')
    expect(within(card).queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByTestId('marketplace-draft-preview-image')).toBeInTheDocument()
    expect(screen.getByTestId('marketplace-draft-preview-cta').textContent).toContain('Draft buyer preview')
    expect(screen.queryByTestId('marketplace-view-passport')).toBeNull()
  })

  it('the feature layout is presentation only: same facts, same links, same ids', () => {
    renderCard({ layout: 'feature', vehicle: model({ primaryImage: 'https://media.example.test/a.jpg', primaryImageState: 'first_published', trust: { evaluation_state: 'evaluated', score: 50, band: 'moderate', confidence: 'low' } }) })
    const card = screen.getByTestId('marketplace-vehicle-card')
    expect(card).toHaveAttribute('data-card-layout', 'feature')
    expect(screen.getByTestId('marketplace-card-price').textContent).toBe('$61,500')
    expect(screen.getByTestId('marketplace-card-trust').textContent).toContain('50/100')
    expect(within(card).getAllByRole('link')).toHaveLength(3)
  })
})

describe('ShowroomListingCard — listings without a usable photo (R3)', () => {
  it('never takes the wide feature layout without a real photo', () => {
    renderCard({ layout: 'feature', vehicle: model() })
    const card = screen.getByTestId('marketplace-vehicle-card')
    expect(card).toHaveAttribute('data-card-layout', 'standard')
    expect(card).toHaveAttribute('data-card-photo', 'none')
  })

  it('uses the compact plate: honest label, accessible name, no duplicated actions', () => {
    renderCard({ vehicle: model({ bodyStyle: 'SUV' }), onCompare: () => {}, onShare: () => {}, onFavorite: () => {} })
    const plate = screen.getByTestId('listing-image-placeholder')
    expect(plate).toHaveAttribute('data-plate-layout', 'compact')
    expect(plate).toHaveTextContent('Image unavailable')
    expect(plate).toHaveAccessibleName(/image unavailable \(studio placeholder, not a photo of this vehicle\)/)
    for (const id of ['marketplace-compare-toggle', 'marketplace-share-button', 'marketplace-save-toggle']) {
      expect(screen.getAllByTestId(id)).toHaveLength(1)
    }
  })

  it('a card with a real photo keeps the 4:3 photo and no plate', () => {
    renderCard({ vehicle: model({ primaryImage: 'https://media.example.test/a.jpg', primaryImageState: 'first_published' }) })
    expect(screen.queryByTestId('listing-image-placeholder')).toBeNull()
    expect(screen.getByTestId('marketplace-vehicle-card')).toHaveAttribute('data-card-photo', 'published')
  })
})

describe('ShowroomListingCard — studio plate silhouette wiring', () => {
  it('passes the listing body style through to the placeholder', () => {
    renderCard({ vehicle: model({ bodyStyle: 'Pickup' }) })
    expect(screen.getByTestId('listing-image-placeholder')).toHaveAttribute('data-studio-plate', 'pickup')
  })

  it('marketplaceListingToCardModel carries body_style, and nothing when it is blank', () => {
    const base = {
      vin: 'VINSHOWROOM0000002', make: 'Toyota', model: 'Hilux', year: 2019, price: 1, currency: 'USD', mileage: 1,
      status: 'Available', condition_category: 'locally_used', marketplace_tags: [], trust_score: null,
      primary_image_state: 'none', primary_image_unpublishable_count: 0, plate_verified: false, passport_verified: false,
      evidence_count: 0, partsentry_checked: false, repair_history_count: 0, verified_parts_count: 0, duty_cleared: false,
      zimra_verified: false, cid_clear: false, seller_type: 'private', seller_display_label: null, seller_public_profile_enabled: false,
    } as unknown as MarketplaceListingSummary
    expect(marketplaceListingToCardModel({ ...base, body_style: ' Pickup ' }).bodyStyle).toBe('Pickup')
    expect(marketplaceListingToCardModel({ ...base, body_style: '  ' }).bodyStyle).toBeNull()
    expect(marketplaceListingToCardModel(base).bodyStyle).toBeNull()
  })
})
