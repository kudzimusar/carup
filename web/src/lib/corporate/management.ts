/**
 * CA-OWNER-02 — the Corporate management read models (GET /api/corporate/management/:area, contract
 * `carup.corporate_management.v1`): fetch with the session token only, parse STRICTLY, fail closed.
 *
 * Every figure is a server-decided management fact — a value with its source, as-of time, scope, window and truth state, or a
 * statement of why there is none. The browser never derives, sums or upgrades a figure: a statement state that arrives with a
 * value, or a live state that arrives without one, makes the whole answer unavailable.
 */
import { apiRequest, SessionExpiredError, type ApiFailure } from '@/lib/apiClient'
import type { MetricSlot, TruthState } from './truthState'

export const MANAGEMENT_CONTRACT = 'carup.corporate_management.v1'
export const MANAGEMENT_TIMEOUT_MS = 20_000

export type ManagementArea = 'overview' | 'operations' | 'trust' | 'finance' | 'growth' | 'platform' | 'data-sources' | 'report'

export type FactKind = 'operational' | 'technical' | 'governance'

export interface Provenance {
  authority: string
  raw: number
  operational: number
  excludedNonOperational: number
  unknownRequiresReview: number
  byClass: Record<string, number>
}

export interface BreakdownEntry { key: string; label: string; value: number; currency: string | null }

export type FactWindow = { kind: 'current' } | { kind: 'rolling'; days: number; from: string; to: string }

export interface ManagementFact {
  id: string
  label: string
  kind: FactKind | null
  state: TruthState
  value: number | string | null
  unit: string | null
  source: { authority: string; path: string | null } | null
  asOf: string | null
  window: FactWindow | null
  scope: string | null
  provenance: Provenance | null
  extent: { oldestAt: string | null; newestAt: string | null } | null
  breakdown: BreakdownEntry[] | null
  certification: string
  reason: string | null
  detail: string | null
}

export interface AttentionItem {
  id: string
  category: 'platform' | 'data_source' | 'communications' | 'queue' | 'provenance_review' | 'delivery'
  title: string
  count: number | null
  ageSince: string | null
  ruleSource: string
  reason: string | null
  source: string | null
  asOf: string | null
  scope: string | null
  truthState: string | null
  operate: { route: string; label: string } | null
}

export interface QueueView {
  id: string
  plane: 'operations' | 'trust'
  label: string
  owner: string
  operate: { route: string; label: string } | null
  fact: ManagementFact
  attention: { state: 'work_waiting' | 'clear' | 'unknown'; rule: string }
}

export interface RegistryRow {
  id: string
  label: string
  kind: FactKind | null
  area: string
  source: string | null
  state: TruthState
  asOf: string | null
  scope: string | null
  provenance: string
  certification: string
  usable: boolean
  reason: string | null
  registryRef: string | null
}

export interface ManagementSummary {
  definition: { id: string; version: number; title: string; family: string; timezone: string; period: string; scope: string; contentModel: string }
  state: 'current_live_view'
  statement: string
  generatedAt: string
  sections: Array<{ id: string; title: string; facts: ManagementFact[] }>
  digest: string
}

interface Envelope { generatedAt: string; environment: string | null }

export type ManagementPayload =
  | (Envelope & {
      area: 'overview'
      attention: AttentionItem[]
      sections: {
        governance: ManagementFact[]; business: ManagementFact[]; communications: ManagementFact[]; queues: QueueView[]
        platform: ManagementFact[]; recent: ManagementFact[]; data: { usable: number; degraded: number; unavailable: number }
      }
      unavailable: Array<{ id: string; label: string; reason: string }>
    })
  | (Envelope & { area: 'operations'; queues: QueueView[]; communications: ManagementFact[] })
  | (Envelope & { area: 'trust'; queues: QueueView[] })
  | (Envelope & { area: 'finance'; facts: ManagementFact[]; accountingStatement: string })
  | (Envelope & { area: 'growth'; facts: ManagementFact[] })
  | (Envelope & { area: 'platform'; facts: ManagementFact[]; providers: Array<{ channel: string; provider: string; status: string; available: boolean }> | null })
  | (Envelope & { area: 'data-sources'; registry: RegistryRow[] })
  | (Envelope & { area: 'report'; report: ManagementSummary })

