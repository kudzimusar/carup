/**
 * RX06-LR04 — error states, as the error-state matrix found them (2026-11-22, 96 runs): an ended session offered
 * "Try again"; a request that never reached CarUp printed the browser's "Failed to fetch"; a throttled read had no
 * words of its own; and the import-order ledger called a 404 a refusal. Fictional data only.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { OFFLINE_TEXT, THROTTLED_TEXT, isNetworkFailure } from '@/components/trade/core/readFailure'
import { SESSION_ENDED_TEXT, readFromError, readFromFailure, type Read, type TradeOrder } from '@/components/trade/order/orderModel'
import { errorMessage, failureKind } from '@/components/trade/sourcing/deskKit'
import { ImportOrderView } from '@/components/trade/order/ImportOrderView'
import { ImportOrderLedger } from '@/components/trade/order/ImportOrderLedger'

const httpError = (status: number | undefined, message: string) => Object.assign(new Error(message), status === undefined ? {} : { status })

describe('isNetworkFailure', () => {
  it('recognises a request that got no HTTP answer, in each browser\'s words', () => {
    for (const m of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed', 'Network request failed', 'net::ERR_INTERNET_DISCONNECTED']) {
      expect(isNetworkFailure(null, m), m).toBe(true)
      expect(isNetworkFailure(undefined, m), m).toBe(true)
    }
  })
  it('is never true once the server answered, nor for a lazy-route chunk failure', () => {
    expect(isNetworkFailure(500, 'Failed to fetch')).toBe(false)
    expect(isNetworkFailure(0 as number, 'Failed to fetch')).toBe(false)
    expect(isNetworkFailure(null, 'Failed to fetch dynamically imported module: /assets/Page-x.js')).toBe(false)
    expect(isNetworkFailure(null, 'An unexpected internal server error occurred')).toBe(false)
    expect(isNetworkFailure(null, '')).toBe(false)
  })
})

describe('readFromFailure (status + message kept in page state)', () => {
  it('an ended session is not offered a retry with the same session', () => {
    const onRetry = vi.fn()
    expect(readFromFailure(401, 'Session expired', onRetry)).toEqual({ state: 'failed', message: SESSION_ENDED_TEXT })
  })
  it('a throttled read says so, and can be retried', () => {
    const onRetry = vi.fn()
    expect(readFromFailure(429, 'Too many requests. Please try again later.', onRetry)).toEqual({ state: 'failed', message: THROTTLED_TEXT, onRetry })
  })
  it('a read that never reached CarUp says so in plain words, and can be retried', () => {
    const onRetry = vi.fn()
    expect(readFromFailure(null, 'Failed to fetch', onRetry)).toEqual({ state: 'failed', message: OFFLINE_TEXT, onRetry })
  })
  it('refusal, not-found and server failure keep their own states', () => {
    const onRetry = vi.fn()
    expect(readFromFailure(403, 'Forbidden', onRetry)).toEqual({ state: 'denied', message: 'Forbidden' })
    expect(readFromFailure(404, 'Not found', onRetry)).toEqual({ state: 'unavailable', message: 'Not found' })
    expect(readFromFailure(500, 'An unexpected internal server error occurred', onRetry)).toEqual({ state: 'failed', message: 'An unexpected internal server error occurred', onRetry })
  })
})

describe('readFromError (the thrown error)', () => {
  it('429 and a network failure have their own words; a 5xx keeps the server\'s', () => {
    const onRetry = vi.fn()
    expect(readFromError(httpError(429, 'Too many requests'), onRetry)).toEqual({ state: 'failed', message: THROTTLED_TEXT, onRetry })
    expect(readFromError(new TypeError('Failed to fetch'), onRetry)).toEqual({ state: 'failed', message: OFFLINE_TEXT, onRetry })
    expect(readFromError(httpError(503, 'Service unavailable'), onRetry)).toEqual({ state: 'failed', message: 'Service unavailable', onRetry })
  })
})

describe('Trade desks (deskKit)', () => {
  it('a network failure reads as OFFLINE_TEXT, and is still a plain failure (never denied, never missing)', () => {
    const err = new TypeError('Failed to fetch')
    expect(errorMessage(err)).toBe(OFFLINE_TEXT)
    expect(failureKind({ status: null, message: errorMessage(err) })).toBe('failed')
    expect(errorMessage(httpError(500, 'Boom'))).toBe('Boom')
  })
})

const ORDER_ID = 'fx000001-0000-4000-8000-000000000001'
function order(read: Read<TradeOrder>) {
  return render(<MemoryRouter><ImportOrderView orderId={ORDER_ID} mode="overview" order={read} viewer={{ id: 'fx-buyer', role: 'owner' }} /></MemoryRouter>)
}

describe('ImportOrderView — the failed order', () => {
  it('says "Try again" only when a retry is offered', () => {
    const { unmount } = order(readFromFailure(500, 'Server error', vi.fn()))
    expect(screen.getByTestId('trade-order-failed')).toHaveTextContent('Try again; CarUp support sees the same record.')
    unmount()
    order(readFromFailure(401, 'Session expired', vi.fn()))
    const failed = screen.getByTestId('trade-order-failed')
    expect(failed).toHaveTextContent(SESSION_ENDED_TEXT)
    expect(failed).not.toHaveTextContent(/try again/i)
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })
})

describe('ImportOrderLedger — a 404 is not a refusal', () => {
  function ledger(read: Read<TradeOrder[]>) {
    return render(<MemoryRouter><ImportOrderLedger orders={read} /></MemoryRouter>)
  }
  it('404: not available on this server, and not a report of no orders', () => {
    ledger(readFromFailure(404, 'Not found'))
    const box = screen.getByTestId('diaspora-import-list-unavailable')
    expect(box).toHaveTextContent('Import orders are not available on this server')
    expect(box).toHaveTextContent('this is not a report that you have no orders')
    expect(screen.queryByTestId('diaspora-import-list-denied')).not.toBeInTheDocument()
  })
  it('403: still the refusal', () => {
    ledger(readFromFailure(403, 'Forbidden'))
    expect(screen.getByTestId('diaspora-import-list-denied')).toHaveTextContent('CarUp refused to list import orders')
  })
})
