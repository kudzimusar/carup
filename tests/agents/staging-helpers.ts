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
import { test as base, expect, type Page } from '@playwright/test';
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
      const retryAfterSeconds = Number(response.headers()['retry-after'] || 1);
      await page.waitForTimeout(Math.max(1000, Math.min(retryAfterSeconds * 1000, 15_000)));
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

function readSavedPassword(): string | undefined {
  try { return readFileSync('.staging-auth/.password', 'utf8').trim() || undefined; } catch { return undefined; }
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
