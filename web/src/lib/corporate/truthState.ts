/**
 * CA-K3-01 — the Corporate Admin truth-state grammar (CA-UX-01 §9, CA-METRIC-01).
 *
 * Every Corporate metric slot carries exactly one truth state. The state — not the presence of a
 * number — decides what may be shown. Only states that are governed measurements may render a
 * value; every other state renders its own statement and NEVER a number, whatever value a caller
 * passes. In particular:
 *
 *   measured 0  ≠  NO DATA  ≠  UNAVAILABLE  ≠  NOT SEPARABLE  ≠  FORBIDDEN
 *
 * This module is pure: it classifies nothing. It only decides how an already-governed slot reads.
 * It does not compute KPIs, recreate K2B provenance, or derive one state from another.
 */

export type TruthState =
  | 'GOVERNED_ACTUAL'
  | 'GOVERNED_DERIVED'
  | 'GOVERNED_RATE_OR_RATIO'
  | 'ADVISORY'
  | 'TECHNICAL_OPERATIONAL'
  | 'PENDING_K2B_CONSUMPTION'
  | 'PENDING_CA_FIN'
  | 'INSUFFICIENT_DATA'
  | 'UNAVAILABLE_NO_SOURCE'
  | 'UNAVAILABLE_NOT_SEPARABLE'
  | 'DUPLICATED_OR_CONFLICTING'
  | 'UNKNOWN_AUTHORITY'
  | 'DEGRADED'
  | 'FORBIDDEN'
  | 'MEASURED_ZERO'
  | 'NO_DATA'

/** Visual family. Deliberately NOT good/bad: no state implies business performance (CA-UX §4.4). */
export type TruthTone = 'governed' | 'advisory' | 'technical' | 'blocked' | 'neutral' | 'degraded' | 'restricted'

export interface TruthStateSpec {
  state: TruthState
  /** Short badge text, always rendered as text (state is never conveyed by colour alone). */
  badge: string
  /** Statement shown INSTEAD of a value. null only for states that render a governed value. */
  statement: string | null
  /** Whether this state may ever put a number in the value position. */
  rendersValue: 'yes' | 'never' | 'last_known_if_policy_permits'
  tone: TruthTone
  /** Plain-language meaning for metadata / screen readers. */
  meaning: string
}

