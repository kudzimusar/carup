import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { SellerInquiryList, type SellerInquiry } from './SellerInquiriesCard'
import type { Vehicle } from '@/types'

const ownedListings: Vehicle[] = [
  {
    vin: 'JTDKARFP0H3000731',
    year: 2018,
    make: 'Toyota',
    model: 'Corolla',
    price: 9500,
    status: 'Available',
  } as Vehicle,
]

const baseInquiry: SellerInquiry = {
  id: 'inq-1',
  listing_id: 'JTDKARFP0H3000731',
  inquiry_type: 'vehicle_purchase_interest',
  status: 'new',
  message: 'Is this still available?',
  contact_name: 'QA Buyer',
  contact_email: 'qa-buyer-73@staging.carup.local',
  contact_phone: '+263772000074',
  created_at: '2026-06-18T00:00:00.000Z',
}

function render(inquiries: SellerInquiry[]) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SellerInquiryList inquiries={inquiries} ownedListings={ownedListings} />
    </MemoryRouter>,
  )
}

describe('SellerInquiryList', () => {
  it('displays the associated vehicle name and VIN', () => {
    const html = render([baseInquiry])
    expect(html).toContain('2018 Toyota Corolla')
    expect(html).toContain('VIN JTDKARFP0H3000731')
  })

  it('links the vehicle identity to the Marketplace detail route', () => {
    const html = render([baseInquiry])
    expect(html).toContain('href="/marketplace/JTDKARFP0H3000731"')
  })

  it('renders buyer name, email, and phone as separate reply fields', () => {
    const html = render([baseInquiry])
    expect(html).toContain('Buyer:')
    expect(html).toContain('QA Buyer')
    expect(html).toContain('qa-buyer-73@staging.carup.local')
    expect(html).toContain('+263772000074')
  })

  it('adds safe mailto and tel actions when channels are available', () => {
    const html = render([baseInquiry])
    expect(html).toContain('href="mailto:qa-buyer-73%40staging.carup.local"')
    expect(html).toContain('href="tel:+263772000074"')
  })

  it('shows an honest no-reply-channel state when contact is absent', () => {
    const html = render([{ ...baseInquiry, contact_email: null, contact_phone: null }])
    expect(html).toContain('No reply channel available')
  })

  it('excludes inquiries whose listing is not in the seller-owned listing set', () => {
    const html = render([
      baseInquiry,
      {
        ...baseInquiry,
        id: 'other-seller-inq',
        listing_id: 'WBA8E9C50HK000732',
        contact_name: 'Other Buyer',
        message: 'This should not render',
      },
    ])
    expect(html).toContain('QA Buyer')
    expect(html).not.toContain('Other Buyer')
    expect(html).not.toContain('WBA8E9C50HK000732')
  })
})
