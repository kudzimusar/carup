// Full delivery-recovery view for the Command Center (plan §11).
// Renders the categorised queue health (queued-too-long / stale-processing-lock / retry-scheduled /
// failed / dead-letter / cancelled) with per-item retry/cancel, a guarded multi-select bulk retry
// (explicit selection + partial-failure reporting), and a safe requeue-with-corrected-destination for
// dead-letter items. Presentational — the page supplies the data + handlers.

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCcw, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ChannelIcon } from '../ChannelIcon'
import { titleCase, relativeTime } from '../communicationFormatting'

export interface RecoveryNotification {
  id: string
  notification_type?: string | null
  channel?: string | null
  status?: string | null
  last_error_code?: string | null
  last_error_message?: string | null
  created_at?: string | null
  updated_at?: string | null
  next_attempt_at?: string | null
}

const CATEGORY_META: Array<{ key: string; label: string; tone: 'destructive' | 'secondary' | 'outline' }> = [
  { key: 'dead_letter', label: 'Dead letter', tone: 'destructive' },
  { key: 'failed', label: 'Failed', tone: 'destructive' },
  { key: 'stale_processing', label: 'Stale processing lock', tone: 'secondary' },
  { key: 'queued_too_long', label: 'Queued too long', tone: 'secondary' },
  { key: 'retry_scheduled', label: 'Retry scheduled', tone: 'outline' },
  { key: 'cancelled', label: 'Cancelled', tone: 'outline' },
]
const RETRYABLE = new Set(['dead_letter', 'failed', 'stale_processing', 'queued_too_long'])

export interface RecoveryViewProps {
  categories: Record<string, RecoveryNotification[]>
  counts?: Record<string, number>
  busyAction?: string | null
  bulkNote?: string | null
  onRetry: (id: string) => void
  onCancel: (id: string) => void
  onRequeue: (id: string, correctedDestination: string) => void
  onBulkRetry: (ids: string[]) => void
}

export function RecoveryView({ categories, counts, busyAction, bulkNote, onRetry, onCancel, onRequeue, onBulkRetry }: RecoveryViewProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [requeueFor, setRequeueFor] = useState<string | null>(null)
  const [requeueDest, setRequeueDest] = useState('')

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const total = counts?.total ?? CATEGORY_META.reduce((sum, c) => sum + (categories[c.key]?.length || 0), 0)
  const selectedIds = [...selected]

  return (
    <Card className="border-0 card-shadow" data-testid="recovery-view">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <RefreshCcw className="w-4 h-4" aria-hidden /> Delivery recovery
          {total > 0 && <Badge variant="secondary" className="ml-auto">{total}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Guarded bulk action bar — acts only on the explicit selection. */}
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border bg-gray-50 p-2" role="group" aria-label="Bulk recovery actions" data-testid="recovery-bulk-bar">
            <span className="text-xs text-gray-600">{selectedIds.length} selected</span>
            <Button size="sm" className="h-7 gap-1 ml-auto" onClick={() => { onBulkRetry(selectedIds); setSelected(new Set()) }} disabled={busyAction === 'bulk-retry'}>
              {busyAction === 'bulk-retry' ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> : <RefreshCcw className="w-3 h-3" aria-hidden />} Retry {selectedIds.length}
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}
        {bulkNote && <p className="text-xs text-gray-500" data-testid="recovery-bulk-note">{bulkNote}</p>}

        {total === 0 ? (
          <div className="text-center py-6 text-sm text-gray-500">
            <CheckCircle2 className="w-7 h-7 mx-auto mb-1 text-green-500" aria-hidden /> Nothing needs recovery.
          </div>
        ) : (
          CATEGORY_META.filter((cat) => (categories[cat.key]?.length || 0) > 0).map((cat) => (
            <section key={cat.key} data-testid={`recovery-category-${cat.key}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <Badge variant={cat.tone} className="text-[10px]">{cat.label}</Badge>
                <span className="text-[11px] text-gray-400">{categories[cat.key].length}</span>
              </div>
              <div className="space-y-1.5">
                {categories[cat.key].map((item) => {
                  const canRetry = RETRYABLE.has(cat.key)
                  return (
                    <div key={item.id} className="rounded-lg border p-2.5" data-testid="recovery-item">
                      <div className="flex items-start gap-2">
                        {canRetry && (
                          <Checkbox
                            className="mt-0.5"
                            checked={selected.has(item.id)}
                            onCheckedChange={() => toggle(item.id)}
                            aria-label={`Select ${titleCase(item.notification_type) || 'notification'} ${item.id} for bulk retry`}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {item.channel && <ChannelIcon channel={item.channel} size={13} decorative />}
                            <span className="text-sm font-medium truncate">{titleCase(item.notification_type) || 'Notification'}</span>
                            <span className="text-[10px] text-gray-400 ml-auto">{relativeTime(item.updated_at || item.created_at)}</span>
                          </div>
                          {(item.last_error_code || item.last_error_message) && (
                            <p className="text-[11px] text-red-600 mt-0.5 truncate" title={item.last_error_message || item.last_error_code || ''}>
                              {item.last_error_code || 'error'}{item.last_error_message ? ` — ${item.last_error_message}` : ''}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {canRetry && (
                              <Button size="sm" variant="outline" className="h-6 gap-1 text-[11px]" onClick={() => onRetry(item.id)} disabled={busyAction === `retry-${item.id}`}>
                                {busyAction === `retry-${item.id}` ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> : <RefreshCcw className="w-3 h-3" aria-hidden />} Retry
                              </Button>
                            )}
                            {cat.key === 'dead_letter' && (
                              <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => { setRequeueFor(requeueFor === item.id ? null : item.id); setRequeueDest('') }}>
                                Requeue…
                              </Button>
                            )}
                            {cat.key !== 'cancelled' && (
                              <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => onCancel(item.id)} disabled={busyAction === `cancel-${item.id}`}>Cancel</Button>
                            )}
                          </div>
                          {requeueFor === item.id && (
                            <div className="flex items-center gap-1.5 mt-2" data-testid="recovery-requeue-form">
                              <Input
                                value={requeueDest}
                                onChange={(e) => setRequeueDest(e.target.value)}
                                placeholder="Corrected destination (phone / email / handle)"
                                aria-label="Corrected destination"
                                className="h-7 text-xs"
                              />
                              <Button size="sm" className="h-7 gap-1" disabled={!requeueDest.trim() || busyAction === `requeue-${item.id}`}
                                onClick={() => { onRequeue(item.id, requeueDest.trim()); setRequeueFor(null); setRequeueDest('') }}>
                                <Send className="w-3 h-3" aria-hidden /> Requeue
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))
        )}
        {total > 0 && (
          <p className="text-[10px] text-amber-600 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" aria-hidden /> Retry re-enqueues to the live provider. Requeue lets you correct the destination first.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
