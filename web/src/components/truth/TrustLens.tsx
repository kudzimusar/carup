import { cn } from '@/lib/utils'
import { TRUST_LENS_LABELS, type TrustLensState } from './trustLensStates'

/**
 * RX-02A S1-3 — TrustLens (UI_DESIGN_REFERENCE_AND_TOKENS.md §6.2).
 * States: evaluated · partial · stale · not-evaluated · insufficient-data · unavailable.
 *  - Always carries source count and freshness.
 *  - NEVER invents a score: there is deliberately no score prop. A lens without
 *    sources/freshness says so explicitly rather than implying certainty.
 *  - Labels describe evaluation COVERAGE only — no state claims or implies that
 *    vehicle facts were independently verified (R1-04).
 */
type LensTone = 'info' | 'warning' | 'neutral' | 'danger'

// R1-04: tones carry no positive "verified" signal. 'evaluated' uses the neutral
// informational tone (coverage, not certification) pending Truth-owner confirmation
// of the exact backend semantics of each state.
const TRUST_LENS_TONE: Record<TrustLensState, LensTone> = {
  evaluated: 'info',
  partial: 'info',
  stale: 'warning',
  'not-evaluated': 'neutral',
  'insufficient-data': 'neutral',
  unavailable: 'danger',
}

const TONE_CLASSES: Record<LensTone, string> = {
  info: 'border-status-info bg-status-info-soft text-status-info',
  warning: 'border-status-warning bg-status-warning-soft text-status-warning',
  neutral: 'border-carup-line bg-carup-bg-surface text-carup-text-2',
  danger: 'border-status-danger bg-status-danger-soft text-status-danger',
}

export interface TrustLensProps {
  state: TrustLensState
  /** Number of underlying sources; null/undefined renders "sources not recorded". */
  sourceCount?: number | null
  /** Freshness label, e.g. "Updated 12 Nov 2026" or an ISO date string. */
  freshness?: string | null
  className?: string
}

export function TrustLens({ state, sourceCount = null, freshness = null, className }: TrustLensProps) {
  const meta: string[] = []
  meta.push(
    typeof sourceCount === 'number' && Number.isFinite(sourceCount)
      ? `${sourceCount} source${sourceCount === 1 ? '' : 's'}`
      : 'sources not recorded'
  )
  meta.push(freshness ? `updated ${freshness}` : 'freshness not recorded')

  return (
    <span
      data-testid="trust-lens"
      data-state={state}
      className={cn(
        'inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[2px] border px-2 py-1 text-[11px] font-medium leading-none',
        TONE_CLASSES[TRUST_LENS_TONE[state]],
        className
      )}
    >
      <span className="font-semibold uppercase tracking-[0.06em]">{TRUST_LENS_LABELS[state]}</span>
      <span className="opacity-80">·</span>
      <span>{meta.join(' · ')}</span>
    </span>
  )
}
