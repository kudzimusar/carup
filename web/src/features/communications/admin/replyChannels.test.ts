import { describe, expect, it } from 'vitest'
import { defaultReplyChannel, deliverableReplyChannels, resolveReplyChannel } from './replyChannels'

const inbound = (channel: string, at: string) => ({ direction: 'inbound', channel, created_at: at })
const outbound = (channel: string, at: string) => ({ direction: 'outbound', channel, created_at: at })

// The frozen OC-LAUNCH thread 61acc236: began in-app, primary_channel = in_app, and the customer's
// latest message arrived on WhatsApp from a participant with a real, consented WhatsApp identity.
const mixedWhatsApp = {
  thread: { primary_user_id: 'u-1', primary_channel: 'in_app' },
  identities: [{ channel: 'whatsapp', consent_status: 'implied_transactional' }],
  messages: [inbound('in_app', '2026-08-12T07:59:35Z'), outbound('whatsapp', '2026-08-14T17:02:27Z'), inbound('whatsapp', '2026-10-12T09:42:48Z')],
}

describe('deliverableReplyChannels', () => {
  it('offers the participant identity channels plus in-app for a thread with a primary user', () => {
    expect(deliverableReplyChannels(mixedWhatsApp)).toEqual(['whatsapp', 'in_app'])
  })

  it('never offers a channel the thread has no identity for, nor one whose consent is withdrawn', () => {
    const channels = deliverableReplyChannels({
      thread: { primary_user_id: 'u-1' },
      identities: [{ channel: 'telegram', consent_status: 'opted_out' }, { channel: 'email', consent_status: 'revoked' }, { channel: 'WhatsApp', consent_status: null }],
    })
    expect(channels).toEqual(['whatsapp', 'in_app'])
    expect(channels).not.toContain('telegram')
    expect(channels).not.toContain('email')
    expect(channels).not.toContain('sms')
  })

  it('offers no in-app reply when the thread has no primary user to address it to', () => {
    expect(deliverableReplyChannels({ thread: { primary_user_id: null }, identities: [{ channel: 'telegram' }] })).toEqual(['telegram'])
    expect(deliverableReplyChannels({ thread: {}, identities: [] })).toEqual([])
  })

  it('lists each channel once', () => {
    expect(deliverableReplyChannels({ thread: {}, identities: [{ channel: 'whatsapp' }, { channel: 'whatsapp' }] })).toEqual(['whatsapp'])
  })
})

describe('defaultReplyChannel', () => {
  it('mixed in-app + WhatsApp thread defaults to WhatsApp (the customer wrote there last)', () => {
    const channels = deliverableReplyChannels(mixedWhatsApp)
    expect(defaultReplyChannel({ channels, messages: mixedWhatsApp.messages, primaryChannel: 'in_app' })).toBe('whatsapp')
  })

  it('mixed in-app + Telegram thread defaults to Telegram', () => {
    const channels = deliverableReplyChannels({ thread: { primary_user_id: 'u-1' }, identities: [{ channel: 'telegram' }] })
    const messages = [inbound('in_app', '2026-10-01T00:00:00Z'), inbound('telegram', '2026-10-02T00:00:00Z')]
    expect(defaultReplyChannel({ channels, messages, primaryChannel: 'in_app' })).toBe('telegram')
  })

  it('follows the LATEST customer inbound, not message order and not outbound traffic', () => {
    const channels = ['whatsapp', 'telegram', 'in_app']
    const messages = [inbound('telegram', '2026-10-05T00:00:00Z'), inbound('whatsapp', '2026-10-01T00:00:00Z'), outbound('whatsapp', '2026-10-09T00:00:00Z')]
    expect(defaultReplyChannel({ channels, messages, primaryChannel: 'in_app' })).toBe('telegram')
  })

  it('ignores an inbound on a channel that is not deliverable, then falls back to a deliverable primary channel', () => {
    const messages = [inbound('sms', '2026-10-09T00:00:00Z')]
    expect(defaultReplyChannel({ channels: ['in_app'], messages, primaryChannel: 'in_app' })).toBe('in_app')
  })

  it('in-app-only thread still replies in-app', () => {
    const channels = deliverableReplyChannels({ thread: { primary_user_id: 'u-1' }, identities: [] })
    expect(channels).toEqual(['in_app'])
    expect(defaultReplyChannel({ channels, messages: [inbound('in_app', '2026-10-01T00:00:00Z')], primaryChannel: 'in_app' })).toBe('in_app')
  })

  it('never falls back to a primary channel that is not deliverable', () => {
    expect(defaultReplyChannel({ channels: ['telegram'], messages: [], primaryChannel: 'in_app' })).toBe('telegram')
    expect(defaultReplyChannel({ channels: [], messages: [inbound('whatsapp', '2026-10-01T00:00:00Z')], primaryChannel: 'whatsapp' })).toBeNull()
  })
})

describe('resolveReplyChannel', () => {
  it('an explicit agent choice wins while it is deliverable', () => {
    const channels = deliverableReplyChannels(mixedWhatsApp)
    expect(resolveReplyChannel({ choice: 'in_app', channels, messages: mixedWhatsApp.messages, primaryChannel: 'in_app' })).toBe('in_app')
  })

  it('a choice that is not deliverable is ignored in favour of the derived default', () => {
    const channels = deliverableReplyChannels(mixedWhatsApp)
    expect(resolveReplyChannel({ choice: 'telegram', channels, messages: mixedWhatsApp.messages, primaryChannel: 'in_app' })).toBe('whatsapp')
  })
})
