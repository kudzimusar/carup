import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { render, screen, fireEvent } from '@testing-library/react'
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

  /**
   * Issue #164 Phase 8, Cluster C — a present-but-dead src must degrade honestly.
   *
   * On the physically-tested baseline `993c1179` the component branched on `if (src)` alone. A URL
   * string is truthy whether or not it resolves, so the Golden fixture's dangling
   * `media.carup-staging.test` URLs produced the browser's broken-image glyph on Landing,
   * Marketplace, Detail and the owner garage, while the branded "Image unavailable" placeholder was
   * unreachable by construction. These require a live DOM (the static renderer cannot fire `error`).
   */
  describe('load failure (Issue #164 Phase 8)', () => {
    it('falls back to the placeholder when a present src FAILS to load', () => {
      render(<ListingImage src="https://media.carup-staging.test/x.jpg" alt="2019 Toyota Hilux" />)
      fireEvent.error(screen.getByRole('img', { name: '2019 Toyota Hilux' }))

      expect(screen.getByTestId('listing-image-placeholder')).toBeInTheDocument()
      expect(screen.queryByTestId('listing-image')).not.toBeInTheDocument()
      expect(screen.getByText('Image unavailable')).toBeInTheDocument()
    })

    it('never substitutes a stock vehicle photo for a failed load', () => {
      const { container } = render(<ListingImage src="https://media.carup-staging.test/x.jpg" alt="Hilux" />)
      fireEvent.error(screen.getByRole('img', { name: 'Hilux' }))
      // The honest failure state contains no <img> at all — nothing stands in for the real vehicle.
      expect(container.querySelector('img')).toBeNull()
      expect(container.innerHTML).not.toMatch(/unsplash|stock/i)
    })

    it('retries when the src changes, so one failure does not blank the rest of a gallery', () => {
      const { rerender } = render(<ListingImage src="https://media.carup-staging.test/1.jpg" alt="photo" />)
      fireEvent.error(screen.getByRole('img', { name: 'photo' }))
      expect(screen.getByTestId('listing-image-placeholder')).toBeInTheDocument()

      rerender(<ListingImage src="https://example.test/2.png" alt="photo" />)
      expect(screen.getByTestId('listing-image')).toBeInTheDocument()
      expect(screen.queryByTestId('listing-image-placeholder')).not.toBeInTheDocument()
    })
  })
})
