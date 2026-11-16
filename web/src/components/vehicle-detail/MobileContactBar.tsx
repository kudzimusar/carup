import { useEffect, useRef, type ReactNode } from 'react'

/**
 * RX03-P1A-R2 — the phone contact bar on Vehicle Detail (below 1024 px only).
 *
 * Layout only. The page decides WHETHER it shows (a public listing, never Seller Preview), supplies
 * the already-governed price string, and passes the very same contact action the decision rail uses
 * as children — this component forks no contact logic.
 *
 * Docking follows the bottom-bar claim (`lib/bottomBarClaim`): flush with the screen edge when the
 * shell's own bottom navigation stepped aside for the claim (`honoured`), otherwise directly above
 * that navigation so the two bars never overlap. The home-indicator inset is respected either way.
 */
export function MobileContactBar({
  honoured,
  price,
  priceLabel = 'Asking price',
  children,
}: {
  honoured: boolean
  price: string
  priceLabel?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  // RX03-P2-R4 (a11y): while the bar is on screen, reserve its height as the page's bottom scroll
  // padding, so a control scrolled or tabbed into view stops ABOVE the bar instead of under it.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof window === 'undefined') return
    const root = document.documentElement
    const previous = root.style.scrollPaddingBottom
    const update = () => {
      const r = el.getBoundingClientRect()
      const covered = r.height > 0 ? Math.max(0, window.innerHeight - r.top) : 0
      root.style.scrollPaddingBottom = covered ? `${Math.ceil(covered) + 8}px` : previous
    }
    update()
    window.addEventListener('resize', update)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    ro?.observe(el)
    return () => {
      window.removeEventListener('resize', update)
      ro?.disconnect()
      root.style.scrollPaddingBottom = previous
    }
  }, [honoured])
  return (
    <div
      ref={ref}
      role="region"
      aria-label="Contact about this vehicle"
      data-testid="vehicle-detail-contact-bar"
      data-docked={honoured ? 'bottom' : 'above-nav'}
      className={`fixed inset-x-0 z-40 border-t border-slate-200 bg-white px-4 pt-3 shadow-[0_-12px_32px_-20px_rgba(9,18,42,0.35)] lg:hidden ${
        honoured
          ? 'bottom-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))]'
          : 'bottom-[calc(4.75rem+env(safe-area-inset-bottom))] pb-3'
      }`}
    >
      <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{priceLabel}</p>
          <p className="truncate text-xl font-bold leading-tight tabular-nums tracking-[-0.02em] text-[#09122A]">{price}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
    </div>
  )
}
