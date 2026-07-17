// Per-channel provider health for the Command Center ops rail (Phase 11 / docs §9).
// Registry-driven: every channel appears (planned/future channels shown as "Planned"/"Not
// configured"), with Ready / Fake / Not configured / Planned derived from the live adapter health.
// A fake adapter on a real provider is surfaced as a problem — never as success (docs §3).

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, CheckCircle2, CircleDashed, Radio, XCircle } from 'lucide-react'
import { ChannelIcon } from '../ChannelIcon'
import { getChannel, orderedChannels } from '../channelRegistry'
import { providerStatus, type ProviderAdapterHealth, type ProviderStatus } from './providerHealth'

const STATUS_META: Record<ProviderStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; Icon: typeof CheckCircle2 }> = {
  ready: { label: 'Ready', variant: 'default', Icon: CheckCircle2 },
  fake: { label: 'Fake — no live send', variant: 'destructive', Icon: XCircle },
  not_configured: { label: 'Not configured', variant: 'outline', Icon: AlertTriangle },
  planned: { label: 'Planned', variant: 'secondary', Icon: CircleDashed },
}

export interface ProviderHealthPanelProps {
  adapters?: ProviderAdapterHealth[]
}

export function ProviderHealthPanel({ adapters = [] }: ProviderHealthPanelProps) {
  const byChannel = new Map(adapters.map((a) => [String(a.channel).toLowerCase(), a]))
  const rows = orderedChannels().map((def) => {
    const adapter = byChannel.get(String(def.key).toLowerCase())
    const status = providerStatus(def, adapter)
    return { def, adapter, status }
  })
  const ready = rows.filter((r) => r.status === 'ready').length

  return (
    <Card className="border-0 card-shadow">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Radio className="w-4 h-4" aria-hidden /> Provider health
          <span className="ml-auto text-xs font-normal text-gray-400">{ready}/{rows.length} ready</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {rows.map(({ def, status }) => {
          const meta = STATUS_META[status]
          const StatusIcon = meta.Icon
          return (
            <div key={def.key} className="flex items-center gap-2 text-sm">
              <ChannelIcon channel={def.key} size={15} decorative />
              <span className="truncate">{def.label}</span>
              <Badge variant={meta.variant} className="ml-auto text-[10px] gap-1 shrink-0">
                <StatusIcon className="w-3 h-3" aria-hidden />{meta.label}
              </Badge>
            </div>
          )
        })}
        {rows.some((r) => r.status === 'not_configured' && r.adapter?.missing?.length) && (
          <p className="text-[10px] text-amber-600 pt-1">
            Missing: {rows.filter((r) => r.status === 'not_configured' && r.adapter?.missing?.length)
              .map((r) => `${getChannel(r.def.key).shortLabel} (${r.adapter!.missing!.join(', ')})`).join(' · ')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
