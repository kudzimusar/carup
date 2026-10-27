/**
 * T11-CAP-LR01-R3 — `useOrderVehicleRead` says not only WHICH vehicle an order carries, but WHETHER the read that would say so has
 * answered. The difference is what lets a trail call a still-loading order "Import order" instead of flashing its short reference
 * (a physical UAT finding), and it must hold per order: an answer about one order is never an answer about the next.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ getOrderVehicle: vi.fn() }))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({ useTradeLogisticsApi: () => ({ getOrderVehicle: h.getOrderVehicle }) }))

import { useOrderVehicle, useOrderVehicleRead } from './useOrderVehicle'

const A = '3e2b66a0-1e8b-43c9-bd48-507f88016f71'
const B = '921d09ed-0000-4000-8000-000000000002'
const VEZEL = { vin: 'RU3-1316558', title: '2018 Honda Vezel' }

type Answer = { vin: string; title: string | null } | null
function deferred() {
  let resolve!: (value: Answer) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<Answer>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => { vi.clearAllMocks() })

describe('useOrderVehicleRead', () => {
  it('is unsettled while the read is out, and settled with the vehicle once it answers', async () => {
    const read = deferred()
    h.getOrderVehicle.mockImplementation(() => read.promise)
    const { result } = renderHook(() => useOrderVehicleRead(A))
    expect(result.current).toEqual({ vehicle: null, settled: false })
    await act(async () => { read.resolve(VEZEL) })
    await waitFor(() => expect(result.current.settled).toBe(true))
    expect(result.current.vehicle).toMatchObject(VEZEL)
    expect(h.getOrderVehicle).toHaveBeenCalledWith(A)
  })

  it('an answer of "no vehicle" is settled with none', async () => {
    h.getOrderVehicle.mockResolvedValue(null)
    const { result } = renderHook(() => useOrderVehicleRead(A))
    await waitFor(() => expect(result.current).toEqual({ vehicle: null, settled: true }))
  })

  it('a read that FAILED has answered: settled, with no vehicle claimed', async () => {
    const read = deferred()
    h.getOrderVehicle.mockImplementation(() => read.promise)
    const { result } = renderHook(() => useOrderVehicleRead(A))
    await act(async () => { read.reject(new Error('Server unavailable')) })
    await waitFor(() => expect(result.current).toEqual({ vehicle: null, settled: true }))
  })

  it('an answer about one order is never an answer about the next: moving to another order is unsettled again, with no vehicle', async () => {
    const reads: Record<string, ReturnType<typeof deferred>> = { [A]: deferred(), [B]: deferred() }
    h.getOrderVehicle.mockImplementation((orderId: string) => reads[orderId].promise)
    const { result, rerender } = renderHook(({ orderId }) => useOrderVehicleRead(orderId), { initialProps: { orderId: A } })
    await act(async () => { reads[A].resolve(VEZEL) })
    await waitFor(() => expect(result.current.settled).toBe(true))

    rerender({ orderId: B })
    expect(result.current).toEqual({ vehicle: null, settled: false })
    await act(async () => { reads[B].resolve(null) })
    await waitFor(() => expect(result.current).toEqual({ vehicle: null, settled: true }))
  })

  it('a late answer for an order the page has left is ignored', async () => {
    const reads: Record<string, ReturnType<typeof deferred>> = { [A]: deferred(), [B]: deferred() }
    h.getOrderVehicle.mockImplementation((orderId: string) => reads[orderId].promise)
    const { result, rerender } = renderHook(({ orderId }) => useOrderVehicleRead(orderId), { initialProps: { orderId: A } })
    rerender({ orderId: B })
    await act(async () => { reads[A].resolve(VEZEL) })
    expect(result.current).toEqual({ vehicle: null, settled: false })
  })

  it('a late FAILURE for an order the page has left does not undo the next order\'s answer', async () => {
    const reads: Record<string, ReturnType<typeof deferred>> = { [A]: deferred(), [B]: deferred() }
    h.getOrderVehicle.mockImplementation((orderId: string) => reads[orderId].promise)
    const { result, rerender } = renderHook(({ orderId }) => useOrderVehicleRead(orderId), { initialProps: { orderId: A } })
    rerender({ orderId: B })
    await act(async () => { reads[B].resolve(VEZEL) })
    await waitFor(() => expect(result.current.settled).toBe(true))
    await act(async () => { reads[A].reject(new Error('Server unavailable')) })
    expect(result.current.settled).toBe(true)
    expect(result.current.vehicle).toMatchObject(VEZEL)
  })

  it('no order: nothing is read and nothing is settled', () => {
    const { result } = renderHook(() => useOrderVehicleRead(null))
    expect(result.current).toEqual({ vehicle: null, settled: false })
    expect(h.getOrderVehicle).not.toHaveBeenCalled()
  })

  it('useOrderVehicle is the same answer without the settled flag', async () => {
    h.getOrderVehicle.mockResolvedValue(VEZEL)
    const { result } = renderHook(() => useOrderVehicle(A))
    await waitFor(() => expect(result.current).toMatchObject(VEZEL))
  })
})
