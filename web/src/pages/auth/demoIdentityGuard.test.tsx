/**
 * R14 — demo identities never appear on the login page. (Ported by OC-5D from PR #197; the
 * production BUNDLE is also scanned in CI — scripts/ci/assert-no-demo-identities.mjs — because a
 * hidden block can still ship its password in the JavaScript.)
 *
 * THE DEFECT THIS PINS. The login page rendered "Quick Demo Access" unconditionally: three named
 * accounts (`tendai@email.co.zw`, `dealer@crocomoto.co.zw`, `simba@garage.co.zw`) and a hard-coded
 * password, on every build including production. Anyone landing on the CarUp login page was offered
 * one-click entry to three real accounts.
 *
 * OC-5D first made the block a build switch (`VITE_ALLOW_DEMO_LOGINS`). OC-5R removed the demo
 * identities and the shared password from the runtime entirely, so there is no longer a switch to
 * test: the surface must be absent in EVERY build, including one that still sets the obsolete flag.
 * The real sign-in form is asserted alongside, so an empty or broken page cannot pass for "absent".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ login: vi.fn() }) }))

const DEMO_LEAKS = ['Tendai Moyo', 'tendai@email.co.zw', 'dealer@crocomoto.co.zw', 'simba@garage.co.zw', 'password123']

async function renderLoginWith(flag: string | undefined) {
  vi.resetModules()
  vi.stubEnv('VITE_ALLOW_DEMO_LOGINS', flag ?? '')
  const { default: Login } = await import('./Login')
  return render(<MemoryRouter><Login /></MemoryRouter>)
}

function expectNoDemoSurface(container: HTMLElement, label: string) {
  expect(screen.queryByTestId('demo-access'), `${label}: demo-access must not render`).toBeNull()
  expect(container.textContent, `${label}: no demo copy`).not.toMatch(/quick demo access/i)
  expect(container.textContent, `${label}: no demo wording at all`).not.toMatch(/demo/i)
  for (const leak of DEMO_LEAKS) {
    expect(container.innerHTML, `${label}: demo identity leaked: ${leak}`).not.toContain(leak)
  }
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.unstubAllEnvs() })

describe('R14 — the login page has no demo access in any build', () => {
  it('a production build shows no demo identities', async () => {
    const { container } = await renderLoginWith('')
    expectNoDemoSurface(container, 'empty flag')
  })

  it('an unset flag shows no demo identities', async () => {
    const { container } = await renderLoginWith(undefined)
    expectNoDemoSurface(container, 'unset flag')
  })

  it('the obsolete VITE_ALLOW_DEMO_LOGINS=true flag no longer brings demo access back', async () => {
    // OC-5R retired the switch. A build that still sets the old flag — or any variant of it — must
    // render exactly what production renders.
    for (const value of ['true', '1', 'yes', 'TRUE', 'true ']) {
      const { container, unmount } = await renderLoginWith(value)
      expectNoDemoSurface(container, `VITE_ALLOW_DEMO_LOGINS=${JSON.stringify(value)}`)
      unmount()
    }
  })

  it('the real sign-in form is present in every build', async () => {
    for (const value of ['', undefined, 'true']) {
      const { unmount } = await renderLoginWith(value)
      expect(screen.getByTestId('login-button'), `flag=${JSON.stringify(value)}`).toBeTruthy()
      unmount()
    }
  })
})
