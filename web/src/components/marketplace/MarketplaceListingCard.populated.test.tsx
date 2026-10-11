import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MarketplaceListingCard } from './MarketplaceListingCard'
import { marketplaceListingToCardModel } from '@/lib/marketplaceCardModel'
import type { MarketplaceListingSummary } from '@/types'

// A populated card driven only by the canonical public listing summary (OC-LAUNCH R1 §18B).
// Structural fixture — not inventory. Nothing here is rendered on a CarUp page.
const LISTING = {
  vin: 'TEST-POPULATED-0001',
  year: 2016,
  make: 'Nissan',
  model: 'Serena',
  price: 12800,
  currency: 'USD',
  mileage: 98000,
  transmission: 'Automatic',
  fuel_type: 'Petrol',
  primary_image_url: 'https://example.supabase.co/storage/v1/object/public/listing-images/test/front.jpg',
  primary_image_state: 'seller_primary',
  location: 'Harare',
  location_state: 'recorded',
  condition_category: 'locally_used',
  trust: { evaluation_state: 'not_evaluated' },
} as unknown as MarketplaceListingSummary

function renderCard(listing = LISTING) {
  render(
    <MemoryRouter>
      <MarketplaceListingCard vehicle={marketplaceListingToCardModel(listing)} href={`/marketplace/${listing.vin}`} dataTestId="populated-card" />
    </MemoryRouter>,
  )
  return screen.getByTestId('populated-card')
}

describe('populated Marketplace card from canonical listing data', () => {
  it('leads with the real photo, name, price and location, and links to the listing', () => {
    const card = renderCard()
    expect(card.textContent).toContain('2016 Nissan Serena')
    expect(card.textContent).toMatch(/12,800/)
    expect(card.textContent).toContain('Harare')
    const photo = card.querySelector('img')
    expect(photo?.getAttribute('src')).toBe(LISTING.primary_image_url)
    expect(photo?.getAttribute('alt')).toMatch(/Nissan Serena/)
    expect(card.querySelector('a[href="/marketplace/TEST-POPULATED-0001"]')).toBeTruthy()
  })
  it('never invents a price, location or Trust score the listing does not carry', () => {
    const card = renderCard({ ...LISTING, price: null, location: null, location_state: 'not_recorded', trust: null } as unknown as MarketplaceListingSummary)
    expect(card.textContent).not.toMatch(/12,800/)
    expect(card.textContent).not.toContain('Harare')
    expect(card.textContent).not.toMatch(/\b\d{2,3}\s*\/\s*100\b/)
  })
  it('does not render an image whose publication state is not governed for public display', () => {
    const card = renderCard({ ...LISTING, primary_image_state: 'pending_review' } as unknown as MarketplaceListingSummary)
    expect(card.querySelector(`img[src="${LISTING.primary_image_url}"]`)).toBeNull()
  })
})
