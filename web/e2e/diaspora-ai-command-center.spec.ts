import { expect, test, type Page, type Route } from '@playwright/test'

type TestUser = { id: string; name: string; email: string; role: string }

const dealer: TestUser = { id: 'd-1', name: 'Dealer', email: 'd@carup.test', role: 'dealer' }
const insurance: TestUser = { id: 'i-1', name: 'Ins', email: 'i@carup.test', role: 'insurance' }

async function fulfillJson(route: Route, body: unknown, status = 200) {
  const origin = route.request().headers().origin || '*'
  const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Credentials': 'true' }
  if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
  await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
}

async function loginAs(page: Page, user: TestUser, token = 'mock-token') {
  await page.addInitScript(({ user, token }) => {
    window.localStorage.setItem('carup_user', JSON.stringify(user))
    window.localStorage.setItem('carup_token', token)
  }, { user, token })
}

interface AiCommand {
  id: string
  raw_command: string
  intent: string
  risk_level: string
  confidence_score: number
  execution_status: string
  approval_status: string
  metadata: { ambiguous: boolean }
}
interface AiState { commands: AiCommand[]; seq: number; executeAttempts: string[] }
function initialState(): AiState { return { commands: [], seq: 0, executeAttempts: [] } }

function classify(raw: string) {
  const t = raw.toLowerCase()
  if (t.includes('release escrow') || t.includes('approve compliance') || t.includes('override stock')) return { intent: 'RELEASE_ESCROW', risk: 'HIGH', confidence: 0.9, ambiguous: false, exec: 'AWAITING_APPROVAL', approval: 'PENDING' }
  if (t.includes('reserve stock')) return { intent: 'RESERVE_STOCK', risk: 'MEDIUM', confidence: 0.9, ambiguous: false, exec: 'AWAITING_CONFIRMATION', approval: 'NOT_REQUIRED' }
  if (t.includes('create demand') || t.includes('buyer request') || t.includes('add note')) return { intent: 'CREATE_BUYER_REQUEST', risk: 'LOW', confidence: 0.9, ambiguous: false, exec: 'DRAFT', approval: 'NOT_REQUIRED' }
  return { intent: 'UNKNOWN', risk: 'LOW', confidence: 0.1, ambiguous: true, exec: 'NEEDS_REVIEW', approval: 'NOT_REQUIRED' }
}

async function mockAiApi(page: Page, state: AiState, user: TestUser) {
  await page.context().route('**/api/auth/me', (r) => fulfillJson(r, { user }))
  await page.context().route('**/api/security/csrf-token', (r) => fulfillJson(r, { csrfToken: 'mock-csrf' }))
  await page.context().route('**/api/diaspora/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (method === 'POST' && path.endsWith('/ai-commands/parse')) {
      const p = JSON.parse(route.request().postData() || '{}')
      const c = classify(p.rawCommand || '')
      await fulfillJson(route, { data: { intent: c.intent, risk: c.risk, riskTier: c.risk, confidence: c.confidence, entities: {}, ambiguous: c.ambiguous, reasons: [`Matched ${c.intent}`] } })
      return
    }
    if (method === 'POST' && path.endsWith('/ai-commands')) {
      const p = JSON.parse(route.request().postData() || '{}')
      const c = classify(p.rawCommand || '')
      const command = { id: `cmd-${++state.seq}`, raw_command: p.rawCommand, intent: c.intent, risk_level: c.risk, confidence_score: c.confidence, execution_status: c.exec, approval_status: c.approval, metadata: { ambiguous: c.ambiguous } }
      state.commands.push(command)
      await fulfillJson(route, { data: { command, parse: {}, duplicate: false } }, 201)
      return
    }
    if (method === 'GET' && path.endsWith('/ai-commands')) { await fulfillJson(route, { data: state.commands }); return }

    const confirm = path.match(/\/ai-commands\/([^/]+)\/confirm$/)
    if (method === 'POST' && confirm) { const c = state.commands.find((x) => x.id === confirm[1]); c.execution_status = 'CONFIRMED'; await fulfillJson(route, { data: c }); return }
    const exec = path.match(/\/ai-commands\/([^/]+)\/execute$/)
    if (method === 'POST' && exec) {
      state.executeAttempts.push(exec[1])
      const c = state.commands.find((x) => x.id === exec[1])
      if (c.risk_level === 'HIGH') { await fulfillJson(route, { success: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'High-risk AI execution is disabled in this program' } }, 403); return }
      c.execution_status = 'EXECUTED'
      await fulfillJson(route, { data: { command: c, result: { type: 'buyer_order_draft' } } })
      return
    }
    const approve = path.match(/\/ai-commands\/([^/]+)\/approve$/)
    if (method === 'POST' && approve) { const c = state.commands.find((x) => x.id === approve[1]); c.approval_status = 'APPROVED'; await fulfillJson(route, { data: c }); return }
    await fulfillJson(route, { data: [] })
  })
}

