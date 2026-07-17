import { test, expect } from '@playwright/test'
import { stage5ShouldSkip } from '../src/lib/stage5CredentialGate'

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
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.reload()
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
  amount?: number
  currency?: string
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
    test.setTimeout(180_000)

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
    await page.waitForURL(/\/dashboard/, { timeout: 20000 })
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
    await page.waitForURL(/\/(admin|dashboard)/, { timeout: 20000 })
    await page.goto('/admin/referrals/trust')
    await expect(page.getByText(disputeId)).toBeVisible({ timeout: 20000 })
    await page.getByTestId('referral-resolve-dispute-id').fill(disputeId)
    await page.getByTestId('referral-resolve-outcome').selectOption('resolved_upheld')
    await page.getByTestId('referral-resolve-reason').fill(`Stage 4 closure verified for inquiry ${inquiryId}`)
    await page.getByTestId('referral-resolve-submit').click()
    await expect(page.getByTestId('referral-resolve-message')).toContainText(/resolved/i, { timeout: 20000 })

    // 5. Owner refreshes and sees the resolved status/outcome/timestamp.
    await login(page, OWNER_EMAIL as string, OWNER_PASSWORD as string)
    await page.waitForURL(/\/dashboard/, { timeout: 20000 })
    await page.goto('/dashboard/referrals')
    await page.reload()
    await expect(page.getByTestId(`dispute-status-${walletTransactionId}`)).toContainText(/resolved/i, { timeout: 20000 })
    await expect(page.getByTestId(`dispute-status-${walletTransactionId}`)).toContainText(/upheld/i)
    await expect(page.getByTestId(`dispute-status-${walletTransactionId}`)).toContainText(/Resolved/i)
  })
})

