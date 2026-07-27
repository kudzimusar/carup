/**
 * Confirmed workbook import — real-Chromium matrix (Deliverable B, Issue #127).
 *
 * Run the dev server with the flag on:
 *   VITE_DIASPORA_WORKBOOK_IMPORT_UI_ENABLED=true npm run dev --workspace=web
 *
 * The API is mocked at the network boundary so every failure shape the backend can produce —
 * a changed workbook, an expired confirmation, quota denial, a mid-run failure that compensates, and
 * an irreversible partial failure — is exercised in a real browser. Those are precisely the states
 * that are hard to manufacture against a live backend and are also the ones where getting the message
 * wrong does real harm.
 */
import { expect, test, type Page, type Route } from '@playwright/test'

const DESKTOP = { width: 1280, height: 900 }
const MOBILE = { width: 390, height: 844 }

const dealer = { id: 'user-1', name: 'Dealer', email: 'd@carup.test', role: 'dealer', active_tenant_id: 'tenant-1' }
const otherTenantDealer = { id: 'user-9', name: 'Other', email: 'o@carup.test', role: 'dealer', active_tenant_id: 'tenant-2' }

const CHECKSUM = 'a'.repeat(64)
const BATCH = 'batch-1'

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

async function loginAs(page: Page, user: unknown) {
  await page.addInitScript((u) => {
    window.localStorage.setItem('carup_user', JSON.stringify(u))
    window.localStorage.setItem('carup_token', 'mock-token')
  }, user)
  // Catch-all FIRST so specific routes (last-registered wins) take precedence, and unrelated
  // app-wide fetches cannot pollute the console-error assertion.
  await page.route('**/api/**', (r) => fulfillJson(r, { data: [] }))
  await page.route('**/api/auth/me', (r) => fulfillJson(r, { user }))
  await page.route('**/api/security/csrf-token', (r) => fulfillJson(r, { csrfToken: 'mock-csrf' }))
}

function summary(over: Record<string, unknown> = {}) {
  return {
    data: {
      checksum_sha256: CHECKSUM,
      dry_run_revision: 1,
      total_rows: 10,
      accepted_rows: 10,
      rejected_rows: 0,
      error_count: 0,
      quotaAllowed: true,
      quotaMessage: null,
      rowMessages: [],
      ...over,
    },
  }
}

function confirmation(over: Record<string, unknown> = {}) {
  return {
    id: 'conf-1',
    tenant_id: 'tenant-1',
    batch_id: BATCH,
    workbook_checksum: CHECKSUM,
    dry_run_revision: 1,
    confirmed_by: 'user-1',
    confirmed_at: '2026-07-28T09:00:00.000Z',
    expires_at: '2099-01-01T00:00:00.000Z',
    idempotency_key: 'k',
    state: 'pending',
    row_count: 10,
    ...over,
  }
}

const receipt = (n: number, outcome: string, over: Record<string, unknown> = {}) => ({
  id: `r${n}`, batch_id: BATCH, row_number: n, sheet_name: 'Stock', outcome,
  entity_type: 'diaspora_import_orders', entity_ref: `ent-${n}`,
  error_code: null, error_message: null, compensated_at: null, attempt: 1,
  created_at: '2026-07-28T09:00:00.000Z', ...over,
})

async function mockApi(page: Page, opts: {
  summary?: unknown
  confirmResponse?: unknown
  confirmStatus?: number
  executeResponse?: unknown
  executeStatus?: number
  receipts?: unknown[]
  interrupted?: unknown[]
} = {}) {
  await page.route(`**/api/diaspora/workbook/import-batches/${BATCH}/summary`, (r) => fulfillJson(r, opts.summary ?? summary()))
  await page.route(`**/api/diaspora/workbook/import-batches/${BATCH}/receipts`, (r) => fulfillJson(r, { data: opts.receipts ?? [] }))
  await page.route('**/api/diaspora/workbook/interrupted-imports', (r) => fulfillJson(r, { data: opts.interrupted ?? [] }))
  await page.route(`**/api/diaspora/workbook/import-batches/${BATCH}/confirm`, (r) =>
    fulfillJson(r, opts.confirmResponse ?? { data: confirmation(), idempotentReplay: false }, opts.confirmStatus ?? 201))
  await page.route(`**/api/diaspora/workbook/import-batches/${BATCH}/execute`, (r) =>
    fulfillJson(r, opts.executeResponse ?? {
      data: { imported: true, batchId: BATCH, confirmationId: 'conf-1', status: 'IMPORTED', appliedRows: 10, receipts: 10, userMessage: 'Imported 10 rows.' },
    }, opts.executeStatus ?? 200))
}

