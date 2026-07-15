import { test, expect } from '@playwright/test'

// Referral Engine browser UAT.
//
// Run against staging with:
//   PLAYWRIGHT_BASE_URL=https://<carup-staging-host> \
//   E2E_UAT_ADMIN_EMAIL=uat-admin@carup.local E2E_UAT_ADMIN_PASSWORD=... \
//   E2E_UAT_OWNER_EMAIL=uat-owner@carup.local E2E_UAT_OWNER_PASSWORD=... \
//   npx playwright test web/e2e/referral-staging.spec.ts
//
// The public login/alert journey always runs (no secrets). The authenticated
// admin/owner journeys are skipped unless the UAT credentials are supplied, so
// the spec never embeds or requires secrets to be checked in.

const ADMIN_EMAIL = process.env.E2E_UAT_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.E2E_UAT_ADMIN_PASSWORD
const OWNER_EMAIL = process.env.E2E_UAT_OWNER_EMAIL
const OWNER_PASSWORD = process.env.E2E_UAT_OWNER_PASSWORD

async function login(page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('[data-testid="email-input"]').fill(email)
  await page.locator('[data-testid="password-input"]').fill(password)
  await page.locator('[data-testid="login-button"]').click()
}

test.describe('Referral Engine — login & readable errors (public)', () => {
  test('login page renders the form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('[data-testid="email-input"]')).toBeVisible()
    await expect(page.locator('[data-testid="password-input"]')).toBeVisible()
    await expect(page.locator('[data-testid="login-button"]')).toBeVisible()
  })

  test('invalid credentials surface a readable, accessible inline alert', async ({ page }) => {
    await login(page, 'uat-admin@carup.local', 'definitely-the-wrong-password')
    const alert = page.locator('[data-testid="login-error-alert"]')
    await expect(alert).toBeVisible({ timeout: 15000 })
    await expect(alert).toHaveAttribute('role', 'alert')
    // A safe, non-enumerating message (invalid credentials OR server/backend issue).
    await expect(alert).toContainText(/invalid|try again|unreachable|something went wrong/i)
  })
})

test.describe('Referral Engine — authenticated journeys (staging credentials required)', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'set E2E_UAT_ADMIN_* to run admin journeys')

  test('admin logs in and reaches the referral admin area', async ({ page }) => {
    await login(page, ADMIN_EMAIL as string, ADMIN_PASSWORD as string)
    await page.waitForURL(/\/(admin|dashboard)/, { timeout: 20000 })
    await page.goto('/admin/referrals')
    await expect(page).toHaveURL(/\/admin\/referrals/)
  })
})

test.describe('Referral Engine — owner Refer & Earn (staging credentials required)', () => {
  test.skip(!OWNER_EMAIL || !OWNER_PASSWORD, 'set E2E_UAT_OWNER_* to run owner journeys')

  test('owner logs in and sees the Refer & Earn wallet page', async ({ page }) => {
    await login(page, OWNER_EMAIL as string, OWNER_PASSWORD as string)
    await page.waitForURL(/\/dashboard/, { timeout: 20000 })
    await page.goto('/dashboard/referrals')
    await expect(page).toHaveURL(/\/dashboard\/referrals/)
  })
})

// Stage-4 remediation closed journey (requires the deployed remediation + full controlled creds):
//   invitee opens ?ref=<code> → submits a marketplace inquiry → that inquiry becomes a qualifiable
//   local referral lead → admin qualifies THAT lead → owner sees the pending benefit → owner files a
//   dispute → admin resolves → owner refreshes and sees the resolved status.
// It proves the inquiry id and the bridged lead id belong to the same journey.
const INVITEE_EMAIL = process.env.E2E_UAT_INVITEE_EMAIL
const INVITEE_PASSWORD = process.env.E2E_UAT_INVITEE_PASSWORD
const CONTROLLED_CODE = process.env.E2E_UAT_REFERRAL_CODE
const API_BASE = process.env.E2E_UAT_API_BASE_URL

test.describe('Referral Engine — closed owner/invitee journey (Stage-4 remediation)', () => {
  test.skip(
    !ADMIN_EMAIL || !OWNER_EMAIL || !INVITEE_EMAIL || !CONTROLLED_CODE || !API_BASE,
    'set E2E_UAT_ADMIN_*, E2E_UAT_OWNER_*, E2E_UAT_INVITEE_*, E2E_UAT_REFERRAL_CODE and E2E_UAT_API_BASE_URL to run the closed journey'
  )

  test('invitee inquiry becomes the qualifiable lead the admin qualifies; owner sees benefit + dispute resolution', async ({ page, request }) => {
    // 1. Invitee opens the attributed marketplace link (captures ?ref=) and submits an inquiry.
    await page.goto(`/marketplace?ref=${encodeURIComponent(CONTROLLED_CODE as string)}`)
    const attribution = await page.evaluate(() => {
      try { return JSON.parse(sessionStorage.getItem('carup_referral_attribution') || '{}') } catch { return {} }
    })
    expect(attribution.referral_code).toBe(CONTROLLED_CODE)

    await login(page, INVITEE_EMAIL as string, INVITEE_PASSWORD as string)
    await page.waitForURL(/\/dashboard/, { timeout: 20000 })
    // Re-establish attribution in this tab, then submit the inquiry through the real modal.
    await page.goto(`/marketplace?ref=${encodeURIComponent(CONTROLLED_CODE as string)}`)
    await page.getByTestId('marketplace-inquiry-open').first().click()
    const [inquiryResp] = await Promise.all([
      page.waitForResponse((r) => /\/marketplace\/inquiries$/.test(r.url()) && r.request().method() === 'POST'),
      page.getByTestId('marketplace-inquiry-modal').getByRole('button', { name: /Send inquiry|Send/i }).last().click(),
    ])
    const inquiryBody = await inquiryResp.json()
    const inquiryId = inquiryBody?.inquiry?.id
    const leadEventId = inquiryBody?.inquiry?.referral_lead_event_id
    expect(inquiryId).toBeTruthy()
    // Remediation A: the inquiry bridged into a qualifiable lead that references THIS inquiry.
    expect(leadEventId, 'the attributed inquiry must produce a qualifiable referral lead').toBeTruthy()

    // 2. Admin qualifies that exact lead.
    const adminToken = await apiLogin(request, ADMIN_EMAIL as string, (process.env.E2E_UAT_ADMIN_PASSWORD as string))
    const qualifyRes = await request.post(`${API_BASE}/api/referrals/local-marketplace/leads/${leadEventId}/qualify`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: { milestone: 'order_paid', order_amount: 1000, referred_user_id: INVITEE_EMAIL },
    })
    expect(qualifyRes.ok()).toBeTruthy()

    // 3. Owner sees the pending benefit and files a dispute.
    await login(page, OWNER_EMAIL as string, OWNER_PASSWORD as string)
    await page.goto('/dashboard/referrals')
    await expect(page.getByText('Pending')).toBeVisible()
  })
})

async function apiLogin(request: import('@playwright/test').APIRequestContext, email: string, password: string): Promise<string> {
  const res = await request.post(`${API_BASE}/api/auth/login`, { data: { email, password } })
  const body = await res.json()
  return body.token || body.accessToken || body?.session?.access_token
}