// Wording is taken from CA-UX-01 §9 where the architecture fixes it.
export const TRUTH_STATES: Readonly<Record<TruthState, TruthStateSpec>> = Object.freeze({
  GOVERNED_ACTUAL: {
    state: 'GOVERNED_ACTUAL', badge: 'Actual', statement: null, rendersValue: 'yes', tone: 'governed',
    meaning: 'Governed actual from an accepted source; source and as-of time in metadata.',
  },
  GOVERNED_DERIVED: {
    state: 'GOVERNED_DERIVED', badge: 'Derived', statement: null, rendersValue: 'yes', tone: 'governed',
    meaning: 'Governed derived value; the calculation version and formula are discoverable.',
  },
  GOVERNED_RATE_OR_RATIO: {
    state: 'GOVERNED_RATE_OR_RATIO', badge: 'Rate', statement: null, rendersValue: 'yes', tone: 'governed',
    meaning: 'Governed rate or ratio; always shown with its denominator.',
  },
  ADVISORY: {
    state: 'ADVISORY', badge: 'Advisory', statement: null, rendersValue: 'yes', tone: 'advisory',
    meaning: 'Advisory only — not a governed figure and never a substitute for one.',
  },
  TECHNICAL_OPERATIONAL: {
    state: 'TECHNICAL_OPERATIONAL', badge: 'Technical', statement: null, rendersValue: 'yes', tone: 'technical',
    meaning: 'Technical / operational measure of the platform — not corporate performance.',
  },
  PENDING_K2B_CONSUMPTION: {
    state: 'PENDING_K2B_CONSUMPTION', badge: 'Pending provenance', rendersValue: 'never', tone: 'blocked',
    statement: 'Operational provenance integration not certified for this source',
    meaning: 'This source path has not been certified to consume the operational-provenance authority, so no Corporate Actual is shown. Unknown records are never counted as operational.',
  },
  PENDING_CA_FIN: {
    state: 'PENDING_CA_FIN', badge: 'Pending finance authority', rendersValue: 'never', tone: 'blocked',
    statement: 'Not available — accounting authority not yet established',
    meaning: 'Corporate finance figures require an accounting system of record that does not exist yet. No zero and no placeholder currency are shown.',
  },
  INSUFFICIENT_DATA: {
    state: 'INSUFFICIENT_DATA', badge: 'Insufficient data', rendersValue: 'never', tone: 'neutral',
    statement: 'Insufficient data',
    meaning: 'Too few observations to state this figure; it is not zero.',
  },
  UNAVAILABLE_NO_SOURCE: {
    state: 'UNAVAILABLE_NO_SOURCE', badge: 'Unavailable', rendersValue: 'never', tone: 'blocked',
    statement: 'Unavailable — no authoritative source',
    meaning: 'No authoritative source exists for this figure. It is unavailable, not zero.',
  },
  UNAVAILABLE_NOT_SEPARABLE: {
    state: 'UNAVAILABLE_NOT_SEPARABLE', badge: 'Not separable', rendersValue: 'never', tone: 'blocked',
    statement: 'Not separable from current source',
    meaning: 'The current source does not keep this grain separately, so the figure cannot be stated.',
  },
  DUPLICATED_OR_CONFLICTING: {
    state: 'DUPLICATED_OR_CONFLICTING', badge: 'Definition conflict', rendersValue: 'never', tone: 'blocked',
    statement: 'Definition conflict — reconciliation required',
    meaning: 'Two definitions disagree; no headline value until the registry reconciles them.',
  },
  UNKNOWN_AUTHORITY: {
    state: 'UNKNOWN_AUTHORITY', badge: 'Authority unknown', rendersValue: 'never', tone: 'blocked',
    statement: 'Authority unknown — blocked',
    meaning: 'No accepted authority owns this figure. It is blocked, never estimated.',
  },
  DEGRADED: {
    state: 'DEGRADED', badge: 'Degraded', rendersValue: 'last_known_if_policy_permits', tone: 'degraded',
    statement: 'Degraded — source incomplete or truncated',
    meaning: 'The source is incomplete or truncated. A last known value is shown only where policy permits, with its computed time.',
  },
  FORBIDDEN: {
    state: 'FORBIDDEN', badge: 'Restricted', rendersValue: 'never', tone: 'restricted',
    statement: 'You do not have access to this data.',
    meaning: 'Access is restricted. This is not the same as unavailable, and no value is disclosed.',
  },
  MEASURED_ZERO: {
    state: 'MEASURED_ZERO', badge: 'Actual', statement: null, rendersValue: 'yes', tone: 'governed',
    meaning: 'A complete, successful read measured zero.',
  },
  NO_DATA: {
    state: 'NO_DATA', badge: 'No data', rendersValue: 'never', tone: 'neutral',
    statement: 'No data for this period',
    meaning: 'The source was read and holds nothing for this period — distinct from zero and from unavailable.',
  },
})

export const ALL_TRUTH_STATES = Object.keys(TRUTH_STATES) as TruthState[]

