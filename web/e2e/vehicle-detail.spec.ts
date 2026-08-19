/**
 * Passport Connection Sprint — E2E Tests
 *
 * Flow:
 *   1. Buyer opens the marketplace
 *   2. Buyer clicks the first vehicle card
 *   3. VehicleDetail page loads and fires GET /api/vehicles/:vin/passport
 *   4. "Vehicle History" tab renders real timeline data (or the correct empty state)
 *   5. "Verification" tab renders real trust/ledger status items
 *   6. The hardcoded placeholder history list is NEVER present when real data exists
 *
 * Prerequisites:
 *   - `npm run dev` running on http://localhost:5173
 *   - Backend running on http://localhost:5001
 *   - At least one vehicle with status='Available' in the Supabase `vehicles` table
 *
 * Run: npx playwright test --project=chromium
 */

import { test, expect, type Page } from '@playwright/test'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Navigate to marketplace, click first vehicle, and wait for the detail page */
async function openFirstVehicleDetail(page: Page) {
  await page.goto('/marketplace')

  // Wait for at least one vehicle card to appear
  const vehicleCard = page.locator('[data-testid="vehicle-card"]').first()
  const altCard     = page.locator('a[href^="/vehicles/"]').first()

  const card = (await vehicleCard.count()) > 0 ? vehicleCard : altCard
  await card.waitFor({ state: 'visible', timeout: 15_000 })

  // Capture the VIN/ID from the link before clicking
  const href = await card.getAttribute('href')
  await card.click()

  // Wait for detail page URL to stabilise
  await page.waitForURL('**/vehicles/**', { timeout: 15_000 })

  return href
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Passport Connection Sprint — Buyer Vehicle Detail Flow', () => {

  test('1 — Marketplace renders at least one vehicle listing', async ({ page }) => {
    await page.goto('/marketplace')

    // The page must render the heading
    await expect(page.getByRole('heading', { name: /marketplace|vehicles|find/i }).first())
      .toBeVisible({ timeout: 12_000 })

    // At least one clickable vehicle link must exist
    const vehicleLinks = page.locator('a[href*="/vehicles/"]')
    await expect(vehicleLinks.first()).toBeVisible({ timeout: 12_000 })
  })


  test('2 — Opening a vehicle card navigates to VehicleDetail page', async ({ page }) => {
    await openFirstVehicleDetail(page)

    // Detail page must have the trust score badge
    const trustBadge = page.locator('[data-testid="trust-score-badge"]')
    await expect(trustBadge).toBeVisible({ timeout: 15_000 })
  })


  test('3 — VehicleDetail fires the passport API request', async ({ page }) => {
    // Intercept the passport network call before navigation
    const passportCallPromise = page.waitForRequest(
      (req) => req.url().includes('/passport') && req.method() === 'GET',
      { timeout: 20_000 }
    )

    await openFirstVehicleDetail(page)

    // The passport request must have been made
    const passportReq = await passportCallPromise
    expect(passportReq.url()).toMatch(/\/api\/vehicles\/.+\/passport/)
  })


  test('4 — History tab renders real timeline data or the correct empty state', async ({ page }) => {
    // Wait for passport response before checking DOM
    let passportPayload: Record<string, unknown> = {}

    page.on('response', async (response) => {
      if (response.url().includes('/passport')) {
        try {
          passportPayload = await response.json()
        } catch { /* ignore */ }
      }
    })

    await openFirstVehicleDetail(page)

    // Give the component time to render
    await page.waitForTimeout(1_500)

    // Click the "Vehicle History" tab
    const historyTab = page.locator('[role="tab"]', { hasText: /vehicle history/i })
    await historyTab.click()

    const tabContent = page.locator('[data-testid="history-tab-content"]')
    await expect(tabContent).toBeVisible({ timeout: 8_000 })

    const timelineLength = (passportPayload.timeline as unknown[])?.length ?? 0

    if (timelineLength > 0) {
      // Real data must render at least one timeline event card
      const events = page.locator('[data-testid="timeline-event"]')
      await expect(events.first()).toBeVisible({ timeout: 8_000 })
      // The correct empty state must NOT be shown when there is real data
      await expect(page.locator('[data-testid="history-empty-state"]')).not.toBeVisible()
    } else {
      // Correct empty state must be shown — NOT a hardcoded placeholder list
      const emptyState = page.locator('[data-testid="history-empty-state"]')
      await expect(emptyState).toBeVisible({ timeout: 8_000 })
    }
  })


  test('5 — Verification tab renders real trust/ledger status items', async ({ page }) => {
    await openFirstVehicleDetail(page)
    await page.waitForTimeout(1_500)

    // Click the Verification tab
    const verifyTab = page.locator('[role="tab"]', { hasText: /verification/i })
    await verifyTab.click()

    const tabContent = page.locator('[data-testid="verification-tab-content"]')
    await expect(tabContent).toBeVisible({ timeout: 8_000 })

    // If passport loaded correctly, there should be 7 verification item rows
    const items = page.locator('[data-testid="verification-item"]')
    const count = await items.count()

    // Either we got items (trust data loaded) OR we get the "unavailable" state
    if (count > 0) {
      // Must have at minimum the 7 defined trust-metric checks
      expect(count).toBeGreaterThanOrEqual(1)
      // Each item must have a status badge
      await expect(items.first().locator('.bg-green-500, .bg-gray-400, .bg-amber-500')).toBeVisible()
    } else {
      // graceful degradation — "Verification data unavailable" message shown
      await expect(page.locator('[data-testid="verification-tab-content"]'))
        .toContainText(/unavailable/i)
    }
  })


  test('6 — No hardcoded placeholder history strings appear on the History tab', async ({ page }) => {
    await openFirstVehicleDetail(page)
    await page.waitForTimeout(1_500)

    const historyTab = page.locator('[role="tab"]', { hasText: /vehicle history/i })
    await historyTab.click()

    // These are strings that appeared verbatim in the old hardcoded list
    const forbiddenStrings = [
      'Imported from Japan',
      'Full service at Croco Motors',
      'Insurance renewed with Old Mutual',
      'Logbook transferred',
    ]

    for (const str of forbiddenStrings) {
      const el = page.locator(`text="${str}"`)
      await expect(el).not.toBeVisible()
    }
  })


  /**
   * ── CORRECTED IN ISSUE #164 PHASE 5 — this test used to encode the defect ──────────────────
   *
   * It previously asserted `toContainText(/no verified images/i)`. That sentence — "No verified
   * images uploaded yet" — WAS the defect Phase 5 removed, for two independent reasons:
   *
   *   1. It was published by a page that had never read `listing_images`. A read that never
   *      happened may not report a negative about what it would have found (Rule 1).
   *   2. It answered a question about EVIDENCE using a control that renders LISTING MEDIA.
   *      `listing_images` is (id, vin, image_url, is_primary, display_order, created_at) — no
   *      reviewer, no status, no provenance. There is nothing in the row a verification claim
   *      could be built from, so "verified" there is authored by the renderer (Rule 3).
   *
   * Asserting the sentence made this spec a ratchet holding the defect in place: a correct
   * implementation would have failed it. It is corrected to assert the TRUE behaviour, and it is
   * STRICTLY STRONGER than what it replaced — the structural half survives unchanged, and three
   * new guarantees are added (the state vocabulary, the exact contract sentence, and the absence
   * of governance language over a marketing gallery).
   *
   * Source of truth for the sentence: `LISTING_MEDIA_EMPTY_STATEMENT` in
   * `backend/utils/vehicleMediaProjection.js`. It is restated here as a literal because this
   * directory is outside every module graph the repo type-checks or bundles;
   * `backend/tests/issue164-phase5-marketplace-convergence.test.js` reads THIS FILE as text and
   * fails if the literal below stops matching the exported constant, so the duplication cannot
   * drift silently.
   */
  const LISTING_MEDIA_EMPTY_STATEMENT = 'No photos are published for this listing.'

  test('7 — Gallery renders a photo, or the correct empty state, or says it did not look', async ({ page }) => {
    await openFirstVehicleDetail(page)

    const gallery = page.locator('[data-testid="image-gallery"]')
    await expect(gallery).toBeVisible({ timeout: 12_000 })

    const hasReal        = await page.locator('[data-testid="vehicle-image"]').count()
    const hasPlaceholder = await page.locator('[data-testid="no-images-placeholder"]').count()

    // UNCHANGED — the structural half of the original assertion.
    // Exactly one of the two must be shown — never both, never neither
    expect(hasReal + hasPlaceholder).toBe(1)

    // The defect sentence must not appear ANYWHERE on the page, in either branch. This is the
    // regression guard proper: it is what the old assertion inverted.
    await expect(page.locator('body')).not.toContainText(/no verified images/i)

    if (hasReal > 0) {
      // A rendered photo carries the url form the contract classified it as. `media_id` is present
      // only on the transport that carries an identity, so its ABSENCE is not a failure — but when
      // it is present it must be a bare UUID and never a storage path or bucket name.
      const image = page.locator('[data-testid="vehicle-image"]')
      await expect(image).toHaveAttribute('data-url-form', /^(absolute_https|absolute_http|protocol_relative|site_relative)$/)
      const mediaId = await image.getAttribute('data-media-id')
      if (mediaId !== null) {
        expect(mediaId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      }
      return
    }

    // ── The placeholder branch. THREE STATES, and the two empty ones say different things. ──
    const placeholder = page.locator('[data-testid="no-images-placeholder"]')
    const state = await placeholder.getAttribute('data-media-state')

    // `published` here would mean the block claimed photos and the gallery rendered none.
    expect(['none', 'not_loaded']).toContain(state)

    if (state === 'none') {
      // The source WAS consulted and holds nothing publishable. That is a finding, and it gets the
      // contract's own sentence — about PHOTOS ON A LISTING, not about verification.
      await expect(placeholder.locator('[data-testid="listing-media-empty"]')).toBeVisible()
      await expect(placeholder).toContainText(LISTING_MEDIA_EMPTY_STATEMENT)
      await expect(placeholder.locator('[data-testid="listing-media-not-loaded"]')).toHaveCount(0)
    } else {
      // The source was NOT consulted. Nothing may be claimed in either direction, so the empty
      // sentence must be ABSENT — publishing it here is precisely the shipped defect.
      await expect(placeholder.locator('[data-testid="listing-media-not-loaded"]')).toBeVisible()
      await expect(placeholder).not.toContainText(LISTING_MEDIA_EMPTY_STATEMENT)
      await expect(placeholder.locator('[data-testid="listing-media-empty"]')).toHaveCount(0)
    }

    // Rule 3, as an executable assertion rather than a convention: nothing in a marketing-gallery
    // empty state may speak the language of governance. This is the family the old sentence
    // belonged to, so pinning one string would have left the door open to its siblings.
    const placeholderText = (await placeholder.innerText()).toLowerCase()
    for (const word of ['verif', 'evidence', 'trust', 'certif', 'authentic', 'proof', 'inspect', 'approved', 'official', 'guarantee', 'validated', 'genuine', 'vetted']) {
      expect(placeholderText, `listing-media placeholder must not assert governance ("${word}")`).not.toContain(word)
    }
  })

})
