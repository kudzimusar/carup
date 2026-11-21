/**
 * RX-06 Trade — the trade graph desk's model and read-outs (no components here).
 *
 * The graph is DERIVED by CarUp's projection from recorded events; this file never authors a node,
 * an edge or a figure. It only arranges the counts the summary returned into a relationship view.
 *
 * Edge meaning (which entity type an edge runs from and to) mirrors the projection's CREATE_EDGE rules
 * in backend/constants/diaspora/diasporaTradeGraphConstants.js. It is a description of CarUp's graph
 * rules, not data: an edge type this map does not know is still listed, marked "meaning not mapped".
 */
import type { TradeGraphDeadLetter, TradeGraphSummary, TradeGraphTypeCount } from '@/types'
import type { ReadFailure } from './deskFormat'

/* ───────────────────────── the page → view contract ───────────────────────── */

export type TradeGraphLensId = 'demand' | 'containers' | 'risk'

export interface TradeGraphModel {
  flagEnabled: boolean
  aiEnabled: boolean
  isAuthenticated: boolean
  authLoading: boolean
  role: string
  isOperator: boolean
  summary: TradeGraphSummary | null
  loading: boolean
  failure: ReadFailure | null
  onRefresh: () => void
  deadLetters: TradeGraphDeadLetter[]
  deadLettersUnreadable: boolean
  rebuilding: boolean
  rebuildNotice: string | null
  onRebuild: () => void
  /** The existing intelligence reads. Called only when the person asks for a lens. */
  lenses: Record<TradeGraphLensId, () => Promise<unknown>>
}

/* ───────────────────────── relationship view ───────────────────────── */

type Pair = readonly [from: string, to: string]

/** edge type → the (from, to) entity types the projection writes it between. */
export const EDGE_RULES: Readonly<Record<string, ReadonlyArray<Pair>>> = {
  ACCEPTED_QUOTE: [['BUYER_ORDER', 'ACCEPTED_QUOTE']],
  AI_COMMAND_FOR: [['AI_COMMAND', 'BUYER_ORDER']],
  BELONGS_TO_TENANT: [
    ['BUYER_ORDER', 'TENANT'], ['CONTAINER', 'TENANT'], ['SAFETRADE_TRANSACTION', 'TENANT'], ['SELLER_STOCK_ITEM', 'TENANT'],
    ['SUPPLY_DOCUMENT', 'TENANT'], ['TRADE_PROFILE', 'TENANT'], ['WORKBOOK_BATCH', 'TENANT'],
  ],
  CONDUCTS_TRANSACTION: [['SAFETRADE_TRANSACTION', 'BUYER_ORDER']],
  CREATED_BY: [['USER', 'TRADE_PROFILE']],
  DOCUMENTS: [['DOCUMENT', 'BUYER_ORDER']],
  FULFILLS_ORDER: [['SHIPMENT', 'BUYER_ORDER']],
  HAS_MILESTONE: [['SAFETRADE_TRANSACTION', 'SAFETRADE_MILESTONE']],
  HAS_TRADE_PROFILE: [['USER', 'TRADE_PROFILE']],
  INITIATED_ORDER: [['BUYER', 'BUYER_ORDER']],
  PAYS_MILESTONE: [['PAYMENT_MILESTONE', 'BUYER_ORDER']],
  QUOTED_ON: [['SELLER', 'RFQ']],
  RAISED_DISPUTE: [['SAFETRADE_DISPUTE', 'SAFETRADE_TRANSACTION']],
  REFERENCES_PROFILE: [['REPUTATION_RECORD', 'TRADE_PROFILE']],
  RESERVES_CONTAINER: [['CARGO_RESERVATION', 'CONTAINER']],
  REVIEWS_COMPLIANCE: [['COMPLIANCE_REVIEW', 'BUYER_ORDER']],
  SUPPLIES: [['SELLER_STOCK_ITEM', 'BUYER_ORDER']],
  SYNCED_TO_DRIVE: [['DRIVE_FILE', 'DOCUMENT']],
  VERIFIES_DOCUMENT: [['USER', 'DOCUMENT']],
}

export const OWNERSHIP_EDGE = 'BELONGS_TO_TENANT'
/** Every trade in the graph is an order; the relationship view is drawn around it. */
export const HUB_TYPE = 'BUYER_ORDER'

export interface RelationshipLane {
  edgeType: string
  count: number
  from: string
  to: string
  fromCount: number | null
  toCount: number | null
}

