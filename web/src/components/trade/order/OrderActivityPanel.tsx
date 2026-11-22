/**
 * RX-06 — Import Order › Activity: one chronological feed, newest first, built ONLY from real records —
 * the sealed audit trail (GET …/audit) and the order's own records (created/updated, quotes,
 * documents and their reviews, reservations, shipments, compliance reviews, payment milestones).
 * An event is never invented: no record, no event. Actor and time are shown when recorded.
 */
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/dealer/workspace/EmptyState'
import type { DiasporaAuditEntry, DiasporaTradeDocument } from '@/types'
import { activityActorLabel, buildActivity, formatDay, formatWhen, type ActivityKind, type Read, type TradeOrder } from './orderModel'
import type { TradeViewer } from './orderViewTypes'
import { Panel, Provenance } from './TradeKit'

const KIND_LABEL: Record<ActivityKind, string> = {
  order: 'Order', quote: 'Quote', participant: 'Participant', document: 'Document', reservation: 'Container', shipment: 'Shipment', review: 'Review', milestone: 'Payment', vehicle: 'Vehicle', other: 'Record',
}

export function OrderActivityPanel({ order, viewer, audit, documents }: {
  order: TradeOrder
  viewer: TradeViewer
  audit?: Read<DiasporaAuditEntry[]>
  documents: DiasporaTradeDocument[]
}) {
  const auditRows = audit?.state === 'ready' ? audit.data : null
  const events = buildActivity({ order, audit: auditRows, documents })
  const days = events.map(e => formatDay(e.at) ?? 'Date not recorded')
  return (
    <div className="space-y-4" data-testid="trade-activity">
      {audit && audit.state === 'loading' && <EmptyState kind="loading" compact title="Loading the sealed audit trail…" testId="trade-activity-audit-loading" />}
      {audit && audit.state === 'failed' && (
        <EmptyState kind="error" compact title="The audit trail could not be loaded" onRetry={audit.onRetry} testId="trade-activity-audit-failed">
          Showing the order’s own records only. Nothing about the order has changed.
        </EmptyState>
      )}
      {audit && (audit.state === 'denied' || audit.state === 'unavailable') && (
        <EmptyState kind="denied" compact title="The audit trail is not available to this account" testId="trade-activity-audit-denied">
          Showing the order’s own records only.
        </EmptyState>
      )}
      <Panel
        title="Activity"
        eyebrow={auditRows ? 'Sealed audit trail and order records' : 'Order records'}
        testId="trade-activity-feed"
      >
        {events.length === 0 ? (
          <p className="text-sm text-carup-text-2" data-testid="trade-activity-empty">Nothing has been recorded on this order yet.</p>
        ) : (
          <ol className="relative space-y-0">
            {events.map((e, i) => {
              const day = days[i]
              const showDay = i === 0 || days[i - 1] !== day
              return (
                <li key={e.id} data-testid="trade-activity-event" data-source={e.source} data-kind={e.kind}>
                  {showDay && <p className="pb-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-carup-text-3 first:pt-0">{day}</p>}
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 pb-3">
                    <span aria-hidden="true" className={cn('mt-1.5 h-2.5 w-2.5 rounded-full', e.source === 'audit' ? 'bg-carup-text' : 'border-2 border-carup-line-strong')} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-carup-text">{e.title}</p>
                      {e.detail && <p className="text-sm text-carup-text-2 [overflow-wrap:anywhere]">{e.detail}</p>}
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-carup-text-3">
                        <span>{formatWhen(e.at)?.split(', ')[1] ?? 'time not recorded'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{activityActorLabel(e, viewer.id)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{KIND_LABEL[e.kind]}</span>
                        <Provenance kind={e.source === 'audit' ? 'carup' : 'record'}>{e.source === 'audit' ? (e.sealed ? 'Audit trail · sealed' : 'Audit trail') : 'Order record'}</Provenance>
                      </p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        <p className="mt-2 text-xs leading-5 text-carup-text-3">The audit read returns the latest entries; the full sealed trail is retained by CarUp. A record shown as “Order record” has no matching audit entry in this read.</p>
      </Panel>
    </div>
  )
}