export type ManagementResult<P = ManagementPayload> =
  | { status: 'pending' }
  | { status: 'ok'; payload: P }
  | { status: 'denied' }
  | { status: 'unauthenticated' }
  | { status: 'unavailable' }

// ── strict parsing ─────────────────────────────────────────────────────────────────────────────────────────────────────

const LIVE = new Set(['GOVERNED_ACTUAL', 'TECHNICAL_OPERATIONAL'])
const STATES = new Set([
  'GOVERNED_ACTUAL', 'TECHNICAL_OPERATIONAL', 'DEGRADED', 'UNAVAILABLE_NO_SOURCE', 'UNAVAILABLE_NOT_SEPARABLE', 'PENDING_CA_FIN',
  'PENDING_K2B_CONSUMPTION', 'UNKNOWN_AUTHORITY', 'INSUFFICIENT_DATA', 'FORBIDDEN', 'NO_DATA',
])

class Invalid extends Error {}
const fail = (what: string): never => { throw new Invalid(what) }
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const isoOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) return fail('time')
  return v
}
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fail('count'))
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : fail('list'))

function parseFact(v: unknown): ManagementFact {
  if (!isRecord(v) || !str(v.id) || !str(v.label) || typeof v.state !== 'string' || !STATES.has(v.state)) return fail('fact')
  const state = v.state as TruthState
  const value = v.value
  if (LIVE.has(state)) {
    const ok = (typeof value === 'number' && Number.isFinite(value) && value >= 0) || (v.kind === 'technical' && typeof value === 'string' && value.trim() !== '')
    if (!ok) fail('live value')
    if (!isRecord(v.source) || !str(v.source.authority) || !str(v.as_of) || !str(v.scope)) fail('live metadata')
  } else if (value !== null && value !== undefined) {
    fail('statement value')
  }
  const kind = v.kind === 'operational' || v.kind === 'technical' || v.kind === 'governance' ? v.kind : null
  const p = v.provenance
  const provenance: Provenance | null = isRecord(p)
    ? {
        authority: String(p.authority ?? ''), raw: count(p.raw), operational: count(p.operational),
        excludedNonOperational: count(p.excluded_non_operational), unknownRequiresReview: count(p.unknown_requires_review),
        byClass: isRecord(p.by_class) ? Object.fromEntries(Object.entries(p.by_class).map(([k, n]) => [k, count(n)])) : {},
      }
    : null
  const w = v.window
  const window: FactWindow | null = !isRecord(w) ? null
    : w.kind === 'rolling' ? { kind: 'rolling', days: count(w.days), from: isoOrNull(w.from) ?? fail('window'), to: isoOrNull(w.to) ?? fail('window') }
      : { kind: 'current' }
  const e = v.extent
  const extent = isRecord(e) ? { oldestAt: isoOrNull(e.oldest_at), newestAt: isoOrNull(e.newest_at) } : null
  const breakdown = Array.isArray(v.breakdown)
    ? v.breakdown.map((b) => (isRecord(b) && str(b.key) && str(b.label) ? { key: b.key as string, label: b.label as string, value: count(b.value), currency: str(b.currency) } : fail('breakdown')))
    : null
  return {
    id: v.id as string,
    label: v.label as string,
    kind,
    state,
    value: LIVE.has(state) ? (value as number | string) : null,
    unit: str(v.unit),
    source: isRecord(v.source) && str(v.source.authority) ? { authority: v.source.authority as string, path: str(v.source.path) } : null,
    asOf: isoOrNull(v.as_of),
    window,
    scope: str(v.scope),
    provenance,
    extent,
    breakdown,
    certification: String(v.certification ?? ''),
    reason: str(v.reason),
    detail: str(v.detail),
  }
}

