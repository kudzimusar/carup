import { gzipSync } from 'node:zlib'
import type { Plugin } from 'vite'
import type { OutputChunk } from 'rollup'
import { CANONICAL_ORIGIN, SITEMAP_PATHS, pageMetadata, renderMetadata } from '../src/config/publicPageMetadata'

/** Quantitative public-entry guard: baseline main gzip 962.68 kB; budget includes static dependencies. */
export const PUBLIC_INITIAL_GZIP_BUDGET = 550_000
export function launchDistribution(): Plugin {
  return {
    name: 'carup-launch-distribution',
    transformIndexHtml(html) {
      // Vercel serves the physical root index before fallback rewrites.
      return html.replace(/<title>[\s\S]*?<\/title>|<meta\s+name="(?:description|robots)"[^>]*>/g, '')
        .replace('</head>', `${renderMetadata(pageMetadata('/', process.env.VERCEL_ENV !== 'production'))}</head>`)
    },
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find(item => item.type === 'chunk' && item.isEntry) as OutputChunk | undefined
      if (!entry) this.error('Public application entry is missing')
      const initial = new Set<string>()
      const visit = (name: string) => {
        if (initial.has(name)) return
        initial.add(name)
        const item = bundle[name]
        if (item?.type === 'chunk') item.imports.forEach(visit)
      }
      visit(entry!.fileName)
      const chunks = [...initial].map(name => bundle[name]).filter((item): item is OutputChunk => item?.type === 'chunk')
      const modules = chunks.flatMap(chunk => Object.entries(chunk.modules).filter(([, value]) => value.renderedLength > 0).map(([id]) => id.replace(/\\/g, '/')))
      const forbidden = modules.filter(id => /\/src\/pages\/(?:dashboard|diaspora)\//.test(id))
      const gzipBytes = chunks.reduce((sum, chunk) => sum + gzipSync(chunk.code).length, 0)
      if (forbidden.length) this.error(`Private/operator pages entered the public initial graph: ${forbidden.map(id => id.split('/src/')[1]).join(', ')}`)
      if (gzipBytes > PUBLIC_INITIAL_GZIP_BUDGET) this.error(`Public initial JS gzip ${gzipBytes} exceeds ${PUBLIC_INITIAL_GZIP_BUDGET}`)
      this.emitFile({ type: 'asset', fileName: '.vite/launch-budget.json', source: JSON.stringify({ initialChunks: chunks.map(chunk => chunk.fileName), initialRawBytes: chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0), initialGzipBytes: gzipBytes, budgetGzipBytes: PUBLIC_INITIAL_GZIP_BUDGET, forbiddenModules: forbidden, deferredChunks: Object.values(bundle).filter(item => item.type === 'chunk' && !initial.has(item.fileName)).length }, null, 2) })
      const production = process.env.VERCEL_ENV === 'production'
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: production
        ? `User-agent: *\nDisallow: /dashboard\nDisallow: /admin\nDisallow: /dealer/\nDisallow: /mechanic\nDisallow: /government\nDisallow: /bank\nDisallow: /insurance-dash\nDisallow: /api/\nDisallow: /reports/\nDisallow: /s/\nDisallow: /settings\nDisallow: /search\nDisallow: /login\nDisallow: /register\nDisallow: /sell\nSitemap: ${CANONICAL_ORIGIN}/sitemap.xml\n`
        : 'User-agent: *\nDisallow: /\n' })
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${SITEMAP_PATHS.map(path => `<url><loc>${CANONICAL_ORIGIN}${path}</loc></url>`).join('')}</urlset>` })
    },
  }
}
