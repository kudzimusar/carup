// Canonical communication channel registry for the CarUp Command Center.
//
// One source of truth for every channel's key, accessible label, provider, icon, brand token,
// identity format, capabilities, webhook path, and diagnostics support — so a channel appears
// consistently across inbox, filters, timeline, health, recovery, and audit without rewriting
// pages (see docs/agent-8-omnichannel/ENTERPRISE_COMMUNICATION_COMMAND_CENTER_GOAL_LOOP.md §6).
//
// Icons: recognizable official-style brand marks via react-icons/si for WhatsApp, Telegram,
// Facebook Messenger, Instagram, LINE, and X; Lucide semantic glyphs for the generic/app channels.
// Rendered accessibly (label + non-colour meaning) by <ChannelIcon> (ChannelIcon.tsx).

import type { ComponentType } from 'react'
import { Bell, BellRing, Globe, Mail, MessageSquareText, Smartphone } from 'lucide-react'
import { SiInstagram, SiLine, SiMessenger, SiTelegram, SiWhatsapp, SiX } from 'react-icons/si'

// Both lucide-react and react-icons components satisfy this minimal shape.
export type ChannelIconComponent = ComponentType<{ size?: number | string; className?: string; 'aria-hidden'?: boolean }>

export type ChannelKey =
  | 'whatsapp' | 'telegram' | 'facebook' | 'instagram' | 'line' | 'x'
  | 'email' | 'sms' | 'push' | 'in_app' | 'web_chat' | 'mobile_chat'

export type IdentityFormat = 'phone' | 'handle' | 'email' | 'chat_id' | 'device_token' | 'app_user'

// Static baseline. Live provider health (from the backend adapter registry) overrides this.
export type ChannelAvailability = 'available' | 'planned' | 'not_configured'

export interface ChannelCapabilities {
  inbound: boolean
  outbound: boolean
  templates: boolean
  media: boolean
  typingIndicator: boolean
}

export interface ChannelDefinition {
  key: ChannelKey | 'unknown'
  label: string
  shortLabel: string
  providerLabel: string
  icon: ChannelIconComponent
  brandColor: string
  identityFormat: IdentityFormat
  capabilities: ChannelCapabilities
  webhookPath: string | null
  supportsDiagnostics: boolean
  availability: ChannelAvailability
}

const CAP = (o: Partial<ChannelCapabilities>): ChannelCapabilities => ({
  inbound: false, outbound: false, templates: false, media: false, typingIndicator: false, ...o,
})

