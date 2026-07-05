import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProviderHealthPanel } from './ProviderHealthPanel'
import { providerStatus } from './providerHealth'
import { getChannel } from '../channelRegistry'

describe('providerStatus', () => {
  it('is Ready for a configured real provider', () => {
    expect(providerStatus(getChannel('whatsapp'), { channel: 'whatsapp', mode: 'real', available: true })).toBe('ready')
  })
  it('is Not configured when the real adapter is unavailable', () => {
    expect(providerStatus(getChannel('whatsapp'), { channel: 'whatsapp', mode: 'real', available: false })).toBe('not_configured')
    expect(providerStatus(getChannel('sms'), undefined)).toBe('not_configured')
  })
  it('flags a fake adapter on a real provider (never success)', () => {
    expect(providerStatus(getChannel('whatsapp'), { channel: 'whatsapp', mode: 'fake', available: true })).toBe('fake')
  })
  it('treats internal channels as Ready even when their adapter is fake', () => {
    expect(providerStatus(getChannel('in_app'), { channel: 'in_app', mode: 'fake', available: true })).toBe('ready')
  })
  it('marks planned channels as Planned regardless of adapter', () => {
    expect(providerStatus(getChannel('line'), undefined)).toBe('planned')
    expect(providerStatus(getChannel('x'), undefined)).toBe('planned')
  })
})

describe('ProviderHealthPanel', () => {
  it('renders every channel with real brand labels and statuses, incl. planned + missing', () => {
    const html = renderToStaticMarkup(
      <ProviderHealthPanel
        adapters={[
          { channel: 'whatsapp', mode: 'real', available: true },
          { channel: 'email', mode: 'real', available: false, missing: ['SENDGRID_API_KEY'] },
        ]}
      />,
    )
    expect(html).toContain('WhatsApp')
    expect(html).toContain('Ready')
    expect(html).toContain('LINE') // planned channel still visible
    expect(html).toContain('Planned')
    expect(html).toContain('Not configured')
    expect(html).toContain('SENDGRID_API_KEY') // missing creds surfaced
  })
})
