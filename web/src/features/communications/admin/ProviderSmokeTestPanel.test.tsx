import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProviderSmokeTestPanel } from './ProviderSmokeTestPanel'

describe('ProviderSmokeTestPanel', () => {
  it('starts with a blank recipient, states environment/provider, and requires confirmation', () => {
    const html = renderToStaticMarkup(<ProviderSmokeTestPanel onSend={async () => ({ ok: true })} environmentLabel="staging.example" />)
    expect(html).toContain('Send WhatsApp smoke test')
    expect(html).toContain('refuses fake adapters')
    expect(html).toContain('meta_whatsapp_cloud_api')
    expect(html).toContain('staging.example')
    expect(html).toContain('I confirm sending a real message')
    // No personal number is baked into the default value.
    expect(html).not.toContain('818081201356')
    // The send button is disabled until a recipient + confirmation are supplied.
    expect(html).toMatch(/Send WhatsApp smoke test<\/button>/)
    expect(html).toContain('disabled')
  })
})
