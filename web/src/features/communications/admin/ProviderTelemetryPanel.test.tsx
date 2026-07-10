import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProviderTelemetryPanel } from './ProviderTelemetryPanel'

describe('ProviderTelemetryPanel', () => {
  it('renders per-channel telemetry: mode, webhook, queue counts, latest error, missing creds', () => {
    const html = renderToStaticMarkup(
      <ProviderTelemetryPanel
        staleLocks={2}
        channels={[
          {
            channel: 'whatsapp', provider: 'meta_whatsapp_cloud_api', mode: 'real', available: true,
            webhook: { configured: true, last_signature_valid: true, latest_inbound_at: '2026-07-05T11:00:00.000Z' },
            outbound: { latest_success_at: '2026-07-05T11:31:00.000Z', latest_success_provider_message_id: 'wamid.OK' },
            latest_error: { at: '2026-07-05T11:45:00.000Z', code: 'invalid_recipient', message: 'bad number' },
            queue: { queued: 1, retry_scheduled: 0, dead_letter: 2 },
            credentials: { complete: true, missing: [] },
          },
          {
            channel: 'telegram', provider: 'telegram_bot_api', mode: 'fake', available: false,
            webhook: { configured: false }, queue: { queued: 0, retry_scheduled: 3, dead_letter: 0 },
            credentials: { complete: false, missing: ['CARUP_TELEGRAM_BOT_TOKEN'] },
          },
        ]}
      />,
    )
    expect(html).toContain('Provider operations')
    expect(html).toContain('2 stale locks')
    expect(html).toContain('data-channel-key="whatsapp"')
    expect(html).toContain('Ready')
    expect(html).toContain('Configured')
    expect(html).toContain('1 / 0 / 2')                 // queue / retry / DLQ
    expect(html).toContain('invalid_recipient')
    // Fake adapter surfaced as a problem, and missing credential NAME shown (never a value).
    expect(html).toContain('Fake — no live send')
    expect(html).toContain('CARUP_TELEGRAM_BOT_TOKEN')
    expect(html).toContain('3 / 0') // telegram retry count
  })

  it('renders an empty state', () => {
    expect(renderToStaticMarkup(<ProviderTelemetryPanel channels={[]} />)).toContain('No provider telemetry.')
  })
})
