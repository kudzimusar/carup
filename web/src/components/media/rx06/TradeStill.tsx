import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { usableTradeStill } from '@/content/media/tradeStills'

/**
 * RX-06 — one original Trade still (see content/media/tradeStills.data.ts for provenance and rights).
 * Always carries its disclosure; lazy by default; responsive 800/1344 sources. Editorial surfaces only —
 * never behind order data, documents, payments or customs. Renders `fallback` (default: nothing) when the
 * still is not usable in this build (an unapproved still in production).
 */
export function TradeStill({ still, className, imgClassName, sizes = '(min-width: 1024px) 50vw, 100vw', priority = false, disclosure = true, fallback = null }: {
  still: string
  className?: string
  imgClassName?: string
  sizes?: string
  priority?: boolean
  disclosure?: boolean
  fallback?: ReactNode
}) {
  const asset = usableTradeStill(still)
  if (!asset) return <>{fallback}</>
  const pending = asset.review !== 'approved'
  return (
    <figure className={cn('relative isolate m-0 overflow-hidden bg-carup-raw-ink', className)} data-testid={`trade-still-${asset.key}`} data-review={asset.review}>
      <img
        src={asset.sources[asset.sources.length - 1].src}
        srcSet={asset.sources.map(source => `${source.src} ${source.width}w`).join(', ')}
        sizes={sizes}
        width={asset.width}
        height={asset.height}
        alt={asset.alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        className={cn('h-full w-full object-cover', imgClassName)}
      />
      {disclosure && (
        <figcaption className="pointer-events-none absolute bottom-2 right-2 max-w-[calc(100%-1rem)] rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-medium leading-4 text-white/90" data-testid="trade-still-disclosure">
          {asset.disclosure}{pending ? ' · awaiting Owner approval' : ''}
        </figcaption>
      )}
    </figure>
  )
}
