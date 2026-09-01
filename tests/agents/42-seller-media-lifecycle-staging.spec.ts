import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * SELLER MEDIA CONTINUITY ACROSS THE FULL COMMERCE LIFECYCLE (deployed staging, exact head).
 *
 * `web/e2e/seller-media-continuity.spec.ts` proves the DRAFT half physically — real uploads, decoded
 * pixels, every owner surface, reload and re-login. It stops at the publication gate, because
 * publishing needs a VERIFIED ownership document and reviewer authority cannot be created from the
 * public registration API (backend/scripts/staging-create-test-identities.mjs records that
 * limitation explicitly). This spec carries the same media through the rest of the lifecycle, in the
 * one environment where that authority exists.
 *
 * ── WHAT IS DRIVEN THROUGH THE UI ─────────────────────────────────────────────────────────────
 * Every SELLER action: login, listing creation, the three photo uploads, cover selection, labels,
 * saving, uploading the ownership document, publish, unpublish, republish and mark-sold. No API
 * call stands in for any of them.
 *
 * ── THE ONE EXCEPTION, AND WHY ────────────────────────────────────────────────────────────────
 * Reviewer verification of the ownership document. It is a back-office authority with no
 * seller-facing UI, which the master plan permits explicitly. It is performed through the real
 * login + CSRF + verify endpoints as the reviewer identity — not by a database write, and not by
 * relaxing the gate. The refusal BEFORE it is asserted, so the gate is proven to be real.
 *
 * ── WHY THE FIXTURES DIFFER IN SIZE ───────────────────────────────────────────────────────────
 * Each fixture has a unique natural size, so `naturalWidth` identifies WHICH asset the browser
 * decoded. Wrong cover, wrong asset, placeholder substitution and dead locators cannot pass by
 * accident. The cover is deliberately the SECOND upload, so "renders items[0]" fails rather than
 * passing by coincidence.
 */

const API_URL = process.env.STAGING_API_URL || '';
const SELLER_EMAIL = 'uat.buyer@carup-staging.test';
const REVIEWER_EMAIL = 'uat.reviewer@carup-staging.test';
const RUN_ID = process.env.STAGING_RUN_ID || 'media-local';

const FIXTURES = fileURLToPath(new URL('../../web/e2e/fixtures/seller-media/', import.meta.url));
const PHOTOS = [
  { file: 'photo-a-front-320x200.png', label: 'Front three-quarter', width: 320, height: 200 },
  { file: 'photo-b-odometer-360x220.png', label: 'Odometer', width: 360, height: 220 },
  { file: 'photo-c-damage-400x240.png', label: 'Any known damage', width: 400, height: 240 },
] as const;
const COVER = PHOTOS[1];

/** A VIN excludes I, O and Q. A malformed one never completes, so the Passport check never fires. */
const VIN_SAFE = (v: string) => v.toUpperCase().replace(/[IOQ]/g, 'X').replace(/[^A-HJ-NPR-Z0-9]/g, '0');

/**
 * The VIN is unique per PROJECT as well as per run.
 *
 * `STAGING_RUN_ID` is one value for the whole workflow, so desktop and mobile would otherwise create
 * the SAME vin — and the second project would find that CarUp already holds a Passport for it. That
 * is not a failure of the media contract: step-0 validation correctly refuses to advance until the
 * seller confirms whether it is the same vehicle, so the mobile run simply never reached stage 2.
 * Each viewport gets its own vehicle instead of the two runs colliding.
 */
const vinFor = (project: string) => {
  // Keep the changing end of the workflow run id INSIDE the 17 characters. The previous builder
  // truncated after the shared "media-334..." prefix, so different runs could reuse one Passport
  // and correctly hit the existing-Passport confirmation gate before Stage 2.
  const projectToken = VIN_SAFE(project.slice(0, 3)).padEnd(3, 'X').slice(0, 3);
  const runToken = RUN_ID.replace(/\D/g, '').slice(-9).padStart(9, '0');
  return `JTMLC${projectToken}${runToken}`;
};

