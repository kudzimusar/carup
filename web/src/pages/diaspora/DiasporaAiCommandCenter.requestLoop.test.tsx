/**
 * RC2 residual — a page loads its list once per visit, not once per render.
 *
 * `useCarUpApi()` returns a NEW object on every render, and it must: it carries the hook's own
 * `loading` and `error`, which every request changes. A page that names that object in an effect's
 * (or a callback's) dependency list therefore re-runs the effect after every request it makes:
 * request → loading flips → re-render → new object → effect → request, for as long as the page is
 * open. PR #137 found it on this page (effce404) and it was never carried; ten pages had the pattern.
 *
 * Driven through the REAL hook (only the network boundary and the signed-in person are stood in),
 * because a mocked hook that returned a stable object would hide exactly this.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const AUTH = { user: { id: 'u-oc5', role: 'owner' }, token: 'tok-oc5', isAuthenticated: true, loading: false }
vi.mock('@/context/AuthContext', () => ({ useAuth: () => AUTH }))
const apiRequest = vi.fn()
vi.mock('@/lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/apiClient')>()),
  apiRequest: (args: { path: string }) => apiRequest(args),
}))

import DiasporaAiCommandCenter from './DiasporaAiCommandCenter'

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  apiRequest.mockReset()
  // A real network answers in its own task. An instant mock lets React batch the hook's state
  // updates and hides the loop (3 loads, then quiet); with 20 ms of latency it is unbounded — 330
  // loads in 1.5 s before the fix.
  apiRequest.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ data: [] }), 20)))
})

describe('the AI Command Center loads its commands once per visit', () => {
  it('one load, however many renders its own requests cause', async () => {
    render(<MemoryRouter><DiasporaAiCommandCenter /></MemoryRouter>)
    await waitFor(() => expect(apiRequest).toHaveBeenCalled())
    await settle(500)
    const loads = apiRequest.mock.calls.filter(([args]) => String(args?.path).includes('/diaspora/ai-commands'))
    expect(loads).toHaveLength(1)
  })
})
