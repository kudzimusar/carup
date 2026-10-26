import { useState } from 'react'
import { ImageOff } from 'lucide-react'

/**
 * One of the owner's PRIVATE photographs of their own vehicle (T11-CAP-LR01-R2 step F).
 *
 * Deliberately NOT `ListingImage`: that component is the public marketplace's renderer and states that it never receives private evidence images.
 * This one is the owner's, takes a short-lived view the server produced for them, and says so when the view no longer works (a view lasts an hour;
 * a page left open longer is stale, which is the honest word — not "this photograph does not exist").
 */
export function GovernedPhoto({
  src,
  alt,
  className = '',
  imgClassName = '',
  loading = 'lazy',
}: {
  src: string | null | undefined
  alt: string
  className?: string
  imgClassName?: string
  loading?: 'lazy' | 'eager'
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = !src || failedSrc === src
  if (!failed) {
    return (
      <div className={`relative overflow-hidden bg-slate-100 ${className}`} data-testid="governed-photo">
        <img src={src as string} alt={alt} loading={loading} onError={() => setFailedSrc(src as string)} className={`h-full w-full object-cover ${imgClassName}`} />
      </div>
    )
  }
  return (
    <div
      className={`flex flex-col items-center justify-center gap-1 bg-slate-100 px-3 text-center text-slate-500 ${className}`}
      data-testid="governed-photo-unavailable"
      role="img"
      aria-label={`${alt} — this photograph could not be shown`}
    >
      <ImageOff className="h-6 w-6" aria-hidden="true" />
      <span className="text-[11px] font-semibold leading-4">Photograph not available right now — reload the page</span>
    </div>
  )
}
