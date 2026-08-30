/**
 * 38 — Golden Dynamic Seller deployed-staging acceptance.
 *
 * Creates a fresh Seller vehicle for every run/project. No Golden Reference vehicle, DB seed or
 * page.route() shortcut is used. The same exact-head frontend/backend pair is driven on Desktop
 * Chrome and Pixel 5 by playwright.staging.config.ts.
 *
 * Coverage:
 *   integration lifecycle proof only. This test is deliberately NOT the human-facing Golden Seller
 *   Journey from the canonical remediation plan; that journey must enter through Home/Sell and the
 *   real Seller UI. This lower-level deployed acceptance still proves governed create/media,
 *   publication, inquiry and retirement contracts, and now guarantees it cannot contaminate human UAT.
 *
 */
import { readFileSync } from 'node:fs';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  stagingTest as test,
  expect,
  signInViaUi,
  requireIdentity,
  API_URL,
  RUN_ID,
} from './staging-helpers';

interface SessionAuth {
  token: string;
  user: { id: string; role: string; [key: string]: unknown };
}

interface EnvTruth {
  runId: string;
  webUrl: string;
  apiUrl: string;
  servedBundle: string;
  expectedBundle: string | null;
  mode: 'acceptance' | 'harness-validation';
  health?: unknown;
}

const SELLER_EMAIL = 'uat.buyer@carup-staging.test';
const REVIEWER_EMAIL = 'uat.reviewer@carup-staging.test';

// Human-facing visual acceptance must never be satisfied by a technically valid but visually
// meaningless 1x1 image. This 96x64 PNG has distinct vehicle-like geometry and is large enough for
// browser naturalWidth/naturalHeight assertions while remaining tiny in CI.
const VISUAL_TEST_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAIAAABqVuVZAAABZklEQVR4nO2bIVIDQRBFNxRoTEwQGBQGgcegsRwiJ8ohsGgMh8AjwMSgMbGphOTNzvT0pqj3XHZru3+97cnspiqzxc39IIc5mzrAqaMgQEGAggAFAQoCFAQoCFAQoCBAQYCCAAUBCgIUBCgIUBBwHljr/e01sFoLD49PUaWcIEBBgIIABQEKAhQEKAhQEKAgQEGAgoCD72Ifz59ja63bogRSEX4YhtuX6/2DThCgIEBBgIIABQEKAiJ/cp2v7gKrnQhOEKAgQEGAggAFAQoCwrb5q9XF9sev5W9U5WkzBAjaibV9ME1TvwytS+zPZIVno+iaoUlQSe/ejnpnqBdU3rWfo4QM7mJApaCxN6THEOVkmNX9JfNn/T32ksv5oqLR5BlcYoCCAAUBlYLGLubwL6C0DE4QUC+o/Ib0GJ+0DE0TVNK1n52cDK1L7Hjv3nYSMlQ+KO6z89iWoyYhQ5ig/4q7GKAgYAPmszSenKqEXgAAAABJRU5ErkJggg==';

// Evidence transport only needs a valid image document; it is not a visual-product fixture.
const EVIDENCE_TEST_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlYV1sAAAAASUVORK5CYII=';

function envTruth(): EnvTruth {
  return JSON.parse(readFileSync('test-results/staging-env-truth.json', 'utf8')) as EnvTruth;
}

function sixDigits(input: string): string {
  let value = 0;
  for (const char of input) value = ((value * 33) + char.charCodeAt(0)) % 1_000_000;
  return String(value).padStart(6, '0');
}

function baseHeaders(auth: SessionAuth): Record<string, string> {
  return {
    'x-session-token': auth.token,
    'x-user-id': auth.user.id,
    'x-stakeholder-role': auth.user.role,
  };
}

async function authFromPage(page: Page): Promise<SessionAuth> {
  const raw = await page.evaluate(() => ({
    token: localStorage.getItem('carup_token'),
    user: localStorage.getItem('carup_user'),
  }));
  expect(raw.token, 'signed-in page has no carup_token').toBeTruthy();
  const user = JSON.parse(raw.user || '{}') as SessionAuth['user'];
  expect(user.id, 'signed-in page has no user id').toBeTruthy();
  expect(user.role, 'signed-in page has no active role').toBeTruthy();
  return { token: raw.token!, user };
}