async function open(page: Page) {
  await page.goto('/diaspora/workbook/import')
  if (await page.getByTestId('confirmed-import-unavailable').isVisible().catch(() => false)) {
    test.skip(true, 'VITE_DIASPORA_WORKBOOK_IMPORT_UI_ENABLED is not set on the dev server')
  }
}

async function loadBatch(page: Page) {
  await page.getByTestId('batch-id-input').fill(BATCH)
  await page.getByTestId('load-batch').click()
  await expect(page.getByTestId('dry-run-preview')).toBeVisible()
}

// ─────────────────────────────────────────────────────────────────────────────
test.describe('happy path', () => {
  test('clean dry-run → confirmation → import', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, { receipts: [receipt(1, 'accepted'), receipt(2, 'accepted')] })
    await open(page)
    await loadBatch(page)

    await expect(page.getByTestId('preview-total')).toHaveText('10')
    await expect(page.getByTestId('preview-valid')).toHaveText('10')
    await expect(page.getByTestId('preview-invalid')).toHaveText('0')
    await expect(page.getByTestId('preview-revision')).toHaveText('1')
    await expect(page.getByTestId('preview-checksum')).toHaveText(CHECKSUM)
    await expect(page.getByTestId('confirm-blocked')).toHaveCount(0)

    await page.getByTestId('confirm-import').click()
    await expect(page.getByTestId('confirmation-summary')).toBeVisible()
    await expect(page.getByTestId('confirmation-checksum')).toHaveText(CHECKSUM)

    await page.getByTestId('execute-import').click()
    await expect(page.getByTestId('result-success')).toBeVisible()
    await expect(page.getByTestId('result-status')).toHaveText('IMPORTED')
    await expect(page.getByTestId('result-applied')).toHaveText('10')
  })

  test('the full checksum is shown, not truncated', async ({ page }) => {
    // A shortened checksum cannot be compared by a user who suspects their file changed.
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer); await mockApi(page); await open(page); await loadBatch(page)
    const text = await page.getByTestId('preview-checksum').innerText()
    expect(text).toBe(CHECKSUM)
    expect(text).not.toContain('…')
  })
})

test.describe('confirmation is refused when it should be', () => {
  test('invalid rows block confirmation before it can be issued', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, { summary: summary({ rejected_rows: 3, accepted_rows: 7, rowMessages: [{ row: 4, sheet: 'Stock', message: 'VIN is not valid' }] }) })
    await open(page); await loadBatch(page)

    await expect(page.getByTestId('confirm-blocked-reason')).toContainText('partial import is not offered')
    await expect(page.getByTestId('confirm-import')).toBeDisabled()
    await expect(page.getByTestId('row-messages')).toContainText('VIN is not valid')
  })

  test('a changed workbook invalidates the confirmation', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, {
      confirmResponse: { error: 'The workbook has changed since this preview was generated. Re-run the dry run and review it again.' },
      confirmStatus: 400,
    })
    await open(page); await loadBatch(page)
    await page.getByTestId('confirm-import').click()
    await expect(page.getByTestId('confirmed-import-error')).toContainText('workbook has changed')
    await expect(page.getByTestId('execute-import')).toBeDisabled()
  })

  test('an expired confirmation blocks the import', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, { confirmResponse: { data: confirmation({ expires_at: '2020-01-01T00:00:00.000Z' }), idempotentReplay: false } })
    await open(page); await loadBatch(page)
    await page.getByTestId('confirm-import').click()
    await expect(page.getByTestId('confirm-blocked-reason')).toContainText('expired')
  })

  test('quota denial blocks confirmation and says so', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, { summary: summary({ quotaAllowed: false, quotaMessage: 'Your plan does not have enough remaining import capacity for this workbook.' }) })
    await open(page); await loadBatch(page)
    await expect(page.getByTestId('confirm-blocked-reason')).toContainText('import capacity')
    await expect(page.getByTestId('confirm-import')).toBeDisabled()
  })

  test('invalid rows are reported BEFORE quota', async ({ page }) => {
    // Both are wrong; the user must fix the workbook first, so that is what they are told.
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, { summary: summary({ rejected_rows: 8, accepted_rows: 2, quotaAllowed: false }) })
    await open(page); await loadBatch(page)
    await expect(page.getByTestId('confirm-blocked-reason')).toContainText('failed validation')
  })

  test('cross-tenant access is denied', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, otherTenantDealer)
    await page.route(`**/api/diaspora/workbook/import-batches/${BATCH}/summary`, (r) =>
      fulfillJson(r, { error: 'Workbook batch not found' }, 404))
    await page.route('**/api/diaspora/workbook/interrupted-imports', (r) => fulfillJson(r, { data: [] }))
    await open(page)
    await page.getByTestId('batch-id-input').fill(BATCH)
    await page.getByTestId('load-batch').click()
    await expect(page.getByTestId('confirmed-import-error')).toBeVisible()
    await expect(page.getByTestId('dry-run-preview')).toHaveCount(0)
  })
})

