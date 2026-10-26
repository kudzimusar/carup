/**
 * Reading the governed-media block on the client (T11-CAP-LR01-R2 step F).
 *
 * The block is produced by ONE backend function (`toGovernedMediaBlock`, backend/utils/governedVehicleMedia.js) and is the owner's PRIVATE
 * photographs of their own vehicle: not listing media, not verified evidence. It is delivered only to someone entitled to the vehicle, and is
 * ABSENT — not empty — for everyone else, so "no block" means "nothing was sent to this viewer", never "this vehicle has no photographs".
 *
 *   state 'available'  ≥1 photograph with a working short-lived view
 *   state 'none'       the vehicle's photographs were looked for and there are none
 *   state 'not_loaded' they could not be read right now — NOT the same as none
 *   (absent)           this viewer was not sent a block
 *
 * Items carry a view (`href`, `expires_at`) and nothing about where the bytes live. Primacy is a stated choice (`designated_primary`); the
 * hero is the designated photograph, else the first by gallery rank — a presentation order, not an election of "the best photograph".
 */

export type GovernedMediaItem = {
  gallery_item_id: string
  gallery_rank: number
  designated_primary: boolean
  designation_basis: string | null
  caption: string | null
  review_status: string
  view: { href: string; expires_at: string | null }
}

export type GovernedMediaBlock = {
  state: 'available' | 'none' | 'not_loaded'
  items: GovernedMediaItem[]
  total_count: number
  unavailable_count: number
  empty_statement: string | null
}

export type GovernedMediaState = GovernedMediaBlock['state'] | 'absent'

const STATES = new Set(['available', 'none', 'not_loaded'])

/** Narrow an unknown payload to the block without trusting it. Anything that is not the block is "absent". */
function asBlock(value: unknown): GovernedMediaBlock | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<GovernedMediaBlock>
  if (typeof candidate.state !== 'string' || !STATES.has(candidate.state) || !Array.isArray(candidate.items)) return null
  return candidate as GovernedMediaBlock
}

/** An item can be drawn only with an https view; anything else (a relative path, a data: URL, a script) is never put in an <img>. */
const drawable = (item: unknown): item is GovernedMediaItem => {
  const i = item as GovernedMediaItem | null
  return Boolean(i) && typeof i!.view?.href === 'string' && /^https:\/\//i.test(i!.view.href) && typeof i!.gallery_rank === 'number'
}

export function governedMediaState(value: unknown): GovernedMediaState {
  return asBlock(value)?.state ?? 'absent'
}

/** The drawable photographs, in gallery order. */
export function governedMediaItems(value: unknown): GovernedMediaItem[] {
  return (asBlock(value)?.items ?? []).filter(drawable).slice().sort((a, b) => a.gallery_rank - b.gallery_rank)
}

/** The designated photograph, else the first by rank, or null. */
export function governedHeroItem(value: unknown): GovernedMediaItem | null {
  const items = governedMediaItems(value)
  return items.find((item) => item.designated_primary === true) ?? items[0] ?? null
}

export function governedHeroUrl(value: unknown): string | null {
  return governedHeroItem(value)?.view.href ?? null
}

/** How many presentable photographs exist (the items may be a window onto them), or null when no block was sent. */
export function governedTotal(value: unknown): number | null {
  const block = asBlock(value)
  if (!block) return null
  return typeof block.total_count === 'number' && Number.isFinite(block.total_count) ? block.total_count : block.items.length
}

/** Photographs presentable but whose view could not be produced right now. */
export function governedUnavailable(value: unknown): number {
  const n = asBlock(value)?.unavailable_count
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
}

/** A review state in the owner's words. Nothing here can make a photograph "verified"; it says what the asset's own state is. */
export function governedReviewLabel(status: string | null | undefined): string {
  switch (String(status || '').toLowerCase()) {
    case 'verified': return 'Verified by CarUp'
    case 'disputed': return 'Under dispute'
    case 'pending': return 'Awaiting review'
    default: return 'Review state not recorded'
  }
}
