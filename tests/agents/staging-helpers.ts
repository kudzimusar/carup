/**
 * Shared harness for the deployed-staging browser acceptance (specs 32–35).
 *
 * Provides a `stagingTest` fixture that instruments every page with:
 *   - console-error capture  → test FAILS on unexpected console errors (zero-silent-errors gate)
 *   - pageerror capture      → test FAILS on uncaught page exceptions
 *   - network capture        → test FAILS on unexpected API 5xx; records failed 4xx with context
 * plus real-UI sign-in helpers (no page.route(), no mocks — the deployed pages only) and the
 * test-identity registry (secrets come from env/storage-state, never from the repo).
 */
import { test as base, expect, type Page, type APIResponse } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

export const WEB_URL = process.env.STAGING_WEB_URL || 'https://staging.carup.dev';
export const API_URL = process.env.STAGING_API_URL || 'https://api-staging.carup.dev/api';
export const RUN_ID = process.env.STAGING_RUN_ID || `staging-${Date.now()}`;

/** Staging-only test identities (deterministic, clearly marked). Passwords come from env only. */
export const IDENTITIES = {
  buyer: { email: process.env.STAGING_UAT_BUYER_EMAIL || 'uat.buyer@carup-staging.test', envPassword: 'STAGING_UAT_BUYER_PASSWORD', state: '.staging-auth/buyer.json' },
  seller: { email: 'uat.seller@carup-staging.test', envPassword: 'STAGING_UAT_SELLER_PASSWORD', state: '.staging-auth/seller.json' },
  // The address is overridable so a workflow can own its reviewer instead of sharing
  // `uat.reviewer@carup-staging.test` with every other staging gate that rotates it. The
  // default preserves the historical shared identity for every caller that sets nothing.
  reviewer: { email: process.env.STAGING_UAT_REVIEWER_EMAIL || 'uat.reviewer@carup-staging.test', envPassword: 'STAGING_UAT_REVIEWER_PASSWORD', state: '.staging-auth/reviewer.json' },
  tenantAdmin: { email: 'uat.tenant-admin@carup-staging.test', envPassword: 'STAGING_UAT_TENANT_ADMIN_PASSWORD', state: '.staging-auth/tenant-admin.json' },
  outsider: { email: 'uat.outsider@carup-staging.test', envPassword: 'STAGING_UAT_OUTSIDER_PASSWORD', state: '.staging-auth/outsider.json' },
  // Spec 38's Seller. In the deployed gate each viewport gets its own per-run identity
  // (scripts/ci/golden-seller-identity.mjs); the Seller workflow still sets STAGING_UAT_BUYER_EMAIL.
  // Separate from `buyer` on purpose: specs 32–35 use `buyer` as a buyer and must not change.
  goldenSeller: {
    email: process.env.STAGING_GOLDEN_SELLER_EMAIL || process.env.STAGING_UAT_BUYER_EMAIL || 'uat.buyer@carup-staging.test',
    envPassword: process.env.STAGING_GOLDEN_SELLER_EMAIL ? 'STAGING_GOLDEN_SELLER_PASSWORD' : 'STAGING_UAT_BUYER_PASSWORD',
    state: '.staging-auth/golden-seller.json',
  },
} as const;
export type Role = keyof typeof IDENTITIES;

