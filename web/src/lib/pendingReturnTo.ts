import { safeReturnTo } from './returnTo'

const STORAGE_KEY = 'carup:pending-return-to'
const PASSPORT_ROUTE = /^\/diaspora\/(?:imports\/[^/]+|stock\/[^/]+)\/passport\/?$/

export function rememberPendingReturnTo(pathname: string, search = ''): void {
  if (typeof window === 'undefined' || !PASSPORT_ROUTE.test(pathname)) return
  const safe = safeReturnTo(`${pathname}${search}`, '')
  if (safe) window.sessionStorage.setItem(STORAGE_KEY, safe)
}

export function readPendingReturnTo(): string | null {
  if (typeof window === 'undefined') return null
  return safeReturnTo(window.sessionStorage.getItem(STORAGE_KEY), '') || null
}

export function clearPendingReturnTo(): void {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(STORAGE_KEY)
}