const operateOf = (v: unknown) => (isRecord(v) && str(v.route) && str(v.label) && String(v.route).startsWith('/') ? { route: v.route as string, label: v.label as string } : null)

function parseQueue(v: unknown): QueueView {
  if (!isRecord(v) || !str(v.id) || !str(v.label) || (v.plane !== 'operations' && v.plane !== 'trust') || !isRecord(v.attention)) return fail('queue')
  const state = v.attention.state
  if (state !== 'work_waiting' && state !== 'clear' && state !== 'unknown') fail('queue attention')
  return {
    id: v.id as string, plane: v.plane, label: v.label as string, owner: String(v.owner ?? ''), operate: operateOf(v.operate),
    fact: parseFact(v.fact), attention: { state: state as QueueView['attention']['state'], rule: String(v.attention.rule ?? '') },
  }
}

const CATEGORIES = new Set(['platform', 'data_source', 'communications', 'queue', 'provenance_review', 'delivery'])
function parseAttention(v: unknown): AttentionItem {
  if (!isRecord(v) || !str(v.id) || !str(v.title) || typeof v.category !== 'string' || !CATEGORIES.has(v.category) || !str(v.rule_source)) return fail('attention')
  return {
    id: v.id as string, category: v.category as AttentionItem['category'], title: v.title as string,
    count: v.count === null || v.count === undefined ? null : count(v.count), ageSince: isoOrNull(v.age_since), ruleSource: v.rule_source as string,
    reason: str(v.reason), source: str(v.source), asOf: isoOrNull(v.as_of), scope: str(v.scope), truthState: str(v.truth_state), operate: operateOf(v.operate),
  }
}

function parseRegistryRow(v: unknown): RegistryRow {
  if (!isRecord(v) || !str(v.id) || !str(v.label) || typeof v.state !== 'string' || !STATES.has(v.state) || typeof v.usable !== 'boolean') return fail('registry')
  const kind = v.kind === 'operational' || v.kind === 'technical' || v.kind === 'governance' ? v.kind : null
  return {
    id: v.id as string, label: v.label as string, kind, area: String(v.area ?? ''), source: str(v.source), state: v.state as TruthState, asOf: isoOrNull(v.as_of),
    scope: str(v.scope), provenance: String(v.provenance ?? ''), certification: String(v.certification ?? ''), usable: v.usable, reason: str(v.reason), registryRef: str(v.registry_ref),
  }
}

function parseSummary(v: unknown): ManagementSummary {
  if (!isRecord(v) || v.state !== 'current_live_view' || !isRecord(v.definition) || !str(v.statement) || !str(v.digest)) return fail('summary')
  const d = v.definition
  return {
    definition: {
      id: String(d.id), version: count(d.version), title: String(d.title), family: String(d.family), timezone: String(d.timezone),
      period: String(d.period), scope: String(d.scope), contentModel: String(d.content_model ?? ''),
    },
    state: 'current_live_view',
    statement: v.statement as string,
    generatedAt: isoOrNull(v.generated_at) ?? fail('summary time'),
    sections: list(v.sections).map((s) => (isRecord(s) && str(s.id) && str(s.title) ? { id: s.id as string, title: s.title as string, facts: list(s.facts).map(parseFact) } : fail('section'))),
    digest: v.digest as string,
  }
}

