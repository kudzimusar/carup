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
  primary_image_state?: string | null
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
  await expect(page.getByTestId('marketplace-compact-header').getByRole('heading', { name: /Find the car\.\s*Know what stands behind it\./i })).toBeVisible()
  // Marketplace is inventory-first. Ecosystem explanation + Gutu AI belong to Home, not this surface.
  await expect(page.getByTestId('marketplace-ai-assistant-open')).toHaveCount(0)
  await expect(page.locator('a[href="/marketplace/parts"]').first()).toContainText('Parts')
  await expect(page.locator('a[href="/marketplace/services"]').first()).toContainText('Garages')
  await expect(page.locator('a[href="/diaspora"]').first()).toContainText('Imports')
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
  await expect(page.getByTestId('vehicle-detail-intelligence-hero')).toBeVisible()
  await expect(page.getByTestId('marketplace-detail-panels')).toBeVisible()
  await expect(page.getByTestId('listing-media-block')).toBeVisible()
  // Gallery-first means the car is physically above the Passport summary, not merely present.
  const galleryBox = await page.getByTestId('listing-media-block').boundingBox()
  const passportBox = await page.getByTestId('vehicle-detail-intelligence-hero').boundingBox()
  expect(galleryBox?.y ?? Number.POSITIVE_INFINITY, 'gallery vertical position').toBeLessThan(passportBox?.y ?? Number.NEGATIVE_INFINITY)
  await expect(page.getByTestId('vehicle-detail-compare')).toHaveAttribute('href', `/marketplace/compare?vins=${GOLDEN_VIN}`)
  await page.getByTestId('vehicle-detail-share').click()
  await expect(page.getByTestId('marketplace-share-sheet')).toBeVisible()
  for (const label of ['WhatsApp', 'Facebook', 'X', 'Email', 'Copy']) {
    await expect(page.getByTestId('marketplace-share-sheet').getByText(label, { exact: true })).toBeVisible()
  }
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('marketplace-share-sheet')).toBeHidden()
  await expect(page.getByTestId('vehicle-intelligence-story')).toBeVisible({ timeout: 15_000 })
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
  await expect(page.getByRole('button', { name: /Contact through CarUp/i })).toBeVisible()

  // Buyer actions must reflect the same governed boundaries as the API. Reservation status comes
  // only from reservation_summary; Vehicle Detail must never resurrect the legacy direct SafePay
  // button or a client-authored deposit. Financing is an inquiry until a real lender path exists.
  const reservationSummary = detailBody.reservation_summary as {
    state?: string
    reserved?: boolean | null
  } | undefined
  if (reservationSummary?.state === 'active' && reservationSummary.reserved === true) {
    await expect(page.getByTestId('reserved-state')).toBeVisible()
    await expect(page.getByTestId('reservation-request-entry')).toHaveCount(0)
  } else {
    await expect(page.getByTestId('reservation-request-entry')).toBeVisible()
    await expect(page.getByRole('button', { name: /Request reservation/i })).toBeVisible()
    await expect(page.getByTestId('reserved-state')).toHaveCount(0)
  }
  await expect(page.getByTestId('financing-request-entry')).toBeVisible()
  await expect(page.getByRole('button', { name: /Ask about financing/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Reserve with SafePay/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Apply for financing$/i })).toHaveCount(0)
  await expect(page.getByText(/Loan Amount \(USD\)/i)).toHaveCount(0)

  // One VIN, one lifecycle truth. Both the Passport and History Report must expose the same
  // normalized ownership/service/inspection/mileage story for Golden A.
  const apiOrigin = new URL(detailResponse.url()).origin
  const [passportResponse, reportResponse] = await Promise.all([
    page.request.get(`${apiOrigin}/api/vehicles/${GOLDEN_VIN}/passport`),
    page.request.get(`${apiOrigin}/api/vehicles/${GOLDEN_VIN}/report`),
  ])
  expect(passportResponse.ok(), 'golden public Passport').toBe(true)
  expect(reportResponse.ok(), 'golden public History Report').toBe(true)
  const passportBody = await passportResponse.json() as {
    lifecycle?: {
      projection_version?: string
      counts?: Record<string, number>
      mileage?: { observations?: Array<{ value?: number }> }
    }
  }
  const reportBody = await reportResponse.json() as {
    sections?: {
      accident_repair?: { accident?: number; repair?: number }
      ownership_transfer?: number
      inspection?: number
    }
    mileage_history?: { observations?: Array<{ value?: number }> }
    lifecycle_projection?: { version?: string; counts?: Record<string, number> }
  }
  expect(passportBody.lifecycle?.projection_version).toBeTruthy()
  expect(passportBody.lifecycle?.counts?.ownership_transfer ?? 0, 'Passport ownership transfers').toBeGreaterThanOrEqual(1)
  expect(passportBody.lifecycle?.counts?.repair ?? 0, 'Passport repair records').toBeGreaterThanOrEqual(1)
  expect(passportBody.lifecycle?.counts?.inspection ?? 0, 'Passport inspection records').toBeGreaterThanOrEqual(1)
  expect(passportBody.lifecycle?.counts?.accident ?? 0, 'administrative docs must not fabricate accidents').toBe(0)
  expect(passportBody.lifecycle?.mileage?.observations?.some(item => item.value === 78450)).toBe(true)

  expect(reportBody.lifecycle_projection?.version).toBe(passportBody.lifecycle?.projection_version)
  expect(reportBody.sections?.ownership_transfer ?? 0).toBe(passportBody.lifecycle?.counts?.ownership_transfer)
  expect(reportBody.sections?.accident_repair?.repair ?? 0).toBe(passportBody.lifecycle?.counts?.repair)
  expect(reportBody.sections?.accident_repair?.accident ?? 0).toBe(passportBody.lifecycle?.counts?.accident)
  expect(reportBody.sections?.inspection ?? 0).toBe(passportBody.lifecycle?.counts?.inspection)
  expect(reportBody.mileage_history?.observations?.some(item => item.value === 78450)).toBe(true)

  await page.getByRole('tab', { name: 'Vehicle History' }).click()
  await expect(page.getByTestId('history-timeline')).toHaveAttribute('data-history-source', 'canonical-lifecycle')
  await expect(page.locator('[data-lifecycle-category="ownership_transfer"]').first()).toBeVisible()
  await expect(page.locator('[data-lifecycle-category="repair"]').first()).toBeVisible()

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

