import { useCallback, useSyncExternalStore } from 'react'

function mediaQueryList(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(query)
}

/**
 * Whether a CSS media query matches right now, kept in step with the viewport.
 *
 * Use it only where BEHAVIOUR must follow the layout (CARUP-MVP-STAB-01 F-017: the owner inbox may
 * open — and so mark read — a conversation by itself only while the list and the conversation are
 * both on screen). Pass the same query the Tailwind classes use, so the CSS and the behaviour change
 * at the same width. With no matchMedia (server render, jsdom) it reports no match: the caller's
 * narrow-screen behaviour, which must therefore be the safe one.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const list = mediaQueryList(query)
    if (!list || typeof list.addEventListener !== 'function') return () => {}
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return useSyncExternalStore(
    subscribe,
    () => mediaQueryList(query)?.matches ?? false,
    () => false,
  )
}
