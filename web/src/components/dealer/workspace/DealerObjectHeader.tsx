/**
 * RX05-C — DealerObjectHeader: the compact top of every Dealer OS workspace view.
 *
 *   eyebrow (where you are) · title (what this is) · one-line description · recorded status chips
 *   · at most ONE primary action (plus an optional quiet secondary).
 *
 * It renders the page's single <h1>. It never invents facts: `meta` is whatever recorded state the
 * caller passes (usually StatusChips built from API fields).
 */
import type { ReactNode } from 'react'
import { WS_EYEBROW } from './workspaceStyles'

export function DealerObjectHeader({ eyebrow, title, description, meta, actions, testId, titleId }: {
  eyebrow: string
  title: ReactNode
  description?: ReactNode
  /** Recorded status chips / short facts. */
  meta?: ReactNode
  /** The view's primary action (and at most one quiet secondary). */
  actions?: ReactNode
  testId?: string
  titleId?: string
}) {
  return (
    <header
      data-testid={testId}
      className="flex flex-col gap-4 border-b border-carup-line pb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-6"
    >
      <div className="min-w-0">
        <p className={`flex items-center gap-2 ${WS_EYEBROW}`}>
          <span aria-hidden="true" className="h-3 w-0.5 rounded-full bg-carup-raw-orange-signal" />
          {eyebrow}
        </p>
        <h1 id={titleId} className="mt-2 text-[1.625rem] font-bold leading-tight tracking-[-0.025em] text-carup-text sm:text-[2rem]">
          {title}
        </h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-carup-text-2">{description}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
          {actions}
        </div>
      )}
    </header>
  )
}
