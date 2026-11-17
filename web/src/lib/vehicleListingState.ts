/**
 * RX04-C — one reading of a Garage vehicle's listing state, from the two authoritative columns the
 * owner's vehicle row already carries (`status`, `publication_status`). Used by My CarUp Today, the
 * Sell start and My Listings so the same car never says "Sell this vehicle" in one place and
 * "Under review" in another. Nothing here infers a state the server did not record.
 */
import type { Vehicle } from '@/types'

export type ListingStateKey = 'sold' | 'live' | 'ready' | 'review' | 'draft' | 'not_listed'

export interface VehicleListingState {
  key: ListingStateKey
  label: string
  tone: 'success' | 'action' | 'info' | 'neutral'
  action: { label: string; href: string }
}

const REVIEW = new Set(['documents_submitted', 'review_pending'])
const DRAFT = new Set(['draft', 'identity_complete'])

export function vehicleListingState(vehicle: Pick<Vehicle, 'vin' | 'status' | 'publication_status'>): VehicleListingState {
  const vin = encodeURIComponent(vehicle.vin)
  const status = String(vehicle.status || '').toLowerCase()
  const publication = String(vehicle.publication_status || '').toLowerCase()
  if (status === 'sold') return { key: 'sold', label: 'Sold', tone: 'neutral', action: { label: 'View sale history', href: `/dashboard/garage/${vin}` } }
  if (publication === 'published') return { key: 'live', label: 'Live listing', tone: 'success', action: { label: 'Manage listing', href: '/dashboard/listings' } }
  if (publication === 'publishable') return { key: 'ready', label: 'Ready to publish', tone: 'action', action: { label: 'Review & publish', href: `/dashboard/sell-vehicle?vin=${vin}` } }
  if (REVIEW.has(publication)) return { key: 'review', label: 'Under review', tone: 'info', action: { label: 'View listing status', href: '/dashboard/listings' } }
  if (DRAFT.has(publication)) return { key: 'draft', label: 'Draft listing', tone: 'action', action: { label: 'Continue listing', href: `/dashboard/sell-vehicle?vin=${vin}` } }
  return { key: 'not_listed', label: 'Not listed', tone: 'neutral', action: { label: 'Sell this car', href: `/dashboard/sell-vehicle?vin=${vin}` } }
}

export const LISTING_TONE_CLASS: Record<VehicleListingState['tone'], string> = {
  success: 'bg-status-success-soft text-status-success',
  action: 'bg-carup-action-soft text-carup-action-hover',
  info: 'bg-status-info-soft text-status-info',
  neutral: 'bg-carup-bg-surface-2 text-carup-text-2',
}
