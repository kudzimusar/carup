import { getFeatureByRoute } from './featureRegistry.js'
import { PUBLIC_LAUNCH_ROUTES } from './publicLaunchPolicy.js'

export const CANONICAL_ORIGIN = 'https://carup.dev'
/**
 * Search indexing is allowed ONLY on the CarUp production project, whose production domain is
 * carup.dev. `VERCEL_ENV === 'production'` alone is not enough: the staging project's own
 * production target (staging.carup.dev / carup-staging.vercel.app) is also "production" to Vercel
 * and must stay noindex. `VERCEL_PROJECT_PRODUCTION_URL` is Vercel's per-project production domain.
 */
export const INDEXABLE_PRODUCTION_HOST = 'carup.dev'
export function isIndexableDeployment(env: { VERCEL_ENV?: string; VERCEL_PROJECT_PRODUCTION_URL?: string }): boolean {
  if (env.VERCEL_ENV !== 'production') return false
  const host = String(env.VERCEL_PROJECT_PRODUCTION_URL ?? '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/[/:].*$/, '')
  return host === INDEXABLE_PRODUCTION_HOST || host === `www.${INDEXABLE_PRODUCTION_HOST}`
}
export type PublicPageMetadata = { title: string; description: string; canonicalPath: string; robots: string; status: number; image?: string }
const DISCOVERY: Record<string, [string, string]> = {
  '/': ['Find your next car | CarUp', 'Browse published cars, compare prices and locations, and read the Vehicle Passport. Know the car. Trust the journey.'],
  '/marketplace': ['Cars for sale | CarUp', 'Browse published vehicle listings. Compare seller-stated facts, price and location, then read the available evidence.'],
  '/support': ['CarUp Support | CarUp', 'Find current account and listing guidance and approved CarUp support contact information.'],
  '/security': ['Security guidance | CarUp', 'Read current CarUp security guidance and the approved address for reporting a security concern.'],
  '/dealers': ['Find a dealer | CarUp', 'Browse current dealer profiles and their published listings.'],
  '/garages': ['Find a garage | CarUp', 'Discover published garage profiles and available service information.'],
  '/marketplace/parts': ['Find vehicle parts | CarUp', 'Browse current parts listings and recorded fitment information.'],
  '/marketplace/services': ['Find vehicle services | CarUp', 'Discover current vehicle service listings and published providers.'],
}
export const SITEMAP_PATHS = PUBLIC_LAUNCH_ROUTES.filter(row =>
  ['LAUNCH_ACTIVE', 'LAUNCH_ACTIVE_WITH_LIMIT'].includes(row.state)
  && !row.route.includes(':') && row.route !== '*' && !['/search', '/sell'].includes(row.route)).map(row => row.route)

/**
 * CA-K3-01 — the Corporate Admin workspace is a private, authenticated shell (its fail-closed gate is
 * CorporateLayout); it is not a feature-registry route. Only its ten exact destinations are real pages:
 * they serve 200 as a private workspace, never indexed. Any other /corporate path stays not found.
 */
const CORPORATE_WORKSPACE_ROUTE = /^\/corporate(?:\/(?:business-units|finance|growth|operations|trust-risk|data-intelligence|people-access|reports|platform))?$/

export function pageMetadata(path: string, staging = true): PublicPageMetadata {
  if (CORPORATE_WORKSPACE_ROUTE.test(path)) {
    return { title: 'CarUp Corporate Admin', description: 'Sign in to access the CarUp Corporate Admin workspace.', canonicalPath: path, robots: 'noindex, nofollow', status: 200 }
  }
  const feature = getFeatureByRoute(path)
  const exposure = PUBLIC_LAUNCH_ROUTES.find(row => row.route === path && row.route !== '*')
  const publicActive = !feature?.requiresAuth && exposure
    && ['LAUNCH_ACTIVE', 'LAUNCH_ACTIVE_WITH_LIMIT'].includes(exposure.state)
    && !['/search', '/sell'].includes(path)
  const [title, description] = DISCOVERY[path] ?? (feature?.requiresAuth
    ? ['Your account | CarUp', 'Sign in to access your private CarUp workspace.']
    : feature ? [`${feature.label} | CarUp`, 'Know the car. Trust the journey. Explore current CarUp information.']
      : ['Page not found | CarUp', 'This page is not available. Browse Marketplace or return to CarUp Home.'])
  return { title, description, canonicalPath: path, robots: staging || !publicActive ? 'noindex, nofollow' : 'index, follow', status: feature || exposure ? 200 : 404 }
}
export function canonicalListingUrl(id: string): string {
  return `${CANONICAL_ORIGIN}/marketplace/${encodeURIComponent(id)}`
}
export function publicListingMetadata(data: Record<string, unknown>, id: string, staging = true): PublicPageMetadata | null {
  if (data.public_status !== 'public' || data.vin !== id) return null
  const name = [data.year, data.make, data.model].filter(value => typeof value === 'string' || typeof value === 'number').join(' ').trim() || 'Vehicle'
  const price = typeof data.price === 'number' && Number.isFinite(data.price) && data.price >= 0 && typeof data.currency === 'string'
    ? `${data.currency} ${data.price.toLocaleString('en-US')}` : null
  const description = [name, price, 'Read the published listing and Vehicle Passport on CarUp.'].filter(Boolean).join(' · ')
  const media = data.listing_media as { items?: Array<Record<string, unknown>> } | undefined
  const primary = media?.items?.find(item => item.is_primary === true && item.synthetic_demo !== true)
  let image: string | undefined
  if (typeof primary?.url === 'string') {
    try {
      const url = new URL(primary.url)
      // Listing media only; never an evidence/document block, signed URL or arbitrary seller URL.
      if (url.protocol === 'https:' && !url.search && !url.username && !url.password
        && /(?:\.supabase\.co|\.r2\.dev)$/.test(url.hostname)
        && /\/(?:listing-images|listing-media)\//.test(url.pathname)
        && !/(?:evidence|documents|private|signed)/i.test(url.pathname)) image = url.href
    } catch { /* Invalid/unproven media is omitted, never substituted. */ }
  }
  return { title: `${name} | CarUp`, description, canonicalPath: `/marketplace/${encodeURIComponent(id)}`, robots: staging ? 'noindex, nofollow' : 'index, follow', status: 200, image }
}
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
export function renderMetadata(meta: PublicPageMetadata): string {
  const esc = escapeHtml
  const url = `${CANONICAL_ORIGIN}${meta.canonicalPath}`
  return `<title>${esc(meta.title)}</title><meta name="description" content="${esc(meta.description)}"><link rel="canonical" href="${esc(url)}"><meta name="robots" content="${meta.robots}"><meta property="og:type" content="website"><meta property="og:title" content="${esc(meta.title)}"><meta property="og:description" content="${esc(meta.description)}"><meta property="og:url" content="${esc(url)}"><meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${esc(meta.title)}"><meta name="twitter:description" content="${esc(meta.description)}">${meta.image ? `<meta property="og:image" content="${esc(meta.image)}"><meta name="twitter:image" content="${esc(meta.image)}">` : ''}`
}
