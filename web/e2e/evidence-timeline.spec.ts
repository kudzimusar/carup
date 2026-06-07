import { test, expect } from '@playwright/test'

const passportPayload = {
  vehicle: {
    vin: 'VIN-EVIDENCE-001',
    make: 'Toyota',
    model: 'Hilux',
    year: 2022,
    mileage: 28000,
    fuel_type: 'Diesel',
    transmission: 'Automatic',
    duty_paid: true,
    police_verified: true,
    status: 'Available',
    trust_score: 92,
    price: 42000,
    currency: 'USD',
    images: [],
    features: ['4x4'],
    location: 'Harare',
    province: 'Harare Province',
    created_at: '2026-01-01T00:00:00Z'
  },
  timeline: [
    {
      id: 'zimra:1',
      event_source: 'zimra',
      timestamp: '2026-01-02T00:00:00Z',
      label: 'ZIMRA Customs',
      desc: 'Import duty customs clearance confirmed',
      details: {}
    },
    {
      id: 'evidence:ev-1',
      event_source: 'evidence',
      event_type: 'import',
      evidence_type: 'import_photo',
      timestamp: '2026-01-03T00:00:00Z',
      label: 'Import Photo',
      desc: 'Verified import yard photo',
      file_url: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22240%22%3E%3Crect width=%22400%22 height=%22240%22 fill=%22%23f97316%22/%3E%3Ctext x=%2220%22 y=%22130%22 font-size=%2230%22 fill=%22white%22%3EImport Proof%3C/text%3E%3C/svg%3E',
      verification_status: 'verified',
      trust_score_impact: 4,
      linked_registry_event_id: 'zimra:1',
      details: { uploaderRole: 'dealer', checksum: 'abc123' }
    },
    {
      id: 'evidence:ev-2',
      event_source: 'evidence',
      event_type: 'registration',
      evidence_type: 'registration_document',
      timestamp: '2026-01-04T00:00:00Z',
      label: 'Registration Document',
      desc: 'Verified CVR registration document',
      file_url: 'https://example.test/registration.pdf',
      verification_status: 'verified',
      trust_score_impact: 3,
      linked_registry_event_id: 'cvr:1',
      details: { uploaderRole: 'government', checksum: 'def456' }
    }
  ],
  evidenceTimeline: [
    {
      id: 'evidence:ev-1',
      event_source: 'evidence',
      event_type: 'import',
      evidence_type: 'import_photo',
      timestamp: '2026-01-03T00:00:00Z',
      label: 'Import Photo',
      desc: 'Verified import yard photo',
      file_url: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22240%22%3E%3Crect width=%22400%22 height=%22240%22 fill=%22%23f97316%22/%3E%3Ctext x=%2220%22 y=%22130%22 font-size=%2230%22 fill=%22white%22%3EImport Proof%3C/text%3E%3C/svg%3E',
      verification_status: 'verified',
      trust_score_impact: 4,
      linked_registry_event_id: 'zimra:1',
      details: { uploaderRole: 'dealer', checksum: 'abc123' }
    },
    {
      id: 'evidence:ev-2',
      event_source: 'evidence',
      event_type: 'registration',
      evidence_type: 'registration_document',
      timestamp: '2026-01-04T00:00:00Z',
      label: 'Registration Document',
      desc: 'Verified CVR registration document',
      file_url: 'https://example.test/registration.pdf',
      verification_status: 'verified',
      trust_score_impact: 3,
      linked_registry_event_id: 'cvr:1',
      details: { uploaderRole: 'government', checksum: 'def456' }
    }
  ],
  evidenceVault: [],
  trustReport: {
    vin: 'VIN-EVIDENCE-001',
    trustScore: 92,
    metrics: {
      cvr_synced: true,
      zimra_duty: true,
      zrp_police_cleared: true,
      blockchain_audit_valid: true,
      odometer_consistent: true,
      maintenance_logs_count: 2,
      stolen_alert_active: false,
      evidence_trust_impact: 7,
      verified_evidence_count: 2,
      rejected_evidence_count: 0
    }
  },
  chainVerification: { verified: true },
  identity: {
    vin: 'VIN-EVIDENCE-001',
    plateNumber: 'ABC123',
    registrationStatus: 'Current',
    plateVerifiedAt: '2026-01-02T00:00:00Z'
  },
  plateHistory: [],
  ownershipSummary: {
    currentSellerDisplayName: 'CarUp Dealer',
    currentSellerType: 'Dealership',
    previousOwnerCount: 1,
    previousOwnersPublicLabel: 'Redacted for privacy',
    ownerNamesRedacted: true,
    currentOwnerVisible: true
  }
}

test('buyer opens a vehicle passport and views the full evidence timeline', async ({ page }) => {
  await page.route('**/api/vehicles/passport/lookup/VIN-EVIDENCE-001', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(passportPayload) })
  })

  await page.goto('/marketplace/VIN-EVIDENCE-001')

  await expect(page.getByRole('heading', { name: /2022 Toyota Hilux/i })).toBeVisible()
  await page.getByRole('tab', { name: /evidence vault/i }).click()

  const timeline = page.locator('[data-testid="evidence-timeline"]')
  await expect(timeline).toBeVisible()

  const items = page.locator('[data-testid="evidence-timeline-item"]')
  await expect(items).toHaveCount(2)
  await expect(items.first()).toContainText('Import Photo')
  await expect(items.first()).toContainText('zimra:1')
  await expect(items.nth(1)).toContainText('Registration Document')
  await expect(items.nth(1)).toContainText('cvr:1')
  await expect(page.locator('[data-testid="evidence-empty-state"]')).not.toBeVisible()
})