async function mutationHeaders(request: APIRequestContext, auth: SessionAuth): Promise<Record<string, string>> {
  const headers = baseHeaders(auth);
  const response = await request.get(`${API_URL}/security/csrf-token`, { headers });
  expect(response.status(), 'CSRF token endpoint refused the staging test identity').toBe(200);
  const body = await response.json() as { csrfToken?: string };
  expect(body.csrfToken, 'CSRF token response omitted csrfToken').toBeTruthy();
  return { ...headers, 'x-csrf-token': body.csrfToken! };
}

async function reviewerAuth(request: APIRequestContext): Promise<SessionAuth> {
  const password = process.env.STAGING_UAT_REVIEWER_PASSWORD;
  expect(password, 'STAGING_UAT_REVIEWER_PASSWORD is not configured').toBeTruthy();

  // /api/auth/login is an unsafe POST and is intentionally protected by the same global CSRF
  // middleware as every browser mutation. The UI obtains a guest-bound token before login; this
  // direct staging harness must do exactly the same rather than bypassing production protection.
  const csrfResponse = await request.get(`${API_URL}/security/csrf-token`);
  expect(csrfResponse.status(), 'guest CSRF token request failed before reviewer login').toBe(200);
  const csrfBody = await csrfResponse.json() as { csrfToken?: string };
  expect(csrfBody.csrfToken, 'guest CSRF token response omitted csrfToken').toBeTruthy();

  const response = await request.post(`${API_URL}/auth/login`, {
    headers: { 'x-csrf-token': csrfBody.csrfToken! },
    data: { email: REVIEWER_EMAIL, password },
  });
  expect(response.status(), `reviewer staging login failed: ${await response.text()}`).toBe(200);
  const body = await response.json() as { token?: string; user?: SessionAuth['user'] };
  expect(body.token).toBeTruthy();
  expect(body.user?.id).toBeTruthy();
  expect(body.user?.role).toBe('admin');
  return { token: body.token!, user: body.user! };
}

async function retireAutomationVehicle(
  request: APIRequestContext,
  vin: string,
  sellerMutationHeaders: Record<string, string>,
) {
  // Cleanup is part of the acceptance contract. It must run even when the test fails midway so an
  // automated vehicle can never become human-UAT inventory, a Home hero, a count, or a recommendation.
  const unpublish = await request.post(`${API_URL}/vehicles/${vin}/unpublish`, {
    headers: sellerMutationHeaders,
    data: {},
  });
  expect([200, 404], `automation cleanup could not unpublish ${vin}: ${await unpublish.text()}`).toContain(unpublish.status());

  const sold = await request.patch(`${API_URL}/vehicles/${vin}/status`, {
    headers: sellerMutationHeaders,
    data: { status: 'sold' },
  });
  expect([200, 404], `automation cleanup could not retire ${vin}: ${await sold.text()}`).toContain(sold.status());

  const discovery = await request.get(`${API_URL}/marketplace/listings?q=${encodeURIComponent(vin)}`);
  expect(discovery.status(), `automation cleanup could not verify Marketplace removal for ${vin}`).toBe(200);
  const body = await discovery.json() as { listings?: Array<{ vin?: string }> };
  expect((body.listings || []).some((listing) => listing.vin === vin), `automation vehicle ${vin} still contaminates public Marketplace`).toBe(false);
}

async function retireStaleAutomationVehicles(
  request: APIRequestContext,
  sellerAuth: SessionAuth,
  sellerMutationHeaders: Record<string, string>,
) {
  const owned = await request.get(`${API_URL}/vehicles/me`, { headers: baseHeaders(sellerAuth) });
  expect(owned.status(), 'could not inspect owned vehicles before Seller automation run').toBe(200);
  const vehicles = await owned.json() as Array<{ vin?: string; seller_description?: string | null }>;
  // Desktop and mobile projects share one staging Seller and may overlap. Retire automation from
  // OLDER workflow runs only; a sibling project from this same RUN_ID is current inventory, not
  // stale inventory, and retiring it creates a false My Listings disappearance mid-journey.
  const currentRunPrefix = `Golden Dynamic Seller ${RUN_ID}:`;
  const stale = vehicles.filter((vehicle) => {
    const description = String(vehicle.seller_description || '');
    return Boolean(vehicle.vin)
      && description.startsWith('Golden Dynamic Seller ')
      && !description.startsWith(currentRunPrefix);
  });

  for (const vehicle of stale) {
    await retireAutomationVehicle(request, vehicle.vin!, sellerMutationHeaders);
  }
}

