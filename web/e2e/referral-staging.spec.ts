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
const INVITEE_USER_ID = process.env.E2E_UAT_INVITEE_USER_ID
const OWNER_USER_ID = process.env.E2E_UAT_OWNER_USER_ID
const CONTROLLED_CODE = process.env.E2E_UAT_REFERRAL_CODE
const API_BASE = process.env.E2E_UAT_API_BASE_URL

interface StoredAttribution {
  referral_code?: string
}

interface InquiryResponseBody {
  inquiry?: {
    id?: string
    referral_lead_event_id?: string | null
  }
}

interface ReferralEventRecord {
  id: string
  metadata?: {
    source_inquiry_id?: string
    attribution?: {
      owner_user_id?: string
    }
  }
}

interface AuthSession {
  token: string
  user: {
    id: string
  }
}

interface WalletTransactionRecord {
  id: string
  user_id?: string
  status?: string
  metadata?: {
    lead_event_id?: string
  }
}

interface WalletResponseBody {
  transactions?: WalletTransactionRecord[]
}

interface OwnerDisputeRecord {
  dispute_id: string
}

interface OwnerDisputesResponseBody {
  disputes: OwnerDisputeRecord[]
}

test.describe('Referral Engine — closed owner/invitee journey (Stage-4 remediation)', () => {
  test.skip(
    !ADMIN_EMAIL || !OWNER_EMAIL || !INVITEE_EMAIL || !INVITEE_USER_ID || !OWNER_USER_ID || !CONTROLLED_CODE || !API_BASE,
    'set E2E_UAT_ADMIN_*, E2E_UAT_OWNER_*, E2E_UAT_INVITEE_*, E2E_UAT_INVITEE_USER_ID, E2E_UAT_OWNER_USER_ID, E2E_UAT_REFERRAL_CODE and E2E_UAT_API_BASE_URL to run the closed journey'
  )

  test('invitee inquiry becomes the qualifiable lead the admin qualifies; owner sees benefit + dispute resolution', async ({ page, request }) => {
    expect(API_BASE).not.toMatch(/carup-backend\.vercel\.app\/?$/)
    expect(API_BASE).not.toMatch(/production/i)
    expect(INVITEE_USER_ID, 'invitee user id must be provided; email is not acceptable as referred_user_id').toBeTruthy()
    expect(OWNER_USER_ID, 'owner user id must be provided for wallet verification').toBeTruthy()

    // 1. Invitee opens the attributed marketplace link (captures ?ref=) and submits an inquiry.
    await page.goto(`/marketplace?ref=${encodeURIComponent(CONTROLLED_CODE as string)}`)
    const attribution = await page.evaluate<StoredAttribution>(() => {
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
    const inquiryBody = (await inquiryResp.json()) as InquiryResponseBody
    const inquiryId = inquiryBody?.inquiry?.id
    const leadEventId = inquiryBody?.inquiry?.referral_lead_event_id
    expect(inquiryId).toBeTruthy()
    // Remediation A: the inquiry bridged into a qualifiable lead that references THIS inquiry.
    expect(leadEventId, 'the attributed inquiry must produce a qualifiable referral lead').toBeTruthy()

    const adminSession = await apiLogin(request, ADMIN_EMAIL as string, process.env.E2E_UAT_ADMIN_PASSWORD as string)
    const ownerSession = await apiLogin(request, OWNER_EMAIL as string, process.env.E2E_UAT_OWNER_PASSWORD as string)

    const leadEventsBefore = await fetchAdminEvents(request, adminSession.token, 'local_marketplace.lead_created')
    const exactLeadEvents = leadEventsBefore.filter((event) => event.id === leadEventId && event.metadata?.source_inquiry_id === inquiryId)
    expect(exactLeadEvents).toHaveLength(1)
    expect(exactLeadEvents[0].metadata?.attribution?.owner_user_id).toBe(OWNER_USER_ID)

    // 2. Admin locates and qualifies that exact lead through the UI.
    await login(page, ADMIN_EMAIL as string, process.env.E2E_UAT_ADMIN_PASSWORD as string)
    await page.waitForURL(/\/(admin|dashboard)/, { timeout: 20000 })
    await page.goto('/admin/referrals/local-leads')
    await expect(page.getByText(leadEventId)).toBeVisible({ timeout: 20000 })
    await page.getByTestId('referral-qualify-lead-id').fill(leadEventId)
    await page.getByTestId('referral-qualify-milestone').fill('order_paid')
    await page.getByTestId('referral-qualify-referred-user').fill(INVITEE_USER_ID as string)
    await page.getByTestId('referral-qualify-reward-amount').fill('5')
    await page.getByTestId('referral-qualify-submit').click()
    await expect(page.getByTestId('referral-qualify-message')).toContainText(/reward_created:\s*true/i, { timeout: 20000 })
    await page.getByTestId('referral-qualify-submit').click()
    await expect(page.getByTestId('referral-qualify-message')).toContainText(/already exists/i, { timeout: 20000 })

    const leadEventsAfter = await fetchAdminEvents(request, adminSession.token, 'local_marketplace.lead_created')
    expect(leadEventsAfter.filter((event) => event.metadata?.source_inquiry_id === inquiryId)).toHaveLength(1)
    const wallet = await fetchWallet(request, ownerSession.token, OWNER_USER_ID as string)
    const pendingTransactions = (wallet.transactions || []).filter((tx) =>
      tx.status === 'pending' &&
      tx.user_id === OWNER_USER_ID &&
      tx.metadata?.lead_event_id === leadEventId
    )
    expect(pendingTransactions).toHaveLength(1)
    const walletTransactionId = pendingTransactions[0].id
    expect((wallet.transactions || []).some((tx) => tx.user_id === INVITEE_USER_ID)).toBeFalsy()
    expect((wallet.transactions || []).some((tx) => tx.user_id === adminSession.user.id)).toBeFalsy()
    expect(['approved', 'payable', 'paid_or_applied']).not.toContain(pendingTransactions[0].status)

    // 3. Owner sees the pending benefit and files a dispute through the UI.
    await login(page, OWNER_EMAIL as string, OWNER_PASSWORD as string)
    await page.goto('/dashboard/referrals')
    await expect(page.getByTestId(`referral-wallet-transaction-${walletTransactionId}`)).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId(`referral-wallet-transaction-status-${walletTransactionId}`)).toContainText(/pending/i)
    await page.getByTestId('referral-dispute-transaction-select').selectOption(walletTransactionId)
    await page.getByTestId('referral-dispute-reason').fill(`Stage 4 closed journey dispute for ${inquiryId}`)
    await page.getByTestId('referral-dispute-submit').click()
    await expect(page.getByTestId('referral-dispute-message')).toContainText(/dispute filed/i, { timeout: 20000 })

    const ownerDisputes = await fetchOwnerDisputes(request, ownerSession.token, walletTransactionId)
    expect(ownerDisputes.disputes).toHaveLength(1)
    const disputeId = ownerDisputes.disputes[0].dispute_id

    // 4. Admin resolves the exact dispute through the UI with a required reason.
    await login(page, ADMIN_EMAIL as string, process.env.E2E_UAT_ADMIN_PASSWORD as string)
    await page.goto('/admin/referrals/trust')
    await expect(page.getByText(disputeId)).toBeVisible({ timeout: 20000 })
    await page.getByTestId('referral-resolve-dispute-id').fill(disputeId)
    await page.getByTestId('referral-resolve-outcome').selectOption('resolved_upheld')
    await page.getByTestId('referral-resolve-reason').fill(`Stage 4 closure verified for inquiry ${inquiryId}`)
    await page.getByTestId('referral-resolve-submit').click()
    await expect(page.getByTestId('referral-resolve-message')).toContainText(/resolved/i, { timeout: 20000 })

    // 5. Owner refreshes and sees the resolved status/outcome/timestamp.
    await login(page, OWNER_EMAIL as string, OWNER_PASSWORD as string)
    await page.goto('/dashboard/referrals')
    await page.reload()
    await expect(page.getByTestId(`dispute-status-${walletTransactionId}`)).toContainText(/resolved/i, { timeout: 20000 })
    await expect(page.getByTestId(`dispute-status-${walletTransactionId}`)).toContainText(/upheld/i)
    await expect(page.getByTestId(`dispute-status-${walletTransactionId}`)).toContainText(/Resolved/i)
  })
})

async function apiLogin(request: import('@playwright/test').APIRequestContext, email: string, password: string): Promise<AuthSession> {
  const apiBase = API_BASE as string
  const res = await request.post(`${apiBase}/api/auth/login`, { data: { email, password } })
  const body = (await res.json()) as {
    token?: string
    accessToken?: string
    session?: { access_token?: string }
    user?: { id?: string }
  }
  return {
    token: body.token || body.accessToken || body.session?.access_token || '',
    user: { id: body.user?.id || '' },
  }
}

async function fetchAdminEvents(request: import('@playwright/test').APIRequestContext, token: string, eventType: string): Promise<ReferralEventRecord[]> {
  const apiBase = API_BASE as string
  const res = await request.get(`${apiBase}/api/referrals/admin/events?event_type=${encodeURIComponent(eventType)}&limit=200`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { events?: ReferralEventRecord[] }
  return body.events || []
}

async function fetchWallet(request: import('@playwright/test').APIRequestContext, token: string, userId: string): Promise<WalletResponseBody> {
  const apiBase = API_BASE as string
  const res = await request.get(`${apiBase}/api/referrals/wallets/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.ok()).toBeTruthy()
  return res.json()
}

async function fetchOwnerDisputes(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  walletTransactionId: string
): Promise<OwnerDisputesResponseBody> {
  const apiBase = API_BASE as string
  const res = await request.get(`${apiBase}/api/referrals/trust/disputes/mine?wallet_transaction_id=${encodeURIComponent(walletTransactionId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.ok()).toBeTruthy()
  return res.json()
}
