import { describe, expect, it, vi } from 'vitest'
import { readCommunicationCapability, UNKNOWN_CAPABILITY } from '@/lib/communicationChannels'
import {
  channelControl,
  channelSwitchOperable,
  preferenceRefusalCopy,
  savePreferenceChange,
  type PreferenceView,
} from './deliveryPreferences'

/**
 * CARUP-MVP-STAB-01 F-018 — the save path on its own.
 *
 * The card disables a switch that cannot be turned on, so a card-level test cannot tell whether the
 * save path ALSO refuses (a disabled control masks a missing second line of defence). These call
 * `savePreferenceChange` directly.
 *
 * Lead decision: turning a channel OFF is always allowed — consent withdrawal is never blocked by
 * provider readiness; turning one ON is allowed only while `channelAvailability` says `available`.
 */
const PAUSED = readCommunicationCapability({ communications: {
  providers: [
    { channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', status: 'READY', available: true },
    { channel: 'email', provider: 'resend', status: 'READY', available: true },
  ],
  marketingEmail: {},
  scheduler: { status: 'READY' }, fakeAdapters: { enabled: false },
  outbound: { kill_switch: 'active', external_sends: 'disabled', internal_channels: 'enabled' },
} })
const LIVE = readCommunicationCapability({ communications: {
  providers: [
    { channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', status: 'READY', available: true },
    { channel: 'email', provider: 'resend', status: 'READY', available: true },
  ],
  marketingEmail: {},
  scheduler: { status: 'READY' }, fakeAdapters: { enabled: false },
  outbound: { kill_switch: 'inactive', external_sends: 'enabled', internal_channels: 'enabled' },
} })

const READY: PreferenceView = { state: 'ready', preferences: { whatsapp_enabled: true, email_enabled: false, marketing_enabled: false } }

describe('savePreferenceChange — the one save path (F-018)', () => {
  it('refuses to ENABLE an unavailable channel, and sends nothing', async () => {
    const save = vi.fn()
    for (const capability of [PAUSED, UNKNOWN_CAPABILITY]) {
      const result = await savePreferenceChange({ view: READY, key: 'email_enabled', value: true, capability, save })
      expect(result).toEqual({ outcome: 'refused', reason: 'channel_unavailable' })
    }
    const checking = await savePreferenceChange({ view: READY, key: 'email_enabled', value: true, capability: LIVE, checking: true, save })
    expect(checking).toEqual({ outcome: 'refused', reason: 'channel_unavailable' })
    expect(save).not.toHaveBeenCalled()
  })

  it('always sends DISABLING a channel, whatever its availability', async () => {
    for (const capability of [PAUSED, UNKNOWN_CAPABILITY]) {
      const save = vi.fn().mockResolvedValue({ preferences: { whatsapp_enabled: false } })
      const result = await savePreferenceChange({ view: READY, key: 'whatsapp_enabled', value: false, capability, save })
      expect(save).toHaveBeenCalledWith({ whatsapp_enabled: false })
      expect(result).toMatchObject({ outcome: 'saved', preferences: { whatsapp_enabled: false, email_enabled: false } })
    }
  })

  it('enables an available channel, sending only that key', async () => {
    const save = vi.fn().mockResolvedValue({ preferences: { email_enabled: true } })
    const result = await savePreferenceChange({ view: READY, key: 'email_enabled', value: true, capability: LIVE, save })
    expect(save).toHaveBeenCalledWith({ email_enabled: true })
    expect(result).toMatchObject({ outcome: 'saved', preferences: { email_enabled: true, whatsapp_enabled: true } })
  })

  it('consent can be given or withdrawn whatever the channels can do', async () => {
    for (const value of [true, false]) {
      const save = vi.fn().mockResolvedValue({ preferences: { marketing_enabled: value } })
      const result = await savePreferenceChange({ view: READY, key: 'marketing_enabled', value, capability: UNKNOWN_CAPABILITY, save })
      expect(save).toHaveBeenCalledWith({ marketing_enabled: value })
      expect(result.outcome).toBe('saved')
    }
  })

  it('refuses before the current values were read (D2)', async () => {
    const save = vi.fn()
    for (const view of [{ state: 'loading' }, { state: 'read_failed' }] as PreferenceView[]) {
      expect(await savePreferenceChange({ view, key: 'whatsapp_enabled', value: false, capability: LIVE, save }))
        .toEqual({ outcome: 'refused', reason: 'not_read' })
    }
    expect(save).not.toHaveBeenCalled()
  })

  it('refuses a preference this page does not offer (Telegram, Facebook, Instagram)', async () => {
    const save = vi.fn()
    for (const key of ['telegram_enabled', 'facebook_enabled', 'instagram_enabled']) {
      expect(await savePreferenceChange({ view: READY, key, value: true, capability: LIVE, save }))
        .toEqual({ outcome: 'refused', reason: 'not_offered' })
    }
    expect(save).not.toHaveBeenCalled()
  })

  it('a failed request or an answer without preferences is "failed"; an unconfirmed answer is "not_confirmed"', async () => {
    expect(await savePreferenceChange({ view: READY, key: 'marketing_enabled', value: true, capability: LIVE, save: vi.fn().mockRejectedValue(new Error('503')) }))
      .toEqual({ outcome: 'failed' })
    expect(await savePreferenceChange({ view: READY, key: 'marketing_enabled', value: true, capability: LIVE, save: vi.fn().mockResolvedValue({}) }))
      .toEqual({ outcome: 'failed' })
    expect(await savePreferenceChange({ view: READY, key: 'marketing_enabled', value: true, capability: LIVE, save: vi.fn().mockResolvedValue({ preferences: { marketing_enabled: false } }) }))
      .toMatchObject({ outcome: 'not_confirmed', preferences: { marketing_enabled: false } })
  })
})

describe('which channel switches can be operated', () => {
  it('ON is always operable; OFF only while available', () => {
    const paused = channelControl(PAUSED, 'email')
    const live = channelControl(LIVE, 'email')
    expect(paused.canEnable).toBe(false)
    expect(live.canEnable).toBe(true)
    expect(channelSwitchOperable(paused, true)).toBe(true)
    expect(channelSwitchOperable(paused, false)).toBe(false)
    expect(channelSwitchOperable(live, false)).toBe(true)
  })

  it('a refused enable says what to do instead', () => {
    expect(preferenceRefusalCopy('channel_unavailable', 'WhatsApp'))
      .toBe("WhatsApp can't be turned on until it is available. You can turn it off at any time.")
  })
})
