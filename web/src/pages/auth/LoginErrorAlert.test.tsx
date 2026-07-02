import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LoginErrorAlert } from './LoginErrorAlert'
import { loginError, LOGIN_ERROR_MESSAGES } from './loginError'

describe('LoginErrorAlert', () => {
  it('renders nothing when there is no error (cleared state)', () => {
    expect(renderToStaticMarkup(<LoginErrorAlert error={null} />)).toBe('')
  })

  it('exposes an assertive alert live region for screen readers', () => {
    const html = renderToStaticMarkup(
      <LoginErrorAlert error={loginError('invalid_credentials')} />,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('aria-live="assertive"')
    expect(html).toContain('aria-atomic="true"')
  })

  it('renders an icon alongside the message', () => {
    const html = renderToStaticMarkup(
      <LoginErrorAlert error={loginError('server_error')} />,
    )
    // lucide-react renders an inline <svg> icon.
    expect(html).toContain('<svg')
  })

  it('renders the distinct message for each failure kind', () => {
    expect(
      renderToStaticMarkup(<LoginErrorAlert error={loginError('invalid_credentials')} />),
    ).toContain(LOGIN_ERROR_MESSAGES.invalid_credentials)
    expect(
      renderToStaticMarkup(<LoginErrorAlert error={loginError('backend_unavailable')} />),
    ).toContain(LOGIN_ERROR_MESSAGES.backend_unavailable)
    expect(
      renderToStaticMarkup(<LoginErrorAlert error={loginError('server_error')} />),
    ).toContain(LOGIN_ERROR_MESSAGES.server_error)
  })

  it('tags the alert with the error kind for diagnostics', () => {
    const html = renderToStaticMarkup(
      <LoginErrorAlert error={loginError('backend_unavailable')} />,
    )
    expect(html).toContain('data-error-kind="backend_unavailable"')
  })
})