// Console noise that is legitimately expected on the deployed app (kept deliberately narrow).
const EXPECTED_CONSOLE = [
  /VITE_API_URL is not set/i,             // diagnostic warning path (should not fire on staging, but is a warn)
  /Download the React DevTools/i,
  /third-party cookie/i,
  // Background reads on the legacy owner dashboard (/safepay/list, /marketplace/my-*,
  // /notifications/me, the escrow loader) get ABORTED when a journey performs a full navigation
  // while they are in flight. `fetch` rejects with "TypeError: Failed to fetch" and NO HTTP
  // response at all — different callers echo it with different prefixes ("CarUp API Error (…)",
  // "Failed to load escrows", …), so the abort itself is matched rather than one caller's wording.
  // Evidence this is an abort, not a server fault: spec 45 runs record zero matching 4xx/5xx, and
  // direct preflight/GET probes of the same endpoints answer correctly with ACAO headers. The
  // affected surfaces render their truthful "could not be loaded"/unavailable states.
  //
  // Scope of this exemption: ONLY the no-response abort echo. Any request that actually reaches
  // the server still fails the run through the response hook (5xx / unexpected 4xx), an
  // unreachable backend fails sign-in immediately, and every product assertion is unaffected.
  // The dashboard's unbounded background-fetch fan-out is filed as a P1 cleanup.
  /TypeError: Failed to fetch/,
];
// API 4xx that journeys legitimately trigger (auth probes, permission negative-tests).
const EXPECTED_4XX_PATHS = [/\/auth\/verify$/, /\/security\/csrf-token$/];

export interface NetFailure { method: string; url: string; status: number; body: string }

interface Capture {
  consoleErrors: string[];
  pageErrors: string[];
  fiveHundreds: NetFailure[];
  fourHundreds: NetFailure[];
}

async function instrument(page: Page, cap: Capture) {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (EXPECTED_CONSOLE.some((re) => re.test(text))) return;
    // Failed-fetch console echoes are captured (with context) via the response hook instead.
    if (/Failed to load resource/i.test(text)) return;
    cap.consoleErrors.push(text.slice(0, 500));
  });
  page.on('pageerror', (err) => cap.pageErrors.push(String(err).slice(0, 500)));
  page.on('response', async (res) => {
    const status = res.status();
    if (status < 400) return;
    const url = res.url();
    if (!url.includes('/api/')) return; // only API responses are gated
    const entry: NetFailure = {
      method: res.request().method(),
      url,
      status,
      body: (await res.text().catch(() => '')).slice(0, 300),
    };
    if (status >= 500) cap.fiveHundreds.push(entry);
    else if (!EXPECTED_4XX_PATHS.some((re) => re.test(new URL(url).pathname))) cap.fourHundreds.push(entry);
  });
}

/**
 * Vercel's preview-only feedback/toolbar widget, blocked so acceptance measures THE PRODUCT.
 *
 * Preview deployments inject `https://vercel.live/_next-live/feedback/feedback.js`, which mounts a
 * `<vercel-live-feedback>` element at `z-index: 2147483647` with `pointer-events: auto`. On a
 * 393px-wide mobile viewport that element covers the top-right of a Marketplace listing card —
 * exactly where the compare/share/save controls sit — so a tap on "Save listing" reaches the
 * widget and React's handler never runs. Measured on the deployed preview: with the widget present
 * `aria-pressed` stays `false` and no request is made; with `vercel.live` blocked the identical tap
 * flips it to `true` and the save POST fires.
 *
 * This is third-party PREVIEW CHROME, not CarUp code, and it does not exist on production. Blocking
 * it removes an environment artefact from the measurement; it weakens no product assertion, because
 * every assertion in these specs still runs against the real deployed app.
 *
 * NOTE FOR OWNER UAT: a human testing the preview URL on a phone hits the same overlay. The Vercel
 * Toolbar must be disabled for the staging project (or dismissed in-session) before mobile owner
 * UAT, or the same controls will be untappable for them.
 */
const PREVIEW_TOOLBAR_ORIGIN = /^https:\/\/vercel\.live\//;

