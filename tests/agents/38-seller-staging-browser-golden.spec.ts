/**
 * 38 — Golden Dynamic Seller deployed-staging acceptance.
 *
 * Creates a fresh Seller vehicle for every run/project. No Golden Reference vehicle, DB seed or
 * page.route() shortcut is used. The same exact-head frontend/backend pair is driven on Desktop
 * Chrome and Pixel 5 by playwright.staging.config.ts.
 *
 * Coverage:
 *   draft create + persisted listing media -> My Garage -> owner Passport -> authenticated buyer
 *   preview (not public / no buyer transaction controls) -> publish refusal -> ownership evidence ->
 *   reviewer verification -> publish -> public Marketplace -> guest inquiry -> Seller Communications
 *   -> Seller Intelligence -> price change -> unpublish -> sold.
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

const AUTOMATION_DESCRIPTION_PREFIX = 'UAT_AUTOMATION[';

async function meaningfulListingImages(page: Page, count = 7): Promise<string[]> {
  return page.evaluate(({ count: requested, runId }) => {
    const output: string[] = [];
    for (let index = 0; index < requested; index += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 400;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable in staging browser');

      ctx.fillStyle = '#f4f6f8';
      ctx.fillRect(0, 0, 640, 400);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(70, 190, 500, 130);
      ctx.fillStyle = '#475569';
      ctx.fillRect(170, 120, 300, 110);
      ctx.fillStyle = '#bfdbfe';
      ctx.fillRect(190, 145, 95, 60);
      ctx.fillRect(300, 145, 145, 60);
      ctx.fillStyle = '#020617';
      ctx.beginPath();
      ctx.arc(170, 320, 45, 0, Math.PI * 2);
      ctx.arc(470, 320, 45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f97316';
      ctx.fillRect(70 + (index * 8), 225, 44, 28);
      ctx.fillStyle = '#111827';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(`CarUp Seller UAT ${index + 1}/${requested}`, 20, 34);
      ctx.font = '14px sans-serif';
      ctx.fillText(`Automation certification media · ${runId}`, 20, 60);
      output.push(canvas.toDataURL('image/png'));
    }
    return output;
  }, { count, runId: RUN_ID });
}

async function expectMeaningfulPrimaryMedia(page: Page) {
  const primary = page.getByTestId('listing-media-primary');
  await expect(primary).toBeVisible({ timeout: 20_000 });
  const dimensions = await primary.evaluate((element) => {
    const image = element instanceof HTMLImageElement ? element : element.querySelector('img');
    return image ? { width: image.naturalWidth, height: image.naturalHeight } : null;
  });
  expect(dimensions, 'listing media primary element did not contain an image').toBeTruthy();
  expect(dimensions!.width, 'listing media is too narrow to satisfy visual UAT').toBeGreaterThanOrEqual(320);
  expect(dimensions!.height, 'listing media is too short to satisfy visual UAT').toBeGreaterThanOrEqual(200);
}

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

test.describe('Golden Dynamic Seller — exact-head deployed acceptance', () => {
  test('fresh Seller lifecycle holds end-to-end without a seed/reference vehicle', async ({ page, request }, testInfo) => {
    const truth = envTruth();
    expect(truth.mode, 'Seller acceptance is not pinned to the frozen exact-head bundle').toBe('acceptance');
    expect(requireIdentity('buyer'), 'owner Seller identity is unavailable').toBe(true);
    expect(requireIdentity('reviewer'), 'reviewer identity is unavailable').toBe(true);

    const suffix = sixDigits(`${RUN_ID}-${testInfo.project.name}`);
    const vin = `JTDKARFP0H3${suffix}`;
    const newPrice = 29_000;

    // Use the real login UI. The staging "buyer" identity is role=owner and therefore is also a
    // legitimate private Seller; no privileged role is needed to sell the owner's own vehicle.
    await signInViaUi(page, 'buyer');
    await expect(page.locator('body')).not.toContainText(/permission denied|42501/i);
    const sellerAuth = await authFromPage(page);
    expect(sellerAuth.user.role).toBe('owner');
    const sellerMutationHeaders = await mutationHeaders(request, sellerAuth);
    const listingImages = await meaningfulListingImages(page, 7);

    // Listing media is uploaded before the vehicle exists, exactly as Seller Studio does.
    // The Golden visual gate deliberately uses seven meaningful 640x400 images: a syntactically
    // valid 1x1 image is not acceptable evidence that the human-facing media experience works.
    const mediaResponse = await request.post(`${API_URL}/media/upload/vehicle`, {
      headers: sellerMutationHeaders,
      data: { vin, images: listingImages },
    });
    expect(mediaResponse.status(), await mediaResponse.text()).toBe(200);
    const mediaBody = await mediaResponse.json() as { urls?: string[] };
    expect(mediaBody.urls).toHaveLength(7);
    for (const url of mediaBody.urls || []) expect(url).toMatch(/^https:\/\//);

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
        description: `${AUTOMATION_DESCRIPTION_PREFIX}${RUN_ID}] Golden Dynamic Seller: staging-only vehicle created by Playwright for exact-head acceptance.`,
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
        images: mediaBody.urls!.map((url, index) => ({ url, is_primary: index === 2 })),
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
    expect(created.images_recorded_count).toBe(7);
    expect(created.images_unpublishable_count).toBe(0);
    expect(created.images_replacement_complete).not.toBe(false);
    expect(created.location_recorded).toBe(true);

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
    await expectMeaningfulPrimaryMedia(page);
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
        file: listingImages[0],
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
    await page.goto(`/marketplace?q=${encodeURIComponent(vin)}`);
    await expect(page.getByTestId('marketplace-results-count')).toContainText('1', { timeout: 20_000 });
    const publicLink = page.locator(`a[href="/marketplace/${vin}"]`).first();
    await expect(publicLink).toBeVisible({ timeout: 20_000 });
    await publicLink.click();
    await expect(page.getByTestId('vehicle-detail-primary-actions')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('listing-media-primary')).toBeVisible();

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
    await page.goto(`/marketplace?q=${encodeURIComponent(vin)}`);
    await expect(page.getByTestId('marketplace-results-count')).toContainText('0', { timeout: 20_000 });
    await expect(page.locator(`a[href="/marketplace/${vin}"]`)).toHaveCount(0);

    // Keep these literal identities referenced so accidental fixture drift is caught by review.
    expect(SELLER_EMAIL).toBe('uat.buyer@carup-staging.test');
  });
});
