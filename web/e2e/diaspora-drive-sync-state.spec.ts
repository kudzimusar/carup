import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Drive durable-sync + activation state — real Chromium (Issue #127, Drive lane).
 *
 * Two things this suite exists to prove, both of which are lies the UI could plausibly tell:
 *
 *  1. A file that never reached Drive must not render as if it is on its way. `dead_lettered` means
 *     the upload exhausted its retries; showing it as a warning-coloured "syncing" would tell someone
 *     their document is safe when it is not.
 *  2. Without owner-provisioned OAuth credentials, Connect can only fail with NOT_CONFIGURED, so the
 *     page must say Drive is not activated rather than offer a button that cannot work.
 *
 * It also proves the negative that matters most for this lane: **no credential material ever reaches
 * the browser** — not in the DOM, not in localStorage/sessionStorage, and not in any response body
 * the page received.
 *
 * Start the dev server first (this config has no webServer):
 *   npm run dev --workspace=web
 */

type TestUser = { id: string; name: string; email: string; role: string }
const dealer: TestUser = { id: 'd-1', name: 'Dealer', email: 'd@carup.test', role: 'dealer' }

const DESKTOP = { width: 1280, height: 800 }
const MOBILE = { width: 390, height: 844 }

async function fulfillJson(route: Route, body: unknown, status = 200) {
  const origin = route.request().headers().origin || '*'
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  }
  if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
  await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
}

async function loginAs(page: Page, user: TestUser) {
  await page.addInitScript((u) => {
    window.localStorage.setItem('carup_user', JSON.stringify(u))
    window.localStorage.setItem('carup_token', 'mock-token')
  }, user)
}

interface SyncState {
  activationPending: boolean
  connected: boolean
  attempts: Array<Record<string, unknown>>
  durableTracking?: boolean
}

function attempt(over: Record<string, unknown> = {}) {
  return {
    id: 'a1', operation: 'upload', entityType: 'diaspora_import_orders', entityId: 'order-1',
    idempotencyKey: 'i1', state: 'succeeded', attempts: 1, nextAttemptAt: null,
    providerFileId: null, providerFolderId: null, bytes: null, contentChecksum: null,
    lastErrorCode: null, lastError: null, startedAt: null, completedAt: null, createdAt: null,
    ...over,
  }
}

/** Every response body the page received, so a leak can be asserted against the wire, not just the DOM. */
const bodies: string[] = []

async function mockApi(page: Page, state: SyncState) {
  bodies.length = 0
  await page.context().route('**/api/auth/me', (r) => fulfillJson(r, { user: dealer }))
  await page.context().route('**/api/security/csrf-token', (r) => fulfillJson(r, { csrfToken: 'mock-csrf' }))
  await page.context().route('**/api/**', (r) => fulfillJson(r, { data: [] }))

  await page.context().route('**/api/diaspora/drive/status', (r) => fulfillJson(r, {
    data: {
      enabled: true,
      provider: 'google',
      scopes: ['https://www.googleapis.com/auth/drive.file'],
      connection: state.connected
        ? { id: 'conn-1', provider: 'google', providerAccountEmail: 'mock@example.com', accessStatus: 'ACTIVE', connected: true }
        : null,
      // Provenance only — deliberately no token of any kind.
      credential: state.connected
        ? {
          id: 'cred-1', purpose: 'google_drive', vaultBackend: 'aws_secrets_manager', keyVersion: 'v3',
          scopes: ['drive.file'], status: 'active', externalAccountLabel: 'mock@example.com',
          expiresAt: null, lastRefreshedAt: '2026-07-20T00:00:00Z', lastErrorCode: null, revokedAt: null,
        }
        : null,
      activation: {
        credentialsConfigured: !state.activationPending,
        redirectUris: state.activationPending ? 0 : 1,
        pending: state.activationPending,
      },
      onedrive: { available: false },
      workbookExport: { xlsx: false },
    },
  }))

  await page.context().route('**/api/diaspora/drive/files', (r) => fulfillJson(r, {
    data: state.connected
      ? [{ id: 'f1', fileName: 'invoice.pdf', linkedEntityType: 'diaspora_import_orders', linkedEntityId: 'order-1', syncStatus: 'SYNCED' }]
      : [],
  }))

  await page.context().route('**/api/diaspora/drive/sync-attempts/**', (r) => fulfillJson(r, {
    data: { attempts: state.attempts, durableTracking: state.durableTracking !== false },
  }))

  page.on('response', async (res) => {
    if (!res.url().includes('/api/')) return
    try { bodies.push(await res.text()) } catch { /* opaque body */ }
  })
}

async function openDrive(page: Page, state: SyncState, viewport = DESKTOP) {
  await page.setViewportSize(viewport)
  await loginAs(page, dealer)
  await mockApi(page, state)
  await page.goto('/diaspora/drive', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('diaspora-drive-page')).toBeVisible()
}

const base: SyncState = { activationPending: false, connected: true, attempts: [attempt()] }

test.describe('activation truthfulness', () => {
  test('offers Connect when the deployment has credentials', async ({ page }) => {
    await openDrive(page, { ...base, connected: false })
    await expect(page.getByTestId('diaspora-drive-connect')).toBeVisible()
    await expect(page.getByTestId('diaspora-drive-activation-pending')).toHaveCount(0)
  })

  test('says Drive is not activated and hides Connect when credentials are absent', async ({ page }) => {
    await openDrive(page, { ...base, connected: false, activationPending: true })
    await expect(page.getByTestId('diaspora-drive-activation-pending')).toContainText(/not yet activated/i)
    // A button that could only fail NOT_CONFIGURED must not be offered.
    await expect(page.getByTestId('diaspora-drive-connect')).toHaveCount(0)
  })
})

