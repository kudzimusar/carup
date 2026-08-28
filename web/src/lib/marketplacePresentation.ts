const PUBLISHABLE_PRIMARY_IMAGE_STATES = new Set(['seller_primary', 'first_published'])
const ADVERSE_PLATE_STATES = new Set(['flagged', 'suspended'])

export function canRenderMarketplacePrimaryImage(state: unknown, url: unknown): url is string {
  return typeof url === 'string'
    && url.trim() !== ''
    && typeof state === 'string'
    && PUBLISHABLE_PRIMARY_IMAGE_STATES.has(state)
}

export function primaryImageForListing(listing: {
  primary_image_state?: unknown
  primary_image_url?: unknown
}): string | null {
  return canRenderMarketplacePrimaryImage(listing.primary_image_state, listing.primary_image_url)
    ? listing.primary_image_url.trim()
    : null
}

export function isAdversePlateStatus(status: unknown): boolean {
  return typeof status === 'string' && ADVERSE_PLATE_STATES.has(status.trim().toLowerCase())
}

export function plateStatusLabel(listing: { plate_status?: unknown; plate_verified?: unknown }): string {
  const status = typeof listing.plate_status === 'string' ? listing.plate_status.trim() : ''
  const normalized = status.toLowerCase()
  if (normalized === 'flagged') return 'Plate flagged'
  if (normalized === 'suspended') return 'Plate suspended'
  if (listing.plate_verified === true) return 'Plate confirmed'
  if (status) return `Plate ${status.replace(/[_-]+/g, ' ').toLowerCase()}`
  return 'Plate status unknown'
}
