/**
 * RX06-LR06 — wiring: every session change in AuthContext starts a new shared-read epoch (sign-in, role switch,
 * sign-out), so a read issued after the change can never join one that left for the previous session.
 * The epoch itself is tested in src/lib/apiClient.test.ts; this proves the production path calls it.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { AuthUser } from '@shared/types'

const fx = vi.hoisted(() => ({
  forget: vi.fn(),
  api: vi.fn(async () => ({ token: 'sess-2', user: { role: 'dealer' } })),
}))
vi.mock('@/lib/apiClient', async importOriginal => ({ ...(await importOriginal<object>()), forgetSharedReads: fx.forget, apiRequest: fx.api }))

import { AuthProvider, useAuth } from './AuthContext'

function Probe() {
  const { login, logout, switchRole, user } = useAuth()
  return (
    <div>
      <button onClick={() => login({ id: 'fx-owner', role: 'owner', name: 'Fictional Owner' } as unknown as AuthUser, 'sess-1')}>sign in</button>
      <button onClick={() => { void switchRole('dealer' as AuthUser['role']).catch(() => {}) }}>switch role</button>
      <button onClick={() => logout()}>sign out</button>
      <span data-testid="who">{user?.id ?? 'guest'}</span>
    </div>
  )
}

beforeEach(() => { localStorage.clear(); fx.forget.mockClear(); fx.api.mockClear() })
afterEach(() => cleanup())

it('sign-in, role switch and sign-out each start a new shared-read epoch', async () => {
  render(<AuthProvider><Probe /></AuthProvider>)
  expect(fx.forget).not.toHaveBeenCalled()
  await act(async () => { screen.getByText('sign in').click() })
  expect(screen.getByTestId('who')).toHaveTextContent('fx-owner')
  expect(fx.forget).toHaveBeenCalledTimes(1)
  await act(async () => { screen.getByText('switch role').click() })
  expect(fx.api).toHaveBeenCalledTimes(1)
  expect(fx.forget).toHaveBeenCalledTimes(2)
  await act(async () => { screen.getByText('sign out').click() })
  expect(screen.getByTestId('who')).toHaveTextContent('guest')
  expect(fx.forget).toHaveBeenCalledTimes(3)
})
