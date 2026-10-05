/**
 * 48 — Seller Home, Communications and the commerce lifecycle: deployed staging, exact head.
 * OC-5F slice F (ported from PR #213: b1abe55f, e315a40d, 56a8e2b2, 8685a499).
 *
 * #213 proved three things by EDITING certified spec 38. A certified gate is never edited, and #213's
 * copy of spec 38 would also have reverted three later fixes on this lineage (the per-run Golden
 * Seller, teardown outside the journey's budget, the 7-day Intelligence window). The phases land
 * here, in a sibling:
 *
 *   P · Home. Ordinary Home never shows Seller automation. The run's own preview fixture scope proves
 *       the SAME Home inventory card renders the newly published listing with the Seller's chosen
 *       cover, and, when the listing is the hero, the hero renders that cover, not the fallback.
 *   R · The commerce lifecycle. Unpublish withdraws the listing from Marketplace AND Home; republish
 *       brings it back to both; sold retires it; the Passport survives commerce; and retirement moves
 *       availability only, never the publication history (R27).
 *   Q · Communications: inquiry -> canonical thread -> Seller reply. AUTHORED, NOT RUN (`fixme`).
 *       A guest inquiry defaults to WhatsApp (InquiryModal), and a reply is delivered on the buyer's
 *       primary binding. As #213 wrote it, with a real-format phone, the Seller's reply would be a REAL
 *       WhatsApp message. The reply path is #213's slice D (ab9cc0e7), an owner decision. Until D is
 *       decided this test stays `fixme`. When it is enabled, its inquiry is email-only to a reserved
 *       `.test` address and never carries a phone (pinned by backend/tests/oc5f-seller-home-gate.test.js).
 *
 * Isolation, each part load-bearing:
 *   - Its OWN config (playwright.staging.seller-home.config.ts) and workflow
 *     (seller-home-lifecycle-staging-uat.yml). The shared playwright.staging.config.ts testMatch is run
 *     WHOLE by the aggregate Diaspora gates, whose chromium shard measured ~29.7 of its 35 minutes.
 *     Adding this journey there would change what certified gates run.
 *   - Its OWN Seller, per run and per viewport (scripts/ci/golden-seller-identity.mjs). Spec 38's stale
 *     sweep retires every older automation vehicle that ITS Seller holds, so on a shared Seller this
 *     spec's listing could be retired mid-journey.
 *   - The reserved automation marker (`Golden Dynamic Seller <seller-run-attempt>:`) is REQUIRED, not
 *     decoration. It is what keeps the listing off ordinary discovery, and exactly what the
 *     preview-only `fixture_scope` reveals (listingSummaryService.filterVisibleVehicles).
 *
 * Evidence level: SOURCE (typechecked, collected, pinned). It has never run: OC-5 deploys nothing to
 * staging while staging identity is unresolved. Running it is a step of the RC2 runbook.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  stagingTest as test,
  expect,
  signInViaUi,
  requireIdentity,
  withRateLimitRetry,
  IDENTITIES,
  API_URL,
  RUN_ID,
} from './staging-helpers';

interface SessionAuth {
  token: string;
  user: { id: string; role: string; [key: string]: unknown };
}

interface ListingFixture { vin: string; auth: SessionAuth | null; created: boolean }

interface OwnedVehicle { vin?: string; status?: string | null; publication_status?: string | null }

/** The reserved Seller automation marker — see the header. */
const AUTOMATION_MARKER = `Golden Dynamic Seller ${RUN_ID}:`;

/** golden-seller-identity.mjs's viewport names. */
const PROJECT_SHORT: Record<string, string> = {
  chromium: 'chromium',
  'tablet-chromium': 'tablet',
  'mobile-chromium': 'mobile',
};

// Each fixture has a unique natural size, so `naturalWidth` names WHICH asset the browser decoded.
const FIXTURES = fileURLToPath(new URL('../../web/e2e/fixtures/seller-media/', import.meta.url));
const PHOTOS = [
  { file: 'photo-a-front-320x200.png', label: 'Front three-quarter', width: 320, height: 200 },
  { file: 'photo-b-odometer-360x220.png', label: 'Odometer', width: 360, height: 220 },
  { file: 'photo-c-damage-400x240.png', label: 'Any known damage', width: 400, height: 240 },
] as const;
/** The SECOND upload, so a surface that renders items[0] fails instead of passing by coincidence. */
const COVER_INDEX = 1;
const COVER = PHOTOS[COVER_INDEX];

