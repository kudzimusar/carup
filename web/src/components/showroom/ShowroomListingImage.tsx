import { useState } from 'react'
import { ResponsivePhoto } from '@/components/showroom/ResponsivePhoto'
import { PHOTO_SIZES } from '@/lib/mediaDelivery'
import { VehicleSilhouette } from '@/components/showroom/VehicleSilhouette'

/**
 * Consistent marketplace listing media for BOTH the grid card and the detail gallery.
 *
 * - Renders REAL listing media (public listing_images / primary_image_url) when present.
 * - When there is no real media, renders a NEUTRAL, branded "Image unavailable" placeholder —
 *   never an unrelated stock vehicle (the previous Unsplash fallback was misleading).
 * - If a representative stock image is ever intentionally supplied (`representative`), it is shown
 *   with a clear "Representative image" label so it is never mistaken for the real vehicle.
 * - Never receives private evidence images — marketplace media is sourced only from public listing
 *   media upstream (listing_images / primary_image_url), not the evidence vault.
 * - A src that FAILS TO LOAD falls back to that same placeholder. Issue #164 Phase 8: the component
 *   branched on `if (src)` alone, and a URL string is truthy whether or not it resolves — so the
 *   Golden fixture's dangling `media.carup-staging.test` URLs rendered the browser's broken-image
 *   glyph on every surface while the branded placeholder stayed unreachable. A dead locator must
 *   degrade to "unavailable", which is the honest statement, not to a broken icon.
 * - RX03-P1a / Owner decision O-6: the placeholder is a light "studio plate" — an original line-art
 *   profile of the listing's body style on a studio floor, captioned "Image unavailable". It is
 *   marked as a placeholder in its accessible name and is never presented as the vehicle itself.
 */
export function ShowroomListingImage({
  src,
  alt,
  className = '',
  imgClassName = '',
  representative = false,
  loading = 'lazy',
  bodyStyle = null,
  sizes = PHOTO_SIZES.card,
  plate = 'stacked',
}: {
  src?: string | null
  alt: string
  className?: string
  imgClassName?: string
  representative?: boolean
  loading?: 'lazy' | 'eager'
  /** Body style of the listing, used only to choose the studio-plate silhouette. */
  bodyStyle?: string | null
  /** Layout widths for the responsive renditions (see lib/mediaDelivery PHOTO_SIZES). */
  sizes?: string
  /**
   * 'stacked' = centred silhouette and label (fills the media box). 'compact' = on phones the
   * silhouette and label sit in one row along the bottom of a short box, clear of the status pills
   * and actions on the top edge; from 640 px up it is the stacked plate.
   */
  plate?: 'stacked' | 'compact'
}) {
  // Remember WHICH src failed, not merely THAT one did. A new src is then a fresh attempt by
  // construction — no reset effect, so switching gallery photos after one failure cannot suppress
  // every subsequent image.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = !!src && failedSrc === src

  if (src && !failed) {
    return (
      <div className={`relative ${className}`} data-testid="listing-image">
        <ResponsivePhoto
          src={src}
          alt={alt}
          sizes={sizes}
          priority={loading === 'eager'}
          className={`h-full w-full object-cover ${imgClassName}`}
          onUnavailable={() => setFailedSrc(src)}
        />
        {representative && (
          <span
            className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white"
            data-testid="listing-image-representative"
          >
            Representative image
          </span>
        )}
      </div>
    )
  }

  const compact = plate === 'compact'
  return (
    <div
      className={`relative flex overflow-hidden bg-[linear-gradient(180deg,#F7F6F3_0%,#EEECE7_62%,#E3E0D9_100%)] text-slate-500 ${compact
        ? 'max-sm:flex-row max-sm:items-end max-sm:justify-start max-sm:gap-3 max-sm:px-4 max-sm:pb-3 sm:flex-col sm:items-center sm:justify-center'
        : 'flex-col items-center justify-center'} ${className}`}
      data-testid="listing-image-placeholder"
      data-studio-plate={bodyStyle ? bodyStyle.toLowerCase() : 'generic'}
      data-plate-layout={plate}
      role="img"
      aria-label={`${alt} — image unavailable (studio placeholder, not a photo of this vehicle)`}
    >
      <div className={`absolute inset-x-[8%] bottom-[22%] h-px bg-slate-300/70 ${compact ? 'max-sm:hidden' : ''}`} aria-hidden="true" />
      <VehicleSilhouette
        bodyStyle={bodyStyle}
        tone="muted"
        accent={false}
        className={`opacity-80 ${compact ? 'max-sm:w-[7.5rem] max-sm:shrink-0 sm:w-[62%] sm:max-w-[260px]' : 'w-[62%] max-w-[260px]'}`}
        strokeWidth={1.75}
      />
      <span className={`rounded-full border border-slate-300/80 bg-white/70 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 ${compact ? 'max-sm:mb-1 sm:mt-1' : 'mt-1'}`}>Image unavailable</span>
    </div>
  )
}
