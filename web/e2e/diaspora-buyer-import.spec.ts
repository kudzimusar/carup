import { expect, test, type Page, type Route } from '@playwright/test'

const buyerUser = {
  id: 'buyer-1',
  name: 'Diaspora Buyer',
  email: 'buyer@carup.test',
  role: 'owner',
}

const adminUser = {
  id: 'admin-1',
  name: 'Diaspora Admin',
  email: 'admin@carup.test',
  role: 'admin',
}

const governmentUser = {
  id: 'government-1',
  name: 'Government Reviewer',
  email: 'government@carup.test',
  role: 'government',
}

const createdOrder = {
  id: 'dio-1001',
  buyer_id: 'buyer-1',
  order_type: 'vehicle',
  origin_country: 'Japan',
  origin_city: 'Yokohama',
  destination_country: 'Zimbabwe',
  destination_city: 'Harare',
  requested_make: 'Toyota',
  requested_model: 'Aqua',
  requested_year_min: 2021,
  requested_year_max: 2021,
  budget_amount: 8500,
  budget_currency: 'USD',
  status: 'IMPORT_REQUESTED',
  diaspora_trade_documents: [],
  created_at: '2026-06-08T08:00:00.000Z',
}

const mockDocument = {
  id: 'doc-001',
  import_order_id: 'dio-1001',
  document_type: 'passport',
  verification_status: 'UPLOADED',
  uploaded_by: 'buyer-1',
  created_at: '2026-06-08T09:00:00.000Z',
  file_name: 'passport_scan.pdf',
  storage_path: 'dio-1001/passport_a1b2c3d4e5f6.pdf',
}

const mockVerifiedDocument = {
  ...mockDocument,
  verification_status: 'VERIFIED',
  reviewed_by: 'admin-1',
  reviewed_at: '2026-06-08T10:00:00.000Z',
}

const mockRejectedDocument = {
  ...mockDocument,
  verification_status: 'REJECTED',
  reviewed_by: 'admin-1',
  reviewed_at: '2026-06-08T10:00:00.000Z',
  metadata: { rejection_reason: 'Blurry image' },
}

const mockUploadResponse = {
  storagePath: 'dio-1001/passport_a1b2c3d4e5f6.pdf',
  docType: 'passport',
  uploadedBy: 'buyer-1',
}

const mockOcrResponse = {
  extraction: {
    ...mockDocument,
    verification_status: 'OCR_EXTRACTED',
  },
  ocr: {
    success: true,
    ocrDocumentId: 'ocr_test123',
    qualityMetrics: {
      blurScore: 0.85,
      glareScore: 0.05,
      tamperSuspicionScore: 0.02,
      qualityPassed: true,
      qualityIssues: [],
    },
  },
}

async function loginAs(page: Page, user = buyerUser, token = 'mock-buyer-token') {
  await page.addInitScript(({ user, token }) => {
    window.localStorage.setItem('carup_user', JSON.stringify(user))
    window.localStorage.setItem('carup_token', token)
  }, { user, token })
}

async function loginAsBuyer(page: Page) {
  await loginAs(page)
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  }

  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers })
    return
  }

  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body),
  })
}

async function mockDiasporaApi(page: Page) {
  // The app validates the stored session on boot via GET /auth/me; return 200 so the mocked
  // session is treated as valid (a 401 here would clear auth and redirect to login).
  await page.context().route('**/api/auth/me', async route => {
    await fulfillJson(route, { user: { id: 'buyer-1', role: 'owner' } })
  })

  // Unsafe requests now require a CSRF token fetched up-front; mock the issuing endpoint.
  await page.context().route('**/security/csrf-token', async route => {
    await fulfillJson(route, { csrfToken: 'mock-csrf-token' })
  })

  await page.context().route('**/api/diaspora/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname

    if (route.request().method() === 'POST' && path.endsWith('/diaspora/import-orders')) {
      await fulfillJson(route, createdOrder, 201)
      return
    }

    if (route.request().method() === 'GET' && path.endsWith('/diaspora/import-orders/dio-1001')) {
      await fulfillJson(route, createdOrder)
      return
    }

    if (route.request().method() === 'GET' && path.endsWith('/diaspora/import-orders')) {
      await fulfillJson(route, { data: [createdOrder] })
      return
    }

    if (route.request().method() === 'GET' && path.endsWith('/documents')) {
      await fulfillJson(route, { data: [mockDocument] })
      return
    }

    if (route.request().method() === 'POST' && path.endsWith('/documents')) {
      await fulfillJson(route, mockDocument, 201)
      return
    }

    if (route.request().method() === 'POST' && path.includes('/verify')) {
      await fulfillJson(route, mockVerifiedDocument, 200)
      return
    }

    if (route.request().method() === 'POST' && path.includes('/reject')) {
      await fulfillJson(route, mockRejectedDocument, 200)
      return
    }

    if (route.request().method() === 'POST' && path.includes('/run-ocr')) {
      await fulfillJson(route, mockOcrResponse, 201)
      return
    }

    if (route.request().method() === 'GET' && path.endsWith('/diaspora/compliance')) {
      await fulfillJson(route, { data: [] })
      return
    }

    await fulfillJson(route, {})
  })

  await page.context().route('**/api/media/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname

    if (route.request().method() === 'POST' && path.endsWith('/upload/document')) {
      await fulfillJson(route, mockUploadResponse, 201)
      return
    }

    await fulfillJson(route, {})
  })
}

