/**
 * CARUP-PAY-03B-LR01 — physical browser UAT of dealer subscriptions, administrator oversight and the F5 console.
 *
 * Runs ONLY against the isolated local runtime started by scripts/uat/pay03b-local-runtime.sh in --simulator mode
 * (production web build on 127.0.0.1:5193, backend on 127.0.0.1:5041, dedicated carup-pay03b-supabase stack). The
 * provider is the clearly labelled LOCAL PROVIDER SIMULATOR — not Stripe; no money moves. It never mocks the API.
 *
 *   PAY03B_EXPECTED_SHA=<candidate> PAY03B_EVIDENCE_DIR=$HOME/carup-launch-evidence/pay03b \
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5193 \
 *   npx playwright test e2e/pay03b-dealer-subscription.spec.ts --project=chromium --headed --retries=0
 *
 * Requires a freshly seeded database (scripts/uat/pay03b-qa-seed.mjs) in which dealer A has no subscription yet.
 */
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'

const EVIDENCE_DIR = process.env.PAY03B_EVIDENCE_DIR
const EXPECTED_SHA = process.env.PAY03B_EXPECTED_SHA
const API = 'http://127.0.0.1:5041'
const PGURL = 'postgresql://postgres:postgres@127.0.0.1:55422/postgres'

test.skip(!EVIDENCE_DIR || !EXPECTED_SHA, 'PAY-03B physical UAT runs only against the isolated local runtime (scripts/uat/pay03b-local-runtime.sh).')
test.describe.configure({ mode: 'serial', timeout: 180_000 })

type Account = { email: string; password: string; userId: string }
// QA accounts (objects) and the seeded tenant/organization ids (strings), as written by scripts/uat/pay03b-qa-seed.mjs.
const accounts: Record<string, Account | string> = EVIDENCE_DIR ? JSON.parse(readFileSync(`${EVIDENCE_DIR}/uat-accounts.json`, 'utf8')) : {}
const SCREENS = `${EVIDENCE_DIR}/screens`
if (EVIDENCE_DIR) mkdirSync(SCREENS, { recursive: true })
const sql = (q: string) => execFileSync('psql', [PGURL, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim()

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
] as const

const sessionCache: Record<string, { token: string; user: string }> = {}
async function login(page: Page, who: string) {
  const cached = sessionCache[who]
  if (cached) {
    await page.goto('/carup-provenance.json')
    await page.evaluate(({ token, user }) => {
      localStorage.clear(); sessionStorage.clear()
      localStorage.setItem('carup_token', token); localStorage.setItem('carup_user', user)
    }, cached)
    return
  }
  await page.goto('/login')
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await page.reload()
  await page.getByTestId('email-input').fill((accounts[who] as Account).email)
  await page.getByTestId('password-input').fill((accounts[who] as Account).password)
  await page.getByTestId('login-button').click()
  await page.waitForFunction(() => Boolean(localStorage.getItem('carup_token')))
  sessionCache[who] = await page.evaluate(() => ({ token: localStorage.getItem('carup_token') || '', user: localStorage.getItem('carup_user') || '' }))
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'no lateral page overflow').toBeLessThanOrEqual(1)
}

/** WCAG 2 A/AA (axe) on a PAY-03B surface; a failure names every offending node and the rule's own explanation. */
async function axeClean(page: Page, include: string) {
  const results = await new AxeBuilder({ page }).include(include).withTags(['wcag2a', 'wcag2aa']).analyze()
  const found = results.violations.flatMap((v) => v.nodes.map((n) =>
    `${v.id} @ ${n.target.join(' ')}: ${(n.any[0]?.message ?? n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 180)}`))
  expect(found, `no WCAG 2 A/AA violations in ${include}`).toEqual([])
}

// Every sensitive route (login, checkout, verify, change, cancel, admin reads...) shares ONE per-IP counter with a
// 10/min budget on most PAY-03B routes. This one-IP, machine-speed journey spends about 11 sensitive calls between
// the cancel/resume test and the third administrator view (3 per view: list, F5 list, detail), so it is paced.
test.afterEach(async () => { await new Promise((resolve) => setTimeout(resolve, 20_000)) })

