/**
 * T11-CAP-LR01-R2 step F — the owner's PRIVATE gallery of their own vehicle.
 *
 * What it must keep true on screen: the block is ABSENT for a viewer who is not entitled (the component renders nothing, so the page is
 * indistinguishable from a vehicle with no photographs); `not_loaded` is never "none"; a photograph is drawn only from an https view; a review
 * state describes the photograph and never hides it; and nothing about where the bytes live reaches the DOM.
 */
import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { GovernedGallery } from './GovernedGallery'
import { GovernedPhoto } from './GovernedPhoto'
import { OwnerVehicleHero } from '@/components/listing/OwnerVehicleHero'

const item = (rank: number, over: Record<string, unknown> = {}) => ({
  gallery_item_id: `g${rank}`, gallery_rank: rank, designated_primary: false, designation_basis: null, caption: null, review_status: 'pending',
  view: { href: `https://signed.example.test/p${rank}.jpg?token=abc`, expires_at: '2026-10-26T06:00:00Z' }, ...over,
})
const block = (items: unknown[], over: Record<string, unknown> = {}) => ({ state: 'available', items, total_count: items.length, unavailable_count: 0, empty_statement: null, ...over })
const gallery = (media: unknown) => render(<GovernedGallery media={media} title="Photographs" vehicleLabel="2018 Honda Vezel" />)

