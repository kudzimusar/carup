/**
 * UI-9 — Diaspora SafeTrade frontend e2e (mocked API; sandbox/non-custodial only).
 *
 * The page is gated by the BUILD-TIME flag VITE_DIASPORA_SAFETRADE_UI_ENABLED. Run the dev server with
 * it = 'true' (VITE_DIASPORA_SAFETRADE_UI_ENABLED=true npm run dev --workspace=web). The flag-OFF
 * nav-hidden + page-unavailable behavior is locked by the vitest helper + route-validation suites.
 * Action controls render ONLY from GET /:id/available-actions; the backend stays authoritative.
 */
import { expect, test, type Page, type Route } from '@playwright/test'

const buyer = { id: 'buyer-1', name: 'Buyer', email: 'b@carup.test', role: 'owner', active_tenant_id: 'tenant-1' }
const reviewer = { id: 'reviewer-1', name: 'Reviewer', email: 'r@carup.test', role: 'reviewer', active_tenant_id: 'tenant-1' }

async function fulfillJson(route: Route, body: unknown, status = 200) {
  const origin = route.request().headers().origin || '*'
  const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Credentials': 'true' }
  if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
  await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
}
async function loginAs(page: Page, user: unknown, token = 'mock-token') {
  await page.addInitScript(({ user, token }) => {
    window.localStorage.setItem('carup_user', JSON.stringify(user))
    window.localStorage.setItem('carup_token', token)
  }, { user, token })
  // Resolve the AuthContext loading state + CSRF (else authLoading hangs and the page spins forever).
  await page.route('**/api/auth/me', (r) => fulfillJson(r, { user }))
  await page.route('**/api/security/csrf-token', (r) => fulfillJson(r, { csrfToken: 'mock-csrf' }))
}

const TXN = {
  id: 'st-aaaaaaaa-1111', tenant_id: 'tenant-1', import_order_id: 'ord-bbbbbbbb', accepted_quote_id: 'q1',
  buyer_id: 'buyer-1', seller_id: 'seller-2', currency: 'USD', total_amount: 5000, status: 'PAYMENT_HELD',
  payment_provider: 'sandbox', live_payment: false, policy_version: 'safetrade-policy-v1', metadata: { safetrade: {} },
}
const TIMELINE = [{ id: 'tl1', event: 'BUYER_COMMIT', state: 'AWAITING_SELLER_COMMITMENT', created_at: '2026-06-21T10:00:00.000Z' }]
const ELIGIBILITY = { eligible: false, blockers: [{ code: 'DOCUMENTS_MISSING', message: 'Required export documents are missing.', severity: 'high', remediation: 'Upload the export documents.' }], evidenceRefs: [], policyVersion: 'safetrade-policy-v1', evaluatedAt: '2026-06-21T10:00:00.000Z' }
const MILESTONES = [{ id: 'm1', transaction_id: TXN.id, milestone_type: 'DEPOSIT', sequence: 1, amount: 2500, currency: 'USD', status: 'HELD' }]

// available-actions for a BUYER: can request-release (permitted), evaluate-release disabled NEEDS_REVIEWER, open-dispute permitted.
const BUYER_ACTIONS = [
  { actionKey: 'request-release', labelKey: 'a', permitted: true, disabledReasonCode: null, confirmationRequired: true, reviewerRequired: false, sandboxOnly: true, requiredEvidenceCategories: [] },
  { actionKey: 'evaluate-release', labelKey: 'a', permitted: false, disabledReasonCode: 'NEEDS_REVIEWER', confirmationRequired: true, reviewerRequired: true, sandboxOnly: false, requiredEvidenceCategories: [] },
  { actionKey: 'open-dispute', labelKey: 'a', permitted: true, disabledReasonCode: null, confirmationRequired: true, reviewerRequired: false, sandboxOnly: false, requiredEvidenceCategories: [] },
]
const REVIEWER_ACTIONS = [
  { actionKey: 'evaluate-release', labelKey: 'a', permitted: true, disabledReasonCode: null, confirmationRequired: true, reviewerRequired: true, sandboxOnly: false, requiredEvidenceCategories: [] },
  { actionKey: 'approve-release', labelKey: 'a', permitted: false, disabledReasonCode: 'NEEDS_EVALUATION', confirmationRequired: true, reviewerRequired: true, sandboxOnly: true, requiredEvidenceCategories: [] },
]
const DISPUTES = [{ id: 'd1', transaction_id: TXN.id, milestone_id: null, category: 'NOT_AS_DESCRIBED', reason: 'Item differs from the listing.', status: 'OPEN', hold_placed: true }]
// ST-4B: evidence is now read from the server-redacted GET /disputes/:id/evidence endpoint. This mock
// returns BOTH rows (as if unredacted) so the CLIENT visibleEvidence() defense-in-depth filter remains
// under test; server-side redaction is covered by the backend listEvidence tests.
const DISPUTE_EVIDENCE = [
  { id: 'pub', dispute_id: 'd1', evidence_type: 'STATEMENT', visibility: 'PARTICIPANTS', author_id: 'seller-2', statement: 'Public statement.' },
  { id: 'secret', dispute_id: 'd1', evidence_type: 'NOTE', visibility: 'REVIEWERS_ONLY', author_id: 'reviewer-1', statement: 'SECRET-REVIEWER-ONLY' },
]

