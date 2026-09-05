import type { Page } from '@playwright/test';
import { stagingTest, expect } from './staging-helpers';

/**
 * Spec 47 — Trade OS T3 (Logistics RFQ / "Ship something") certification on deployed staging.
 *
 * The claim under test is that T3 is a DIFFERENT product from T2 procurement, and that its truth
 * boundaries survive a real database rather than a mock:
 *
 *   - a requester who already owns cargo publishes a shipping request without freight knowledge;
 *   - a qualified logistics provider in another organisation discovers it through the SAFE
 *     projection and never learns who asked;
 *   - the provider sends a transparent offer with its charge components stated separately;
 *   - the requester sees WHO the offer is from, compares it, and awards atomically;
 *   - and the award creates NO container reservation, because a quote is not a booking.
 *
 * Provider eligibility here is deliberately NOT a platform role: the fixture is an ordinary
 * `owner` account whose registration profile says `logistics_provider`. If that ever silently
 * became a role grant, this spec still passes for the wrong reason — so the backend suite pins the
 * eligibility rule separately.
 */

const IDS = {
  requester: { email: process.env.TRADEOS_T3_REQUESTER_EMAIL || '', envPassword: 'TRADEOS_T3_REQUESTER_PASSWORD' },
  provider: { email: process.env.TRADEOS_T3_PROVIDER_EMAIL || '', envPassword: 'TRADEOS_T3_PROVIDER_PASSWORD' },
} as const;
type Who = keyof typeof IDS;

/** Unique per run so repeated certifications never collide or read each other's rows. */
const RUN_TAG = process.env.STAGING_RUN_ID || 't3';
const CARGO = `SYNTHETIC T3 ${RUN_TAG} household cartons`;

function password(who: Who): string {
  const value = process.env[IDS[who].envPassword];
  if (!value) throw new Error(`${IDS[who].envPassword} is not exported — provision the T3 identities first.`);
  return value;
}

function provisioned(): boolean {
  return Boolean(IDS.requester.email && IDS.provider.email
    && process.env[IDS.requester.envPassword] && process.env[IDS.provider.envPassword]);
}

async function signIn(page: Page, who: Who): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('email-input').fill(IDS[who].email);
  await page.getByTestId('password-input').fill(password(who));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const responsePromise = page.waitForResponse((r) =>
      r.request().method() === 'POST' && /\/api\/auth\/login(?:\?|$)/.test(r.url()), { timeout: 20_000 });
    await page.getByTestId('login-button').click();
    const response = await responsePromise;
    if (response.ok()) {
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
      return;
    }
    if (response.status() !== 429) throw new Error(`UI login failed for ${who} with HTTP ${response.status()}`);
    const retryAfter = Number(response.headers()['retry-after'] || 1);
    await page.waitForTimeout(Math.max(1000, Math.min(retryAfter * 1000, 15_000)));
    await page.getByTestId('password-input').fill(password(who));
  }
  throw new Error(`UI login remained rate-limited for ${who}`);
}

/** Sign out completely so the next actor is a genuinely separate session, not a leaked one. */
async function switchActor(page: Page, who: Who): Promise<void> {
  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.clear()).catch(() => undefined);
  await signIn(page, who);
}