describe('GovernedGallery', () => {
  it('renders NOTHING when no block was sent — an unentitled viewer sees no trace of it', () => {
    for (const media of [undefined, null, {}, 'x', { state: 'bogus', items: [] }]) {
      const { container, unmount } = gallery(media)
      expect(container.innerHTML).toBe('')
      unmount()
    }
  })

  it('shows the photographs, the position, the review state and that they are private', () => {
    gallery(block([item(1, { designated_primary: true }), item(2), item(3)], { total_count: 50 }))
    expect(screen.getByTestId('governed-gallery-private').textContent).toMatch(/private to you/i)
    expect(screen.getByTestId('governed-gallery-position').textContent).toBe('Photograph 1 of 50')
    expect(screen.getByTestId('governed-gallery-review').textContent).toBe('Awaiting review')
    const hero = screen.getAllByRole('img').find((i) => i.getAttribute('alt') === '2018 Honda Vezel — photograph 1 of 50')
    expect(hero).toBeTruthy()
    expect(within(screen.getByTestId('governed-gallery-thumbs')).getAllByRole('button')).toHaveLength(3)
    expect(screen.getByTestId('governed-gallery-note').textContent).toMatch(/not part of any listing/i)
    expect(screen.getByTestId('governed-gallery-note').textContent).toMatch(/does not hide it from you/i)
  })

  it('choosing a thumbnail changes the large photograph, and the choice is announced as pressed', () => {
    gallery(block([item(1), item(2, { review_status: 'verified', caption: 'Rear view' })]))
    const second = screen.getByRole('button', { name: 'Show photograph 2 of 2' })
    expect(second.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(second)
    expect(second.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('governed-gallery-position').textContent).toBe('Photograph 2 of 2')
    expect(screen.getByTestId('governed-gallery-review').textContent).toBe('Verified by CarUp')
    expect(screen.getByText('Rear view')).toBeTruthy()
    expect((screen.getByTestId('governed-gallery-open') as HTMLAnchorElement).getAttribute('href')).toBe('https://signed.example.test/p2.jpg?token=abc')
    expect((screen.getByTestId('governed-gallery-open') as HTMLAnchorElement).getAttribute('rel')).toMatch(/noopener/)
  })

  it('"not loaded" says it could not be read and does not say there are none', () => {
    gallery({ state: 'not_loaded', items: [], total_count: 0, unavailable_count: 0, empty_statement: null })
    expect(screen.getByTestId('governed-gallery-not-loaded').textContent).toMatch(/could not be loaded.*does not mean there are none/i)
    expect(screen.queryByTestId('governed-gallery-none')).toBeNull()
  })

  it('"none" is a statement that none are on file; an "available" block with nothing drawable is not that statement', () => {
    const none = gallery({ state: 'none', items: [], total_count: 0, unavailable_count: 0, empty_statement: 'No photographs are on file for this vehicle.' })
    expect(screen.getByTestId('governed-gallery-none').textContent).toBe('No photographs are on file for this vehicle.')
    none.unmount()
    gallery(block([item(1, { view: { href: 'javascript:alert(1)', expires_at: null } })]))
    expect(screen.getByTestId('governed-gallery-none').textContent).toMatch(/on file, but none can be shown right now/i)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('photographs that could not be given a view are counted as a fault, not dropped silently', () => {
    gallery(block([item(1)], { total_count: 50, unavailable_count: 2 }))
    expect(screen.getByTestId('governed-gallery-unavailable').textContent).toMatch(/2 photographs could not be shown right now/i)
  })

  it('never puts where the bytes live, or who handled them, into the page', () => {
    const { container } = gallery(block([item(1)]))
    const html = container.innerHTML
    for (const leaked of ['ocr-documents', 'storage_bucket', 'file_path', 'evidence_id', 'uploaded_by', 'tenant_id']) expect(html).not.toContain(leaked)
  })

  it('a photograph whose view has gone stale says so instead of showing a broken image', () => {
    render(<GovernedPhoto src="https://signed.example.test/gone.jpg" alt="Vezel" />)
    fireEvent.error(screen.getByRole('img', { name: 'Vezel' }))
    expect(screen.getByTestId('governed-photo-unavailable').textContent).toMatch(/not available right now.*reload/i)
    expect(screen.queryByTestId('governed-photo')).toBeNull()
  })
})

describe('OwnerVehicleHero — three kinds of picture stay apart', () => {
  const listing = (state = 'published', items: unknown[] = [{ media_id: 'm1', url: 'https://cdn.example.test/listing.jpg', url_form: 'absolute_https', position: 0, is_primary: true }]) => ({ state, items, unpublishable_count: 0, empty_statement: null })

  it('a published listing photograph wins, unchanged, and the private one is not shown beside it', () => {
    render(<OwnerVehicleHero listingMedia={listing()} governedMedia={block([item(1)])} alt="Vezel" />)
    expect((screen.getByRole('img', { name: 'Vezel' }) as HTMLImageElement).getAttribute('src')).toBe('https://cdn.example.test/listing.jpg')
    expect(screen.queryByTestId('owner-vehicle-hero-governed')).toBeNull()
  })

  it('with no listing photograph, the owner\'s private hero stands in — marked private, with its own review state', () => {
    render(<OwnerVehicleHero listingMedia={listing('none', [])} governedMedia={block([item(2), item(1, { designated_primary: true })])} alt="Vezel" />)
    const hero = screen.getByTestId('owner-vehicle-hero-governed')
    expect(within(hero).getByRole('img', { name: 'Vezel' }).getAttribute('src')).toBe('https://signed.example.test/p1.jpg?token=abc')
    expect(hero.textContent).toMatch(/Private · Awaiting review/)
  })

  it('with neither, it says exactly what the listing component always said', () => {
    render(<OwnerVehicleHero listingMedia={listing('none', [])} governedMedia={undefined} alt="Vezel" />)
    expect(screen.getByTestId('owner-listing-media-none')).toBeTruthy()
  })

  it('a fault reading the private photographs is never "no photos added yet"', () => {
    render(<OwnerVehicleHero listingMedia={listing('none', [])} governedMedia={{ state: 'not_loaded', items: [], total_count: 0, unavailable_count: 0, empty_statement: null }} alt="Vezel" />)
    expect(screen.getByTestId('owner-listing-media-not-loaded')).toBeTruthy()
    expect(screen.queryByTestId('owner-listing-media-none')).toBeNull()
  })

  it('an absent private block changes nothing for a vehicle whose listing media could not be read', () => {
    render(<OwnerVehicleHero listingMedia={{ state: 'not_loaded', items: [] }} governedMedia={undefined} alt="Vezel" />)
    expect(screen.getByTestId('owner-listing-media-not-loaded')).toBeTruthy()
  })
})
