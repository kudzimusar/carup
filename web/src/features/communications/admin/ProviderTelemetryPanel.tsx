// Per-channel provider operations telemetry for the Command Center Providers surface (plan §12 / P1.4).
// Shows, per channel: live mode (real/fake/not-configured), webhook configured + last signature-verified
// + latest inbound, latest successful outbound, latest provider error, queue/retry/dead-letter counts,
// and missing credential NAMES (never values). Presentational — the page supplies the telemetry.

import { AlertTriangle, CheckCircle2, Radio, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChannelIcon } from '../ChannelIcon'
import { channelLabel } from '../channelRegistry'
import { relativeTime } from '../communicationFormatting'

export interface ProviderTelemetry {
  channel: string
  provider?: string | null
  mode?: string | null
  available?: boolean
  webhook?: { path?: string | null; configured?: boolean; latest_inbound_at?: string | null; last_signature_valid?: boolean | null }
  outbound?: { latest_success_at?: string | null; latest_success_provider_message_id?: string | null }
  latest_error?: { at?: string | null; code?: string | null; message?: string | null } | null
  queue?: { queued?: number; retry_scheduled?: number; dead_letter?: number }
  credentials?: { complete?: boolean; missing?: string[] }
}

export interface ProviderTelemetryPanelProps {
  channels: ProviderTelemetry[]
  staleLocks?: number
}

function modeBadge(t: ProviderTelemetry) {
  const mode = String(t.mode || '').toLowerCase()
  if (mode === 'fake') return <Badge variant="destructive" className="text-[10px]">Fake — no live send</Badge>
  if (mode === 'planned') return <Badge variant="secondary" className="text-[10px]">Planned</Badge>

  // "Ready" must mean the channel can actually send. `mode === 'real'` only says which adapter is
  // wired, not that it is usable — every unconfigured provider here is a real adapter — so keying
  // the badge on the mode alone labelled SendGrid, Twilio, Expo, Messenger and Instagram "Ready"
  // on the same card that listed their missing credentials. An operator reading the provider board
  // during an incident would have taken those channels as healthy.
  const credentialsMissing = t.credentials?.complete === false && (t.credentials.missing?.length ?? 0) > 0
  if (t.available && !credentialsMissing) return <Badge className="text-[10px]">Ready</Badge>
  if (credentialsMissing) return <Badge variant="outline" className="text-[10px]">Not configured</Badge>
  return <Badge variant="outline" className="text-[10px]">Unavailable</Badge>
}

export function ProviderTelemetryPanel({ channels, staleLocks }: ProviderTelemetryPanelProps) {
  return (
    <Card className="border-0 card-shadow" data-testid="provider-telemetry">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Radio className="w-4 h-4" aria-hidden /> Provider operations
          {typeof staleLocks === 'number' && staleLocks > 0 && (
            <Badge variant="destructive" className="ml-auto text-[10px]">{staleLocks} stale lock{staleLocks === 1 ? '' : 's'}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {channels.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No provider telemetry.</p>
        ) : channels.map((t) => (
          <div key={t.channel} className="rounded-lg border p-3 space-y-1.5" data-testid="provider-channel" data-channel-key={t.channel}>
            <div className="flex items-center gap-2">
              <ChannelIcon channel={t.channel} size={16} decorative />
              <span className="text-sm font-medium">{channelLabel(t.channel)}</span>
              {t.provider && <span className="text-[10px] text-gray-400 font-mono">{t.provider}</span>}
              <span className="ml-auto">{modeBadge(t)}</span>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <span className="text-gray-400">Webhook</span>
              <span className="text-right flex items-center justify-end gap-1">
                {t.webhook?.configured
                  ? <><CheckCircle2 className="w-3 h-3 text-green-500" aria-hidden /> Configured{t.webhook?.last_signature_valid ? ' · verified' : ''}</>
                  : <><XCircle className="w-3 h-3 text-gray-400" aria-hidden /> Not configured</>}
              </span>

              <span className="text-gray-400">Last inbound</span>
              <span className="text-right text-gray-600">{t.webhook?.latest_inbound_at ? relativeTime(t.webhook.latest_inbound_at) : '—'}</span>

              <span className="text-gray-400">Last outbound OK</span>
              <span className="text-right text-gray-600">{t.outbound?.latest_success_at ? relativeTime(t.outbound.latest_success_at) : '—'}</span>

              <span className="text-gray-400">Queue / retry / DLQ</span>
              <span className="text-right text-gray-600 tabular-nums">{t.queue?.queued ?? 0} / {t.queue?.retry_scheduled ?? 0} / {t.queue?.dead_letter ?? 0}</span>
            </div>

            {t.latest_error && (t.latest_error.code || t.latest_error.message) && (
              <p className="text-[11px] text-red-600 flex items-start gap-1" data-testid="provider-latest-error">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden />
                <span className="truncate">{t.latest_error.code || 'error'}{t.latest_error.message ? ` — ${t.latest_error.message}` : ''} {t.latest_error.at ? `(${relativeTime(t.latest_error.at)})` : ''}</span>
              </p>
            )}

            {t.credentials && t.credentials.complete === false && (t.credentials.missing?.length ?? 0) > 0 && (
              <p className="text-[10px] text-amber-600" data-testid="provider-missing-creds">
                Missing credentials: {t.credentials.missing!.join(', ')}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