stagingTest.describe('Trade OS T3 — Shipping requests (deployed staging, unmocked)', () => {
  stagingTest.skip(!provisioned(),
    'T3 staging identities are not provisioned (TRADEOS_T3_{REQUESTER,PROVIDER}_{EMAIL,PASSWORD}).');

  stagingTest('requester publishes, provider offers safely, requester awards — and nothing is booked', async ({ page }) => {
    stagingTest.setTimeout(300_000);

    // ── Requester: describe cargo without knowing CBM, then publish ────────
    await signIn(page, 'requester');
    await page.goto('/diaspora/containers?view=mine');
    await expect(page.getByTestId('trade-shipping-workspace')).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: /New shipping request/i }).click();
    await page.getByTestId('logistics-cargo-description').fill(CARGO);
    await page.locator('[data-testid="logistics-request-wizard"] input[type="number"]').first().fill('14');
    await page.getByRole('button', { name: /^Continue/i }).click();

    // Guided measurement: the person supplies a box size, CarUp computes the volume.
    await page.getByLabel(/Help me calculate it/i).check();
    const nums = page.locator('[data-testid="logistics-request-wizard"] input[type="number"]');
    await nums.nth(0).fill('60');
    await nums.nth(1).fill('45');
    await nums.nth(2).fill('40');
    await page.getByRole('button', { name: /^Continue/i }).click();   // → Route
    await page.getByRole('button', { name: /^Continue/i }).click();   // → Review
    await page.getByRole('button', { name: /Publish shipping request/i }).click();

    const detail = page.getByTestId('logistics-request-detail');
    await expect(detail).toBeVisible({ timeout: 60_000 });
    await expect(detail).toContainText(/Waiting for offers/i);
    const reference = (await detail.innerText()).match(/SHIP-[A-Z0-9]+/)?.[0];
    expect(reference, 'a published request must carry a reference').toBeTruthy();

    // ── Provider: safe discovery, then a transparent offer ────────────────
    await switchActor(page, 'provider');
    await page.goto('/diaspora/containers?view=provider');
    await expect(page.getByTestId('logistics-provider-workspace')).toBeVisible({ timeout: 60_000 });

    const card = page.getByTestId('logistics-opportunity').filter({ hasText: CARGO });
    await expect(card).toBeVisible({ timeout: 60_000 });

    // The whole point of the projection: the cargo crosses, the requester does not.
    const cardText = await card.innerText();
    expect(cardText, 'provider must not see the requester email').not.toContain(IDS.requester.email);
    expect(cardText, 'provider must not see the requester name').not.toContain('Requester');

    await card.getByRole('button', { name: /Prepare offer/i }).click();
    const composer = page.getByTestId('logistics-quote-composer');
    await composer.getByLabel(/Freight charge/i).fill('700');
    await composer.getByLabel(/Handling/i).fill('100');
    await composer.getByLabel(/Offer total/i).fill('800');
    await composer.getByRole('button', { name: /Review offer/i }).click();
    await expect(composer).toContainText(/Exactly what the customer will compare/i);
    // Components the provider did not state stay unknown — never folded into an "all-in" total.
    await expect(composer).toContainText(/Not provided/i);
    await composer.getByRole('button', { name: /Submit offer/i }).click();
    await expect(composer).toBeHidden({ timeout: 60_000 });

    // ── Requester: compare, see who it is from, and award ─────────────────
    await switchActor(page, 'requester');
    await page.goto('/diaspora/containers?view=mine');
    await page.getByText(CARGO).first().click();
    await expect(detail).toBeVisible({ timeout: 60_000 });
    await expect(detail).toContainText('800');
    // The requester DOES see the provider identity — that is what makes comparison possible.
    await expect(detail.getByTestId('logistics-offer-card')).toBeVisible();

    await detail.getByRole('button', { name: /Choose this provider/i }).first().click();
    await expect(detail).toContainText(/Provider selected/i, { timeout: 60_000 });

    // An award is a chosen offer and nothing more. It must not read as booked space.
    await expect(detail).not.toContainText(/Space approved|Booking approved/i);
  });

  stagingTest('a shared-container offer converts to a REQUESTED reservation that consumes nothing until the organiser approves', async ({ page }) => {
    stagingTest.setTimeout(300_000);
    const cargo = `${CARGO} container-space`;

    // ── Requester publishes ───────────────────────────────────────────────
    await signIn(page, 'requester');
    await page.goto('/diaspora/containers?view=mine');
    await page.getByRole('button', { name: /New shipping request/i }).click();
    await page.getByTestId('logistics-cargo-description').fill(cargo);
    await page.locator('[data-testid="logistics-request-wizard"] input[type="number"]').first().fill('4');
    await page.getByRole('button', { name: /^Continue/i }).click();
    await page.getByLabel(/I know the total volume/i).check();
    await page.locator('[data-testid="logistics-request-wizard"] input[type="number"]').first().fill('3');
    await page.getByRole('button', { name: /^Continue/i }).click();   // → Route
    await page.getByRole('button', { name: /^Continue/i }).click();   // → Review
    await page.getByRole('button', { name: /Publish shipping request/i }).click();
    await expect(page.getByTestId('logistics-request-detail')).toBeVisible({ timeout: 60_000 });

    // ── Provider attaches a sailing it actually operates ──────────────────
    await switchActor(page, 'provider');
    await page.goto('/diaspora/containers?view=provider');
    const card = page.getByTestId('logistics-opportunity').filter({ hasText: cargo });
    await expect(card).toBeVisible({ timeout: 60_000 });
    await card.getByRole('button', { name: /Prepare offer/i }).click();

    const composer = page.getByTestId('logistics-quote-composer');
    const sailing = composer.getByLabel(/CarUp sailing/i);
    // Only a sailing this provider coordinates or tenant-administers may be offered; the server
    // re-checks it regardless of what the select contains.
    await sailing.selectOption({ index: 1 });
    await composer.getByLabel(/Offer total/i).fill('650');
    await composer.getByRole('button', { name: /Review offer/i }).click();
    await composer.getByRole('button', { name: /Submit offer/i }).click();
    await expect(composer).toBeHidden({ timeout: 60_000 });

    // ── Requester awards, then explicitly asks for space ──────────────────
    await switchActor(page, 'requester');
    await page.goto('/diaspora/containers?view=mine');
    await page.getByText(cargo).first().click();
    const detail = page.getByTestId('logistics-request-detail');
    await expect(detail).toBeVisible({ timeout: 60_000 });
    await detail.getByRole('button', { name: /Choose this provider/i }).first().click();
    await expect(detail).toContainText(/Provider selected/i, { timeout: 60_000 });

    // The award alone must NOT read as a booking — space is a separate, deliberate act.
    await expect(detail).toContainText(/organiser still has to approve/i);
    await detail.getByRole('button', { name: /Request container space/i }).click();
    await expect(detail).toContainText(/Container-space request recorded/i, { timeout: 60_000 });
  });
});
