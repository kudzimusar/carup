/**
 * R14 — demo identities must not appear in production builds.
 *
 * THE DEFECT THIS PINS. The login page rendered "Quick Demo Access" unconditionally: three named
 * accounts (`tendai@email.co.zw`, `dealer@crocomoto.co.zw`, `simba@garage.co.zw`) and a hard-coded
 * password, on every build including production. Anyone landing on the CarUp login page was offered
 * one-click entry to three real accounts.
 *
 * The build decides, and it fails closed — `vite.config.ts` sets the flag ONLY for a Vercel
 * environment that positively identifies itself as non-production.
 *
 * Both directions are asserted. A test that only checks the block is hidden would still pass if the
 * block were deleted entirely, and would tell us nothing about whether the flag actually works.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ login: vi.fn() }) }))

async function renderLoginWith(flag: string | undefined) {
  vi.resetModules()
  vi.stubEnv('VITE_ALLOW_DEMO_LOGINS', flag ?? '')
  const { default: Login } = await import('./Login')
  return render(<MemoryRouter><Login /></MemoryRouter>)
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.unstubAllEnvs() })

describe('R14 — demo access is a build decision, and it fails closed', () => {
  it('a production build shows NO demo identities', async () => {
    // VERCEL_ENV=production leaves the flag empty; so does any build that cannot identify itself.
    const { container } = await renderLoginWith('')
    expect(screen.queryByTestId('demo-access')).toBeNull()
    expect(container.textContent).not.toMatch(/quick demo access/i)
    // Not one of the three identities, and not the shared password, anywhere in the rendered page.
    for (const leak of ['Tendai Moyo', 'tendai@email.co.zw', 'dealer@crocomoto.co.zw', 'simba@garage.co.zw', 'password123']) {
      expect(container.innerHTML, `demo identity leaked into a production build: ${leak}`)
        .not.toContain(leak)
    }
  })

  it('an unset flag is treated as production, not as permission', async () => {
    const { container } = await renderLoginWith(undefined)
    expect(screen.queryByTestId('demo-access')).toBeNull()
    expect(container.textContent).not.toMatch(/demo/i)
  })

  it('a value that is not exactly "true" grants nothing', async () => {
    for (const value of ['1', 'yes', 'TRUE', 'true ']) {
      const { container, unmount } = await renderLoginWith(value)
      expect(screen.queryByTestId('demo-access'), `"${value}" must not enable demo access`).toBeNull()
      expect(container.textContent).not.toMatch(/quick demo access/i)
      unmount()
    }
  })

  it('a preview build still offers them — the guard is a switch, not a deletion', async () => {
    // Without this, deleting the whole block would pass every assertion above.
    await renderLoginWith('true')
    expect(screen.getByTestId('demo-access')).toBeTruthy()
    expect(screen.getByText(/quick demo access/i)).toBeTruthy()
  })

  it('the real sign-in form is untouched in every build', async () => {
    const { unmount } = await renderLoginWith('')
    expect(screen.getByTestId('login-button')).toBeTruthy()
    unmount()
    await renderLoginWith('true')
    expect(screen.getByTestId('login-button')).toBeTruthy()
  })
})
