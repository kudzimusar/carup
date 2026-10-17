/**
 * T10.3 — what the participant's loading page is allowed to CLAIM.
 *
 * The failure this guards against is a customer reading "loaded" and concluding their goods are on
 * their way — or reading silence and concluding they were left behind.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({ view: null as unknown, err: null as Error | null }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: { id: 'u1' } }) }))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({
  useTradeLogisticsApi: () => ({
    getMyLoadStatus: vi.fn(async () => { if (state.err) throw state.err; return state.view }),
  }),
}))

import MyCargoLoading from './MyCargoLoading'

const SUBJECT = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

const view = (over = {}) => ({
  subject: { type: 'cargo_reservation', id: SUBJECT },
  state: 'LOADED',
  sentence: 'Your cargo has been loaded into the container.',
  left_behind_reason: null,
  loaded_volume_cbm: 3.6,
  loaded_at: '2026-09-12T14:00:00Z',
  note: 'Loaded means your cargo is inside the container. It does not mean the container has sailed.',
  ...over,
})

const open = async (testId = 'my-cargo-loading') => {
  render(
    <MemoryRouter initialEntries={[`/diaspora/cargo-loading/cargo_reservation/${SUBJECT}`]}>
      <Routes><Route path="/diaspora/cargo-loading/:subjectType/:subjectId" element={<MyCargoLoading />} /></Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument())
}

beforeEach(() => { state.err = null; state.view = view() })

describe('loaded', () => {
  it('says loaded, with the volume and time actually recorded', async () => {
    await open()
    expect(screen.getByTestId('my-loading-badge')).toHaveTextContent('Loaded')
    expect(screen.getByTestId('my-loading-volume')).toHaveTextContent('3.600 CBM')
    expect(screen.getByTestId('my-loading-when')).not.toHaveTextContent('Not recorded')
  })

  it('says out loud that loaded is not sailed', async () => {
    await open()
    // The moment a person starts assuming their goods are on their way.
    expect(screen.getByTestId('my-loading-disclaimer')).toHaveTextContent('does not mean the container has sailed')
  })

  it('reports an unrecorded volume as not known, never zero', async () => {
    state.view = view({ loaded_volume_cbm: null })
    await open()
    const v = screen.getByTestId('my-loading-volume')
    expect(v).toHaveTextContent('Not known')
    expect(v).not.toHaveTextContent('0.000')
  })
})

describe('left behind', () => {
  it('gives the reason in plain words', async () => {
    state.view = view({
      state: 'LEFT_BEHIND', left_behind_reason: 'NO_SPACE', loaded_volume_cbm: null, loaded_at: null,
      sentence: 'Your cargo was not loaded into this container.',
    })
    await open()
    expect(screen.getByTestId('my-loading-badge')).toHaveTextContent('Not loaded')
    expect(screen.getByTestId('my-loading-reason')).toHaveTextContent('No room left in the container')
  })

  it('promises nothing about what happens next', async () => {
    state.view = view({ state: 'LEFT_BEHIND', left_behind_reason: 'NO_SPACE', loaded_volume_cbm: null, loaded_at: null, sentence: 'Your cargo was not loaded into this container.' })
    await open()
    expect(screen.getByTestId('my-loading-reason')).toHaveTextContent('Nothing has been decided here')
    const text = screen.getByTestId('my-cargo-loading').textContent?.toLowerCase() || ''
    for (const promise of ['refund', 'next sailing', 'rebook', 'compensat', 'will be']) {
      expect(text).not.toContain(promise)
    }
  })

  it('says so honestly when the organiser gave no recognised reason', async () => {
    state.view = view({ state: 'LEFT_BEHIND', left_behind_reason: 'SOMETHING_NEW', loaded_volume_cbm: null, loaded_at: null, sentence: 'Your cargo was not loaded into this container.' })
    await open()
    // No invented explanation — an unrecognised code yields the absence, not a guess.
    expect(screen.getByTestId('my-loading-reason')).toHaveTextContent('has not given a reason')
  })
})

describe('silence is not exclusion', () => {
  it('distinguishes NOT_RECORDED from left behind, in words', async () => {
    state.view = view({
      state: 'NOT_RECORDED', loaded_volume_cbm: null, loaded_at: null,
      sentence: 'Loading has started. Nothing has been recorded about your cargo yet.',
    })
    await open()
    expect(screen.getByTestId('my-loading-badge')).toHaveTextContent('Nothing recorded yet')
    expect(screen.getByTestId('my-loading-not-recorded-note')).toHaveTextContent('not the same as being left behind')
    expect(screen.queryByTestId('my-loading-reason')).not.toBeInTheDocument()
  })

  it('says loading has not started when it has not', async () => {
    state.view = view({ state: 'NOT_STARTED', loaded_volume_cbm: null, loaded_at: null, sentence: 'Loading this container has not started.' })
    await open()
    expect(screen.getByTestId('my-loading-badge')).toHaveTextContent('Loading not started')
    expect(screen.getByTestId('my-loading-sentence')).toHaveTextContent('has not started')
  })

  it('a read failure is not reported as "left behind"', async () => {
    state.err = new Error('Network unreachable')
    await open('my-loading-unreadable')
    expect(screen.getByTestId('my-loading-unreadable')).toHaveTextContent('not a report that your cargo was left behind')
  })
})

describe('the T11 firewall', () => {
  it('never says departed, in transit, arrived or customs', async () => {
    await open()
    const text = screen.getByTestId('my-cargo-loading').textContent?.toLowerCase() || ''
    for (const later of ['departed', 'in transit', 'arrived', 'customs', 'delivered', 'shipped']) {
      expect(text).not.toContain(later)
    }
  })

  it('says where the container is, is recorded separately', async () => {
    await open()
    expect(screen.getByTestId('my-loading-disclaimer')).toHaveTextContent('recorded')
    expect(screen.getByTestId('my-loading-disclaimer')).toHaveTextContent('not shown here')
  })

  it('links back to the warehouse record rather than duplicating it', async () => {
    await open()
    expect(screen.getByTestId('my-loading-cargo-link')).toHaveAttribute('href', `/diaspora/cargo/cargo_reservation/${SUBJECT}`)
  })
})