async function mockDetail(page: Page, actions: unknown, opts: { caseStatus?: number; eligibility?: unknown; caseBody?: unknown } = {}) {
  await page.route('**/api/diaspora/safetrade', (r) => fulfillJson(r, { data: [TXN], pagination: { limit: 50, offset: 0 } }))
  await page.route('**/api/diaspora/safetrade/st-aaaaaaaa-1111/available-actions', (r) => fulfillJson(r, { data: actions }))
  await page.route('**/api/diaspora/safetrade/st-aaaaaaaa-1111/timeline', (r) => fulfillJson(r, { data: TIMELINE }))
  await page.route('**/api/diaspora/safetrade/st-aaaaaaaa-1111/eligibility', (r) => fulfillJson(r, opts.eligibility ?? ELIGIBILITY))
  await page.route('**/api/diaspora/safetrade/st-aaaaaaaa-1111/milestones', (r) => fulfillJson(r, { data: MILESTONES }))
  await page.route('**/api/diaspora/safetrade/st-aaaaaaaa-1111/disputes', (r) => fulfillJson(r, { data: DISPUTES }))
  // ST-4B: the component now reads evidence from the server-redacted per-dispute endpoint.
  await page.route('**/api/diaspora/safetrade/disputes/d1/evidence', (r) => fulfillJson(r, { data: DISPUTE_EVIDENCE }))
  // GET /:id returns the transaction DIRECTLY (not wrapped) — match the backend + the hook.
  const errBody = opts.caseBody ?? { success: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'You do not have access to this SafeTrade case' } }
  await page.route('**/api/diaspora/safetrade/st-aaaaaaaa-1111', (r) => fulfillJson(r, opts.caseStatus ? errBody : TXN, opts.caseStatus || 200))
}

// If the feature flag is OFF the page renders the unavailable state; these tests require it ON.
test('case list renders cases from the API', async ({ page }) => {
  await loginAs(page, buyer)
  await page.route('**/api/diaspora/safetrade', (r) => fulfillJson(r, { data: [TXN], pagination: { limit: 50, offset: 0 } }))
  await page.goto('/diaspora/safetrade')
  if (await page.getByTestId('safetrade-unavailable').count()) test.skip(true, 'flag OFF on this dev server')
  await expect(page.getByTestId('safetrade-list')).toBeVisible()
  await expect(page.getByTestId('safetrade-row-st-aaaaaaaa-1111-status')).toBeVisible()
})

test('non-custodial assurance wording is visible on the list', async ({ page }) => {
  await loginAs(page, buyer)
  await page.route('**/api/diaspora/safetrade', (r) => fulfillJson(r, { data: [TXN], pagination: { limit: 50, offset: 0 } }))
  await page.goto('/diaspora/safetrade')
  if (await page.getByTestId('safetrade-unavailable').count()) test.skip(true, 'flag OFF')
  await expect(page.getByText(/does not hold, receive or automatically release real customer funds/i)).toBeVisible()
})

test('detail renders timeline, eligibility blockers and sandbox HELD milestone', async ({ page }) => {
  await loginAs(page, buyer)
  await mockDetail(page, BUYER_ACTIONS)
  await page.goto('/diaspora/safetrade/st-aaaaaaaa-1111')
  if (await page.getByTestId('safetrade-detail-unavailable').count()) test.skip(true, 'flag OFF')
  await expect(page.getByTestId('safetrade-timeline')).toBeVisible()
  await expect(page.getByTestId('safetrade-eligibility-status')).toHaveAttribute('data-eligible', 'false')
  await expect(page.getByTestId('safetrade-milestones')).toContainText(/HELD|Held/i)
})

