/**
 * RX07-WEB-PERF-01-A — route-level code splitting that can actually recover.
 *
 * `React.lazy` caches its import promise forever: once a chunk request fails, every later render of
 * that lazy component re-throws the same error, so a "Retry" that merely remounts can never succeed.
 * `lazyRoute` keeps one shared import per page (so a preload and the real render never request the
 * chunk twice) and, after a failure, swaps in a fresh `lazy()` on the next render so the boundary's
 * Retry re-attempts the download.
 *
 * Each lazy route carries its own chunk boundary and Suspense (see `RouteChunk`), so route elements in
 * App.tsx stay exactly as they were: `<Route path=… element={<Page />} />`.
 *
 * Authority is unchanged: these components are only ever rendered as a route `element`, i.e. inside
 * the layout's guard (`RegistryRouteBoundary`, `DashboardLayout`, `DealerReviewerLayout`, …) which
 * has already admitted the visitor. The chunk boundary never decides access; a refused visitor is
 * redirected before the page's chunk is even requested.
 */
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { LazyRouteBoundary } from './LazyRouteBoundary'

// Pages have heterogeneous props (some none, some `kind`/`claimMode`); the route element supplies them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Importer = () => Promise<{ default: ComponentType<any> }>

/**
 * Browsers cache a FAILED module fetch in their module map: re-importing the same URL fails again
 * without touching the network (verified in Chromium for abort, HTTP 503 and offline). Retrying in
 * place therefore re-imports the failed chunk under a one-off query string. Only a same-origin URL
 * under /assets/ (build) or /src/ (dev), taken from the browser's own error message, is accepted.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function retryUrlFrom(error: unknown, attempt: number, origin = typeof location === 'undefined' ? '' : location.origin): string | null {
  const message = error && typeof error === 'object' ? String((error as { message?: unknown }).message ?? '') : ''
  const match = message.match(/https?:\/\/[^\s'"]+?\.(?:js|mjs|tsx?|jsx)(?:\?[^\s'"]*)?/)
  if (!match || !origin) return null
  try {
    const url = new URL(match[0])
    if (url.origin !== origin || !/^\/(assets|src)\//.test(url.pathname)) return null
    url.searchParams.set('carup-retry', String(attempt))
    return url.href
  } catch {
    return null
  }
}

type UrlImporter = (url: string) => Promise<{ default: ComponentType<object> }>
const importByUrl: UrlImporter = (url) => import(/* @vite-ignore */ url)

export interface LazyRouteComponent<P = object> {
  (props: P): ReactNode
  /** Start (or join) the chunk download without rendering. Never rejects. */
  preload: () => Promise<void>
  displayName?: string
}

// A factory that returns components, not a component itself.
// eslint-disable-next-line react-refresh/only-export-components, @typescript-eslint/no-explicit-any
export function lazyRoute<P extends object = any>(importer: Importer, name?: string, options: { importUrl?: UrlImporter } = {}): LazyRouteComponent<P> {
  type Module = { default: ComponentType<P> }
  let pending: Promise<Module> | null = null
  let failed = false
  let lastError: unknown = null
  let attempts = 0
  let loaded: ComponentType<P> | null = null
  const load = (): Promise<Module> => {
    if (!pending) {
      const retryUrl = attempts > 0 ? retryUrlFrom(lastError, attempts) : null
      const source = retryUrl ? (options.importUrl ?? importByUrl)(retryUrl) : importer()
      pending = (source as Promise<Module>).then(
        (module) => { loaded = module.default; return module },
        (error: unknown) => { failed = true; lastError = error; throw error },
      )
    }
    return pending
  }
  let Lazy = lazy(load)
  // Called from the boundary's Retry click (an event, never during render): only after a failure,
  // forget the rejected download and wrap a fresh lazy() — React.lazy caches a rejection forever.
  // Until then every re-render reuses the same rejected promise, so a failure never multiplies requests.
  const reset = () => {
    if (!failed) return
    failed = false
    attempts += 1
    pending = null
    Lazy = lazy(load)
  }
  const Attempt = (props: P) => {
    const Ready = loaded ?? (Lazy as unknown as ComponentType<P>)
    return <Ready {...props} />
  }
  const Route = ((props: P) => (
    <RouteChunk onRetry={reset}>
      <Attempt {...props} />
    </RouteChunk>
  )) as LazyRouteComponent<P>
  // A speculative preload never poisons the real navigation: if it fails, the failure is forgotten
  // at once (in the promise callback, not during render) so opening the page downloads afresh.
  Route.preload = () => {
    reset()
    return load().then(() => undefined, () => reset())
  }
  Route.displayName = name ? `LazyRoute(${name})` : 'LazyRoute'
  return Route
}

/** Same visual weight as the showroom loader: full height, so the footer never jumps up (CLS). */
export function RouteChunkLoading() {
  return (
    <div className="flex min-h-[100svh] items-start justify-center pt-[30vh]" role="status" aria-live="polite" aria-busy="true" data-testid="route-chunk-loading">
      <span className="text-sm text-muted-foreground">Loading…</span>
    </div>
  )
}

/**
 * The single wrapper every lazy route element uses: chunk-failure boundary → Suspense → page.
 * The boundary resets when the path changes, so a failure on one page never sticks to the next.
 */
export function RouteChunk({ children, fallback, onRetry }: { children: ReactNode; fallback?: ReactNode; onRetry?: () => void }) {
  const { pathname } = useLocation()
  return (
    <LazyRouteBoundary resetKey={pathname} onRetry={onRetry}>
      <Suspense fallback={fallback ?? <RouteChunkLoading />}>{children}</Suspense>
    </LazyRouteBoundary>
  )
}