type SessionAuth = { token: string; user: { id: string; role: string } };

const baseHeaders = (auth: SessionAuth) => ({
  'x-session-token': auth.token,
  'x-user-id': auth.user.id,
  'x-stakeholder-role': auth.user.role,
});

async function mutationHeaders(request: APIRequestContext, auth: SessionAuth) {
  const headers = baseHeaders(auth);
  const response = await request.get(`${API_URL}/security/csrf-token`, { headers });
  expect(response.status(), 'CSRF token endpoint refused the staging identity').toBe(200);
  const body = await response.json() as { csrfToken?: string };
  return { ...headers, 'x-csrf-token': body.csrfToken! };
}

async function reviewerAuth(request: APIRequestContext): Promise<SessionAuth> {
  const password = process.env.STAGING_UAT_REVIEWER_PASSWORD;
  // Login is an unsafe POST behind the same CSRF middleware as any browser mutation; obtain a
  // guest-bound token first rather than bypassing the protection the product ships.
  const csrf = await request.get(`${API_URL}/security/csrf-token`);
  const csrfBody = await csrf.json() as { csrfToken?: string };
  const response = await request.post(`${API_URL}/auth/login`, {
    headers: { 'x-csrf-token': csrfBody.csrfToken! },
    data: { email: REVIEWER_EMAIL, password },
  });
  expect(response.status(), `reviewer login failed: ${await response.text()}`).toBe(200);
  const body = await response.json() as { token?: string; user?: SessionAuth['user'] };
  expect(body.user?.role, 'the reviewer identity must actually hold review authority').toBe('admin');
  return { token: body.token!, user: body.user! };
}

// ── UI helpers ────────────────────────────────────────────────────────────────────────────────

/** The innermost container that shows `label` AND holds a control (labels gain suffixes mid-form). */
const field = (page: Page, label: string) => page.locator('div')
  .filter({ hasText: label })
  .filter({ has: page.locator('input, textarea, [role="combobox"]') })
  .last();

async function chooseFromCombobox(page: Page, trigger: ReturnType<Page['locator']>, optionName: string) {
  await trigger.scrollIntoViewIfNeeded();
  await trigger.evaluate((el: HTMLElement) => el.click());
  const option = page.locator('[role="listbox"] [role="option"]', { hasText: optionName }).first();
  await expect(option).toBeVisible();
  // Radix portals its listbox; under mobile emulation a coordinate click on it is refused, so the
  // option is activated on the element. `toBeVisible` above proves the dropdown really opened.
  await option.evaluate((el: HTMLElement) => el.click());
}

const chooseField = (page: Page, label: string, option: string) =>
  chooseFromCombobox(page, field(page, label).getByRole('combobox'), option);

/**
 * Press a control after proving it is reachable.
 *
 * The Seller Studio is ~4700px tall at 393px wide. Playwright's own pre-click scroll under mobile
 * emulation repeatedly lands these controls at coordinates owned by another element. The hit-target
 * poll below IS the overlay guard — if a control were genuinely covered this never converges and the
 * test fails naming what is on top — and the press is then dispatched on the element, which still
 * runs the component's own handler.
 */
async function press(page: Page, locator: ReturnType<Page['locator']>, what: string) {
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate((el: HTMLElement) => {
    const se = document.scrollingElement!;
    se.scrollTop = Math.max(0, se.scrollTop + el.getBoundingClientRect().top - se.clientHeight / 2);
  });
  await expect.poll(async () => locator.evaluate((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    if (r.bottom > innerHeight || r.top < 0) return `outside-viewport(top=${Math.round(r.top)})`;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit) return 'nothing-at-centre';
    if (hit === el || el.contains(hit)) return 'ready';
    const id = (hit as HTMLElement).dataset?.testid;
    return `covered-by:${hit.tagName.toLowerCase()}${id ? `[${id}]` : ''}`;
  }), { message: `${what} must be reachable, not covered`, timeout: 15_000 }).toBe('ready');
  await locator.evaluate((el: HTMLElement) => el.click());
}