test('runtime provenance: web build and backend are the candidate; provider is the local simulator', async ({ request, baseURL }) => {
  const web = await (await request.get(`${baseURL}/carup-provenance.json`)).json()
  expect(web.commit_sha).toBe(EXPECTED_SHA)
  const health = await (await request.get(`${API}/api/health`)).json()
  expect(health.build.commit_sha).toBe(EXPECTED_SHA)
  expect(sql(`select count(*) from public.pay03b_business_subscriptions where owner_tenant_id = '${accounts.tenantA}'`)).toBe('0')
})

for (const vp of VIEWPORTS) {
  test(`Pricing shows governed status, never a mock price (${vp.name})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto('/pricing')
    await expect(page.getByText(/not yet available/i).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/\$99\/mo|\$49\/mo|\$9\.99/)).toHaveCount(0)
    await noHorizontalOverflow(page)
    await axeClean(page, '[data-testid="pay03b-pricing-page"]')
    await page.screenshot({ path: `${SCREENS}/01-pricing-${vp.name}.png`, fullPage: true })
  })
}

for (const vp of VIEWPORTS) {
  test(`staff member sees Plan & Billing read-only (${vp.name})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await login(page, 'dealerAStaff')
    await page.goto('/dealer/subscription')
    await expect(page.getByTestId('pay03b-dealer-subscription')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('pay03b-read-only')).toBeVisible()
    await expect(page.getByTestId('pay03b-access-value')).toHaveText('No paid access')
    await expect(page.locator('[data-testid^="pay03b-subscribe-"]'), 'no purchase control without billing authority').toHaveCount(0)
    await noHorizontalOverflow(page)
    await axeClean(page, '[data-testid="pay03b-dealer-subscription"]')
    await page.screenshot({ path: `${SCREENS}/02-staff-readonly-${vp.name}.png`, fullPage: true })
  })
}

test('billing admin reviews terms, pays on the SIMULATED provider page, and the server confirms access (desktop)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, 'dealerA')
  await page.goto('/dealer/subscription')
  await expect(page.getByTestId('pay03b-dealer-subscription')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('pay03b-sandbox-label').first()).toBeVisible()
  await expect(page.getByTestId('pay03b-capacity-value')).toHaveText('Up to 3 published listings')
  await axeClean(page, '[data-testid="pay03b-dealer-subscription"]')
  await page.screenshot({ path: `${SCREENS}/03-dealer-before-${'desktop'}.png`, fullPage: true })
  await page.getByTestId('pay03b-subscribe-dealer_storefront_simulator_standard').click()
  const dialog = page.getByTestId('pay03b-terms-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(/3,000/)
  await expect(page.getByTestId('pay03b-terms-simulated-label')).toBeVisible()
  await axeClean(page, '[data-testid="pay03b-terms-dialog"]')
  await page.screenshot({ path: `${SCREENS}/04-terms-review-desktop.png`, fullPage: true })
  await page.getByTestId('pay03b-terms-confirm').click()
  await page.waitForURL(/127\.0\.0\.1:5041\/api\/pay03b\/simulator\/checkout\/sim_cs_/, { timeout: 60_000 })
  await expect(page.getByTestId('pay03b-simulator-banner')).toContainText('SIMULATED PROVIDER — NOT STRIPE')
  await expect(page.getByTestId('pay03b-simulator-amount')).toContainText('JPY 3,000')
  await page.screenshot({ path: `${SCREENS}/05-simulated-provider-checkout.png`, fullPage: true })
  await page.getByTestId('pay03b-simulator-pay').click()
  await page.waitForURL(/127\.0\.0\.1:5193\/dealer\/subscription\?pay03b=returned/, { timeout: 60_000 })
  await expect(page.getByTestId('pay03b-access-value')).toHaveText('Active', { timeout: 60_000 })
  await expect(page.getByTestId('pay03b-capacity-value')).toHaveText('Up to 10 published listings', { timeout: 60_000 })
  await expect(page.getByTestId('pay03b-invoices')).toContainText(/paid/i)
  await page.screenshot({ path: `${SCREENS}/06-dealer-entitled-desktop.png`, fullPage: true })
  expect(sql(`select count(*) from public.pay03b_business_subscriptions where owner_tenant_id = '${accounts.tenantA}'`)).toBe('1')
})

