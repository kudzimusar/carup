import { safeReturnTo } from './returnTo'

const STORAGE_KEY = 'carup:pending-return-to'
const PASSPORT_ROUTE = /^\/diaspora\/(?:imports\/[^/]+|stock\/[^/]+)\/passport\/?$/
const AUTH_ROUTE = /^\/(?:login|register|verify-otp|kyc)\/?$/

export function rememberPendingReturnTo(pathname: string, search = ''): void {
  if (typeof window === 'undefined') return
  if (PASSPORT_ROUTE.test(pathname)) {
    const safe = safeReturnTo(`${pathname}${search}`, '')
    if (safe) window.sessionStorage.setItem(STORAGE_KEY, safe)
    return
  }

  // Preserve the destination while the user is on the authentication flow, but discard stale
  // Passport destinations after normal navigation elsewhere.
  if (!AUTH_ROUTE.test(pathname)) window.sessionStorage.removeItem(STORAGE_KEY)
}

export function readPendingReturnTo(): string | null {
  if (typeof window === 'undefined') return null
  return safeReturnTo(window.sessionStorage.getItem(STORAGE_KEY), '') || null
}

export function clearPendingReturnTo(): void {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(STORAGE_KEY)
}
