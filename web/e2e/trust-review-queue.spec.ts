import { expect, test, type Page, type Route } from '@playwright/test'

const pendingRequests = [
  {
    id: 'req-condition',
    vin: 'VIN-CONDITION-001',
    trust_fact: 'vehicle_condition_category',
    current_value: { condition_category: 'unknown' },
    requested_value: { condition_category: 'brand_new' },
    status: 'pending',
    requested_by_role: 'dealer',
    requested_by_tenant_id: 'tenant-dealer-1',
    evidence_ids: ['ev-condition'],
    reason: 'Dealer submitted inspection evidence.',
    created_at: '2026-06-04T08:00:00.000Z',
    updated_at: '2026-06-04T08:00:00.000Z',
  },
  {
    id: 'req-passport',
    vin: 'VIN-PASSPORT-002',
    trust_fact: 'passport_verified',
    current_value: { passport_verified: false },
    requested_value: { passport_verified: true },
    status: 'pending',
    requested_by_role: 'owner',
    evidence_ids: ['ev-passport'],
    reason: 'Registration document ready.',
    created_at: '2026-06-04T09:00:00.000Z',
    updated_at: '2026-06-04T09:00:00.000Z',
  },
  {
    id: 'req-inspection',
    vin: 'VIN-INSPECTION-003',
    trust_fact: 'inspection_ready',
    current_value: { inspection_ready: false },
    requested_value: { inspection_ready: true },
    status: 'pending',
    requested_by_role: 'owner',
    evidence_ids: ['ev-inspection'],
    reason: 'Inspection photo ready.',
    created_at: '2026-06-04T10:00:00.000Z',
    updated_at: '2026-06-04T10:00:00.000Z',
  },
]

const approvedRequests = [
  {
    ...pendingRequests[1],
    id: 'req-approved-passport',
    status: 'approved',
    decision_notes: 'Approved from verified registration document.',
    reviewed_by_role: 'admin',
    reviewed_at: '2026-06-04T11:00:00.000Z',
  },
]

const evidenceRows = [
  {
    id: 'ev-condition',
    vin: 'VIN-CONDITION-001',
    evidence_type: 'dealer_listing_photo',
    verification_status: 'verified',
    visibility_level: 'public_safe',
    uploaded_at: '2026-06-04T07:30:00.000Z',
    captured_at: '2026-06-04T07:00:00.000Z',
    linked_registry_event_id: 'registry-event-1',
    checksum: 'abcdef1234567890',
    file_url: 'https://private-user-images.example.com/raw-secret-evidence-url',
    uploaded_by: 'owner-user-id-secret',
    metadata: {
      owner_name: 'Tendai Moyo',
      phone: '+263 773 345 678',
      email: 'tendai@example.com',
      address: '42 Harare Road',
      national_id: '63-123456-A-12',
    },
  },
]

const auditEvents = [
  {
    id: 'audit-1',
    event_type: 'TRUST_FACT_APPROVED',
    vin: 'VIN-CONDITION-001',
    trust_fact: 'vehicle_condition_category',
    previous_value: {
      condition_category: 'unknown',
      owner_name: 'Tendai Moyo',
      phone: '+263 773 345 678',
      email: 'tendai@example.com',
      address: '42 Harare Road',
      national_id: '63-123456-A-12',
    },
    new_value: { condition_category: 'brand_new' },
    actor_role: 'admin',
    actor_user_id: 'admin-user-id-secret',
    source_route: '/api/verification/trust-facts/req-condition/approve',
    evidence_ids: ['ev-condition'],
    reason: 'owner name: Tendai Moyo; phone: +263 773 345 678',
    decision_notes: 'email: tendai@example.com; address: 42 Harare Road',
    created_at: '2026-06-04T12:00:00.000Z',
  },
]

const decisionPayloads: Record<string, Record<string, unknown> | null> = {
  approve: null,
  reject: null,
  revoke: null,
}

function authUser(role: 'admin' | 'government' | 'owner') {
  return {
    id: `${role}-1`,
    name: `${role} reviewer`,
    email: `${role}@carup.test`,
    role,
  }
}

