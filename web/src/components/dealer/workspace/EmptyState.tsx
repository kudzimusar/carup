/**
 * RX05-C — EmptyState and WorkspaceNotice.
 *
 * EmptyState is the truthful "nothing here (yet)" / "could not read" / "not permitted" panel:
 *   - `kind="empty"`   — the read succeeded and returned nothing; say what creates the first one.
 *   - `kind="error"`   — the read failed; say that an outage is NOT proof of absence, offer a retry.
 *   - `kind="denied"`  — the server refused authority; explain what grants it (no retry spam).
 *   - `kind="loading"` — a polite status line while a scoped read is in flight.
 *
 * WorkspaceNotice is a one-line receipt / problem banner for the outcome of an action.
 */
import type { ReactNode } from 'react'
import { AlertTriangle, CircleSlash, Inbox, Loader2, RotateCw } from 'lucide-react'
import { WS_SECONDARY } from './workspaceStyles'

type Kind = 'empty' | 'error' | 'denied' | 'loading'

const ICONS: Record<Kind, typeof Inbox> = { empty: Inbox, error: AlertTriangle, denied: CircleSlash, loading: Loader2 }
const ICON_TONE: Record<Kind, string> = {
  empty: 'bg-carup-bg-surface text-carup-text-2',
  error: 'bg-status-warning-soft text-status-warning',
  denied: 'bg-status-neutral-soft text-status-neutral',
  loading: 'bg-carup-bg-surface text-carup-text-2',
}

export function EmptyState({ kind = 'empty', title, children, action, onRetry, retryLabel = 'Try again', testId, compact = false }: {
  kind?: Kind
  title: ReactNode
  /** What it means / what creates the first record. */
  children?: ReactNode
  action?: ReactNode
  /** Renders a retry button (error states). */
  onRetry?: () => void
  retryLabel?: string
  testId?: string
  compact?: boolean
}) {
  const Icon = ICONS[kind]
  const role = kind === 'error' || kind === 'denied' ? 'alert' : kind === 'loading' ? 'status' : undefined
  return (
    <div
      role={role}
      data-testid={testId}
      data-state={kind}
      className={`flex items-start gap-3 rounded-card border ${kind === 'error' ? 'border-status-warning' : 'border-carup-line'} ${compact ? 'border-dashed p-4' : 'bg-carup-bg-raised p-5 sm:p-6'}`}
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${ICON_TONE[kind]}`} aria-hidden="true">
        <Icon className={`h-4 w-4 ${kind === 'loading' ? 'animate-spin motion-reduce:animate-none' : ''}`} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-carup-text">{title}</p>
        {children && <div className="mt-1 text-sm leading-6 text-carup-text-2">{children}</div>}
        {(action || onRetry) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {onRetry && (
              <button type="button" className={WS_SECONDARY} onClick={onRetry}>
                <RotateCw className="h-4 w-4" aria-hidden="true" /> {retryLabel}
              </button>
            )}
            {action}
          </div>
        )}
      </div>
    </div>
  )
}

const NOTICE_TONE = {
  info: 'border-status-info bg-status-info-soft',
  warning: 'border-status-warning bg-status-warning-soft',
  danger: 'border-status-danger bg-status-danger-soft',
} as const

/** Outcome of an action. `tone="info"` for receipts (never green: a receipt is not a verification). */
export function WorkspaceNotice({ tone = 'info', children, testId }: {
  tone?: keyof typeof NOTICE_TONE
  children: ReactNode
  testId?: string
}) {
  return (
    <p
      role={tone === 'info' ? 'status' : 'alert'}
      data-testid={testId}
      className={`rounded-control border px-3 py-2.5 text-sm leading-6 text-carup-text [overflow-wrap:anywhere] ${NOTICE_TONE[tone]}`}
    >
      {children}
    </p>
  )
}
