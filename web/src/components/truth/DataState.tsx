import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { DATA_STATE_HEADLINES, type DataStateKind } from './dataStates'

/**
 * RX-02A S1-3 — DataState (UI_DESIGN_REFERENCE_AND_TOKENS.md §6.5).
 * The single permitted renderer of a data-read outcome:
 *  loading · empty · error · forbidden · not-measured · unavailable.
 * Invariants (tested in DataState.test.tsx):
 *  - a failed read is NEVER rendered as empty;
 *  - loading uses neutral skeletons inside a polite, labelled live region;
 *  - error is announced with role="alert";
 *  - not-measured is labelled unknown and never renders as 0;
 *  - unavailable is honest held-capability copy, never a dead control.
 */
export interface DataStateProps {
  state: DataStateKind
  /** Object/section name, e.g. "Service history". Used in copy and a11y labels. */
  subject?: string
  description?: ReactNode
  /** Optional recovery / next-step action. Rendered as a real keyboard-operable button. */
  action?: { label: string; onClick: () => void } | null
  className?: string
}

const DEFAULT_DESCRIPTIONS: Record<DataStateKind, string> = {
  loading: 'Fetching the latest data.',
  empty: 'There’s nothing to show here right now.',
  error: 'This view could not load. You can retry — nothing has been changed.',
  forbidden: 'This information isn’t available for your account. Contact support if this looks wrong.',
  'not-measured': 'This value has not been measured yet, so no figure is shown.',
  unavailable: 'This capability is not offered in this context yet.',
}

function Skeleton() {
  return (
    <div aria-hidden="true" className="space-y-2">
      <div className="h-3 w-2/5 animate-pulse rounded-[2px] bg-carup-bg-surface-2" />
      <div className="h-3 w-4/5 animate-pulse rounded-[2px] bg-carup-bg-surface-2" />
      <div className="h-3 w-3/5 animate-pulse rounded-[2px] bg-carup-bg-surface-2" />
    </div>
  )
}

export function DataState({ state, subject, description, action, className }: DataStateProps) {
  const headline = subject ? `${DATA_STATE_HEADLINES[state]} — ${subject}` : DATA_STATE_HEADLINES[state]
  const body = description ?? DEFAULT_DESCRIPTIONS[state]

  if (state === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={headline}
        data-testid="data-state"
        data-state="loading"
        className={cn('rounded-[12px] border border-carup-line bg-carup-bg-raised p-4', className)}
      >
        <span className="sr-only">{headline}</span>
        <Skeleton />
      </div>
    )
  }

  const isError = state === 'error'

  return (
    <div
      role={isError ? 'alert' : 'status'}
      data-testid="data-state"
      data-state={state}
      className={cn(
        'rounded-[12px] border p-4',
        state === 'forbidden' && 'border-status-danger bg-status-danger-soft',
        state === 'unavailable' && 'border-carup-line-strong bg-carup-bg-surface',
        (state === 'empty' || state === 'error' || state === 'not-measured') && 'border-carup-line bg-carup-bg-raised',
        className
      )}
    >
      <p className={cn('text-[14px] font-semibold', isError ? 'text-status-danger' : 'text-carup-text')}>
        {headline}
      </p>
      <p className="mt-1 text-[13px] leading-[1.55] text-carup-text-2">{body}</p>
      {action && state !== 'unavailable' && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-3 rounded-[6px] border border-carup-line-strong bg-carup-bg-raised px-3 py-1.5 text-[13px] font-medium text-carup-action transition-colors hover:bg-carup-action-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-carup-focus"
        >
          {action.label}
        </button>
      )}
      {state === 'unavailable' && action && (
        <p className="mt-2 text-[12px] italic text-carup-text-3">
          Action “{action.label}” is intentionally not offered while this capability is unavailable.
        </p>
      )}
    </div>
  )
}