export const stagingTest = base.extend<{ cap: Capture; previewToolbarBlocked: void }>({
  // AUTO. It must apply to every staging test, not only the ones that opt into `cap` — the Golden
  // journey takes `{ page, request }` and would otherwise still be measured through the overlay.
  previewToolbarBlocked: [async ({ page }, use) => {
    await page.context().route(PREVIEW_TOOLBAR_ORIGIN, (route) => route.abort());
    await use();
  }, { auto: true }],

  cap: async ({ page }, use, testInfo) => {
    const cap: Capture = { consoleErrors: [], pageErrors: [], fiveHundreds: [], fourHundreds: [] };
    await instrument(page, cap);
    await use(cap);
    // Record failed 4xx with request context (informational), fail hard on 5xx + console/page errors.
    if (cap.fourHundreds.length) {
      await testInfo.attach('failed-4xx.json', { body: JSON.stringify(cap.fourHundreds, null, 2), contentType: 'application/json' });
    }
    expect(cap.fiveHundreds, `unexpected API 5xx:\n${JSON.stringify(cap.fiveHundreds, null, 2)}`).toEqual([]);
    expect(cap.pageErrors, `uncaught page errors:\n${cap.pageErrors.join('\n')}`).toEqual([]);
    expect(cap.consoleErrors, `unexpected console errors:\n${cap.consoleErrors.join('\n')}`).toEqual([]);
  },
});
export { expect };

/** Sign in through the REAL deployed login page; falls back to the provisioned storage-state
 *  session (real staging token from the registration flow) when no password is exported. */
export async function signInViaUi(page: Page, role: Role): Promise<void> {
  const id = IDENTITIES[role];
  const password = process.env[id.envPassword] || readSavedPassword();
  if (password) {
    await page.goto('/login');
    await page.getByTestId('email-input').fill(id.email);
    await page.getByTestId('password-input').fill(password);

    // Deployed acceptance can exercise the same staging identity several times across desktop and
    // mobile projects. Respect the real auth limiter rather than converting a legitimate 429 into
    // a false UI-navigation failure. We still drive the actual Login form on every attempt.
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
        throw new Error(`UI login failed for ${role} with HTTP ${response.status()}`);
      }
      // The limiter states its window in Retry-After. Honour it (bounded), so five attempts can
      // outlast a full 60 s window instead of giving up after ~5 s.
      await page.waitForTimeout(retryAfterMs(response.headers()));
      await page.getByTestId('password-input').fill(password);
    }
    throw new Error(`UI login remained rate-limited for ${role} after bounded retries`);
  }
  if (existsSync(id.state)) {
    const state = JSON.parse(readFileSync(id.state, 'utf8')) as { origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> };
    const entries = state.origins[0]?.localStorage ?? [];
    await page.goto('/');
    await page.evaluate((kv) => { for (const { name, value } of kv) localStorage.setItem(name, value); }, entries);
    await page.goto('/'); // reload with the authenticated session
    return;
  }
  throw new Error(`${id.envPassword} not set and ${id.state} missing — run backend/scripts/staging-create-test-identities.mjs first.`);
}

/**
 * OC-5D / OC-5R-REL-02 C — choose the organisation a session acts for, THE WAY A PERSON DOES.
 *
 * The server never picks an organisation: login lists the memberships, and a session gains one only
 * when the person selects it (PUT /api/auth/active-tenant) — one tap, even where exactly one
 * membership is selectable. A journey that works for an organisation therefore has to ask for it
 * through the real prompt or switcher, then wait for the server-verified selection to land.
 *
 * This helper is bounded and honest about what it does NOT do: it never writes localStorage, never
 * sets a tenant header, never calls the active-tenant endpoint itself and never weakens a tenant
 * assertion. It observes the product's OWN request on the wire and the product's own UI state.
 *
 *   1. open the dashboard shell (it hosts both the organisation badge and the "Choose an
 *      organisation" prompt);
 *   2. read who the session acts for from the badge's accessible name;
 *   3. already that organisation → continue ('already_acting');
 *   4. otherwise click the real "Act for …" control — the prompt's button, or the badge's menu item
 *      when the prompt is not showing — and wait for PUT /api/auth/active-tenant to be accepted;
 *   5. prove the new context in the UI (badge names the organisation, the prompt is gone) before the
 *      caller touches any organisation-scoped workspace.
 */
