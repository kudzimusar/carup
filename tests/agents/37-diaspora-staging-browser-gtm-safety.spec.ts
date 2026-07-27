/**
 * Deployed-STAGING fail-closed acceptance (Issue #127, Phase 8).
 *
 * Spec 36 proves the go-to-market surfaces render truthfully on the deployed candidate. This file
 * proves the half that matters more: the surfaces which MUST refuse actually refuse ON THE
 * DEPLOYMENT, not merely in a unit test with a stubbed environment. A flag believed to be off is not
 * a flag proven to be off.
 *
 * TWO RULES THIS FILE FOLLOWS, BECAUSE BREAKING EITHER MAKES A GREEN RUN MEANINGLESS
 * ---------------------------------------------------------------------------------
 * 1. **A 404 is not a refusal.** `expect(status).toBeGreaterThanOrEqual(400)` passes just as happily
 *    against a misspelled path as against a real fail-closed gate — and the misspelling is the more
 *    likely reason for a green result. Every probe therefore asserts the route EXISTS (status is not
 *    404) before treating its rejection as evidence of anything. The first draft of this file used
 *    `/diaspora/safetrade/transactions` and `/diaspora/drive/connect`; neither route exists, and both
 *    "passed".
 * 2. **A detector that cannot fire proves nothing by staying silent.** Every secret pattern is first
 *    run against its own positive control, so "no secrets found" means the detector looked and found
 *    none rather than that it was incapable of matching.
 * 3. **A 401 is not a refusal either.** This is the same mistake as rule 1, one layer further in, and
 *    it is the one that nearly shipped. The probe helper originally sent `credentials: 'include'` with
 *    no headers — but this application has NO cookie session. Auth travels as `x-user-id` /
 *    `x-session-token` headers read from localStorage, so every probe was ANONYMOUS and every 401 from
 *    the auth middleware satisfied `expect(status).toBeGreaterThanOrEqual(400)` while proving nothing
 *    about any gate. `assertProbeIsAuthenticated` now runs before every conclusion drawn from a
 *    refusal, and requires a 2xx from an endpoint the signed-in identity is entitled to.
 *
 * NOTHING HERE MOVES MONEY. Live paths are exercised precisely to the point of their refusal, which
 * is the whole assertion: the request is made, and the deployment says no.
 */
import { stagingTest as test, expect, signInViaUi, requireIdentity, API_URL } from './staging-helpers';

/**
 * Shapes that must never appear in a deployed response body, each with its own positive control.
 *
 * The controls are ASSEMBLED AT RUNTIME rather than written as literals. A file containing a
 * credential-shaped string is a file the CR-1 secret scanner must reject — and it should reject it,
 * because "it is only a test fixture" is exactly what a real leak would also claim. Adding this file
 * to the scanner's allowlist would punch a permanent hole in it for the sake of a string that is not
 * a secret, so the string simply never exists on disk. The detector still receives the whole value.
 */