// Evidence transport only needs a valid image document; it is not a visual fixture.
const EVIDENCE_TEST_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlYV1sAAAAASUVORK5CYII=';

/** A VIN excludes I, O and Q. */
const VIN_SAFE = (value: string) => value.toUpperCase().replace(/[IOQ]/g, 'X').replace(/[^A-HJ-NPR-Z0-9]/g, '0');

/**
 * `JTHL` + family + viewport + run: 17 characters. Unique per viewport (the three projects share one
 * RUN_ID) and per run (the changing end of the run id stays inside the VIN). `C` is the lifecycle
 * journey's vehicle, `M` the Communications journey's. The workflow's sweep recognises `JTHL`.
 */
function vinFor(project: string, family: 'C' | 'M'): string {
  const projectToken = VIN_SAFE(project.slice(0, 3)).padEnd(3, 'X').slice(0, 3);
  const runToken = RUN_ID.replace(/\D/g, '').slice(-9).padStart(9, '0');
  return `JTHL${family}${projectToken}${runToken}`;
}

function envTruthMode(): string | undefined {
  return (JSON.parse(readFileSync('test-results/staging-env-truth.json', 'utf8')) as { mode?: string }).mode;
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
  const response = await withRateLimitRetry(() => request.get(`${API_URL}/security/csrf-token`, { headers }), 'CSRF token');
  expect(response.status(), 'CSRF token endpoint refused the staging identity').toBe(200);
  const body = await response.json() as { csrfToken?: string };
  expect(body.csrfToken, 'CSRF token response omitted csrfToken').toBeTruthy();
  return { ...headers, 'x-csrf-token': body.csrfToken! };
}

/** Review is a separate authority, through the real login + CSRF path (no seller UI exists for it). */
async function reviewerAuth(request: APIRequestContext): Promise<SessionAuth> {
  const password = process.env[IDENTITIES.reviewer.envPassword];
  expect(password, `${IDENTITIES.reviewer.envPassword} is not configured`).toBeTruthy();
  const csrf = await withRateLimitRetry(() => request.get(`${API_URL}/security/csrf-token`), 'guest CSRF token');
  expect(csrf.status(), 'guest CSRF token request failed before reviewer login').toBe(200);
  const { csrfToken } = await csrf.json() as { csrfToken?: string };
  const response = await withRateLimitRetry(() => request.post(`${API_URL}/auth/login`, {
    headers: { 'x-csrf-token': csrfToken! },
    data: { email: IDENTITIES.reviewer.email, password },
  }), 'reviewer login');
  expect(response.status(), `reviewer staging login failed: ${await response.text()}`).toBe(200);
  const body = await response.json() as { token?: string; user?: SessionAuth['user'] };
  expect(body.user?.role, 'the reviewer identity must actually hold review authority').toBe('admin');
  return { token: body.token!, user: body.user! };
}

/** The fixture as a data URI — the same payload Seller Studio sends to `/media/upload/vehicle`. */
const asDataUri = (file: string) => `data:image/png;base64,${readFileSync(FIXTURES + file).toString('base64')}`;

/**
 * A fresh listing, published through the contracts spec 38 certifies: media, create, the publication
 * gate REFUSING, ownership evidence, a reviewer's verification, and publish from the Seller UI. The
 * fixture is recorded in `state` the moment it exists, so teardown retires it even if a later step
 * fails.
 */
