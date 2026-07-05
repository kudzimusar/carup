// Pure provider-health derivation for the Command Center (Phase 11 / docs §9).
// Registry-driven status: a fake adapter on a real provider is a problem, never success (docs §3);
// internal channels (in-app/web/mobile) are always Ready; planned channels are always Planned.

import type { ChannelDefinition } from '../channelRegistry'

export interface ProviderAdapterHealth {
  channel: string
  provider?: string
  mode?: string
  available?: boolean
  missing?: string[]
}

export type ProviderStatus = 'ready' | 'fake' | 'not_configured' | 'planned'

export function providerStatus(def: ChannelDefinition, adapter?: ProviderAdapterHealth): ProviderStatus {
  if (def.availability === 'planned') return 'planned'
  if (!def.supportsDiagnostics) return 'ready' // internal channels (in-app/web/mobile) are always available
  if (!adapter || adapter.available === false) return 'not_configured'
  if (String(adapter.mode) === 'fake') return 'fake'
  return 'ready'
}
