import { cn } from '@/lib/utils'

/**
 * RX-02A S1-3 — EvidenceLine (UI_DESIGN_REFERENCE_AND_TOKENS.md §6.4).
 * actor · source · time on every evidence/trust row.
 * Provenance is rendered only when known: a missing actor/source/time is labelled,
 * never fabricated or implied.
 */
export interface EvidenceLineProps {
  /** Who produced the evidence, e.g. "Roadworthiness centre HW-12". */
  actor: string
  /** What the evidence is, e.g. "Roadworthiness certificate". */
  source: string
  /** When it was produced — ISO date string or a human label. */
  at?: string | null
  /** Optional status chip from the token status registry (e.g. "verified" tone copy). */
  status?: string | null
  className?: string
}

function Value({ value, missing, testId }: { value: string; missing: string; testId: string }) {
  return (
    <span data-testid={testId} className={value ? undefined : 'italic text-carup-text-3'}>
      {value || missing}
    </span>
  )
}

export function EvidenceLine({ actor, source, at = null, status = null, className }: EvidenceLineProps) {
  return (
    <div
      data-testid="evidence-line"
      className={cn(
        'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-l-2 border-carup-line-strong py-1 pl-3 text-[12px] leading-[1.55] text-carup-text-2',
        className
      )}
    >
      <Value value={actor} missing="actor not recorded" testId="evidence-actor" />
      <span aria-hidden="true" className="text-carup-line-strong">
        ·
      </span>
      <Value value={source} missing="source not recorded" testId="evidence-source" />
      <span aria-hidden="true" className="text-carup-line-strong">
        ·
      </span>
      <Value value={at ?? ''} missing="time not recorded" testId="evidence-time" />
      {status && (
        <>
          <span aria-hidden="true" className="text-carup-line-strong">
            ·
          </span>
          <span data-testid="evidence-status" className="font-medium text-carup-text">
            {status}
          </span>
        </>
      )}
    </div>
  )
}