export const CHANNELS: Record<ChannelKey, ChannelDefinition> = {
  whatsapp: {
    key: 'whatsapp', label: 'WhatsApp', shortLabel: 'WhatsApp', providerLabel: 'meta_whatsapp_cloud_api',
    icon: SiWhatsapp, brandColor: '#25D366', identityFormat: 'phone',
    capabilities: CAP({ inbound: true, outbound: true, templates: true, media: true }),
    webhookPath: '/api/communications/webhooks/meta/whatsapp', supportsDiagnostics: true, availability: 'available',
  },
  telegram: {
    key: 'telegram', label: 'Telegram', shortLabel: 'Telegram', providerLabel: 'telegram_bot_api',
    icon: SiTelegram, brandColor: '#229ED9', identityFormat: 'chat_id',
    capabilities: CAP({ inbound: true, outbound: true, media: true }),
    webhookPath: '/api/communications/webhooks/telegram/telegram', supportsDiagnostics: true, availability: 'available',
  },
  facebook: {
    key: 'facebook', label: 'Facebook Messenger', shortLabel: 'Messenger', providerLabel: 'meta_messenger',
    icon: SiMessenger, brandColor: '#0866FF', identityFormat: 'handle',
    capabilities: CAP({ inbound: true, outbound: true, media: true }),
    webhookPath: '/api/communications/webhooks/meta/facebook', supportsDiagnostics: true, availability: 'available',
  },
  instagram: {
    key: 'instagram', label: 'Instagram', shortLabel: 'Instagram', providerLabel: 'meta_instagram_messaging',
    icon: SiInstagram, brandColor: '#E4405F', identityFormat: 'handle',
    capabilities: CAP({ inbound: true, outbound: true, media: true }),
    webhookPath: '/api/communications/webhooks/meta/instagram', supportsDiagnostics: true, availability: 'available',
  },
  line: {
    key: 'line', label: 'LINE', shortLabel: 'LINE', providerLabel: 'line_messaging_api',
    icon: SiLine, brandColor: '#06C755', identityFormat: 'handle',
    capabilities: CAP({ inbound: true, outbound: true, media: true }),
    webhookPath: '/api/communications/webhooks/line/line', supportsDiagnostics: true, availability: 'planned',
  },
  x: {
    key: 'x', label: 'X', shortLabel: 'X', providerLabel: 'x_dm_api',
    icon: SiX, brandColor: '#000000', identityFormat: 'handle',
    capabilities: CAP({ inbound: true, outbound: true }),
    webhookPath: '/api/communications/webhooks/x/dm', supportsDiagnostics: true, availability: 'planned',
  },
  email: {
    key: 'email', label: 'Email', shortLabel: 'Email', providerLabel: 'sendgrid',
    icon: Mail, brandColor: '#EA4335', identityFormat: 'email',
    capabilities: CAP({ inbound: true, outbound: true, media: true }),
    webhookPath: '/api/communications/webhooks/sendgrid/email', supportsDiagnostics: true, availability: 'available',
  },
  sms: {
    key: 'sms', label: 'SMS', shortLabel: 'SMS', providerLabel: 'twilio',
    icon: MessageSquareText, brandColor: '#F22F46', identityFormat: 'phone',
    capabilities: CAP({ inbound: true, outbound: true }),
    webhookPath: '/api/communications/webhooks/twilio/sms', supportsDiagnostics: true, availability: 'available',
  },
  push: {
    key: 'push', label: 'Push notification', shortLabel: 'Push', providerLabel: 'expo_push',
    icon: BellRing, brandColor: '#4630EB', identityFormat: 'device_token',
    capabilities: CAP({ outbound: true }),
    webhookPath: null, supportsDiagnostics: true, availability: 'available',
  },
  in_app: {
    key: 'in_app', label: 'In-app', shortLabel: 'In-app', providerLabel: 'in_app',
    icon: Bell, brandColor: '#F97316', identityFormat: 'app_user',
    capabilities: CAP({ inbound: true, outbound: true }),
    webhookPath: null, supportsDiagnostics: false, availability: 'available',
  },
  web_chat: {
    key: 'web_chat', label: 'Web chat', shortLabel: 'Web', providerLabel: 'web_chat',
    icon: Globe, brandColor: '#0EA5E9', identityFormat: 'app_user',
    capabilities: CAP({ inbound: true, outbound: true }),
    webhookPath: null, supportsDiagnostics: false, availability: 'available',
  },
  mobile_chat: {
    key: 'mobile_chat', label: 'Mobile chat', shortLabel: 'Mobile', providerLabel: 'mobile_chat',
    icon: Smartphone, brandColor: '#8B5CF6', identityFormat: 'app_user',
    capabilities: CAP({ inbound: true, outbound: true }),
    webhookPath: null, supportsDiagnostics: false, availability: 'available',
  },
}

export const UNKNOWN_CHANNEL: ChannelDefinition = {
  key: 'unknown', label: 'Unknown channel', shortLabel: 'Unknown', providerLabel: 'unknown',
  icon: Globe, brandColor: '#6B7280', identityFormat: 'app_user',
  capabilities: CAP({}), webhookPath: null, supportsDiagnostics: false, availability: 'not_configured',
}

// Rail order (docs §5): messaging-first, then email/sms, then app surfaces, planned channels last.
export const CHANNEL_ORDER: ChannelKey[] = [
  'whatsapp', 'telegram', 'facebook', 'instagram', 'email', 'sms',
  'in_app', 'web_chat', 'mobile_chat', 'push', 'line', 'x',
]

export function normalizeChannelKey(channel?: string | null): string {
  return String(channel || '').trim().toLowerCase()
}

export function getChannel(channel?: string | null): ChannelDefinition {
  const key = normalizeChannelKey(channel)
  return (CHANNELS as Record<string, ChannelDefinition>)[key] || UNKNOWN_CHANNEL
}

export function channelLabel(channel?: string | null): string {
  return getChannel(channel).label
}

export function providerLabel(channel?: string | null): string {
  return getChannel(channel).providerLabel
}

export function orderedChannels(): ChannelDefinition[] {
  return CHANNEL_ORDER.map((k) => CHANNELS[k])
}