async function loginAs(page: Page, role: 'admin' | 'government' | 'owner') {
  await page.addInitScript((user) => {
    window.localStorage.setItem('carup_user', JSON.stringify(user))
    window.localStorage.setItem('carup_token', `mock-${user.role}-token`)
  }, authUser(role))
}

async function fulfillJson(route: Route, body: unknown) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,PATCH,POST,OPTIONS',
  }

  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers })
    return
  }

  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body),
  })
}

test.describe('Admin/Government Trust Review Queue', () => {
  test.beforeEach(async ({ context }) => {
    decisionPayloads.approve = null
    decisionPayloads.reject = null
    decisionPayloads.revoke = null

    await context.route('http://localhost:5001/api/**', async route => {
      const requestUrl = route.request().url()

      if (requestUrl.includes('/verification/review-queue')) {
        const url = new URL(route.request().url())
        const status = url.searchParams.get('status') || 'pending'
        const trustFact = url.searchParams.get('trust_fact')
        const rows = status === 'approved' ? approvedRequests : pendingRequests
        const filtered = trustFact ? rows.filter(row => row.trust_fact === trustFact) : rows

        await fulfillJson(route, { requests: filtered, total: filtered.length })
        return
      }

      if (requestUrl.includes('/vehicles/') && requestUrl.includes('/evidence')) {
        await fulfillJson(route, evidenceRows)
        return
      }

      if (requestUrl.includes('/verification/audit-trail/')) {
        await fulfillJson(route, { vin: 'VIN-CONDITION-001', events: auditEvents, total: auditEvents.length })
        return
      }

      if (requestUrl.includes('/verification/trust-facts/')) {
        const action = requestUrl.includes('/approve') ? 'approve' : requestUrl.includes('/reject') ? 'reject' : 'revoke'
        const body = JSON.parse(route.request().postData() || '{}')
        decisionPayloads[action] = body
        await fulfillJson(route, {
          success: true,
          receivedDecisionNotes: body.decision_notes,
          request: { ...pendingRequests[0], status: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'revoked' },
        })
        return
      }

      await fulfillJson(route, {})
    })
  })

  test('admin route loads Trust Review and shows all Phase 2A filters', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/admin/trust-review')

    await expect(page.getByRole('heading', { name: 'Trust Review' })).toBeVisible()
    const filter = page.locator('[data-testid="trust-fact-filter"]')
    await expect(filter).toContainText('Vehicle condition category')
    await expect(filter).toContainText('Passport verified')
    await expect(filter).toContainText('Inspection ready')
  })

  test('government route loads Trust Review and excludes vehicle condition category filter', async ({ page }) => {
    await loginAs(page, 'government')
    await page.goto('/government/trust-review')

    await expect(page.getByRole('heading', { name: 'Trust Review' })).toBeVisible()
    const filter = page.locator('[data-testid="trust-fact-filter"]')
    await expect(filter).not.toContainText('Vehicle condition category')
    await expect(filter).toContainText('Passport verified')
    await expect(filter).toContainText('Inspection ready')
  })

  test('queue table renders request summary fields', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/admin/trust-review')

    const firstRow = page.locator('[data-testid="trust-review-row"]').first()
    await expect(firstRow).toContainText('VIN-CONDITION-001')
    await expect(firstRow).toContainText('Vehicle condition category')
    await expect(firstRow).toContainText('condition_category: unknown')
    await expect(firstRow).toContainText('condition_category: brand_new')
    await expect(firstRow).toContainText('Dealer')
    await expect(firstRow).toContainText('1')
    await expect(firstRow).toContainText('Pending')
  })

  test('evidence drawer displays safe fields only', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/admin/trust-review')
    await page.locator('[data-testid="trust-review-open-evidence"]').first().click()

    const drawer = page.locator('[data-testid="trust-review-evidence-drawer"]')
    await expect(drawer).toBeVisible()
    await expect(drawer).toContainText('Dealer Listing Photo')
    await expect(drawer).toContainText('Verified')
    await expect(drawer).toContainText('Public Safe')
    await expect(drawer).toContainText('registry-event-1')
    await expect(drawer).toContainText('abcdef123456')
    await expect(drawer.getByRole('link', { name: /Open evidence/i })).toBeVisible()

    await expect(drawer).not.toContainText('Tendai Moyo')
    await expect(drawer).not.toContainText('+263 773 345 678')
    await expect(drawer).not.toContainText('tendai@example.com')
    await expect(drawer).not.toContainText('42 Harare Road')
    await expect(drawer).not.toContainText('63-123456-A-12')
    await expect(drawer).not.toContainText('owner-user-id-secret')
    await expect(drawer).not.toContainText('raw-secret-evidence-url')
  })

  test('approve modal requires decision notes and submits approve', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/admin/trust-review')
    await page.locator('[data-testid="trust-review-approve"]').first().click()

    await expect(page.locator('[data-testid="trust-review-submit-decision"]')).toBeDisabled()
    await page.locator('[data-testid="trust-review-decision-notes"]').fill('Verified evidence supports this trust fact.')
    await expect(page.locator('[data-testid="trust-review-submit-decision"]')).toBeEnabled()
    await page.locator('[data-testid="trust-review-submit-decision"]').click()

    await expect.poll(() => decisionPayloads.approve?.decision_notes).toBe('Verified evidence supports this trust fact.')
  })

  test('reject modal requires decision notes and submits reject', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/admin/trust-review')
    await page.locator('[data-testid="trust-review-reject"]').first().click()

    await expect(page.locator('[data-testid="trust-review-submit-decision"]')).toBeDisabled()
    await page.locator('[data-testid="trust-review-decision-notes"]').fill('Evidence does not support the requested category.')
    await page.locator('[data-testid="trust-review-submit-decision"]').click()

    await expect.poll(() => decisionPayloads.reject?.decision_notes).toBe('Evidence does not support the requested category.')
  })

  test('approved tab shows revoke action and submits revoke', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/admin/trust-review')
    await page.getByRole('tab', { name: 'Approved' }).click()
    await expect(page.locator('[data-testid="trust-review-row"]')).toHaveCount(1)
    await page.locator('[data-testid="trust-review-revoke"]').first().click()
    await expect(page.locator('[data-testid="trust-review-submit-decision"]')).toBeDisabled()
    await page.locator('[data-testid="trust-review-decision-notes"]').fill('Passport verification was superseded.')
    await page.locator('[data-testid="trust-review-submit-decision"]').click()

    await expect.poll(() => decisionPayloads.revoke?.decision_notes).toBe('Passport verification was superseded.')
  })

  test('audit trail drawer loads by VIN and hides actor IDs and PII', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/admin/trust-review')
    await page.locator('[data-testid="trust-review-open-audit"]').first().click()

    const drawer = page.locator('[data-testid="trust-review-audit-drawer"]')
    await expect(drawer).toBeVisible()
    await expect(drawer).toContainText('Trust Fact Approved')
    await expect(drawer).toContainText('Vehicle condition category')
    await expect(drawer).toContainText('[redacted]')

    await expect(drawer).not.toContainText('admin-user-id-secret')
    await expect(drawer).not.toContainText('Tendai Moyo')
    await expect(drawer).not.toContainText('+263 773 345 678')
    await expect(drawer).not.toContainText('tendai@example.com')
    await expect(drawer).not.toContainText('42 Harare Road')
    await expect(drawer).not.toContainText('63-123456-A-12')
  })

  test('non-admin and non-government access shows unauthorized and makes no queue API call', async ({ page }) => {
    let queueCalls = 0
    await page.route('**/*', async route => {
      if (!route.request().url().includes('/verification/review-queue')) {
        await route.fallback()
        return
      }
      queueCalls += 1
      await fulfillJson(route, { requests: [], total: 0 })
    })

    await loginAs(page, 'owner')
    await page.goto('/admin/trust-review')

    await expect(page.locator('[data-testid="trust-review-unauthorized"]')).toBeVisible()
    expect(queueCalls).toBe(0)
  })
})
