import { describe, it, expect } from 'vitest'
import {
  isSafeReturnTo,
  safeReturnTo,
  buildLoginRedirect,
  getDashboardRoute,
  resolvePostLoginRoute,
} from './returnTo'

describe('isSafeReturnTo', () => {
  it('accepts absolute internal paths', () => {
    expect(isSafeReturnTo('/diaspora/imports/new')).toBe(true)
    expect(isSafeReturnTo('/dashboard')).toBe(true)
    expect(isSafeReturnTo('/diaspora/imports/dio-1001/documents')).toBe(true)
    expect(isSafeReturnTo('/marketplace?make=Toyota&year=2021')).toBe(true)
    expect(isSafeReturnTo('/path#section')).toBe(true)
  })

  it('rejects protocol-relative, absolute, and backslash-tricked URLs', () => {
    expect(isSafeReturnTo('//evil.com')).toBe(false)
    expect(isSafeReturnTo('http://evil.com')).toBe(false)
    expect(isSafeReturnTo('https://evil.com/path')).toBe(false)
    expect(isSafeReturnTo('/\\evil.com')).toBe(false)
    expect(isSafeReturnTo('/path\\to')).toBe(false)
    expect(isSafeReturnTo('javascript:alert(1)')).toBe(false)
  })

  it('rejects non-absolute and empty/invalid values', () => {
    expect(isSafeReturnTo('relative/path')).toBe(false)
    expect(isSafeReturnTo('')).toBe(false)
    expect(isSafeReturnTo(null)).toBe(false)
    expect(isSafeReturnTo(undefined)).toBe(false)
    expect(isSafeReturnTo('/with\nnewline')).toBe(false)
  })
})

describe('safeReturnTo', () => {
  it('returns the value when safe, otherwise the fallback', () => {
    expect(safeReturnTo('/diaspora/imports/new', '/dashboard')).toBe('/diaspora/imports/new')
    expect(safeReturnTo('//evil.com', '/dashboard')).toBe('/dashboard')
    expect(safeReturnTo(null, '/dashboard')).toBe('/dashboard')
  })
})

describe('buildLoginRedirect', () => {
  it('builds an encoded /login?returnTo path', () => {
    expect(buildLoginRedirect('/diaspora/imports/new')).toBe('/login?returnTo=%2Fdiaspora%2Fimports%2Fnew')
    // Round-trips back to the original path via URLSearchParams.
    const url = new URL(buildLoginRedirect('/diaspora/imports/dio-1001/documents'), 'https://x.test')
    expect(url.searchParams.get('returnTo')).toBe('/diaspora/imports/dio-1001/documents')
  })
})

describe('getDashboardRoute', () => {
  it('maps roles to dashboards with an owner default', () => {
    expect(getDashboardRoute('dealer')).toBe('/dealer')
    expect(getDashboardRoute('mechanic')).toBe('/mechanic')
    expect(getDashboardRoute('admin')).toBe('/admin')
    expect(getDashboardRoute('owner')).toBe('/dashboard')
    expect(getDashboardRoute('whatever')).toBe('/dashboard')
  })
})

describe('resolvePostLoginRoute', () => {
  it('returns a safe returnTo when present', () => {
    expect(resolvePostLoginRoute('/diaspora/imports/new', 'owner')).toBe('/diaspora/imports/new')
  })

  it('falls back to the role dashboard when returnTo is absent', () => {
    expect(resolvePostLoginRoute(null, 'owner')).toBe('/dashboard')
    expect(resolvePostLoginRoute(null, 'dealer')).toBe('/dealer')
  })

  it('ignores an unsafe returnTo and falls back to the role dashboard', () => {
    expect(resolvePostLoginRoute('//evil.com', 'dealer')).toBe('/dealer')
    expect(resolvePostLoginRoute('http://evil.com', 'admin')).toBe('/admin')
    expect(resolvePostLoginRoute('/\\evil.com', 'owner')).toBe('/dashboard')
  })
})
