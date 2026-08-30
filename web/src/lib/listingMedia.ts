/**
 * Reading the canonical `listing_media` block on the client.
 *
 * ## Why this file exists
 *
 * The block is produced by ONE backend function (`toListingMediaBlock`, backend/utils/
 * vehicleMediaProjection.js) and consumed by several surfaces. Before this, each surface picked its
 * own way to find "the photo to show", and the owner surfaces did not read the block at all — they
 * read `vehicle.image_url`, a column `vehicles` does not have, so every owner card fell back to the
 * "Image unavailable" placeholder while the public listing published five real photographs of the
 * same vehicle.
 *
 * Selection lives here once so a card, a list and a detail header cannot disagree about which
 * photograph is the primary one.
 *
 * ## The three states are not two
 *
 * `not_loaded` (this read path did not look) is NOT `none` (it looked and the seller published
 * nothing). Callers that need to tell an owner *why* there is no photograph must branch on
 * `mediaState`, because "we could not load your photos" and "you have not added photos" are
 * different sentences and only one of them is ever true.
 */

export type ListingMediaItem = {
  media_id: string
  url: string
  url_form: string
  position: number
  seller_order?: number | null
  is_primary: boolean
  photo_label?: string | null
}

export type ListingMediaBlock = {
  state: 'published' | 'none' | 'not_loaded'
  items: ListingMediaItem[]
  unpublishable_count: number
  empty_statement: string | null
}

/** Narrow an unknown payload to the block shape without trusting it. */
function asBlock(value: unknown): ListingMediaBlock | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ListingMediaBlock>
  if (!Array.isArray(candidate.items)) return null
  return candidate as ListingMediaBlock
}

/**
 * The photograph to show for this vehicle, or `null` when there is none to show.
 *
 * Primacy is the seller's claim, honoured once — mirroring `toListingMediaBlock`, which already
 * sorted the claimed primary first and demoted any second claimant. Falling back to `items[0]`
 * therefore respects the server's ordering rather than re-deriving it, and a block with no items
 * yields `null` instead of an invented placeholder URL.
 */
export function primaryListingImageUrl(value: unknown): string | null {
  const block = asBlock(value)
  if (!block) return null
  const primary = block.items.find((item) => item.is_primary === true)
  const chosen = primary ?? block.items[0]
  const url = chosen?.url
  return typeof url === 'string' && url.trim() !== '' ? url : null
}

/**
 * Which of the three states this block is in, for callers that must say something truthful about an
 * absence. An unrecognised or missing block is reported as `not_loaded` — never as `none`, because
 * claiming the seller published nothing is a statement we have not earned.
 */
export function listingMediaState(value: unknown): ListingMediaBlock['state'] {
  const block = asBlock(value)
  if (!block) return 'not_loaded'
  return block.state === 'published' || block.state === 'none' ? block.state : 'not_loaded'
}

/** How many items the projection counted but could not publish (dead or unaddressable locators). */
export function unpublishableMediaCount(value: unknown): number {
  const block = asBlock(value)
  const n = block?.unpublishable_count
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
}
