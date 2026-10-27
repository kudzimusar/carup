/**
 * T11-CAP-LR01-R3 — `getOrderVehicle`: the one question the import journey asks the order endpoint.
 *
 * "Which vehicle does this order carry, if I am entitled to open its Passport?" The endpoint names the vehicle only
 * for the vehicle's owner or current seller, so this function turns its answer into a vehicle or a plain null — and
 * lets a failed read fail, so the caller can decline to offer a link rather than guess.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const calls = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: 'session-token', user: { id: 'u1', role: 'owner', active_tenant_id: null } }),
}))
vi.mock('@/lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/apiClient')>()),
  apiRequest: calls.request,
}))

import { useTradeLogisticsApi } from './useTradeLogisticsApi'

const ORDER = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const ask = (orderId = ORDER) => renderHook(() => useTradeLogisticsApi()).result.current.getOrderVehicle(orderId)

beforeEach(() => { calls.request.mockReset() })

describe('getOrderVehicle', () => {
  it('reads the order itself — the endpoint that decides who is named the vehicle', async () => {
    calls.request.mockResolvedValue({ id: ORDER })
    await ask('a b/1')
    expect(calls.request).toHaveBeenCalledTimes(1)
    const [options] = calls.request.mock.calls[0]
    expect(options.path).toBe('/diaspora/import-orders/a%20b%2F1')
    expect(options.options).toBeUndefined()
    expect(options.authHeaders).toMatchObject({ 'x-session-token': 'session-token', 'x-user-id': 'u1' })
  })

  it('returns the vehicle the order names, with its title', async () => {
    calls.request.mockResolvedValue({ id: ORDER, linked_vehicle: { vin: 'RU3-1316558', title: '2018 Honda Vezel' } })
    await expect(ask()).resolves.toEqual({ vin: 'RU3-1316558', title: '2018 Honda Vezel' })
  })

  it('returns the vehicle with a null title when the order gave none', async () => {
    calls.request.mockResolvedValue({ linked_vehicle: { vin: 'RU3-1316558', title: null } })
    await expect(ask()).resolves.toEqual({ vin: 'RU3-1316558', title: null })
    calls.request.mockResolvedValue({ linked_vehicle: { vin: 'RU3-1316558', title: '   ' } })
    await expect(ask()).resolves.toEqual({ vin: 'RU3-1316558', title: null })
  })

  it.each([
    ['an order that names no vehicle (anyone but the owner)', { id: ORDER }],
    ['an explicit null', { id: ORDER, linked_vehicle: null }],
    ['a vehicle with no identifier', { linked_vehicle: { title: '2018 Honda Vezel' } }],
    ['a blank identifier', { linked_vehicle: { vin: '   ', title: 'x' } }],
    ['an identifier that is not text', { linked_vehicle: { vin: 12345, title: 'x' } }],
    ['no body at all', null],
  ])('returns null for %s — no entitlement is inferred', async (_name, body) => {
    calls.request.mockResolvedValue(body)
    await expect(ask()).resolves.toBeNull()
  })

  it('lets a failed read fail: "could not ask" is not "has no vehicle"', async () => {
    calls.request.mockRejectedValue(new Error('Forbidden'))
    await expect(ask()).rejects.toThrow('Forbidden')
  })
})
