import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { resetCommunicationCapabilityCache } from '@/hooks/useCommunicationCapability'
import { PublicCommunicationChannels } from './PublicCommunicationChannels'

const READY = { kill_switch: 'inactive', external_sends: 'enabled', internal_channels: 'enabled' }
const PAUSED = { kill_switch: 'active', external_sends: 'disabled', internal_channels: 'enabled' }
function health(outbound: Record<string, string>, telegramConfigured = false) {
  return { communications: {
    providers: [
      { channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', status: 'READY', available: true },
      { channel: 'telegram', provider: 'telegram_bot_api', status: telegramConfigured ? 'READY' : 'BLOCKED', available: telegramConfigured },
      { channel: 'email', provider: 'resend', status: 'READY', available: true },
    ],
    scheduler: { status: 'READY' }, fakeAdapters: { enabled: false }, outbound,
  } }
}
const statusOf = (channel: string) => screen.getByTestId(`channel-${channel}-status`).textContent

beforeEach(() => resetCommunicationCapabilityCache())
afterEach(() => vi.unstubAllGlobals())

describe('public channel availability (OC-LAUNCH R1)', () => {
  it('shows Checking while loading, then the real per-channel state', async () => {
    let resolve: (value: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { resolve = r })))
    render(<PublicCommunicationChannels />)
    expect(statusOf('whatsapp')).toBe('Checking…')
    resolve({ ok: true, json: async () => health(PAUSED) })
    await waitFor(() => expect(statusOf('whatsapp')).toBe('Temporarily unavailable'))
    expect(statusOf('telegram')).toBe('Setup pending')
    expect(statusOf('email')).toBe('Temporarily unavailable')
    // A supported channel is never described as something CarUp does not offer.
    expect(screen.getByTestId('public-communication-channels').textContent).toMatch(/CarUp supports WhatsApp/)
    expect(screen.getByTestId('public-communication-channels').textContent).not.toMatch(/not currently offered/i)
  })
  it('says Available when the runtime can deliver', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => health(READY, true) })))
    render(<PublicCommunicationChannels />)
    await waitFor(() => expect(statusOf('whatsapp')).toBe('Available'))
    expect(statusOf('telegram')).toBe('Available')
    expect(statusOf('email')).toBe('Available')
  })
  it('reports a failed read as Could not check rather than unavailable or offline-by-design', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    render(<PublicCommunicationChannels />)
    await waitFor(() => expect(statusOf('whatsapp')).toBe('Could not check'))
  })
})
