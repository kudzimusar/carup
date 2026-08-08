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

// Stage-4 remediation COMPLETE closure journey. Runs only against an environment where the corrected
// runtime is deployed AND the frontend is wired to that same backend (post-merge official staging, or a
// preview whose frontend targets the matching backend). Admin qualification and dispute resolution use
// the real UI; API/DB is used only for post-action verification and negative testing.
const INVITEE_EMAIL = process.env.E2E_UAT_INVITEE_EMAIL
const INVITEE_PASSWORD = process.env.E2E_UAT_INVITEE_PASSWORD
const INVITEE_USER_ID = process.env.E2E_UAT_INVITEE_USER_ID     // the controlled invitee USER ID (not email)
const OWNER_USER_ID = process.env.E2E_UAT_OWNER_USER_ID         // the referral code owner USER ID
const ADMIN_USER_ID = process.env.E2E_UAT_ADMIN_USER_ID
const CONTROLLED_CODE = process.env.E2E_UAT_REFERRAL_CODE       // an ACTIVE code owned by OWNER_USER_ID
const API_BASE = process.env.E2E_UAT_API_BASE_URL

test.describe('Referral Engine — complete closed owner/invitee journey (Stage-4 remediation)', () => {
  test.skip(
    !ADMIN_EMAIL || !OWNER_EMAIL || !INVITEE_EMAIL || !INVITEE_USER_ID || !OWNER_USER_ID || !CONTROLLED_CODE || !API_BASE,
    'set E2E_UAT_ADMIN_*, E2E_UAT_OWNER_*, E2E_UAT_INVITEE_*(+_USER_ID), E2E_UAT_OWNER_USER_ID, E2E_UAT_REFERRAL_CODE and E2E_UAT_API_BASE_URL to run the full closure journey'
  )

  test('invitee UI inquiry → bridged lead → admin UI qualify → owner benefit → dispute → admin UI resolve → owner sees resolution', async ({ page, request }) => {
    // ── 1. Invitee opens the attributed link, logs in, submits a marketplace inquiry through the UI. ──
    await page.goto(`/marketplace?ref=${encodeURIComponent(CONTROLLED_CODE as string)}`)
    expect(await storedReferralCode(page)).toBe(CONTROLLED_CODE)
    await login(page, INVITEE_EMAIL as string, INVITEE_PASSWORD as string)
    await page.waitForURL(/\/dashboard/, { timeout: 20000 })
    await page.goto(`/marketplace?ref=${encodeURIComponent(CONTROLLED_CODE as string)}`)
    await page.getByTestId('marketplace-inquiry-open').first().click()
    const [inquiryResp] = await Promise.all([
      page.waitForResponse((r) => /\/marketplace\/inquiries$/.test(r.url()) && r.request().method() === 'POST'),
      page.getByTestId('marketplace-inquiry-modal').getByRole('button', { name: /Send inquiry|Send/i }).last().click(),
    ])
    const inquiryBody = await inquiryResp.json()
    const inquiryId: string = inquiryBody?.inquiry?.id
    const leadEventId: string = inquiryBody?.inquiry?.referral_lead_event_id
    expect(inquiryId, 'inquiry id present').toBeTruthy()
    expect(leadEventId, 'the attributed inquiry produced a qualifiable referral lead').toBeTruthy()

    // ── 2. Prove the inquiry id and the bridged lead's source inquiry id are the SAME journey. ──
    const adminToken = await apiLogin(request, ADMIN_EMAIL as string, process.env.E2E_UAT_ADMIN_PASSWORD as string)
    const leadRow = await apiJson(request, `${API_BASE}/api/referrals/local-marketplace/leads?limit=200`, adminToken)
    const bridged = (leadRow.leads || []).find((l: Record<string, unknown>) => l.event_id === leadEventId || l.id === leadEventId)
    expect(bridged, 'the bridged lead is listed for the admin').toBeTruthy()
    // The lead references this inquiry (source inquiry id === inquiry id).
    const leadDetail = bridged as Record<string, unknown>
    expect(String(leadDetail.source_inquiry_id ?? leadDetail.subject_id ?? '')).toBe(inquiryId)

    // Registration/inquiry alone must NOT mint a benefit yet.
    expect(await ownerPendingCount(request, adminToken)).toBe(0)

    // ── 3. Admin qualifies THAT exact lead through the admin UI. ──
    await login(page, ADMIN_EMAIL as string, process.env.E2E_UAT_ADMIN_PASSWORD as string)
    await page.waitForURL(/\/admin/, { timeout: 20000 })
    await page.goto('/admin/referrals/local-leads')
    await page.getByRole('textbox', { name: 'lead_event_id *' }).fill(leadEventId)
    await page.getByRole('textbox', { name: 'Milestone *' }).fill('order_paid')
    await page.getByRole('spinbutton', { name: 'Reward amount' }).fill('15')
    await page.getByRole('button', { name: 'Qualify' }).click()
    await expect(page.getByText(/reward_created:\s*true/i)).toBeVisible({ timeout: 15000 })

    // ── 4. Exactly one pending benefit, owned by the CODE OWNER — not invitee, not admin. ──
    const ownerWallet = await apiJson(request, `${API_BASE}/api/referrals/wallets/${OWNER_USER_ID}`, adminToken)
    const ownerBenefits = (ownerWallet.transactions || []).filter((t: Record<string, unknown>) => t.code_id === leadDetail.code_id || t.campaign_id === leadDetail.campaign_id)
    expect(ownerBenefits.length, 'exactly one pending benefit for this journey').toBe(1)
    expect(ownerBenefits[0].user_id).toBe(OWNER_USER_ID)
    expect(ownerBenefits[0].status).toBe('pending')
    const inviteeWallet = await apiJson(request, `${API_BASE}/api/referrals/wallets/${INVITEE_USER_ID}`, adminToken).catch(() => ({ transactions: [] }))
    expect((inviteeWallet.transactions || []).some((t: Record<string, unknown>) => t.id === ownerBenefits[0].id)).toBe(false)
    if (ADMIN_USER_ID) {
      const adminWallet = await apiJson(request, `${API_BASE}/api/referrals/wallets/${ADMIN_USER_ID}`, adminToken).catch(() => ({ transactions: [] }))
      expect((adminWallet.transactions || []).some((t: Record<string, unknown>) => t.id === ownerBenefits[0].id)).toBe(false)
    }
    const walletTxId: string = ownerBenefits[0].id

    // ── 5. Duplicate qualification of the same lead is blocked (no second benefit). ──
    await page.getByRole('textbox', { name: 'lead_event_id *' }).fill(leadEventId)
    await page.getByRole('textbox', { name: 'Milestone *' }).fill('order_paid')
    await page.getByRole('spinbutton', { name: 'Reward amount' }).fill('15')
    await page.getByRole('button', { name: 'Qualify' }).click()
    await expect(page.getByText(/already exists/i)).toBeVisible({ timeout: 15000 })
    expect(await ownerPendingCount(request, adminToken)).toBe(1)

    // ── 6. Owner logs in, sees exactly one pending benefit, files a dispute through the UI. ──
    await login(page, OWNER_EMAIL as string, OWNER_PASSWORD as string)
    await page.goto('/dashboard/referrals')
    await expect(page.getByText('Pending')).toBeVisible()
    const disputeSelect = page.locator('select').filter({ hasText: 'Select a transaction' }).first()
    const pendingOption = (await disputeSelect.locator('option').allTextContents()).find((o) => /pending/i.test(o)) as string
    await disputeSelect.selectOption({ label: pendingOption })
    await page.getByRole('textbox', { name: 'Describe the issue' }).fill('E2E closure: owner disputes pending benefit')
    await page.getByRole('button', { name: 'File Dispute' }).click()
    await expect(page.getByText(/Dispute filed/i)).toBeVisible({ timeout: 15000 })
    // Owner immediately sees the submitted dispute status on the benefit.
    await expect(page.getByTestId(`dispute-status-${walletTxId}`)).toContainText(/submitted|open/i, { timeout: 15000 })

    // ── 7. Admin resolves the dispute through the trust UI, with a required reason. ──
    const disputeRow = await apiJson(request, `${API_BASE}/api/referrals/trust/disputes?wallet_transaction_id=${walletTxId}`, adminToken)
    const disputeEventId: string = (disputeRow.disputes || [])[0]?.dispute_event_id
    expect(disputeEventId).toBeTruthy()
    await login(page, ADMIN_EMAIL as string, process.env.E2E_UAT_ADMIN_PASSWORD as string)
    await page.goto('/admin/referrals/trust')
    await page.getByRole('textbox', { name: 'dispute_event_id' }).fill(disputeEventId)
    // no-reason attempt is blocked
    await page.getByRole('button', { name: 'Resolve Dispute' }).click()
    await expect(page.getByText(/reason (is )?required|required/i).first()).toBeVisible({ timeout: 10000 })
    // resolve with a reason
    await page.locator('div', { has: page.getByRole('button', { name: 'Resolve Dispute' }) })
      .getByRole('textbox', { name: 'reason (required)' }).last()
      .fill('E2E closure: milestone + attribution verified, upheld')
    await page.getByRole('button', { name: 'Resolve Dispute' }).click()
    await expect(page.getByText(/Dispute resolved/i)).toBeVisible({ timeout: 15000 })

    // ── 8. Owner refreshes and sees the resolved status, outcome and timestamp. ──
    await login(page, OWNER_EMAIL as string, OWNER_PASSWORD as string)
    await page.goto('/dashboard/referrals')
    const resolvedPanel = page.getByTestId(`dispute-status-${walletTxId}`)
    await expect(resolvedPanel).toContainText(/resolved/i, { timeout: 15000 })
    await expect(resolvedPanel).toContainText(/Resolved/, { timeout: 15000 }) // resolution timestamp label
    // Reward ownership is unchanged after the whole lifecycle.
    const finalWallet = await apiJson(request, `${API_BASE}/api/referrals/wallets/${OWNER_USER_ID}`, adminToken)
    expect((finalWallet.transactions || []).find((t: Record<string, unknown>) => t.id === walletTxId)?.user_id).toBe(OWNER_USER_ID)
  })
})

