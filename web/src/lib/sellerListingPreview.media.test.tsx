import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { MarketplaceListingCard } from '@/components/marketplace/MarketplaceListingCard'
import { sellerDraftToCardModel } from '@/lib/sellerListingPreview'

const BASE = {
  make: 'Toyota',
  model: 'Hilux',
  year: '2021',
  color: 'White',
  mileage: '45000',
  condition: 'Used',
  category: 'Pickup',
  fuelType: 'Diesel',
  transmission: 'Automatic',
  drivetrain: '4WD',
  location: 'Harare',
  province: 'Harare',
  price: '28500',
  currency: 'USD',
  images: [
    'data:image/png;base64,front',
    'data:image/png;base64,rear',
  ],
}

afterEach(cleanup)

describe('Seller draft media preview boundary', () => {
  it('uses the seller-selected local cover without claiming a published media state', () => {
    const model = sellerDraftToCardModel({ ...BASE, coverImageIndex: 1 })
    expect(model.primaryImage).toBe(BASE.images[1])
    expect(model.primaryImageState).toBe('draft_local')
  })

  it('renders a browser-local draft image only when the explicit preview guard is enabled', () => {
    const model = sellerDraftToCardModel(BASE)
    render(
      <MemoryRouter>
        <MarketplaceListingCard
          vehicle={model}
          href="#"
          previewMode
          allowLocalDraftMedia
          ctaLabel="Draft buyer preview"
        />
      </MemoryRouter>,
    )
    expect(screen.getByAltText('2021 Toyota Hilux').getAttribute('src')).toBe(BASE.images[0])
    expect(screen.queryByText('Image unavailable')).toBeNull()
  })

  it('does not weaken the public Marketplace media state machine', () => {
    const model = sellerDraftToCardModel(BASE)
    render(
      <MemoryRouter>
        <MarketplaceListingCard vehicle={model} href="/marketplace/demo" />
      </MemoryRouter>,
    )
    expect(screen.getByText('Image unavailable')).toBeTruthy()
  })

  it('still refuses a remote URL masquerading as browser-local draft media', () => {
    const model = sellerDraftToCardModel({ ...BASE, images: ['https://example.invalid/car.jpg'] })
    render(
      <MemoryRouter>
        <MarketplaceListingCard vehicle={model} href="#" previewMode allowLocalDraftMedia />
      </MemoryRouter>,
    )
    expect(screen.getByText('Image unavailable')).toBeTruthy()
  })
})
