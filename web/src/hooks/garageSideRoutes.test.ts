/**
 * The browser must act for the tenant on exactly the routes the backend gates on GARAGE_ROLES.
 *
 * THE DEFECT THIS PINS. The rule began as `path.startsWith('/garage/')`. That covered the queue,
 * the members list and the profile — and missed the entire case lifecycle, because
 * accept/decline/start/complete live under `/service-cases/:id/...`. Round 2f watched the Workshop
 * list five real jobs and Accept come back *"Forbidden. Role 'owner' cannot access this resource."*
 *
 * Guessing the set is what produced the defect, so this checks it against the BACKEND's own route
 * declarations rather than against a list someone typed here. Too narrow locks a garage out; too
 * broad sends a tenant role where the requester's own platform role belongs.
 */
import { describe, it, expect } from 'vitest'
import { isGarageSideRoute } from './useCarUpApi'

/** Every route file that declares GARAGE_ROLES routes. */
const ROUTE_SOURCES = import.meta.glob('/../backend/routes/*.js', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>

/** `router.post('/api/service-cases/:caseId/accept', authorizeSessionRole(GARAGE_ROLES), …` */
function garageRoutesFromBackend(): string[] {
  const found: string[] = []
  for (const raw of Object.values(ROUTE_SOURCES)) {
    const re = /router\.(get|post|put|patch|delete)\(\s*'([^']+)'\s*,\s*authorizeSessionRole\(GARAGE_ROLES\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(String(raw))) !== null) found.push(m[2])
  }
  return found
}

/** The client calls paths WITHOUT the `/api` prefix, and with real ids in place of params. */
function toClientPath(apiPath: string): string {
  return apiPath.replace(/^\/api/, '').replace(/:[A-Za-z]+/g, 'ab12cd34-0000-4000-8000-000000000000')
}

describe('the garage-side route set matches the backend', () => {
  const backendRoutes = garageRoutesFromBackend()

  it('finds the backend declarations at all — sanity', () => {
    expect(backendRoutes.length, 'the parser must find real GARAGE_ROLES routes').toBeGreaterThan(15)
    expect(backendRoutes).toContain('/api/service-cases/:caseId/accept')
    expect(backendRoutes).toContain('/api/garage/queue')
  })

  it('every GARAGE_ROLES route is treated as garage-side', () => {
    const missed = backendRoutes
      .map(toClientPath)
      .filter((p) => !isGarageSideRoute(p))
    expect(missed, `these garage routes would be called with the platform role and 403:\n${missed.join('\n')}`)
      .toEqual([])
  })

  it("the requester's own actions keep the platform role", () => {
    // These are the OWNER's, and sending a tenant role on them would be acting as the wrong party.
    for (const p of [
      '/service-cases',
      '/service-cases/ab12cd34/cancel',
      '/service-cases/mine',
      '/service-history/me',
      '/vehicles/me',
      '/notifications/me',
    ]) {
      expect(isGarageSideRoute(p), `${p} must NOT be treated as garage-side`).toBe(false)
    }
  })

  it('a case READ is not garage-side — both parties may read it', () => {
    expect(isGarageSideRoute('/service-cases/ab12cd34')).toBe(false)
  })

  it('a query string does not change the answer', () => {
    expect(isGarageSideRoute('/garage/queue?status=requested')).toBe(true)
    expect(isGarageSideRoute('/service-cases/mine?x=1')).toBe(false)
  })

  it('a lookalike path does not sneak through', () => {
    for (const p of ['/garages/some-slug', '/garage-directory', '/service-cases/x/accept/extra']) {
      expect(isGarageSideRoute(p), `${p} must not be treated as garage-side`).toBe(false)
    }
  })
})
