/**
 * RX06-LR04 — Trade seller desks (stock, trade graph…): a request that never reached CarUp is said in plain words and
 * is never quoted as "The server said: Failed to fetch". A real server answer is still quoted verbatim. Fictional only.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { OFFLINE_TEXT } from '@/components/trade/core/readFailure'
import { readFailureOf } from './deskFormat'
import { ReadFailureState } from './DeskPrimitives'

describe('readFailureOf', () => {
  it('a network failure is offline, worded in plain words', () => {
    expect(readFailureOf(new TypeError('Failed to fetch'))).toEqual({ kind: 'failed', status: null, message: OFFLINE_TEXT, offline: true })
  })
  it('a server answer keeps its own words and is not offline', () => {
    const f = readFailureOf(Object.assign(new Error('An unexpected internal server error occurred'), { status: 500 }))
    expect(f).toEqual({ kind: 'failed', status: 500, message: 'An unexpected internal server error occurred' })
  })
})

describe('ReadFailureState', () => {
  it('offline: plain words, never "The server said"', () => {
    render(<MemoryRouter><ReadFailureState failure={readFailureOf(new TypeError('Failed to fetch'))} what="Your stock lines" testId="f" /></MemoryRouter>)
    const box = screen.getByTestId('f')
    expect(box).toHaveTextContent(OFFLINE_TEXT)
    expect(box).not.toHaveTextContent(/The server said/)
    expect(box).not.toHaveTextContent(/Failed to fetch/)
  })
  it('a server failure is still quoted verbatim', () => {
    render(<MemoryRouter><ReadFailureState failure={readFailureOf(Object.assign(new Error('Boom'), { status: 503 }))} what="Your stock lines" testId="f" /></MemoryRouter>)
    expect(screen.getByTestId('f')).toHaveTextContent('The server said: Boom')
  })
})
