import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsView, type SettingsSlaPolicy } from './SettingsView'

const policies: SettingsSlaPolicy[] = [
  {
    id: 'p1', name: 'WhatsApp priority', channel: 'whatsapp', priority: 'high',
    first_response_minutes: 15, next_response_minutes: 30, resolution_minutes: 240,
    business_timezone: 'Africa/Harare', active: true,
  },
  {
    id: 'p2', name: 'Default policy', channel: null, priority: null,
    first_response_minutes: null, next_response_minutes: null, resolution_minutes: 1440,
    business_timezone: null, active: false,
  },
]

const render = (props: Partial<Parameters<typeof SettingsView>[0]> = {}) =>
  renderToStaticMarkup(
    <SettingsView
      policies={policies}
      idlePollSeconds={30}
      deliveryPollSeconds={10}
      defaultQueue="general_support"
      {...props}
    />,
  )

describe('SettingsView', () => {
  it('marks the surface read-only and explains configuration is platform-managed', () => {
    const html = render()
    expect(html).toContain('data-testid="settings-view"')
    expect(html).toContain('Read only')
    expect(html).toContain('managed by the platform')
    expect(html).toContain('intentionally deferred')
  })

  it('renders the SLA policies table with channel, priority, minutes, timezone and active state', () => {
    const html = render()
    expect(html).toContain('data-testid="settings-sla-policies"')
    expect(html).toContain('WhatsApp priority')
    expect(html).toContain('High') // title-cased priority
    expect(html).toContain('15m') // first response minutes
    expect(html).toContain('240m') // resolution minutes
    expect(html).toContain('Africa/Harare')
    expect(html).toContain('Active')
    expect(html).toContain('Inactive')
    expect(html).toContain('All channels') // null channel => applies everywhere
  })

  it('shows an empty state and no table when there are no policies', () => {
    const html = render({ policies: [] })
    expect(html).toContain('No SLA policies configured for this tenant.')
    expect(html).not.toContain('data-testid="settings-sla-policies"')
  })

  it('shows operational cadences and the title-cased default queue', () => {
    const html = render({ idlePollSeconds: 45, deliveryPollSeconds: 8, defaultQueue: 'general_support' })
    expect(html).toContain('data-testid="settings-operational"')
    expect(html).toContain('Every 45s')
    expect(html).toContain('Every 8s')
    expect(html).toContain('General Support') // titleCase('general_support')
  })
})