test.describe('Referral Engine — import, parts, and container journey (Stage-5 acceptance)', () => {
  // Every credential AND identifier the Stage 5 journey uses must be present —
  // including all three passwords — or it skips deliberately instead of passing
  // undefined to login. stage5ShouldSkip() is unit-tested so this gate does not drift.
  test.skip(
    stage5ShouldSkip(process.env),
    'set all E2E_UAT_ADMIN_*, E2E_UAT_OWNER_*, E2E_UAT_INVITEE_*, user IDs and E2E_UAT_API_BASE_URL to run Stage 5'
  )

  test('admin UI creates import routes/leads and qualifies pending owner rewards', async ({ page, request }) => {
    test.setTimeout(240_000)

    expect(API_BASE).not.toMatch(/carup-backend\.vercel\.app\/?$/)
    const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)
    const runTag = `REFV1-STAGING-S5-${stamp}Z`
    const slug = runTag.toLowerCase()

    const adminSession = await apiLogin(request, ADMIN_EMAIL as string, ADMIN_PASSWORD as string)
    const ownerSession = await apiLogin(request, OWNER_EMAIL as string, OWNER_PASSWORD as string)
    const inviteeSession = await apiLogin(request, INVITEE_EMAIL as string, INVITEE_PASSWORD as string)

    const bundle = await createImportBundle(request, adminSession.token, {
      code: `${runTag}-CODE`,
      campaign_name: `${runTag} Import Acceptance`,
      owner_user_id: OWNER_USER_ID as string,
      flow_type: 'parts_import',
      route_origin: 'Japan',
      route_destination: 'Zimbabwe',
    })
    const referralCode = bundle.code?.code || `${runTag}-CODE`
    expect(bundle.code?.owner_user_id).toBe(OWNER_USER_ID)

    await login(page, ADMIN_EMAIL as string, ADMIN_PASSWORD as string)
    await page.waitForURL(/\/(admin|dashboard)/, { timeout: 20000 })
    await page.goto('/admin/referrals/import-routes')
    await expect(page).toHaveURL(/\/admin\/referrals\/import-routes/)

    const vehicleRouteKey = `${slug}-vehicle`
    await page.getByTestId('referral-import-route-origin').fill('Japan')
    await page.getByTestId('referral-import-route-destination').fill('Zimbabwe')
    await page.getByTestId('referral-import-route-flow').selectOption('vehicle_import')
    await page.getByTestId('referral-import-route-key-input').fill(vehicleRouteKey)
    await page.getByTestId('referral-import-route-total-capacity').fill('8')
    await page.getByTestId('referral-import-route-unit-label').fill('vehicles')
    await page.getByTestId('referral-import-route-create').click()
    await expect(page.getByTestId('referral-import-route-message')).toContainText(vehicleRouteKey, { timeout: 20000 })
    await page.reload()
    await page.getByTestId('referral-import-status-route-key').fill(vehicleRouteKey)
    await page.getByTestId('referral-import-status-check').click()
    await expect(page.getByTestId('referral-import-status-text')).toContainText(/total:\s*8/i, { timeout: 20000 })
    await expect(page.getByTestId('referral-import-status-text')).toContainText(/booked:\s*0/i)
    await page.getByTestId('referral-import-capacity-total').fill('8')
    await page.getByTestId('referral-import-capacity-booked').fill('8')
    await page.getByTestId('referral-import-capacity-update').click()
    await expect(page.getByTestId('referral-import-status-text')).toContainText(/booked:\s*8/i, { timeout: 20000 })
    await expect(page.getByTestId('referral-import-status-text')).toContainText(/available:\s*0/i)

    await page.getByTestId('referral-import-lead-route-key').fill('')
    await page.getByTestId('referral-import-lead-flow').selectOption('parts_import')
    await page.getByTestId('referral-import-lead-capacity').fill('')
    await page.getByTestId('referral-import-lead-referral-code').fill(referralCode)
    await page.getByTestId('referral-import-lead-reference').fill(`${runTag}-PARTS-LEAD`)
    await page.getByTestId('referral-import-lead-contact-user-id').fill(INVITEE_USER_ID as string)
    await page.getByTestId('referral-import-lead-part-name').fill('replacement engine')
    await page.getByTestId('referral-import-lead-create').click()
    const partsLeadMessage = page.getByTestId('referral-import-lead-message')
    await expect(partsLeadMessage).toContainText(/Lead created/i, { timeout: 20000 })
    const partsLeadId = extractEventId(await partsLeadMessage.textContent())
    expect(partsLeadId).toBeTruthy()

    await page.getByTestId('referral-import-qualify-lead-event-id').fill(partsLeadId)
    await page.getByTestId('referral-import-qualify-milestone').fill('parts_order_paid')
    await page.getByTestId('referral-import-qualify-reward-amount').fill('10')
    await page.getByTestId('referral-import-qualify-referred-user-id').fill(INVITEE_USER_ID as string)
    await page.getByTestId('referral-import-qualify-result-reference').fill(`${runTag}-PARTS-PAID`)
    await page.getByTestId('referral-import-qualify-submit').click()
    await expect(page.getByTestId('referral-import-qualify-message')).toContainText(/reward_created:\s*true/i, { timeout: 20000 })
    await page.getByTestId('referral-import-qualify-submit').click()
    await expect(page.getByTestId('referral-import-qualify-message')).toContainText(/already exists/i, { timeout: 20000 })

    const containerRouteKey = `${slug}-container`
    await page.getByTestId('referral-import-route-origin').fill('Japan')
    await page.getByTestId('referral-import-route-destination').fill('Zimbabwe')
    await page.getByTestId('referral-import-route-flow').selectOption('container_space')
    await page.getByTestId('referral-import-route-key-input').fill(containerRouteKey)
    await page.getByTestId('referral-import-route-total-capacity').fill('30')
    await page.getByTestId('referral-import-route-unit-label').fill('CBM')
    await page.getByTestId('referral-import-route-create').click()
    await expect(page.getByTestId('referral-import-route-message')).toContainText(containerRouteKey, { timeout: 20000 })
    await page.getByTestId('referral-import-status-route-key').fill(containerRouteKey)
    await page.getByTestId('referral-import-status-check').click()
    await expect(page.getByTestId('referral-import-status-text')).toContainText(/total:\s*30/i, { timeout: 20000 })
    await expect(page.getByTestId('referral-import-status-text')).toContainText(/booked:\s*0/i)

    await page.getByTestId('referral-import-lead-route-key').fill(containerRouteKey)
    await page.getByTestId('referral-import-lead-flow').selectOption('container_space')
    await page.getByTestId('referral-import-lead-capacity').fill('5')
    await page.getByTestId('referral-import-lead-referral-code').fill(referralCode)
    await page.getByTestId('referral-import-lead-reference').fill(`${runTag}-CONTAINER-VALID`)
    await page.getByTestId('referral-import-lead-contact-user-id').fill(INVITEE_USER_ID as string)
    await page.getByTestId('referral-import-lead-part-name').fill('')
    await page.getByTestId('referral-import-lead-create').click()
    await expect(partsLeadMessage).toContainText(/waitlisted:\s*false/i, { timeout: 20000 })
    const containerLeadId = extractEventId(await partsLeadMessage.textContent())
    expect(containerLeadId).toBeTruthy()

    await page.getByTestId('referral-import-capacity-total').fill('30')
    await page.getByTestId('referral-import-capacity-booked').fill('28')
    await page.getByTestId('referral-import-capacity-update').click()
    await expect(page.getByTestId('referral-import-status-text')).toContainText(/available:\s*2/i, { timeout: 20000 })
    await page.getByTestId('referral-import-lead-reference').fill(`${runTag}-CONTAINER-OVER`)
    await page.getByTestId('referral-import-lead-capacity').fill('5')
    if (await page.getByTestId('referral-import-lead-allow-waitlist').isChecked()) {
      await page.getByTestId('referral-import-lead-allow-waitlist').uncheck()
    }
    await page.getByTestId('referral-import-lead-create').click()
    await expect(page.getByTestId('referral-import-lead-message')).toContainText(/exceeds|capacity|available/i, { timeout: 20000 })

    await page.getByTestId('referral-import-lead-reference').fill(`${runTag}-CONTAINER-WAITLIST`)
    await page.getByTestId('referral-import-lead-allow-waitlist').check()
    await page.getByTestId('referral-import-lead-create').click()
    await expect(page.getByTestId('referral-import-lead-message')).toContainText(/waitlisted:\s*true/i, { timeout: 20000 })
    const waitlistedLeadId = extractEventId(await page.getByTestId('referral-import-lead-message').textContent())
    expect(waitlistedLeadId).toBeTruthy()

    await page.getByTestId('referral-import-qualify-lead-event-id').fill(containerLeadId)
    await page.getByTestId('referral-import-qualify-milestone').fill('deposit_paid')
    await page.getByTestId('referral-import-qualify-reward-amount').fill('10')
    await page.getByTestId('referral-import-qualify-referred-user-id').fill(INVITEE_USER_ID as string)
    await page.getByTestId('referral-import-qualify-result-reference').fill(`${runTag}-CONTAINER-DEPOSIT`)
    await page.getByTestId('referral-import-qualify-submit').click()
    await expect(page.getByTestId('referral-import-qualify-message')).toContainText(/reward_created:\s*true/i, { timeout: 20000 })
    await page.getByTestId('referral-import-qualify-submit').click()
    await expect(page.getByTestId('referral-import-qualify-message')).toContainText(/already exists/i, { timeout: 20000 })

    // (1) Owner wallet holds EXACTLY the two Stage 5 rewards for the captured leads.
    const wallet = await fetchWallet(request, ownerSession.token, OWNER_USER_ID as string)
    const stage5Transactions = (wallet.transactions || []).filter((tx) => tx.metadata?.lead_event_id === partsLeadId || tx.metadata?.lead_event_id === containerLeadId)
    expect(stage5Transactions).toHaveLength(2)
    // (2) Every captured transaction: user_id === OWNER_USER_ID and status === pending.
    expect(stage5Transactions.every((tx) => tx.user_id === OWNER_USER_ID && tx.status === 'pending')).toBeTruthy()
    expect(stage5Transactions.map((tx) => tx.metadata?.lead_event_id).sort()).toEqual([containerLeadId, partsLeadId].sort())
    // (4) Admin is NOT the wallet-transaction owner.
    expect(stage5Transactions.every((tx) => tx.user_id !== adminSession.user.id)).toBeTruthy()

    // (3) The invitee token CANNOT read the OWNER wallet — the real security
    // boundary (an invitee reading its OWN wallet is legitimately allowed).
    expect(await fetchWalletStatus(request, inviteeSession.token, OWNER_USER_ID as string)).toBe(403)

    // (5) The invitee MAY have an unrelated wallet; if it exists it must contain
    // NO transaction whose metadata.lead_event_id matches either Stage 5 lead.
    // We do NOT require the invitee's own wallet to be absent.
    const inviteeWallet = await fetchWalletAllowMissing(request, inviteeSession.token, INVITEE_USER_ID as string)
    if (inviteeWallet.status === 200) {
      const leaked = (inviteeWallet.body.transactions || []).filter(
        (tx) => tx.metadata?.lead_event_id === partsLeadId || tx.metadata?.lead_event_id === containerLeadId
      )
      expect(leaked, 'invitee wallet must not contain any Stage 5 reward').toHaveLength(0)
    }

    // Negative authorization boundaries (owner is NOT an operator/admin).
    expect(
      await importRouteCreateStatus(request, ownerSession.token, `${slug}-owner-denied`),
      'owner must not create an import route'
    ).toBe(403)
    expect(
      await importRouteCapacityStatus(request, ownerSession.token, vehicleRouteKey),
      'owner must not update import route capacity'
    ).toBe(403)
    expect(
      await importQualifyStatus(request, ownerSession.token, partsLeadId, { milestone: 'parts_order_paid', reward_amount: 10 }),
      'owner must not qualify an import lead'
    ).toBe(403)
    expect(
      await importRouteCreateStatus(request, '', `${slug}-unauth-denied`),
      'unauthenticated import administration must be rejected'
    ).toBe(401)

    // (6) Tampering: qualify a fresh owner-code lead while injecting caller-supplied
    // reward-owner-like fields. The backend derives the owner from the persisted
    // referral attribution/code, so the resulting reward must STILL belong to
    // OWNER_USER_ID — never the injected invitee.
    const tamperLead = await createImportLeadApi(request, adminSession.token, {
      flow_type: 'parts_import',
      referral_code: referralCode,
      lead_reference: `${runTag}-TAMPER-LEAD`,
      contact: { user_id: INVITEE_USER_ID as string },
      part_request: { part_name: 'tamper engine' },
    })
    expect(tamperLead.eventId).toBeTruthy()
    const tamperQualify = await importQualifyRaw(request, adminSession.token, tamperLead.eventId, {
      milestone: 'parts_order_paid',
      reward_amount: 10,
      result_reference: `${runTag}-TAMPER-PAID`,
      // Injected caller-supplied ownership fields — MUST be ignored by the backend.
      owner_user_id: INVITEE_USER_ID,
      reward_owner_user_id: INVITEE_USER_ID,
      wallet_owner_id: INVITEE_USER_ID,
      referred_user_id: INVITEE_USER_ID,
    })
    expect(tamperQualify.status, 'tampered qualify still succeeds on the server-derived owner').toBe(200)
    const walletAfterTamper = await fetchWallet(request, ownerSession.token, OWNER_USER_ID as string)
    const tamperTx = (walletAfterTamper.transactions || []).find((tx) => tx.metadata?.lead_event_id === tamperLead.eventId)
    expect(tamperTx, 'the tampered reward must land in a wallet').toBeTruthy()
    expect(tamperTx?.user_id, 'reward owner is derived from the referral code, not the injected field').toBe(OWNER_USER_ID)
    // The injected invitee must NOT have received the tampered reward.
    const inviteeWalletAfter = await fetchWalletAllowMissing(request, inviteeSession.token, INVITEE_USER_ID as string)
    if (inviteeWalletAfter.status === 200) {
      expect((inviteeWalletAfter.body.transactions || []).some((tx) => tx.metadata?.lead_event_id === tamperLead.eventId)).toBeFalsy()
    }

    await login(page, OWNER_EMAIL as string, OWNER_PASSWORD as string)
    await page.waitForURL(/\/dashboard/, { timeout: 20000 })
    await page.goto('/dashboard/referrals')
    for (const tx of stage5Transactions) {
      await expect(page.getByTestId(`referral-wallet-transaction-${tx.id}`)).toBeVisible({ timeout: 20000 })
      await expect(page.getByTestId(`referral-wallet-transaction-status-${tx.id}`)).toContainText(/pending/i)
    }
    const disputeOptions = await page.getByTestId('referral-dispute-transaction-select').locator('option').allTextContents()
    for (const tx of stage5Transactions) {
      const option = disputeOptions.find((text) => text.includes(tx.id.slice(-4)))
      expect(option).toBeTruthy()
      expect(option).toMatch(/USD|\$/i)
      expect(option).toMatch(/pending/i)
    }
  })
})