export interface RelationshipView {
  hub: { type: string; count: number | null } | null
  into: RelationshipLane[]
  outOf: RelationshipLane[]
  other: RelationshipLane[]
  /** Count of BELONGS_TO_TENANT edges as returned, or null when none were returned. */
  ownership: number | null
  tenantNodes: number | null
  unmapped: TradeGraphTypeCount[]
  /** Entity types the read counted that no returned relationship touches. */
  unlinked: TradeGraphTypeCount[]
}

function positive(rows: TradeGraphTypeCount[] | null | undefined): TradeGraphTypeCount[] {
  return (rows ?? []).filter((r) => r && typeof r.type === 'string' && Number(r.count) > 0)
    .map((r) => ({ type: r.type, count: Number(r.count) }))
}

/** Arrange the returned counts. Only types with a returned count above zero appear. */
export function relationshipView(counts: TradeGraphSummary['counts'] | null | undefined): RelationshipView {
  const nodes = positive(counts?.nodes)
  const edges = positive(counts?.edges)
  const nodeCount = new Map(nodes.map((n) => [n.type, n.count]))
  const countOf = (type: string) => nodeCount.get(type) ?? null

  const into: RelationshipLane[] = []
  const outOf: RelationshipLane[] = []
  const other: RelationshipLane[] = []
  const unmapped: TradeGraphTypeCount[] = []
  let ownership: number | null = null
  const touched = new Set<string>()

  for (const edge of edges) {
    if (edge.type === OWNERSHIP_EDGE) { ownership = edge.count; continue }
    const pairs = EDGE_RULES[edge.type]
    if (!pairs || pairs.length === 0) { unmapped.push(edge); continue }
    // Every mapped edge except ownership has exactly one (from, to) pair; a several-pair edge would
    // be named by all of its sources rather than split into counts the server never returned.
    const from = pairs.map((p) => p[0]).filter((v, i, all) => all.indexOf(v) === i).join(' / ')
    const to = pairs[0][1]
    pairs.forEach(([f, t]) => { touched.add(f); touched.add(t) })
    const lane: RelationshipLane = { edgeType: edge.type, count: edge.count, from, to, fromCount: pairs.length === 1 ? countOf(from) : null, toCount: countOf(to) }
    if (to === HUB_TYPE) into.push(lane)
    else if (from === HUB_TYPE) outOf.push(lane)
    else other.push(lane)
  }

  const hubPresent = nodeCount.has(HUB_TYPE) || into.length > 0 || outOf.length > 0
  // Orders counted but untouched by any returned relationship still form the hub, drawn alone.
  const unlinked = nodes.filter((n) => n.type !== 'TENANT' && n.type !== HUB_TYPE && !touched.has(n.type))
  return {
    hub: hubPresent ? { type: HUB_TYPE, count: countOf(HUB_TYPE) } : null,
    into, outOf, other, ownership, tenantNodes: countOf('TENANT'), unmapped, unlinked,
  }
}

/* ───────────────────────── insight lenses ───────────────────────── */

export interface LensFreshness { computedAt: string | null; durationMs: number | null }

export interface DemandSignal {
  country: string | null
  productType: string | null
  unmatchedCount: number | null
  avgConfidence: number | null
  latestOrderAt: string | null
  evidenceCount: number | null
  sourceReferenceCount: number | null
}
export interface ContainerOpportunity {
  containerId: string | null
  coordinatorId: string | null
  origin: string | null
  destination: string | null
  containerType: string | null
  availableCapacity: number | null
  status: string | null
  matchedOrderCount: number | null
  matchedOrderIds: string[]
  confidence: number | null
}
export interface RiskBlocker { type: string | null; severity: string | null; detail: string | null; sourceEntityType: string | null; sourceEntityId: string | null }
export interface RiskRow { orderId: string | null; status: string | null; riskLevel: string | null; blockers: RiskBlocker[]; confidence: number | null }

export type LensResult =
  | { lens: 'demand'; rows: DemandSignal[]; count: number | null; freshness: LensFreshness }
  | { lens: 'containers'; rows: ContainerOpportunity[]; count: number | null; freshness: LensFreshness }
  | { lens: 'risk'; rows: RiskRow[]; count: number | null; freshness: LensFreshness }

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const len = (v: unknown): number | null => (Array.isArray(v) ? v.length : null)

