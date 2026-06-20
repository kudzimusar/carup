import { expect, test, type Page, type Route } from '@playwright/test'

const dealer = { id: 'd-1', name: 'Dealer', email: 'd@carup.test', role: 'dealer' }
const mechanic = { id: 'm-1', name: 'Mech', email: 'm@carup.test', role: 'mechanic' }

async function fulfillJson(route: Route, body: unknown, status = 200) {
  const origin = route.request().headers().origin || '*'
  const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Credentials': 'true' }
  if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
  await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
}

async function loginAs(page: Page, user: any, token = 'mock-token') {
  await page.addInitScript(({ user, token }) => {
    window.localStorage.setItem('carup_user', JSON.stringify(user))
    window.localStorage.setItem('carup_token', token)
  }, { user, token })
}

interface DState { enabled: boolean; connected: boolean; files: any[] }

async function mockApi(page: Page, state: DState, user: any) {
  await page.context().route('**/api/auth/me', (r) => fulfillJson(r, { user }))
  await page.context().route('**/api/security/csrf-token', (r) => fulfillJson(r, { csrfToken: 'mock-csrf' }))
  await page.context().route('**/api/diaspora/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (method === 'GET' && path.endsWith('/drive/status')) {
      await fulfillJson(route, { data: {
        enabled: state.enabled,
        provider: 'google',
        scopes: ['https://www.googleapis.com/auth/drive.file'],
        connection: state.connected ? { id: 'conn-1', provider: 'google', providerAccountEmail: 'mock@example.com', scopes: ['https://www.googleapis.com/auth/drive.file'], accessStatus: 'ACTIVE', connected: true, lastSyncAt: '2026-06-20T00:00:00Z' } : null,
        onedrive: { available: false },
        workbookExport: { xlsx: false, note: 'Binary XLSX export is not yet available; JSON/report export only.' },
      } })
      return
    }
    if (method === 'GET' && path.endsWith('/drive/google/authorize')) {
      await fulfillJson(route, { data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file&state=signed', scopes: ['https://www.googleapis.com/auth/drive.file'], state: 'signed' } })
      return
    }
    if (method === 'GET' && path.endsWith('/drive/files')) { await fulfillJson(route, { data: state.files }); return }
    if (method === 'POST' && path.endsWith('/drive/disconnect')) { state.connected = false; await fulfillJson(route, { data: { accessStatus: 'DISCONNECTED', connected: false } }); return }
    if (method === 'POST' && path.endsWith('/drive/sync')) { await fulfillJson(route, { data: { accessStatus: 'ACTIVE', connected: true, lastSyncAt: '2026-06-21T00:00:00Z' } }); return }
    await fulfillJson(route, { data: [] })
  })
}

test.describe('Diaspora Drive connections (Phase 7)', () => {
  test('unauthorized role is denied', async ({ page }) => {
    await loginAs(page, mechanic, 'm-token')
    await mockApi(page, { enabled: true, connected: false, files: [] }, mechanic)
    await page.goto('/diaspora/drive', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('diaspora-drive-access-denied')).toBeVisible()
  })

  test('feature-disabled shows a safe disabled state', async ({ page }) => {
    await loginAs(page, dealer, 'd-token')
    await mockApi(page, { enabled: false, connected: false, files: [] }, dealer)
    await page.goto('/diaspora/drive', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('diaspora-drive-disabled')).toBeVisible()
  })

  test('not-connected shows connect + minimal scopes + truthful XLSX note; connect surfaces consent URL', async ({ page }) => {
    await loginAs(page, dealer, 'd-token')
    await mockApi(page, { enabled: true, connected: false, files: [] }, dealer)
    await page.goto('/diaspora/drive', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('diaspora-drive-connect')).toBeVisible()
    await expect(page.getByTestId('diaspora-drive-scopes')).toContainText('drive.file')
    await expect(page.getByTestId('diaspora-drive-xlsx-note')).toContainText(/xlsx/i)
    await page.getByTestId('diaspora-drive-connect').click()
    const link = page.getByTestId('diaspora-drive-authorize-url')
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', /accounts\.google\.com/)
  })

  test('connected shows files, sync, disconnect; no token text in DOM', async ({ page }) => {
    await loginAs(page, dealer, 'd-token')
    await mockApi(page, { enabled: true, connected: true, files: [{ id: 'f1', fileName: 'order.json', linkedEntityType: 'buyer_order', linkedEntityId: 'ord-1', syncStatus: 'SYNCED' }] }, dealer)
    await page.goto('/diaspora/drive', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('diaspora-drive-connected-badge')).toBeVisible()
    await expect(page.getByTestId('diaspora-drive-file-row')).toHaveCount(1)
    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(/accessToken|refresh_token|credential_reference|mock-access/i)
    await page.getByTestId('diaspora-drive-disconnect').click()
    await expect(page.getByTestId('diaspora-drive-disconnected-badge')).toBeVisible()
  })
})
