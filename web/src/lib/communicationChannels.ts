/** Source capability and delivery readiness are different evidence levels. */
export type ChannelStatus = 'available' | 'unavailable' | 'unknown'
export type CapabilityState = 'IMPLEMENTED' | 'HISTORICALLY_PHYSICALLY_CERTIFIED'
  | 'CURRENT_RUNTIME_CONFIGURED' | 'CURRENT_RUNTIME_READY' | 'PUBLIC_LAUNCH_ENABLED'
  | 'TEMPORARILY_UNAVAILABLE' | 'PLANNED'

// Accepted Communications evidence. A health read never recertifies physical delivery.
export const CHANNEL_IMPLEMENTATION = {
  whatsapp: { provider: 'meta_whatsapp_cloud_api', implemented: true, historicalPhysical: true },
  telegram: { provider: 'telegram_bot_api', implemented: true, historicalPhysical: true },
  email: { provider: 'resend', implemented: true, historicalPhysical: true },
  email_marketing: { provider: 'brevo', implemented: true, historicalPhysical: false },
  facebook: { provider: 'meta_messenger', implemented: true, historicalPhysical: false },
  instagram: { provider: 'meta_instagram_messaging', implemented: true, historicalPhysical: false },
  sms: { provider: 'twilio', implemented: true, historicalPhysical: false },
  push: { provider: 'expo_push', implemented: true, historicalPhysical: false },
  in_app: { provider: 'in_app', implemented: true, historicalPhysical: false },
  web_chat: { provider: 'web_chat', implemented: true, historicalPhysical: false },
  mobile_chat: { provider: 'mobile_chat', implemented: true, historicalPhysical: false },
  line: { provider: 'line_messaging_api', implemented: false, historicalPhysical: false },
  x: { provider: 'x_dm_api', implemented: false, historicalPhysical: false },
} as const
export type CapabilityChannel = keyof typeof CHANNEL_IMPLEMENTATION
export type ChannelEvidence = {
  provider: string
  implemented: boolean
  historicallyPhysicallyCertified: boolean
  currentRuntimeConfigured: boolean
  currentRuntimeReady: boolean
  currentPhysicallyCertified: false
  publicLaunchEnabled: boolean
  states: CapabilityState[]
}
export type CommunicationCapability = {
  channels: Record<string, ChannelStatus>
  evidence?: Record<string, ChannelEvidence>
  unknown: boolean
}
export const UNKNOWN_CAPABILITY: CommunicationCapability = { channels: {}, unknown: true }
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}
export function readCommunicationCapability(health: unknown): CommunicationCapability {
  const comms = object(object(health).communications)
  if (!Array.isArray(comms.providers)) return UNKNOWN_CAPABILITY
  const rows = [...comms.providers, comms.marketingEmail].map(object)
  const outbound = object(comms.outbound)
  const workerReady = object(comms.scheduler).status === 'READY'
  const realAdapters = object(comms.fakeAdapters).enabled === false
  const externalAllowed = outbound.external_sends === 'enabled' && outbound.kill_switch === 'inactive'
  const evidence: Record<string, ChannelEvidence> = {}
  const channels: Record<string, ChannelStatus> = {}
  for (const [key, source] of Object.entries(CHANNEL_IMPLEMENTATION)) {
    const row = rows.find(item => item.channel === key)
    const internal = ['in_app', 'web_chat', 'mobile_chat'].includes(key)
    const configured = internal ? outbound.internal_channels === 'enabled'
      : row?.available === true && row?.status === 'READY' && row?.provider === source.provider
    const ready = configured && (internal || (workerReady && realAdapters && externalAllowed))
    // Current physical certification is a governed receipt, never inferred from configuration.
    const launch = internal && ready
    const states: CapabilityState[] = source.implemented ? ['IMPLEMENTED'] : ['PLANNED']
    if (source.historicalPhysical) states.push('HISTORICALLY_PHYSICALLY_CERTIFIED')
    if (configured) states.push('CURRENT_RUNTIME_CONFIGURED')
    if (ready) states.push('CURRENT_RUNTIME_READY')
    if (launch) states.push('PUBLIC_LAUNCH_ENABLED')
    if (source.implemented && !ready) states.push('TEMPORARILY_UNAVAILABLE')
    evidence[key] = {
      provider: source.provider, implemented: source.implemented,
      historicallyPhysicallyCertified: source.historicalPhysical,
      currentRuntimeConfigured: configured, currentRuntimeReady: ready,
      currentPhysicallyCertified: false, publicLaunchEnabled: launch, states,
    }
    channels[key] = ready ? 'available' : 'unavailable'
  }
  return { channels, evidence, unknown: false }
}
export function channelStatus(capability: CommunicationCapability, channel: string): ChannelStatus {
  return capability.unknown ? 'unknown' : capability.channels[channel] ?? 'unknown'
}
export function unavailableChannelNote(channel: string): string {
  return `${channel} is supported by CarUp but delivery is temporarily unavailable in this environment. Replies stay in CarUp.`
}