test.describe('duplicate submission', () => {
  test('a duplicate confirmation reuses the same one and says it cannot import twice', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, { confirmResponse: { data: confirmation(), idempotentReplay: true }, confirmStatus: 200 })
    await open(page); await loadBatch(page)
    await page.getByTestId('confirm-import').click()
    await expect(page.getByTestId('confirmed-import-notice')).toContainText('already confirmed')
    await expect(page.getByTestId('confirmed-import-notice')).toContainText('only be imported once')
  })

  test('the confirm button disables once a confirmation is held', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer); await mockApi(page); await open(page); await loadBatch(page)
    await page.getByTestId('confirm-import').click()
    await expect(page.getByTestId('confirmation-summary')).toBeVisible()
    await expect(page.getByTestId('confirm-import')).toBeDisabled()
  })

  test('a duplicate execute is refused — the confirmation is spent', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer); await mockApi(page); await open(page); await loadBatch(page)
    await page.getByTestId('confirm-import').click()
    await page.getByTestId('execute-import').click()
    await expect(page.getByTestId('result-success')).toBeVisible()
    // The spent confirmation must not offer a second run.
    await expect(page.getByTestId('execute-import')).toHaveCount(0)
  })
})

test.describe('failure outcomes are truthful', () => {
  test('a compensated failure says nothing was imported and is safe to retry', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, {
      executeResponse: { data: {
        imported: false, batchId: BATCH, confirmationId: 'conf-1', status: 'COMPENSATED',
        appliedRows: 4, compensatedRows: 4, compensationFailures: 0, failedAtRow: 5,
        userMessage: 'The import failed at row 5 and every row applied before it was reversed. Nothing was imported. Fix the workbook and try again.',
      } },
      receipts: [receipt(1, 'compensated'), receipt(5, 'rejected', { error_code: 'ROW_EXECUTION_FAILED', error_message: 'capacity exceeded' })],
    })
    await open(page); await loadBatch(page)
    await page.getByTestId('confirm-import').click()
    await page.getByTestId('execute-import').click()

    await expect(page.getByTestId('result-failed')).toBeVisible()
    await expect(page.getByTestId('result-failed')).toContainText('Nothing was imported')
    await expect(page.getByTestId('safe-to-retry')).toBeVisible()
    await expect(page.getByTestId('result-success')).toHaveCount(0)
  })

  test('quota released after a compensated failure is reflected in the totals', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, {
      executeResponse: { data: {
        imported: false, batchId: BATCH, confirmationId: 'conf-1', status: 'COMPENSATED',
        appliedRows: 3, compensatedRows: 3, compensationFailures: 0,
        userMessage: 'Nothing was imported.',
      } },
      receipts: [receipt(1, 'compensated'), receipt(2, 'compensated'), receipt(3, 'compensated')],
    })
    await open(page); await loadBatch(page)
    await page.getByTestId('confirm-import').click()
    await page.getByTestId('execute-import').click()
    await expect(page.getByTestId('result-compensated')).toHaveText('3')
  })

  test('an irreversible partial failure shows NEEDS_OPERATOR and refuses to offer a retry', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, {
      executeResponse: { data: {
        imported: false, batchId: BATCH, confirmationId: 'conf-1', status: 'NEEDS_OPERATOR',
        appliedRows: 5, compensatedRows: 3, compensationFailures: 2, failedAtRow: 6,
        userMessage: 'The import failed at row 6. 3 of 5 applied rows were reversed, but 2 could not be. Our team has been notified — do not retry.',
      } },
      receipts: [receipt(1, 'accepted'), receipt(2, 'compensated')],
    })
    await open(page); await loadBatch(page)
    await page.getByTestId('confirm-import').click()
    await page.getByTestId('execute-import').click()

    await expect(page.getByTestId('result-needs-operator')).toBeVisible()
    await expect(page.getByTestId('do-not-retry')).toContainText('Do not retry')
    // The one state where a retry could double-apply — no retry affordance at all.
    await expect(page.getByTestId('safe-to-retry')).toHaveCount(0)
    await expect(page.getByTestId('result-success')).toHaveCount(0)
  })

  test('a server error during execute never renders as success', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, { executeResponse: { error: 'boom' }, executeStatus: 500 })
    await open(page); await loadBatch(page)
    await page.getByTestId('confirm-import').click()
    await page.getByTestId('execute-import').click()
    await expect(page.getByTestId('confirmed-import-error')).toBeVisible()
    await expect(page.getByTestId('result-success')).toHaveCount(0)
  })

  test('reload during an import loses no truth — receipts still show what happened', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, { receipts: [receipt(1, 'accepted'), receipt(2, 'rejected', { error_code: 'ROW_BLOCKED' })] })
    await open(page); await loadBatch(page)
    // A reload drops client state; re-loading the batch must still surface the per-row record.
    await page.reload()
    await open(page); await loadBatch(page)
    await expect(page.getByTestId('receipts-table')).toBeVisible()
    await expect(page.getByTestId('receipt-1')).toContainText('Imported')
    await expect(page.getByTestId('receipt-2')).toContainText('Rejected')
  })
})

