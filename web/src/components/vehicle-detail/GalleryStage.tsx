import { useRef, type HTMLAttributes, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

/**
 * RX03-P1A-R2 — the Vehicle Detail photo stage's INTERACTION, and nothing else.
 *
 * Presentational only: it does not know what a photo is, which one is showing, or what any of them
 * means. The page owns the listing-media contract, the index and every sentence; this wrapper turns
 * a horizontal swipe (pointer events, so touch, pen and mouse alike) and ←/→ on the focused stage
 * into a step of −1 / +1. With fewer than two photos it is a plain container: not focusable, no
 * role, no gesture.
 *
 * `touch-action: pan-y` keeps vertical page scrolling native on phones while the horizontal axis is
 * ours. A press that starts on a control inside the stage (Save, Share, the arrow buttons) belongs
 * to that control and never becomes a swipe.
 */
const SWIPE_THRESHOLD_PX = 40

type GalleryStageProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'onKeyDown' | 'onPointerDown' | 'onPointerUp' | 'onPointerCancel' | 'role' | 'tabIndex' | 'aria-label'
> & {
  /** How many photos the stage can step through. Below two the stage is static. */
  count: number
  /** −1 for the previous photo, +1 for the next. */
  onStep: (delta: -1 | 1) => void
  /** Accessible name of the stage while it is navigable. */
  label: string
  children: ReactNode
}

export function GalleryStage({ count, onStep, label, children, className = '', ...rest }: GalleryStageProps) {
  const origin = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const navigable = count > 1

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Only while the stage itself has focus: arrow keys on a focused button inside it keep their
    // ordinary meaning.
    if (!navigable || event.target !== event.currentTarget) return
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onStep(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onStep(1)
    }
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!navigable) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('button, a, input')) return
    origin.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = origin.current
    origin.current = null
    if (!start || start.pointerId !== event.pointerId) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    // A swipe is a deliberate, mostly horizontal travel. Anything else is a tap or a scroll.
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy) * 1.2) return
    onStep(dx < 0 ? 1 : -1)
  }

  return (
    <div
      {...rest}
      className={`${navigable ? 'touch-pan-y touch-pinch-zoom select-none' : ''} ${className}`}
      role={navigable ? 'group' : undefined}
      aria-roledescription={navigable ? 'carousel' : undefined}
      aria-label={navigable ? label : undefined}
      tabIndex={navigable ? 0 : undefined}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { origin.current = null }}
    >
      {children}
    </div>
  )
}