test.describe('durable sync history', () => {
  test('a dead-lettered upload reads as a failure needing action, never as syncing', async ({ page }) => {
    await openDrive(page, { ...base, attempts: [attempt({ id: 'a2', state: 'dead_lettered', attempts: 5 })] })
    await page.getByTestId('diaspora-drive-file-history').click()

    const row = page.getByTestId('diaspora-drive-attempt-dead_lettered')
    await expect(row).toBeVisible()
    await expect(row).toContainText(/not synced/i)
    await expect(row).toContainText(/will not be retried automatically/i)
    await expect(page.getByTestId('diaspora-drive-attempt-needs-action')).toContainText(/not in your Drive/i)
    await expect(row).not.toContainText(/\bsyncing\b/i)
  })

  test('a retrying failure is distinguished from a terminal one', async ({ page }) => {
    await openDrive(page, { ...base, attempts: [attempt({ id: 'a3', state: 'failed', nextAttemptAt: '2026-07-29T10:00:00Z' })] })
    await page.getByTestId('diaspora-drive-file-history').click()
    await expect(page.getByTestId('diaspora-drive-attempt-failed')).toContainText(/retrying/i)
    await expect(page.getByTestId('diaspora-drive-attempt-needs-action')).toHaveCount(0)
  })

  test('discloses when durable tracking is unavailable', async ({ page }) => {
    await openDrive(page, { ...base, durableTracking: false })
    await page.getByTestId('diaspora-drive-file-history').click()
    await expect(page.getByTestId('diaspora-drive-tracking-unavailable')).toContainText(/may be incomplete/i)
  })
})

test.describe('credential containment', () => {
  test('no token material reaches the DOM, browser storage, or any response body', async ({ page }) => {
    await openDrive(page, base)
    await page.getByTestId('diaspora-drive-file-history').click()

    // Shapes the CR-1 scanner blocks at commit time, asserted here at runtime.
    const forbidden = [/ya29\./, /1\/\/[A-Za-z0-9_-]{10,}/, /GOCSPX-/, /refresh_token/i, /vault_reference/i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/]

    const dom = await page.content()
    for (const pattern of forbidden) expect(dom, `DOM must not contain ${pattern}`).not.toMatch(pattern)

    const storage = await page.evaluate(() => JSON.stringify({
      local: { ...window.localStorage }, session: { ...window.sessionStorage },
    }))
    for (const pattern of forbidden) expect(storage, `browser storage must not contain ${pattern}`).not.toMatch(pattern)

    // The wire itself: the API must never have projected a credential to this client.
    for (const body of bodies) {
      for (const pattern of forbidden) expect(body, `no response body may contain ${pattern}`).not.toMatch(pattern)
    }
  })

  test('renders credential provenance without the credential', async ({ page }) => {
    await openDrive(page, base)
    // Provenance is legitimate and useful; the secret is not present to render.
    const dom = await page.content()
    expect(dom).not.toMatch(/ya29\.|refresh_token/i)
  })
})

test.describe('responsive', () => {
  for (const [label, viewport] of [['desktop', DESKTOP], ['mobile', MOBILE]] as const) {
    test(`${label}: dead-letter state is visible and the page does not scroll horizontally`, async ({ page }) => {
      await openDrive(page, { ...base, attempts: [attempt({ id: 'a4', state: 'dead_lettered', attempts: 3 })] }, viewport)
      await page.getByTestId('diaspora-drive-file-history').click()
      await expect(page.getByTestId('diaspora-drive-attempt-dead_lettered')).toBeVisible()

      // Report the offending element, not just a boolean: a bare "expected false" tells the next
      // person nothing about which node is too wide.
      const overflow = await page.evaluate(() => {
        const vw = window.innerWidth
        const offenders: Array<{ tag: string; cls: string; width: number; right: number; text: string }> = []
        document.querySelectorAll('*').forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.right > vw + 1) {
            offenders.push({
              tag: el.tagName,
              cls: String((el as HTMLElement).className || '').slice(0, 80),
              width: Math.round(r.width),
              right: Math.round(r.right),
              text: (el.textContent || '').trim().slice(0, 40),
            })
          }
        })
        return { vw, scrollWidth: document.documentElement.scrollWidth, offenders: offenders.slice(0, 4) }
      })
      expect(
        overflow.scrollWidth,
        `page must not scroll horizontally (viewport ${overflow.vw}); offenders: ${JSON.stringify(overflow.offenders)}`,
      ).toBeLessThanOrEqual(overflow.vw + 1)
    })
  }
})

test.describe('request containment', () => {
  test('loading the page issues exactly one drive status request', async ({ page }) => {
    let statusCalls = 0
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, base)
    page.on('request', (r) => { if (r.url().includes('/drive/status')) statusCalls += 1 })

    await page.goto('/diaspora/drive', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('diaspora-drive-page')).toBeVisible()
    await page.waitForTimeout(3000)

    // This page previously held the aggregate useCarUpApi() object and looped without bound.
    expect(statusCalls).toBe(1)
  })
})
