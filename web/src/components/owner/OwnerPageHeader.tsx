/**
 * RX04-C — the one page heading every My CarUp page uses (unified presentation).
 *
 * Same voice as the approved My CarUp home (RX03-P2-R4): a small section label, one clear title,
 * one sentence of purpose, and at most two actions. Pages own their heading; the workspace shell
 * does not add a second title.
 */
import type { ReactNode } from 'react'

export const OWNER_FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus focus-visible:ring-offset-2'
export const OWNER_PRIMARY_ACTION = `inline-flex min-h-11 items-center gap-2 rounded-full bg-carup-action px-5 text-sm font-semibold text-carup-action-on hover:bg-carup-action-hover ${OWNER_FOCUS}`
export const OWNER_SECONDARY_ACTION = `inline-flex min-h-11 items-center gap-2 rounded-full bg-carup-bg-raised px-4 text-sm font-semibold text-carup-text ring-1 ring-carup-line hover:ring-carup-text-3 ${OWNER_FOCUS}`

export function OwnerPageHeader({
  label = 'My CarUp',
  title,
  description,
  meta,
  actions,
  testId,
}: {
  label?: string
  title: string
  description?: ReactNode
  /** A short factual line under the title, e.g. "3 vehicles". */
  meta?: ReactNode
  actions?: ReactNode
  testId?: string
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4" data-testid={testId}>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3">{label}</p>
        <h1 className="mt-1 text-[clamp(1.5rem,2.4vw,1.9rem)] font-bold tracking-[-0.02em] text-carup-text">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm leading-6 text-carup-text-2">{description}</p>}
        {meta && <p className="mt-2 text-[13px] text-carup-text-3">{meta}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}
