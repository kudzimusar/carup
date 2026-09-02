/**
 * 43 — Operations Control Plane M7: the real Serena governed review → Kingstone publish.
 *
 * This is NOT a fixture journey. It operates on the one real UAT vehicle
 * (2016 Nissan Serena Highway Star, GFC27-027051) already created by the real
 * Kingstone Seller journey, and it must never create a second Serena.
 *
 * The contract it proves end-to-end on the exact-head candidate pair:
 *   operator reviews evidence through the Vehicle Operations workspace
 *   → governed Seller Authority confirmation
 *   → Kingstone declares the truthful registration stage through the REAL Sell flow
 *   → Kingstone (not Operations) clicks Publish
 *   → the public Marketplace/Vehicle Detail projection is truthful
 *   → restricted source documents stay withheld from buyers
 *   → buyer inquiry works → unpublish/republish works.
 *
 * State-aware by design: mutations run on the desktop project only and are
 * skipped when already done, so the tablet/mobile projects (and reruns) assert
 * the same final state responsively instead of re-deciding it.
 *
 * Consequence worth knowing when reading a run: once the Serena is genuinely
 * published, a later run's publish/unpublish/republish branch is SKIPPED and
 * those steps' evidence lives in the run that first performed them
 * (33672092584, desktop). Every run still re-asserts the resulting public
 * truth on all three viewports.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  stagingTest as test,
  expect,
  signInViaUi,
  requireIdentity,
  API_URL,
  RUN_ID,
} from './staging-helpers';

const SERENA_VIN = 'GFC27-027051';
const KINGSTONE_USER_ID = 'u_66cace85fad949e4';
const TRUTHFUL_STAGE = 'arrived_customs_pending';

interface SessionAuth {
  token: string;
  user: { id: string; role: string; [key: string]: unknown };
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
  return { token: raw.token!, user };
}

async function mutationHeaders(request: APIRequestContext, auth: SessionAuth): Promise<Record<string, string>> {
  const headers = baseHeaders(auth);
  const response = await request.get(`${API_URL}/security/csrf-token`, { headers });
  expect(response.status(), 'CSRF token endpoint refused the staging identity').toBe(200);
  const body = await response.json() as { csrfToken?: string };
  expect(body.csrfToken, 'CSRF token response omitted csrfToken').toBeTruthy();
  return { ...headers, 'x-csrf-token': body.csrfToken! };
}

/** Sign in through the REAL login UI with explicit credentials (Kingstone). */
async function signInWithCredentials(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const responsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/auth\/login(?:\?|$)/.test(response.url())
    , { timeout: 20_000 });
    await page.getByTestId('login-button').click();
    const response = await responsePromise;
    if (response.ok()) {
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
      return;
    }
    if (response.status() !== 429) {
      throw new Error(`UI login failed for ${email} with HTTP ${response.status()}`);
    }
    const retryAfterSeconds = Number(response.headers()['retry-after'] || 1);
    await page.waitForTimeout(Math.max(1000, Math.min(retryAfterSeconds * 1000, 15_000)));
    await page.getByTestId('password-input').fill(password);
  }
  throw new Error(`UI login remained rate-limited for ${email}`);
}