const FILLER = 'CONTROLVALUE0123456789ABCDEF';
const SECRET_SHAPES: Array<[label: string, re: RegExp, control: string]> = [
  ['Google access token', /ya29\.[A-Za-z0-9_-]{20,}/, ['ya29', '.', FILLER].join('')],
  ['Google refresh token', /1\/\/0[A-Za-z0-9_-]{20,}/, ['1', '/', '/', '0', FILLER].join('')],
  [
    'JWT-shaped credential',
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
    ['eyJ', FILLER, '.', FILLER, '.', FILLER].join(''),
  ],
  ['provider secret key', /sk_(live|test)_[A-Za-z0-9]{16,}/, ['sk', '_', 'test', '_', FILLER].join('')],
  [
    'Postgres connection string',
    /postgres(ql)?:\/\/[^\s"']+/,
    ['postgresql', '://', 'user', ':', FILLER, '@', 'db.example.invalid:5432/postgres'].join(''),
  ],
];

interface Probe { path: string; status: number; body: string }

/**
 * Issue requests carrying the deployment's REAL authenticated identity.
 *
 * The first version of this helper sent `credentials: 'include'` and no headers, which is a third
 * way to pass vacuously and the one that nearly shipped. This application has NO cookie session: the
 * backend's only `res.cookie` is the CSRF token, and auth travels as `x-user-id` / `x-session-token`
 * headers read from localStorage (`carup_user` / `carup_token`), with a CSRF token bound to exactly
 * that identity. So `credentials:'include'` sent nothing at all, every probe was anonymous, and every
 * 401 from the auth middleware satisfied `expect(status).toBeGreaterThanOrEqual(400)` while proving
 * precisely nothing about the fail-closed gates the file is named for.
 *
 * It is the same mistake as the 404 case, one layer further in: a refusal only counts when the
 * request reached the thing that is supposed to refuse it. `assertProbeIsAuthenticated` below is the
 * control that makes that checkable rather than assumed.
 */
async function probe(
  page: import('@playwright/test').Page,
  reqs: Array<{ path: string; method?: string; body?: unknown }>,
): Promise<Probe[]> {
  return page.evaluate(async ({ api, reqs }) => {
    // Mirror web/src/lib/apiClient.ts: identity headers from localStorage, then a CSRF token bound
    // to that identity for unsafe methods. A token fetched anonymously is guest-bound and rejected.
    const readUser = () => {
      try { return JSON.parse(localStorage.getItem('carup_user') || 'null'); } catch { return null; }
    };
    const auth: Record<string, string> = {};
    const user = readUser();
    const token = localStorage.getItem('carup_token');
    if (user?.id) auth['x-user-id'] = String(user.id);
    if (token) auth['x-session-token'] = token;
    if (user?.tenantId) auth['x-tenant-id'] = String(user.tenantId);

    let csrf = '';
    try {
      const cr = await fetch(`${api}/security/csrf-token`, { credentials: 'include', headers: { ...auth } });
      if (cr.ok) csrf = (await cr.json())?.csrfToken || '';
    } catch { /* leave empty; the assertions below report what actually happened */ }

    const out: Array<{ path: string; status: number; body: string }> = [];
    for (const r of reqs) {
      const method = r.method || 'GET';
      const headers: Record<string, string> = { ...auth };
      if (r.body) headers['Content-Type'] = 'application/json';
      if (method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
      try {
        const res = await fetch(`${api}${r.path}`, {
          method,
          credentials: 'include',
          headers,
          body: r.body ? JSON.stringify(r.body) : undefined,
        });
        out.push({ path: r.path, status: res.status, body: (await res.text()).slice(0, 6000) });
      } catch (e) {
        out.push({ path: r.path, status: 0, body: String(e) });
      }
    }
    return out;
  }, { api: API_URL, reqs });
}

/**
 * Positive control for the probe itself.
 *
 * Every refusal assertion in this file is only meaningful if the probe reaches the deployment AS AN
 * AUTHENTICATED USER. If auth breaks — a renamed storage key, a changed header, an expired fixture
 * identity — this fails loudly instead of letting every downstream 401 masquerade as a fail-closed
 * gate.
 *
 * THE CANARY MUST BE TENANT-AGNOSTIC, and the first version was not. It used
 * `GET /diaspora/subscription/status`, which answers 400 "An x-tenant-id context is required" for a
 * user with no tenant — and the staging fixtures ARE tenantless, because `switch-role` is fail-closed
 * and public registration yields a plain owner. So the control failed against a deployment where the
 * probe was in fact perfectly authenticated: it had conflated "not authenticated" with
 * "authenticated but tenantless", which is a different thing and not a reason to distrust the file.
 *
 * `GET /diaspora/subscription/plans` is the right canary. It needs a session and no tenant, and it
 * discriminates cleanly against the live deployment: 401 anonymous, 200 authenticated.
 *
 * The assertion is `not 401` rather than `< 400` for the same reason. Any answer other than "I do not
 * know who you are" proves the identity was accepted — a 400 about missing business context or a 403
 * about permissions both mean the request got PAST authentication, which is all this control needs.
 */
async function assertProbeIsAuthenticated(page: import('@playwright/test').Page) {
  const [me] = await probe(page, [{ path: '/diaspora/subscription/plans' }]);
  expect(me.status, `the probe never reached the deployment: ${me.body.slice(0, 200)}`).not.toBe(0);
  expect(
    me.status,
    `the probe is NOT authenticated (GET /diaspora/subscription/plans -> ${me.status}). Every ` +
      '"refusal" this file observes would then be an ordinary 401 from the auth middleware rather ' +
      `than a fail-closed gate, and the whole file would pass having verified nothing. Body: ${me.body.slice(0, 300)}`,
  ).not.toBe(401);
}

/** A refusal only counts when the route it came from exists and was reached. */
function expectReachedAndRefused(p: Probe, what: string) {
  expect(p.status, `${what}: request never reached the deployment (${p.body.slice(0, 200)})`).not.toBe(0);
  expect(
    p.status,
    `${what}: ${p.path} returned 404 — the route does not exist, so its "refusal" proves nothing. ` +
      'Fix the path rather than accepting this as a pass.',
  ).not.toBe(404);
  expect(p.status, `${what}: deployment ACCEPTED the request (${p.status}): ${p.body.slice(0, 400)}`).toBeGreaterThanOrEqual(400);
}

test.describe('the detectors are capable of firing', () => {
  test('every secret shape matches its own positive control', () => {
    for (const [label, re, control] of SECRET_SHAPES) {
      expect(re.test(control), `${label} detector does not match its own control — it can never fire`).toBe(true);
    }
  });
});

test.describe('live-risk surfaces refuse on the deployment', () => {
  test.skip(!requireIdentity('tenantAdmin'), 'no tenant-admin identity — see the gate in spec 36');

  test('billing checkout refuses an unapproved live provider', async ({ page }) => {
    await signInViaUi(page, 'tenantAdmin');
    await assertProbeIsAuthenticated(page);
    const [p] = await probe(page, [{
      path: '/diaspora/subscription/checkout',
      method: 'POST',
      body: { planKey: 'growth', provider: 'live-provider-probe' },
    }]);

    expectReachedAndRefused(p, 'billing checkout with a live provider');
    // A 4xx that still hands back a provider checkout link would be a refusal in status only.
    expect(p.body, 'the refusal body carries a checkout URL').not.toMatch(/https?:\/\/[^\s"]*checkout/i);
  });

  test('the Drive authorize endpoint hands out no live consent URL without owner credentials', async ({ page }) => {
    await signInViaUi(page, 'tenantAdmin');
    await assertProbeIsAuthenticated(page);
    const [p] = await probe(page, [{ path: '/diaspora/drive/google/authorize' }]);

    expect(p.status, 'the Drive authorize route does not exist on the deployment').not.toBe(404);

    if (p.status < 400) {
      // Succeeding means owner OAuth IS configured. Then the URL must be Google's real consent
      // endpoint, and it must never carry the client secret — a secret in a URL is a secret in every
      // browser history, proxy log and Referer header it passes through.
      expect(p.body, 'authorize succeeded but returned no Google consent URL').toMatch(/accounts\.google\.com/);
      expect(p.body, 'the authorize URL carries a client secret').not.toMatch(/client_secret/i);
      expect(p.body, 'the authorize URL has no PKCE challenge').toMatch(/code_challenge/);
    }
    // A refusal is the expected pre-activation state and is itself correct — no further assertion.
  });

  test('SafeTrade refuses a read on a transaction the caller does not own', async ({ page }) => {
    await signInViaUi(page, 'tenantAdmin');
    await assertProbeIsAuthenticated(page);
    // The list route establishes that the SafeTrade router is mounted at all. Without it, a 404 on
    // the detail probe below would be indistinguishable from a correct "no such transaction".
    const [list, detail] = await probe(page, [
      { path: '/diaspora/safetrade' },
      { path: '/diaspora/safetrade/00000000-0000-0000-0000-000000000000' },
    ]);

    expect(list.status, 'the SafeTrade router is not mounted on this deployment').not.toBe(404);
    expect(list.status, `SafeTrade list is unreachable: ${list.body.slice(0, 200)}`).not.toBe(0);

    // Participant-scoped read of an id the caller does not own: it must refuse, and it must refuse
    // deliberately rather than by crashing — a 500 here would mean the scoping check threw instead
    // of denying, which is a different code path with different guarantees.
    expect(detail.status, `SafeTrade detail returned a server error: ${detail.body.slice(0, 300)}`).toBeLessThan(500);
    expect(detail.status, `SafeTrade returned a transaction for an unowned id: ${detail.body.slice(0, 300)}`).toBeGreaterThanOrEqual(400);
  });
});

test.describe('deployed API responses carry no secrets', () => {
  test.skip(!requireIdentity('tenantAdmin'), 'no tenant-admin identity — see the gate in spec 36');

  test('the Drive readers never return token material', async ({ page }) => {
    await signInViaUi(page, 'tenantAdmin');
    await assertProbeIsAuthenticated(page);
    const probes = await probe(page, [
      { path: '/diaspora/drive/status' },
      { path: '/diaspora/drive/files' },
    ]);

    // At least one Drive route must have been reached, or this test asserted nothing at all.
    expect(
      probes.some((p) => p.status !== 0 && p.status !== 404),
      `no Drive route was reachable: ${JSON.stringify(probes.map((p) => [p.path, p.status]))}`,
    ).toBe(true);

    for (const p of probes) {
      if (p.status === 0 || p.status === 404) continue;
      for (const [label, re] of SECRET_SHAPES) {
        expect(p.body, `${p.path} response contains a ${label}`).not.toMatch(re);
      }
      // The sanitiser drops the token field entirely rather than masking it. A masked field means
      // the raw value reached the serialiser — a different and worse design than never carrying it.
      expect(p.body, `${p.path} carries an access_token or refresh_token field`).not.toMatch(/"(access|refresh)_token"\s*:/);
    }
  });

  test('the billing surfaces never return provider secrets', async ({ page }) => {
    await signInViaUi(page, 'tenantAdmin');
    await assertProbeIsAuthenticated(page);
    const probes = await probe(page, [
      { path: '/diaspora/subscription/status' },
      { path: '/diaspora/subscription/billing-health' },
    ]);

    expect(
      probes.some((p) => p.status !== 0 && p.status !== 404),
      `no billing route was reachable: ${JSON.stringify(probes.map((p) => [p.path, p.status]))}`,
    ).toBe(true);

    for (const p of probes) {
      if (p.status === 0 || p.status === 404) continue;
      for (const [label, re] of SECRET_SHAPES) {
        expect(p.body, `${p.path} response contains a ${label}`).not.toMatch(re);
      }
    }
  });

  test('the health endpoint exposes no connection string or credential', async ({ page }) => {
    const [p] = await probe(page, [{ path: '/health' }]);
    expect(p.status, `health is not reachable at ${API_URL}/health`).toBe(200);
    for (const [label, re] of SECRET_SHAPES) {
      expect(p.body, `health response contains a ${label}`).not.toMatch(re);
    }
  });
});
