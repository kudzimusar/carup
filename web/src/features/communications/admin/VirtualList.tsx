// Lightweight fixed-height virtual list for the Command Center inbox (plan §16 / P1.6).
// Mounts only the rows within the viewport (+ overscan), so a 10,000-conversation inbox keeps a
// bounded DOM instead of mounting every row. No external dependency. Rows must be a fixed height.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

export interface VirtualListProps<T> {
  items: T[]
  /** Fixed row height in px (rows are clamped to this so windowing math stays exact). */
  itemHeight: number
  /** Viewport height in px. */
  height: number
  overscan?: number
  renderItem: (item: T, index: number) => ReactNode
  getKey: (item: T, index: number) => string
  /** Rendered after the virtualized rows (e.g. a "Load more" button). */
  footer?: ReactNode
  /** Bring this row index into view (e.g. keyboard navigation / selection). */
  scrollToIndex?: number | null
  ariaLabel?: string
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
}

export function VirtualList<T>({
  items, itemHeight, height, overscan = 6, renderItem, getKey, footer, scrollToIndex, ariaLabel, onKeyDown,
}: VirtualListProps<T>) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)

  const total = items.length
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  const visibleCount = Math.ceil(height / itemHeight) + overscan * 2
  const end = Math.min(total, start + visibleCount)
  const slice = items.slice(start, end)

  const onScroll = useCallback(() => {
    if (ref.current) setScrollTop(ref.current.scrollTop)
  }, [])

  // Imperatively scroll a target row into view (keyboard nav / selection restore).
  useEffect(() => {
    if (scrollToIndex == null || !ref.current) return
    const el = ref.current
    const top = scrollToIndex * itemHeight
    const bottom = top + itemHeight
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + height) el.scrollTop = bottom - height
  }, [scrollToIndex, itemHeight, height])

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="group"
      aria-label={ariaLabel}
      data-testid="virtual-list"
      style={{ height, overflowY: 'auto' }}
      className="focus:outline-none"
    >
      {/* Full-height spacer so the scrollbar reflects the whole list. */}
      <div style={{ height: total * itemHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: start * itemHeight, left: 0, right: 0 }}>
          {slice.map((item, i) => (
            <div key={getKey(item, start + i)} style={{ height: itemHeight, overflow: 'hidden' }}>
              {renderItem(item, start + i)}
            </div>
          ))}
        </div>
      </div>
      {footer}
    </div>
  )
}