async function storedReferralCode(page: import('@playwright/test').Page): Promise<string | undefined> {
  return page.evaluate(() => {
    try { return JSON.parse(sessionStorage.getItem('carup_referral_attribution') || '{}').referral_code } catch { return undefined }
  })
}

async function ownerPendingCount(request: import('@playwright/test').APIRequestContext, adminToken: string): Promise<number> {
  const wallet = await apiJson(request, `${API_BASE}/api/referrals/wallets/${OWNER_USER_ID}`, adminToken).catch(() => ({ transactions: [] }))
  return (wallet.transactions || []).filter((t: Record<string, unknown>) => t.status === 'pending').length
}

async function apiLogin(request: import('@playwright/test').APIRequestContext, email: string, password: string): Promise<string> {
  const res = await request.post(`${API_BASE}/api/auth/login`, { data: { email, password } })
  const body = await res.json()
  return body.token || body.accessToken || body?.session?.access_token
}

type ApiJson = {
  leads?: Array<Record<string, unknown>>
  transactions?: Array<Record<string, unknown>>
  disputes?: Array<Record<string, unknown>>
  [key: string]: unknown
}

async function apiJson(request: import('@playwright/test').APIRequestContext, url: string, token: string): Promise<ApiJson> {
  const res = await request.get(url, { headers: { Authorization: `Bearer ${token}`, 'x-user-id': ADMIN_USER_ID || '' } })
  return res.json() as Promise<ApiJson>
}
