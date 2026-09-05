import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const BASE_URL = process.env.BASELINE_WEB_URL!
const BASELINE_RUNTIME_SHA = process.env.BASELINE_RUNTIME_SHA!
const OWNER_EMAIL = 'uat.buyer@carup-staging.test'
const OWNER_PASSWORD = process.env.STAGING_UAT_BUYER_PASSWORD!

type CaptureRecord = {
  viewport: string
  surface: string
  requestedPath: string
  resultingUrl: string
  httpStatus: number | null
  title: string
  screenshot: string
  bodyExcerpt: string
  evidenceVaultHref?: string | null
  activeSidebarDestinations?: number
}

const surfaces = [
  ['home', '/'],
  ['marketplace', '/marketplace'],
  ['reference-vehicle-detail', '/marketplace/CARUPGLDNA0000001'],
  ['public-sell', '/sell'],
] as const

const authenticatedSurfaces = [
  ['owner-dashboard', '/dashboard'],
  ['my-garage', '/dashboard/garage'],
  ['my-listings', '/dashboard/listings'],
  ['seller-studio', '/dashboard/sell-vehicle'],
  ['seller-draft-buyer-preview', '/marketplace/UAT20260828SELL01'],
  ['communications', '/dashboard/communications'],
  ['seller-intelligence', '/dashboard/ai'],
  ['verify-passport-entry', '/dashboard/garage/UAT20260828SELL01'],
] as const

const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 1024, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const

function safeName(value: string) {
  return value.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
}

async function capture(
  page: Page,
  root: string,
  viewport: string,
  surface: string,
  requestedPath: string,
): Promise<CaptureRecord> {
  const response = await page.goto(requestedPath, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(1200)

  const filename = `${safeName(viewport)}--${safeName(surface)}.png`
  const screenshot = path.join(root, filename)
  await page.screenshot({ path: screenshot, fullPage: true })

  const title = await page.title()
  const bodyExcerpt = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 3500)
  const evidenceLink = page.getByRole('link', { name: 'Evidence Vault', exact: true })
  const evidenceVaultHref = await evidenceLink.count() ? await evidenceLink.first().getAttribute('href') : null
  const activeSidebarDestinations = await page.locator('nav a[aria-current="page"]').count()

  return {
    viewport,
    surface,
    requestedPath,
    resultingUrl: page.url(),
    httpStatus: response?.status() ?? null,
    title,
    screenshot: filename,
    bodyExcerpt,
    evidenceVaultHref,
    activeSidebarDestinations,
  }
}

async function signInOwner(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('email-input').fill(OWNER_EMAIL)
  await page.getByTestId('password-input').fill(OWNER_PASSWORD)
  await page.getByTestId('login-button').click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 20_000 })
}

test('Phase B baseline visual audit — desktop, tablet and mobile', async ({ page }, testInfo) => {
  test.setTimeout(240_000)
  expect(BASE_URL, 'BASELINE_WEB_URL is required').toBeTruthy()
  expect(BASELINE_RUNTIME_SHA, 'BASELINE_RUNTIME_SHA is required').toBeTruthy()
  expect(OWNER_PASSWORD, 'STAGING_UAT_BUYER_PASSWORD is required').toBeTruthy()

  const root = path.resolve('test-results/seller-baseline')
  fs.mkdirSync(root, { recursive: true })
  const records: CaptureRecord[] = []

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.context().clearCookies()
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    for (const [surface, requestedPath] of surfaces) {
      records.push(await capture(page, root, viewport.name, surface, requestedPath))
    }

    await signInOwner(page)

    for (const [surface, requestedPath] of authenticatedSurfaces) {
      records.push(await capture(page, root, viewport.name, surface, requestedPath))

      if (surface === 'my-garage') {
        const evidenceLink = page.getByRole('link', { name: 'Evidence Vault', exact: true })
        if (await evidenceLink.count()) {
          await evidenceLink.first().click()
          await page.waitForTimeout(500)
          records.push(await capture(page, root, viewport.name, 'evidence-vault', new URL(page.url()).pathname))
        } else {
          records.push(await capture(page, root, viewport.name, 'evidence-vault-missing-nav', '/dashboard/garage'))
        }
      }
    }
  }

  const manifest = {
    baselineRuntimeSha: BASELINE_RUNTIME_SHA,
    testCodeSha: process.env.GITHUB_SHA || null,
    baseUrl: BASE_URL,
    capturedAt: new Date().toISOString(),
    referenceVin: 'CARUPGLDNA0000001',
    uatVin: 'UAT20260828SELL01',
    records,
  }
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2))

  // Phase B is evidence preservation, not a "make known defects green" test.
  // Still fail if a requested page catastrophically fails to render or authentication is broken.
  expect(records.length).toBe(39)
  for (const record of records) {
    expect(record.bodyExcerpt.length, `${record.viewport}/${record.surface} rendered no readable body`).toBeGreaterThan(10)
    expect(record.httpStatus === null || record.httpStatus < 500, `${record.viewport}/${record.surface} returned 5xx`).toBe(true)
  }

  await testInfo.attach('seller-baseline-manifest', {
    path: path.join(root, 'manifest.json'),
    contentType: 'application/json',
  })
})