function kingstoneCredentials(): { email: string; password: string } | null {
  const email = process.env.STAGING_UAT_KINGSTONE_EMAIL;
  const password = process.env.STAGING_UAT_KINGSTONE_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

async function fetchOperationsReview(request: APIRequestContext, reviewer: SessionAuth) {
  const response = await request.get(`${API_URL}/admin/vehicles/${SERENA_VIN}/review`, {
    headers: baseHeaders(reviewer),
  });
  expect(response.status(), `operations review aggregate refused: ${await response.text()}`).toBe(200);
  const body = await response.json() as { review: Record<string, any> };
  return body.review;
}

async function reviewerLogin(request: APIRequestContext): Promise<SessionAuth> {
  const password = process.env.STAGING_UAT_REVIEWER_PASSWORD;
  expect(password, 'STAGING_UAT_REVIEWER_PASSWORD is not configured').toBeTruthy();
  const csrf = await request.get(`${API_URL}/security/csrf-token`);
  const csrfBody = await csrf.json() as { csrfToken?: string };
  const response = await request.post(`${API_URL}/auth/login`, {
    headers: { 'x-csrf-token': csrfBody.csrfToken! },
    data: { email: 'uat.reviewer@carup-staging.test', password },
  });
  expect(response.status(), `reviewer login failed: ${await response.text()}`).toBe(200);
  const body = await response.json() as { token?: string; user?: SessionAuth['user'] };
  expect(body.user?.role).toBe('admin');
  return { token: body.token!, user: body.user! };
}

test.describe('Operations M7 — Serena governed review and Seller publish', () => {
  test('operator reviews the Serena through the Vehicle Operations workspace', async ({ page, request }, testInfo) => {
    test.setTimeout(480_000);
    expect(requireIdentity('reviewer'), 'reviewer identity is unavailable').toBe(true);
    const isMutationPass = testInfo.project.name === 'chromium';

    // The workspace itself, through the real reviewer UI.
    await signInViaUi(page, 'reviewer');
    const reviewer = await authFromPage(page);
    expect(reviewer.user.role).toBe('admin');

    await page.goto(`/admin/vehicles/${SERENA_VIN}/review`);
    await expect(page.getByTestId('vehicle-operations-review')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/2016 Nissan Serena/)).toBeVisible();
    await expect(page.getByTestId('ops-requirement-matrix')).toBeVisible();
    await expect(page.getByTestId('ops-evidence-groups')).toBeVisible();
    await expect(page.getByTestId('ops-registration-section')).toBeVisible();
    await expect(page.getByTestId('ops-seller-authority-section')).toBeVisible();

    // The Serena mislabels are SURFACED, not hidden: canonical meaning governs.
    await expect(page.getByTestId('ops-evidence-group-import')).toBeVisible();
    await expect(page.getByTestId('ops-evidence-group-inspection')).toBeVisible();

    await page.screenshot({
      path: `test-results/serena-m7/ops-workspace-${testInfo.project.name}.png`,
      fullPage: true,
    });

    if (isMutationPass) {
      const before = await fetchOperationsReview(request, reviewer);
      const reviewerHeaders = await mutationHeaders(request, reviewer);

      // 1. Verify pending evidence. The FIRST pending item is decided through the
      //    workspace UI (proving the surface); the remainder go through the same
      //    canonical route the UI calls.
      const pending: Array<{ id: string; semantic_label: string }> = Object.values(before.evidence.groups as Record<string, any[]>)
        .flat()
        .filter((item: any) => item.verification_status === 'pending');

      if (pending.length > 0) {
        const [first, ...rest] = pending;
        // Decide the first pending item through the workspace UI itself.
        const card = page.getByTestId('ops-evidence-groups')
          .locator('div.rounded-lg.border', { hasText: first.semantic_label })
          .first();
        await expect(card).toBeVisible({ timeout: 20_000 });
        await card.getByPlaceholder(/Reviewer note/).fill(
          `Operations M7 ${RUN_ID}: source document reviewed against the Serena pack; canonical classification correct.`,
        );
        await card.getByRole('button', { name: /^Verify$/ }).click();
        await expect.poll(async () => {
          const state = await fetchOperationsReview(request, reviewer);
          const rows = Object.values(state.evidence.groups as Record<string, any[]>).flat();
          return rows.find((row: any) => row.id === first.id)?.verification_status;
        }, { timeout: 60_000, message: 'workspace Verify did not persist' }).toBe('verified');

        for (const item of rest) {
          const verify = await request.patch(`${API_URL}/vehicles/${SERENA_VIN}/evidence/${item.id}/verify`, {
            headers: reviewerHeaders,
            data: { notes: `Operations M7 ${RUN_ID}: source document reviewed; canonical classification correct.`, trust_score_impact: 3 },
          });
          expect(verify.status(), `evidence ${item.id} verify failed: ${await verify.text()}`).toBe(200);
        }
      }

      // 2. Governed Seller Authority confirmation through the workspace UI.
      const afterEvidence = await fetchOperationsReview(request, reviewer);
      if (afterEvidence.seller_authority?.status !== 'confirmed') {
        await page.reload();
        await expect(page.getByTestId('ops-authority-decision')).toBeVisible({ timeout: 30_000 });
        await page.getByTestId('ops-authority-decision').locator('select').selectOption('confirmed');
        await page.getByTestId('ops-authority-decision').getByPlaceholder(/Reason/).fill(
          `Operations M7 ${RUN_ID}: existing recorded CarUp seller relationship strengthened by the verified import purchase chain (invoice, bill of lading, export certificate). Confirmed under seller_authority.v1 — no registration fact asserted.`,
        );
        await page.getByRole('button', { name: /Record decision/ }).click();
        await expect.poll(async () => {
          const state = await fetchOperationsReview(request, reviewer);
          return state.seller_authority?.status;
        }, { timeout: 60_000, message: 'seller authority confirmation did not persist' }).toBe('confirmed');
      }
    }

    // Accessibility gate for the new workspace — same severity bar as the
    // navigation axe gate: serious/critical violations fail. Scoped to the
    // workspace region this slice owns; the shared dashboard shell has its own
    // navigation-accessibility gate.
    const axe = await new AxeBuilder({ page })
      .include('[data-testid="vehicle-operations-review"]')
      .analyze();
    const severe = axe.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''));
    expect(severe, `axe serious/critical violations on the Vehicle Operations workspace: ${JSON.stringify(severe.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })))}`).toEqual([]);

    // Final-state assertions valid on every project pass.
    const review = await fetchOperationsReview(request, reviewer);
    const rows = Object.values(review.evidence.groups as Record<string, any[]>).flat();
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.every((row: any) => row.verification_status === 'verified')).toBe(true);
    expect(review.seller_authority?.status).toBe('confirmed');
    expect(review.seller_authority?.public_statement).toBe('Seller authority reviewed by CarUp');
    // No fake registration facts appeared through the review.
    expect(review.registration.recorded_stage === null || review.registration.recorded_stage === TRUTHFUL_STAGE).toBe(true);
    expect(review.registration.temporary_permit_recorded).toBe(false);
    expect(review.vehicle.zimra_verified).toBe(false);
    // The aggregate leaks no storage locator.
    const serialized = JSON.stringify(review);
    expect(serialized.includes('ocr-documents')).toBe(false);
    expect(serialized.includes('file_url')).toBe(false);
  });

  test('Kingstone declares the truthful registration stage through the real Sell flow', async ({ page, request }, testInfo) => {
    test.setTimeout(480_000);
    const credentials = kingstoneCredentials();
    test.skip(!credentials, 'Kingstone staging credentials are not provisioned for this run');
    const isMutationPass = testInfo.project.name === 'chromium';

    const reviewer = await reviewerLogin(request);
    const current = await fetchOperationsReview(request, reviewer);

    if (isMutationPass && current.registration.recorded_stage !== TRUTHFUL_STAGE) {
      await signInWithCredentials(page, credentials!.email, credentials!.password);
      const seller = await authFromPage(page);
      expect(seller.user.id).toBe(KINGSTONE_USER_ID);

      // The real restored-draft Sell flow — one Serena, one Passport.
      await page.goto(`/dashboard/sell-vehicle?vin=${SERENA_VIN}`);
      await expect(page.getByTestId('seller-server-draft-loaded')).toBeVisible({ timeout: 30_000 });

      // Resume lands at the persisted wizard step; the stage control lives on
      // Stage 1. Walk back through the real navigation first. The hero renders
      // its counter CSS-uppercased, so compare textContent case-insensitively —
      // and a disabled Back button already proves we are on Stage 1.
      const stageHero = page.getByTestId('seller-studio-stage-hero');
      await expect(stageHero).toBeVisible({ timeout: 20_000 });
      for (let guard = 0; guard < 4; guard += 1) {
        const heroText = (await stageHero.textContent()) || '';
        if (/stage\s*1\s*of\s*4/i.test(heroText)) break;
        const backButton = page.getByRole('button', { name: /^back$/i });
        if (!(await backButton.isEnabled())) break;
        await backButton.click();
        await expect(stageHero).toBeVisible({ timeout: 20_000 });
      }
      await expect(stageHero).toContainText(/stage\s*1\s*of\s*4/i, { timeout: 20_000 });

      // The stage control must be SELLER-editable on a restored draft (the stage
      // is a lifecycle claim, not immutable identity).
      const stageTrigger = page.getByTestId('registration-status-select');
      await expect(stageTrigger).toBeVisible();
      await expect(stageTrigger).toBeEnabled();
      await stageTrigger.click();
      await page.getByRole('option', { name: /Arrived .* customs pending/i }).click();

      // Walk the real wizard to submission. No identity/media is altered.
      for (const stage of ['Stage 2 of 4', 'Stage 3 of 4', 'Stage 4 of 4']) {
        const nextButton = page.getByRole('button', { name: /^next$/i });
        await expect(nextButton).toBeEnabled({ timeout: 20_000 });
        await nextButton.click();
        await expect(page.getByTestId('seller-studio-stage-hero')).toContainText(stage, { timeout: 20_000 });
      }
      const saveResponsePromise = page.waitForResponse((response) =>
        response.request().method() === 'POST' && response.url().includes('/api/vehicles/add')
      , { timeout: 60_000 });
      await page.getByTestId('submit-vehicle-button').click();
      const saveResponse = await saveResponsePromise;
      expect([200, 201], `Serena re-save failed: ${await saveResponse.text()}`).toContain(saveResponse.status());
    }

    const after = await fetchOperationsReview(request, reviewer);
    expect(after.registration.recorded_stage, 'the truthful stage is recorded').toBe(TRUTHFUL_STAGE);
    expect(after.registration.stage_provenance, 'the stage remains a Seller statement').toBe('seller_statement');
    expect(after.registration.lifecycle.publication_blocking, 'a sourced pending permanent-import stage does not block').toBe(false);
    expect(after.registration.temporary_permit_recorded, 'no TIP was fabricated').toBe(false);
    expect(after.publication_readiness.is_publishable, `Serena must now be legitimately publishable: ${JSON.stringify(after.publication_readiness.requirements)}`).toBe(true);
  });

  test('Kingstone publishes; buyers see a truthful projection; restricted documents stay withheld; unpublish/republish works', async ({ page, request }, testInfo) => {
    test.setTimeout(480_000);
    const credentials = kingstoneCredentials();
    test.skip(!credentials, 'Kingstone staging credentials are not provisioned for this run');
    const isMutationPass = testInfo.project.name === 'chromium';

    const reviewer = await reviewerLogin(request);
    const current = await fetchOperationsReview(request, reviewer);

    if (isMutationPass && current.vehicle.publication_status !== 'published') {
      expect(current.publication_readiness.is_publishable, 'cannot publish an unpublishable Serena').toBe(true);
      await signInWithCredentials(page, credentials!.email, credentials!.password);
      const seller = await authFromPage(page);
      expect(seller.user.id).toBe(KINGSTONE_USER_ID);

      // THE act of this whole slice: the Seller — not Operations — clicks Publish.
      await page.goto('/dashboard/listings');
      await expect(page.getByTestId(`my-listing-card-${SERENA_VIN}`)).toBeVisible({ timeout: 30_000 });
      await page.getByTestId(`publish-toggle-${SERENA_VIN}`).click();
      await expect(page.getByTestId(`publication-badge-${SERENA_VIN}`)).toContainText('Published', { timeout: 30_000 });
      await page.screenshot({ path: `test-results/serena-m7/kingstone-published-${testInfo.project.name}.png`, fullPage: true });

      // Unpublish → republish is a Seller right and must survive round-tripping.
      await page.getByTestId(`publish-toggle-${SERENA_VIN}`).click();
      await expect(page.getByTestId(`publication-badge-${SERENA_VIN}`)).not.toContainText('Published', { timeout: 30_000 });
      const gone = await request.get(`${API_URL}/marketplace/listings?q=${encodeURIComponent(SERENA_VIN)}`);
      const goneBody = await gone.json() as { listings?: Array<{ vin?: string }> };
      expect((goneBody.listings || []).some((listing) => listing.vin === SERENA_VIN), 'unpublished Serena still public').toBe(false);
      await page.getByTestId(`publish-toggle-${SERENA_VIN}`).click();
      await expect(page.getByTestId(`publication-badge-${SERENA_VIN}`)).toContainText('Published', { timeout: 30_000 });

      // Drop the Seller session before public assertions.
      await page.evaluate(() => localStorage.clear());
    }

    // ── Public truth, on every viewport ────────────────────────────────────
    await page.goto(`/marketplace?q=${encodeURIComponent(SERENA_VIN)}`);
    const publicLink = page.locator(`a[href^="/marketplace/${SERENA_VIN}"]`).first();
    await expect(publicLink).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `test-results/serena-m7/marketplace-card-${testInfo.project.name}.png`, fullPage: true });

    await publicLink.click();
    await expect(page.getByTestId('vehicle-detail-primary-actions')).toBeVisible({ timeout: 30_000 });
    const bodyText = await page.locator('body').innerText();
    // No fabricated registration/TIP/ZIMRA claim reaches a buyer.
    expect(bodyText).not.toMatch(/locally registered/i);
    expect(bodyText).not.toMatch(/temporary import permit/i);
    expect(bodyText).not.toMatch(/zimra (verified|confirmed)/i);
    await page.screenshot({ path: `test-results/serena-m7/vehicle-detail-${testInfo.project.name}.png`, fullPage: true });

    // Restricted source documents are not reachable by an unauthenticated buyer.
    const publicEvidence = await request.get(`${API_URL}/vehicles/${SERENA_VIN}/evidence`);
    expect(publicEvidence.status()).toBe(200);
    const publicRows = await publicEvidence.json() as Array<{ visibility_level?: string; file_url?: string | null; file_availability?: string }>;
    for (const row of publicRows) {
      expect(row.visibility_level, 'a private row leaked into the public evidence read').toBe('public_safe');
      expect(row.file_url ?? null, 'a private-bucket artifact URL leaked to an unauthenticated buyer').toBeNull();
    }
    const evidenceSerialized = JSON.stringify(publicRows);
    expect(evidenceSerialized.includes('ocr-documents')).toBe(false);

    // Buyer inquiry through the real guest modal (desktop pass only to avoid
    // spamming the Seller inbox once per viewport).
    if (isMutationPass) {
      await page.getByTestId('marketplace-inquiry-open').first().click();
      await expect(page.getByTestId('marketplace-inquiry-modal')).toBeVisible();
      await page.getByTestId('marketplace-inquiry-name').fill('Operations M7 Buyer');
      await page.getByTestId('marketplace-inquiry-email').fill(`ops-m7-${Date.now()}@example.test`);
      await page.getByTestId('marketplace-inquiry-phone').fill('+263771000206');
      await page.getByTestId('marketplace-inquiry-message').fill(`Is the Serena ${SERENA_VIN} available for viewing in Harare?`);
      const inquiryWait = page.waitForResponse((response) =>
        response.request().method() === 'POST' && response.url().includes('/api/marketplace/inquiries')
      );
      await page.getByTestId('marketplace-inquiry-submit').click();
      expect([200, 201]).toContain((await inquiryWait).status());
      await expect(page.getByTestId('marketplace-inquiry-modal')).toHaveCount(0, { timeout: 15_000 });

      // The Seller receives and can manage the inquiry.
      await signInWithCredentials(page, credentials!.email, credentials!.password);
      await page.goto('/dashboard/listings');
      const inquiryInbox = page.getByTestId('seller-inquiries-card');
      await expect(inquiryInbox).toBeVisible({ timeout: 30_000 });
      await expect(inquiryInbox).toContainText(SERENA_VIN, { timeout: 30_000 });
      await page.screenshot({ path: `test-results/serena-m7/seller-inquiries-${testInfo.project.name}.png`, fullPage: true });
      await page.evaluate(() => localStorage.clear());
    }

    // The Serena ends the run PUBLISHED — it is the real listing.
    const finalState = await fetchOperationsReview(request, reviewer);
    expect(finalState.vehicle.publication_status).toBe('published');
  });
});
