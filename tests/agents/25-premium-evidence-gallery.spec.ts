import { test, expect } from '@playwright/test';

test.describe('Phase 2: Premium Visual Gallery & Timeline Experience', () => {
  const MOCK_VIN = 'VIN123GALLERY';

  test.beforeEach(async ({ page }) => {
    // Catch-all for API to prevent unhandled requests (must be registered FIRST so it evaluates LAST)
    await page.route(`**/*`, async (route, request) => {
      if (request.resourceType() === 'image') {
        return route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
        });
      }
      if (request.url().includes('/api/')) {
        return route.fulfill({ status: 200, body: '{}' });
      }
      return route.continue();
    });

    // Mock the specific passport endpoint (must be registered LAST so it evaluates FIRST)
    await page.route(`**/api/vehicles/passport/lookup/${MOCK_VIN}`, async route => {
      console.log(`[Test 25] Intercepted passport lookup for ${MOCK_VIN}`);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          vehicle: {
            vin: MOCK_VIN,
            make: 'Toyota',
            model: 'Corolla',
            year: 2018,
            price: 15000,
            currency: 'USD',
            images: [],
            features: []
          },
          trustReport: {
            trustScore: 85,
            metrics: {
              cvr_synced: true,
              zimra_duty: true,
              zrp_police_cleared: true,
              blockchain_audit_valid: true,
              odometer_consistent: true,
              maintenance_logs_count: 2,
              stolen_alert_active: false
            }
          },
          chainVerification: { verified: true },
          identity: {
            vin: MOCK_VIN,
            plateNumber: 'AAB-1234',
            registrationStatus: 'Active',
            plateVerifiedAt: new Date().toISOString()
          },
          plateHistory: [],
          ownershipSummary: {
            previousOwnerCount: 1,
            previousOwnersPublicLabel: '1 Previous Owner',
            ownerNamesRedacted: true,
            currentOwnerVisible: true,
            currentSellerType: 'Dealership'
          },
          timeline: [
            {
              id: 'evt-1',
              event_source: 'cvr',
              label: 'Registration Renewed',
              timestamp: new Date().toISOString()
            }
          ],
          evidenceVault: [
            {
              id: 'ev-1',
              vehicle_id: MOCK_VIN,
              vin: MOCK_VIN,
              event_type: 'cvr',
              evidence_type: 'inspection_photo',
              file_url: 'https://example.com/photo1.jpg',
              uploaded_by: 'u1',
              uploader_role: 'admin',
              captured_at: new Date().toISOString(),
              uploaded_at: new Date().toISOString(),
              verification_status: 'verified',
              visibility_level: 'public_safe',
              trust_score_impact: 10,
              metadata: {},
              linked_registry_event_id: 'evt-1',
              mime_type: 'image/jpeg'
            },
            {
              id: 'ev-2',
              vehicle_id: MOCK_VIN,
              vin: MOCK_VIN,
              event_type: 'cvr',
              evidence_type: 'registration_document',
              file_url: 'https://example.com/doc.pdf',
              uploaded_by: 'u1',
              uploader_role: 'admin',
              captured_at: new Date().toISOString(),
              uploaded_at: new Date().toISOString(),
              verification_status: 'verified',
              visibility_level: 'public_safe',
              trust_score_impact: 5,
              metadata: {},
              linked_registry_event_id: 'evt-1',
              mime_type: 'application/pdf'
            },
            {
              // Should be hidden
              id: 'ev-3',
              vehicle_id: MOCK_VIN,
              vin: MOCK_VIN,
              event_type: 'cvr',
              evidence_type: 'inspection_photo',
              file_url: 'https://example.com/photo2.jpg',
              uploaded_by: 'u1',
              uploader_role: 'admin',
              captured_at: new Date().toISOString(),
              uploaded_at: new Date().toISOString(),
              verification_status: 'pending',
              visibility_level: 'public_safe',
              trust_score_impact: 0,
              metadata: {},
              linked_registry_event_id: 'evt-1',
              mime_type: 'image/jpeg'
            }
          ]
        })
      });
    });

  });

  test('should render PremiumEvidenceGallery and respect privacy rules', async ({ page }) => {
    await page.goto(`/marketplace/${MOCK_VIN}`);
    
    // Switch to Evidence tab
    await page.getByRole('tab', { name: /Evidence Vault/i }).click({ force: true });

    // Verify Premium Evidence Gallery is rendered
    await expect(page.getByTestId('premium-evidence-gallery')).toBeVisible();

    // Should only show 2 groups based on our mock data (Inspection Photo and Registration Document)
    await expect(page.getByRole('heading', { name: /Inspection Photo/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Registration Document/i })).toBeVisible();

    // Should render 2 gallery items total, pending ones are hidden
    await expect(page.getByTestId('evidence-timeline-item')).toHaveCount(2);

    // Verify Lightbox opens on click
    await page.getByTestId('evidence-timeline-item').first().click();
    await expect(page.getByTestId('lightbox-dialog')).toBeVisible();
    
    // Verify next/prev buttons exist because we have > 1 item
    await expect(page.getByTestId('lightbox-next')).toBeVisible();
    
    // Verify Lightbox closes on Escape key
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('lightbox-dialog')).not.toBeVisible();
  });

  test('should render evidence thumbnails under history timeline', async ({ page }) => {
    await page.goto(`/marketplace/${MOCK_VIN}`);
    
    // Default tab is History
    await expect(page.getByTestId('history-timeline')).toBeVisible();

    // Verify that the timeline event has the evidence thumbnails
    await expect(page.getByTestId('timeline-event').first()).toBeVisible();
    
    // Should render 2 thumbnails for linked evidence
    await expect(page.getByTestId(/history-thumbnail-/)).toHaveCount(2);
  });
});
