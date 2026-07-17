// Command Center context / ops rail (plan §7).
// A stack of small, compact cards giving the operator the who/what/where around a thread: customer
// identity, linked channel identities, product/order/listing/escrow context, owner + reassignment
// history, SLA state, and communication preferences/consent. Presentational — the page supplies the
// precomputed props; identity-first labels + masking keep raw addresses/UUIDs off screen (docs §3).

import type { ReactNode } from 'react'
import { AlertTriangle, BadgeCheck, Check, Clock, Link2, MinusCircle, Package, PauseCircle, ShieldCheck, SlidersHorizontal, Timer, User, Users, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChannelIcon } from '../ChannelIcon'
import { formatExactDateTime, identityLabel, maskEmail, maskPhone, titleCase } from '../communicationFormatting'

export interface ContextIdentity {
  id?: string
  display_name?: string | null
  normalized_address?: string | null
  external_id?: string | null
  channel?: string | null
  provider?: string | null
  verified?: boolean | null
  consent_status?: string | null
}

export interface ContextPreferences {
  preferred_channel?: string | null
  timezone?: string | null
  language?: string | null
  consent_status?: string | null
  consent_version?: string | null
  consented_at?: string | null
  whatsapp_enabled?: boolean
  telegram_enabled?: boolean
  email_enabled?: boolean
  sms_enabled?: boolean
  marketing_enabled?: boolean
}

export interface ContextReassignment {
  at?: string | null
  summary?: string | null
  actor?: string | null
}

export interface ContextRef {
  label: string
  value: string
}

export interface ContextRailProps {
  identity?: ContextIdentity | null
  linkedIdentities?: ContextIdentity[]
  /** Product/order/listing/escrow/financing references, shown as label: value rows. */
  contextRefs?: ContextRef[]
  assignedLabel?: string
  team?: string | null
  /** Reassignment timeline, newest first. */
  reassignmentHistory?: ContextReassignment[]
  slaLabel?: string
  /** healthy | due_soon | breached | paused | not_applicable */
  slaState?: string
  preferences?: ContextPreferences | null
  timeZone?: string
}

// ── tone helpers ──

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive'

function consentTone(status?: string | null): BadgeVariant {
  switch (String(status || '').toLowerCase()) {
    case 'granted':
    case 'opted_in':
    case 'subscribed':
    case 'active':
      return 'default'
    case 'revoked':
    case 'opted_out':
    case 'unsubscribed':
    case 'withdrawn':
      return 'destructive'
    case 'pending':
      return 'outline'
    default:
      return 'secondary'
  }
}

const SLA_TONE: Record<string, { cls: string; Icon: LucideIcon }> = {
  breached: { cls: 'border-red-200 bg-red-50 text-red-700', Icon: AlertTriangle },
  due_soon: { cls: 'border-amber-200 bg-amber-50 text-amber-700', Icon: Clock },
  paused: { cls: 'border-gray-200 bg-gray-50 text-gray-500', Icon: PauseCircle },
  healthy: { cls: 'border-green-200 bg-green-50 text-green-700', Icon: ShieldCheck },
  not_applicable: { cls: 'border-gray-200 bg-gray-50 text-gray-400', Icon: MinusCircle },
}

// Mask a raw address for a secondary line — email/phone only; never surface anything else raw.
function maskAddress(value?: string | null): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.includes('@')) return maskEmail(raw)
  const digits = raw.replace(/[^\d+]/g, '').replace(/^\+/, '')
  if (digits.length >= 5) return maskPhone(raw)
  return ''
}

type PrefChannelKey = 'whatsapp_enabled' | 'telegram_enabled' | 'email_enabled' | 'sms_enabled' | 'marketing_enabled'
const CHANNEL_PREFS: Array<{ key: PrefChannelKey; label: string; channel: string }> = [
  { key: 'whatsapp_enabled', label: 'WhatsApp', channel: 'whatsapp' },
  { key: 'telegram_enabled', label: 'Telegram', channel: 'telegram' },
  { key: 'email_enabled', label: 'Email', channel: 'email' },
  { key: 'sms_enabled', label: 'SMS', channel: 'sms' },
  { key: 'marketing_enabled', label: 'Marketing', channel: 'marketing' },
]

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-gray-400 shrink-0">{label}</span>
      <span className="text-gray-700 text-right break-words min-w-0">{children}</span>
    </div>
  )
}