/** The server's answer for `area`, or null for anything that is not exactly a granted, read-only answer for that area. */
export function parseManagementArea(area: ManagementArea, payload: unknown): ManagementPayload | null {
  if (!isRecord(payload) || payload.contract !== MANAGEMENT_CONTRACT || payload.decision !== 'granted' || payload.read_only !== true || payload.area !== area) return null
  try {
    const env: Envelope = { generatedAt: isoOrNull(payload.generated_at) ?? fail('generated_at'), environment: str(payload.environment) }
    switch (area) {
      case 'overview': {
        const s = isRecord(payload.sections) ? payload.sections : fail('sections')
        const data = isRecord(s.data) ? s.data : fail('data')
        return {
          ...env,
          area,
          attention: list(payload.attention).map(parseAttention),
          sections: {
            governance: list(s.governance).map(parseFact), business: list(s.business).map(parseFact), communications: list(s.communications).map(parseFact),
            queues: list(s.queues).map(parseQueue), platform: list(s.platform).map(parseFact), recent: list(s.recent).map(parseFact),
            data: { usable: count(data.usable), degraded: count(data.degraded), unavailable: count(data.unavailable) },
          },
          unavailable: list(payload.unavailable).map((u) => (isRecord(u) && str(u.id) && str(u.label) && str(u.reason) ? { id: u.id as string, label: u.label as string, reason: u.reason as string } : fail('unavailable'))),
        }
      }
      case 'operations':
        return { ...env, area, queues: list(payload.queues).map(parseQueue), communications: list(payload.communications).map(parseFact) }
      case 'trust':
        return { ...env, area, queues: list(payload.queues).map(parseQueue) }
      case 'finance':
        return { ...env, area, facts: list(payload.facts).map(parseFact), accountingStatement: str(payload.accounting_statement) ?? fail('statement') }
      case 'growth':
        return { ...env, area, facts: list(payload.facts).map(parseFact) }
      case 'platform':
        return {
          ...env, area, facts: list(payload.facts).map(parseFact),
          providers: payload.providers === null ? null : list(payload.providers).map((p) => (isRecord(p) && str(p.channel) ? { channel: p.channel as string, provider: String(p.provider ?? ''), status: String(p.status ?? ''), available: p.available === true } : fail('provider'))),
        }
      case 'data-sources':
        return { ...env, area, registry: list(payload.registry).map(parseRegistryRow) }
      case 'report':
        return { ...env, area, report: parseSummary(payload.report) }
      default:
        return null
    }
  } catch (err) {
    if (err instanceof Invalid) return null
    throw err
  }
}

/** A management fact as a truth-state slot. The browser never upgrades a state or invents a value. */
export function factToSlot(fact: Pick<ManagementFact, 'state' | 'value' | 'unit' | 'kind' | 'reason'>): MetricSlot {
  switch (fact.state) {
    case 'GOVERNED_ACTUAL':
      return typeof fact.value === 'number' ? { state: 'GOVERNED_ACTUAL', value: fact.value, ...(fact.unit ? { unit: fact.unit } : {}) } : { state: 'UNKNOWN_AUTHORITY' }
    case 'TECHNICAL_OPERATIONAL':
      return fact.value === null
        ? { state: 'UNKNOWN_AUTHORITY' }
        : { state: 'TECHNICAL_OPERATIONAL', value: fact.value, badge: fact.kind === 'technical' ? 'Technical' : 'Live read', ...(fact.unit ? { unit: fact.unit } : {}) }
    case 'DEGRADED':
      return { state: 'DEGRADED' }
    case 'UNAVAILABLE_NOT_SEPARABLE':
      return { state: 'UNAVAILABLE_NOT_SEPARABLE', ...(fact.reason ? { grain: fact.reason } : {}) }
    default:
      return { state: fact.state } as MetricSlot
  }
}

export interface ManagementRequest {
  baseUrl: string
  sessionToken: string
  area: ManagementArea
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

/** Ask the server. Only the session token is sent. Never throws — every failure is a non-granting result. */
export async function fetchManagementArea({ baseUrl, sessionToken, area, signal, fetchImpl }: ManagementRequest): Promise<ManagementResult> {
  let payload: unknown
  try {
    payload = await apiRequest<unknown>({
      baseUrl,
      path: `/corporate/management/${area}`,
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
  const parsed = parseManagementArea(area, payload)
  return parsed ? { status: 'ok', payload: parsed } : { status: 'unavailable' }
}
