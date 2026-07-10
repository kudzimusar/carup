import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProviderSmokeTestPanel, SmokeResultView, type SmokeSendResult } from './ProviderSmokeTestPanel'

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

  it('surfaces the sanitized Meta error (http/code/subcode/type/message/trace), not just HTTP 502', () => {
    const result: SmokeSendResult = {
      ok: false,
      error: 'smoke_test_failed',
      delivery: {
        error_code: 'invalid_credentials',
        provider_http_status: 401,
        provider_error_code: 190,
        provider_error_subcode: 463,
        provider_error_type: 'OAuthException',
        provider_error_message: 'Error validating access token: Session has expired.',
        provider_trace_id: 'AtraceZZZ',
      },
    }
    const html = renderToStaticMarkup(<SmokeResultView result={result} />)
    expect(html).toContain('Session has expired')           // the REAL Meta message
    expect(html).toContain('401')                           // http status
    expect(html).toContain('190')                           // Meta error code
    expect(html).toContain('463')                           // Meta error subcode
    expect(html).toContain('OAuthException')                // Meta error type
    expect(html).toContain('AtraceZZZ')                     // fbtrace_id
    expect(html).toContain('invalid_credentials')           // retry class retained
    expect(html).not.toContain('HTTP error! status: 502')   // no bare generic 502 label
  })

  it('never lets the failure detail overflow the narrow card horizontally', () => {
    const result: SmokeSendResult = {
      ok: false,
      delivery: { provider_http_status: 401, provider_error_message: 'x'.repeat(400), provider_trace_id: 'A'.repeat(120) },
    }
    const html = renderToStaticMarkup(<SmokeResultView result={result} />)
    // Overflow guards present: the container clips + long strings wrap character-by-character.
    expect(html).toContain('overflow-hidden')
    expect(html).toContain('min-w-0')
    expect(html).toContain('break-all')
  })
})
