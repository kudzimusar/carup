/**
 * CA-OWNER-02 — how the operational Admin knows a visit began in Corporate Admin.
 *
 * A navigation marker carried in the URL (`/admin?from=corporate`). It records how the page was reached and nothing
 * else: it is never stored, it grants nothing, and no authority — Corporate or operational — is ever read from it.
 */
const ARRIVAL_PARAM = 'from'
const FROM_CORPORATE = 'corporate'

/** Where Corporate Admin's "Open Operational Admin" goes. */
export const OPERATIONAL_ADMIN_FROM_CORPORATE = `/admin?${ARRIVAL_PARAM}=${FROM_CORPORATE}`

/** True only for exactly `from=corporate` in a location's query string. */
export function arrivedFromCorporate(search: string): boolean {
  return new URLSearchParams(search).get(ARRIVAL_PARAM) === FROM_CORPORATE
}

/**
 * CA-OWNER-02-R3 (D6) — the arrival lasts for the ADMIN VISIT, not for one address. Admin pages rewrite their own query string
 * (the Command Center's filters) and every Admin page change remounts the layout, so the marker is remembered for this tab
 * (sessionStorage) from the moment the visit arrives with it, and forgotten when the operator returns to Corporate Admin or
 * any non-Admin page renders (AdminVisitBoundary). Still navigation context only: it grants nothing and is never authority.
 */
const VISIT_KEY = 'carup.admin.visit.fromCorporate'

export function rememberCorporateArrival(): void {
  try { window.sessionStorage.setItem(VISIT_KEY, '1') } catch { /* storage unavailable: the marker lasts for this address only */ }
}

export function forgetCorporateArrival(): void {
  try { window.sessionStorage.removeItem(VISIT_KEY) } catch { /* storage unavailable */ }
}

export function rememberedCorporateArrival(): boolean {
  try { return window.sessionStorage.getItem(VISIT_KEY) === '1' } catch { return false }
}

/** True for the operational Admin's own pages (/admin… and the /dashboard/admin… alias). */
export function isOperationalAdminPath(pathname: string): boolean {
  return /^\/(?:dashboard\/)?admin(?:\/|$)/.test(pathname)
}

/**
 * A Corporate link into the operational Admin, carrying the arrival marker — the route's own query and fragment are kept.
 * Any route outside `/admin` is returned unchanged.
 */
export function withCorporateArrival(route: string): string {
  const [beforeHash, hash = ''] = route.split('#', 2)
  const [path, query = ''] = beforeHash.split('?', 2)
  if (path !== '/admin' && !path.startsWith('/admin/')) return route
  const params = new URLSearchParams(query)
  params.set(ARRIVAL_PARAM, FROM_CORPORATE)
  return `${path}?${params.toString()}${hash ? `#${hash}` : ''}`
}