/** What the browser actually decoded inside `scope`. */
async function decoded(page: Page, scope: string) {
  await page.locator(scope).first().scrollIntoViewIfNeeded();
  return page.locator(scope).first().evaluate((root: HTMLElement) => {
    const img = root.querySelector('img') as HTMLImageElement | null;
    img?.scrollIntoView({ block: 'center' });
    return {
      hasImg: !!img,
      src: img?.currentSrc || img?.getAttribute('src') || null,
      naturalWidth: img?.naturalWidth ?? 0,
      naturalHeight: img?.naturalHeight ?? 0,
      clientWidth: img?.clientWidth ?? 0,
      clientHeight: img?.clientHeight ?? 0,
      placeholder: !!root.querySelector('[data-testid="listing-image-placeholder"]'),
      notLoaded: !!root.querySelector('[data-testid="owner-listing-media-not-loaded"]'),
      none: !!root.querySelector('[data-testid="owner-listing-media-none"]'),
    };
  });
}

/** The cover must be the seller-selected asset, decoded, unplaceheld, and occupying layout. */
async function expectCover(page: Page, scope: string, where: string) {
  await expect.poll(async () => (await decoded(page, scope)).naturalWidth, {
    message: `${where}: the cover must decode to the seller-selected asset`, timeout: 25_000,
  }).toBe(COVER.width);
  const shot = await decoded(page, scope);
  expect(shot.placeholder, `${where}: no "Image unavailable" placeholder`).toBe(false);
  expect(shot.notLoaded, `${where}: must not report "could not be loaded"`).toBe(false);
  expect(shot.none, `${where}: must not report "no photos added"`).toBe(false);
  expect(shot.naturalHeight, `${where}: decoded height identifies the asset`).toBe(COVER.height);
  expect(shot.clientWidth, `${where}: must occupy layout space`).toBeGreaterThan(0);
  expect(shot.clientHeight, `${where}: container must not be collapsed`).toBeGreaterThan(0);
  return shot;
}

/** The owner's gallery, read as ASSERTION EVIDENCE only — it performs no user action. */
async function ownerGallery(page: Page, VIN: string) {
  return page.evaluate(async (vin) => {
    const p = await (await fetch('/carup-provenance.json')).json();
    const r = await fetch(`${p.api_base_url}/api/vehicles/me`, {
      headers: { 'x-session-token': localStorage.getItem('carup_token') || '' },
    });
    const rows = await r.json();
    const mine = Array.isArray(rows) ? rows.find((v: { vin: string }) => v.vin === vin) : null;
    return { unpaired: p.unpaired, publication_status: mine?.publication_status, status: mine?.status, media: mine?.listing_media ?? null };
  }, VIN);
}

type Item = { photo_label: string; is_primary: boolean; seller_order: number; position: number };

/** The gallery is intact: three photos, labels on their own images, seller order, chosen cover. */
function expectGalleryIntact(media: { items?: Item[] } | null, where: string) {
  const items = media?.items ?? [];
  expect(items.length, `${where}: all three photographs remain`).toBe(3);
  expect([...items].sort((a, b) => a.seller_order - b.seller_order).map((i) => i.photo_label),
    `${where}: each label stays on its own image, in the seller's authored order`)
    .toEqual(PHOTOS.map((p) => p.label));
  expect(items.filter((i) => i.is_primary), `${where}: exactly one primary`).toHaveLength(1);
  const primary = items.find((i) => i.is_primary)!;
  expect(primary.photo_label, `${where}: the primary is still the seller's choice`).toBe(COVER.label);
  expect(primary.position, `${where}: the chosen cover leads the display order`).toBe(0);
}

// ──────────────────────────────────────────────────────────────────────────────────────────────

