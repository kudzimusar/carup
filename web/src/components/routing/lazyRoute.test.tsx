/**
 * RX07-WEB-PERF-01-A — lazy routes fail visibly, recover on Retry, never double-request a chunk, and
 * never let one page's failure stick to the next path.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom'
import { lazyRoute, retryUrlFrom } from './lazyRoute'

const chunkError = () => Object.assign(new TypeError('Failed to fetch dynamically imported module: /assets/Page-x.js'), {})
const Page = ({ label = 'Loaded page' }: { label?: string }) => <h1>{label}</h1>

function silenceBoundaryLogs() {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  return () => { warn.mockRestore(); error.mockRestore() }
}

describe('lazyRoute', () => {
  it('renders the page once its chunk arrives, showing an accessible loading state meanwhile', async () => {
    let release: () => void = () => {}
    const importer = vi.fn(() => new Promise<{ default: typeof Page }>(res => { release = () => res({ default: Page }) }))
    const Lazy = lazyRoute(importer, 'Page')
    render(<MemoryRouter><Lazy /></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    release()
    expect(await screen.findByRole('heading', { name: 'Loaded page' })).toBeInTheDocument()
    expect(importer).toHaveBeenCalledTimes(1)
  })

  it('passes route props through (e.g. kind / claimMode)', async () => {
    const Lazy = lazyRoute(async () => ({ default: Page }))
    render(<MemoryRouter><Lazy label="With props" /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'With props' })).toBeInTheDocument()
  })

  it('a preload and the real render share ONE request', async () => {
    const importer = vi.fn(async () => ({ default: Page }))
    const Lazy = lazyRoute(importer)
    await Lazy.preload()
    await Lazy.preload()
    render(<MemoryRouter><Lazy /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Loaded page' })).toBeInTheDocument()
    expect(importer).toHaveBeenCalledTimes(1)
  })

  it('a failed chunk shows the retry shell (not a blank app); Retry re-attempts and recovers', async () => {
    const restore = silenceBoundaryLogs()
    let attempt = 0
    const importer = vi.fn(async () => { if (++attempt === 1) throw chunkError(); return { default: Page } })
    const Lazy = lazyRoute(importer)
    render(<MemoryRouter><Lazy /></MemoryRouter>)
    expect(await screen.findByTestId('lazy-route-error')).toHaveAttribute('role', 'alert')
    expect(screen.queryByTestId('lazy-route-reload')).toBeNull()
    await userEvent.click(screen.getByTestId('lazy-route-retry'))
    expect(await screen.findByRole('heading', { name: 'Loaded page' })).toBeInTheDocument()
    expect(importer).toHaveBeenCalledTimes(2)
    restore()
  })

  it('a failed preload does not poison the later render', async () => {
    const restore = silenceBoundaryLogs()
    let attempt = 0
    const importer = vi.fn(async () => { if (++attempt === 1) throw chunkError(); return { default: Page } })
    const Lazy = lazyRoute(importer)
    await Lazy.preload() // resolves (never rejects) even though the download failed
    render(<MemoryRouter><Lazy /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Loaded page' })).toBeInTheDocument()
    expect(importer).toHaveBeenCalledTimes(2)
    restore()
  })

  it('after a retry also fails, a full reload is offered (stale deployment)', async () => {
    const restore = silenceBoundaryLogs()
    const importer = vi.fn(async () => { throw chunkError() })
    const Lazy = lazyRoute(importer)
    render(<MemoryRouter><Lazy /></MemoryRouter>)
    await screen.findByTestId('lazy-route-error')
    await userEvent.click(screen.getByTestId('lazy-route-retry'))
    expect(await screen.findByTestId('lazy-route-reload')).toHaveTextContent('Reload page')
    expect(importer).toHaveBeenCalledTimes(2)
    restore()
  })

  it('one page’s chunk failure does not stick to the next path', async () => {
    const restore = silenceBoundaryLogs()
    const Broken = lazyRoute(async () => { throw chunkError() })
    const Fine = lazyRoute(async () => ({ default: () => <h1>Other page</h1> }))
    render(
      <MemoryRouter initialEntries={['/a']}>
        <Link to="/b">go b</Link>
        <Routes>
          <Route path="/a" element={<Broken />} />
          <Route path="/b" element={<Fine />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByTestId('lazy-route-error')
    await userEvent.click(screen.getByText('go b'))
    expect(await screen.findByRole('heading', { name: 'Other page' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('lazy-route-error')).toBeNull())
    restore()
  })

  it('Chromium caches a failed module fetch: Retry re-imports the SAME chunk under a one-off query', async () => {
    const restore = silenceBoundaryLogs()
    const failure = new TypeError(`Failed to fetch dynamically imported module: ${location.origin}/assets/About-DGp4KbwT.js`)
    const importer = vi.fn(async () => { throw failure })
    const importUrl = vi.fn(async (url: string) => ({ default: () => <h1>{`Recovered via ${new URL(url).search}`}</h1> }))
    const Lazy = lazyRoute(importer, 'About', { importUrl })
    render(<MemoryRouter><Lazy /></MemoryRouter>)
    await screen.findByTestId('lazy-route-error')
    await userEvent.click(screen.getByTestId('lazy-route-retry'))
    expect(await screen.findByRole('heading', { name: 'Recovered via ?carup-retry=1' })).toBeInTheDocument()
    expect(importer).toHaveBeenCalledTimes(1)
    expect(importUrl).toHaveBeenCalledWith(`${location.origin}/assets/About-DGp4KbwT.js?carup-retry=1`)
    restore()
  })
})

describe('retryUrlFrom', () => {
  const origin = 'https://carup.example'
  const err = (u: string) => new TypeError(`Failed to fetch dynamically imported module: ${u}`)
  it('accepts only a same-origin build or dev module named by the browser', () => {
    expect(retryUrlFrom(err(`${origin}/assets/About-x1.js`), 1, origin)).toBe(`${origin}/assets/About-x1.js?carup-retry=1`)
    expect(retryUrlFrom(err(`${origin}/src/pages/About.tsx?t=123`), 2, origin)).toBe(`${origin}/src/pages/About.tsx?t=123&carup-retry=2`)
  })
  it('refuses other origins, other paths and messages without a module URL', () => {
    expect(retryUrlFrom(err('https://evil.example/assets/x.js'), 1, origin)).toBeNull()
    expect(retryUrlFrom(err(`${origin}/api/x.js`), 1, origin)).toBeNull()
    expect(retryUrlFrom(new Error('Something else broke'), 1, origin)).toBeNull()
    expect(retryUrlFrom(null, 1, origin)).toBeNull()
  })
})
