import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readCommunicationCapability, UNKNOWN_CAPABILITY, type CommunicationCapability } from '@/lib/communicationChannels'

/**
 * CARUP-MVP-STAB-01 F-018 (web) — delivery preferences are read, never assumed, and a channel looks
 * operational only when the runtime can deliver on it.
 *
 * The owner page swallowed a failed read into `preferences: null`, rendering seven editable all-off
 * switches; saved the whole object with no error handling, so a failed save was silent; and offered
 * WhatsApp, SMS, Email and Push as working switches while the staging kill switch held every external
 * send. This mirrors the native D2 semantics (mobile/utils/communicationPreferences.ts): LOADING /
 * READY / READ_FAILED, no mutation before a successful read, single-key saves, failure stated.
 */

let capabilityState: { capability: CommunicationCapability; checking: boolean } = { capability: UNKNOWN_CAPABILITY, checking: true }
vi.mock('@/hooks/useCommunicationCapability', () => ({
  useCommunicationCapabilityState: () => capabilityState,
}))

const { DeliveryPreferencesCard } = await import('./DeliveryPreferencesCard')

/** /api/health communications block, as the channel-readiness tests build it. */
function health(overrides: Record<string, unknown> = {}) {
  return { communications: {
    providers: [
      { channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', status: 'READY', available: true },
      { channel: 'email', provider: 'resend', status: 'READY', available: true },
      { channel: 'sms', provider: 'twilio', status: 'READY', available: true },
      { channel: 'push', provider: 'expo_push', status: 'READY', available: true },
    ],
    marketingEmail: { channel: 'email_marketing', provider: 'brevo', status: 'READY', available: true },
    scheduler: { status: 'READY' }, fakeAdapters: { enabled: false },
    outbound: { kill_switch: 'inactive', external_sends: 'enabled', internal_channels: 'enabled' },
    ...overrides,
  } }
}
/** Staging today: providers configured, every external send held by the kill switch. */
const KILL_SWITCH = { outbound: { kill_switch: 'active', external_sends: 'disabled', internal_channels: 'enabled' } }

const STORED = {
  transactional_enabled: true,
  marketing_enabled: false,
  email_enabled: true,
  push_enabled: true,
  in_app_enabled: true,
  whatsapp_enabled: false,
  sms_enabled: false,
  telegram_enabled: false,
}

const read = vi.fn()
const save = vi.fn()

function renderCard() {
  return render(<DeliveryPreferencesCard read={read} save={save} />)
}
const sw = (key: string) => screen.getByTestId(`delivery-pref-${key}`)

beforeEach(() => {
  read.mockReset()
  save.mockReset()
  capabilityState = { capability: readCommunicationCapability(health(KILL_SWITCH)), checking: false }
})

describe('reading preferences (D2 on the web)', () => {
  it('while the read is pending: no switches, nothing to change', () => {
    read.mockReturnValue(new Promise(() => {}))
    renderCard()
    expect(screen.getByTestId('delivery-preferences-loading')).toBeTruthy()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
  })

  it('a failed read renders no switches — "could not be loaded" and Try again', async () => {
    read.mockRejectedValue(new Error('HTTP error! status: 500'))
    renderCard()

    const failed = await screen.findByTestId('delivery-preferences-read-failed')
    expect(failed.textContent).toContain('Delivery preferences could not be loaded.')
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(save).not.toHaveBeenCalled()

    read.mockResolvedValue({ preferences: STORED })
    await act(async () => { fireEvent.click(screen.getByTestId('delivery-preferences-retry')) })
    await waitFor(() => expect(screen.getAllByRole('switch').length).toBe(7))
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('a body without a preferences object is a failed read, not seven "off" switches', async () => {
    read.mockResolvedValue({ preferences: null })
    renderCard()
    expect(await screen.findByTestId('delivery-preferences-read-failed')).toBeTruthy()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
  })

  it('a successful read shows the values CarUp returned', async () => {
    read.mockResolvedValue({ preferences: STORED })
    renderCard()
    await waitFor(() => expect(sw('email_enabled')).toBeTruthy())
    expect(sw('transactional_enabled').getAttribute('aria-checked')).toBe('true')
    expect(sw('marketing_enabled').getAttribute('aria-checked')).toBe('false')
    expect(sw('email_enabled').getAttribute('aria-checked')).toBe('true')
  })
})

describe('only a channel the runtime can deliver on looks operational (F-018)', () => {
  it('kill switch active: no external channel can be turned on, every one says why — and any that is on can still be turned off', async () => {
    read.mockResolvedValue({ preferences: STORED })
    renderCard()
    await waitFor(() => expect(sw('email_enabled')).toBeTruthy())

    for (const key of ['email_enabled', 'push_enabled', 'whatsapp_enabled', 'sms_enabled']) {
      const note = screen.getByTestId(`delivery-pref-${key}-availability`).textContent
      expect(note, key).toContain('Temporarily unavailable')
      expect(note, key).toContain("CarUp isn't sending outside the app right now. Your messages stay in your CarUp Inbox.")
    }
    // OFF and unavailable: cannot be turned on.
    expect(sw('whatsapp_enabled')).toBeDisabled()
    expect(sw('sms_enabled')).toBeDisabled()
    // ON and unavailable: withdrawing is never blocked by provider readiness (lead decision).
    expect(sw('email_enabled')).not.toBeDisabled()
    expect(sw('push_enabled')).not.toBeDisabled()
    // In-app is internal: it is available while internal channels are enabled.
    expect(sw('in_app_enabled')).not.toBeDisabled()
    expect(screen.getByTestId('delivery-pref-in_app_enabled-availability').textContent).toContain('Available')
  })

  it('a channel with no connected provider says "Setup pending — Not set up for CarUp yet."', async () => {
    capabilityState = {
      capability: readCommunicationCapability(health({ ...KILL_SWITCH, providers: [{ channel: 'email', provider: 'resend', status: 'READY', available: true }] })),
      checking: false,
    }
    read.mockResolvedValue({ preferences: STORED })
    renderCard()
    await waitFor(() => expect(sw('sms_enabled')).toBeTruthy())

    expect(sw('sms_enabled')).toBeDisabled()
    expect(screen.getByTestId('delivery-pref-sms_enabled-availability').textContent).toBe('Setup pending — Not set up for CarUp yet.')
    expect(screen.getByTestId('delivery-pref-email_enabled-availability').textContent).toContain('Temporarily unavailable')
  })

  it('readiness could not be checked: no channel can be turned on, in-app included; those on can be turned off', async () => {
    capabilityState = { capability: UNKNOWN_CAPABILITY, checking: false }
    read.mockResolvedValue({ preferences: STORED })
    renderCard()
    await waitFor(() => expect(sw('in_app_enabled')).toBeTruthy())

    for (const key of ['in_app_enabled', 'email_enabled', 'push_enabled', 'whatsapp_enabled', 'sms_enabled']) {
      expect(screen.getByTestId(`delivery-pref-${key}-availability`).textContent, key)
        .toBe('Could not check — Could not check this channel right now.')
    }
    for (const key of ['whatsapp_enabled', 'sms_enabled']) expect(sw(key), key).toBeDisabled()
    for (const key of ['in_app_enabled', 'email_enabled', 'push_enabled']) expect(sw(key), key).not.toBeDisabled()
  })

  it('while readiness is still being checked, a channel that is off cannot be turned on', async () => {
    capabilityState = { capability: UNKNOWN_CAPABILITY, checking: true }
    read.mockResolvedValue({ preferences: STORED })
    renderCard()
    await waitFor(() => expect(sw('whatsapp_enabled')).toBeTruthy())
    expect(sw('whatsapp_enabled')).toBeDisabled()
    expect(screen.getByTestId('delivery-pref-whatsapp_enabled-availability').textContent).toContain('Checking')
    expect(sw('email_enabled')).not.toBeDisabled()
  })

  it('a runtime that can deliver offers the channel switches', async () => {
    capabilityState = { capability: readCommunicationCapability(health()), checking: false }
    read.mockResolvedValue({ preferences: STORED })
    renderCard()
    await waitFor(() => expect(sw('email_enabled')).toBeTruthy())
    for (const key of ['in_app_enabled', 'email_enabled', 'push_enabled', 'whatsapp_enabled', 'sms_enabled']) {
      expect(sw(key), key).not.toBeDisabled()
      expect(screen.getByTestId(`delivery-pref-${key}-availability`).textContent, key).toBe('Available')
    }
  })

  it('consent stays editable whatever the channels can do, and marketing is labelled consent only', async () => {
    capabilityState = { capability: UNKNOWN_CAPABILITY, checking: false }
    read.mockResolvedValue({ preferences: STORED })
    renderCard()
    await waitFor(() => expect(sw('marketing_enabled')).toBeTruthy())

    expect(sw('transactional_enabled')).not.toBeDisabled()
    expect(sw('marketing_enabled')).not.toBeDisabled()
    const consent = screen.getByTestId('delivery-preferences-consent')
    expect(consent.textContent).toMatch(/Consent/)
    expect(within(consent).getByText(/consent only/i)).toBeTruthy()
  })

  it('offers no Facebook or Instagram toggle', async () => {
    capabilityState = { capability: readCommunicationCapability(health()), checking: false }
    read.mockResolvedValue({ preferences: { ...STORED, facebook_enabled: true, instagram_enabled: true } })
    const { container } = renderCard()
    await waitFor(() => expect(sw('email_enabled')).toBeTruthy())
    expect(container.textContent).not.toMatch(/facebook|instagram/i)
    expect(screen.getAllByRole('switch')).toHaveLength(7)
  })
})

describe('saving a change (single key, failure stated)', () => {
  it('sends ONLY the preference that changed, and shows the confirmed value', async () => {
    read.mockResolvedValue({ preferences: STORED })
    save.mockResolvedValue({ preferences: { ...STORED, marketing_enabled: true } })
    renderCard()
    await waitFor(() => expect(sw('marketing_enabled')).toBeTruthy())

    await act(async () => { fireEvent.click(sw('marketing_enabled')) })

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ marketing_enabled: true })
    await waitFor(() => expect(sw('marketing_enabled').getAttribute('aria-checked')).toBe('true'))
    expect(screen.getByTestId('delivery-preferences-status').textContent).toBe('Preference saved.')
  })

  it('a failed save is stated, and the switch keeps the last value CarUp confirmed', async () => {
    read.mockResolvedValue({ preferences: STORED })
    save.mockRejectedValue(new Error('HTTP error! status: 503'))
    renderCard()
    await waitFor(() => expect(sw('transactional_enabled')).toBeTruthy())

    await act(async () => { fireEvent.click(sw('transactional_enabled')) })

    await waitFor(() => expect(screen.getByTestId('delivery-preferences-status').textContent).toBe('Preferences were not saved. Try again.'))
    expect(sw('transactional_enabled').getAttribute('aria-checked')).toBe('true')
  })

  it('a save CarUp did not confirm is not reported as saved', async () => {
    read.mockResolvedValue({ preferences: STORED })
    save.mockResolvedValue({ preferences: { ...STORED, marketing_enabled: false } })
    renderCard()
    await waitFor(() => expect(sw('marketing_enabled')).toBeTruthy())

    await act(async () => { fireEvent.click(sw('marketing_enabled')) })

    await waitFor(() => expect(screen.getByTestId('delivery-preferences-status').textContent).toBe('Preferences were not saved. Try again.'))
    expect(sw('marketing_enabled').getAttribute('aria-checked')).toBe('false')
  })

  // Lead decision (CARUP-MVP-STAB-01): turning a channel OFF is never blocked by provider readiness.
  it('on → off while the channel is unavailable is allowed, sent, and then cannot be turned back on', async () => {
    read.mockResolvedValue({ preferences: STORED })
    save.mockResolvedValue({ preferences: { ...STORED, email_enabled: false } })
    renderCard()
    await waitFor(() => expect(sw('email_enabled')).toBeTruthy())
    expect(sw('email_enabled').getAttribute('aria-checked')).toBe('true')
    expect(sw('email_enabled')).not.toBeDisabled()

    await act(async () => { fireEvent.click(sw('email_enabled')) })

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ email_enabled: false })
    await waitFor(() => expect(sw('email_enabled').getAttribute('aria-checked')).toBe('false'))
    expect(screen.getByTestId('delivery-preferences-status').textContent).toBe('Preference saved.')
    // Now OFF and still unavailable: it cannot be switched back on, and still says why.
    expect(sw('email_enabled')).toBeDisabled()
    expect(screen.getByTestId('delivery-pref-email_enabled-availability').textContent).toContain('Temporarily unavailable')
  })

  it('off → on while the channel is unavailable is refused: the switch is inoperable and nothing is sent', async () => {
    read.mockResolvedValue({ preferences: STORED })
    renderCard()
    await waitFor(() => expect(sw('whatsapp_enabled')).toBeTruthy())
    expect(sw('whatsapp_enabled').getAttribute('aria-checked')).toBe('false')
    expect(sw('whatsapp_enabled')).toBeDisabled()

    await act(async () => { fireEvent.click(sw('whatsapp_enabled')) })

    expect(save).not.toHaveBeenCalled()
    expect(sw('whatsapp_enabled').getAttribute('aria-checked')).toBe('false')
  })
})