for (const vp of VIEWPORTS) {
  test(`entitled dealer page is readable and contained (${vp.name})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await login(page, 'dealerA')
    await page.goto('/dealer/subscription')
    await expect(page.getByTestId('pay03b-paid-through-value')).not.toHaveText('No paid period yet', { timeout: 30_000 })
    await noHorizontalOverflow(page)
    await axeClean(page, '[data-testid="pay03b-dealer-subscription"]')
    await page.screenshot({ path: `${SCREENS}/07-dealer-entitled-${vp.name}.png`, fullPage: true })
  })
}

test('cancel at period end keeps paid access, then resume (mobile)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, 'dealerA')
  await page.goto('/dealer/subscription')
  await page.getByTestId('pay03b-cancel-period-end').click()
  await expect(page.getByTestId('pay03b-confirm-dialog')).toBeVisible()
  await axeClean(page, '[data-testid="pay03b-confirm-dialog"]')
  await page.getByTestId('pay03b-cancel-reason').fill('UAT: closing the storefront at the end of the paid period')
  await page.getByTestId('pay03b-confirm-action').click()
  await expect(page.getByTestId('pay03b-resume')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('pay03b-access-value')).toHaveText('Active')
  await axeClean(page, '[data-testid="pay03b-dealer-subscription"]')
  await page.screenshot({ path: `${SCREENS}/08-cancel-at-period-end-mobile.png`, fullPage: true })
  await page.getByTestId('pay03b-resume').click()
  const resumeConfirm = page.getByTestId('pay03b-confirm-action')
  if (await resumeConfirm.isVisible().catch(() => false)) await resumeConfirm.click()
  await expect(page.getByTestId('pay03b-cancel-period-end')).toBeVisible({ timeout: 60_000 })
})

for (const vp of VIEWPORTS) {
  test(`administrator console: subscriptions, plan governance and F5 exceptions (${vp.name})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await login(page, 'ops')
    await page.goto('/admin/commercial-foundation')
    await expect(page.getByTestId('pay03b-admin-subscriptions')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('pay03b-admin-plan-governance')).toBeVisible()
    await expect(page.getByTestId('pay03b-admin-f5')).toBeVisible()
    await expect(page.getByText('PAY03B QA Dealer A Motors Ltd [QA]').first()).toBeVisible({ timeout: 30_000 })
    await noHorizontalOverflow(page)
    for (const section of ['pay03b-admin-subscriptions', 'pay03b-admin-plan-governance', 'pay03b-admin-f5']) {
      await axeClean(page, `[data-testid="${section}"]`)
    }
    await page.screenshot({ path: `${SCREENS}/09-admin-console-${vp.name}.png`, fullPage: true })
    await page.locator('[data-testid^="pay03b-admin-inspect-"]').first().click()
    await expect(page.getByTestId('pay03b-admin-subscription-detail')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('pay03b-admin-entitlements')).toBeVisible({ timeout: 30_000 })
    await noHorizontalOverflow(page)
    await axeClean(page, '[data-testid="pay03b-admin-subscription-detail"]')
    await page.screenshot({ path: `${SCREENS}/10-admin-subscription-detail-${vp.name}.png`, fullPage: true })
    if (vp.name === 'desktop') {
      // Finding F-L2-02 (Level 2): the destructive confirm buttons failed WCAG 2 AA contrast. Each dialog is opened,
      // checked and closed without confirming (opening a dialog makes no request).
      await page.locator('[data-testid^="pay03b-admin-refund-sim_in_"]').first().click()
      await expect(page.getByTestId('pay03b-admin-refund-dialog')).toBeVisible()
      await page.getByTestId('pay03b-admin-refund-reason').fill('Accessibility check only; this dialog is closed without confirming.')
      await page.getByTestId('pay03b-admin-refund-understood').check()
      await axeClean(page, '[data-testid="pay03b-admin-refund-dialog"]')
      await page.getByTestId('pay03b-admin-refund-dialog').screenshot({ path: `${SCREENS}/11-admin-refund-dialog-desktop.png` })
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('pay03b-admin-refund-dialog')).toHaveCount(0)
      await page.getByTestId('pay03b-admin-suspend').click()
      await expect(page.getByTestId('pay03b-admin-suspension-dialog')).toBeVisible()
      await page.getByTestId('pay03b-admin-suspension-reason').fill('Accessibility check only; this dialog is closed without confirming.')
      await axeClean(page, '[data-testid="pay03b-admin-suspension-dialog"]')
      await page.getByTestId('pay03b-admin-suspension-dialog').screenshot({ path: `${SCREENS}/12-admin-suspension-dialog-desktop.png` })
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('pay03b-admin-suspension-dialog')).toHaveCount(0)
    }
  })
}
