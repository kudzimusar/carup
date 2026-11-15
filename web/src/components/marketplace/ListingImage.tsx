import { useState } from 'react'
import { Car, ImageOff } from 'lucide-react'

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
 */
export function ListingImage({
  src,
  alt,
  className = '',
  imgClassName = '',
  representative = false,
  loading = 'lazy',
}: {
  src?: string | null
  alt: string
  className?: string
  imgClassName?: string
  representative?: boolean
  loading?: 'lazy' | 'eager'
}) {
  // Remember WHICH src failed, not merely THAT one did. A new src is then a fresh attempt by
  // construction — no reset effect, so switching gallery photos after one failure cannot suppress
  // every subsequent image.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = !!src && failedSrc === src

  if (src && !failed) {
    return (
      <div className={`relative ${className}`} data-testid="listing-image">
        <img
          src={src}
          alt={alt}
          className={`h-full w-full object-cover ${imgClassName}`}
          loading={loading}
          onError={() => setFailedSrc(src)}
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

  return (
    <div
      className={`flex flex-col items-center justify-center gap-1 bg-gray-100 text-gray-400 ${className}`}
      data-testid="listing-image-placeholder"
      role="img"
      aria-label={`${alt} — image unavailable`}
    >
      <div className="relative">
        <Car className="h-8 w-8" />
        <ImageOff className="absolute -bottom-1 -right-1 h-4 w-4" />
      </div>
      <span className="text-[11px] font-medium">Image unavailable</span>
    </div>
  )
}
