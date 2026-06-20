import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ListingImage } from './ListingImage'

/**
 * Defect 1 (QA Round 4): marketplace media must show REAL listing media or a NEUTRAL branded
 * placeholder — never an unrelated stock vehicle. These assertions lock that behavior in.
 */
describe('ListingImage', () => {
  it('renders a real image when src is present (no misleading fallback)', () => {
    const html = renderToStaticMarkup(
      <ListingImage src="https://cdn.example.com/real-car.jpg" alt="2017 Toyota Corolla" />,
    )
    expect(html).toContain('data-testid="listing-image"')
    expect(html).toContain('src="https://cdn.example.com/real-car.jpg"')
    expect(html).toContain('<img')
    expect(html).not.toContain('Image unavailable')
    expect(html).not.toContain('Representative image')
  })

  it('renders a neutral branded placeholder when there is no media (never a stock vehicle)', () => {
    const html = renderToStaticMarkup(<ListingImage src={null} alt="2017 BMW 320i" />)
    expect(html).toContain('data-testid="listing-image-placeholder"')
    expect(html).toContain('Image unavailable')
    expect(html).not.toContain('<img')
    // No unrelated stock photo is ever emitted (no image source of any kind).
    expect(html).not.toContain('unsplash')
    expect(html).not.toContain('src=')
  })

  it('treats empty string as no media', () => {
    const html = renderToStaticMarkup(<ListingImage src="" alt="x" />)
    expect(html).toContain('data-testid="listing-image-placeholder"')
    expect(html).not.toContain('<img')
  })

  it('labels an intentional representative image clearly', () => {
    const html = renderToStaticMarkup(
      <ListingImage src="https://cdn.example.com/stock.jpg" alt="Representative" representative />,
    )
    expect(html).toContain('data-testid="listing-image-representative"')
    expect(html).toContain('Representative image')
  })
})
