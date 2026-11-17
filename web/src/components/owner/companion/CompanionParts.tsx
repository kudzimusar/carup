/**
 * RX04-C2 — small presentational pieces shared by the ownership-companion pages
 * (Service history, Evidence, Insurance, PartSentry). Unified presentation only.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { OwnerListingMedia } from '@/components/listing/OwnerListingMedia'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { VehicleSilhouette } from '@/components/showroom/VehicleSilhouette'
import { listingMediaState, primaryListingImageUrl } from '@/lib/listingMedia'
import { OWNER_FOCUS } from '@/components/owner/OwnerPageHeader'
import { CHIP_TONE, passportHref, type ChipTone } from './companionFormat'

export function StatusChip({ tone, children, testId }: { tone: ChipTone; children: ReactNode; testId?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${CHIP_TONE[tone]}`} data-testid={testId}>
      {children}
    </span>
  )
}

/**
 * Small listing-photo thumbnail. A thumbnail is too small for OwnerListingMedia's sentences, so the
 * same three states are kept here in an accessible label: a photo, "no listing photo", or "could not
 * be loaded" (which never claims the seller has no photos).
 */
export function VehicleThumb({ media, alt, className = '' }: { media: unknown; alt: string; className?: string }) {
  const src = primaryListingImageUrl(media)
  const state = listingMediaState(media)
  return (
    <div className={`aspect-[16/10] shrink-0 overflow-hidden rounded-control bg-carup-bg-surface ring-1 ring-carup-line ${className}`}>
      {src ? (
        <ListingImage src={src} alt={alt} className="h-full w-full" imgClassName="h-full w-full object-cover" />
      ) : (
        <div
          role="img"
          aria-label={state === 'none' ? `${alt} — no listing photo` : `${alt} — listing photo could not be loaded`}
          title={state === 'none' ? 'No listing photo' : 'Listing photo could not be loaded'}
          className="flex h-full w-full items-center justify-center px-2 text-carup-text-3"
        >
          <VehicleSilhouette className="h-auto w-full max-w-[5.5rem]" tone="muted" accent={false} />
        </div>
      )}
    </div>
  )
}

/** Larger listing photo for a page that leads with the car (Evidence). Same three honest states. */
export function VehiclePhoto({ media, alt, className = '' }: { media: unknown; alt: string; className?: string }) {
  return <OwnerListingMedia media={media} alt={alt} className={className} imgClassName="h-full w-full object-cover" />
}

/** The vehicle heading every companion page groups its records under: photo, name, full VIN. */
export function CompanionVehicleHeading({
  name,
  vin,
  media,
  eyebrow,
  headingId,
  action,
}: {
  name: string
  vin: string | null
  media?: unknown
  eyebrow?: ReactNode
  headingId: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-1 basis-[16rem] items-center gap-3 sm:gap-4">
        {media !== undefined && <VehicleThumb media={media} alt={name} className="w-[4.5rem] sm:w-28" />}
        <div className="min-w-0">
          {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">{eyebrow}</p>}
          <h2 id={headingId} className="text-[17px] font-semibold tracking-[-0.01em] text-carup-text">{name}</h2>
          <p className="break-all font-mono text-[12px] text-carup-text-3">{vin ? `VIN ${vin}` : 'VIN not recorded on this record'}</p>
        </div>
      </div>
      {action}
    </div>
  )
}

/** "Open Passport" — the door from a companion page back to the car's own record. */
export function PassportLink({ vin, label = 'Open Passport', className = '' }: { vin: string; label?: string; className?: string }) {
  return (
    <Link
      to={passportHref(vin)}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-[14px] font-semibold text-carup-action-hover hover:text-carup-text ${OWNER_FOCUS} ${className}`}
    >
      {label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  )
}

/** Quiet explanatory panel used for honest "how this works" copy. */
export function CompanionNote({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`rounded-card bg-carup-bg-surface px-4 py-3.5 text-[14px] leading-6 text-carup-text-2 ${className}`}>{children}</p>
}