async function apiLogin(request: import('@playwright/test').APIRequestContext, email: string, password: string): Promise<AuthSession> {
  const apiBase = API_BASE as string
  const res = await request.post(`${apiBase}/api/auth/login`, { data: { email, password } })
  expect(res.status(), `login should succeed for ${email}`).toBe(200)
  const body = (await res.json()) as {
    token?: string
    accessToken?: string
    session?: { access_token?: string }
    user?: { id?: string }
  }
  const token = body.token || body.accessToken || body.session?.access_token || ''
  expect(token, `login should return a token for ${email}`).toBeTruthy()
  return { token, user: { id: body.user?.id || '' } }
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

async function createImportBundle(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  data: Record<string, unknown>
): Promise<{
  code?: {
    code?: string
    id?: string
    owner_user_id?: string
  }
  campaign?: {
    id?: string
  }
}> {
  const apiBase = API_BASE as string
  const res = await request.post(`${apiBase}/api/referrals/import-campaigns/referral-bundles`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  })
  expect(res.ok()).toBeTruthy()
  return res.json()
}

async function fetchWalletStatus(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  userId: string
): Promise<number> {
  const apiBase = API_BASE as string
  const res = await request.get(`${apiBase}/api/referrals/wallets/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return res.status()
}

/** Fetch a wallet that may not exist; returns the status and a safe body (never throws on non-200). */
async function fetchWalletAllowMissing(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  userId: string
): Promise<{ status: number; body: WalletResponseBody }> {
  const apiBase = API_BASE as string
  const res = await request.get(`${apiBase}/api/referrals/wallets/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  let body: WalletResponseBody = {}
  if (res.status() === 200) {
    body = (await res.json()) as WalletResponseBody
  }
  return { status: res.status(), body }
}

/** Optional bearer header — an empty token yields an UNAUTHENTICATED request. */
function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** POST an import-route create; returns only the HTTP status (for authz boundary checks). */
async function importRouteCreateStatus(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  routeKey: string
): Promise<number> {
  const apiBase = API_BASE as string
  const res = await request.post(`${apiBase}/api/referrals/import-campaigns/routes`, {
    headers: authHeaders(token),
    data: { origin: 'Japan', destination: 'Zimbabwe', flow_type: 'vehicle_import', route_key: routeKey, total_capacity: 1, unit_label: 'vehicles' },
  })
  return res.status()
}

async function importRouteCapacityStatus(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  routeKey: string
): Promise<number> {
  const apiBase = API_BASE as string
  const res = await request.post(`${apiBase}/api/referrals/import-campaigns/routes/${encodeURIComponent(routeKey)}/capacity`, {
    headers: authHeaders(token),
    data: { total: 8, booked: 1 },
  })
  return res.status()
}

async function importQualifyStatus(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  leadEventId: string,
  payload: Record<string, unknown>
): Promise<number> {
  const apiBase = API_BASE as string
  const res = await request.post(`${apiBase}/api/referrals/import-campaigns/leads/${encodeURIComponent(leadEventId)}/qualify`, {
    headers: authHeaders(token),
    data: payload,
  })
  return res.status()
}

async function createImportLeadApi(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  payload: Record<string, unknown>
): Promise<{ status: number; eventId: string }> {
  const apiBase = API_BASE as string
  const res = await request.post(`${apiBase}/api/referrals/import-campaigns/leads`, {
    headers: authHeaders(token),
    data: payload,
  })
  let eventId = ''
  if (res.ok()) {
    const body = (await res.json()) as { event_id?: string }
    eventId = body.event_id || ''
  }
  return { status: res.status(), eventId }
}

/** Qualify with an arbitrary (possibly tampered) payload; returns status + parsed body. */
async function importQualifyRaw(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  leadEventId: string,
  payload: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const apiBase = API_BASE as string
  const res = await request.post(`${apiBase}/api/referrals/import-campaigns/leads/${encodeURIComponent(leadEventId)}/qualify`, {
    headers: authHeaders(token),
    data: payload,
  })
  let body: Record<string, unknown> = {}
  try { body = (await res.json()) as Record<string, unknown> } catch { /* non-JSON */ }
  return { status: res.status(), body }
}

function extractEventId(text: string | null): string {
  const match = (text || '').match(/event_id:\s*([0-9a-f-]{36})/i)
  return match?.[1] || ''
}