/** A governed slot. Value-bearing states require a value; statement states carry none. */
export type MetricSlot =
  | { state: 'GOVERNED_ACTUAL' | 'GOVERNED_DERIVED'; value: number; unit?: string }
  | { state: 'GOVERNED_RATE_OR_RATIO'; value: number; unit?: string; kind?: 'rate' | 'ratio'; denominator: number; denominatorLabel: string }
  | { state: 'ADVISORY' | 'TECHNICAL_OPERATIONAL'; value: number | string; unit?: string }
  | { state: 'MEASURED_ZERO'; unit?: string; derived?: boolean }
  | { state: 'DEGRADED'; lastKnownValue?: number; lastComputedAt?: string; lastKnownPermitted?: boolean; unit?: string }
  | { state: 'UNAVAILABLE_NOT_SEPARABLE'; grain?: string }
  | {
      state:
        | 'PENDING_K2B_CONSUMPTION' | 'PENDING_CA_FIN' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE_NO_SOURCE'
        | 'DUPLICATED_OR_CONFLICTING' | 'UNKNOWN_AUTHORITY' | 'FORBIDDEN' | 'NO_DATA'
    }

export interface PresentedSlot {
  state: TruthState
  badge: string
  tone: TruthTone
  /** Text in the value position: a formatted governed value, or the state statement. */
  primary: string
  /** True only when `primary` is a governed number. */
  isValue: boolean
  /** Supplementary line (denominator, computed time, inseparable grain). */
  detail: string | null
  /** Full sentence for assistive technology. */
  accessibleText: string
}

const format = (n: number | string, unit?: string) => {
  const text = typeof n === 'number' ? n.toLocaleString('en-US') : n
  return unit ? `${text} ${unit}` : text
}

/**
 * The ONE presentation rule. Statement states read their statement even when a value is smuggled
 * in at runtime — a FORBIDDEN or PENDING slot can never leak a number.
 */
export function presentSlot(slot: MetricSlot, label = 'This figure'): PresentedSlot {
  const spec = TRUTH_STATES[slot.state]
  const base = { state: slot.state, badge: spec.badge, tone: spec.tone }
  switch (slot.state) {
    case 'GOVERNED_ACTUAL':
    case 'GOVERNED_DERIVED': {
      const primary = format(slot.value, slot.unit)
      return { ...base, primary, isValue: true, detail: null, accessibleText: `${label}: ${primary} (${spec.badge}).` }
    }
    case 'GOVERNED_RATE_OR_RATIO': {
      const badge = slot.kind === 'ratio' ? 'Ratio' : 'Rate'
      const primary = format(slot.value, slot.unit)
      const detail = `of ${format(slot.denominator)} ${slot.denominatorLabel}`
      return { ...base, badge, primary, isValue: true, detail, accessibleText: `${label}: ${primary}, ${detail} (${badge}).` }
    }
    case 'ADVISORY':
    case 'TECHNICAL_OPERATIONAL': {
      const primary = format(slot.value, slot.unit)
      return { ...base, primary, isValue: true, detail: null, accessibleText: `${label}: ${primary} (${spec.badge} — ${spec.meaning})` }
    }
    case 'MEASURED_ZERO': {
      const badge = slot.derived ? 'Derived' : 'Actual'
      const primary = format(0, slot.unit)
      return { ...base, badge, primary, isValue: true, detail: 'Complete read — measured zero', accessibleText: `${label}: 0, measured on a complete read (${badge}).` }
    }
    case 'DEGRADED': {
      const showLast = slot.lastKnownPermitted === true && typeof slot.lastKnownValue === 'number' && Boolean(slot.lastComputedAt)
      if (showLast) {
        const primary = format(slot.lastKnownValue as number, slot.unit)
        const detail = `Last known value, computed ${slot.lastComputedAt}`
        return { ...base, primary, isValue: true, detail, accessibleText: `${label}: degraded source; ${detail}: ${primary}.` }
      }
      return { ...base, primary: spec.statement as string, isValue: false, detail: null, accessibleText: `${label}: ${spec.statement}.` }
    }
    case 'UNAVAILABLE_NOT_SEPARABLE': {
      const detail = slot.grain ?? null
      return { ...base, primary: spec.statement as string, isValue: false, detail, accessibleText: `${label}: ${spec.statement}.${detail ? ` ${detail}` : ''}` }
    }
    default:
      return { ...base, primary: spec.statement as string, isValue: false, detail: null, accessibleText: `${label}: ${spec.statement}.` }
  }
}
