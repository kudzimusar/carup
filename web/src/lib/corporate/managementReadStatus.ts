/**
 * CA-OWNER-02-R3 (D1) — what the Corporate shell's header says about the live management figures: the latest read (or its
 * failure) that a page on this visit received, how old the server's snapshot was, which figures on that page could not be
 * read, and — from the latest Overview read — how many items need attention. Kept apart from the components for fast
 * refresh. Nothing here is computed: it only records what the server answered.
 */
import { createContext, useContext } from 'react'
import type { ManagementArea, ManagementFact, ManagementPayload, SnapshotState } from './management'

/** The Overview's "Needs attention" section — its anchor, and the route the header links to. */
export const NEEDS_ATTENTION_ANCHOR = 'needs-attention'
export const NEEDS_ATTENTION_ROUTE = `/corporate#${NEEDS_ATTENTION_ANCHOR}`

export interface ManagementReadRecord {
  area: ManagementArea
  generatedAt: string
  snapshot: SnapshotState | null
  /** Figures on that page's answer, and the ones the server could not read (DEGRADED). */
  figures: number
  notReadable: Array<{ id: string; label: string }>
}

export interface AttentionRecord { count: number; titles: string[]; generatedAt: string }

export interface ManagementReadStatus {
  latest: ManagementReadRecord | null
  /** The latest page read failed (unavailable or refused) — the header must not show an older read as current. */
  failed: boolean
  attention: AttentionRecord | null
  report: (area: ManagementArea, payload: ManagementPayload) => void
  reportFailure: (area: ManagementArea) => void
}

export const ManagementReadStatusContext = createContext<ManagementReadStatus | null>(null)

/** The shell's read status, or null outside the Corporate shell (pages rendered alone report nowhere). */
export function useManagementReadStatus(): ManagementReadStatus | null {
  return useContext(ManagementReadStatusContext)
}

/** Every fact an area's answer carries. */
export function factsOf(payload: ManagementPayload): ManagementFact[] {
  switch (payload.area) {
    case 'overview': {
      const s = payload.sections
      return [...s.governance, ...s.business, ...s.communications, ...s.queues.map((q) => q.fact), ...s.platform, ...s.recent]
    }
    case 'operations': return [...payload.queues.map((q) => q.fact), ...payload.communications]
    case 'trust': return payload.queues.map((q) => q.fact)
    case 'finance': case 'growth': case 'platform': return payload.facts
    case 'report': return payload.report.sections.flatMap((s) => s.facts)
    default: return []
  }
}

export function readRecordOf(area: ManagementArea, payload: ManagementPayload): ManagementReadRecord {
  const facts = factsOf(payload)
  return {
    area,
    generatedAt: payload.generatedAt,
    snapshot: payload.snapshot,
    figures: area === 'data-sources' && payload.area === 'data-sources' ? payload.registry.length : facts.length,
    notReadable: area === 'data-sources' && payload.area === 'data-sources'
      ? payload.registry.filter((r) => r.state === 'DEGRADED').map((r) => ({ id: r.id, label: r.label }))
      : facts.filter((f) => f.state === 'DEGRADED').map((f) => ({ id: f.id, label: f.label })),
  }
}
