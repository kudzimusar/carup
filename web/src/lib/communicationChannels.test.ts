import { describe, it, expect } from 'vitest'
import { CHANNEL_IMPLEMENTATION, readCommunicationCapability } from './communicationChannels'

function health(overrides: Record<string, unknown> = {}) {
  return { communications: {
    providers: [{ channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', status: 'READY', available: true },
      { channel: 'email', provider: 'resend', status: 'READY', available: true }],
    marketingEmail: { channel: 'email_marketing', provider: 'brevo', status: 'READY', available: true },
    scheduler: { status: 'READY' }, fakeAdapters: { enabled: false },
    outbound: { kill_switch: 'inactive', external_sends: 'enabled', internal_channels: 'enabled' },
    ...overrides,
  } }
}
describe('launch capability evidence', () => {
  it('keeps implementation, historical delivery and current certification distinct', () => {
    const capability = readCommunicationCapability(health())
    expect(capability.evidence?.whatsapp.states).toContain('HISTORICALLY_PHYSICALLY_CERTIFIED')
    expect(capability.evidence?.whatsapp.currentRuntimeReady).toBe(true)
    expect(capability.evidence?.whatsapp.currentPhysicallyCertified).toBe(false)
    expect(capability.evidence?.whatsapp.publicLaunchEnabled).toBe(false)
    expect(capability.evidence?.in_app.publicLaunchEnabled).toBe(true)
  })
  it('separates transactional Resend from marketing Brevo without fallback', () => {
    const capability = readCommunicationCapability(health())
    expect(capability.evidence?.email.provider).toBe('resend')
    expect(capability.evidence?.email_marketing.provider).toBe('brevo')
    expect(readCommunicationCapability(health({ marketingEmail: {} })).channels.email_marketing).toBe('unavailable')
  })
  it.each([
    { outbound: { kill_switch: 'active', external_sends: 'disabled', internal_channels: 'enabled' } },
    { scheduler: { status: 'BLOCKED' } }, { scheduler: undefined },
    { fakeAdapters: { enabled: true } }, { fakeAdapters: undefined },
    { providers: [{ channel: 'whatsapp', provider: 'fake', status: 'READY', available: true }] },
  ])('fails closed for a blocked or unproven runtime: %j', overrides => {
    const capability = readCommunicationCapability(health(overrides))
    expect(capability.channels.whatsapp).toBe('unavailable')
    expect(capability.evidence?.whatsapp.implemented).toBe(true)
    expect(capability.evidence?.whatsapp.historicallyPhysicallyCertified).toBe(true)
  })
  it('does not imply that missing health means a nonexistent capability', () => {
    expect(readCommunicationCapability(null).unknown).toBe(true)
    expect(CHANNEL_IMPLEMENTATION.telegram.historicalPhysical).toBe(true)
    expect(CHANNEL_IMPLEMENTATION.line.implemented).toBe(false)
  })
})
