/**
 * RX03-AUTH-FOCUSED-IDENTITY-RECONCILIATION-01 — the RX-03 account stage and sign-in form.
 * One credential path (the real CSRF-bound POST /auth/login), no demo access, no inert controls,
 * one logo / one heading, and the stage only under the showroom chrome (flags OFF: legacy card).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const login = vi.fn()
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, token: null, isAuthenticated: false, loading: false, login, logout: () => {}, switchRole: async () => {} }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import Login from '@/pages/auth/Login'
import Register from '@/pages/auth/Register'
import ForgotPassword from '@/pages/auth/ForgotPassword'
import ResetPassword from '@/pages/auth/ResetPassword'
import VerifyEmail from '@/pages/auth/VerifyEmail'
import MainLayout from '@/components/layout/MainLayout'
import { focusedTaskFor } from '@/components/shell/focusedTitles'

// Comments are stripped: #272's removal note names what it removed; a sentence naming a defect is not
// the defect (the production-bundle scan proves the shipped code separately).
const LOGIN_SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../pages/auth/Login.tsx'), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div> }
function renderAt(path: string, chrome = true) {
  if (chrome) vi.stubGlobal('__CARUP_SHOWROOM_CHROME__', true)
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<MainLayout hideNav />}>
          <Route path="/login" element={<Login />} />
        </Route>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

const fetchMock = vi.fn()
beforeEach(() => { fetchMock.mockReset(); login.mockReset(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => vi.unstubAllGlobals())

describe('no demonstration authentication path (source and render)', () => {
  it('Login.tsx carries no demo identities, shared credential, handler or demo controls', () => {
    for (const needle of ['DEMO_USERS', 'handleDemoLogin', 'password123', 'Quick Demo Access', 'Browse as Buyer', 'Demo: Dealer', 'Demo: Mechanic', 'tendai@email.co.zw', 'crocomoto', 'simba@garage']) {
      expect(LOGIN_SRC, needle).not.toContain(needle)
    }
  })

  it('the rendered sign-in has exactly one submit path and no Remember me control', () => {
    const { container } = renderAt('/login')
    expect(container.querySelectorAll('form')).toHaveLength(1)
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(1)
    expect(screen.queryByText(/demo/i)).toBeNull()
    expect(screen.queryByText(/remember me/i)).toBeNull()
    expect(container.querySelector('input[type="checkbox"]')).toBeNull()
  })
})

describe('the RX-03 account stage (showroom chrome ON)', () => {
  it('one logo, one heading, a way back to browsing — no navbar, footer or bottom tab bar', () => {
    const { container } = renderAt('/login')
    expect(screen.getByTestId('auth-stage')).toBeInTheDocument()
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to CarUp' })).toBeInTheDocument()
    // Logo once per viewport: band logo (phones) is hidden at lg, where the brand panel shows the stacked logo.
    expect(screen.getByTestId('auth-band-logo').className).toMatch(/lg:invisible/)
    const panel = screen.getByTestId('auth-brand-panel').className
    expect(panel).toMatch(/(^| )hidden( |$)/)
    expect(panel).toMatch(/lg:flex/)
    expect(container.querySelector('footer')).toBeNull()
    expect(container.querySelector('[data-testid="compact-bottom-nav"]')).toBeNull()
    expect(screen.getByTestId('auth-exit')).toHaveTextContent('Continue browsing')
  })

  it('every task control is a 44px target on phones (stage-scoped rule)', () => {
    renderAt('/login')
    expect(screen.getByTestId('auth-task-body').className).toMatch(/max-lg:\[&_button\]:min-h-11/)
    expect(screen.getByTestId('auth-task-body').className).toMatch(/max-lg:\[&_a\]:min-h-11/)
  })

  it('the cinematic still is a desktop-only CSS background of an approved poster, never a video', () => {
    const { container } = renderAt('/login')
    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByTestId('auth-brand-panel').className).toMatch(/lg:bg-\[url\('\/media\/home-film\/home-landscape-poster\.jpg'\)\]/)
  })

  it('visible labels, 44px controls, accessible password toggle, password-manager autocomplete', async () => {
    renderAt('/login')
    const id = screen.getByLabelText('Email or phone')
    const pw = screen.getByLabelText('Password')
    expect(id).toHaveAttribute('autocomplete', 'username')
    expect(pw).toHaveAttribute('autocomplete', 'current-password')
    const toggle = screen.getByTestId('signin-password-toggle')
    expect(toggle.className).toMatch(/h-11 w-11/)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle)
    expect(pw).toHaveAttribute('type', 'text')
    expect(toggle).toHaveAttribute('aria-label', 'Hide password')
    expect(screen.getByTestId('signin-forgot').className).toMatch(/min-h-11/)
    expect(screen.getByTestId('signin-forgot')).toHaveAttribute('href', '/auth/forgot-password')
  })

  it('field errors are tied to their inputs and announced', async () => {
    renderAt('/login')
    await userEvent.click(screen.getByTestId('login-button'))
    const id = screen.getByLabelText('Email or phone')
    expect(id).toHaveAttribute('aria-invalid', 'true')
    expect(id.getAttribute('aria-describedby')).toBe('signin-identifier-error')
    expect(screen.getByText('Email or phone is required')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('submits the real CSRF-bound request once and returns to the safe returnTo', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'csrf-x' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ user: { id: 'u9', name: 'Rudo', role: 'owner' }, token: 'tok' }) })
    renderAt('/login?returnTo=%2Fdiaspora%2Fimports%2Fnew')
    expect(screen.getByTestId('signin-continue')).toHaveTextContent('Start Import Order')
    expect(screen.getByTestId('signin-register')).toHaveAttribute('href', '/register?returnTo=%2Fdiaspora%2Fimports%2Fnew')
    fireEvent.change(screen.getByLabelText('Email or phone'), { target: { value: 'rudo@example.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } })
    await userEvent.click(screen.getByTestId('login-button'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/diaspora/imports/new'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[1]
    expect(String(url)).toMatch(/\/auth\/login$/)
    expect(init.method).toBe('POST')
    expect(init.headers['x-csrf-token']).toBe('csrf-x')
    expect(JSON.parse(init.body)).toEqual({ email: 'rudo@example.test', password: 'correct horse' })
    // The form never decides the role: it passes the server's user through to the session.
    expect(login).toHaveBeenCalledWith({ id: 'u9', name: 'Rudo', role: 'owner' }, 'tok')
  })

  it('an unsafe returnTo is ignored (no continue note, register link plain)', () => {
    renderAt('/login?returnTo=https%3A%2F%2Fevil.example%2Fx')
    expect(screen.queryByTestId('signin-continue')).toBeNull()
    expect(screen.getByTestId('signin-register')).toHaveAttribute('href', '/register')
  })

  it('wrong credentials and an unreachable backend each show their classified, announced error', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'c' }) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
    renderAt('/login')
    fireEvent.change(screen.getByLabelText('Email or phone'), { target: { value: 'a@b.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-pass' } })
    await userEvent.click(screen.getByTestId('login-button'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent?.length).toBeGreaterThan(5)
    expect(login).not.toHaveBeenCalled()
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await userEvent.click(screen.getByTestId('login-button'))
    await waitFor(() => expect(within(screen.getByTestId('signin-form')).getAllByRole('alert').length).toBeGreaterThan(0))
    expect(login).not.toHaveBeenCalled()
  })

  it('the five account routes share one title map', () => {
    expect(focusedTaskFor('/login')).toEqual({ title: 'Sign in to CarUp', wide: false })
    expect(focusedTaskFor('/register')).toEqual({ title: 'Create your CarUp account', wide: true })
    expect(focusedTaskFor('/auth/forgot-password')?.title).toBe('Recover your password')
    expect(focusedTaskFor('/auth/reset-password')?.title).toBe('Choose a new password')
    expect(focusedTaskFor('/auth/verify-email')?.title).toBe('Verify your email')
    expect(focusedTaskFor('/kyc')).toBeNull()
  })
})

describe('flags OFF (production default): the legacy card, without demo access', () => {
  it('no account stage; legacy card renders; still no demo controls', () => {
    const { container } = renderAt('/login', false)
    expect(container.querySelector('[data-testid="auth-stage"]')).toBeNull()
    expect(screen.getByText('Welcome Back')).toBeInTheDocument()
    expect(screen.queryByText(/Quick Demo Access/)).toBeNull()
    expect(screen.queryByText(/remember me/i)).toBeNull()
  })
})

describe('one heading per account route inside the stage (no duplicate h1)', () => {
  it.each([
    ['/login', Login, 'Sign in to CarUp'],
    ['/register', Register, 'Create your CarUp account'],
    ['/auth/forgot-password', ForgotPassword, 'Recover your password'],
    ['/auth/reset-password?token=t', ResetPassword, 'Choose a new password'],
    ['/auth/verify-email?token=t', VerifyEmail, 'Verify your email'],
  ] as const)('%s', (path, Page, title) => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    vi.stubGlobal('__CARUP_SHOWROOM_CHROME__', true)
    const { container } = render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<MainLayout hideNav />}>
            <Route path={path.split('?')[0]} element={<Page />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    const h1s = container.querySelectorAll('h1')
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent(title)
    expect(container.querySelector('footer')).toBeNull()
  })
})
