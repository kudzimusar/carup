import { useState } from 'react'
import { Lock } from 'lucide-react'
import {
  governedMediaItems, governedMediaState, governedReviewLabel, governedTotal, governedUnavailable,
} from '@/lib/governedMedia'
import { GovernedPhoto } from './GovernedPhoto'

/**
 * The owner's whole private gallery of their own vehicle (T11-CAP-LR01-R2 step F).
 *
 * It says what the block says: the photographs, their order, and each one's own review state; that they are private; and — when the server could
 * not read or view some — that this is a fault, not an absence. It renders NOTHING when no block was sent, because for a viewer who is not entitled
 * the block is absent and the page must be indistinguishable from a vehicle that has none.
 */
export function GovernedGallery({
  media,
  title,
  vehicleLabel,
  heroAspect = 'aspect-[4/3]',
  embedded = false,
}: {
  media: unknown
  title: string
  vehicleLabel: string
  heroAspect?: string
  /** Inside another card: no outer border or padding, and the heading is kept for assistive technology only. */
  embedded?: boolean
}) {
  const state = governedMediaState(media)
  const items = governedMediaItems(media)
  const [selected, setSelected] = useState(0)
  if (state === 'absent') return null

  const total = governedTotal(media) ?? items.length
  const unavailable = governedUnavailable(media)
  const current = items[Math.min(selected, Math.max(items.length - 1, 0))] ?? null

  return (
    <section
      aria-labelledby="governed-gallery-title"
      className={embedded ? 'min-w-0' : 'min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5'}
      data-testid="governed-gallery"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 id="governed-gallery-title" className={embedded ? 'sr-only' : 'text-xs font-semibold uppercase tracking-wide text-slate-500'}>{title}</h2>
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600" data-testid="governed-gallery-private">
          <Lock className="h-3 w-3" aria-hidden="true" />Private to you
        </span>
      </div>

      {state === 'not_loaded' ? (
        <p className="mt-3 min-w-0 break-words text-sm text-amber-900" data-testid="governed-gallery-not-loaded" role="status">
          Your photographs could not be loaded right now. That does not mean there are none.
        </p>
      ) : null}

      {state === 'none' || (state === 'available' && !items.length) ? (
        <p className="mt-3 min-w-0 break-words text-sm text-slate-700" data-testid="governed-gallery-none">
          {state === 'none' ? 'No photographs are on file for this vehicle.' : 'Photographs are on file, but none can be shown right now.'}
        </p>
      ) : null}

      {current ? (
        <>
          <GovernedPhoto
            src={current.view.href}
            alt={`${vehicleLabel} — photograph ${current.gallery_rank} of ${total}`}
            className={`mt-3 w-full rounded-lg ${heroAspect}`}
            loading="eager"
          />
          <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <span data-testid="governed-gallery-position">Photograph {current.gallery_rank} of {total}</span>
            <span data-testid="governed-gallery-review">{governedReviewLabel(current.review_status)}</span>
            <a href={current.view.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-orange-700 underline" data-testid="governed-gallery-open">
              Open full size
            </a>
          </div>
          {current.caption ? <p className="mt-1 min-w-0 break-words text-xs text-slate-600">{current.caption}</p> : null}

          {items.length > 1 ? (
            <ul className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8" data-testid="governed-gallery-thumbs" aria-label={`${title} thumbnails`}>
              {items.map((item, i) => (
                <li key={item.gallery_item_id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setSelected(i)}
                    aria-pressed={i === selected}
                    aria-label={`Show photograph ${item.gallery_rank} of ${total}`}
                    className={`block h-14 w-full overflow-hidden rounded-md border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${i === selected ? 'border-orange-500' : 'border-transparent hover:border-slate-300'}`}
                  >
                    <GovernedPhoto src={item.view.href} alt="" className="h-full w-full" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {unavailable > 0 ? (
        <p className="mt-3 min-w-0 break-words text-xs text-amber-900" data-testid="governed-gallery-unavailable" role="status">
          {unavailable === 1 ? '1 photograph' : `${unavailable} photographs`} could not be shown right now.
        </p>
      ) : null}

      <p className="mt-3 min-w-0 break-words text-xs text-slate-500" data-testid="governed-gallery-note">
        These are your photographs of this vehicle. They are private, they are not part of any listing, and a review state describes the photograph — it does not hide it from you.
      </p>
    </section>
  )
}
