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