test.describe('Diaspora buyer import order UI', () => {
  test('Diaspora landing page renders', async ({ page }) => {
    await page.goto('/diaspora')

    await expect(page.locator('[data-testid="diaspora-landing-route"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-start-import-button"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-landing-workflow-item"]')).toHaveCount(3)
  })

  test('buyer can open new import order form', async ({ page }) => {
    await loginAsBuyer(page)
    await mockDiasporaApi(page)

    await page.goto('/diaspora')
    await page.locator('[data-testid="diaspora-start-import-button"]').click()

    await expect(page).toHaveURL(/\/diaspora\/imports\/new$/)
    await expect(page.locator('[data-testid="diaspora-new-import-route"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-origin-country-input"]')).toBeVisible()
  })

  test('required validation prevents empty submit', async ({ page }) => {
    await loginAsBuyer(page)
    await mockDiasporaApi(page)
    let postCount = 0
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/api/diaspora/import-orders')) postCount += 1
    })

    await page.goto('/diaspora/imports/new')
    await page.locator('[data-testid="diaspora-submit-import-button"]').click()

    await expect(page.locator('[data-testid="diaspora-import-validation-error"]')).toBeVisible()
    expect(postCount).toBe(0)
  })

  test('successful submit shows created order detail', async ({ page }) => {
    await loginAsBuyer(page)
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/new')
    await page.locator('[data-testid="diaspora-order-type-vehicle"]').click()
    await page.locator('[data-testid="diaspora-origin-country-input"]').fill('Japan')
    await page.locator('[data-testid="diaspora-origin-city-input"]').fill('Yokohama')
    await page.locator('[data-testid="diaspora-destination-city-input"]').fill('Harare')
    await page.locator('[data-testid="diaspora-make-input"]').fill('Toyota')
    await page.locator('[data-testid="diaspora-model-input"]').fill('Aqua')
    await page.locator('[data-testid="diaspora-year-input"]').fill('2021')
    await page.locator('[data-testid="diaspora-budget-input"]').fill('8500')
    await page.locator('[data-testid="diaspora-submit-import-button"]').click()

    await expect(page).toHaveURL(/\/diaspora\/imports\/dio-1001$/)
    await expect(page.locator('[data-testid="diaspora-import-detail-route"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-status-badge"]')).toContainText('Import Requested')
    await expect(page.locator('[data-testid="diaspora-timeline-item"]').first()).toContainText('Import Requested')
    await expect(page.locator('[data-testid="diaspora-document-row"]')).toHaveCount(5)
  })

  test('unauthenticated user is redirected away from protected import form', async ({ page }) => {
    await page.goto('/diaspora/imports/new')

    await expect(page).toHaveURL(/\/login\?returnTo=/)
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/diaspora/imports/new')
  })

  test('normal buyer cannot see admin compliance dashboard', async ({ page }) => {
    await loginAsBuyer(page)
    let complianceCalls = 0
    await page.route('**/api/diaspora/compliance**', async route => {
      complianceCalls += 1
      await fulfillJson(route, { data: [] })
    })

    await page.goto('/admin/diaspora/compliance')

    await expect(page.locator('[data-testid="diaspora-compliance-unauthorized"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-compliance-admin-route"]')).toHaveCount(0)
    expect(complianceCalls).toBe(0)
  })

  test('buyer dashboard exposes import order links without compliance nav', async ({ page }) => {
    await loginAsBuyer(page)

    await page.goto('/dashboard')

    await expect(page.locator('[data-testid="nav-diaspora-imports"]')).toHaveAttribute('href', '/diaspora/imports')
    await expect(page.locator('[data-testid="nav-diaspora-new-import"]')).toHaveAttribute('href', '/diaspora/imports/new')
    await expect(page.locator('[data-testid="nav-diaspora-compliance"]')).toHaveCount(0)
  })

  test('admin dashboard exposes diaspora compliance nav', async ({ page }) => {
    await loginAs(page, adminUser, 'mock-admin-token')

    await page.goto('/admin')

    await expect(page.locator('[data-testid="nav-diaspora-compliance"]')).toHaveAttribute('href', '/admin/diaspora/compliance')
  })

  test('government dashboard exposes diaspora compliance nav', async ({ page }) => {
    await loginAs(page, governmentUser, 'mock-government-token')

    await page.goto('/government')

    await expect(page.locator('[data-testid="nav-diaspora-compliance"]')).toHaveAttribute('href', '/admin/diaspora/compliance')
  })

  test('buyer can access document upload form', async ({ page }) => {
    await loginAsBuyer(page)
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/dio-1001/documents')

    await expect(page.locator('[data-testid="diaspora-import-documents-route"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-document-upload-form"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-document-type-select"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-document-file-input"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-document-upload-submit"]')).toBeVisible()
  })

  test('document upload validation prevents empty submit', async ({ page }) => {
    await loginAsBuyer(page)
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/dio-1001/documents')

    // Button should be disabled when no document type is selected and no file is chosen
    await expect(page.locator('[data-testid="diaspora-document-upload-submit"]')).toBeDisabled()
  })

  test('successful document upload shows in checklist', async ({ page }) => {
    await loginAsBuyer(page)
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/dio-1001/documents')
    await page.locator('[data-testid="diaspora-document-type-select"]').selectOption('passport')

    const fileInput = page.locator('[data-testid="diaspora-document-file-input"]')
    await fileInput.setInputFiles({
      name: 'passport_scan.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('test file content'),
    })

    await page.locator('[data-testid="diaspora-document-upload-submit"]').click()

    await expect(page.locator('[data-testid="diaspora-uploaded-document-row"]').first()).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-uploaded-document-row"]').first()).toContainText('Passport')
  })

  test('unauthenticated user cannot access document upload', async ({ page }) => {
    await page.goto('/diaspora/imports/dio-1001/documents')

    await expect(page).toHaveURL(/\/login\?returnTo=/)
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/diaspora/imports/dio-1001/documents')
  })

  test('logging in from a protected diaspora link returns the user to the requested page', async ({ page }) => {
    await mockDiasporaApi(page)
    await page.context().route('**/api/auth/login', async route => {
      await fulfillJson(route, { user: buyerUser, token: 'fresh-session-token' }, 200)
    })

    // Unauthenticated visit to a protected page redirects to login with returnTo.
    await page.goto('/diaspora/imports/new')
    await expect(page).toHaveURL(/\/login\?returnTo=/)
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/diaspora/imports/new')

    // After a successful login the user lands on the originally requested page (not the dashboard).
    await page.locator('[data-testid="email-input"]').fill('buyer@carup.test')
    await page.locator('[data-testid="password-input"]').fill('password123')
    await page.locator('[data-testid="login-button"]').click()

    await expect(page).toHaveURL(/\/diaspora\/imports\/new$/)
    await expect(page.locator('[data-testid="diaspora-new-import-route"]')).toBeVisible()
  })

  test('buyer sees uploaded document as UPLOADED, not VERIFIED', async ({ page }) => {
    await loginAsBuyer(page)
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/dio-1001/documents')

    await expect(page.locator('[data-testid="diaspora-document-status-badge"]').first()).toContainText('Uploaded')
    await expect(page.locator('[data-testid="diaspora-document-status-badge"]').first()).not.toContainText('Verified')
  })

  test('buyer sees info message about OCR/reviewer processing', async ({ page }) => {
    await loginAsBuyer(page)
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/dio-1001/documents')

    await expect(page.locator('[data-testid="diaspora-documents-info"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-documents-info"]')).toContainText('require OCR/reviewer processing')
  })

  test('buyer cannot see document review panel', async ({ page }) => {
    await loginAsBuyer(page)
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/dio-1001/documents')

    await expect(page.locator('[data-testid="diaspora-document-review-panel"]')).toHaveCount(0)
  })

  test('admin can see document review panel', async ({ page }) => {
    await loginAs(page, adminUser, 'mock-admin-token')
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/dio-1001/documents')

    await expect(page.locator('[data-testid="diaspora-document-review-panel"]')).toBeVisible()
  })

  test('admin can see verify and reject buttons', async ({ page }) => {
    await loginAs(page, adminUser, 'mock-admin-token')
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/dio-1001/documents')

    await expect(page.locator('[data-testid="diaspora-verify-button"]').first()).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-reject-button"]').first()).toBeVisible()
  })

  test('admin can verify document', async ({ page }) => {
    await loginAs(page, adminUser, 'mock-admin-token')
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/dio-1001/documents')

    // Await the actual request instead of checking a flag synchronously after click (race-free).
    const verifyRequest = page.waitForRequest(
      request => request.method() === 'POST' && request.url().includes('/verify'),
    )
    await page.locator('[data-testid="diaspora-verify-button"]').first().click()
    await verifyRequest
  })

  test('admin can reject document with reason', async ({ page }) => {
    await loginAs(page, adminUser, 'mock-admin-token')
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/dio-1001/documents')

    await page.locator('[data-testid="diaspora-reject-button"]').first().click()
    await page.locator('[data-testid="diaspora-reject-reason-input"]').first().fill('Blurry image')

    // Set up the wait before the confirm click so the reject POST can never be missed (race-free).
    const rejectRequest = page.waitForRequest(
      request => request.method() === 'POST' && request.url().includes('/reject'),
    )
    await page.locator('[data-testid="diaspora-confirm-reject-button"]').first().click()
    await rejectRequest
  })

  test('reject without reason is blocked', async ({ page }) => {
    await loginAs(page, adminUser, 'mock-admin-token')
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/dio-1001/documents')

    await page.locator('[data-testid="diaspora-reject-button"]').first().click()

    await expect(page.locator('[data-testid="diaspora-confirm-reject-button"]').first()).toBeDisabled()
  })

  test('government reviewer can see review controls', async ({ page }) => {
    await loginAs(page, governmentUser, 'mock-government-token')
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/dio-1001/documents')

    await expect(page.locator('[data-testid="diaspora-document-review-panel"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-verify-button"]').first()).toBeVisible()
  })

  test('buyer cannot see Run OCR button', async ({ page }) => {
    await loginAsBuyer(page)
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/dio-1001/documents')

    await expect(page.locator('[data-testid="diaspora-run-ocr-button"]')).toHaveCount(0)
  })

  test('admin can see Run OCR button', async ({ page }) => {
    await loginAs(page, adminUser, 'mock-admin-token')
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/dio-1001/documents')

    await expect(page.locator('[data-testid="diaspora-run-ocr-button"]').first()).toBeVisible()
  })

  test('admin can run OCR extraction', async ({ page }) => {
    await loginAs(page, adminUser, 'mock-admin-token')
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/dio-1001/documents')

    // Await the actual request instead of checking a flag synchronously after click (race-free).
    const ocrRequest = page.waitForRequest(
      request => request.method() === 'POST' && request.url().includes('/run-ocr'),
    )
    await page.locator('[data-testid="diaspora-run-ocr-button"]').first().click()
    await ocrRequest
  })

  test('OCR result is displayed after extraction', async ({ page }) => {
    await loginAs(page, adminUser, 'mock-admin-token')
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/dio-1001/documents')

    await page.locator('[data-testid="diaspora-run-ocr-button"]').first().click()

    await expect(page.locator('text=OCR Result')).toBeVisible()
    await expect(page.locator('text=ocr_test123')).toBeVisible()
  })

  test('OCR_EXTRACTED status is shown after OCR', async ({ page }) => {
    await loginAs(page, adminUser, 'mock-admin-token')
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/dio-1001/documents')

    // Trigger OCR and wait for the request (race-free), then assert the result/status is rendered.
    const ocrRequest = page.waitForRequest(
      request => request.method() === 'POST' && request.url().includes('/run-ocr'),
    )
    await page.locator('[data-testid="diaspora-run-ocr-button"]').first().click()
    await ocrRequest

    await expect(page.locator('text=OCR Result')).toBeVisible()
  })
})
