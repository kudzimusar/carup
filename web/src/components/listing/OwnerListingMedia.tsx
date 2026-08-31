import { ImageOff, Camera } from 'lucide-react'
import { ListingImage } from '@/components/marketplace/ListingImage'
import { listingMediaState, primaryListingImageUrl } from '@/lib/listingMedia'

/**
 * The owner's view of their own listing photograph.
 *
 * ## Why this exists rather than another `<ListingImage src={...} />`
 *
 * `listingMedia.ts` publishes THREE states and says so in its own header: `not_loaded` ("this read
 * path did not look") is NOT `none` ("it looked and the seller published nothing"), and callers
 * that must tell an owner *why* there is no photograph have to branch on `listingMediaState`.
 *
 * Nothing did. A repo-wide search for `listingMediaState` outside the library and its own unit test
 * returned ZERO hits, while seven owner surfaces passed `primaryListingImageUrl(...)` straight into
 * `ListingImage` and threw the state away. So the discriminator the projection goes to real trouble
 * to compute — `ownerListingMedia` in server.js deliberately maps a FAILED `listing_images` read to
 * `null` so `toListingMediaBlock` can answer `not_loaded` — died one layer from the screen, and a
 * seller whose photos CarUp could not read saw exactly what a seller with no photos sees.
 *
 * That is the acceptance boundary this component restores: a failed media read must never present
 * as "you have not added photos".
 *
 * ## What is deliberately NOT changed
 *
 * `ListingImage` keeps its behaviour and its "Image unavailable" placeholder untouched. That
 * placeholder is correct for the PUBLIC marketplace, where a buyer has no business being told
 * about CarUp's read failures, and it remains correct here for a locator that resolved to a dead
 * URL — the browser tried, and "unavailable" is the honest word. Only the two states that
 * `ListingImage` cannot see, because it only ever receives a URL, are handled here.
 *
 * Evidence media is never a fallback: this component reads `listing_media` and nothing else.
 */
export function OwnerListingMedia({
  media,
  alt,
  className = '',
  imgClassName = '',
  loading = 'lazy',
}: {
  media: unknown
  alt: string
  className?: string
  imgClassName?: string
  loading?: 'lazy' | 'eager'
}) {
  const src = primaryListingImageUrl(media)

  // A real locator: hand it to the shared renderer, which also owns the dead-URL fallback.
  if (src) {
    return (
      <ListingImage
        src={src}
        alt={alt}
        className={className}
        imgClassName={imgClassName}
        loading={loading}
      />
    )
  }

  const state = listingMediaState(media)

  if (state === 'none') {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1 bg-slate-100 px-3 text-center text-slate-500 ${className}`}
        data-testid="owner-listing-media-none"
        role="img"
        aria-label={`${alt} — no photos added yet`}
      >
        <Camera className="h-7 w-7" />
        <span className="text-[11px] font-semibold leading-4">No photos added yet</span>
      </div>
    )
  }

  // not_loaded — CarUp did not manage to read this seller's media. Saying "no photos" here would
  // be a claim about the seller made out of a fault on our side.
  return (
    <div
      className={`flex flex-col items-center justify-center gap-1 bg-slate-100 px-3 text-center text-slate-500 ${className}`}
      data-testid="owner-listing-media-not-loaded"
      role="img"
      aria-label={`${alt} — photos could not be loaded`}
    >
      <ImageOff className="h-7 w-7" />
      <span className="text-[11px] font-semibold leading-4">
        Photos could not be loaded — this does not mean you have none
      </span>
    </div>
  )
}
