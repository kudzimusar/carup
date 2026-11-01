/**
 * CARUP-PAY-03A-STG01-FINAL — Stage 6 ONE-SHOT authorized governed refund of the single sandbox purchase.
 *
 * Authority: the Owner's SEPARATE explicit authorization for exactly ONE full JPY 100 refund of the single
 * Stage 6 test payment, issued through POST /api/pay03a/admin/orders/:orderId/refund by
 * pay03a.admin.commerce@carup-uat.invalid via the administrator console.
 *
 * Guards (fail closed): recorded refund authorization; exactly one PAY-03A order; its canonical payment is
 * `paid` with no refund reference; the refund button is clicked exactly once.
 */
import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'

const AUTH = process.env.PAY03A_STAGE6_AUTHORIZATION
const ACCOUNTS_FILE = process.env.PAY03A_UAT_ACCOUNTS_FILE
const EVIDENCE_DIR = process.env.PAY03A_EVIDENCE_DIR
const EXPECTED_SHA = process.env.PAY03A_EXPECTED_SHA
const PGURL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

test.skip(
  !AUTH || !ACCOUNTS_FILE || !EVIDENCE_DIR || !EXPECTED_SHA,
  'Stage 6 refund runs only once, with the recorded Owner refund authorization, against the isolated runtime.',
)

function sql(statement: string) {
  return execFileSync('psql', [PGURL, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim()
}

test('Stage 6: one authorized governed refund of the single sandbox purchase', async ({ page, request }) => {
  test.setTimeout(180_000)
  expect(existsSync(AUTH!)).toBe(true)
  const authorization = JSON.parse(readFileSync(AUTH!, 'utf8'))
  expect(authorization.decisions.stage6_refund).toMatch(/^Authorize the refund/)
  const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE!, 'utf8'))
  const purchase = JSON.parse(readFileSync(`${EVIDENCE_DIR}/stage6-checkout.json`, 'utf8'))
  const screens = `${EVIDENCE_DIR}/screens/stage6`
  mkdirSync(screens, { recursive: true })

  const health = await (await request.get('http://127.0.0.1:5031/api/health')).json()
  expect(health.build.commit_sha).toBe(EXPECTED_SHA)
  expect(sql('select count(*) from public.pay02_report_orders')).toBe('1')
  expect(sql(`select status || '|' || coalesce(pay01a_refund_id, 'none') from public.payment_transactions where reference = '${purchase.paymentReference}'`))
    .toBe('paid|none')

  await page.goto('/login')
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await page.reload()
  await page.getByTestId('email-input').fill(accounts.commerce.email)
  await page.getByTestId('password-input').fill(accounts.commerce.password)
  await page.getByTestId('login-button').click()
  await page.waitForFunction(() => Boolean(localStorage.getItem('carup_token')))

  await page.goto('/admin/commercial-foundation')
  const row = page.getByTestId(`pay03a-admin-order-${purchase.orderId}`)
  await expect(row).toBeVisible()
  await expect(row).toContainText('QA-PAY03A-0001')
  await page.screenshot({ path: `${screens}/07-admin-before-refund.png`, fullPage: true })

  const refundResponse = page.waitForResponse((r) => r.url().endsWith(`/api/pay03a/admin/orders/${purchase.orderId}/refund`) && r.request().method() === 'POST')
  await page.getByTestId(`pay03a-admin-refund-${purchase.orderId}`).click()
  const refund = await refundResponse
  expect(refund.status()).toBe(200)
  const body = await refund.json()
  expect(body.paymentStatus).toBe('refunded')
  expect(body.entitlementStatus).toBe('revoked_refunded')
  expect(String(body.refundId)).toMatch(/^re_/)
  await expect(page.getByTestId('pay02-proposal-status')).toContainText('revoked_refunded')
  await page.screenshot({ path: `${screens}/08-admin-after-refund.png`, fullPage: true })

  // Buyer view after the refund (a fresh real login for that account).
  await page.goto('/login')
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await page.reload()
  await page.getByTestId('email-input').fill(accounts.buyerA.email)
  await page.getByTestId('password-input').fill(accounts.buyerA.password)
  await page.getByTestId('login-button').click()
  await page.waitForFunction(() => Boolean(localStorage.getItem('carup_token')))
  await page.goto('/vehicle-history')
  await expect(page.getByTestId(`pay03a-order-entitlement-${purchase.orderId}`)).toContainText('revoked_refunded')
  await expect(page.getByTestId(`pay03a-open-report-${purchase.orderId}`)).toHaveCount(0)
  await page.screenshot({ path: `${screens}/09-buyer-after-refund.png`, fullPage: true })
})
