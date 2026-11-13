/**
 * RX-02A S1-4B R3 — Focused-embed presentation containment for the remaining
 * auth pages (C3). The existing FocusedEmbedContext suppression (added for
 * Login in R2) now extends to Register, ForgotPassword, ResetPassword and
 * VerifyEmail:
 *
 *   · flag ON (beneath FocusedUnifiedShell): the page's own full-screen dark
 *     stage + duplicate brand block are suppressed — ONE chrome, ONE brand.
 *   · flag OFF (default): byte-identical legacy presentation.
 *
 * Every embed-mode assertion here FAILS against reviewed R2 HEAD (7454694a)
 * and PASSES on the corrected branch. Forms, validation, CSRF, token/expiry
 * and anti-enumeration flows are untouched — these tests assert presentation
 * containment only.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { FocusedEmbedContext } from '@/components/shell/FocusedEmbedContext'
import Register from './Register'
import ForgotPassword from './ForgotPassword'
import ResetPassword from './ResetPassword'
import VerifyEmail from './VerifyEmail'

/** The legacy brand block anchor shared by the auth pages (logo links home). */
const BRAND_ANCHOR = 'a[href="/"]'

function renderPage(element: React.ReactElement, embed: boolean, entry = '/page') {
  return render(
    <FocusedEmbedContext.Provider value={embed}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/page" element={element} />
        </Routes>
      </MemoryRouter>
    </FocusedEmbedContext.Provider>,
  )
}

describe('C3 — Register focused-embed containment', () => {
  it('legacy (flag OFF) renders the full dark stage, brand block and its heading', () => {
    const { container } = renderPage(<Register />, false)
    expect(container.querySelector(BRAND_ANCHOR)).not.toBeNull()
    expect(screen.getByText('Create your CarUp profile')).toBeInTheDocument()
    expect(container.firstElementChild!.className).toContain('min-h-screen')
  })

  it('embed (flag ON) suppresses the duplicate brand block and full-screen stage; the form remains', () => {
    const { container } = renderPage(<Register />, true)
    expect(container.querySelector(BRAND_ANCHOR)).toBeNull()
    expect(screen.queryByText('Create your CarUp profile')).toBeNull()
    expect(container.firstElementChild!.className).not.toContain('min-h-screen')
    // The REAL registration form is intact beneath the focused chrome.
    expect(screen.getByText(/Already have an account/)).toBeInTheDocument()
  })
})

describe('C3 — ForgotPassword focused-embed containment', () => {
  it('legacy renders the brand block and full-screen stage', () => {
    const { container } = renderPage(<ForgotPassword />, false)
    expect(container.querySelector(BRAND_ANCHOR)).not.toBeNull()
    expect(container.firstElementChild!.className).toContain('min-h-screen')
  })

  it('embed suppresses the duplicate brand/stage; the recovery form remains', () => {
    const { container } = renderPage(<ForgotPassword />, true)
    expect(container.querySelector(BRAND_ANCHOR)).toBeNull()
    expect(container.firstElementChild!.className).not.toContain('min-h-screen')
    expect(screen.getByTestId('forgot-password-form')).toBeInTheDocument()
  })
})

describe('C3 — ResetPassword focused-embed containment', () => {
  it('legacy renders the brand block and full-screen stage', () => {
    const { container } = renderPage(<ResetPassword />, false, '/page?token=test-token')
    expect(container.querySelector(BRAND_ANCHOR)).not.toBeNull()
    expect(container.firstElementChild!.className).toContain('min-h-screen')
  })

  it('embed suppresses the duplicate brand/stage; the reset form remains', () => {
    const { container } = renderPage(<ResetPassword />, true, '/page?token=test-token')
    expect(container.querySelector(BRAND_ANCHOR)).toBeNull()
    expect(container.firstElementChild!.className).not.toContain('min-h-screen')
    expect(screen.getByTestId('reset-password-form')).toBeInTheDocument()
  })
})

describe('C3 — VerifyEmail focused-embed containment', () => {
  it('legacy renders the full-screen stage', () => {
    const { container } = renderPage(<VerifyEmail />, false)
    expect(container.firstElementChild!.className).toContain('min-h-screen')
  })

  it('embed suppresses the full-screen stage; the verification states remain', () => {
    const { container } = renderPage(<VerifyEmail />, true)
    expect(container.firstElementChild!.className).not.toContain('min-h-screen')
    // No token: the honest 'unavailable' state renders synchronously beneath
    // the chrome (no network touched).
    expect(screen.getByTestId('verify-email-error')).toBeInTheDocument()
  })
})
