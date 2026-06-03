import { test, expect } from '@playwright/test';

test.describe('Zimbabwe Plate & Owner Privacy Foundation — E2E Tests', () => {

  test('1 — public VehicleDetail page renders plate, temporary ID, and redacted ownership summary', async ({ page }) => {
    // Intercept lookup endpoint and return mock data for a guest user
    await page.route('**/api/vehicles/passport/lookup/AE-1234', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          vehicle: {
            vin: 'JTELU9FJ9K5987234',
            make: 'Toyota',
            model: 'Land Cruiser Prado',
            year: 2019,
            price: 48500,
            currency: 'USD',
            mileage: 45000,
            transmission: 'Automatic',
            fuelType: 'Diesel',
            color: 'Black',
            plate_number: 'AE-1234',
            normalized_plate_number: 'AE1234',
            chassis_number: 'JTELU9FJ9K5987234',
            temporary_identification_number: 'TEMP-1234-ZW'
          },
          identity: {
            vin: 'JTELU9FJ9K5987234',
            chassisNumber: 'JTELU9FJ9K5987234',
            plateNumber: 'AE-1234',
            normalizedPlateNumber: 'AE1234',
            plateStatus: 'Active',
            temporaryIdentificationNumber: 'TEMP-1234-ZW',
            engineNumber: '1KD-456789',
            registrationStatus: 'Current',
            registrationCountry: 'ZW',
            registrationAuthority: 'CVR',
            plateVerifiedAt: '2026-06-01T00:00:00Z',
            plateVerificationSource: 'CVR'
          },
          ownershipSummary: {
            currentSellerDisplayName: 'Private Seller',
            currentSellerType: 'Private Owner',
            previousOwnerCount: 2,
            previousOwnersPublicLabel: 'Redacted for privacy',
            ownerNamesRedacted: true,
            currentOwnerVisible: false
          },
          plateHistory: [
            {
              id: 'h1',
              plate_number: 'AE-1234',
              plate_type: 'permanent',
              status: 'active',
              issued_at: '2026-01-01T00:00:00Z'
            }
          ],
          timeline: [
            {
              id: 'ev1',
              event_source: 'cvr',
              label: 'CVR Registration',
              desc: 'Registered plate AE-1234. Owner name redacted for privacy.',
              timestamp: '2026-01-01T08:00:00Z',
              details: {
                plateNumber: 'AE-1234',
                status: 'Active'
              }
            }
          ],
          trustReport: {
            trustScore: 90,
            metrics: {
              cvr_synced: true,
              zimra_duty: true,
              zrp_police_cleared: true,
              blockchain_audit_valid: true,
              odometer_consistent: true,
              maintenance_logs_count: 5,
              stolen_alert_active: false
            }
          },
          chainVerification: {
            verified: true,
            integrity: 'Perfect',
            blocksChecked: 3,
            errors: []
          }
        })
      });
    });

    // Go directly to details page using plate identifier
    await page.goto('/marketplace/AE-1234');

    // Asserts:
    // A. Displays plate next to VIN
    const plateBadge = page.locator('[data-testid="identity-plate"]');
    await expect(plateBadge).toBeVisible();
    await expect(plateBadge).toContainText('Plate: AE-1234');

    // B. Displays registration status badge
    const regStatus = page.locator('[data-testid="registration-status-badge"]');
    await expect(regStatus).toBeVisible();
    await expect(regStatus).toContainText('Current');

    // C. Ownership summary card
    const ownershipCard = page.locator('[data-testid="ownership-summary-card"]');
    await expect(ownershipCard).toBeVisible();
    await expect(page.locator('[data-testid="prev-owner-count"]')).toContainText('2 owner(s) (Redacted for privacy)');
    await expect(ownershipCard).toContainText('Private Seller');

    // D. Verify private owner names (like "Tendai Moyo") are NOT displayed on the page
    const pageText = await page.innerText('body');
    expect(pageText.includes('Tendai Moyo')).toBe(false);

    // E. Verify Plate Registration History card is rendered
    const historyCard = page.locator('[data-testid="plate-history-card"]');
    await expect(historyCard).toBeVisible();
    await expect(historyCard).toContainText('AE-1234');
  });

  test('2 — search page allows filtering and matching by plate, chassis or temporary ID', async ({ page }) => {
    await page.goto('/search');

    // Enter plate in query input
    const searchInput = page.locator('input[placeholder*="Enter VIN, chassis, plate, or temporary ID"]');
    await expect(searchInput).toBeVisible();

    // Search by plate
    await searchInput.fill('AE-1234');
    await page.waitForTimeout(500);
    // Should show the Prado (v1)
    await expect(page.getByText('Toyota Land Cruiser Prado').first()).toBeVisible();

    // Search by normalized lowercase plate
    await searchInput.fill('ae1234');
    await page.waitForTimeout(500);
    await expect(page.getByText('Toyota Land Cruiser Prado').first()).toBeVisible();

    // Search by chassis number
    await searchInput.fill('JTELU9FJ9K5987234');
    await page.waitForTimeout(500);
    await expect(page.getByText('Toyota Land Cruiser Prado').first()).toBeVisible();

    // Search by temporary ID
    await searchInput.fill('TEMP-1234-ZW');
    await page.waitForTimeout(500);
    await expect(page.getByText('Toyota Land Cruiser Prado').first()).toBeVisible();
  });

  test('3 — missing or unverified plate shows confidence advisory banner', async ({ page }) => {
    // Intercept lookup endpoint and return mock data with unverified plate
    await page.route('**/api/vehicles/passport/lookup/UNVERIFIED', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          vehicle: { vin: 'VINUNVERIFIED', make: 'Toyota', model: 'Passo', year: 2015, price: 4000, mileage: 90000, plate_number: 'AF-1234' },
          identity: {
            vin: 'VINUNVERIFIED',
            plateNumber: 'AF-1234',
            plateVerifiedAt: null, // Unverified
            registrationStatus: 'Pending'
          },
          ownershipSummary: { previousOwnerCount: 1, ownerNamesRedacted: true },
          plateHistory: [],
          timeline: [],
          trustReport: { trustScore: 75, metrics: {} }
        })
      });
    });

    await page.goto('/marketplace/UNVERIFIED');
    const advisory = page.locator('[data-testid="plate-advisory"]');
    await expect(advisory).toBeVisible();
    await expect(advisory).toContainText('Confidence Advisory: Unverified Number Plate');
  });

});
