import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { AdminInquiryCard, AiAdvisoryPanel, type AdminInquiry, type AdminListing } from './MarketplaceModeration'

const listing: AdminListing = {
  vin: '1HGBH41JXMN109186',
  make: 'Toyota',
  model: 'Corolla',
  year: 2018,
  price: 9500,
  currency: 'USD',
  trust_score: 78,
  public_status: 'public',
  risk_status: 'clear',
}

const inquiry: AdminInquiry = {
  id: 'inq-1',
  listing_id: '1HGBH41JXMN109186',
  inquiry_type: 'vehicle_purchase_interest',
  status: 'contacted',
  risk_status: 'clear',
  contact_name: 'QA Buyer',
  contact_email: 'qa-buyer-73@staging.carup.local',
  contact_phone: '+263772000074',
  referral_attributed: true,
  created_at: '2026-06-18T00:00:00.000Z',
}

function renderInquiry(row: AdminInquiry = inquiry, rowListing: AdminListing | null = listing) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AdminInquiryCard inquiry={row} listing={rowListing ?? undefined} updating={false} onUpdate={vi.fn()} />
    </MemoryRouter>,
  )
}

describe('MarketplaceModeration admin inquiry UI', () => {
  it('displays the associated vehicle name and VIN', () => {
    const html = renderInquiry()
    expect(html).toContain('2018 Toyota Corolla')
    expect(html).toContain('VIN 1HGBH41JXMN109186')
  })

  it('links the vehicle identity to the Marketplace detail route', () => {
    const html = renderInquiry()
    expect(html).toContain('href="/marketplace/1HGBH41JXMN109186"')
  })

  it('renders buyer name, email, and phone separately with safe actions', () => {
    const html = renderInquiry()
    expect(html).toContain('Buyer:')
    expect(html).toContain('QA Buyer')
    expect(html).toContain('href="mailto:qa-buyer-73%40staging.carup.local"')
    expect(html).toContain('href="tel:+263772000074"')
  })

  it('shows an honest no-reply-channel state when contact is absent', () => {
    const html = renderInquiry({ ...inquiry, contact_email: null, contact_phone: null })
    expect(html).toContain('No reply channel available')
  })

  it('shows clear risk and disables the currently selected status action', () => {
    const html = renderInquiry()
    expect(html).toContain('risk: clear')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('Current: contacted')
  })

  it('falls back to listing id when an admin listing is not already loaded', () => {
    const html = renderInquiry(inquiry, null)
    expect(html).toContain('Listing 1HGBH41JXMN109186')
    expect(html).toContain('VIN 1HGBH41JXMN109186')
  })
})

describe('MarketplaceModeration AI advisory panel', () => {
  it('persists moderation summary content in the command center markup', () => {
    const html = renderToStaticMarkup(
      <AiAdvisoryPanel
        advisory={{
          vin: listing.vin,
          vehicle: '2018 Toyota Corolla · VIN 1HGBH41JXMN109186',
          summary: 'Evidence and trust signals look consistent.',
          suggested_action: 'approve',
          source: 'AI advisory',
        }}
        onDismiss={vi.fn()}
      />,
    )

    expect(html).toContain('Moderation advisory')
    expect(html).toContain('2018 Toyota Corolla · VIN 1HGBH41JXMN109186')
    expect(html).toContain('Evidence and trust signals look consistent.')
    expect(html).toContain('Suggested action: approve')
    expect(html).toContain('aria-label="Dismiss moderation advisory"')
  })
})