test.describe('Seller media continuity across the commerce lifecycle', () => {
  test.skip(!process.env.STAGING_UAT_REVIEWER_PASSWORD,
    'STAGING_UAT_REVIEWER_PASSWORD is not configured. Publishing requires a VERIFIED ownership '
    + 'document, and reviewer authority cannot be created from the public registration API — see '
    + 'backend/scripts/staging-create-test-identities.mjs. The draft half is covered unconditionally '
    + 'by web/e2e/seller-media-continuity.spec.ts.');

  test('the seller-selected cover survives publish, unpublish, republish and sold', async ({ page, request }, testInfo) => {
    test.slow();
    const VIN = vinFor(testInfo.project.name);
    testInfo.annotations.push({ type: 'vin', description: VIN });
    const password = process.env.STAGING_UAT_BUYER_PASSWORD;
    expect(password, 'STAGING_UAT_BUYER_PASSWORD is not configured').toBeTruthy();

    // ── sign in through the UI ────────────────────────────────────────────────────────────────
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('email-input').fill(SELLER_EMAIL);
    await page.getByTestId('password-input').fill(password!);
    await page.getByTestId('login-button').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

    // ── build the listing through the Seller Studio ───────────────────────────────────────────
    await page.goto('/dashboard/sell-vehicle', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('vehicle-make-input').fill('Toyota');
    await page.getByTestId('vehicle-model-input').fill('Hilux');
    await page.getByTestId('vehicle-vin-input').fill(VIN);

    // A complete VIN starts the existing-Passport check, and step validation refuses to advance
    // while it is in flight. Wait for the product's own settled state, never a timeout.
    await expect(page.getByTestId('sell-vin-identification-checking')).toHaveCount(0);
    await expect(page.locator(
      '[data-testid="sell-vin-no-carup-record"], [data-testid="sell-vin-check-unavailable"], [data-testid="sell-vin-passport-exists"]',
    ).first()).toBeVisible();

    await chooseField(page, 'Year *', '2019');
    await field(page, 'Color *').getByRole('combobox').fill('Silver');
    await field(page, 'Engine Number').getByRole('textbox').fill(`1GD-${RUN_ID}`.slice(0, 18));
    await field(page, 'Chassis Number').getByRole('textbox').fill(`ZW${VIN_SAFE(RUN_ID)}`.slice(0, 18));
    await field(page, 'Number Plate').getByRole('textbox').fill('AML 4201');
    await press(page, page.getByRole('button', { name: 'Next', exact: true }), 'Next (stage 1)');

    await field(page, 'Mileage (km) *').getByRole('spinbutton').fill('78450');
    await chooseField(page, 'Condition *', 'Used');
    await chooseField(page, 'Body style *', 'Pickup');
    await chooseField(page, 'Fuel Type *', 'Diesel');
    await chooseField(page, 'Transmission *', 'Automatic');
    await chooseFromCombobox(page, page.getByTestId('vehicle-currency-input'), 'USD — US Dollar');
    await field(page, 'Price *').getByRole('spinbutton').fill('24500');
    await chooseField(page, 'Location *', 'Harare');
    await chooseFromCombobox(page, page.getByTestId('listing-location-visibility'), 'Show my city and province');
    await page.getByTestId('seller-description-input').fill(
      `Media lifecycle candidate ${RUN_ID}. Three distinguishable photographs prove the seller's `
      + 'chosen cover survives publish, unpublish, republish and retirement.',
    );
    await press(page, page.getByRole('button', { name: 'Next', exact: true }), 'Next (stage 2)');

    // ── three REAL uploads, cover = the SECOND, labels on each ────────────────────────────────
    const chooser = page.waitForEvent('filechooser');
    await page.getByText('Click to upload photos').click();
    (await chooser).setFiles(PHOTOS.map((p) => FIXTURES + p.file));
    await expect(page.getByText(`Vehicle Images (${PHOTOS.length}/15)`)).toBeVisible();
    await press(page, page.getByTestId('listing-media-choose-cover-1'), 'choose cover');
    for (const [index, photo] of PHOTOS.entries()) {
      await chooseFromCombobox(page, page.getByRole('combobox', { name: `Photo ${index + 1} angle or view` }), photo.label);
    }
    await press(page, page.getByRole('button', { name: 'Next', exact: true }), 'Next (stage 3)');

    await expect(page.getByText('3 image(s) attached')).toBeVisible();
    await press(page, page.getByTestId('submit-vehicle-button'), 'Save as Draft');
    await expect(page.getByTestId('submit-vehicle-button')).toHaveCount(0, { timeout: 60_000 });

    // ── the draft already shows the seller's cover to its owner ───────────────────────────────
    await page.goto('/dashboard/listings', { waitUntil: 'domcontentloaded' });
    const draftShot = await expectCover(page, `[data-testid="my-listing-card-${VIN}"]`, 'My Listings (draft)');
    const draft = await ownerGallery(page, VIN);
    expect(draft.unpaired, 'evidence must come from the paired exact head').toBe(false);
    expect(draft.publication_status).toBe('draft');
    expectGalleryIntact(draft.media, 'draft');

    // ── the publication gate is REAL: refuse before the ownership document is verified ─────────
    await press(page, page.getByRole('button', { name: 'Publish to Marketplace' }), 'Publish (refused)');
    await expect(page.getByText(/Ownership \/ Registration Document|not publishable|blocking/i).first())
      .toBeVisible({ timeout: 20_000 });
    expect((await ownerGallery(page, VIN)).publication_status,
      'a refused publish must leave the listing a draft').toBe('draft');

    // ── upload the ownership document through the Evidence UI ─────────────────────────────────
    await page.goto(`/dashboard/garage/${VIN}?upload=1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#evidence-type')).toBeVisible({ timeout: 20_000 });
    await page.locator('#evidence-type').selectOption({ label: 'Registration Document (PDF/Image)' });
    await page.locator('#visibility').selectOption({ index: 1 });
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURES + PHOTOS[0].file);
    await press(page, page.getByRole('button', { name: 'Submit Evidence' }), 'Submit Evidence');

    // ── the ONE permitted API step: a back-office reviewer with no seller UI ──────────────────
    const reviewer = await reviewerAuth(request);
    const reviewerHeaders = await mutationHeaders(request, reviewer);
    const listed = await request.get(`${API_URL}/vehicles/${VIN}/evidence`, { headers: reviewerHeaders });
    expect(listed.status(), await listed.text()).toBe(200);
    const rows = await listed.json() as Array<{ id: string; evidence_type: string }>;
    const ownership = rows.find((r) => /registration|ownership/i.test(r.evidence_type));
    expect(ownership?.id, 'the seller\'s UI upload must have produced a governed evidence row').toBeTruthy();
    const verified = await request.patch(`${API_URL}/vehicles/${VIN}/evidence/${ownership!.id}/verify`, {
      headers: reviewerHeaders,
      data: { notes: `Media lifecycle ${RUN_ID}`, trust_score_impact: 3 },
    });
    expect(verified.status(), await verified.text()).toBe(200);

    // ── PUBLISH from the Seller UI ────────────────────────────────────────────────────────────
    await page.goto('/dashboard/listings', { waitUntil: 'domcontentloaded' });
    await press(page, page.getByRole('button', { name: 'Publish to Marketplace' }), 'Publish');
    await expect.poll(async () => (await ownerGallery(page, VIN)).publication_status,
      { message: 'the listing must reach published', timeout: 40_000 }).toBe('published');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const publishedShot = await expectCover(page, `[data-testid="my-listing-card-${VIN}"]`, 'My Listings (published)');
    expect(publishedShot.src, 'publishing must not change which asset is the cover').toBe(draftShot.src);

    // ── the public Marketplace card and detail show the SAME cover ────────────────────────────
    await page.goto(`/marketplace?q=${VIN}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(VIN).first()).toBeVisible({ timeout: 30_000 });
    // The grid has no per-card testid keyed by VIN, so the card is addressed by the link it carries
    // to its own detail page — verified against MarketplaceListingCard rather than guessed.
    const cardShot = await expectCover(page, `a[href*="${VIN}"]`, 'Marketplace card');
    expect(cardShot.src, 'the buyer sees the seller-chosen cover').toBe(draftShot.src);

    await page.goto(`/marketplace/${VIN}`, { waitUntil: 'domcontentloaded' });
    await expectCover(page, 'main', 'Marketplace Vehicle Detail');

    // ── UNPUBLISH: public disappears, owner media remains ─────────────────────────────────────
    await page.goto('/dashboard/listings', { waitUntil: 'domcontentloaded' });
    await press(page, page.getByRole('button', { name: /Unpublish/i }), 'Unpublish');
    await expect.poll(async () => (await ownerGallery(page, VIN)).publication_status,
      { message: 'unpublish must return the listing to publishable', timeout: 40_000 }).not.toBe('published');

    const afterUnpublish = await ownerGallery(page, VIN);
    expectGalleryIntact(afterUnpublish.media, 'after unpublish');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectCover(page, `[data-testid="my-listing-card-${VIN}"]`, 'My Listings (unpublished — owner still sees it)');

    // The public gate is what actually changed. Owner visibility was NOT bought by weakening it.
    const publicAfterUnpublish = await request.get(`${API_URL}/vehicles/${VIN}/details`);
    expect(publicAfterUnpublish.status(), 'an unpublished listing must leave the public surface').toBe(404);

    // ── REPUBLISH: the same cover, gallery, order and labels return ───────────────────────────
    await press(page, page.getByRole('button', { name: 'Publish to Marketplace' }), 'Republish');
    await expect.poll(async () => (await ownerGallery(page, VIN)).publication_status,
      { message: 'republish must reach published', timeout: 40_000 }).toBe('published');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const republished = await expectCover(page, `[data-testid="my-listing-card-${VIN}"]`, 'My Listings (republished)');
    expect(republished.src, 'republishing restores the same cover asset').toBe(draftShot.src);
    expectGalleryIntact((await ownerGallery(page, VIN)).media, 'after republish');

    // ── SOLD / RETIRED: commerce exits, the owner's durable media does not ────────────────────
    page.once('dialog', (d) => d.accept());
    await press(page, page.getByRole('button', { name: /Mark sold/i }), 'Mark sold');
    await expect.poll(async () => (await ownerGallery(page, VIN)).status,
      { message: 'the vehicle must reach a sold state', timeout: 40_000 }).toMatch(/sold/i);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectCover(page, `[data-testid="my-listing-card-${VIN}"]`, 'My Listings (sold — historical owner view)');
    expectGalleryIntact((await ownerGallery(page, VIN)).media, 'after sold');

    const publicAfterSold = await request.get(`${API_URL}/vehicles/${VIN}/details`);
    expect(publicAfterSold.status(), 'a sold vehicle must exit active public commerce').toBe(404);

    // AVAILABILITY AND PUBLICATION ARE TWO AXES, and retirement moves only one of them.
    //
    // `publication_status` deliberately STAYS 'published' after mark-sold: the status PATCH writes
    // `{status}` alone — asserted independently in
    // backend/tests/r27-durable-history-survives-commerce.test.js — and the record that this listing
    // was once published is itself durable history. What removes it from the public surface is
    // `isPublicVehicleStatus('Sold') === false`, which the 404 above proves and which the workflow's
    // own contamination audit re-proves from the marketplace query.
    //
    // An earlier version of this test demanded `publication_status !== 'published'` here. That was
    // asserting the opposite of the verified contract, and it is recorded rather than quietly
    // deleted because "the test was wrong" is the finding.
    const retired = await ownerGallery(page, VIN);
    expect(retired.status, 'availability carries the retirement').toMatch(/sold/i);
    expect(retired.publication_status, 'publication history is not rewritten by retirement').toBe('published');
  });
});
