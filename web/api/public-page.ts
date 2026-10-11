import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pageMetadata, publicListingMetadata, renderMetadata, escapeHtml, type PublicPageMetadata } from '../src/config/publicPageMetadata.js'

/** Same HTML for people and crawlers. Only an unauthenticated public projection is fetched. */
export async function resolveDocument(path: string, apiBase: string | undefined, staging: boolean, fetcher: typeof fetch = fetch): Promise<PublicPageMetadata> {
  const base = pageMetadata(path, staging)
  const listing = /^\/marketplace\/([A-Za-z0-9][A-Za-z0-9-]{2,63})$/.exec(path)
  const garage = /^\/garages\/([A-Za-z0-9][A-Za-z0-9-]{1,80})$/.exec(path)
  if ((!listing || ['parts', 'services', 'compare', 'saved'].includes(listing[1])) && !garage) return base
  const unavailable = (status: number): PublicPageMetadata => ({
    title: status === 503 ? 'Listing temporarily unavailable | CarUp' : 'Page not available | CarUp',
    description: status === 503 ? 'Current information could not be loaded. Please try again.' : 'This public page is not available. Browse Marketplace for current listings.',
    canonicalPath: path, robots: 'noindex, nofollow', status,
  })
  let origin: URL
  try {
    origin = new URL(apiBase || '')
    if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.username || origin.password
      || !/^(?:api(?:-staging)?\.carup\.dev|carup-backend-staging-[a-z0-9-]+\.vercel\.app)$/.test(origin.hostname)) return unavailable(503)
  } catch { return unavailable(503) }
  const endpoint = listing ? `/api/marketplace/listings/${encodeURIComponent(listing[1])}` : `/api/garage-directory/${encodeURIComponent(garage![1])}`
  try {
    const response = await fetcher(`${origin.origin}${endpoint}`, { signal: AbortSignal.timeout(3500), headers: { accept: 'application/json' }, credentials: 'omit' })
    if ([401, 403, 404, 410].includes(response.status)) return unavailable(404)
    if (!response.ok) return unavailable(503)
    const body = await response.json()
    const data = body.data ?? body
    if (listing) return publicListingMetadata(data, listing[1], staging) ?? unavailable(404)
    // The directory endpoint already governs public visibility. Do not project contacts/evidence.
    const profile = data.garage ?? data
    if (!profile || typeof profile.name !== 'string') return unavailable(404)
    return { ...base, title: `${profile.name.slice(0,100)} | CarUp`, description: 'Read this published garage profile and its recorded service information.', robots: staging ? 'noindex, nofollow' : 'index, follow', status: 200 }
  } catch { return unavailable(503) }
}
export function documentHtml(shell: string, metadata: PublicPageMetadata): string {
  const head = renderMetadata(metadata)
  return shell.replace(/<title>[\s\S]*?<\/title>|<meta\s+(?:name="(?:description|robots|twitter:[^"]+)"|property="og:[^"]+")[^>]*>|<link\s+rel="canonical"[^>]*>/g, '')
    .replace('</head>', `${head}</head>`)
    .replace('</body>', `<noscript><main><h1>${escapeHtml(metadata.title)}</h1><p>${escapeHtml(metadata.description)}</p><a href="/marketplace">Browse Marketplace</a></main></noscript></body>`)
}
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const request = new URL(req.url || '/', 'https://carup.dev')
  const raw = request.searchParams.get('path') || ''
  const path = `/${raw.replace(/^\/+/, '')}`
  if (path.length > 2048 || /[\x00-\x1f\\]/.test(path)) { res.writeHead(400); res.end(); return }
  const staging = process.env.VERCEL_ENV !== 'production'
  const metadata = await resolveDocument(path, process.env.CARUP_PUBLIC_API_BASE_URL, staging)
  const shell = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('X-Robots-Tag', metadata.robots)
  res.setHeader('Cache-Control', metadata.robots.startsWith('noindex') ? 'private, no-store' : 'public, max-age=0, s-maxage=60, stale-while-revalidate=300')
  res.statusCode = metadata.status
  res.end(documentHtml(shell, metadata))
}
