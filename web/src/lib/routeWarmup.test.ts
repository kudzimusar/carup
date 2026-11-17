import { afterEach, describe, expect, it, vi } from 'vitest'
import { journeyStepFor, prefersDataSaving, warmJourney } from './routeWarmup'

describe('journeyStepFor', () => {
  it.each([
    ['/', 'home'], ['', 'home'], ['/marketplace', 'marketplace'], ['/marketplace/', 'marketplace'],
    ['/marketplace/abc-123', 'detail'], ['/marketplace/listing/abc-123', 'detail'],
    ['/marketplace/parts', null], ['/marketplace/services', null], ['/marketplace/compare', null],
    ['/dashboard', null], ['/login', null], ['/admin/dealer-claims', null], ['/diaspora/imports/1', null],
    ['/marketplace/abc/extra', null],
  ])('%s → %s', (path, step) => expect(journeyStepFor(path)).toBe(step))
})

describe('prefersDataSaving', () => {
  it('honours Save-Data and 2g, and assumes nothing when the API is absent', () => {
    expect(prefersDataSaving({ saveData: true })).toBe(true)
    expect(prefersDataSaving({ effectiveType: '2g' })).toBe(true)
    expect(prefersDataSaving({ effectiveType: 'slow-2g' })).toBe(true)
    expect(prefersDataSaving({ effectiveType: '4g' })).toBe(false)
    expect(prefersDataSaving(undefined)).toBe(false)
  })
})

describe('warmJourney', () => {
  const steps = () => ({ home: vi.fn(async () => {}), marketplace: vi.fn(async () => {}), detail: vi.fn(async () => {}) })
  afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(navigator, 'connection') })

  it('requests only the opened page immediately; the rest only after load + idle', () => {
    vi.useFakeTimers()
    const s = steps()
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })
    warmJourney('/', s)
    expect(s.home).toHaveBeenCalledTimes(1)
    expect(s.marketplace).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('load'))
    vi.runAllTimers()
    expect(s.marketplace).toHaveBeenCalledTimes(1)
    expect(s.detail).toHaveBeenCalledTimes(1)
    expect(s.home).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true })
  })

  it('never speculates under Save-Data', () => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true })
    const s = steps()
    warmJourney('/marketplace', s)
    window.dispatchEvent(new Event('load'))
    vi.runAllTimers()
    expect(s.marketplace).toHaveBeenCalledTimes(1)
    expect(s.home).not.toHaveBeenCalled()
    expect(s.detail).not.toHaveBeenCalled()
  })

  it('does nothing on non-journey routes (workspaces, sign-in)', () => {
    vi.useFakeTimers()
    const s = steps()
    warmJourney('/dashboard', s)
    window.dispatchEvent(new Event('load'))
    vi.runAllTimers()
    expect(s.home).not.toHaveBeenCalled()
    expect(s.marketplace).not.toHaveBeenCalled()
    expect(s.detail).not.toHaveBeenCalled()
  })
})