test('published staging media resolves or degrades to an explicit delivery-failure state', async ({ page }, testInfo) => {
  const diagnostics = installDiagnostics(page)
  const { body } = await loadMarketplace(page)
  const withMedia = (body.listings ?? []).find((listing) => Boolean(listing.primary_image_url))
  expect(withMedia, 'a real staging listing with published media').toBeTruthy()

  const card = page.getByTestId('marketplace-vehicle-card').filter({
    has: page.locator(`[data-testid="marketplace-view-passport"][href="/marketplace/${withMedia!.vin}"]`),
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
  await expect(page).toHaveURL(new RegExp(`/marketplace/${withMedia!.vin}$`))
  await expect(page.getByTestId('listing-media-block')).toBeVisible()

  await expect.poll(async () => {
    if (await page.getByTestId('listing-media-load-failed').isVisible().catch(() => false)) return true
    const image = page.getByTestId('vehicle-image')
    if (!(await image.isVisible().catch(() => false))) return false
    return (await image.evaluate((element: HTMLImageElement) => element.naturalWidth)) > 0
  }, { message: 'Vehicle Detail must resolve published media or fail closed with explicit delivery state' }).toBe(true)

  if (await page.getByTestId('listing-media-load-failed').isVisible().catch(() => false)) {
    await expect(page.getByTestId('vehicle-image')).toHaveCount(0)
    await expect(page.getByTestId('no-images-placeholder')).toHaveAttribute('data-media-state', 'published_unavailable')
    await expect(page.getByTestId('listing-media-not-loaded')).toHaveCount(0)
  }

  await page.screenshot({ path: testInfo.outputPath('desktop-published-media.png'), fullPage: true })
  await assertCriticalBrowserHealth(testInfo, diagnostics)
})

test('desktop comparison never exposes transport nulls or broken image glyphs', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const diagnostics = installDiagnostics(page)
  const compareResponse = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url())
    return url.pathname === '/api/marketplace/compare' && candidate.request().method() === 'POST'
  })
  await page.goto(`/marketplace/compare?vins=${GOLDEN_VIN},JTNBU4EE0J9UAT101`, { waitUntil: 'domcontentloaded' })
  const response = await compareResponse
  expect(response.ok(), 'real compare response').toBe(true)

  await expect(page.getByTestId('marketplace-compare-page')).toBeVisible()
  await expect(page.getByText(/Null\s+[0-9]/i)).toHaveCount(0)
  expect(await page.getByText(/currency not recorded/i).count(), 'truthful missing-currency presentations').toBeGreaterThan(0)

  const imageContainers = page.getByTestId('marketplace-compare-page').locator('thead th').filter({ has: page.locator('a') })
  expect(await imageContainers.count()).toBeGreaterThanOrEqual(2)
  for (let index = 0; index < await imageContainers.count(); index += 1) {
    const header = imageContainers.nth(index)
    await expect.poll(async () => {
      const placeholder = header.getByTestId('listing-image-placeholder')
      if (await placeholder.isVisible().catch(() => false)) return true
      const image = header.locator('img').first()
      if (!(await image.isVisible().catch(() => false))) return false
      return (await image.evaluate((element: HTMLImageElement) => element.naturalWidth)) > 0
    }, { message: `comparison vehicle ${index + 1} must not show a broken image glyph` }).toBe(true)
  }

  await page.screenshot({ path: testInfo.outputPath('desktop-compare.png'), fullPage: true })
  await assertCriticalBrowserHealth(testInfo, diagnostics)
})

