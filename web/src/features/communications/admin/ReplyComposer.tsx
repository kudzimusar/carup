// Audited reply composer for the Command Center (docs §8).
// Controlled: the page owns reply text / internal-note / status / correlation / reply channel.
// States the exact target ("Reply via <channel> to the customer"), offers a compact selector when
// the thread can be answered on more than one channel, disables duplicate submit, exposes the
// idempotency key + correlation id, and preserves the draft on failure.

import { Loader2, Send, ShieldAlert, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ChannelIcon } from '../ChannelIcon'
import { channelLabel } from '../channelRegistry'
import { DeliveryStateBadge } from './DeliveryStateBadge'

export type ReplyComposerStatus = 'idle' | 'sending' | 'queued' | 'sent' | 'delivered' | 'failed'

export interface ReplyComposerProps {
  channel?: string | null
  /** Channels this thread can actually be answered on. Omitted: `channel` is the only target. */
  channels?: string[]
  onChannelChange?: (channel: string) => void
  reply: string
  onReplyChange: (v: string) => void
  internalNote: boolean
  onInternalNoteChange: (v: boolean) => void
  status: ReplyComposerStatus
  error?: string | null
  correlationId?: string | null
  idempotencyKey: string
  onSend: () => void
}

export function ReplyComposer({
  channel, channels, onChannelChange, reply, onReplyChange, internalNote, onInternalNoteChange,
  status, error, correlationId, idempotencyKey, onSend,
}: ReplyComposerProps) {
  const sending = status === 'sending'
  // An explicit empty list means the thread has no deliverable channel: a customer-visible reply
  // has nowhere to go, but an internal note is still allowed.
  const noTarget = !internalNote && Array.isArray(channels) && channels.length === 0
  const selectable = !internalNote && Boolean(onChannelChange) && (channels?.length ?? 0) > 1
  return (
    <div className="space-y-2">
      <div className="text-xs">
        {internalNote ? (
          <span className="flex items-center gap-1 text-amber-700 font-medium">
            <ShieldAlert className="w-3.5 h-3.5" aria-hidden /> Internal note · saved to the thread, not sent to the customer
          </span>
        ) : noTarget ? (
          <span className="flex items-center gap-1 text-amber-700" data-testid="reply-no-channel">
            <ShieldAlert className="w-3.5 h-3.5" aria-hidden /> No reachable channel for this customer — add an internal note instead
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-1 text-gray-600" data-testid="reply-target" data-reply-channel={channel || ''}>
            Reply via <ChannelIcon channel={channel} size={14} decorative /> <strong>{channelLabel(channel)}</strong> to the customer
          </span>
        )}
      </div>
      {selectable && (
        <div role="radiogroup" aria-label="Reply channel" className="flex flex-wrap gap-1.5" data-testid="reply-channel-selector">
          {channels!.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === channel}
              data-channel-option={option}
              disabled={sending}
              onClick={() => onChannelChange?.(option)}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${option === channel
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'}`}
            >
              <ChannelIcon channel={option} size={12} decorative /> {channelLabel(option)}
            </button>
          ))}
        </div>
      )}
      <Textarea
        value={reply}
        onChange={(e) => onReplyChange(e.target.value)}
        placeholder={internalNote ? 'Write an internal note (not sent to the user)…' : 'Write a user-visible reply…'}
        disabled={sending}
        className={internalNote ? 'border-amber-300 focus-visible:ring-amber-300' : ''}
        rows={3}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <Switch checked={internalNote} onCheckedChange={onInternalNoteChange} aria-label="Internal note (not sent to the user)" />
          Internal note
        </label>
        <Button onClick={onSend} className="gap-2" disabled={!reply.trim() || sending || noTarget}>
          {sending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Send className="w-4 h-4" aria-hidden />}
          {sending ? 'Sending…' : internalNote ? 'Add internal note' : 'Send reply'}
        </Button>
        {status !== 'idle' && status !== 'failed' && status !== 'sending' && (
          <span className="flex items-center gap-1.5 text-xs text-gray-500" aria-live="polite">
            Reply <DeliveryStateBadge status={status} />
          </span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-auto text-[10px] text-gray-300 font-mono cursor-default hidden sm:block">idem {idempotencyKey.slice(0, 8)}</span>
          </TooltipTrigger>
          <TooltipContent>Idempotency key — resubmitting the same key will not double-send.</TooltipContent>
        </Tooltip>
      </div>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" aria-live="assertive">
          <p className="flex items-center gap-1"><XCircle className="w-4 h-4" aria-hidden /> {error}</p>
          {correlationId && <p className="mt-1 text-xs font-mono">Correlation ID: {correlationId}</p>}
          <p className="mt-1 text-xs text-red-500">Your draft was preserved — press Send to retry.</p>
        </div>
      )}
    </div>
  )
}
