import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePageMetadata } from './usePageMetadata'

const robots = () => document.querySelector('meta[name="robots"]')?.getAttribute('content')
const render = (canonicalPath: string, explicit?: string) =>
  renderHook(() => usePageMetadata({ title: 't', description: 'd', canonicalPath, robots: explicit }))

afterEach(() => vi.unstubAllEnvs())

describe('client robots follow the single launch indexing authority (OC-LAUNCH R1)', () => {
  it('keeps every page noindex when the deployment is not the carup.dev production project', () => {
    vi.stubEnv('VITE_SEARCH_INDEXABLE', '')
    render('/marketplace')
    expect(robots()).toBe('noindex, nofollow')
  })
  it('inherits the launch policy when a page states no robots: hidden pages stay noindex', () => {
    vi.stubEnv('VITE_SEARCH_INDEXABLE', 'true')
    render('/careers')
    expect(robots()).toBe('noindex, nofollow')
    render('/privacy')
    expect(robots()).toBe('noindex, nofollow')
    render('/marketplace')
    expect(robots()).toBe('index, follow')
  })
})
