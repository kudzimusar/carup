import { Lock } from 'lucide-react'
import { GovernedPhoto } from '@/components/media/GovernedPhoto'
import { OwnerListingMedia } from '@/components/listing/OwnerListingMedia'
import { governedHeroItem, governedMediaState, governedReviewLabel } from '@/lib/governedMedia'
import { listingMediaState, primaryListingImageUrl } from '@/lib/listingMedia'

/**
 * The picture that stands for one of the owner's vehicles on their own surfaces (T11-CAP-LR01-R2 step F).
 *
 * Three classes of picture exist and stay apart: a seller's PUBLISHED listing photograph, verified EVIDENCE, and the owner's PRIVATE photographs of
 * their own vehicle (governed media). `OwnerListingMedia` reads listing media and nothing else, by design. This component composes the two for the
 * owner: the published photograph if there is one (unchanged), otherwise the owner's private hero — marked private, with its own review state —
 * otherwise exactly what `OwnerListingMedia` already says (including "could not be loaded", which a fault on our side must never turn into "no photos").
 */
export function OwnerVehicleHero({
  listingMedia,
  governedMedia,
  alt,
  className = '',
  imgClassName = '',
  loading = 'lazy',
}: {
  listingMedia: unknown
  governedMedia: unknown
  alt: string
  className?: string
  imgClassName?: string
  loading?: 'lazy' | 'eager'
}) {
  if (primaryListingImageUrl(listingMedia)) {
    return <OwnerListingMedia media={listingMedia} alt={alt} className={className} imgClassName={imgClassName} loading={loading} />
  }
  const hero = governedHeroItem(governedMedia)
  if (hero) {
    return (
      <div className={`relative ${className}`} data-testid="owner-vehicle-hero-governed">
        <GovernedPhoto src={hero.view.href} alt={alt} className="h-full w-full" imgClassName={imgClassName} loading={loading} />
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-slate-950/75 px-2 py-0.5 text-[10px] font-semibold text-white">
          <Lock className="h-3 w-3" aria-hidden="true" />Private · {governedReviewLabel(hero.review_status)}
        </span>
      </div>
    )
  }
  // A fault reading the owner's private photographs is not "you have not added photos".
  const fault = governedMediaState(governedMedia) === 'not_loaded' && listingMediaState(listingMedia) !== 'not_loaded'
  return <OwnerListingMedia media={fault ? { state: 'not_loaded', items: [] } : listingMedia} alt={alt} className={className} imgClassName={imgClassName} loading={loading} />
}
