import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ContextRail } from './ContextRail'
import type { ContextIdentity, ContextPreferences, ContextRailProps, ContextReassignment } from './ContextRail'

const identity: ContextIdentity = {
  id: 'id-1',
  display_name: 'Grace Mensah',
  normalized_address: '+233201234567',
  channel: 'whatsapp',
  provider: 'twilio',
  verified: true,
  consent_status: 'opted_in',
}

const linked: ContextIdentity[] = [
  { id: 'id-2', channel: 'email', normalized_address: 'grace@example.com' },
  { id: 'id-3', channel: 'telegram', display_name: 'Grace M' },
]

const reassignmentHistory: ContextReassignment[] = [
  { at: '2026-07-05T10:00:00.000Z', summary: 'Reassigned to Sales', actor: 'Ama' },
  { at: '2026-07-04T09:00:00.000Z', summary: 'Auto-assigned by router', actor: 'system' },
]

const preferences: ContextPreferences = {
  preferred_channel: 'whatsapp',
  timezone: 'Africa/Accra',
  language: 'en',
  consent_status: 'granted',
  consent_version: '2.1',
  consented_at: '2026-07-01T08:00:00.000Z',
  whatsapp_enabled: true,
  telegram_enabled: false,
  email_enabled: true,
  sms_enabled: false,
  marketing_enabled: false,
}

const fullProps: ContextRailProps = {
  identity,
  linkedIdentities: linked,
  contextRefs: [
    { label: 'Listing', value: '2019 Toyota Corolla' },
    { label: 'Escrow', value: 'ESC-4821' },
  ],
  assignedLabel: 'Ama Boateng',
  team: 'Sales',
  reassignmentHistory,
  slaLabel: 'Breached 12m ago',
  slaState: 'breached',
  preferences,
  timeZone: 'UTC',
}

describe('ContextRail', () => {
  it('renders the identity card with an identity-first label, verified check, channel/provider and consent', () => {
    const html = renderToStaticMarkup(<ContextRail {...fullProps} />)
    expect(html).toContain('data-testid="context-identity"')
    expect(html).toContain('Customer')
    expect(html).toContain('Grace Mensah')
    // masked, never the raw number
    expect(html).not.toContain('+233201234567')
    expect(html).toContain('Verified')
    expect(html).toContain('Whatsapp')
    expect(html).toContain('Twilio')
    expect(html).toContain('data-testid="context-identity-consent"')
    expect(html).toContain('Opted In')
  })

  it('renders linked identities with masked addresses and omits the card when there are none', () => {
    const html = renderToStaticMarkup(<ContextRail {...fullProps} />)
    expect(html).toContain('data-testid="context-linked"')
    expect(html).toContain('data-testid="context-linked-row"')
    // email is masked, not raw
    expect(html).not.toContain('grace@example.com')
    expect(html).toContain('Telegram')

    const none = renderToStaticMarkup(<ContextRail identity={identity} />)
    expect(none).not.toContain('data-testid="context-linked"')
  })

  it('renders context refs as label:value rows and omits the card when empty', () => {
    const html = renderToStaticMarkup(<ContextRail {...fullProps} />)
    expect(html).toContain('data-testid="context-refs"')
    expect(html).toContain('Listing')
    expect(html).toContain('2019 Toyota Corolla')
    expect(html).toContain('Escrow')

    const none = renderToStaticMarkup(<ContextRail identity={identity} contextRefs={[]} />)
    expect(none).not.toContain('data-testid="context-refs"')
  })

  it('renders owner + reassignment timeline with visible timestamps', () => {
    const html = renderToStaticMarkup(<ContextRail {...fullProps} />)
    expect(html).toContain('data-testid="context-owner"')
    expect(html).toContain('Ama Boateng')
    expect(html).toContain('Sales')
    expect(html).toContain('data-testid="context-reassignment"')
    expect(html).toContain('Reassigned to Sales')
    expect(html).toContain('<time')
    expect(html).toContain('2026-07-05T10:00:00.000Z')

    const none = renderToStaticMarkup(<ContextRail identity={identity} />)
    expect(none).not.toContain('data-testid="context-owner"')
  })

  it('renders the SLA card with a tone that matches the state', () => {
    const breached = renderToStaticMarkup(<ContextRail identity={identity} slaState="breached" slaLabel="Breached 12m ago" />)
    expect(breached).toContain('data-testid="context-sla"')
    expect(breached).toContain('data-sla-state="breached"')
    expect(breached).toContain('text-red-700')
    expect(breached).toContain('Breached 12m ago')

    const paused = renderToStaticMarkup(<ContextRail identity={identity} slaState="paused" slaLabel="Paused" />)
    expect(paused).toContain('text-gray-500')

    const none = renderToStaticMarkup(<ContextRail identity={identity} />)
    expect(none).not.toContain('data-testid="context-sla"')
  })

  it('renders preferences with consent, preferred channel, locale and per-channel enabled badges; omits when null', () => {
    const html = renderToStaticMarkup(<ContextRail {...fullProps} />)
    expect(html).toContain('data-testid="context-preferences"')
    expect(html).toContain('data-testid="context-preferences-consent"')
    expect(html).toContain('Granted')
    expect(html).toContain('v2.1')
    expect(html).toContain('Africa/Accra')
    expect(html).toContain('data-testid="context-pref-channel"')
    // enabled + disabled channels both surface, with their state
    expect(html).toContain('data-channel="whatsapp"')
    expect(html).toContain('data-enabled="true"')
    expect(html).toContain('data-channel="telegram"')
    expect(html).toContain('data-enabled="false"')

    const none = renderToStaticMarkup(<ContextRail identity={identity} preferences={null} />)
    expect(none).not.toContain('data-testid="context-preferences"')
  })

  it('falls back to a masked address label when there is no display name and never leaks the raw address', () => {
    const anon: ContextIdentity = { id: 'x', channel: 'email', normalized_address: 'buyer@carup.io' }
    const html = renderToStaticMarkup(<ContextRail identity={anon} />)
    expect(html).toContain('data-testid="context-identity"')
    expect(html).not.toContain('buyer@carup.io')
    // masked email keeps the first character + tld
    expect(html).toContain('b•••')
  })
})
