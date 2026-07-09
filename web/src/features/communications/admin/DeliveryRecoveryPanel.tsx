// Delivery recovery (dead-letter) panel for the Command Center ops rail (Phase 10/12 / docs §8).
// Shows failed notifications with error context and safe retry/cancel. Presentational — the page
// supplies the items and the retry/cancel handlers; `busyAction` disables the in-flight row.

import { CheckCircle2, Loader2, RefreshCcw, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { titleCase } from '../communicationFormatting'

export interface RecoveryItem {
  id: string
  notification_type?: string | null
  channel?: string | null
  last_error_code?: string | null
  last_error_message?: string | null
}

export interface DeliveryRecoveryPanelProps {
  items: RecoveryItem[]
  busyAction?: string | null
  onRetry: (id: string) => void
  onCancel: (id: string) => void
  max?: number
}

export function DeliveryRecoveryPanel({ items, busyAction, onRetry, onCancel, max = 5 }: DeliveryRecoveryPanelProps) {
  return (
    <Card className="border-0 card-shadow">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" aria-hidden /> Delivery recovery
          {items.length > 0 && <Badge variant="destructive" className="ml-auto">{items.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <div className="text-center py-4 text-sm text-gray-500">
            <CheckCircle2 className="w-6 h-6 mx-auto mb-1 text-green-500" aria-hidden />
            No failed deliveries.
          </div>
        ) : (
          <>
            {items.slice(0, max).map((item) => (
              <div key={item.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-sm truncate">{titleCase(item.notification_type) || 'Notification'}</p>
                  {item.channel && <Badge variant="outline" className="text-[10px] shrink-0">{item.channel}</Badge>}
                </div>
                <p className="text-xs text-red-600 mt-0.5 truncate" title={item.last_error_message || item.last_error_code || ''}>
                  {item.last_error_code || 'delivery_failed'}{item.last_error_message ? ` — ${item.last_error_message}` : ''}
                </p>
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => onRetry(item.id)} disabled={busyAction === `retry-${item.id}`}>
                    {busyAction === `retry-${item.id}` ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> : <RefreshCcw className="w-3 h-3" aria-hidden />} Retry
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => onCancel(item.id)} disabled={busyAction === `cancel-${item.id}`}>Cancel</Button>
                </div>
              </div>
            ))}
            {items.length > max && <p className="text-xs text-gray-400 text-center pt-1">+{items.length - max} more failed</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}
