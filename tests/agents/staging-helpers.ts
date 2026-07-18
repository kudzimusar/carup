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

export const WEB_URL = process.env.STAGING_WEB_URL || 'https://carup-staging.vercel.app';
export const API_URL = process.env.STAGING_API_URL || 'https://carup-backend-staging.vercel.app/api';
export const RUN_ID = process.env.STAGING_RUN_ID || `staging-${Date.now()}`;

/** Staging-only test identities (deterministic, clearly marked). Passwords come from env only. */
export const IDENTITIES = {
  buyer: { email: 'uat.buyer@carup-staging.test', envPassword: 'STAGING_UAT_BUYER_PASSWORD', state: '.staging-auth/buyer.json' },
  seller: { email: 'uat.seller@carup-staging.test', envPassword: 'STAGING_UAT_SELLER_PASSWORD', state: '.staging-auth/seller.json' },
  reviewer: { email: 'uat.reviewer@carup-staging.test', envPassword: 'STAGING_UAT_REVIEWER_PASSWORD', state: '.staging-auth/reviewer.json' },
  tenantAdmin: { email: 'uat.tenant-admin@carup-staging.test', envPassword: 'STAGING_UAT_TENANT_ADMIN_PASSWORD', state: '.staging-auth/tenant-admin.json' },
  outsider: { email: 'uat.outsider@carup-staging.test', envPassword: 'STAGING_UAT_OUTSIDER_PASSWORD', state: '.staging-auth/outsider.json' },
} as const;
export type Role = keyof typeof IDENTITIES;

// Console noise that is legitimately expected on the deployed app (kept deliberately narrow).
const EXPECTED_CONSOLE = [
  /VITE_API_URL is not set/i,             // diagnostic warning path (should not fire on staging, but is a warn)
  /Download the React DevTools/i,
  /third-party cookie/i,
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

export const stagingTest = base.extend<{ cap: Capture }>({
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
    await page.getByTestId('login-button').click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
    return;
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
