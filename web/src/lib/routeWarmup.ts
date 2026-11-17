/**
 * RX07-WEB-PERF-01-A — warm the public journey without competing with the first paint.
 *
 * Before RX-07 the showroom build requested all three journey chunks (Home, Marketplace, Vehicle
 * Detail) at once on every landing, so a phone opening Home also downloaded ~60 kB gzip of
 * Marketplace and Vehicle Detail code while its hero was still loading. Now:
 *
 *   1. the chunk for the page being opened is requested immediately (no extra round trip later);
 *   2. the other journey steps are requested only after `load` AND once the network has been quiet
 *      for 1.5 s (so they never compete with the page's own photo), and not at all when the
 *      visitor asked to save data (Save-Data / 2g).
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

export const QUIET_MS = 1500
export const MAX_WAIT_MS = 15000

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
  // `load` can fire before a page's main image is even requested (Vehicle Detail renders its photo
  // only after its data arrives), so "after load, on idle" still competed with the LCP image on a
  // phone. Warm only once the network has been quiet for QUIET_MS (no new resource started), or
  // after MAX_WAIT_MS at the latest.
  const started = Date.now()
  // Resource entries appear when a download FINISHES, so the latest start-or-finish time across all of
  // them moves forward whenever anything (e.g. the LCP photo) completes; an in-flight download keeps
  // the network "busy" until it lands and its entry resets the quiet clock.
  const lastNetworkActivity = () => {
    const entries = (typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('resource') : []) as PerformanceResourceTiming[]
    let latest = 0
    for (const e of entries) latest = Math.max(latest, e.startTime, e.responseEnd)
    return entries.length ? performance.timeOrigin + latest : 0
  }
  const waitForQuiet = () => {
    const quietFor = Date.now() - Math.max(lastNetworkActivity(), started)
    if (quietFor >= QUIET_MS || Date.now() - started >= MAX_WAIT_MS) warmRest()
    else setTimeout(waitForQuiet, Math.max(250, QUIET_MS - quietFor))
  }
  if (document.readyState === 'complete') waitForQuiet()
  else window.addEventListener('load', waitForQuiet, { once: true })
}
