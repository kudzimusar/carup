import { expect, test, type Page, type TestInfo } from '@playwright/test'

const GOLDEN_VIN = 'CARUPGLDNA0000001'
const EXPECTED_SHA = process.env.MARKETPLACE_EXPECTED_SHA || ''

const PRIVATE_RESPONSE_KEYS = new Set([
  'uploaded_by',
  'verified_by',
  'uploader_role',
  'verification_notes',
  'tenant_id',
  'source_id',
  'file_path',
  'storage_bucket',
])

type Listing = {
  vin: string
  make?: string | null
  model?: string | null
  year?: number | null
  fuel_type?: string | null
  transmission?: string | null
  location?: string | null
  primary_image_url?: string | null
  claims?: {
    publication?: {
      publication_status?: { value?: string | null }
    }
  }
}

type ListingEnvelope = {
  listings?: Listing[]
  total?: number
}

function findForbiddenKeys(value: unknown, path = '$', hits: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findForbiddenKeys(entry, `${path}[${index}]`, hits))
    return hits
  }
  if (!value || typeof value !== 'object') return hits

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`
    if (PRIVATE_RESPONSE_KEYS.has(key)) hits.push(childPath)
    findForbiddenKeys(child, childPath, hits)
  }
  return hits
}

function installDiagnostics(page: Page) {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const criticalApiFailures: string[] = []

  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('response', (response) => {
    const url = response.url()
    if (url.includes('/api/marketplace/') && response.status() >= 400) {
      criticalApiFailures.push(`${response.status()} ${url}`)
    }
  })

  return { pageErrors, consoleErrors, criticalApiFailures }
}

async function attachDiagnostics(testInfo: TestInfo, diagnostics: ReturnType<typeof installDiagnostics>) {
  await testInfo.attach('browser-diagnostics.json', {
    body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
    contentType: 'application/json',
  })
}

async function assertCriticalBrowserHealth(
  testInfo: TestInfo,
  diagnostics: ReturnType<typeof installDiagnostics>,
) {
  await attachDiagnostics(testInfo, diagnostics)
  expect(diagnostics.pageErrors, 'uncaught browser errors').toEqual([])
  expect(diagnostics.criticalApiFailures, 'critical Marketplace API failures').toEqual([])
}

async function assertActualBackendProvenance(page: Page, marketplaceResponseUrl: string) {
  if (!EXPECTED_SHA) throw new Error('MARKETPLACE_EXPECTED_SHA is required for staging certification')
  const apiOrigin = new URL(marketplaceResponseUrl).origin
  const healthResponse = await page.request.get(`${apiOrigin}/api/health`)
  expect(healthResponse.ok(), 'actual Marketplace API origin health endpoint').toBe(true)
  const health = await healthResponse.json() as { build?: { commit_sha?: string; provenance_available?: boolean } }
  expect(health.build?.commit_sha, 'backend deployed commit SHA').toBe(EXPECTED_SHA)
  expect(health.build?.provenance_available, 'backend build provenance available').toBe(true)
}

async function loadMarketplace(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => {
      const url = new URL(candidate.url())
      return url.pathname === '/api/marketplace/listings' && candidate.request().method() === 'GET'
    }),
    page.goto('/marketplace', { waitUntil: 'domcontentloaded' }),
  ])
  expect(response.ok(), 'public Marketplace list response').toBe(true)
  const body = await response.json() as ListingEnvelope
  expect(body.listings?.length ?? 0, 'real public staging listings').toBeGreaterThan(0)
  await expect(page.getByTestId('marketplace-vehicle-card').first()).toBeVisible()
  return { response, body }
}

test('desktop staging: published-only discovery preserves Marketplace → Vehicle Detail truth', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const diagnostics = installDiagnostics(page)
  const { response, body } = await loadMarketplace(page)

  await assertActualBackendProvenance(page, response.url())
  expect(findForbiddenKeys(body), 'private/internal keys in public list response').toEqual([])
  for (const listing of body.listings ?? []) {
    expect(
      listing.claims?.publication?.publication_status?.value,
      `publication status for ${listing.vin}`,
    ).toBe('published')
  }

  await expect(page.getByText(/Published listings only/i)).toBeVisible()
  const goldenCard = page.getByTestId('marketplace-vehicle-card').filter({
    has: page.locator(`[data-testid="marketplace-view-passport"][href="/marketplace/${GOLDEN_VIN}"]`),
  })
  await expect(goldenCard, `golden staging vehicle ${GOLDEN_VIN}`).toHaveCount(1)
  await goldenCard.scrollIntoViewIfNeeded()

  const cardImage = goldenCard.locator('img').first()
  await expect(cardImage, 'golden listing card image').toBeVisible()
  await expect.poll(() => cardImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  const cardImageUrl = await cardImage.getAttribute('src')
  expect(cardImageUrl).toBeTruthy()

  await page.screenshot({ path: testInfo.outputPath('desktop-marketplace.png'), fullPage: true })

  const detailResponsePromise = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url())
    return url.pathname === `/api/marketplace/listings/${GOLDEN_VIN}`
  })
  await goldenCard.getByTestId('marketplace-view-passport').click()
  const detailResponse = await detailResponsePromise
  expect(detailResponse.ok(), 'golden Marketplace detail response').toBe(true)
  const detailBody = await detailResponse.json() as Record<string, unknown>
  expect(findForbiddenKeys(detailBody), 'private/internal keys in public detail response').toEqual([])

  await expect(page).toHaveURL(new RegExp(`/marketplace/${GOLDEN_VIN}$`))
  await expect(page.getByTestId('marketplace-detail-panels')).toBeVisible()
  await expect(page.getByTestId('listing-media-block')).toBeVisible()
  const detailImage = page.getByTestId('vehicle-image')
  await expect(detailImage).toBeVisible()
  await expect.poll(() => detailImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  expect(await detailImage.getAttribute('src'), 'same primary photo across discovery and detail').toBe(cardImageUrl)

  await expect(page.getByTestId('trust-score-badge')).toBeVisible()
  // Public Marketplace detail deliberately renders before optional passport enrichment. Privacy
  // certification therefore binds to the public response and the seller-redaction surface that are
  // authoritative at first render, rather than racing a passport-only marker that may arrive later.
  const sellerSummary = detailBody.seller_summary as {
    display_label?: string | null
    public_profile_enabled?: boolean
  } | undefined
  expect(sellerSummary?.public_profile_enabled, 'golden private seller public profile').toBe(false)
  expect(sellerSummary?.display_label, 'golden private seller public display label').toBeNull()
  await expect(page.getByTestId('seller-name')).toHaveText('Not shown publicly')
  await expect(page.getByText('Not recorded').first()).toBeVisible()

  await page.screenshot({ path: testInfo.outputPath('desktop-vehicle-detail.png'), fullPage: true })
  await assertCriticalBrowserHealth(testInfo, diagnostics)
})

test('staging facets are executed by the backend against real listing data', async ({ page }, testInfo) => {
  const diagnostics = installDiagnostics(page)
  const { body } = await loadMarketplace(page)
  const seed = (body.listings ?? []).find((listing) => listing.location && listing.fuel_type && listing.transmission)
  expect(seed, 'a real listing with location, fuel and transmission for facet certification').toBeTruthy()

  const query = new URLSearchParams({
    location: seed!.location!,
    fuel: seed!.fuel_type!,
    transmission: seed!.transmission!,
  })
  const responsePromise = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url())
    return url.pathname === '/api/marketplace/listings'
      && url.searchParams.get('location') === seed!.location
      && url.searchParams.get('fuel') === seed!.fuel_type
      && url.searchParams.get('transmission') === seed!.transmission
  })
  await page.goto(`/marketplace?${query.toString()}`, { waitUntil: 'domcontentloaded' })
  const response = await responsePromise
  expect(response.ok()).toBe(true)
  const filtered = await response.json() as ListingEnvelope
  expect(filtered.listings?.length ?? 0, 'real filtered listings').toBeGreaterThan(0)

  for (const listing of filtered.listings ?? []) {
    expect(listing.location).toBe(seed!.location)
    expect(listing.fuel_type).toBe(seed!.fuel_type)
    expect(listing.transmission).toBe(seed!.transmission)
    expect(listing.claims?.publication?.publication_status?.value).toBe('published')
  }

  await page.screenshot({ path: testInfo.outputPath('desktop-filtered-marketplace.png'), fullPage: true })
  await assertCriticalBrowserHealth(testInfo, diagnostics)
})

test('site-relative staging media resolves or degrades to an explicit delivery-failure state', async ({ page }, testInfo) => {
  const diagnostics = installDiagnostics(page)
  const { body } = await loadMarketplace(page)
  const relative = (body.listings ?? []).find((listing) => listing.primary_image_url?.startsWith('/'))
  expect(relative, 'a real site-relative staging media fixture').toBeTruthy()

  const card = page.getByTestId('marketplace-vehicle-card').filter({
    has: page.locator(`[data-testid="marketplace-view-passport"][href="/marketplace/${relative!.vin}"]`),
  })
  await expect(card).toHaveCount(1)
  await card.scrollIntoViewIfNeeded()

  await expect.poll(async () => {
    const placeholder = card.getByTestId('listing-image-placeholder')
    if (await placeholder.isVisible().catch(() => false)) return true
    const image = card.locator('img').first()
    if (!(await image.isVisible().catch(() => false))) return false
    return (await image.evaluate((element: HTMLImageElement) => element.naturalWidth)) > 0
  }, { message: 'Marketplace card must never settle on a broken image glyph' }).toBe(true)

  await card.getByTestId('marketplace-view-passport').click()
  await expect(page).toHaveURL(new RegExp(`/marketplace/${relative!.vin}$`))
  await expect(page.getByTestId('listing-media-block')).toBeVisible()

  await expect.poll(async () => {
    if (await page.getByTestId('listing-media-load-failed').isVisible().catch(() => false)) return true
    const image = page.getByTestId('vehicle-image')
    if (!(await image.isVisible().catch(() => false))) return false
    return (await image.evaluate((element: HTMLImageElement) => element.naturalWidth)) > 0
  }, { message: 'Vehicle Detail must resolve site-relative media or fail closed with explicit delivery state' }).toBe(true)

  if (await page.getByTestId('listing-media-load-failed').isVisible().catch(() => false)) {
    await expect(page.getByTestId('vehicle-image')).toHaveCount(0)
    await expect(page.getByTestId('no-images-placeholder')).toHaveAttribute('data-media-state', 'published_unavailable')
    await expect(page.getByTestId('listing-media-not-loaded')).toHaveCount(0)
  }

  await page.screenshot({ path: testInfo.outputPath('desktop-site-relative-media.png'), fullPage: true })
  await assertCriticalBrowserHealth(testInfo, diagnostics)
})

test('mobile staging keeps filters actionable and Vehicle Detail inside the viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const diagnostics = installDiagnostics(page)
  await loadMarketplace(page)

  await page.getByTestId('marketplace-mobile-filter-button').click()
  await expect(page.getByTestId('marketplace-mobile-filter-drawer')).toBeVisible()
  await expect(page.getByTestId('marketplace-make-filter')).toBeVisible()
  await expect(page.getByTestId('marketplace-trust-group')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('mobile-filter-drawer.png'), fullPage: true })
  await page.getByTestId('marketplace-mobile-filter-close').click()

  const goldenCard = page.getByTestId('marketplace-vehicle-card').filter({
    has: page.locator(`[data-testid="marketplace-view-passport"][href="/marketplace/${GOLDEN_VIN}"]`),
  })
  await goldenCard.getByTestId('marketplace-view-passport').click()
  await expect(page).toHaveURL(new RegExp(`/marketplace/${GOLDEN_VIN}$`))
  await expect(page.getByTestId('listing-media-block')).toBeVisible()
  try {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), {
      message: 'mobile Vehicle Detail must not overflow horizontally',
    }).toBe(true)
  } catch (error) {
    const overflow = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      elements: Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .map((element) => {
          const rect = element.getBoundingClientRect()
          return {
            tag: element.tagName,
            testId: element.dataset.testid || null,
            className: typeof element.className === 'string' ? element.className : '',
            text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160),
            left: rect.left,
            right: rect.right,
            width: rect.width,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          }
        })
        .filter((entry) => entry.right > window.innerWidth + 1)
        .slice(0, 40),
    }))
    await testInfo.attach('mobile-horizontal-overflow.json', {
      body: Buffer.from(JSON.stringify(overflow, null, 2)),
      contentType: 'application/json',
    })
    throw error
  }

  await page.screenshot({ path: testInfo.outputPath('mobile-vehicle-detail.png'), fullPage: true })
  await assertCriticalBrowserHealth(testInfo, diagnostics)
})
