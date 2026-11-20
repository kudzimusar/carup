/**
 * RX05-C — StatusChip: one recorded state, one tone.
 *
 * Tone comes from an explicit status → tone map owned by the caller (`toneFor`). Anything the map
 * does not name falls back to NEUTRAL. Truth rule: unreviewed, pending, declared or self-reported
 * material is never green — `success` is reserved for a recorded decision by the party entitled
 * to make it (e.g. an independent reviewer's approval, or the canonical publish gate's result).
 */
import type { ReactNode } from 'react'
import type { StatusTone } from './statusTone'

export type { StatusTone } from './statusTone'

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'border-status-success bg-status-success-soft text-status-success',
  warning: 'border-status-warning bg-status-warning-soft text-status-warning',
  danger: 'border-status-danger bg-status-danger-soft text-status-danger',
  info: 'border-status-info bg-status-info-soft text-status-info',
  neutral: 'border-carup-line-strong bg-status-neutral-soft text-status-neutral',
}

export function StatusChip({ tone = 'neutral', children, testId, title, className = '' }: {
  tone?: StatusTone
  children: ReactNode
  testId?: string
  title?: string
  className?: string
}) {
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      title={title}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold leading-5 ${TONE_CLASSES[tone]} ${className}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </span>
  )
}
