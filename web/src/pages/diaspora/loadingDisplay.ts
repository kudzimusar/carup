/**
 * Trade OS T10 — how loading facts are allowed to be worded on screen.
 *
 * A pure module: `react-refresh/only-export-components` means a component file may export nothing
 * else, and these sentences are the part of T10 a customer actually reads, so they are worth testing
 * without rendering anything.
 *
 * The rules encoded here:
 *
 *   · **loaded is not sailed**, said in words wherever a person might assume otherwise;
 *   · a readiness blocker names WHOSE problem it is, so "not ready" is actionable;
 *   · unknown stays unknown — an unmeasured volume is never 0.000, an unrecorded seal never a
 *     plausible-looking number;
 *   · nothing here says departed, in transit, arrived or customs. Those belong to T11 and T12, and
 *     T10 cannot know them.
 */
import type { LoadReadiness, PlanPressure, ReadinessBlocker } from '@/hooks/useTradeLogisticsApi'

/** What the operator's queue calls each state of a candidate consignment. */
export const READINESS_UI: Record<string, { label: string; tone: string }> = {
  READY: { label: 'Ready to load', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  BLOCKED: { label: 'Not ready', tone: 'border-amber-300 bg-amber-50 text-amber-900' },
}

/**
 * Each blocker, and which phase owns it.
 *
 * Naming the owner is the point: an operator looking at "not ready" can see whether to chase the
 * warehouse, the booking, or nobody at all.
 */
export const BLOCKER_UI: Record<string, { label: string; owner: string }> = {
  NOT_APPROVED: { label: 'Booking not approved', owner: 'Container booking' },
  NOT_RECEIVED: { label: 'Not received at a warehouse', owner: 'Warehouse' },
  REFUSED_AT_INTAKE: { label: 'The warehouse did not take it in', owner: 'Warehouse' },
  NOT_MEASURED: { label: 'Not measured', owner: 'Warehouse' },
  CONDITION_NOTED: { label: 'A condition problem was noted', owner: 'Warehouse' },
}

export const EXCLUSION_UI: Record<string, string> = {
  NOT_RECEIVED: 'Not received at the warehouse',
  DOES_NOT_FIT: 'Will not fit in this container',
  DOCUMENTS_OUTSTANDING: 'Paperwork outstanding',
  CONDITION_ISSUE: 'Condition problem',
  PARTICIPANT_REQUEST: 'The customer asked to hold it back',
  OPERATIONAL_EXCEPTION: 'Operational reason',
}

export const LEFT_BEHIND_UI: Record<string, string> = {
  NO_SPACE: 'No room left in the container',
  DID_NOT_FIT: 'Would not physically fit',
  CONDITION_ISSUE: 'Condition problem',
  DOCUMENTS_OUTSTANDING: 'Paperwork outstanding',
  NOT_PRESENTED: 'Not brought to the container in time',
  PARTICIPANT_REQUEST: 'The customer asked to hold it back',
  OPERATIONAL_EXCEPTION: 'Operational reason',
}

/**
 * The participant's own state, in their words.
 *
 * `NOT_RECORDED` is the one that needed care: it means nobody wrote anything down, which is NOT the
 * same as being left behind. Collapsing the two would tell a customer their goods were excluded when
 * in fact nobody has said anything yet.
 */
export const PARTICIPANT_STATE_UI: Record<string, { label: string; tone: string }> = {
  NOT_STARTED: { label: 'Loading not started', tone: 'border-slate-300 bg-slate-50 text-slate-700' },
  NOT_RECORDED: { label: 'Nothing recorded yet', tone: 'border-slate-300 bg-slate-50 text-slate-700' },
  LOADED: { label: 'Loaded', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  LEFT_BEHIND: { label: 'Not loaded', tone: 'border-amber-300 bg-amber-50 text-amber-900' },
}

export const PLAN_STATUS_UI: Record<string, string> = {
  DRAFT: 'Draft',
  CONFIRMED: 'Confirmed',
  SUPERSEDED: 'Superseded',
  CANCELLED: 'Cancelled',
}

export const LOAD_STATUS_UI: Record<string, string> = {
  IN_PROGRESS: 'Loading in progress',
  COMPLETED: 'Loading complete',
  ABANDONED: 'Loading abandoned',
}

/** The sentence that keeps "loaded" from being read as "gone". */
export const LOADED_IS_NOT_SAILED =
  'Loaded means the cargo is inside the container. It does not mean the container has sailed.'

/** A volume, or the honest absence of one. `null` never becomes "0.000 CBM". */
export function cbm(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'Not known'
  return `${Number(value).toFixed(3)} CBM`
}

/** Where a planned figure came from. Planning on an estimate is legitimate; not saying so is not. */
export function describeSource(source: string | null | undefined): string {
  if (source === 'WAREHOUSE_ACTUAL') return 'from the warehouse measurement'
  if (source === 'BOOKED_ESTIMATE') return 'from the booking estimate — not measured'
  return 'no figure'
}

/** "Not ready" plus the reasons, or "ready". Never a bare boolean. */
export function describeReadiness(readiness: LoadReadiness): { label: string; tone: string; reasons: string[] } {
  if (readiness.ready) return { ...READINESS_UI.READY, reasons: [] }
  return {
    ...READINESS_UI.BLOCKED,
    reasons: (readiness.blockers || []).map((b: ReadinessBlocker) => {
      const ui = BLOCKER_UI[b.code]
      return ui ? `${ui.label} · ${ui.owner}` : b.reason
    }),
  }
}

/**
 * Whether the plan fits, said as a fact about volume rather than about money.
 *
 * There is no branch here that produces a charge, a refund or a next sailing. T10 records that the
 * boxes do not fit; what anybody does about that is somebody's decision, not this function's.
 */
export function describePressure(p: PlanPressure | null | undefined): { headline: string; detail: string; tone: 'neutral' | 'attention' } | null {
  if (!p) return null
  if (p.over_capacity) {
    return {
      headline: `${p.over_by_cbm.toFixed(3)} CBM too much`,
      detail: `The plan puts ${p.planned_in_cbm.toFixed(3)} CBM into a ${p.container_total_cbm.toFixed(3)} CBM container. Take something out, with a reason, before confirming.`,
      tone: 'attention',
    }
  }
  return {
    headline: `${p.headroom_cbm.toFixed(3)} CBM of room left`,
    detail: `${p.planned_in_cbm.toFixed(3)} CBM planned into ${p.container_total_cbm.toFixed(3)} CBM.${p.note ? ` ${p.note}` : ''}`,
    tone: 'neutral',
  }
}

export const shortRef = (id: string): string => String(id).replace(/-/g, '').slice(0, 8).toUpperCase()

export const shortDate = (iso: string | null | undefined): string =>
  (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded')