export interface OrganisationSelection {
  outcome: 'already_acting' | 'selected';
  /** The badge's accessible name once the context held: "Acting for <organisation>. Change organisation". */
  badge: string;
  /** For 'selected': the organisation id the product's own control sent, observed on the wire. */
  tenantId: string | null;
}

export async function ensureActingForOrganisation(page: Page, organisation: RegExp, timeoutMs = 30_000): Promise<OrganisationSelection> {
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

  const badge = page.getByTestId('organisation-badge');
  await expect(badge, 'the dashboard header shows which organisation the session acts for').toBeVisible({ timeout: timeoutMs });
  const actingForName = new RegExp(`^Acting for .*(?:${organisation.source}).*\\. Change organisation$`, organisation.flags);
  const before = (await badge.getAttribute('aria-label')) ?? '';
  if (actingForName.test(before)) return { outcome: 'already_acting', badge: before, tenantId: null };

  const actFor = new RegExp(`Act for .*(?:${organisation.source})`, organisation.flags);
  const prompt = page.getByTestId('organisation-prompt');
  let control = prompt.getByRole('button', { name: actFor });
  if (!(await control.isVisible().catch(() => false))) {
    // The prompt is not showing (dismissed, or the session already names a different organisation):
    // use the switcher, which is always one click away in the header.
    await badge.click();
    control = page.getByRole('menuitem', { name: actFor });
  }
  await expect(control, `no real "Act for …" control offers an organisation matching ${organisation}`).toBeVisible({ timeout: timeoutMs });

  const selection = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && /\/api\/auth\/active-tenant(?:\?|$)/.test(response.url()),
    { timeout: 20_000 },
  );
  await control.click();
  const response = await selection;
  expect(response.ok(), `PUT /api/auth/active-tenant answered HTTP ${response.status()}`).toBe(true);
  const sent = response.request().postDataJSON() as { tenantId?: string | null } | null;
  expect(sent?.tenantId, 'the product selected a real organisation, not "yourself"').toBeTruthy();

  await expect(badge, 'the session context did not update to the chosen organisation').toHaveAttribute('aria-label', actingForName, { timeout: timeoutMs });
  await expect(prompt, 'the "Choose an organisation" prompt must be gone once an organisation is chosen').toHaveCount(0);
  return { outcome: 'selected', badge: (await badge.getAttribute('aria-label')) ?? '', tenantId: sent?.tenantId ?? null };
}

function readSavedPassword(): string | undefined {
  try { return readFileSync('.staging-auth/.password', 'utf8').trim() || undefined; } catch { return undefined; }
}

/** Wait derived from a 429's Retry-After: at least 1 s, at most 20 s per attempt. */
export function retryAfterMs(headers: Record<string, string>): number {
  const seconds = Number(headers['retry-after']);
  return Math.max(1000, Math.min(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 5000, 20_000));
}

/**
 * Send an API request and, if the rate limiter refuses it, wait out its stated Retry-After and send
 * it again (bounded: up to ~80 s in total, enough for a full 60 s window). Returns the first response
 * that is NOT 429. A 429 is never returned as though it were the answer, so an assertion such as
 * "anonymous is denied with 401/403" is still proven by the server's authorization, not by the
 * limiter.
 */
export async function withRateLimitRetry(send: () => Promise<APIResponse>, label: string): Promise<APIResponse> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await send();
    if (response.status() !== 429) return response;
    await new Promise((r) => setTimeout(r, retryAfterMs(response.headers())));
  }
  throw new Error(`${label} remained rate-limited (429) after bounded retries`);
}

/** Skip guard: identities exist (storage state or env password) or the spec self-skips loudly. */
export function requireIdentity(role: Role): boolean {
  const id = IDENTITIES[role];
  return existsSync(id.state) || Boolean(process.env[id.envPassword]);
}

/** Deterministic test-data marker so cleanup can find everything a run created. */
export function marked(label: string): string {
  return `UAT[${RUN_ID}] ${label}`;
}