async function expectMeaningfulRenderedImage(page: Page) {
  const image = page.getByTestId('vehicle-image').first();
  await expect(image).toBeVisible();
  // Visibility can precede image decode: wait for the browser to finish loading a genuinely
  // meaningful asset instead of sampling naturalWidth/naturalHeight during the transient 0x0 state.
  await expect.poll(
    async () => image.evaluate((node: HTMLImageElement) =>
      node.complete && node.naturalWidth >= 64 && node.naturalHeight >= 40),
    {
      timeout: 20_000,
      message: 'visual acceptance image never finished decoding at a meaningful size',
    },
  ).toBe(true);
  const size = await image.evaluate((node: HTMLImageElement) => ({
    width: node.naturalWidth,
    height: node.naturalHeight,
  }));
  expect(size.width, 'visual acceptance image is too narrow to be meaningful').toBeGreaterThanOrEqual(64);
  expect(size.height, 'visual acceptance image is too short to be meaningful').toBeGreaterThanOrEqual(40);
}

test.describe('Golden Dynamic Seller — exact-head deployed acceptance', () => {
  test('fresh Seller lifecycle holds end-to-end without a seed/reference vehicle', async ({ page, request }, testInfo) => {
    // This is a deployed-staging lifecycle across auth, storage, evidence, publication, inquiry and
    // Seller surfaces. Keep strict per-action timeouts, but do not let the suite-level 90s ceiling
    // terminate a healthy journey before its cleanup/lifecycle assertions can finish.
    test.setTimeout(180_000);
    const truth = envTruth();
    expect(truth.mode, 'Seller acceptance is not pinned to the frozen exact-head bundle').toBe('acceptance');
    expect(requireIdentity('buyer'), 'owner Seller identity is unavailable').toBe(true);
    expect(requireIdentity('reviewer'), 'reviewer identity is unavailable').toBe(true);

    const suffix = sixDigits(`${RUN_ID}-${testInfo.project.name}`);
    const vin = `JTDKARFP0H3${suffix}`;
    const newPrice = 29_000;
    let sellerMutationHeaders: Record<string, string> | null = null;
    let vehicleCreated = false;

    try {
    // Use the real login UI. The staging "buyer" identity is role=owner and therefore is also a
    // legitimate private Seller; no privileged role is needed to sell the owner's own vehicle.
    await signInViaUi(page, 'buyer');
    await expect(page.locator('body')).not.toContainText(/permission denied|42501/i);
    const sellerAuth = await authFromPage(page);
    expect(sellerAuth.user.role).toBe('owner');
    sellerMutationHeaders = await mutationHeaders(request, sellerAuth);
    await retireStaleAutomationVehicles(request, sellerAuth, sellerMutationHeaders);

    // Listing media is uploaded before the vehicle exists, exactly as Seller Studio does.
    const mediaResponse = await request.post(`${API_URL}/media/upload/vehicle`, {
      headers: sellerMutationHeaders,
      data: { vin, images: [VISUAL_TEST_PNG] },
    });
    expect(mediaResponse.status(), await mediaResponse.text()).toBe(200);
    const mediaBody = await mediaResponse.json() as { urls?: string[] };
    expect(mediaBody.urls).toHaveLength(1);
    expect(mediaBody.urls![0]).toMatch(/^https:\/\//);

    const createResponse = await request.post(`${API_URL}/vehicles/add`, {
      headers: sellerMutationHeaders,
      data: {
        vin,
        make: 'Toyota',
        model: 'Hilux',
        year: 2021,
        color: 'White',
        mileage: 45_000,
        fuel_type: 'Diesel',
        transmission: 'Automatic',
        drivetrain: '4WD',
        condition: 'Used',
        seller_stated_condition: 'Used',
        category: 'Pickup',
        body_style: 'Pickup',
        description: `Golden Dynamic Seller ${RUN_ID}: one staging-only vehicle created by Playwright for exact-head acceptance.`,
        features: ['Reverse camera', 'Tow bar'],
        price: 28_500,
        currency: 'USD',
        location: 'Harare',
        province: 'Harare',
        listing_country: 'ZW',
        registration_country: 'ZW',
        location_visibility: 'public',
        public_seller_display_enabled: false,
        engine_number: `ENG-${suffix}`,
        chassis_number: `CHS-${suffix}`,
        plate_number: `UAT${suffix.slice(0, 3)}`,
        import_status: 'locally_registered',
        images: [{ url: mediaBody.urls![0], is_primary: true }],
      },
    });
    expect(createResponse.status(), await createResponse.text()).toBe(201);
    const created = await createResponse.json() as {
      publication_status?: string;
      images_recorded?: boolean;
      images_recorded_count?: number;
      images_unpublishable_count?: number;
      images_replacement_complete?: boolean;
      location_recorded?: boolean;
    };
    expect(created.publication_status).toBe('draft');
    expect(created.images_recorded).toBe(true);
    expect(created.images_recorded_count).toBe(1);
    expect(created.images_unpublishable_count).toBe(0);
    expect(created.images_replacement_complete).not.toBe(false);
    expect(created.location_recorded).toBe(true);
    vehicleCreated = true;

    // Owner convergence: the same dynamic VIN exists in Garage and My Listings.
    await page.goto('/dashboard/garage');
    await expect(page.getByTestId(`vehicle-row-${vin}`)).toBeVisible({ timeout: 20_000 });
    await page.goto('/dashboard/listings');
    const listingCard = page.getByTestId(`my-listing-card-${vin}`);
    await expect(listingCard).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`publication-badge-${vin}`)).toContainText('Draft');

    // Authenticated Buyer Preview is allowed for this Seller, but it is NOT a public listing and
    // buyer transactional controls must therefore be absent.
    await page.goto(`/marketplace/${vin}`);
    await expect(page.getByTestId('vehicle-detail-intelligence-hero')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('listing-media-primary')).toBeVisible();
    await expectMeaningfulRenderedImage(page);
    await expect(page.getByTestId('marketplace-inquiry-open')).toHaveCount(0);

    // Publication must fail while the blocking ownership evidence is genuinely absent.
    const blockedPublish = await request.post(`${API_URL}/vehicles/${vin}/publish`, {
      headers: sellerMutationHeaders,
      data: {},
    });
    expect(blockedPublish.status(), 'draft published without verified ownership evidence').toBe(400);
    const blocked = await blockedPublish.json() as {
      blocking_gaps?: Array<{ key?: string; label?: string }>;
      pending_gaps?: Array<{ key?: string; label?: string }>;
      requirements?: Array<{ key?: string; label?: string; status?: string }>;
    };
    const refusalText = JSON.stringify(blocked);
    expect(refusalText).toMatch(/ownership_document|Ownership \/ Registration Document/i);

    // Upload an ownership document through the governed evidence contract.
    const evidenceResponse = await request.post(`${API_URL}/vehicles/${vin}/evidence/upload`, {
      headers: sellerMutationHeaders,
      data: {
        evidence_type: 'registration_document',
        file: EVIDENCE_TEST_PNG,
        visibility_level: 'restricted',
        verification_notes: `Golden Dynamic Seller ${RUN_ID} registration evidence`,
      },
    });
    expect(evidenceResponse.status(), await evidenceResponse.text()).toBe(201);
    const evidence = await evidenceResponse.json() as { id?: string; verification_status?: string };
    expect(evidence.id).toBeTruthy();
    expect(evidence.verification_status).toBe('pending');

    // The owner sees the real pending record in the Passport/Evidence surface.
    await page.goto(`/dashboard/garage/${vin}`);
    await expect(page.getByText(/Registration Document/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('body')).toContainText(/pending/i);

    // Review is a separate authority. Sign in through the real auth endpoint as the staging reviewer,
    // obtain a reviewer-bound CSRF token, and verify the exact evidence row.
    const reviewer = await reviewerAuth(request);
    const reviewerMutationHeaders = await mutationHeaders(request, reviewer);
    const verifyResponse = await request.patch(`${API_URL}/vehicles/${vin}/evidence/${evidence.id}/verify`, {
      headers: reviewerMutationHeaders,
      data: { notes: `Golden Dynamic Seller ${RUN_ID} verified`, trust_score_impact: 3 },
    });
    expect(verifyResponse.status(), await verifyResponse.text()).toBe(200);

    // Publish from the Seller UI, not by database/operator intervention.
    await page.goto('/dashboard/listings');
    await expect(page.getByTestId(`my-listing-card-${vin}`)).toBeVisible({ timeout: 20_000 });
    await page.getByTestId(`publish-toggle-${vin}`).click();
    await expect(page.getByTestId(`publication-badge-${vin}`)).toContainText('Published', { timeout: 20_000 });

    // Drop Seller auth and prove the VIN is genuinely public through the real Marketplace.
    await page.evaluate(() => localStorage.clear());
    // Drive the shareable Marketplace search contract directly through its governed URL state.
    // Typing into the command bar is intentionally debounced; using the URL avoids making UAT
    // timing-sensitive while still exercising the real Marketplace page + backend q filter.
    await page.goto(`/marketplace?q=${encodeURIComponent(vin)}&fixture_scope=${encodeURIComponent(RUN_ID)}`);
    await expect(page.getByTestId('marketplace-results-count')).toContainText('1', { timeout: 20_000 });
    const publicLink = page.locator(`a[href^="/marketplace/${vin}"]`).first();
    await expect(publicLink).toBeVisible({ timeout: 20_000 });
    await publicLink.click();
    await expect(page.getByTestId('vehicle-detail-primary-actions')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('listing-media-primary')).toBeVisible();
    await expectMeaningfulRenderedImage(page);

    // Real guest buyer intent -> governed Marketplace inquiry -> Communications bridge.
    await page.getByTestId('marketplace-inquiry-open').first().click();
    await expect(page.getByTestId('marketplace-inquiry-modal')).toBeVisible();
    await page.getByTestId('marketplace-inquiry-name').fill('Golden Dynamic Buyer');
    await page.getByTestId('marketplace-inquiry-email').fill(`golden-${suffix}@example.test`);
    await page.getByTestId('marketplace-inquiry-phone').fill('+263771234567');
    await page.getByTestId('marketplace-inquiry-message').fill(`Is ${vin} still available for inspection?`);
    const inquiryWait = page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes('/api/marketplace/inquiries')
    );
    await page.getByTestId('marketplace-inquiry-submit').click();
    const inquiryResponse = await inquiryWait;
    expect([200, 201]).toContain(inquiryResponse.status());
    await expect(page.getByTestId('marketplace-inquiry-modal')).toHaveCount(0, { timeout: 15_000 });

    // Return as Seller. Marketplace inquiry capture is immediate and has its own governed inbox on
    // My Listings. Communication threads are an asynchronous downstream projection and must not be
    // confused with the durable inquiry itself.
    await signInViaUi(page, 'buyer');
    await page.goto('/dashboard/listings');
    const sellerCard = page.getByTestId(`my-listing-card-${vin}`);
    await expect(sellerCard).toBeVisible({ timeout: 20_000 });
    const inquiryInbox = page.getByTestId('seller-inquiries-card');
    await expect(inquiryInbox).toBeVisible({ timeout: 20_000 });
    await expect(inquiryInbox).toContainText(vin, { timeout: 20_000 });
    await expect(inquiryInbox).toContainText(`Is ${vin} still available for inspection?`, { timeout: 20_000 });

    // Seller Intelligence may have measured data OR may truthfully say it is unavailable. Both are
    // valid; rendering fabricated zeroes as a substitute for missing measurement is not.
    await page.getByTestId(`toggle-insights-${vin}`).click();
    const insights = page.getByTestId('listing-insights').or(page.getByTestId('listing-insights-unavailable'));
    await expect(insights.first()).toBeVisible({ timeout: 20_000 });

    // Price lifecycle is Seller-owned and server-persistent.
    await page.getByTestId(`change-price-${vin}`).click();
    await page.getByTestId(`price-input-${vin}`).fill(String(newPrice));
    await page.getByTestId(`price-save-${vin}`).click();
    await expect(page.getByTestId(`listing-price-${vin}`)).toContainText(/29,?000/, { timeout: 20_000 });

    // Unpublish from the Seller UI, then mark sold so the UAT vehicle is retired from active stock.
    await page.getByTestId(`publish-toggle-${vin}`).click();
    await expect(page.getByTestId(`publication-badge-${vin}`)).toContainText('Ready to publish', { timeout: 20_000 });
    await page.getByTestId(`mark-sold-${vin}`).click();
    await expect(sellerCard).toContainText(/Sold/i, { timeout: 20_000 });

    // Public Marketplace must no longer expose the retired VIN.
    await page.evaluate(() => localStorage.clear());
    await page.goto(`/marketplace?q=${encodeURIComponent(vin)}&fixture_scope=${encodeURIComponent(RUN_ID)}`);
    await expect(page.getByTestId('marketplace-results-count')).toContainText('0', { timeout: 20_000 });
    await expect(page.locator(`a[href^="/marketplace/${vin}"]`)).toHaveCount(0);

    // Keep these literal identities referenced so accidental fixture drift is caught by review.
    expect(SELLER_EMAIL).toBe('uat.buyer@carup-staging.test');
    } finally {
      if (vehicleCreated) {
        // A later UI sign-in rotates the staging session, so the first login's mutation headers can
        // become stale. Cleanup is safety-critical: re-authenticate and mint fresh CSRF authority.
        await signInViaUi(page, 'buyer');
        const cleanupAuth = await authFromPage(page);
        const cleanupHeaders = await mutationHeaders(request, cleanupAuth);
        await retireAutomationVehicle(request, vin, cleanupHeaders);
      }
    }
  });
});
