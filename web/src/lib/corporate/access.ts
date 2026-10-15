/**
 * CA-K3-01 / CA-K3-AUTH-01 — Corporate Admin access: presentation of the SERVER's decision.
 *
 * The admission decision is made by the backend (GET /api/corporate/access, CA-K3-AUTH-01): a validated
 * session whose server-derived platform role is a legacy platform-administrator role receives the
 * read-only `legacy_admin_compatibility_bridge` grant; every other authenticated account is refused
 * (403), and a missing or invalid session is 401. That grant is not a Corporate membership or a
 * permission assignment and it says so wherever it is shown.
 *
 * This module never decides admission. It:
 *   - parses the server's grant, failing closed on anything malformed, wildcard or mutation-shaped;
 *   - turns the server decision into a render outcome (there is no local-role path to `render`);
 *   - maps the grant's capabilities to the destinations navigation may show.
 * It reads no role, tenant, title, feature state or navigation history. If authority cannot be
 * established from the server, nothing of Corporate Admin renders.
 */
import { CORPORATE_DESTINATIONS, type CorporateDestination } from '@/config/corporate/navigation'
import { apiRequest, SessionExpiredError, type ApiFailure } from '@/lib/apiClient'

/** Relative to the API base (which already ends in /api). */
export const CORPORATE_ACCESS_PATH = '/corporate/access'
export const CORPORATE_ACCESS_CONTRACT = 'carup.corporate_access.v1'
/** A decision that has not arrived by then is treated as unavailable — never as granted. */
export const CORPORATE_ACCESS_TIMEOUT_MS = 10_000

export type CorporateGrantSource = 'legacy_admin_compatibility_bridge' | 'none'

export interface CorporateGrant {
  source: CorporateGrantSource
  capabilities: ReadonlySet<string>
  /** The server's statement of where authority came from, for the account affordance. */
  explanation: string
}

export const EMPTY_GRANT: CorporateGrant = Object.freeze({
  source: 'none',
  capabilities: new Set<string>(),
  explanation: 'No Corporate Admin authority.',
}) as CorporateGrant

/** The read capabilities the ten destinations understand. A server capability outside it opens nothing. */
export const KNOWN_READ_CAPABILITIES: ReadonlySet<string> = new Set(CORPORATE_DESTINATIONS.flatMap((d) => d.navCapabilities))

const CAPABILITY_SHAPE = /^[a-z_]+(\.[a-z_]+)+\.read$/
const MUTATION_SHAPED = /\*|manage|\bact\b|approve|publish|export|delete|write|deploy|configure|create|update|revoke|delegate|generate/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The server's grant, or null. Null for anything that is not exactly a granted, read-only,
 * compatibility-bridge decision whose every capability is a `.read` capability — one wildcard or
 * mutation-shaped capability rejects the whole grant rather than being quietly dropped.
 */
export function parseCorporateAccessGrant(payload: unknown): CorporateGrant | null {
  if (!isRecord(payload) || payload.contract !== CORPORATE_ACCESS_CONTRACT || payload.decision !== 'granted') return null
  const grant = payload.grant
  if (!isRecord(grant)) return null
  if (grant.source !== 'legacy_admin_compatibility_bridge' || grant.read_only !== true) return null
  if (typeof grant.explanation !== 'string' || !grant.explanation.trim()) return null
  if (!Array.isArray(grant.capabilities) || grant.capabilities.length === 0) return null
  for (const c of grant.capabilities) {
    if (typeof c !== 'string' || !CAPABILITY_SHAPE.test(c) || MUTATION_SHAPED.test(c)) return null
  }
  const capabilities = new Set((grant.capabilities as string[]).filter((c) => KNOWN_READ_CAPABILITIES.has(c)))
  if (capabilities.size === 0) return null
  return { source: 'legacy_admin_compatibility_bridge', capabilities, explanation: grant.explanation }
}

/** What the server said (or that it could not be heard). */
export type CorporateServerDecision =
  | { status: 'pending' }
  | { status: 'granted'; grant: CorporateGrant }
  | { status: 'denied' }
  | { status: 'unauthenticated' }
  | { status: 'unavailable'; reason: 'network' | 'timeout' | 'malformed' | 'server' }

export interface CorporateAccessRequest {
  baseUrl: string
  sessionToken: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

/**
 * Ask the server. Only the session token is sent: the decision is the session's, and no role, tenant
 * or identity header can inform it. Never throws — every failure is a non-granting decision.
 */
export async function fetchCorporateAccess({ baseUrl, sessionToken, signal, fetchImpl }: CorporateAccessRequest): Promise<CorporateServerDecision> {
  let payload: unknown
  try {
    payload = await apiRequest<unknown>({
      baseUrl,
      path: CORPORATE_ACCESS_PATH,
      options: { method: 'GET', signal, cache: 'no-store' },
      authHeaders: { 'x-session-token': sessionToken },
      ...(fetchImpl ? { fetchImpl } : {}),
    })
  } catch (err) {
    if (signal?.aborted) return { status: 'unavailable', reason: 'timeout' }
    if (err instanceof SessionExpiredError) return { status: 'unauthenticated' }
    const status = (err as Partial<ApiFailure> | null)?.status
    if (status === 401) return { status: 'unauthenticated' }
    if (status === 403) return { status: 'denied' }
    if (err instanceof SyntaxError) return { status: 'unavailable', reason: 'malformed' }
    return { status: 'unavailable', reason: typeof status === 'number' ? 'server' : 'network' }
  }
  const grant = parseCorporateAccessGrant(payload)
  return grant ? { status: 'granted', grant } : { status: 'unavailable', reason: 'malformed' }
}

export interface CorporateAccessInput {
  isBootstrapping: boolean
  isAuthenticated: boolean
  /** The server's decision for the CURRENT session. */
  server: CorporateServerDecision
}

export type CorporateAccessDecision =
  | { kind: 'loading' }
  | { kind: 'redirect'; to: '/login'; reason: 'auth' }
  | { kind: 'denied' }
  | { kind: 'unavailable'; reason: 'network' | 'timeout' | 'malformed' | 'server' }
  | { kind: 'render'; grant: CorporateGrant }

/** The only way to `render` is a parsed server grant for the current session. */
export function resolveCorporateAccess({ isBootstrapping, isAuthenticated, server }: CorporateAccessInput): CorporateAccessDecision {
  if (isBootstrapping) return { kind: 'loading' }
  if (!isAuthenticated || server.status === 'unauthenticated') return { kind: 'redirect', to: '/login', reason: 'auth' }
  switch (server.status) {
    case 'pending':
      return { kind: 'loading' }
    case 'granted':
      return { kind: 'render', grant: server.grant }
    case 'denied':
      return { kind: 'denied' }
    case 'unavailable':
      return { kind: 'unavailable', reason: server.reason }
    default:
      return { kind: 'denied' }
  }
}

/** Navigation visibility: a destination is shown only when the grant holds one of its capabilities. */
export function canSeeDestination(grant: CorporateGrant, destination: Pick<CorporateDestination, 'navCapabilities'>): boolean {
  return destination.navCapabilities.some((c) => grant.capabilities.has(c))
}

export function visibleDestinations(grant: CorporateGrant): CorporateDestination[] {
  return CORPORATE_DESTINATIONS.filter((d) => canSeeDestination(grant, d))
}
