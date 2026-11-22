/** RX06-LR03: the web posts the backend's PATCH …/stages contract ({ status, metadata }), not { nextStatus }. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'fx-operator', role: 'reviewer' }, token: 'fx-session-token' }) }))
import { useCarUpApi } from './useCarUpApi'

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
afterEach(() => { vi.unstubAllGlobals() })

describe('transitionDiasporaImportOrder', () => {
  it('sends { status, metadata } to PATCH /diaspora/import-orders/:id/stages', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => (String(url).includes('csrf') ? json({ csrfToken: 'fx-csrf' }) : json({ id: 'fx-order', status: 'ZIMBABWE_READY' })))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useCarUpApi())
    await act(async () => { await result.current.transitionDiasporaImportOrder('fx-order', { nextStatus: 'ZIMBABWE_READY' }) })
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/diaspora/import-orders/fx-order/stages')) as unknown as [string, RequestInit]
    expect(call).toBeTruthy()
    expect(call[1].method).toBe('PATCH')
    expect(JSON.parse(String(call[1].body))).toEqual({ status: 'ZIMBABWE_READY', metadata: {} })
  })
})
