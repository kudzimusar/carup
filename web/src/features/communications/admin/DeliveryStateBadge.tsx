// Delivery-state badge for the Command Center (Phase 12 component split).
// Delivery state is distinct from thread workflow state (docs §3); this renders only the former,
// driven by the shared communicationFormatting label/tone maps so every surface agrees.

import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Clock, Loader2, RefreshCcw, Send, ShieldAlert, XCircle } from 'lucide-react'
import { deliveryLabel, deliveryTone, type StateTone } from '../communicationFormatting'

const TONE_VARIANT: Record<StateTone, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  positive: 'default',
  pending: 'outline',
  warning: 'outline',
  negative: 'destructive',
  neutral: 'secondary',
}

function DeliveryIcon({ status }: { status: string }) {
  const cls = status === 'processing' ? 'w-3 h-3 animate-spin' : 'w-3 h-3'
  switch (status) {
    case 'delivered':
    case 'read':
      return <CheckCircle2 className={cls} aria-hidden />
    case 'sent':
      return <Send className={cls} aria-hidden />
    case 'queued':
    case 'draft':
      return <Clock className={cls} aria-hidden />
    case 'processing':
      return <Loader2 className={cls} aria-hidden />
    case 'retry_scheduled':
      return <RefreshCcw className={cls} aria-hidden />
    case 'failed':
    case 'dead_letter':
      return <XCircle className={cls} aria-hidden />
    case 'internal_note':
      return <ShieldAlert className={cls} aria-hidden />
    default:
      return null
  }
}

export interface DeliveryStateBadgeProps {
  status?: string | null
  className?: string
}

export function DeliveryStateBadge({ status, className }: DeliveryStateBadgeProps) {
  const s = String(status || '').toLowerCase()
  if (!s) return null
  return (
    <Badge variant={TONE_VARIANT[deliveryTone(s)]} className={`text-xs gap-1 ${className || ''}`.trim()}>
      <DeliveryIcon status={s} />
      {deliveryLabel(s)}
    </Badge>
  )
}