async function publishFreshListing(page: Page, request: APIRequestContext, state: ListingFixture): Promise<void> {
  const { vin } = state;
  await signInViaUi(page, 'goldenSeller');
  await expect(page.locator('body')).not.toContainText(/permission denied|42501/i);
  const seller = await authFromPage(page);
  state.auth = seller;
  expect(seller.user.role).toBe('owner');
  const headers = await mutationHeaders(request, seller);

  const media = await withRateLimitRetry(() => request.post(`${API_URL}/media/upload/vehicle`, {
    headers,
    data: { vin, images: PHOTOS.map((photo) => asDataUri(photo.file)) },
  }), 'listing media upload');
  expect(media.status(), await media.text()).toBe(200);
  const { urls } = await media.json() as { urls?: string[] };
  expect(urls).toHaveLength(PHOTOS.length);

  const created = await request.post(`${API_URL}/vehicles/add`, {
    headers,
    data: {
      client_submission_id: randomUUID(),
      vin,
      make: 'Toyota',
      model: 'Hilux',
      year: 2020,
      color: 'Silver',
      mileage: 61_000,
      fuel_type: 'Diesel',
      transmission: 'Automatic',
      drivetrain: '4WD',
      condition: 'Used',
      seller_stated_condition: 'Used',
      category: 'Pickup',
      body_style: 'Pickup',
      description: `${AUTOMATION_MARKER} OC-5F Home and lifecycle fixture (spec 48), staging only.`,
      features: ['Reverse camera'],
      price: 26_500,
      currency: 'USD',
      location: 'Harare',
      province: 'Harare',
      listing_country: 'ZW',
      registration_country: 'ZW',
      location_visibility: 'public',
      public_seller_display_enabled: false,
      engine_number: `ENG-${vin.slice(4)}`,
      chassis_number: `CHS-${vin.slice(4)}`,
      plate_number: `HLC${vin.slice(-3)}`,
      import_status: 'locally_registered',
      images: urls!.map((url, index) => ({
        url,
        photo_label: PHOTOS[index].label,
        is_primary: index === COVER_INDEX,
      })),
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  state.created = true;
  const draft = await created.json() as {
    publication_status?: string;
    images_recorded_count?: number;
    images_unpublishable_count?: number;
  };
  expect(draft.publication_status).toBe('draft');
  expect(draft.images_recorded_count).toBe(PHOTOS.length);
  expect(draft.images_unpublishable_count).toBe(0);

  // The publication gate is real: refused while the ownership evidence is absent.
  const refused = await request.post(`${API_URL}/vehicles/${vin}/publish`, { headers, data: {} });
  expect(refused.status(), 'a draft published without verified ownership evidence').toBe(400);
  expect(JSON.stringify(await refused.json())).toMatch(/seller_authority|Seller authority/i);

  const evidence = await request.post(`${API_URL}/vehicles/${vin}/evidence/upload`, {
    headers,
    data: {
      evidence_type: 'registration_document',
      file: EVIDENCE_TEST_PNG,
      visibility_level: 'restricted',
      verification_notes: `${AUTOMATION_MARKER} registration evidence`,
    },
  });
  expect(evidence.status(), await evidence.text()).toBe(201);
  const { id: evidenceId } = await evidence.json() as { id?: string };
  expect(evidenceId).toBeTruthy();

  const reviewer = await reviewerAuth(request);
  const verified = await request.patch(`${API_URL}/vehicles/${vin}/evidence/${evidenceId}/verify`, {
    headers: await mutationHeaders(request, reviewer),
    data: { notes: `${AUTOMATION_MARKER} verified`, trust_score_impact: 3 },
  });
  expect(verified.status(), await verified.text()).toBe(200);

  await page.goto('/dashboard/listings');
  await expect(page.getByTestId(`my-listing-card-${vin}`)).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(`publish-toggle-${vin}`).click();
  await expect(page.getByTestId(`publication-badge-${vin}`)).toContainText('Published', { timeout: 20_000 });
}

/** Back on My Listings as this run's Seller, through the real login UI. */
async function asSeller(page: Page, state: ListingFixture): Promise<void> {
  await signInViaUi(page, 'goldenSeller');
  state.auth = await authFromPage(page);
  await page.goto('/dashboard/listings');
  await expect(page.getByTestId(`my-listing-card-${state.vin}`)).toBeVisible({ timeout: 20_000 });
}

/** Drop the Seller's session, so what follows is what a member of the public sees. */
async function asPublic(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.clear());
}

const linksTo = (scope: Locator | Page, vin: string) => scope.locator(`a[href^="/marketplace/${vin}"]`);

/**
 * Home's live inventory once its read has SETTLED. Before that an "absent" assertion is vacuous, and
 * after an unavailable read it is too — so both fail here instead of passing below.
 */
async function settledHome(page: Page, { scoped }: { scoped: boolean }): Promise<Locator> {
  await page.goto(scoped ? `/?fixture_scope=${encodeURIComponent(RUN_ID)}` : '/');
  const inventory = page.getByTestId('home-live-inventory');
  await expect(inventory).toBeVisible({ timeout: 20_000 });
  await expect(inventory.getByTestId('featured-loading')).toHaveCount(0, { timeout: 20_000 });
  await expect(inventory.getByTestId('featured-unavailable'), 'Home could not read live inventory, so absence would prove nothing')
    .toHaveCount(0);
  return inventory;
}

/** The Marketplace, searched for this VIN inside this run's scope, settled on an exact count. */
async function expectMarketplaceCount(page: Page, vin: string, count: 0 | 1): Promise<void> {
  await page.goto(`/marketplace?q=${encodeURIComponent(vin)}&fixture_scope=${encodeURIComponent(RUN_ID)}`);
  // Digit-bounded: "10 published listings" must not satisfy a count of 0.
  const settled = count === 1 ? /(?<!\d)1 published listing(?!s)/ : /(?<!\d)0 published listings/;
  await expect(page.getByTestId('marketplace-results-count')).toContainText(settled, { timeout: 20_000 });
  if (count === 1) await expect(linksTo(page, vin).first()).toBeVisible();
  else await expect(linksTo(page, vin)).toHaveCount(0);
}

/** What the browser actually decoded inside `root`. */
async function decodedImage(root: Locator) {
  await root.scrollIntoViewIfNeeded();
  return root.evaluate((node: HTMLElement) => {
    const img = (node.tagName === 'IMG' ? node : node.querySelector('img')) as HTMLImageElement | null;
    img?.scrollIntoView({ block: 'center' });
    return {
      naturalWidth: img?.naturalWidth ?? 0,
      naturalHeight: img?.naturalHeight ?? 0,
      clientWidth: img?.clientWidth ?? 0,
      clientHeight: img?.clientHeight ?? 0,
      placeholder: Boolean(node.querySelector('[data-testid="listing-image-placeholder"]')),
    };
  });
}

/** The Seller's chosen cover, decoded: its natural size names the asset, not merely "an image". */
async function expectCover(root: Locator, where: string): Promise<void> {
  await expect.poll(async () => (await decodedImage(root)).naturalWidth, {
    message: `${where}: the cover must decode to the Seller's chosen asset`,
    timeout: 25_000,
  }).toBe(COVER.width);
  const shot = await decodedImage(root);
  expect(shot.naturalHeight, `${where}: the decoded height identifies the asset`).toBe(COVER.height);
  expect(shot.placeholder, `${where}: no "Image unavailable" placeholder`).toBe(false);
  expect(shot.clientWidth, `${where}: the image occupies layout`).toBeGreaterThan(0);
  expect(shot.clientHeight, `${where}: the image is not collapsed`).toBeGreaterThan(0);
}

async function ownedVehicle(request: APIRequestContext, auth: SessionAuth, vin: string): Promise<OwnedVehicle | undefined> {
  const response = await withRateLimitRetry(() => request.get(`${API_URL}/vehicles/me`, { headers: baseHeaders(auth) }), 'owned vehicles');
  expect(response.status(), 'could not read the Seller\'s own vehicles').toBe(200);
  return (await response.json() as OwnedVehicle[]).find((vehicle) => vehicle.vin === vin);
}

/** Radix portals its listbox; under mobile emulation a coordinate click on it is refused. */
async function chooseFromSelect(page: Page, trigger: Locator, optionName: RegExp): Promise<void> {
  await trigger.scrollIntoViewIfNeeded();
  await trigger.evaluate((element: HTMLElement) => element.click());
  const option = page.locator('[role="listbox"] [role="option"]').filter({ hasText: optionName }).first();
  await expect(option).toBeVisible();
  await expect(option, 'the option must be offered, not disabled as unavailable').not.toHaveAttribute('aria-disabled', 'true');
  await option.evaluate((element: HTMLElement) => element.click());
}

/**
 * Teardown, with its own budget. A fixture still in commerce (published, not sold: the journey
 * stopped early) is retired the way the Seller would retire it. A fixture the journey already sold is
 * left exactly as it is: its publication history is durable (R27), and unpublishing it would rewrite
 * that history. A draft was never public, and its Seller is never reused. In every case the listing
 * must not be discoverable, asked WITH the run's scope — ordinary discovery never shows a marked
 * fixture, so asking without the scope would prove nothing.
 */
async function retireFixture(request: APIRequestContext, state: ListingFixture): Promise<void> {
  const auth = state.auth!;
  const vehicle = await ownedVehicle(request, auth, state.vin);
  if (vehicle?.publication_status === 'published' && !/^sold$/i.test(String(vehicle.status || ''))) {
    const headers = await mutationHeaders(request, auth);
    const unpublish = await withRateLimitRetry(() => request.post(`${API_URL}/vehicles/${state.vin}/unpublish`, { headers, data: {} }), 'teardown unpublish');
    expect(unpublish.status(), `teardown could not unpublish ${state.vin}: ${await unpublish.text()}`).toBe(200);
    const sold = await withRateLimitRetry(() => request.patch(`${API_URL}/vehicles/${state.vin}/status`, { headers, data: { status: 'sold' } }), 'teardown retire');
    expect(sold.status(), `teardown could not retire ${state.vin}: ${await sold.text()}`).toBe(200);
  }
  const discovery = await withRateLimitRetry(() => request.get(
    `${API_URL}/marketplace/listings?q=${encodeURIComponent(state.vin)}&fixture_scope=${encodeURIComponent(RUN_ID)}`,
  ), 'teardown discovery');
  expect(discovery.status(), await discovery.text()).toBe(200);
  const body = await discovery.json() as { listings?: Array<{ vin?: string }> };
  expect((body.listings || []).some((listing) => listing.vin === state.vin),
    `${state.vin} is still discoverable inside its own run scope after teardown`).toBe(false);
}

/** Carries the run's fixture to `afterEach`, so teardown is never inside the journey's budget. */
let cleanupState: ListingFixture | null = null;

/** Every journey runs as THIS run's, THIS viewport's own Seller — never a shared account. */
function requireOwnSeller(project: string): void {
  const match = /^seller-(\d+)-(\d+)$/.exec(RUN_ID);
  expect(match, `the preview fixture scope only honours seller-<run>-<attempt>; got ${RUN_ID}`).not.toBeNull();
  const expected = `golden.seller.${match![1]}-${match![2]}-${PROJECT_SHORT[project]}@carup-staging.test`;
  expect(IDENTITIES.goldenSeller.email, 'spec 48 must run as this run\'s own per-viewport Seller').toBe(expected);
  expect(requireIdentity('goldenSeller'), 'the per-run Seller has no credential').toBe(true);
  expect(requireIdentity('reviewer'), 'the reviewer identity has no credential').toBe(true);
}

test.describe('Seller Home, Communications and the commerce lifecycle — exact-head deployed acceptance (OC-5F)', () => {
  test('P+R: Home shows the listing only inside its run scope; unpublish, republish and sold move it on Marketplace and Home', async ({ page, request }, testInfo) => {
    // Spec 38 measured ~288s for a longer journey; this one omits its studio, gallery and Intelligence
    // phases, and adds two Home reads and two Marketplace reads per lifecycle step.
    test.setTimeout(420_000);
    expect(envTruthMode(), 'not pinned to the frozen exact-head bundle').toBe('acceptance');
    requireOwnSeller(testInfo.project.name);

    const vin = vinFor(testInfo.project.name, 'C');
    testInfo.annotations.push({ type: 'vin', description: vin });
    const state: ListingFixture = { vin, auth: null, created: false };
    cleanupState = state;
    await publishFreshListing(page, request, state);

    // ── P · Home ──────────────────────────────────────────────────────────────────────────────────
    // Ordinary Home: automation never reaches a human surface — not the inventory, not the hero.
    await asPublic(page);
    await settledHome(page, { scoped: false });
    await expect(linksTo(page, vin), 'ordinary Home must never show Seller automation').toHaveCount(0);

    // The run's own preview scope: the SAME Home inventory card renders this listing, with its cover.
    const scopedInventory = await settledHome(page, { scoped: true });
    const card = scopedInventory.getByTestId('featured-verified-car').filter({ has: linksTo(page, vin) });
    await expect(card, 'the published listing must reach Home inside its run scope').toHaveCount(1, { timeout: 20_000 });
    await expectCover(card, 'Home live-inventory card');

    // The hero is the newest listing with renderable media. Inside the scope that is normally this
    // listing; if a human published one meanwhile it is theirs. Recorded either way, never silent.
    const hero = page.getByTestId('featured-view-passport');
    const heroIsOurs = (await hero.getAttribute('href'))?.startsWith(`/marketplace/${vin}`) ?? false;
    testInfo.annotations.push({ type: 'home-hero', description: heroIsOurs ? `hero is ${vin}` : 'hero is another listing; hero branch not exercised' });
    if (heroIsOurs) {
      await expect(page.getByTestId('home-live-showroom-media-fallback')).toHaveCount(0);
      await expectCover(hero, 'Home hero');
    }
    await page.screenshot({ path: testInfo.outputPath(`phase-p-home-published-${testInfo.project.name}.png`), fullPage: true });

    // ── R · unpublish withdraws it from Marketplace AND Home ──────────────────────────────────────
    await asSeller(page, state);
    await page.getByTestId(`publish-toggle-${vin}`).click();
    await expect(page.getByTestId(`publication-badge-${vin}`)).toContainText('Ready to publish', { timeout: 20_000 });

    await asPublic(page);
    await expectMarketplaceCount(page, vin, 0);
    await settledHome(page, { scoped: true });
    await expect(linksTo(page, vin), 'an unpublished listing must leave Home, even inside its scope').toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`phase-r-home-unpublished-${testInfo.project.name}.png`), fullPage: true });

    // ── R · republish returns it to both ─────────────────────────────────────────────────────────
    await asSeller(page, state);
    await page.getByTestId(`publish-toggle-${vin}`).click();
    await expect(page.getByTestId(`publication-badge-${vin}`)).toContainText('Published', { timeout: 20_000 });

    await asPublic(page);
    await expectMarketplaceCount(page, vin, 1);
    const republishedInventory = await settledHome(page, { scoped: true });
    const republishedCard = republishedInventory.getByTestId('featured-verified-car').filter({ has: linksTo(page, vin) });
    await expect(republishedCard, 'a republished listing must return to Home').toHaveCount(1, { timeout: 20_000 });
    await expectCover(republishedCard, 'Home live-inventory card (republished)');

    // ── R · sold retires it; the Passport survives commerce ───────────────────────────────────────
    // Only after the republished listing has been independently rediscovered.
    await asSeller(page, state);
    await page.getByTestId(`mark-sold-${vin}`).click();
    await expect(page.getByTestId(`my-listing-card-${vin}`)).toContainText(/Sold/i, { timeout: 20_000 });
    await expect(page.getByTestId(`publish-toggle-${vin}`), 'a sold listing offers no publication control').toHaveCount(0);

    await page.goto(`/dashboard/garage/${vin}`);
    await expect(page.locator('body')).toContainText(vin, { timeout: 20_000 });
    await expect(page.locator('body')).toContainText(/Vehicle Passport|Passport/i);

    await asPublic(page);
    await expectMarketplaceCount(page, vin, 0);
    await settledHome(page, { scoped: true });
    await expect(linksTo(page, vin), 'a sold listing must leave Home, even inside its scope').toHaveCount(0);

    // Availability and publication are two axes; retirement moves only availability (R27).
    const retired = await ownedVehicle(request, state.auth!, vin);
    expect(retired?.status, 'availability carries the retirement').toMatch(/sold/i);
    expect(retired?.publication_status, 'retirement does not rewrite the publication history').toBe('published');
  });

  // ── Q · Communications — AUTHORED, NOT RUN ─────────────────────────────────────────────────────
  // Blocked on owner decision D (#213 ab9cc0e7, the production inquiry path). As #213 wrote it, with a
  // real-format phone and the default preference, the Seller's reply below is a REAL WhatsApp message.
  // Re-enable only after D is decided. Its inquiry is email-only, to a reserved `.test` address.
  test.fixme('Q: a Marketplace inquiry becomes a canonical Communications thread the Seller answers in CarUp', async ({ page, request }, testInfo) => {
    test.setTimeout(420_000);
    expect(envTruthMode(), 'not pinned to the frozen exact-head bundle').toBe('acceptance');
    requireOwnSeller(testInfo.project.name);

    const vin = vinFor(testInfo.project.name, 'M');
    testInfo.annotations.push({ type: 'vin', description: vin });
    const state: ListingFixture = { vin, auth: null, created: false };
    cleanupState = state;
    await publishFreshListing(page, request, state);

    // A real guest buyer, email only. NEVER a phone: with a phone, the default preference binds the
    // buyer's WhatsApp, and the Seller's reply below would be delivered there.
    await asPublic(page);
    await page.goto(`/marketplace/${vin}?fixture_scope=${encodeURIComponent(RUN_ID)}`);
    await page.getByTestId('marketplace-inquiry-open').first().click();
    await expect(page.getByTestId('marketplace-inquiry-modal')).toBeVisible();
    await page.getByTestId('marketplace-inquiry-name').fill('Seller Home Lifecycle Buyer');
    await page.getByTestId('marketplace-inquiry-email').fill(`seller-home-${vin.toLowerCase()}@example.test`);
    await chooseFromSelect(page, page.getByTestId('marketplace-inquiry-preferred-contact'), /^Email$/);
    await expect(page.getByTestId('marketplace-inquiry-preferred-contact')).toContainText(/^Email$/);
    await expect(page.getByTestId('marketplace-inquiry-phone'), 'the inquiry must carry no phone').toHaveValue('');
    const question = `Is ${vin} still available for inspection?`;
    await page.getByTestId('marketplace-inquiry-message').fill(question);
    const inquiryWait = page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes('/api/marketplace/inquiries'));
    await page.getByTestId('marketplace-inquiry-submit').click();
    expect([200, 201]).toContain((await inquiryWait).status());
    await expect(page.getByTestId('marketplace-inquiry-modal')).toHaveCount(0, { timeout: 15_000 });

    // The durable inquiry is only the ingress; the canonical thread is an asynchronous projection.
    // A bounded poll that FAILS rather than accepting an inbox-only state.
    await asSeller(page, state);
    let threadId: string | null = null;
    await expect.poll(async () => {
      const response = await request.get(`${API_URL}/communications/threads`, { headers: baseHeaders(state.auth!) });
      if (response.status() !== 200) return 0;
      const body = await response.json() as { threads?: Array<{ id?: string; marketplace_listing_id?: string | null }> };
      const thread = (body.threads || []).find((item) => String(item.marketplace_listing_id || '').toUpperCase() === vin);
      threadId = thread?.id || null;
      return threadId ? 1 : 0;
    }, {
      message: 'the Marketplace inquiry never projected into a canonical Communications thread',
      timeout: 90_000,
      intervals: [1000, 2000, 5000],
    }).toBe(1);

    await page.goto('/dashboard/communications');
    await page.getByTestId('communication-search').fill(vin);
    const thread = page.locator(`button[data-marketplace-listing-id="${vin}"]`).first();
    await expect(thread).toBeVisible({ timeout: 20_000 });
    await thread.click();
    await expect(page.getByTestId('communication-active-listing')).toContainText(vin, { timeout: 20_000 });
    await expect(page.getByTestId('communication-message-text')).toContainText(question, { timeout: 20_000 });

    const reply = `Thanks for your inquiry about ${vin}. We can continue through CarUp.`;
    await page.getByTestId('communication-reply-text').fill(reply);
    const replyWait = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && response.url().includes(`/api/communications/threads/${threadId}/messages`));
    await page.getByTestId('communication-reply-send').click();
    const replyResponse = await replyWait;
    expect(replyResponse.status(), await replyResponse.text()).toBe(201);
    await expect(page.getByTestId('communication-status')).toContainText('Sent through CarUp', { timeout: 20_000 });
    await expect(page.getByTestId('communication-message-text')).toContainText(reply, { timeout: 20_000 });
    await page.screenshot({ path: testInfo.outputPath(`phase-q-communications-${testInfo.project.name}.png`), fullPage: true });
  });

  test.afterEach(async ({ request }) => {
    const state = cleanupState;
    cleanupState = null;
    if (!state?.created || !state.auth) return;
    await retireFixture(request, state);
  });
});
