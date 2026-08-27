import { test, expect } from '@playwright/test'

test.describe('CarUp conversion homepage', () => {
  test('homepage opens as the CarUp sales and navigation front door', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('home-hero')).toBeVisible()
    await expect(page.getByRole('heading', { name: /Buy\. Sell\. Verify\./i })).toBeVisible()
    await expect(page.getByTestId('home-primary-search')).toBeVisible()
    await expect(page.getByTestId('home-live-showroom')).toBeVisible()
  })

  test('primary journeys expose Buy, Sell and Verify without duplicating Marketplace IA', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('a[href="/marketplace"]').filter({ hasText: 'Buy Cars' }).first()).toBeVisible()
    await expect(page.locator('a[href="/sell"]').filter({ hasText: 'Sell Cars' }).first()).toBeVisible()
    await expect(page.locator('a[href="/search"]').filter({ hasText: 'Verify Cars' }).first()).toBeVisible()
    await expect(page.getByTestId('marketplace-compact-header')).toHaveCount(0)
  })

  test('buy search commits the query to Marketplace', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('home-buy-search').fill('Toyota Hilux')
    await page.getByTestId('home-search-submit').click()

    await expect(page).toHaveURL(/\/marketplace\?q=Toyota%20Hilux/)
  })

  test('homepage markets the breadth of the CarUp ecosystem', async ({ page }) => {
    await page.goto('/')

    const journeys = page.getByTestId('home-ecosystem-promotions')
    await expect(journeys).toBeVisible()
    await expect(journeys).toContainText('Find the right car')
    await expect(journeys).toContainText('Turn your car into a credible listing')
    await expect(journeys).toContainText('Source and move a vehicle')
    await expect(journeys).toContainText('Explore how to fund the deal')
    await expect(journeys).toContainText('Find garages and service context')
    await expect(journeys).toContainText('Match parts to the vehicle')
  })

  test('communication layer exposes AI, self-service help and human contact', async ({ page }) => {
    await page.goto('/')

    const communication = page.getByTestId('home-communications')
    await expect(communication).toBeVisible()
    await expect(communication.getByTestId('marketplace-ai-assistant-open')).toContainText('Ask Gutu AI')
    await expect(communication.locator('a[href="/help"]')).toContainText('Help centre')
    await expect(communication.locator('a[href="/contact"]')).toContainText('Contact CarUp')
  })

  test('featured vehicle links use the same VIN-based Marketplace detail route', async ({ page }) => {
    await page.goto('/')

    const passportLink = page.getByTestId('featured-view-passport').first()
    await expect(passportLink).toBeVisible()
    const href = await passportLink.getAttribute('href')

    expect(href).toMatch(/^\/marketplace\/.+/)
    expect(href).not.toMatch(/\/marketplace\/v\d+$/)
  })

  test('home inventory reuses the current Marketplace vehicle-story system', async ({ page }) => {
    await page.goto('/')

    const inventory = page.getByTestId('home-live-inventory')
    await expect(inventory).toBeVisible()
    await expect(inventory.getByTestId('featured-verified-car').first()).toBeVisible()
    await expect(inventory.getByTestId('marketplace-card-trust').first()).toBeVisible()
  })

  test('trust strip renders governed product capabilities', async ({ page }) => {
    await page.goto('/')

    const strip = page.getByTestId('home-trust-strip')
    await expect(strip).toBeVisible()
    await expect(strip).toContainText('Plate Check')
    await expect(strip).toContainText('Evidence Timeline')
    await expect(strip).toContainText('Owner Privacy')
    await expect(strip).toContainText('Canonical Trust')
    await expect(strip).toContainText('SafePay routes')
    await expect(page.getByTestId('home-partsentry-trust-signal')).toContainText('PartSentry')
  })

  test('popular market shortcuts remain available below the main conversion paths', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: /Start with what buyers ask for most/i })).toBeVisible()
    await expect(page.getByTestId('popular-search-chip')).toHaveCount(19)
    await expect(page.getByTestId('popular-search-chip').filter({ hasText: 'Toyota Hilux' })).toBeVisible()
    await expect(page.getByTestId('popular-search-chip').filter({ hasText: 'Parts & Accessories' })).toBeVisible()
  })

  test('homepage does not expose private owner names or phone numbers from old mock vehicles', async ({ page }) => {
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
