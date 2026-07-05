// Read-only settings surface for the Command Center.
// Surfaces the platform-managed routing/SLA/channel configuration plus operational cadences for
// reference only — configuration editing is intentionally deferred and clearly labelled so operators
// know this page never mutates config. Purely presentational: the page supplies the policies +
// cadences + default queue, so this stays pure and unit-testable.

import { Gauge, Lock, SlidersHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChannelIcon } from '../ChannelIcon'
import { channelLabel } from '../channelRegistry'
import { titleCase } from '../communicationFormatting'

export interface SettingsSlaPolicy {
  id?: string
  name?: string
  channel?: string | null
  priority?: string | null
  first_response_minutes?: number | null
  next_response_minutes?: number | null
  resolution_minutes?: number | null
  business_timezone?: string | null
  active?: boolean
}

export interface SettingsViewProps {
  policies: SettingsSlaPolicy[]
  idlePollSeconds: number
  deliveryPollSeconds: number
  defaultQueue: string
}

// SLA targets are stored in minutes; render an em-dash when a target is not set.
function minutes(value?: number | null): string {
  return value === null || value === undefined ? '—' : `${value}m`
}

export function SettingsView({ policies, idlePollSeconds, deliveryPollSeconds, defaultQueue }: SettingsViewProps) {
  return (
    <div className="space-y-4" data-testid="settings-view">
      {/* (1) Read-only banner — this surface never edits configuration. */}
      <Card className="border-0 card-shadow" data-testid="settings-readonly">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Lock className="w-4 h-4" aria-hidden /> Settings
            <Badge variant="outline" className="ml-auto bg-gray-100 text-gray-600 border-gray-200">Read only</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600">
            Routing, SLA, and channel configuration is managed by the platform and shown here for reference.
            Editing from the Command Center is intentionally deferred.
          </p>
        </CardContent>
      </Card>

      {/* (2) SLA policies — read-only table. */}
      <Card className="border-0 card-shadow">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Gauge className="w-4 h-4" aria-hidden /> SLA policies
            {policies.length > 0 && <Badge variant="secondary" className="ml-auto">{policies.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {policies.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No SLA policies configured for this tenant.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse" data-testid="settings-sla-policies">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b">
                      <th className="py-2 pr-3 font-medium">Name</th>
                      <th className="py-2 pr-3 font-medium">Channel</th>
                      <th className="py-2 pr-3 font-medium">Priority</th>
                      <th className="py-2 pr-3 font-medium text-right">First</th>
                      <th className="py-2 pr-3 font-medium text-right">Next</th>
                      <th className="py-2 pr-3 font-medium text-right">Resolution</th>
                      <th className="py-2 pr-3 font-medium">Timezone</th>
                      <th className="py-2 font-medium">Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policies.map((policy, i) => (
                      <tr
                        key={policy.id ?? `${policy.name ?? 'policy'}-${i}`}
                        className="border-b last:border-0"
                        data-testid="settings-sla-row"
                      >
                        <td className="py-2 pr-3 font-medium">{policy.name || 'Unnamed policy'}</td>
                        <td className="py-2 pr-3">
                          {policy.channel ? (
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                              <ChannelIcon channel={policy.channel} size={14} decorative />
                              {channelLabel(policy.channel)}
                            </span>
                          ) : (
                            <span className="text-gray-400">All channels</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {policy.priority ? titleCase(policy.priority) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{minutes(policy.first_response_minutes)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{minutes(policy.next_response_minutes)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{minutes(policy.resolution_minutes)}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {policy.business_timezone || <span className="text-gray-400">—</span>}
                        </td>
                        <td className="py-2">
                          <Badge
                            variant="outline"
                            className={policy.active
                              ? 'bg-green-100 text-green-700 border-green-200'
                              : 'bg-gray-100 text-gray-500 border-gray-200'}
                          >
                            {policy.active ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-400 mt-3">
                First / Next / Resolution show the SLA target in minutes.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* (3) Operational cadences + default queue. */}
      <Card className="border-0 card-shadow" data-testid="settings-operational">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4" aria-hidden /> Operational
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border p-3" data-testid="settings-idle-poll">
              <dt className="text-[11px] uppercase tracking-wide text-gray-400">Idle refresh</dt>
              <dd className="text-sm font-medium mt-0.5 tabular-nums">Every {idlePollSeconds}s</dd>
            </div>
            <div className="rounded-lg border p-3" data-testid="settings-delivery-poll">
              <dt className="text-[11px] uppercase tracking-wide text-gray-400">Delivery refresh</dt>
              <dd className="text-sm font-medium mt-0.5 tabular-nums">Every {deliveryPollSeconds}s</dd>
            </div>
            <div className="rounded-lg border p-3" data-testid="settings-default-queue">
              <dt className="text-[11px] uppercase tracking-wide text-gray-400">Default queue</dt>
              <dd className="text-sm font-medium mt-0.5">{titleCase(defaultQueue) || '—'}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}
