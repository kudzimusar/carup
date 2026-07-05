import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProviderSmokeTestPanel } from './ProviderSmokeTestPanel'

describe('ProviderSmokeTestPanel', () => {
  it('prefills the recipient and refuses to imply fake success', () => {
    const html = renderToStaticMarkup(
      <ProviderSmokeTestPanel onSend={async () => ({ ok: true })} defaultRecipient="818081201356" />,
    )
    expect(html).toContain('818081201356')
    expect(html).toContain('Send WhatsApp smoke test')
    expect(html).toContain('refuses fake adapters')
  })
})
