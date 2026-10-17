/**
 * CA-CLOSE-01 (F1) — the People & Access projection: presentation of the SERVER's read-only record.
 *
 * GET /api/corporate/people-access (contract `carup.corporate_people_access.v1`) returns the ACTIVE Corporate memberships
 * and the ACTIVE persistent permission assignments the caller governs, read from the authoritative Corporate tables and
 * scoped by the trusted evaluator. This module only fetches and parses it — strictly, failing closed — and never infers
 * a membership, a permission or a title. Nothing here can change authority: there is no write, and no role editor.
 */
import { apiRequest, SessionExpiredError, type ApiFailure } from '@/lib/apiClient'

/** Relative to the API base (which already ends in /api). */
export const PEOPLE_ACCESS_PATH = '/corporate/people-access'
export const PEOPLE_ACCESS_CONTRACT = 'carup.corporate_people_access.v1'
export const PEOPLE_ACCESS_TIMEOUT_MS = 10_000

export interface PersonRef { userId: string | null; name: string | null; email: string | null }
export interface OrgNodeRef { nodeId: string; displayName: string | null; entityType: string | null }

export interface MembershipRow {
  membershipId: string
  subject: PersonRef
  orgNode: OrgNodeRef
  state: string
  effectiveFrom: string
  effectiveUntil: string | null
  createdBy: PersonRef | null
  createdReason: string | null
  createdReference: string | null
}

export interface AssignmentRow {
  assignmentId: string
  membershipId: string
  subject: PersonRef
  capability: string
  scope: OrgNodeRef[]
  includeDescendants: boolean
  assuranceFloor: string
  state: string
  effectiveNow: boolean
  effectiveFrom: string
  effectiveUntil: string
  requestedBy: PersonRef | null
  approvedBy: PersonRef | null
  activatedBy: PersonRef | null
  reference: string | null
}

export interface PeopleAccessProjection {
  generatedAt: string
  basisCapability: string
  governedNodes: OrgNodeRef[]
  memberships: MembershipRow[]
  assignments: AssignmentRow[]
}

export type PeopleAccessResult =
  | { status: 'pending' }
  | { status: 'ok'; projection: PeopleAccessProjection }
  | { status: 'denied' }
  | { status: 'unauthenticated' }
  | { status: 'unavailable' }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const isoish = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))

function person(v: unknown): PersonRef | null {
  if (v === null || v === undefined) return null
  if (!isRecord(v)) throw new Error('person')
  return { userId: str(v.user_id), name: str(v.name), email: str(v.email) }
}
function node(v: unknown): OrgNodeRef {
  if (!isRecord(v) || !str(v.node_id)) throw new Error('node')
  return { nodeId: v.node_id as string, displayName: str(v.display_name), entityType: str(v.entity_type) }
}

/** The server's projection, or null for anything that is not exactly a granted, read-only, persistent-authority projection. */
export function parsePeopleAccess(payload: unknown): PeopleAccessProjection | null {
  if (!isRecord(payload) || payload.contract !== PEOPLE_ACCESS_CONTRACT || payload.decision !== 'granted') return null
  if (payload.source !== 'persistent_corporate_authority' || payload.read_only !== true) return null
  if (!isoish(payload.generated_at) || !isRecord(payload.basis) || !Array.isArray(payload.memberships) || !Array.isArray(payload.assignments)) return null
  if (!isRecord(payload.counts) || payload.counts.memberships !== payload.memberships.length || payload.counts.assignments !== payload.assignments.length) return null
  try {
    const memberships: MembershipRow[] = payload.memberships.map((m) => {
      if (!isRecord(m) || !str(m.membership_id) || !isoish(m.effective_from) || (m.effective_until !== null && !isoish(m.effective_until))) throw new Error('membership')
      const subject = person(m.subject)
      if (!subject?.userId) throw new Error('subject')
      return {
        membershipId: m.membership_id as string, subject, orgNode: node(m.org_node), state: String(m.state),
        effectiveFrom: m.effective_from as string, effectiveUntil: (m.effective_until as string | null) ?? null,
        createdBy: person(m.created_by), createdReason: str(m.created_reason), createdReference: str(m.created_reference),
      }
    })
    const assignments: AssignmentRow[] = payload.assignments.map((a) => {
      if (!isRecord(a) || !str(a.assignment_id) || !str(a.capability) || !Array.isArray(a.scope) || !isoish(a.effective_from) || !isoish(a.effective_until)) throw new Error('assignment')
      const subject = person(a.subject)
      if (!subject?.userId) throw new Error('subject')
      return {
        assignmentId: a.assignment_id as string, membershipId: String(a.membership_id), subject, capability: a.capability as string,
        scope: a.scope.map(node), includeDescendants: a.include_descendants === true, assuranceFloor: String(a.assurance_floor), state: String(a.state),
        effectiveNow: a.effective_now === true, effectiveFrom: a.effective_from as string, effectiveUntil: a.effective_until as string,
        requestedBy: person(a.requested_by), approvedBy: person(a.approved_by), activatedBy: person(a.activated_by), reference: str(a.reference),
      }
    })
    const governed = Array.isArray(payload.basis.governed_nodes) ? payload.basis.governed_nodes.map(node) : []
    return { generatedAt: payload.generated_at, basisCapability: String(payload.basis.capability), governedNodes: governed, memberships, assignments }
  } catch {
    return null
  }
}

export interface PeopleAccessRequest {
  baseUrl: string
  sessionToken: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

/** Ask the server. Only the session token is sent. Never throws — every failure is a non-granting result. */
export async function fetchPeopleAccess({ baseUrl, sessionToken, signal, fetchImpl }: PeopleAccessRequest): Promise<PeopleAccessResult> {
  let payload: unknown
  try {
    payload = await apiRequest<unknown>({
      baseUrl,
      path: PEOPLE_ACCESS_PATH,
      options: { method: 'GET', signal, cache: 'no-store' },
      authHeaders: { 'x-session-token': sessionToken },
      ...(fetchImpl ? { fetchImpl } : {}),
    })
  } catch (err) {
    if (err instanceof SessionExpiredError) return { status: 'unauthenticated' }
    const status = (err as Partial<ApiFailure> | null)?.status
    if (status === 401) return { status: 'unauthenticated' }
    if (status === 403) return { status: 'denied' }
    return { status: 'unavailable' }
  }
  const projection = parsePeopleAccess(payload)
  return projection ? { status: 'ok', projection } : { status: 'unavailable' }
}
