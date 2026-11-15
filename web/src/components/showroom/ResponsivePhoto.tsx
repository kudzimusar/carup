/**
 * RX03-R3 — a published seller photo at the size the layout needs, with an honest fallback chain:
 *   resized rendition (srcset) → the published original → `onUnavailable()` for the caller's
 *   "image unavailable" state. A rendition failure never marks the photo itself as failed.
 *
 * Loading: lazy by default; `priority` is for the one image that is likely the page's largest
 * contentful paint (eager + high fetch priority). The caller sizes the box (aspect-ratio or
 * absolute fill), so the image never shifts layout while it loads.
 */
import { useState, type ImgHTMLAttributes } from 'react'
import { photoSources } from '@/lib/mediaDelivery'

type Stage = 'rendition' | 'original'

export interface ResponsivePhotoProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'onError' | 'loading'> {
  /** The published URL exactly as the API returned it. */
  src: string
  alt: string
  sizes: string
  priority?: boolean
  /** Called once both the rendition and the original have failed to load. */
  onUnavailable?: () => void
}

export function ResponsivePhoto({ src, alt, sizes, priority = false, onUnavailable, ...rest }: ResponsivePhotoProps) {
  const sources = photoSources(src)
  // Remember which published URL the fallback applies to, so a new photo starts from its rendition.
  const [fallback, setFallback] = useState<{ for: string; stage: Stage }>({ for: src, stage: 'rendition' })
  const stage: Stage = fallback.for === src ? fallback.stage : 'rendition'
  const useRendition = stage === 'rendition' && Boolean(sources.srcSet)

  return (
    <img
      {...rest}
      src={useRendition ? sources.src : sources.original}
      srcSet={useRendition ? sources.srcSet : undefined}
      sizes={useRendition ? sizes : undefined}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
      data-photo-delivery={useRendition ? 'rendition' : 'original'}
      onError={() => {
        if (useRendition) setFallback({ for: src, stage: 'original' })
        else onUnavailable?.()
      }}
    />
  )
}
