import { describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { launchDistribution } from './launchDistribution'

function inspect(code: string, module: string, dynamic = false) {
  const entry = { type: 'chunk', isEntry: true, fileName: 'entry.js', code, imports: [], modules: { [module]: { renderedLength: code.length } } }
  const privateChunk = { ...entry, isEntry: false, fileName: 'private.js', modules: { '/repo/src/pages/dashboard/Private.tsx': { renderedLength: 12 } } }
  const bundle = dynamic ? { 'entry.js': entry, 'private.js': privateChunk } : { 'entry.js': entry }
  const plugin = launchDistribution()
  const hook = plugin.generateBundle as Function
  const emitFile = vi.fn()
  hook.call({ error: (message: string) => { throw new Error(message) }, emitFile }, {}, bundle)
  return emitFile
}
describe('public entry distribution guard', () => {
  it('renders Home canonical and social identity in the physical root document', () => {
    const plugin = launchDistribution()
    const transform = plugin.transformIndexHtml as Function
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