test('tablet staging switches to the compact app shell instead of the desktop footer', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 820, height: 1180 })
  const diagnostics = installDiagnostics(page)
  await loadMarketplace(page)

  const compactNav = page.getByTestId('compact-bottom-nav')
  await expect(compactNav).toBeVisible()
  await expect(page.locator('footer')).toBeHidden()
  await expect(page.getByTestId('marketplace-compact-header').getByRole('heading', { name: /Find the car\.\s*Know what stands behind it\./i })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), {
    message: 'tablet Marketplace must not overflow horizontally',
  }).toBe(true)

  const compareToggles = page.getByTestId('marketplace-compare-toggle')
  expect(await compareToggles.count(), 'tablet Marketplace needs at least two compare candidates').toBeGreaterThanOrEqual(2)
  await compareToggles.nth(0).click()
  await compareToggles.nth(1).click()

  const compareBar = page.getByTestId('marketplace-compare-bar')
  const compareGo = page.getByTestId('marketplace-compare-go')
  await expect(compareBar).toBeVisible()
  await expect(compareBar).toContainText('2 selected to compare')
  await expect(compareGo).toBeVisible()
  await expect(compareGo).toBeEnabled()
  await expect(compareGo).toHaveText(/Compare 2 vehicles/i)

  const compareBox = await compareBar.boundingBox()
  const navBox = await compactNav.boundingBox()
  expect(compareBox, 'compare dock must have a rendered box').not.toBeNull()
  expect(navBox, 'compact navigation must have a rendered box').not.toBeNull()
  expect(compareBox!.y + compareBox!.height, 'compare dock must stay above compact navigation').toBeLessThanOrEqual(navBox!.y)

  await page.screenshot({ path: testInfo.outputPath('tablet-marketplace.png'), fullPage: true })
  await assertCriticalBrowserHealth(testInfo, diagnostics)
})

