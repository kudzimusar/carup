import type { Location } from 'react-router-dom'
import { isSafeReturnTo } from '@/lib/returnTo'

/**
 * Bounded internal return target (R2-5): only same-origin root-relative paths
 * are honored; anything else (external URL, scheme-relative, control chars)
 * falls back to '/'. Extracted from UnifiedRouteShell so the component module
 * stays fast-refresh-clean (components-only exports).
 */
export function safeReturnTarget(location: Location): string {
  const candidate =
    location.state && typeof location.state === 'object' && 'from' in location.state
      ? (location.state as { from?: unknown }).from
      : null
  return typeof candidate === 'string' && isSafeReturnTo(candidate) ? candidate : '/'
}
