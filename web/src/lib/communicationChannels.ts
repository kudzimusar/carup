/**
 * Which delivery channels are actually operational (R10).
 *
 * Owner UAT: the inquiry form offered WhatsApp and Email as delivery choices while the backend
 * reported `communications: BLOCKED` for every provider. Choosing one implied a message would
 * arrive by that route; none could. Offering a channel the platform cannot use is a promise CarUp
 * does not keep, and the fix is not to hide the degradation but to stop asserting the capability.
 *
 * `/api/health` already publishes per-channel status, so capability is read rather than assumed.
 * In-app ("CarUp") is always offered: it is the reliable surface and needs no external provider.
 */
export type ChannelStatus = 'available' | 'unavailable' | 'unknown'

export type CommunicationCapability = {
  /** channel key → whether CarUp can currently deliver through it */
  channels: Record<string, ChannelStatus>
  /** true when the health read itself failed; nothing is claimed either way */
  unknown: boolean
}

export const UNKNOWN_CAPABILITY: CommunicationCapability = { channels: {}, unknown: true }

export function readCommunicationCapability(health: unknown): CommunicationCapability {
  if (!health || typeof health !== 'object') return UNKNOWN_CAPABILITY
  const comms = (health as { communications?: unknown }).communications
  if (!comms || typeof comms !== 'object') return UNKNOWN_CAPABILITY
  const providers = (comms as { providers?: unknown }).providers
  if (!Array.isArray(providers)) return UNKNOWN_CAPABILITY

  const channels: Record<string, ChannelStatus> = {}
  for (const entry of providers) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as { channel?: unknown; available?: unknown; status?: unknown }
    if (typeof row.channel !== 'string') continue
    channels[row.channel] = row.available === true || row.status === 'READY' ? 'available' : 'unavailable'
  }
  return { channels, unknown: Object.keys(channels).length === 0 }
}

export function channelStatus(capability: CommunicationCapability, channel: string): ChannelStatus {
  if (capability.unknown) return 'unknown'
  return capability.channels[channel] ?? 'unknown'
}

/** Wording for a channel CarUp cannot currently deliver through. Never silent. */
export function unavailableChannelNote(channel: string): string {
  return `${channel} delivery is not available right now — CarUp cannot send through it, so replies stay in CarUp.`
}
