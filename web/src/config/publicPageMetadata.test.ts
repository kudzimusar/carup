import { describe, expect, it, vi } from 'vitest'
import { pageMetadata, publicListingMetadata, renderMetadata, SITEMAP_PATHS, canonicalListingUrl } from './publicPageMetadata'
import { PUBLIC_LAUNCH_ROUTES } from './publicLaunchPolicy'
import { resolveDocument, documentHtml } from '../../api/public-page'

const listing = { vin: 'TEST-123', public_status: 'public', year: 2016, make: 'Nissan', model: 'Serena', price: 9000, currency: 'USD' }
const respond = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('crawler-visible public identity and fail-closed listing projection', () => {
  it('ships canonical OG/Twitter metadata before JavaScript and escapes seller-authored values', () => {
    const meta = publicListingMetadata({ ...listing, model: '<script>alert(1)</script>' }, 'TEST-123', false)!
    const html = documentHtml('<html><head><title>Old</title></head><body><div id="root"></div></body></html>', meta)
    expect(html).toContain('https://carup.dev/marketplace/TEST-123')
    expect(html).toContain('og:title')
    expect(html).toContain('twitter:card')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('<title>Old')
    expect(html).not.toContain('vercel.app')
  })
  it('serves every declared static launch route directly, including support and security outside the feature registry', async () => {
    for (const row of PUBLIC_LAUNCH_ROUTES.filter(row => !row.route.includes(':') && row.route !== '*')) {
      const metadata = await resolveDocument(row.route, 'https://api-staging.carup.dev', true)
      expect(metadata.status, row.route).toBe(200)
      expect(metadata.robots, row.route).toBe('noindex, nofollow')
    }
    expect(pageMetadata('/support', false).title).toBe('CarUp Support | CarUp')
    expect(pageMetadata('/security', false).title).toBe('Security guidance | CarUp')
    expect(pageMetadata('*', false).status).toBe(404)
  })
  it('never indexes private, auth, legal-draft, planned or absent routes', () => {
    for (const path of ['/dashboard', '/admin/communications', '/login', '/terms', '/privacy', '/api-docs', '/insurance', '/does-not-exist']) {
      expect(pageMetadata(path, false).robots, path).toBe('noindex, nofollow')
      expect(SITEMAP_PATHS).not.toContain(path)
    }
    expect(pageMetadata('/does-not-exist', false).status).toBe(404)
    expect(pageMetadata('/marketplace', true).robots).toBe('noindex, nofollow')
    expect(pageMetadata('/marketplace', false).robots).toBe('index, follow')
  })
  it('uses existing public endpoint without forwarding private auth/cookies', async () => {
    const fetcher = respond({ data: listing })
    const meta = await resolveDocument('/marketplace/TEST-123', 'https://api-staging.carup.dev', false, fetcher)
    expect(meta.status).toBe(200)
    expect(meta.description).toContain('USD 9,000')
    expect(fetcher).toHaveBeenCalledWith('https://api-staging.carup.dev/api/marketplace/listings/TEST-123', expect.objectContaining({ credentials: 'omit', headers: { accept: 'application/json' } }))
  })
  it.each([401, 403, 404, 410])('maps unavailable/private listing HTTP %s to a truthful unindexed 404', async status => {
    const meta = await resolveDocument('/marketplace/TEST-123', 'https://api-staging.carup.dev', false, respond({ private_name: 'NEVER-PROJECT' }, status))
    expect(meta.status).toBe(404)
    expect(meta.robots).toBe('noindex, nofollow')
    expect(renderMetadata(meta)).not.toContain('NEVER-PROJECT')
  })
  it.each(['draft', 'suppressed', 'pending_review', 'archived'])('never publishes %s data into social metadata', async public_status => {
    expect(publicListingMetadata({ ...listing, public_status }, 'TEST-123', false)).toBeNull()
    const meta = await resolveDocument('/marketplace/TEST-123', 'https://api-staging.carup.dev', false, respond({ ...listing, public_status }))
    expect(meta.status).toBe(404)
    expect(meta.title).not.toContain('Serena')
  })
  it('does not turn a timeout/server failure into a missing listing or fake success', async () => {
    const meta = await resolveDocument('/marketplace/TEST-123', 'https://api-staging.carup.dev', false, respond({}, 503))
    expect(meta.status).toBe(503)
    expect(meta.robots).toBe('noindex, nofollow')
  })
  it('rejects arbitrary API origins and does not fetch private workspace routes', async () => {
    const fetcher = respond(listing)
    expect((await resolveDocument('/marketplace/TEST-123', 'https://attacker.test', false, fetcher)).status).toBe(503)
    await resolveDocument('/dashboard', 'https://api-staging.carup.dev', false, fetcher)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('projects only public listing imagery, never signed/private evidence or generated reference media', () => {
    const url = 'https://eoyenigwevnxwwhyhaer.supabase.co/storage/v1/object/public/listing-images/car.jpg'
    const withMedia = (image: string, synthetic_demo = false) => ({ ...listing, verified_evidence: { items: [{ url: 'PRIVATE-EVIDENCE' }] }, listing_media: { items: [{ url: image, is_primary: true, synthetic_demo }] } })
    expect(publicListingMetadata(withMedia(url), 'TEST-123')?.image).toBe(url)
    for (const unsafe of [url + '?token=secret', url.replace('listing-images', 'vehicle-documents'), 'https://arbitrary.test/listing-images/car.jpg']) {
      expect(publicListingMetadata(withMedia(unsafe), 'TEST-123')?.image).toBeUndefined()
    }
    expect(publicListingMetadata(withMedia(url, true), 'TEST-123')?.image).toBeUndefined()
  })
  it('shares canonical listing paths without Preview hosts or seller-preview query parameters', () => {
    expect(canonicalListingUrl('TEST-123')).toBe('https://carup.dev/marketplace/TEST-123')
  })
})
