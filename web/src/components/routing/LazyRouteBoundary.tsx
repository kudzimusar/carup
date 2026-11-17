/**
 * LazyRouteBoundary (Navigation Intelligence — Milestone D).
 *
 * A small, reusable class ErrorBoundary that wraps a `React.lazy` route element.
 * Its sole job is to catch *chunk-load failures* (a deferred dynamic import that
 * fails to fetch — e.g. a stale deploy, flaky network, or an aborted request)
 * and render a recoverable, accessible "retry" state instead of crashing the
 * whole SPA. It does NOT touch authorization: the route guard always runs
 * *outside* this boundary (guard → LazyRouteBoundary → Suspense → lazy page),
 * so protected content can never appear before the guard has admitted it.
 *
 * Retry works by bumping a `resetKey` on the boundary's own subtree: this
 * unmounts the failed Suspense child and remounts it, which re-attempts the
 * dynamic import. If the chunk is now reachable, the page loads normally.
 */
import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Heuristic for "this was a failed dynamic import / chunk load" vs. a genuine
 * render error inside the loaded page. We only own the former; we still render
 * the retry shell for any caught error (so the app never white-screens), but
 * the marker keeps the intent auditable and lets the message stay accurate.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name ?? ''
  const message = (error as { message?: string }).message ?? ''
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    // Vite's preload helper: a chunk's split stylesheet failed to download.
    /Unable to preload CSS for/i.test(message)
  )
}

interface LazyRouteBoundaryProps {
  children: ReactNode
  /** Optional override for the retry shell title. */
  title?: string
  /**
   * RX07: when this value changes while the error shell is showing (e.g. the visitor navigated to
   * another path), the boundary clears itself so one page's failure never sticks to the next.
   */
  resetKey?: string
  /** RX07: runs on Retry (and on a path-change reset) before remounting, e.g. to forget a failed import. */
  onRetry?: () => void
  /**
   * RX07-CERT-02 (F1): handle ONLY download failures (failed dynamic import / chunk / chunk CSS).
   * Any other error — a page's own runtime/render failure — is re-thrown so it reaches the boundary
   * that owned it before RX-07 (e.g. SellerRouteErrorBoundary with its draft-recovery guidance, or
   * ShowroomRoute's boundary). Used by the per-page boundary that `lazyRoute` adds; the default
   * (catch everything) is unchanged for the existing callers.
   */
  chunkErrorsOnly?: boolean
}

interface LazyRouteBoundaryState {
  hasError: boolean
  /** The caught error, so render can tell a download failure from a page's own failure. */
  error: unknown
  resetKey: number
  /** RX07: consecutive failed attempts; after a failed retry a full reload is offered too. */
  failures: number
}

export class LazyRouteBoundary extends Component<
  LazyRouteBoundaryProps,
  LazyRouteBoundaryState
> {
  state: LazyRouteBoundaryState = { hasError: false, error: null, resetKey: 0, failures: 0 }

  static getDerivedStateFromError(error: unknown): Partial<LazyRouteBoundaryState> {
    return { hasError: true, error }
  }

  componentDidUpdate(prev: LazyRouteBoundaryProps) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.props.onRetry?.()
      this.setState((s) => ({ hasError: false, error: null, failures: 0, resetKey: s.resetKey + 1 }))
    }
  }

  componentDidCatch(error: unknown) {
    // Not ours to handle: render() re-throws it to the boundary above, so do not count or log it here.
    if (this.props.chunkErrorsOnly && !isChunkLoadError(error)) return
    this.setState((s) => ({ failures: s.failures + 1 }))
    // Surface for diagnostics; chunk failures are expected-but-rare (stale
    // deploys), so log rather than swallow.
    if (isChunkLoadError(error)) {
      console.warn('[LazyRouteBoundary] chunk load failed, offering retry', error)
    } else {
      console.error('[LazyRouteBoundary] lazy section failed to render', error)
    }
  }

  private handleRetry = () => {
    // Clear the error and bump the reset key: this remounts the Suspense child,
    // which re-attempts the deferred dynamic import.
    this.props.onRetry?.()
    this.setState((s) => ({ hasError: false, error: null, resetKey: s.resetKey + 1 }))
  }

  render() {
    if (this.state.hasError && this.props.chunkErrorsOnly && !isChunkLoadError(this.state.error)) {
      // F1: a page's own failure propagates unchanged (never swallowed, never turned into a retry loop).
      throw this.state.error
    }
    if (this.state.hasError) {
      return (
        <div
          className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6 py-16"
          data-testid="lazy-route-error"
          role="alert"
          aria-label="Section failed to load"
        >
          <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-5 text-gray-500">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {this.props.title ?? 'Couldn’t load this section'}
          </h1>
          <p className="max-w-md text-gray-500 mb-6">
            Something interrupted loading this part of the app. This is usually a
            temporary network issue or an updated version — please try again.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button onClick={this.handleRetry} data-testid="lazy-route-retry">
              Retry
            </Button>
            {this.state.failures > 1 && (
              // A chunk that keeps failing is usually a newer deployment replacing this one's files;
              // a reload fetches the current version. Shown only after a retry has already failed.
              <Button variant="outline" onClick={() => window.location.reload()} data-testid="lazy-route-reload">
                Reload page
              </Button>
            )}
          </div>
        </div>
      )
    }

    // `key` forces a fresh subtree on retry so the lazy import is re-attempted.
    return <div key={this.state.resetKey} className="contents">{this.props.children}</div>
  }
}

export default LazyRouteBoundary