function freshnessOf(root: Record<string, unknown>): LensFreshness {
  const f = obj(root.freshness)
  return { computedAt: str(f?.computedAt), durationMs: num(f?.durationMs) }
}

/**
 * Narrow a lens response to what this view renders. A response whose list is missing is reported as
 * an unrecognised shape (null) instead of being guessed at.
 */
export function parseLens(lens: TradeGraphLensId, data: unknown): LensResult | null {
  const root = obj(data)
  if (!root) return null
  const freshness = freshnessOf(root)
  const count = num(root.count)
  if (lens === 'demand') {
    if (!Array.isArray(root.signals)) return null
    return {
      lens, count, freshness,
      rows: root.signals.map((r) => {
        const o = obj(r) ?? {}
        const ev = obj(o.evidence)
        return {
          country: str(o.country), productType: str(o.productType), unmatchedCount: num(o.unmatchedCount),
          avgConfidence: num(o.avgConfidence), latestOrderAt: str(o.latestOrderAt),
          evidenceCount: len(ev?.graphNodeIds), sourceReferenceCount: len(ev?.sourceReferences),
        }
      }),
    }
  }
  if (lens === 'containers') {
    if (!Array.isArray(root.opportunities)) return null
    return {
      lens, count, freshness,
      rows: root.opportunities.map((r) => {
        const o = obj(r) ?? {}
        return {
          containerId: str(o.containerId), coordinatorId: str(o.coordinatorId), origin: str(o.origin), destination: str(o.destination),
          containerType: str(o.containerType), availableCapacity: num(o.availableCapacity), status: str(o.status),
          matchedOrderCount: num(o.matchedOrderCount),
          matchedOrderIds: Array.isArray(o.matchedOrderIds) ? o.matchedOrderIds.map(str).filter((v): v is string => Boolean(v)) : [],
          confidence: num(o.confidence),
        }
      }),
    }
  }
  if (!Array.isArray(root.risks)) return null
  return {
    lens, count, freshness,
    rows: root.risks.map((r) => {
      const o = obj(r) ?? {}
      return {
        orderId: str(o.orderId), status: str(o.status), riskLevel: str(o.riskLevel), confidence: num(o.confidence),
        blockers: Array.isArray(o.blockers) ? o.blockers.map((b) => {
          const x = obj(b) ?? {}
          return { type: str(x.type), severity: str(x.severity), detail: str(x.detail), sourceEntityType: str(x.sourceEntityType), sourceEntityId: str(x.sourceEntityId) }
        }) : [],
      }
    }),
  }
}

/** A confidence the server returned (0–1) as a whole percent; anything else is not shown. */
export function confidencePct(value: number | null): string | null {
  if (value === null || value < 0 || value > 1) return null
  return `${Math.round(value * 100)}%`
}

const REDACTED = '[REDACTED]'
const REGION = /^\[REGION\](?::([A-Z]))?$/

/** Redaction tokens from CarUp's redaction policy, said in words; any other value passes through. */
export function tokenText(value: string | null): { text: string; redacted: boolean } | null {
  if (value === null) return null
  if (value === REDACTED) return { text: 'Withheld by CarUp’s redaction policy', redacted: true }
  const region = value.match(REGION)
  if (region) return { text: region[1] ? `Region withheld by CarUp’s redaction policy (anonymous group ${region[1]})` : 'Region withheld by CarUp’s redaction policy', redacted: true }
  if (value.startsWith('PARTICIPANT:')) return { text: `${value} (pseudonymised participant)`, redacted: true }
  return { text: value, redacted: false }
}

/** What each lens computes, from diasporaTradeIntelligenceService (said plainly, never embellished). */
export const LENS_COPY: Record<TradeGraphLensId, { label: string; what: string; empty: string }> = {
  demand: {
    label: 'Demand signals',
    what: 'Buyer orders that are requested, quoted or draft and have no accepted quote yet, grouped by origin country and product type.',
    empty: 'No unmatched buyer orders in your organisation’s graph right now.',
  },
  containers: {
    label: 'Container opportunities',
    what: 'Containers that are open or booked for loading, next to the orders that need shipment on the same route and fit their available capacity.',
    empty: 'No open or booked containers in your organisation’s graph right now.',
  },
  risk: {
    label: 'Risk exposure',
    what: 'Every buyer order with the blockers recorded next to it — compliance, documents, payment milestones, SafeTrade cases and disputes, reputation — ranked by severity.',
    empty: 'No buyer orders in your organisation’s graph to assess.',
  },
}