test('desktop Home owns the ecosystem story and Gutu AI without duplicating Marketplace IA', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const diagnostics = installDiagnostics(page)
  const [listResponse] = await Promise.all([
    page.waitForResponse(candidate => new URL(candidate.url()).pathname === '/api/marketplace/listings'),
    page.goto('/', { waitUntil: 'domcontentloaded' }),
  ])
  expect(listResponse.ok(), 'Home live Marketplace preview').toBe(true)
  await expect(page.getByTestId('home-hero')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Buy\. Sell\. Verify\./i })).toBeVisible()
  await expect(page.getByTestId('home-primary-search')).toBeVisible()
  await expect(page.getByTestId('marketplace-ai-assistant-open')).toContainText('Ask Gutu AI')
  await expect(page.getByTestId('home-ecosystem-promotions')).toBeVisible()
  await expect(page.locator('a[href="/sell"]').first()).toContainText(/Sell Cars/i)
  await expect(page.getByTestId('marketplace-compact-header')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('desktop-home.png'), fullPage: true })
  await assertCriticalBrowserHealth(testInfo, diagnostics)
})

test('mobile Home preserves flow with no horizontal overlap or overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const diagnostics = installDiagnostics(page)
  await Promise.all([
    page.waitForResponse(candidate => new URL(candidate.url()).pathname === '/api/marketplace/listings'),
    page.goto('/', { waitUntil: 'domcontentloaded' }),
  ])
  await expect(page.getByTestId('home-hero')).toBeVisible()
  await expect(page.getByTestId('home-primary-search')).toBeVisible()
  await expect(page.getByTestId('compact-bottom-nav')).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), {
    message: 'mobile Home must not overflow horizontally',
  }).toBe(true)
  const searchBox = await page.getByTestId('home-primary-search').boundingBox()
  const gutuBox = await page.getByTestId('marketplace-ai-assistant-open').boundingBox()
  expect(searchBox).toBeTruthy()
  expect(gutuBox).toBeTruthy()
  expect((gutuBox?.y ?? 0) >= (searchBox?.y ?? 0), 'Gutu AI must remain in document flow below/after the search').toBe(true)
  await page.screenshot({ path: testInfo.outputPath('mobile-home.png'), fullPage: true })
  await assertCriticalBrowserHealth(testInfo, diagnostics)
})

test('Verify shares the live Marketplace vehicle-story system and preserves lookup policy', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const diagnostics = installDiagnostics(page)
  const [listResponse] = await Promise.all([
    page.waitForResponse(candidate => new URL(candidate.url()).pathname === '/api/marketplace/listings'),
    page.goto('/search', { waitUntil: 'domcontentloaded' }),
  ])
  expect(listResponse.ok(), 'Verify live Marketplace browse').toBe(true)

  await expect(page.getByTestId('vehicle-search-page')).toBeVisible()
  await expect(page.getByTestId('vehicle-search-command')).toBeVisible()
  await expect(page.getByTestId('vehicle-search-policy')).toBeVisible()
  await expect(page.getByTestId('vehicle-search-lookup-policy')).toContainText(/empty result/i)

  const firstResult = page.getByTestId('vehicle-search-result').first()
  await expect(firstResult).toBeVisible()
  await expect(firstResult.getByTestId('marketplace-card-trust')).toBeVisible()
  await expect(firstResult.getByTestId('marketplace-view-passport')).toHaveAttribute('href', /\/marketplace\/listing\//)

  await page.screenshot({ path: testInfo.outputPath('desktop-verify.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('vehicle-search-command')).toBeVisible()
  await expect(page.getByTestId('compact-bottom-nav')).toBeVisible()
  await expect(page.getByTestId('vehicle-search-result').first()).toBeVisible()
  await expect(page.getByTestId('marketplace-card-trust').first()).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), {
    message: 'mobile Verify must not overflow horizontally',
  }).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('mobile-verify.png'), fullPage: true })
  await assertCriticalBrowserHealth(testInfo, diagnostics)
})

