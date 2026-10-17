/**
 * CA-K3-01 / CA-K3-AUTH-01 → CA-CLOSE-01 — Corporate Admin access: presentation of the SERVER's decision.
 *
 * The admission decision is made by the backend (GET /api/corporate/access, contract v2): a validated session
 * whose account holds an ACTIVE Corporate membership AND a persistent Corporate permission assignment confirmed
 * by the trusted evaluator is admitted (`persistent_corporate_authority`); every other authenticated account is
 * refused (403) whatever its platform role, and a missing or invalid session is 401.
 *
 * A grant carries two separate things, kept separate here:
 *   - `governanceCapabilities` — the PERSISTENT Corporate capabilities the server confirmed (People governance);
 *   - `capabilities` — read-only NAVIGATION capabilities. Persistent authority confers none yet; the server adds the
 *     fixed sixteen only as a separately labelled, bounded compatibility for an admitted legacy platform administrator.
 *
 * This module never decides admission. It:
 *   - parses the server's grant, failing closed on anything malformed, wildcard, mutation-shaped or unknown;
 *   - turns the server decision into a render outcome (there is no local-role path to `render`);
 *   - maps the grant to the destinations navigation may show.
 * It reads no role, tenant, title, feature state or navigation history. If authority cannot be
 * established from the server, nothing of Corporate Admin renders.
 */
import { CORPORATE_DESTINATIONS, type CorporateDestination } from '@/config/corporate/navigation'
import { apiRequest, SessionExpiredError, type ApiFailure } from '@/lib/apiClient'

/** Relative to the API base (which already ends in /api). */
export const CORPORATE_ACCESS_PATH = '/corporate/access'
export const CORPORATE_ACCESS_CONTRACT = 'carup.corporate_access.v2'
/** A decision that has not arrived by then is treated as unavailable — never as granted. */
export const CORPORATE_ACCESS_TIMEOUT_MS = 10_000

export type CorporateGrantSource = 'persistent_corporate_authority' | 'none'

export interface CorporateGrant {
  source: CorporateGrantSource
  /** Read-only navigation capabilities (each `.read`). */
  capabilities: ReadonlySet<string>
  /** Persistent Corporate governance capabilities the server confirmed for this session. */
  governanceCapabilities: ReadonlySet<string>
  /** True when the navigation reads come from the bounded legacy compatibility (an admitted platform administrator). */
  compatibility: boolean
  /** The server's statement of where authority came from, for the account affordance. */
  explanation: string
}

export const EMPTY_GRANT: CorporateGrant = Object.freeze({
  source: 'none',
  capabilities: new Set<string>(),
  governanceCapabilities: new Set<string>(),
  compatibility: false,
  explanation: 'No Corporate Admin authority.',
}) as CorporateGrant

/** The read capabilities the ten destinations understand. A server capability outside it opens nothing. */
export const KNOWN_READ_CAPABILITIES: ReadonlySet<string> = new Set(CORPORATE_DESTINATIONS.flatMap((d) => d.navCapabilities))
/** The persistent governance capabilities Phase C can grant. Anything else in that list rejects the grant. */
export const KNOWN_GOVERNANCE_CAPABILITIES: ReadonlySet<string> = new Set(['corporate.people.membership.manage', 'corporate.people.session.revoke'])

const CAPABILITY_SHAPE = /^[a-z_]+(\.[a-z_]+)+\.read$/
const MUTATION_SHAPED = /\*|manage|\bact\b|approve|publish|export|delete|write|deploy|configure|create|update|revoke|delegate|generate/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const sameSet = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x) => b.includes(x))

/**
 * The server's grant, or null. Null for anything that is not exactly a granted, read-only, persistent-authority
 * decision: navigation capabilities must each be a `.read` capability (one wildcard or mutation-shaped capability
 * rejects the whole grant rather than being quietly dropped), governance capabilities must be known persistent ones,
 * and any navigation read must be carried by the labelled compatibility block.
 */
export function parseCorporateAccessGrant(payload: unknown): CorporateGrant | null {
  if (!isRecord(payload) || payload.contract !== CORPORATE_ACCESS_CONTRACT || payload.decision !== 'granted') return null
  const grant = payload.grant
  if (!isRecord(grant)) return null
  if (grant.source !== 'persistent_corporate_authority' || grant.read_only !== true) return null
  if (typeof grant.explanation !== 'string' || !grant.explanation.trim()) return null

  if (!Array.isArray(grant.governance_capabilities) || grant.governance_capabilities.length === 0) return null
  for (const c of grant.governance_capabilities) if (typeof c !== 'string' || !KNOWN_GOVERNANCE_CAPABILITIES.has(c)) return null

  if (!Array.isArray(grant.capabilities)) return null
  for (const c of grant.capabilities) {
    if (typeof c !== 'string' || !CAPABILITY_SHAPE.test(c) || MUTATION_SHAPED.test(c)) return null
  }
  const compat = grant.compatibility
  if (compat !== null && compat !== undefined) {
    if (!isRecord(compat) || compat.source !== 'legacy_admin_compatibility_bridge' || compat.read_only !== true) return null
    if (!Array.isArray(compat.capabilities) || !sameSet(compat.capabilities, grant.capabilities)) return null
  } else if (grant.capabilities.length > 0) {
    return null // navigation reads may only arrive through the labelled compatibility
  }
  const capabilities = new Set((grant.capabilities as string[]).filter((c) => KNOWN_READ_CAPABILITIES.has(c)))
  if (grant.capabilities.length > 0 && capabilities.size === 0) return null
  return {
    source: 'persistent_corporate_authority',
    capabilities,
    governanceCapabilities: new Set(grant.governance_capabilities as string[]),
    compatibility: isRecord(compat),
    explanation: grant.explanation,
  }
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

/**
 * Navigation visibility: a destination is shown only when the grant holds one of its read capabilities, or one of
 * the persistent governance capabilities that are exercised there (CA-RBAC-01 §19: users see the domains they are
 * entitled to — People & Access is where People governance lives).
 */
export function canSeeDestination(grant: CorporateGrant, destination: Pick<CorporateDestination, 'navCapabilities' | 'governanceCapabilities'>): boolean {
  return destination.navCapabilities.some((c) => grant.capabilities.has(c))
    || (destination.governanceCapabilities ?? []).some((c) => grant.governanceCapabilities.has(c))
}

export function visibleDestinations(grant: CorporateGrant): CorporateDestination[] {
  return CORPORATE_DESTINATIONS.filter((d) => canSeeDestination(grant, d))
}
