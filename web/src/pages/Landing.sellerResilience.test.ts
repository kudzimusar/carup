import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const landing = readFileSync(resolve(here, 'Landing.tsx'), 'utf8')
const journey = readFileSync(resolve(here, '../components/home/JourneyMediaStory.tsx'), 'utf8')

describe('Seller master Phase P — Home downstream resilience', () => {
  it('treats newest published inventory as a live showroom, not a Featured award', () => {
    expect(landing).toContain("sort: 'newest'")
    expect(landing).toContain('This is a live showroom, not an editorial "featured" award')
    expect(landing).toContain('Published vehicles to explore.')
    expect(landing).not.toContain('Featured vehicles')
  })

  it('uses the canonical Marketplace card for Home live inventory', () => {
    expect(landing).toContain('<MarketplaceListingCard')
    expect(landing).toContain('marketplaceListingToCardModel')
    expect(landing).toContain('The same published vehicle stories used in Marketplace')
  })

  it('requires renderable real listing media for the hero image and otherwise uses a designed fallback', () => {
    expect(landing).toContain('canRenderMarketplacePrimaryImage')
    expect(landing).toContain('heroImage')
    expect(landing).toContain('heroVehicle')
    expect(landing).toContain('No published listings are available for the live showroom.')
    expect(landing).toContain('CarUp has not substituted demo inventory')
  })

  it('keeps conceptual journeys independent from arbitrary listing photography', () => {
    expect(landing).toContain("journey.scene === 'buy' || journey.scene === 'sell'")
    expect(landing).toContain("{ src: null, alt: `CarUp ${journey.eyebrow} journey` }")
    for (const scene of ['verify', 'diaspora', 'finance', 'protect', 'maintain', 'parts']) {
      expect(journey).toContain(`scene === '${scene}'`)
    }
  })

  it('renders a deliberate visual fallback instead of a giant blank region when media is absent', () => {
    expect(journey).toContain('home-journey-media-fallback')
    expect(journey).toContain('listing media not available')
    expect(journey).toContain('CarFront')
    expect(journey).toContain("min-h-[220px]")
    expect(journey).not.toContain('images.unsplash.com')
  })

  it('allows only an explicit preview fixture scope to inspect automation on Home', () => {
    expect(landing).toContain("searchParams.get('fixture_scope')")
    expect(landing).toContain('...(fixtureScope ? { fixture_scope: fixtureScope } : {})')
  })
})
