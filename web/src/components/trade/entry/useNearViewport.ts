/**
 * LR02 (RX-07 phone LCP) — true once an element comes within `rootMargin` of the viewport, and then for
 * good. The Trade entry mounts its below-the-fold editorial stills only then, so on a slow phone they no
 * longer start downloading with the hero (native `loading="lazy"` begins far earlier on slow
 * connections). Until then the caller renders the still's reserved box, so nothing shifts.
 *
 * Where IntersectionObserver is unavailable the element counts as near at once (the stills render as
 * before).
 */
import { useEffect, useState, type RefObject } from 'react'

export const NEAR_VIEWPORT_MARGIN = '300px 0px'

export function useNearViewport(ref: RefObject<Element | null>, rootMargin: string = NEAR_VIEWPORT_MARGIN): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (near) return
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setNear(true)
        observer.disconnect()
      }
    }, { rootMargin })
    observer.observe(node)
    return () => observer.disconnect()
  }, [near, ref, rootMargin])
  return near
}