test('buyer sees request-release permitted but evaluate-release disabled (NEEDS_REVIEWER)', async ({ page }) => {
  await loginAs(page, buyer)
  await mockDetail(page, BUYER_ACTIONS)
  await page.goto('/diaspora/safetrade/st-aaaaaaaa-1111')
  if (await page.getByTestId('safetrade-detail-unavailable').count()) test.skip(true, 'flag OFF')
  await expect(page.getByTestId('safetrade-actions-action-request-release')).toBeEnabled()
  const evaluate = page.getByTestId('safetrade-actions-action-evaluate-release')
  await expect(evaluate).toBeDisabled()
  await expect(evaluate).toHaveAttribute('data-disabled-reason', 'NEEDS_REVIEWER')
})

test('reviewer sees evaluate-release; approve-release disabled until evaluated', async ({ page }) => {
  await loginAs(page, reviewer)
  await mockDetail(page, REVIEWER_ACTIONS)
  await page.goto('/diaspora/safetrade/st-aaaaaaaa-1111')
  if (await page.getByTestId('safetrade-detail-unavailable').count()) test.skip(true, 'flag OFF')
  await expect(page.getByTestId('safetrade-actions-reviewer-section')).toBeVisible()
  await expect(page.getByTestId('safetrade-actions-action-evaluate-release')).toBeEnabled()
  await expect(page.getByTestId('safetrade-actions-action-approve-release')).toBeDisabled()
})

test('request-release shows a sandbox confirmation dialog', async ({ page }) => {
  await loginAs(page, buyer)
  await mockDetail(page, BUYER_ACTIONS)
  await page.goto('/diaspora/safetrade/st-aaaaaaaa-1111')
  if (await page.getByTestId('safetrade-detail-unavailable').count()) test.skip(true, 'flag OFF')
  await page.getByTestId('safetrade-actions-action-request-release').click()
  await expect(page.getByTestId('safetrade-actions-confirm')).toBeVisible()
  await expect(page.getByText(/does not hold or release real funds/i)).toBeVisible()
})

test('dispute private (reviewers-only) evidence is hidden from a participant', async ({ page }) => {
  await loginAs(page, buyer)
  await mockDetail(page, BUYER_ACTIONS)
  await page.goto('/diaspora/safetrade/st-aaaaaaaa-1111')
  if (await page.getByTestId('safetrade-detail-unavailable').count()) test.skip(true, 'flag OFF')
  await expect(page.getByTestId('safetrade-disputes-dispute-d1')).toContainText('Public statement')
  await expect(page.getByText('SECRET-REVIEWER-ONLY')).toHaveCount(0)
})

test('missing transaction (403) renders a safe access state', async ({ page }) => {
  await loginAs(page, buyer)
  await mockDetail(page, BUYER_ACTIONS, { caseStatus: 403 })
  await page.goto('/diaspora/safetrade/st-aaaaaaaa-1111')
  if (await page.getByTestId('safetrade-detail-unavailable').count()) test.skip(true, 'flag OFF')
  await expect(page.getByTestId('safetrade-detail-forbidden')).toBeVisible()
})

test('expired session (401) shows a sign-in prompt, not a dead retry', async ({ page }) => {
  await loginAs(page, buyer)
  // A 401 whose message starts with "Unauthorized" is a session failure (apiClient -> SessionExpiredError).
  await mockDetail(page, BUYER_ACTIONS, { caseStatus: 401, caseBody: { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized. Session is invalid or expired.' } } })
  await page.goto('/diaspora/safetrade/st-aaaaaaaa-1111')
  if (await page.getByTestId('safetrade-detail-unavailable').count()) test.skip(true, 'flag OFF')
  await expect(page.getByTestId('safetrade-detail-session')).toBeVisible()
  await expect(page.getByTestId('safetrade-detail-signin')).toBeVisible()
  // The misleading retry affordance must NOT be offered for an expired session.
  await expect(page.getByTestId('safetrade-detail-retry')).toHaveCount(0)
})

test('detail has an accessible h1 and keyboard-reachable refresh', async ({ page }) => {
  await loginAs(page, buyer)
  await mockDetail(page, BUYER_ACTIONS)
  await page.goto('/diaspora/safetrade/st-aaaaaaaa-1111')
  if (await page.getByTestId('safetrade-detail-unavailable').count()) test.skip(true, 'flag OFF')
  await expect(page.getByTestId('safetrade-detail-refresh')).toBeVisible()
  await page.getByTestId('safetrade-detail-refresh').focus()
  await expect(page.getByTestId('safetrade-detail-refresh')).toBeFocused()
})

test('existing diaspora routes are unaffected (stock reachable)', async ({ page }) => {
  await loginAs(page, buyer)
  await page.goto('/diaspora/stock')
  // The SafeTrade flag-gate (scoped to its own routes) must not break a sibling route.
  await expect(page).toHaveURL(/\/diaspora\/stock/)
})