export function ContextRail({
  identity,
  linkedIdentities = [],
  contextRefs = [],
  assignedLabel,
  team,
  reassignmentHistory = [],
  slaLabel,
  slaState,
  preferences,
  timeZone,
}: ContextRailProps) {
  const primaryLabel = identityLabel(identity)
  const masked = maskAddress(identity?.normalized_address || identity?.external_id)
  const showMasked = !!masked && masked !== primaryLabel

  const hasOwner = !!(assignedLabel || team || reassignmentHistory.length)
  const hasSla = !!(slaState || slaLabel)
  const sla = SLA_TONE[String(slaState || '').toLowerCase()] ?? SLA_TONE.not_applicable

  return (
    <div className="space-y-4" data-testid="context-rail">
      {/* 1 — customer identity */}
      <Card className="border-0 card-shadow" data-testid="context-identity">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <User className="w-4 h-4" aria-hidden /> Customer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {identity?.channel && <ChannelIcon channel={identity.channel} size={16} decorative />}
            <span className="font-medium text-sm truncate">{primaryLabel}</span>
            {identity?.verified && <BadgeCheck className="w-4 h-4 text-green-500 shrink-0" aria-label="Verified" />}
          </div>
          {showMasked && <p className="text-xs text-gray-400 truncate">{masked}</p>}
          <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-gray-500">
            {identity?.channel && <span>{titleCase(identity.channel)}</span>}
            {identity?.provider && <span className="text-gray-400">· {titleCase(identity.provider)}</span>}
          </div>
          {identity?.consent_status && (
            <Badge variant={consentTone(identity.consent_status)} className="text-[10px]" data-testid="context-identity-consent">
              {titleCase(identity.consent_status)}
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* 2 — linked channel identities (omit when none) */}
      {linkedIdentities.length > 0 && (
        <Card className="border-0 card-shadow" data-testid="context-linked">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Link2 className="w-4 h-4" aria-hidden /> Linked identities
              <Badge variant="outline" className="ml-auto">{linkedIdentities.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {linkedIdentities.map((li, i) => (
              <div key={li.id || `${li.channel}-${i}`} className="flex items-center gap-2 text-sm min-w-0" data-testid="context-linked-row">
                <ChannelIcon channel={li.channel} size={15} decorative />
                <span className="truncate">{identityLabel(li)}</span>
                {li.channel && <span className="ml-auto text-[10px] text-gray-400 shrink-0">{titleCase(li.channel)}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 3 — product / order / listing / escrow / finance refs (omit when none) */}
      {contextRefs.length > 0 && (
        <Card className="border-0 card-shadow" data-testid="context-refs">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Package className="w-4 h-4" aria-hidden /> Context
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {contextRefs.map((ref) => (
              <InfoRow key={ref.label} label={ref.label}>{ref.value}</InfoRow>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 4 — owner / team + reassignment timeline */}
      {hasOwner && (
        <Card className="border-0 card-shadow" data-testid="context-owner">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="w-4 h-4" aria-hidden /> Ownership
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(assignedLabel || team) && (
              <div className="flex items-center gap-2 text-sm flex-wrap">
                {assignedLabel && <span className="font-medium">{assignedLabel}</span>}
                {team && <Badge variant="secondary" className="text-[10px]">{team}</Badge>}
              </div>
            )}
            {reassignmentHistory.length > 0 && (
              <ol className="relative space-y-2 pt-1">
                {reassignmentHistory.map((entry, i) => {
                  const dt = formatExactDateTime(entry.at, { timeZone })
                  return (
                    <li key={`${entry.at || 'entry'}-${i}`} className="flex gap-2" data-testid="context-reassignment">
                      <span className="mt-1 w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" aria-hidden />
                      <div className="min-w-0 flex-1">
                        {entry.summary && <p className="text-xs text-gray-600 break-words">{entry.summary}</p>}
                        <div className="text-[10px] text-gray-400">
                          {dt.valid && <time dateTime={dt.iso} title={dt.iso}>{dt.absolute}</time>}
                          {entry.actor && <span className="ml-1.5">· {entry.actor}</span>}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      )}

      {/* 5 — SLA state + label with tone */}
      {hasSla && (
        <Card className="border-0 card-shadow" data-testid="context-sla">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Timer className="w-4 h-4" aria-hidden /> SLA
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${sla.cls}`} data-sla-state={String(slaState || 'not_applicable').toLowerCase()}>
              <sla.Icon className="w-4 h-4 shrink-0" aria-hidden />
              <span className="font-medium">{slaLabel || titleCase(slaState) || 'Not applicable'}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 6 — preferences + consent (omit when null) */}
      {preferences && (
        <Card className="border-0 card-shadow" data-testid="context-preferences">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4" aria-hidden /> Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(preferences.consent_status || preferences.consent_version || preferences.consented_at) && (
              <div className="flex items-center gap-1.5 flex-wrap" data-testid="context-preferences-consent">
                {preferences.consent_status && (
                  <Badge variant={consentTone(preferences.consent_status)} className="text-[10px] gap-1">
                    <ShieldCheck className="w-3 h-3" aria-hidden />{titleCase(preferences.consent_status)}
                  </Badge>
                )}
                {preferences.consent_version && <span className="text-[10px] text-gray-400">v{preferences.consent_version}</span>}
                {(() => {
                  const dt = formatExactDateTime(preferences.consented_at, { timeZone })
                  return dt.valid ? <time className="text-[10px] text-gray-400" dateTime={dt.iso} title={dt.iso}>{dt.absolute}</time> : null
                })()}
              </div>
            )}
            {preferences.preferred_channel && (
              <InfoRow label="Preferred">
                <span className="inline-flex items-center gap-1">
                  <ChannelIcon channel={preferences.preferred_channel} size={13} decorative />
                  {titleCase(preferences.preferred_channel)}
                </span>
              </InfoRow>
            )}
            {preferences.timezone && <InfoRow label="Timezone">{preferences.timezone}</InfoRow>}
            {preferences.language && <InfoRow label="Language">{preferences.language}</InfoRow>}
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              {CHANNEL_PREFS.map(({ key, label, channel }) => {
                const enabled = preferences[key] === true
                return (
                  <Badge
                    key={key}
                    variant={enabled ? 'default' : 'outline'}
                    className={enabled ? 'text-[10px] gap-1' : 'text-[10px] gap-1 text-gray-400'}
                    data-testid="context-pref-channel"
                    data-channel={channel}
                    data-enabled={enabled}
                  >
                    {enabled ? <Check className="w-3 h-3" aria-hidden /> : <X className="w-3 h-3" aria-hidden />}{label}
                  </Badge>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
