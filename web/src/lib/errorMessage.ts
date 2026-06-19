/**
 * Coerce any thrown value into a safe, user-facing STRING — never "[object Object]".
 *
 * Defense-in-depth for toasts/UI: even if a caller throws a plain object or the API layer ever
 * surfaces a non-Error, this returns readable text. The API layer (apiClient.extractApiErrorMessage)
 * is the primary fix; this guards the render path.
 */
export function getErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (typeof err === 'string') return err || fallback
  if (err instanceof Error) {
    return err.message && err.message !== '[object Object]' ? err.message : fallback
  }
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    if (typeof e.message === 'string' && e.message && e.message !== '[object Object]') return e.message
    if (e.error && typeof e.error === 'object') {
      const inner = e.error as Record<string, unknown>
      if (typeof inner.message === 'string' && inner.message) return inner.message
    }
    if (typeof e.error === 'string' && e.error) return e.error
  }
  return fallback
}
