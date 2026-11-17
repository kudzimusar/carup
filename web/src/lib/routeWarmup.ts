/**
 * RX07-WEB-PERF-01-A — warm the public journey without competing with the first paint.
 *
 * Before RX-07 the showroom build requested all three journey chunks (Home, Marketplace, Vehicle
 * Detail) at once on every landing, so a phone opening Home also downloaded ~60 kB gzip of
 * Marketplace and Vehicle Detail code while its hero was still loading. Now:
 *
 *   1. the chunk for the page being opened is requested immediately (no extra round trip later);
 *   2. the other journey steps are requested only after `load`, when the browser is idle, and not
 *      at all when the visitor asked to save data (Save-Data / 2g).
 *
 * Warming only downloads code. It renders nothing and never bypasses a route guard.
 */
export type JourneyStep = 'home' | 'marketplace' | 'detail'

const DETAIL = /^\/marketplace\/(?:listing\/)?[^/]+\/?$/
const NOT_DETAIL = new Set(['parts', 'services', 'compare'])

/** Which public journey step a pathname opens, if any. Pure, for tests. */
export function journeyStepFor(pathname: string): JourneyStep | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return 'home'
  if (path === '/marketplace') return 'marketplace'
  if (DETAIL.test(path)) {
    const segment = path.split('/')[2]
    if (segment === 'listing' || !NOT_DETAIL.has(segment)) return 'detail'
  }
  return null
}

interface ConnectionHints { saveData?: boolean; effectiveType?: string }

/** True when the visitor's browser asks us not to spend data on speculative downloads. */
export function prefersDataSaving(connection: ConnectionHints | undefined): boolean {
  if (!connection) return false
  if (connection.saveData) return true
  return connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g'
}

type Preload = () => Promise<unknown>

export function warmJourney(pathname: string, steps: Record<JourneyStep, Preload>): void {
  const current = journeyStepFor(pathname)
  if (!current) return
  void steps[current]()
  if (typeof window === 'undefined') return
  const connection = (navigator as Navigator & { connection?: ConnectionHints }).connection
  if (prefersDataSaving(connection)) return
  const warmRest = () => {
    for (const step of Object.keys(steps) as JourneyStep[]) if (step !== current) void steps[step]()
  }
  const whenIdle = () => {
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    if (typeof ric === 'function') ric(warmRest, { timeout: 5000 })
    else setTimeout(warmRest, 2000)
  }
  if (document.readyState === 'complete') whenIdle()
  else window.addEventListener('load', whenIdle, { once: true })
}