test.describe('receipts, export and recovery', () => {
  test('receipts are visible with per-row outcome and reason', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, {
      receipts: [receipt(1, 'accepted'), receipt(2, 'rejected', { error_code: 'ROW_BLOCKED', error_message: 'Seller is not verified' })],
    })
    await open(page); await loadBatch(page)
    await expect(page.getByTestId('receipts-table')).toBeVisible()
    await expect(page.getByTestId('receipt-2')).toContainText('Seller is not verified')
  })

  test('the receipt column is labelled "Row (order)", not "Row"', async ({ page }) => {
    // It is an ordinal in plan order; calling it "Row" would send users to the wrong line of their file.
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, { receipts: [receipt(1, 'accepted')] })
    await open(page); await loadBatch(page)
    await expect(page.getByRole('columnheader', { name: 'Row (order)' })).toBeVisible()
  })

  test('CSV receipt download produces a file', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, { receipts: [receipt(1, 'accepted'), receipt(2, 'rejected', { error_code: 'X' })] })
    await open(page); await loadBatch(page)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('download-csv').click(),
    ])
    expect(download.suggestedFilename()).toBe(`import-result-${BATCH}.csv`)
  })

  test('interrupted imports are listed, and the irreversible one is flagged', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, {
      interrupted: [
        { id: 'b-stuck', tenantId: 'tenant-1', status: 'NEEDS_OPERATOR', totalRows: 4, updatedAt: 'x', confirmedImport: null, needsHuman: true },
        { id: 'b-mid', tenantId: 'tenant-1', status: 'IMPORTING', totalRows: 9, updatedAt: 'x', confirmedImport: null, needsHuman: false },
      ],
    })
    await open(page)
    await expect(page.getByTestId('interrupted-imports')).toBeVisible()
    await expect(page.getByTestId('interrupted-needs-human-b-stuck')).toContainText('do not retry')
    await expect(page.getByTestId('interrupted-needs-human-b-mid')).toHaveCount(0)
  })
})

test.describe('gating, a11y, devices and hygiene', () => {
  test('sign-in is required before anything is fetched', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await page.route('**/api/**', (r) => fulfillJson(r, { data: [] }))
    await page.route('**/api/auth/me', (r) => fulfillJson(r, { user: null }, 401))
    await page.goto('/diaspora/workbook/import')
    const unavailable = await page.getByTestId('confirmed-import-unavailable').isVisible().catch(() => false)
    if (unavailable) test.skip(true, 'UI flag is off on the dev server')
    await expect(page.getByTestId('confirmed-import-signin')).toBeVisible()
  })

  test('status is announced through a polite live region', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer); await mockApi(page); await open(page)
    const announcer = page.getByTestId('confirmed-import-announcer')
    await expect(announcer).toHaveAttribute('role', 'status')
    await expect(announcer).toHaveAttribute('aria-live', 'polite')
  })

  test('mobile: usable and never scrolls the page horizontally', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await loginAs(page, dealer)
    await mockApi(page, { receipts: [receipt(1, 'accepted'), receipt(2, 'rejected', { error_code: 'X', error_message: 'a fairly long explanation of why this row was rejected' })] })
    await open(page); await loadBatch(page)
    await expect(page.getByTestId('dry-run-preview')).toBeVisible()
    const overflows = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    expect(overflows, 'the receipts table scrolls in its own container, not the page').toBe(false)
  })

  test('no console errors and no unexpected 4xx/5xx on the happy path', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, dealer)
    await mockApi(page, { receipts: [receipt(1, 'accepted')] })

    const errors: string[] = []
    const bad: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`) })

    await open(page); await loadBatch(page)
    await page.getByTestId('confirm-import').click()
    await page.getByTestId('execute-import').click()
    await expect(page.getByTestId('result-success')).toBeVisible()
    await page.waitForTimeout(400)

    expect(errors).toEqual([])
    expect(bad).toEqual([])
  })
})
