import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRODUCTION_API_BASE_URL,
  DEFAULT_STAGING_API_BASE_URL,
  resolveApiBaseUrl,
} from './apiClient'

describe('resolveApiBaseUrl staging host safety', () => {
  it('keeps the stable staging frontend on the staging backend when VITE_API_URL is missing', () => {
    expect(resolveApiBaseUrl(undefined, 'carup-staging.vercel.app'))
      .toBe(DEFAULT_STAGING_API_BASE_URL)
  })

  it('keeps Vercel staging branch and deployment aliases on the staging backend', () => {
    expect(resolveApiBaseUrl(undefined, 'carup-staging-git-feat-owner-dashboard-electric-redesign-11-11.vercel.app'))
      .toBe(DEFAULT_STAGING_API_BASE_URL)
    expect(resolveApiBaseUrl(undefined, 'carup-staging-3xmzmf9zx-11-11.vercel.app'))
      .toBe(DEFAULT_STAGING_API_BASE_URL)
    expect(resolveApiBaseUrl(undefined, 'carup-staging-pay-pass-project.vercel.app'))
      .toBe(DEFAULT_STAGING_API_BASE_URL)
  })

  it('does not change the production fallback for the production frontend', () => {
    expect(resolveApiBaseUrl(undefined, 'carup.vercel.app'))
      .toBe(DEFAULT_PRODUCTION_API_BASE_URL)
  })

  it('still gives an explicit VITE_API_URL highest precedence', () => {
    expect(resolveApiBaseUrl('https://example-staging-api.test', 'carup-staging.vercel.app'))
      .toBe('https://example-staging-api.test/api')
  })
})
