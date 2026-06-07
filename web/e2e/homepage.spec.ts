import { test, expect } from '@playwright/test'

test.describe('Marketplace-first homepage', () => {
  test('homepage loads with the marketplace-first headline', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('[data-testid="home-hero"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: /Find Verified Cars\. Sell With Confidence\./i })).toBeVisible()
  })

  test('Buy, Verify, and Sell tabs switch', async ({ page }) => {
    await page.goto('/')

    await page.locator('[data-testid="home-verify-tab"]').click()
    await expect(page.locator('[data-testid="home-verify-lookup"]')).toBeVisible()

    await page.locator('[data-testid="home-sell-tab"]').click()
    await expect(page.locator('[data-testid="home-sell-lookup"]')).toBeVisible()

    await page.locator('[data-testid="home-buy-tab"]').click()
    await expect(page.locator('[data-testid="home-buy-search"]')).toBeVisible()
  })

  test('seller callout is visible above the fold', async ({ page }) => {
    await page.goto('/')

    const sellerCallout = page.locator('[data-testid="home-seller-callout"]')
    await expect(sellerCallout).toBeVisible()
    await expect(sellerCallout).toContainText('Selling your car?')
    await expect(sellerCallout).toContainText('Start with your plate or VIN and create a trusted Passport listing.')
    await expect(sellerCallout.getByRole('button', { name: /Start Selling/i })).toBeVisible()
  })

  test('buy search routes safely to the current search surface', async ({ page }) => {
    await page.goto('/')

    await page.locator('[data-testid="home-buy-search"]').fill('Toyota Hilux')
    await page.locator('[data-testid="home-search-submit"]').click()

    await expect(page).toHaveURL(/\/search/)
  })

  test('verify lookup routes to the existing Passport detail route', async ({ page }) => {
    await page.goto('/')

    await page.locator('[data-testid="home-verify-tab"]').click()
    await page.locator('[data-testid="home-verify-lookup"]').fill('AE-1234')
    await page.getByRole('button', { name: /Open Vehicle Passport/i }).click()

    await expect(page).toHaveURL(/\/marketplace\/AE-1234/)
  })

  test('sell lookup routes to the current seller handoff', async ({ page }) => {
    await page.goto('/')

    await page.locator('[data-testid="home-sell-tab"]').click()
    await page.locator('[data-testid="home-sell-lookup"]').fill('AE-1234')
    await page.getByRole('button', { name: /Start Seller Verification/i }).first().click()

    await expect(page).toHaveURL(/\/(register|dashboard\/sell-vehicle)/)
  })

  test('Sell Your Car CTA routes to the current public seller handoff', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('link', { name: /Sell Your Car/i }).click()

    await expect(page).toHaveURL(/\/register/)
  })

  test('featured vehicle card links to Passport detail by VIN', async ({ page }) => {
    await page.goto('/')

    const passportLink = page.locator('[data-testid="featured-view-passport"]').first()
    await expect(passportLink).toBeVisible()
    const href = await passportLink.getAttribute('href')

    expect(href).toMatch(/^\/marketplace\/.+/)
    expect(href).not.toMatch(/\/marketplace\/v\d+$/)
  })

  test('trust strip renders', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('[data-testid="home-trust-strip"]')).toBeVisible()
    await expect(page.locator('[data-testid="home-trust-strip"]')).toContainText('Plate Check')
    await expect(page.locator('[data-testid="home-trust-strip"]')).toContainText('Evidence Timeline')
    await expect(page.locator('[data-testid="home-trust-strip"]')).toContainText('Owner Privacy')
    await expect(page.locator('[data-testid="home-trust-strip"]')).toContainText('Trust Score')
    await expect(page.locator('[data-testid="home-trust-strip"]')).toContainText('SafePay Ready')
    await expect(page.locator('[data-testid="home-partsentry-trust-signal"]')).toContainText('PartSentry')
  })

  test('popular category chips render lower on the page', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: /Start with what buyers ask for most/i })).toBeVisible()
    await expect(page.locator('[data-testid="popular-search-chip"]')).toHaveCount(19)
    await expect(page.locator('[data-testid="popular-search-chip"]').first()).toContainText('Brand New')
    await expect(page.locator('[data-testid="popular-search-chip"]').filter({ hasText: 'Parts & Accessories' })).toBeVisible()
  })

  test('homepage does not expose private owner names or phone numbers from mock vehicles', async ({ page }) => {
    await page.goto('/')

    const pageText = await page.locator('body').innerText()
    expect(pageText).not.toContain('Tendai Moyo')
    expect(pageText).not.toContain('Sarah Chikomo')
    expect(pageText).not.toContain('James Ncube')
    expect(pageText).not.toContain('Grace Mupfumi')
    expect(pageText).not.toContain('+263 773 345 678')
    expect(pageText).not.toContain('+263 775 567 890')
    expect(pageText).not.toContain('+263 777 789 012')
    expect(pageText).not.toContain('+263 778 890 123')
  })
})
