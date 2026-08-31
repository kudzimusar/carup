/**
 * The owner's three media states must stay three on screen.
 *
 * `listingMedia.ts` computes `not_loaded` vs `none` deliberately, and `ownerListingMedia` in
 * server.js maps a FAILED `listing_images` read to `null` precisely so the block can answer
 * `not_loaded`. Before this component, a repo-wide search for `listingMediaState` outside the
 * library and its own unit test returned ZERO hits: every owner surface passed only the URL into
 * `ListingImage` and discarded the state, so a seller whose photos CarUp could not read saw
 * exactly what a seller with no photos sees.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OwnerListingMedia } from './OwnerListingMedia'

const item = (over: Record<string, unknown> = {}) => ({
  media_id: 'm1',
  url: 'https://cdn.example.test/a.png',
  url_form: 'absolute_https',
  position: 0,
  seller_order: 0,
  is_primary: true,
  photo_label: 'Front three-quarter',
  ...over,
})

const block = (items: unknown[], state = 'published') => ({
  state, items, unpublishable_count: 0, empty_statement: null,
})

describe('OwnerListingMedia — a failed read is not "no photos"', () => {
  it('renders the seller-selected primary when media is published', () => {
    render(<OwnerListingMedia media={block([item()])} alt="2019 Toyota Hilux" />)
    const img = screen.getByRole('img', { name: '2019 Toyota Hilux' }) as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://cdn.example.test/a.png')
    expect(screen.queryByTestId('owner-listing-media-not-loaded')).toBeNull()
    expect(screen.queryByTestId('owner-listing-media-none')).toBeNull()
  })

  it('honours the seller primary over document order', () => {
    const media = block([
      item({ media_id: 'm1', url: 'https://cdn.example.test/first.png', is_primary: false, position: 0 }),
      item({ media_id: 'm2', url: 'https://cdn.example.test/chosen.png', is_primary: true, position: 1 }),
    ])
    render(<OwnerListingMedia media={media} alt="Hilux" />)
    expect((screen.getByRole('img', { name: 'Hilux' }) as HTMLImageElement).getAttribute('src'))
      .toBe('https://cdn.example.test/chosen.png')
  })

  it('a FAILED read says so, and never says the seller has no photos', () => {
    // `not_loaded` is what ownerListingMedia produces when readListingImagesCompat returns null.
    render(<OwnerListingMedia media={block([], 'not_loaded')} alt="Hilux" />)
    const el = screen.getByTestId('owner-listing-media-not-loaded')
    expect(el.textContent).toMatch(/could not be loaded/i)
    expect(el.textContent).toMatch(/does not mean you have none/i)
    expect(screen.queryByTestId('owner-listing-media-none')).toBeNull()
    expect(el.textContent).not.toMatch(/no photos added/i)
  })

  it('an ABSENT or malformed block is treated as not-loaded, never as none', () => {
    for (const media of [undefined, null, {}, 'nonsense', { items: 'not-an-array' }]) {
      const { unmount } = render(<OwnerListingMedia media={media} alt="Hilux" />)
      expect(screen.getByTestId('owner-listing-media-not-loaded')).toBeTruthy()
      expect(screen.queryByTestId('owner-listing-media-none')).toBeNull()
      unmount()
    }
  })

  it('a genuine EMPTY read says "no photos added yet"', () => {
    // ANTI-VACUITY for the case above: a successful read that found nothing is a real fact and
    // must still be stated, or the fix would just suppress every absence.
    render(<OwnerListingMedia media={block([], 'none')} alt="Hilux" />)
    const el = screen.getByTestId('owner-listing-media-none')
    expect(el.textContent).toMatch(/no photos added yet/i)
    expect(screen.queryByTestId('owner-listing-media-not-loaded')).toBeNull()
  })

  it('the two absences are visibly different from each other', () => {
    const { container: a, unmount } = render(<OwnerListingMedia media={block([], 'none')} alt="H" />)
    const noneText = a.textContent || ''
    unmount()
    const { container: b } = render(<OwnerListingMedia media={block([], 'not_loaded')} alt="H" />)
    const notLoadedText = b.textContent || ''
    expect(noneText).not.toBe(notLoadedText)
  })

  it('never falls back to evidence media or a stock photograph', () => {
    const { container } = render(<OwnerListingMedia media={block([], 'not_loaded')} alt="Hilux" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toMatch(/unsplash|evidence|placeholder\.com/i)
  })

  it('an item with a blank url is not a photograph', () => {
    render(<OwnerListingMedia media={block([item({ url: '   ' })])} alt="Hilux" />)
    // The block SAID published, so "none" would be wrong; there is simply nothing addressable.
    expect(screen.queryByRole('img', { name: 'Hilux' })).toBeNull()
  })
})
