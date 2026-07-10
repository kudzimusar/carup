import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  CHANNELS, CHANNEL_ORDER, channelLabel, getChannel,
  normalizeChannelKey, orderedChannels, providerLabel,
} from './channelRegistry'
import { ChannelIcon } from './ChannelIcon'

describe('channelRegistry', () => {
  it('resolves known channels case-insensitively and falls back for unknown', () => {
    expect(getChannel('whatsapp').providerLabel).toBe('meta_whatsapp_cloud_api')
    expect(getChannel('WhatsApp ').providerLabel).toBe('meta_whatsapp_cloud_api')
    expect(getChannel('telegram').providerLabel).toBe('telegram_bot_api')
    expect(getChannel('does_not_exist').key).toBe('unknown')
    expect(getChannel(null).label).toBe('Unknown channel')
    expect(normalizeChannelKey(' TELEGRAM ')).toBe('telegram')
  })

  it('every channel has a label, provider, brand color and identity format', () => {
    for (const def of Object.values(CHANNELS)) {
      expect(def.label.length).toBeGreaterThan(0)
      expect(def.providerLabel.length).toBeGreaterThan(0)
      expect(def.brandColor).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(def.identityFormat).toBeTruthy()
    }
  })

  it('orders every channel exactly once in the rail order', () => {
    expect(CHANNEL_ORDER.length).toBe(Object.keys(CHANNELS).length)
    expect(new Set(CHANNEL_ORDER).size).toBe(CHANNEL_ORDER.length)
    expect(orderedChannels().map((c) => c.key)).toEqual(CHANNEL_ORDER)
  })

  it('marks LINE and X as planned and configured channels as available', () => {
    expect(getChannel('line').availability).toBe('planned')
    expect(getChannel('x').availability).toBe('planned')
    expect(getChannel('whatsapp').availability).toBe('available')
  })

  it('maps Meta webhook paths per the plan', () => {
    expect(getChannel('whatsapp').webhookPath).toBe('/api/communications/webhooks/meta/whatsapp')
    expect(getChannel('facebook').webhookPath).toBe('/api/communications/webhooks/meta/facebook')
    expect(getChannel('instagram').webhookPath).toBe('/api/communications/webhooks/meta/instagram')
    expect(getChannel('push').webhookPath).toBeNull()
  })

  it('renders an accessible, channel-labelled icon (not color-alone)', () => {
    const html = renderToStaticMarkup(<ChannelIcon channel="whatsapp" />)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="WhatsApp"')
    expect(html).toContain('data-channel="whatsapp"')
  })

  it('supports a decorative icon with no redundant label', () => {
    const html = renderToStaticMarkup(<ChannelIcon channel="telegram" decorative />)
    // The wrapper is aria-hidden (hiding the whole subtree) and carries no redundant aria-label.
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('aria-label')
    expect(html).toContain('data-channel="telegram"')
  })

  it('exposes helper label accessors', () => {
    expect(channelLabel('sms')).toBe('SMS')
    expect(providerLabel('email')).toBe('sendgrid')
  })
})
