import { describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { launchDistribution } from './launchDistribution'
import { isIndexableDeployment } from '../src/config/publicPageMetadata'

function inspect(code: string, module: string, dynamic = false) {
  const entry = { type: 'chunk', isEntry: true, fileName: 'entry.js', code, imports: [], modules: { [module]: { renderedLength: code.length } } }
  const privateChunk = { ...entry, isEntry: false, fileName: 'private.js', modules: { '/repo/src/pages/dashboard/Private.tsx': { renderedLength: 12 } } }
  const bundle = dynamic ? { 'entry.js': entry, 'private.js': privateChunk } : { 'entry.js': entry }
  const plugin = launchDistribution()
  const hook = plugin.generateBundle as (this: { error: (message: string) => never; emitFile: ReturnType<typeof vi.fn> }, options: Record<string, never>, output: typeof bundle) => void
  const emitFile = vi.fn()
  hook.call({ error: (message: string) => { throw new Error(message) }, emitFile }, {}, bundle)
  return emitFile
}
describe('public entry distribution guard', () => {
  it('renders Home canonical and social identity in the physical root document', () => {
    const plugin = launchDistribution()
    const transform = plugin.transformIndexHtml as (html: string) => string
    const html = transform('<html><head><title>Generic shell</title><meta name="description" content="old"></head></html>')
    expect(html).toContain('https://carup.dev/')
    expect(html).toContain('property="og:title"')
    expect(html).toContain('noindex, nofollow')
    expect(html).not.toContain('Generic shell')
    expect(html.match(/<title>/g)).toHaveLength(1)
  })
  it('rejects an eager private/operator page', () => {
    expect(() => inspect('private()', '/repo/src/pages/dashboard/Private.tsx')).toThrow('Private/operator pages')
    expect(() => inspect('operator()', '/repo/src/pages/diaspora/Private.tsx')).toThrow('Private/operator pages')
  })
  it('allows deferred private chunks and emits the measurable budget receipt', () => {
    const emit = inspect('public()', '/repo/src/pages/Landing.tsx', true)
    expect(emit.mock.calls[0][0].fileName).toBe('.vite/launch-budget.json')
    expect(JSON.parse(emit.mock.calls[0][0].source).deferredChunks).toBe(1)
  })
  it('rejects initial transfer beyond its quantitative limit', () => {
    expect(() => inspect(randomBytes(900000).toString('base64'), '/repo/src/pages/Landing.tsx')).toThrow('exceeds')
  })
})

describe('search indexing is limited to the CarUp production project (OC-LAUNCH R1)', () => {
  const robotsFor = (env: Record<string, string>) => {
    vi.stubEnv('VERCEL_ENV', env.VERCEL_ENV ?? '')
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', env.VERCEL_PROJECT_PRODUCTION_URL ?? '')
    try {
      const emitted = inspect('public()', '/repo/src/pages/Landing.tsx', true).mock.calls.map(call => call[0])
      const transform = launchDistribution().transformIndexHtml as (html: string) => string
      return {
        robots: emitted.find(file => file.fileName === 'robots.txt').source as string,
        sitemap: emitted.find(file => file.fileName === 'sitemap.xml').source as string,
        home: transform('<html><head><title>x</title></head></html>'),
      }
    } finally { vi.unstubAllEnvs() }
  }
  it('indexes carup.dev production: crawlable robots, sitemap and index Home', () => {
    const out = robotsFor({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'carup.dev' })
    expect(out.robots).toContain('Sitemap: https://carup.dev/sitemap.xml')
    expect(out.robots).toContain('Disallow: /dashboard')
    expect(out.robots).not.toMatch(/Disallow: \/\n/)
    expect(out.home).toContain('index, follow')
    expect(out.home).toContain('<link rel="canonical" href="https://carup.dev/"')
    expect(out.sitemap).toContain('<loc>https://carup.dev/marketplace</loc>')
    expect(out.sitemap).not.toContain('/dashboard')
  })
  it.each([
    ['a preview deployment', { VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'carup.dev' }],
    ['the staging project production target', { VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'staging.carup.dev' }],
    ['a production build that cannot name its project domain', { VERCEL_ENV: 'production' }],
    ['a local build', {}],
  ])('keeps %s out of search', (_label, env) => {
    const out = robotsFor(env as Record<string, string>)
    expect(out.robots).toBe('User-agent: *\nDisallow: /\n')
    expect(out.home).toContain('noindex, nofollow')
  })
  it('accepts only carup.dev hosts as the indexable production domain', () => {
    expect(isIndexableDeployment({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'www.carup.dev' })).toBe(true)
    expect(isIndexableDeployment({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'https://carup.dev/' })).toBe(true)
    expect(isIndexableDeployment({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'carup.dev.evil.example' })).toBe(false)
    expect(isIndexableDeployment({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'carup-staging.vercel.app' })).toBe(false)
  })
})