test.describe('Diaspora AI command center (Phase 5)', () => {
  test('unauthorized role is denied', async ({ page }) => {
    const state = initialState()
    await loginAs(page, insurance, 'ins-token')
    await mockAiApi(page, state, insurance)
    await page.goto('/diaspora/ai-commands', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('diaspora-ai-access-denied')).toBeVisible()
  })

  test('parse shows risk tier and confidence', async ({ page }) => {
    const state = initialState()
    await loginAs(page, dealer, 'd-token')
    await mockAiApi(page, state, dealer)
    await page.goto('/diaspora/ai-commands', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('diaspora-ai-input').fill('release escrow for ord-1')
    await page.getByTestId('diaspora-ai-parse').click()
    await expect(page.getByTestId('diaspora-ai-parse-result')).toBeVisible()
    await expect(page.getByTestId('diaspora-ai-risk')).toContainText('HIGH')
    await expect(page.getByTestId('diaspora-ai-parse-blocked')).toBeVisible()
  })

  test('low-risk command creates a draft and executes', async ({ page }) => {
    const state = initialState()
    await loginAs(page, dealer, 'd-token')
    await mockAiApi(page, state, dealer)
    await page.goto('/diaspora/ai-commands', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('diaspora-ai-input').fill('create demand for a Toyota part')
    await page.getByTestId('diaspora-ai-submit').click()
    await expect(page.getByTestId('diaspora-ai-command-row')).toHaveCount(1)
    await page.getByTestId('diaspora-ai-execute').click()
    await expect(page.getByTestId('diaspora-ai-executed')).toBeVisible()
  })

  test('high-risk command shows blocked execution and cannot execute', async ({ page }) => {
    const state = initialState()
    await loginAs(page, dealer, 'd-token')
    await mockAiApi(page, state, dealer)
    await page.goto('/diaspora/ai-commands', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('diaspora-ai-input').fill('release escrow for ord-1')
    await page.getByTestId('diaspora-ai-submit').click()
    await expect(page.getByTestId('diaspora-ai-blocked-note')).toBeVisible()
    // there is no execute button for high-risk
    await expect(page.getByTestId('diaspora-ai-execute')).toHaveCount(0)
  })

  test('medium-risk command requires confirmation before execute', async ({ page }) => {
    const state = initialState()
    await loginAs(page, dealer, 'd-token')
    await mockAiApi(page, state, dealer)
    await page.goto('/diaspora/ai-commands', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('diaspora-ai-input').fill('reserve stock stk-1 5 units')
    await page.getByTestId('diaspora-ai-submit').click()
    await expect(page.getByTestId('diaspora-ai-confirm')).toBeVisible()
    await expect(page.getByTestId('diaspora-ai-execute')).toHaveCount(0)
    await page.getByTestId('diaspora-ai-confirm').click()
    await expect(page.getByTestId('diaspora-ai-execute')).toBeVisible()
  })
})
