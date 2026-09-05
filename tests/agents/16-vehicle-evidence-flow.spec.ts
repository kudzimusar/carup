import { test, expect } from '@playwright/test';

test.describe('Vehicle Evidence Upload & Review Flow', () => {
  const mockEvidenceId = 'mock-evidence-id-999';

  const corsHeaders = {
    'Access-Control-Allow-Origin': 'http://localhost:5173',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-session-token, x-user-id, x-stakeholder-role, x-tenant-id',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400'
  };

  let initialPassport: any;
  let evidenceList: any[];

  test.beforeEach(async ({ page }) => {
    // Reset state before each test
    initialPassport = {
      vehicle: {
        vin: 'MOCKVIN12345',
        make: 'Toyota',
        model: 'Hilux',
        year: 2022,
        price: 35000,
        trustScore: 90,
        status: 'available',
        location: 'Harare',
        images: ['https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?q=80&w=1000'],
        created_at: new Date().toISOString()
      },
      timeline: [
        {
          id: 'event-1',
          event_source: 'registry',
          event_type: 'import',
          timestamp: '2026-01-01T12:00:00Z',
          label: 'Imported to Zimbabwe',
          desc: 'Imported via Plumtree Border Post'
        }
      ],
      evidenceTimeline: [],
      evidenceVault: [],
      trustReport: { trustScore: 90 },
      chainVerification: { verified: true },
      identity: { vin: 'MOCKVIN12345' },
      plateHistory: [],
      ownershipSummary: { previousOwnerCount: 0 }
    };

    evidenceList = [];

    // Debug listeners
    page.on('console', msg => {
      console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
    });
    page.on('requestfailed', request => {
      console.log(`[Request Failed] ${request.url()} - ${request.failure()?.errorText}`);
    });

    // Single Stateful Mock Router
    await page.route('**/*', async (route, request) => {
      const url = request.url();
      const method = request.method();

      console.log(`[Mock Router Request] ${method} ${url}`);

      // Handle OPTIONS preflight request
      if (method === 'OPTIONS') {
        console.log(`[Mock Router Fulfill] OPTIONS ${url}`);
        await route.fulfill({
          status: 204,
          headers: corsHeaders
        });
        return;
      }

      if (url.includes('/api/security/csrf-token')) {
        console.log(`[Mock Router Fulfill] CSRF Token: ${url}`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ csrfToken: 'mock-csrf-token-123' })
        });
        return;
      }

      // Check request URL
      if (url.includes('/api/auth/login')) {
        console.log(`[Mock Router Fulfill] Login: ${url}`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({
            user: { id: 'u1', name: 'Tendai Moyo', email: 'tendai@email.co.zw', role: 'owner' },
            token: 'mock-owner-token-123'
          })
        });
      } else if (url.includes('/api/auth/switch-role')) {
        console.log(`[Mock Router Fulfill] Switch role: ${url}`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({
            user: { id: 'admin1', name: 'Admin User', email: 'admin@carup.co.zw', role: 'admin' },
            token: 'mock-admin-token-123'
          })
        });
      } else if (url.includes('/api/vehicles/MOCKVIN12345/details')) {
        console.log(`[Mock Router Fulfill] Vehicle details: ${url}`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({
            vin: 'MOCKVIN12345',
            make: 'Toyota',
            model: 'Hilux',
            year: 2022,
            price: 35000,
            trustScore: 90,
            status: 'available',
            location: 'Harare',
            images: ['https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?q=80&w=1000'],
            created_at: new Date().toISOString()
          })
        });
      } else if (url.includes('/api/vehicles/MOCKVIN12345/passport') || url.includes('/api/vehicles/passport/lookup/MOCKVIN12345')) {
        console.log(`[Mock Router Fulfill] Passport: ${url}`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify(initialPassport)
        });
      } else if (url.includes('/api/vehicles/MOCKVIN12345/evidence/upload') && method === 'POST') {
        console.log(`[Mock Router Fulfill] Upload evidence: ${url}`);
        const uploadedItem = {
          id: mockEvidenceId,
          vehicle_id: 'MOCKVIN12345',
          vin: 'MOCKVIN12345',
          evidence_type: 'odometer_photo',
          file_url: 'https://mock.storage/MOCKVIN12345/odometer_photo.png',
          verification_status: 'pending',
          visibility_level: 'public_safe',
          uploaded_by: 'u1',
          uploader_role: 'owner',
          captured_at: new Date().toISOString(),
          uploaded_at: new Date().toISOString(),
          verification_notes: 'Odometer reads 45,000 km',
          trust_score_impact: 0,
          metadata: {}
        };
        evidenceList.push(uploadedItem);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify(uploadedItem)
        });
      } else if (url.includes('/api/vehicles/MOCKVIN12345/evidence') && !url.includes('/verify') && !url.includes('/reject')) {
        console.log(`[Mock Router Fulfill] Evidence list: ${url}`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify(evidenceList)
        });
      } else if (url.includes('/api/evidence/review')) {
        console.log(`[Mock Router Fulfill] Admin review queue: ${url}`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify(evidenceList.filter(item => item.verification_status === 'pending'))
        });
      } else if (url.includes('/verify') && url.includes('/evidence/')) {
        console.log(`[Mock Router Fulfill] Approve/Verify evidence: ${url}`);
        const ev = evidenceList.find(item => item.id === mockEvidenceId);
        if (ev) {
          ev.verification_status = 'verified';
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            evidence: {
              id: mockEvidenceId,
              verification_status: 'verified'
            }
          })
        });
      } else if (url.includes('/api/admin/stats')) {
        console.log(`[Mock Router Fulfill] Admin stats: ${url}`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({
            totalUsers: 10,
            totalVehicles: 2,
            totalEscrows: 0,
            totalClaims: 0,
            systemHealth: 'Optimal',
            aiConfidence: '99%'
          })
        });
      } else if (url.includes('/api/vehicles/me') || url.includes('/api/notifications/me') || url.includes('/api/safepay/list')) {
        console.log(`[Mock Router Fulfill] Empty state fallbacks: ${url}`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify([])
        });
      } else if (url.includes('/api/')) {
        console.log(`[Mock Router Fulfill] Catch-all API fallback: ${url}`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({})
        });
      } else {
        console.log(`[Mock Router Continue] Continuing request: ${method} ${url}`);
        await route.continue();
      }
    });
  });

  test('Owner uploads evidence successfully', async ({ page }) => {
    // 1. Go to login
    await page.goto('/login');
    await page.getByRole('button', { name: /Browse as Buyer/i }).click();
    await page.waitForURL(/\/dashboard/);
    await expect(page.locator('[data-testid="nav-dashboard"]')).toBeVisible();

    // 2. Go to the vehicle profile page
    await page.goto('/dashboard/garage/MOCKVIN12345');

    // 3. Open Evidence & Media tab
    await page.getByRole('tab', { name: /Evidence & Media/i }).click();

    // 4. Verify empty state
    await expect(page.getByText('No Evidence Uploaded')).toBeVisible();

    // 5. Click Upload Evidence to open modal
    await page.getByRole('button', { name: /Upload Evidence/i }).first().click();

    // 6. Classify the evidence canonically. The uploader is canonical-first (Operations M1): the
    //    legacy `select#evidence-type` renders ONLY as a fallback when the taxonomy cannot load.
    //    current_condition/odometer derives the legacy `odometer_photo` compatibility value.
    await page.locator('select#evidence-class').selectOption('current_condition');
    await page.locator('select#evidence-subtype').selectOption('odometer');

    // 7. Mock file upload
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'odometer.png',
      mimeType: 'image/png',
      buffer: Buffer.from('fake-image-content')
    });

    // 8. Add description notes
    await page.locator('textarea#notes').fill('Odometer reads 45,000 km');

    // 10. Click Submit Evidence
    await page.getByRole('button', { name: /Submit Evidence/i }).click();

    // 11. Assert that the evidence appears with status "Pending Review" and visibility "Public"
    const evidenceTab = page.locator('[role="tabpanel"]', { hasText: 'Visual Evidence & Media' });
    await expect(evidenceTab.locator('h4', { hasText: 'Odometer Photo' })).toBeVisible();
    await expect(evidenceTab.locator('span', { hasText: 'Pending Review' }).first()).toBeVisible();
    await expect(evidenceTab.locator('span', { hasText: 'Public' }).first()).toBeVisible();
  });

  test('Evidence appears in admin review queue and approved evidence appears on public timeline', async ({ page }) => {
    // Setup state beforehand: owner has uploaded evidence which is pending
    evidenceList = [
      {
        id: mockEvidenceId,
        vehicle_id: 'MOCKVIN12345',
        vin: 'MOCKVIN12345',
        evidence_type: 'odometer_photo',
        file_url: 'https://mock.storage/MOCKVIN12345/odometer_photo.png',
        verification_status: 'pending',
        visibility_level: 'public_safe',
        uploaded_by: 'u1',
        uploader_role: 'owner',
        captured_at: new Date().toISOString(),
        uploaded_at: new Date().toISOString(),
        verification_notes: 'Odometer reads 45,000 km',
        trust_score_impact: 0,
        metadata: {}
      }
    ];

    // 3. Login as Buyer first and switch to Admin role
    await page.goto('/login');
    await page.getByRole('button', { name: /Browse as Buyer/i }).click();
    await page.waitForURL(/\/dashboard/);
    await expect(page.locator('[data-testid="nav-dashboard"]')).toBeVisible();
    
    // Switch role to Admin
    await page.locator('select').selectOption('admin');
    await page.waitForURL(/\/admin/);
    await expect(page.locator('[data-testid="nav-dashboard"]')).toBeVisible();

    // Clear any overlapping toast notifications by injecting CSS instead of removing DOM elements
    await page.addStyleTag({ content: '[data-sonner-toast] { display: none !important; }' });

    // Open sidebar on mobile if it's hidden
    const hamburger = page.locator('button:has(svg.lucide-menu)');
    if (await hamburger.isVisible()) {
      await hamburger.click();
    }

    // 4. Go to evidence review via soft navigation
    await page.getByRole('link', { name: 'Evidence Review' }).click();
    await page.waitForURL(/\/admin\/evidence/);

    // 5. Verify queue contains the pending evidence
    await expect(page.locator('h2', { hasText: 'Odometer Photo' })).toBeVisible();
    await expect(page.getByText('Odometer reads 45,000 km')).toBeVisible();

    // Setup state for post-verification fetching
    // Once approved, the passport should return it in the evidenceTimeline
    initialPassport.trustReport.trustScore = 93;
    const mockEvidenceData = {
      id: `evidence:${mockEvidenceId}`,
      event_source: 'evidence',
      event_type: 'odometer_photo',
      evidence_type: 'odometer_photo',
      timestamp: new Date().toISOString(),
      label: 'Odometer Photo',
      desc: 'Evidence verified by admin',
      file_url: 'https://mock.storage/MOCKVIN12345/odometer_photo.png',
      verification_status: 'verified',
      visibility_level: 'public_safe',
      trust_score_impact: 3,
      linked_registry_event_id: null,
      metadata: {}
    };
    
    initialPassport.evidenceTimeline = [mockEvidenceData];
    initialPassport.evidenceVault = [mockEvidenceData];

    // 7. Click Approve
    await page.getByRole('button', { name: /Approve/i }).first().click();

    // 8. Assert it is removed from the pending list
    await expect(page.getByText('No pending evidence items')).toBeVisible();

    // 10. Go to public vehicle details page
    await page.goto('/marketplace/MOCKVIN12345');

    // 11. Open Evidence Vault tab
    await page.getByRole('tab', { name: /Evidence Vault/i }).click();

    // 12. Verify approved evidence appears on public vehicle timeline
    await expect(page.getByTestId('evidence-timeline')).toBeVisible();
    await expect(page.getByTestId('evidence-timeline-item')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Odometer Photo' })).toBeVisible();
  });

  test('Unapproved or rejected evidence does not appear publicly', async ({ page }) => {
    // 1. Mock vehicle passport has empty evidenceTimeline (already set in reset state)

    // 2. Go to public details page
    await page.goto('/marketplace/MOCKVIN12345');

    // 3. Open Evidence Vault tab
    await page.getByRole('tab', { name: /Evidence Vault/i }).click();

    // 4. Assert that it shows "No verified evidence published yet"
    await expect(page.getByTestId('evidence-empty-state')).toBeVisible();
    await expect(page.getByText('No verified evidence published yet')).toBeVisible();
  });

  // Phase 3: Navigation Intelligence / Product UX Cleanup
  test('public user cannot access private dashboard routes and gets redirected', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/.*login/);
  });

  test('mobile navigation opens and routes correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    const buyMobileLink = page.getByRole('link', { name: 'Buy', exact: true });
    await expect(buyMobileLink).not.toBeVisible();

    await page.getByRole('button').filter({ has: page.locator('svg.lucide-menu') }).click();
    await expect(buyMobileLink).toBeVisible();

    await buyMobileLink.click();
    await expect(page).toHaveURL(/.*marketplace/);
    await expect(buyMobileLink).not.toBeVisible();
  });

  test('SafePay links route to listings for logged in user', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.setItem('carup_user', JSON.stringify({ id: 'u1', name: 'Test Owner', role: 'owner' }));
      window.localStorage.setItem('carup_token', 'mock-token');
    });
    await page.reload();

    const sellDropdown = page.getByTestId('nav-sell');
    await sellDropdown.hover();
    await sellDropdown.click();

    const safePayLink = page.getByRole('menuitem', { name: 'SafePay / Reservation Ready' });
    await expect(safePayLink).toBeVisible();
    await expect(safePayLink).toHaveAttribute('href', '/dashboard/listings');
  });

  test('Upload Evidence direct link visible in Owner Dashboard', async ({ page }) => {
    await page.goto('/login'); // Setup origin
    await page.evaluate(() => {
      window.localStorage.setItem('carup_user', JSON.stringify({ id: 'u1', name: 'Test Owner', role: 'owner' }));
      window.localStorage.setItem('carup_token', 'mock-token');
    });

    await page.goto('/dashboard');
    const evidenceNav = page.getByRole('link', { name: /Evidence Vault/i });
    await expect(evidenceNav).toBeVisible();
    await expect(evidenceNav).toHaveAttribute('href', '/dashboard/garage');
  });
});
