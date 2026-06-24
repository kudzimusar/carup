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
function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name ?? ''
  const message = (error as { message?: string }).message ?? ''
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  )
}

interface LazyRouteBoundaryProps {
  children: ReactNode
  /** Optional override for the retry shell title. */
  title?: string
}

interface LazyRouteBoundaryState {
  hasError: boolean
  resetKey: number
}

export class LazyRouteBoundary extends Component<
  LazyRouteBoundaryProps,
  LazyRouteBoundaryState
> {
  state: LazyRouteBoundaryState = { hasError: false, resetKey: 0 }

  static getDerivedStateFromError(): Partial<LazyRouteBoundaryState> {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
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
    this.setState((s) => ({ hasError: false, resetKey: s.resetKey + 1 }))
  }

  render() {
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
          <Button onClick={this.handleRetry} data-testid="lazy-route-retry">
            Retry
          </Button>
        </div>
      )
    }

    // `key` forces a fresh subtree on retry so the lazy import is re-attempted.
    return <div key={this.state.resetKey} className="contents">{this.props.children}</div>
  }
}

export default LazyRouteBoundary
