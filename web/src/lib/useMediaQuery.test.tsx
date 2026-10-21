import { afterEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useMediaQuery } from './useMediaQuery'

/** A controllable matchMedia: jsdom ships none. */
function installMatchMedia(initial: boolean) {
  let matches = initial
  const listeners = new Set<() => void>()
  const original = window.matchMedia
  window.matchMedia = ((query: string) => ({
    get matches() { return matches },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => { listeners.add(listener) },
    removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener) },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia
  return {
    set(next: boolean) { matches = next; listeners.forEach((listener) => listener()) },
    listenerCount: () => listeners.size,
    restore() { window.matchMedia = original },
  }
}

function Probe({ query }: { query: string }) {
  return <output data-testid="probe">{useMediaQuery(query) ? 'match' : 'no-match'}</output>
}

let restore: (() => void) | null = null
afterEach(() => { restore?.(); restore = null })

describe('useMediaQuery', () => {
  it('follows the media query as the viewport changes', () => {
    const media = installMatchMedia(false)
    restore = media.restore
    render(<Probe query="(min-width: 768px)" />)
    expect(screen.getByTestId('probe').textContent).toBe('no-match')

    act(() => media.set(true))
    expect(screen.getByTestId('probe').textContent).toBe('match')
    act(() => media.set(false))
    expect(screen.getByTestId('probe').textContent).toBe('no-match')
  })

  it('stops listening when unmounted', () => {
    const media = installMatchMedia(true)
    restore = media.restore
    const { unmount } = render(<Probe query="(min-width: 768px)" />)
    expect(media.listenerCount()).toBe(1)
    unmount()
    expect(media.listenerCount()).toBe(0)
  })

  it('without matchMedia it reports no match rather than throwing', () => {
    const original = window.matchMedia
    // @ts-expect-error — simulating an environment with no matchMedia
    delete window.matchMedia
    restore = () => { window.matchMedia = original }
    render(<Probe query="(min-width: 768px)" />)
    expect(screen.getByTestId('probe').textContent).toBe('no-match')
  })
})