test('guest can build a listing to private preview before authentication', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 900 })
  await page.goto('/sell', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/sell$/)
  await expect(page.getByTestId('guest-sell-page')).toBeVisible()
  await expect(page.getByTestId('guest-sell-vehicle-step')).toBeVisible()

  await page.getByTestId('guest-sell-make').fill('Toyota')
  await page.getByTestId('guest-sell-model').fill('Hilux')
  await page.getByTestId('guest-sell-year').fill('2019')
  await page.getByTestId('guest-sell-color').fill('Silver')
  await page.getByTestId('guest-sell-vin').fill('JT123456789012345')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByTestId('guest-sell-listing-step')).toBeVisible()

  await page.getByTestId('guest-sell-mileage').fill('78450')
  await page.getByTestId('guest-sell-condition').click(); await page.getByRole('option', { name: 'Used', exact: true }).click()
  await page.getByTestId('guest-sell-body-style').click(); await page.getByRole('option', { name: 'Pickup', exact: true }).click()
  await page.getByTestId('guest-sell-fuel').click(); await page.getByRole('option', { name: 'Diesel', exact: true }).click()
  await page.getByTestId('guest-sell-transmission').click(); await page.getByRole('option', { name: 'Automatic', exact: true }).click()
  await page.getByTestId('guest-sell-currency').click(); await page.getByRole('option', { name: 'USD', exact: true }).click()
  await page.getByTestId('guest-sell-price').fill('25000')
  await page.getByTestId('guest-sell-city').click(); await page.getByRole('option', { name: 'Harare', exact: true }).click()
  await page.getByTestId('guest-sell-description').fill('Well maintained vehicle offered for sale. Buyer should inspect the recorded history and condition before commitment.')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByTestId('guest-sell-photos-step')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByTestId('guest-sell-preview-step')).toBeVisible()
  await expect(page).toHaveURL(/\/sell$/)
  await expect(page.getByText(/still a browser draft/i)).toBeVisible()
  await expect(page.getByText(/CarUp has not claimed ownership, uploaded your photos, published the listing or created a Trust fact/i)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('guest-sell-preview.png'), fullPage: true })
})

test('Parts Marketplace collects normalized vehicle fitment without fabricating inventory', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 900 })
  const diagnostics = installDiagnostics(page)
  const [partsResponse] = await Promise.all([
    page.waitForResponse(candidate => new URL(candidate.url()).pathname === '/api/marketplace/parts'),
    page.goto('/marketplace/parts', { waitUntil: 'domcontentloaded' }),
  ])
  expect(partsResponse.ok(), 'governed parts endpoint').toBe(true)
  await expect(page.getByTestId('parts-fitment-selector')).toBeVisible()
  const selector = page.getByTestId('parts-fitment-selector')
  const inputs = selector.locator('input')
  await inputs.nth(0).fill('Toyota')
  await inputs.nth(1).fill('Hilux')
  await inputs.nth(2).fill('2019')
  await expect(page.getByText(/No governed parts listings are live yet/i)).toBeVisible()
  await expect(selector.getByRole('button', { name: /Find matching parts/i })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('desktop-parts-fitment.png'), fullPage: true })
  await assertCriticalBrowserHealth(testInfo, diagnostics)
})

test('mobile staging keeps filters actionable and Vehicle Detail inside the viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const diagnostics = installDiagnostics(page)
  await loadMarketplace(page)
  await expect(page.getByTestId('compact-bottom-nav')).toBeVisible()
  await expect(page.locator('footer')).toBeHidden()

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
  await expect(page.getByTestId('vehicle-detail-intelligence-hero')).toBeVisible()
  await expect(page.getByTestId('compact-bottom-nav')).toBeVisible()
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
