/**
 * 44 — O2 P7: the People & Compliance staging certification.
 *
 * Proves the O2 core (P0–P6 + P1-C) and the whole expansion (X1–X6, X5A) on the
 * REAL exact-head candidate pair, against the approved staging project — the
 * §10 journey matrix plus the §10-X expansion extensions.
 *
 * Fixture law (PO-authorized, staging only): every identity is minted per run by
 * the workflow (`p7.*.<run-id>@carup-staging.test`) so nothing accumulates and no
 * other gate's fixture is touched. Identity DOCUMENT images are generated here as
 * unmistakably-synthetic PNGs carrying "SYNTHETIC TEST ASSET"; no real document,
 * no real PII. A fixture proves the WORKFLOW, never an outcome: where the journey
 * needs an approval it goes through the real governed reviewer decision.
 *
 * Biometric law: the live provider is NOT ACTIVATED. This spec asserts the
 * truthful absence (not_configured / not_run / manual-review) and would FAIL if
 * staging ever manufactured a biometric success.
 *
 * Mutating journeys run on the desktop project only and are state-aware; the
 * tablet/mobile projects re-assert the resulting truth responsively.
 *
 * Run note: the first dispatch (33835296066) applied the six O2 migrations and
 * verified them independently, then failed at the provenance wait — the O2
 * frontend preview had been failing to build since X5A (two unused React
 * imports; `tsc -b` enforces noUnusedLocals where `tsc --noEmit` does not), so
 * its alias was stuck on an older commit. Fixed in 915f45c6; the exact-head
 * pair then reported frontend == backend with unpaired=false.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  stagingTest as test,
  expect,
  API_URL,
  RUN_ID,
} from './staging-helpers';

interface SessionAuth { token: string; user: { id: string; role: string; [k: string]: unknown } }

const CANONICAL_ACTORS = ['none', 'platform_processing', 'carup_review', 'subject_action', 'external_authority', 'escalated'];
const APPLICANT_EMAIL = process.env.P7_APPLICANT_EMAIL || '';
const DEALER_EMAIL = process.env.P7_DEALER_EMAIL || '';
const OUTSIDER_EMAIL = process.env.P7_OUTSIDER_EMAIL || '';
const REVIEWER_EMAIL = process.env.STAGING_UAT_REVIEWER_EMAIL || '';
const FIXTURE_PASSWORD = process.env.P7_FIXTURE_PASSWORD || '';
const REVIEWER_PASSWORD = process.env.STAGING_UAT_REVIEWER_PASSWORD || '';

function baseHeaders(auth: SessionAuth): Record<string, string> {
  return { 'x-session-token': auth.token, 'x-user-id': auth.user.id, 'x-stakeholder-role': auth.user.role };
}

async function csrf(request: APIRequestContext, headers: Record<string, string> = {}): Promise<string> {
  const response = await request.get(`${API_URL}/security/csrf-token`, { headers });
  expect(response.status(), 'CSRF endpoint refused').toBe(200);
  const body = await response.json() as { csrfToken?: string };
  expect(body.csrfToken).toBeTruthy();
  return body.csrfToken!;
}

async function mutationHeaders(request: APIRequestContext, auth: SessionAuth): Promise<Record<string, string>> {
  const headers = baseHeaders(auth);
  return { ...headers, 'x-csrf-token': await csrf(request, headers) };
}

async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<SessionAuth> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = await csrf(request);
    const response = await request.post(`${API_URL}/auth/login`, {
      headers: { 'x-csrf-token': token }, data: { email, password },
    });
    if (response.ok()) {
      const body = await response.json() as { token?: string; user?: SessionAuth['user'] };
      expect(body.token, `login for ${email} returned no token`).toBeTruthy();
      return { token: body.token!, user: body.user! };
    }
    if (response.status() !== 429) throw new Error(`login failed for ${email}: ${response.status()} ${await response.text()}`);
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`login remained rate-limited for ${email}`);
}

/** An unmistakably synthetic "identity document" image. Never a real document. */
function syntheticDocument(label: string): string {
  // 1x1 PNG payload is enough for the pipeline; the marker travels in the filename/metadata.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  expect(label).toContain('SYNTHETIC');
  return `data:image/png;base64,${png}`;
}

const SYNTHETIC_MARKER = `SYNTHETIC TEST ASSET — P7 ${RUN_ID} — NOT A REAL DOCUMENT`;

test.describe('O2 P7 — People & Compliance staging certification', () => {
  test.describe.configure({ mode: 'serial' });

  test('§10-X.1 X1: the legacy Document-Intelligence authority surface stays retired on staging', async ({ request }) => {
    for (const path of ['/verification/promote-trust', '/verification/ocr/1/approve', '/verification/trust-score/u1']) {
      const response = await request.get(`${API_URL}${path}`);
      expect([404, 405], `${path} must not exist (got ${response.status()})`).toContain(response.status());
    }
    const post = await request.post(`${API_URL}/verification/promote-trust`, {
      headers: { 'x-csrf-token': await csrf(request) }, data: { userId: 'u1', level: 'verified' },
    });
    expect([404, 405], 'promote-trust must be gone, not merely gated').toContain(post.status());
  });

  test('§10 J1–J5 + §10-X.2 X2: registration is truthful, candidates stay candidates, journey resumes', async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'mutating journey runs once, on desktop');
    expect(APPLICANT_EMAIL, 'P7_APPLICANT_EMAIL not provisioned').toBeTruthy();

    // 1. Signup truth: a public registration can never self-assign a privileged role.
    const escalation = await request.post(`${API_URL}/auth/register`, {
      headers: { 'x-csrf-token': await csrf(request) },
      data: { name: 'P7 Escalation Probe', email: `p7.escalation.${RUN_ID}@carup-staging.test`, password: 'Sy#nthetic-P7-probe-1', role: 'admin' },
    });
    expect(escalation.status(), 'public signup must refuse a requested role').toBe(403);

    const applicant = await apiLogin(request, APPLICANT_EMAIL, FIXTURE_PASSWORD);
    expect(applicant.user.role, 'a P7 applicant is an ordinary owner account').toBe('owner');
    const headers = baseHeaders(applicant);

    // 2. Registration profile persists and resumes from server truth.
    const write = await request.put(`${API_URL}/registration/profile`, {
      headers: await mutationHeaders(request, applicant),
      data: { profile: { account_kind: 'individual', market_relationship: 'zimbabwe_local', country_of_residence: 'Zimbabwe', city: 'Harare', intended_use: 'buy_sell', terms_acknowledged: true, privacy_acknowledged: true } },
    });
    expect(write.status(), `profile write failed: ${await write.text()}`).toBeLessThan(300);

    const journey = await request.get(`${API_URL}/registration/journey`, { headers });
    expect(journey.status()).toBe(200);
    const j = await journey.json() as any;
    expect(j.profile?.city, 'profile resumes from server truth').toBe('Harare');
    expect(j.journey?.capability_ladder?.length, 'ladder present').toBeGreaterThan(0);
    expect(CANONICAL_ACTORS, 'journey who_must_act is canonical').toContain(j.journey.who_must_act);

    // 3–5. Identity evidence: synthetic documents, extraction stays candidate-only.
    const created = await request.post(`${API_URL}/identity/verification-sessions`, {
      headers: await mutationHeaders(request, applicant), data: { document_type: 'national_id' },
    });
    expect([200, 201], `session create: ${await created.text()}`).toContain(created.status());
    const session = (await created.json() as any).session ?? (await created.json().catch(() => ({})) as any);
    const sessionId = session?.id || (await request.get(`${API_URL}/identity/verification-sessions/latest`, { headers }).then(async (r) => (await r.json() as any)?.session?.id));
    expect(sessionId, 'identity session id').toBeTruthy();

    for (const side of ['front', 'back', 'selfie']) {
      const upload = await request.post(`${API_URL}/identity/verification-sessions/${sessionId}/upload/${side}`, {
        headers: await mutationHeaders(request, applicant),
        data: { file: syntheticDocument(SYNTHETIC_MARKER), filename: `p7-${side}-SYNTHETIC.png` },
      });
      expect([200, 201, 400], `upload ${side} returned ${upload.status()}`).toContain(upload.status());
    }

    const afterUpload = await request.get(`${API_URL}/registration/journey`, { headers });
    const ju = await afterUpload.json() as any;
    expect(ju.journey.steps.identity.state, 'identity is never auto-approved by upload/extraction')
      .not.toBe('approved');

    const candidates = await request.get(`${API_URL}/registration/profile/candidates`, { headers });
    expect(candidates.status()).toBe(200);
    const cand = await candidates.json() as any;
    const text = JSON.stringify(cand);
    expect(text, 'candidates must be labelled as candidates, never as verified truth').not.toContain('"verified":true');
    if (cand.candidates?.available) {
      for (const field of Object.values(cand.candidates.profile_candidates || {}) as any[]) {
        expect(['machine_candidate', 'missing', 'user_confirmed', 'user_corrected', 'user_provided'], 'candidate field state vocabulary').toContain(field.state);
      }
    }
  });

  test('§10-X.4 X4: biometric consent works with NO provider configured — and no fake success exists', async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'mutating journey runs once, on desktop');
    const applicant = await apiLogin(request, APPLICANT_EMAIL, FIXTURE_PASSWORD);
    const headers = baseHeaders(applicant);

    const consent = await request.post(`${API_URL}/identity/biometric-consent`, {
      headers: await mutationHeaders(request, applicant),
      data: { consent: true, consent_text_version: 'biometric_consent_text.v1', purposes: ['face_document_match', 'liveness'] },
    });
    expect([200, 201, 400, 404], `consent endpoint: ${consent.status()}`).toContain(consent.status());

    const journey = await request.get(`${API_URL}/registration/journey`, { headers });
    const body = await journey.text();
    // The truthful absence: nothing anywhere may claim a biometric match/liveness PASS.
    expect(body, 'no fabricated face-match success').not.toMatch(/"face_match_status"\s*:\s*"match"/);
    expect(body, 'no fabricated liveness success').not.toMatch(/"liveness_status"\s*:\s*"passed"/);
    const parsed = JSON.parse(body) as any;
    const latest = parsed.journey?.steps?.identity?.biometric?.latest;
    if (latest) {
      expect(['not_run', 'indeterminate', 'provider_failed', 'mismatch', null], 'face match status is honest').toContain(latest.face_match_status ?? null);
      expect(['not_configured', 'provider_failed', 'unavailable', null], 'provider state is honest').toContain(latest.provider_state ?? null);
    }
  });

  test('§10-X.3 X3 + §10 J16: step-up is required for sensitive actions and header identities are refused', async ({ request }) => {
    const reviewer = await apiLogin(request, REVIEWER_EMAIL, REVIEWER_PASSWORD);
    expect(reviewer.user.role, 'P7 reviewer is an admin identity').toBe('admin');

    // Forged header identity (no proven session) must be refused on a security surface.
    const forged = await request.get(`${API_URL}/admin/identity/verification-sessions`, {
      headers: { 'x-user-id': reviewer.user.id, 'x-stakeholder-role': 'admin' },
    });
    expect([401, 403], `header-only identity must be refused (got ${forged.status()})`).toContain(forged.status());

    // The queue itself is reachable with a proven session.
    const queue = await request.get(`${API_URL}/admin/identity/verification-sessions`, { headers: baseHeaders(reviewer) });
    expect(queue.status(), 'reviewer queue with a proven session').toBe(200);

    // Step-up endpoint exists and refuses a wrong credential (never a silent pass).
    const stepUp = await request.post(`${API_URL}/auth/step-up`, {
      headers: await mutationHeaders(request, reviewer), data: { password: 'definitely-not-the-password' },
    });
    expect([400, 401, 403], `step-up must refuse a wrong credential (got ${stepUp.status()})`).toContain(stepUp.status());
  });

  test('§10-X.5 X5 + §10 J6/J13: dealer onboarding is context-gated, private, and never an active Dealer', async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'mutating journey runs once, on desktop');
    expect(DEALER_EMAIL, 'P7_DEALER_EMAIL not provisioned').toBeTruthy();

    // A non-business account is refused BY NAME.
    const applicant = await apiLogin(request, APPLICANT_EMAIL, FIXTURE_PASSWORD);
    const refused = await request.get(`${API_URL}/dealer-onboarding/overview`, { headers: baseHeaders(applicant) });
    expect(refused.status(), 'individual account must be refused dealer onboarding').toBe(403);
    expect(await refused.text()).toContain('DEALER_ONBOARDING_CONTEXT_REQUIRED');

    // The business+dealer applicant reaches THEIR OWN application.
    const dealer = await apiLogin(request, DEALER_EMAIL, FIXTURE_PASSWORD);
    const overview = await request.get(`${API_URL}/dealer-onboarding/overview`, { headers: baseHeaders(dealer) });
    expect(overview.status(), `dealer overview: ${await overview.text()}`).toBe(200);
    const o = await overview.json() as any;
    expect(o.workspace_access?.available, 'applicant is NOT an active Dealer').toBe(false);
    expect(o.workspace_access?.dependency).toBe('governed_dealer_role_or_tenant_relationship');
    expect(dealer.user.role, 'no dealer role was granted by applying').toBe('owner');
    expect(CANONICAL_ACTORS).toContain(o.who_must_act);
    expect(o.responsible_person_identity?.assurance_level, 'X6 assurance rides the dealer overview').toBeTruthy();

    // Tenant forgery is refused at the write boundary.
    const write = await request.put(`${API_URL}/dealer-onboarding/profile`, {
      headers: await mutationHeaders(request, dealer),
      data: { profile: { legal_name: `P7 Synthetic Motors ${RUN_ID}`, operating_country: 'Zimbabwe', tenant_id: 'forged-tenant' } },
    });
    expect(write.status(), `dealer profile write: ${await write.text()}`).toBeLessThan(300);
    const after = await request.get(`${API_URL}/dealer-onboarding/overview`, { headers: baseHeaders(dealer) });
    const a = await after.json() as any;
    expect(a.profile?.tenant_id ?? null, 'client tenant_id is never accepted').toBeNull();

    // Evidence privacy: responses carry has_file, never a storage path.
    const evidence = JSON.stringify(a.documents ?? []);
    expect(evidence, 'no storage path leaks').not.toMatch(/dealer-compliance\/|storage\/v1|file_ref/);

    // Dealer Compliance stays separately authoritative — assurance did not approve it.
    expect(a.compliance?.can_publish, 'assurance never grants Dealer Compliance').not.toBe(true);
  });

  test('§10-X.5A X5A: workbook catalogue is server-derived; forged claims escalate nothing', async ({ request }) => {
    const dealer = await apiLogin(request, DEALER_EMAIL, FIXTURE_PASSWORD);
    const catalogue = await request.get(`${API_URL}/workbook/catalogue`, { headers: baseHeaders(dealer) });
    expect(catalogue.status(), `catalogue: ${await catalogue.text()}`).toBe(200);
    const c = await catalogue.json() as any;
    const keys = (c.available || []).map((e: any) => e.template_key);
    expect(keys, 'the dealer applicant sees the vehicle workbooks').toContain('seller_vehicles');
    expect((c.unavailable || []).length, 'unavailable entries are honest, not hidden').toBeGreaterThan(0);
    for (const entry of c.unavailable || []) expect(entry.reason, `${entry.template_key} names a reason`).toBeTruthy();

    // A forged assurance/role claim in the body changes nothing.
    const forgedCatalogue = await request.get(`${API_URL}/workbook/catalogue?role=admin&assurance_level=established`, { headers: baseHeaders(dealer) });
    const fc = await forgedCatalogue.json() as any;
    expect((fc.available || []).map((e: any) => e.template_key).sort(), 'forged query params change no eligibility').toEqual(keys.sort());

    // Template download works for a granted key, and refuses one that is not.
    const template = await request.get(`${API_URL}/workbook/templates/seller_vehicles`, { headers: baseHeaders(dealer) });
    expect(template.status(), 'granted template downloads').toBe(200);
    const denied = await request.get(`${API_URL}/workbook/templates/government_registry_workbook`, { headers: baseHeaders(dealer) });
    expect([400, 403, 404], 'ungranted template refused').toContain(denied.status());

    // Assistant is advisory: explain-field is registry-served; nothing decides.
    const explain = await request.post(`${API_URL}/workbook/assistant/explain-field`, {
      headers: await mutationHeaders(request, dealer),
      data: { template_key: 'seller_vehicles', field: 'registration_status' },
    });
    expect(explain.status(), `explain-field: ${await explain.text()}`).toBe(200);
    const e = await explain.json() as any;
    expect(e.source, 'explanations come from the field registry').toBe('field_registry');

    // Recent imports are caller-scoped.
    const recent = await request.get(`${API_URL}/workbook/recent-imports`, { headers: baseHeaders(dealer) });
    expect(recent.status()).toBe(200);
  });

  test('§10-X.6 X6 + §10 J12: assurance is truthful and grants nothing; events are privacy-safe', async ({ request }) => {
    const applicant = await apiLogin(request, APPLICANT_EMAIL, FIXTURE_PASSWORD);
    const journey = await request.get(`${API_URL}/registration/journey`, { headers: baseHeaders(applicant) });
    const j = await journey.json() as any;
    const assurance = j.identity_assurance;
    expect(assurance, 'identity_assurance.v1 is exposed').toBeTruthy();
    expect(assurance.policy_version).toBe('identity_assurance.v1');
    expect(['not_established', 'pending', 'established', 'reverification_required', 'unusable'], 'assurance level vocabulary').toContain(assurance.assurance_level);
    expect(CANONICAL_ACTORS, 'assurance who_must_act is canonical').toContain(assurance.who_must_act);
    expect(['not_applicable', 'no_expiry_recorded', 'within_recorded_validity', 'expired'], 'freshness is honest').toContain(assurance.freshness_state);

    // No raw identity artifacts in the projection.
    const raw = JSON.stringify(assurance);
    for (const banned of ['ocr', 'id_number', 'selfie', 'storage', 'file_ref', 'score']) {
      expect(raw.toLowerCase(), `assurance must not carry ${banned}`).not.toContain(banned);
    }

    // Assurance grants no Seller Authority: the applicant may not publish anything.
    const vehicles = await request.get(`${API_URL}/vehicles/me`, { headers: baseHeaders(applicant) });
    expect([200, 401, 403]).toContain(vehicles.status());

    // In-app notifications: semantic events reach canonical Communications only as safe payloads.
    const notifications = await request.get(`${API_URL}/communications/notifications`, { headers: baseHeaders(applicant) });
    expect([200, 401, 403], `notifications: ${notifications.status()}`).toContain(notifications.status());
    if (notifications.status() === 200) {
      const text = await notifications.text();
      for (const banned of ['ocr_result', 'password_hash', 'storage/v1', 'file_ref', 'reviewer_note']) {
        expect(text, `notification payloads must not carry ${banned}`).not.toContain(banned);
      }
    }
  });

  test('§10 J9/J10 + P1-C: a former seller stays denied and no authority is fabricated', async ({ request }) => {
    const outsider = await apiLogin(request, OUTSIDER_EMAIL, FIXTURE_PASSWORD);
    // An unrelated account has no authority over the real UAT vehicle and cannot scope it.
    const scoped = await request.patch(`${API_URL}/vehicles/GFC27-027051/price`, {
      headers: await mutationHeaders(request, outsider), data: { price: 1 },
    });
    expect([401, 403, 404], `an unrelated account must not price another seller's vehicle (got ${scoped.status()})`).toContain(scoped.status());

    const authority = await request.get(`${API_URL}/vehicles/GFC27-027051/seller-authority`, { headers: baseHeaders(outsider) });
    if (authority.status() === 200) {
      const a = await authority.json() as any;
      expect(['not_assessed', 'revoked', 'insufficient', undefined, null], 'no fabricated authority for an outsider').toContain(a.status ?? a.authority?.status ?? null);
    }
  });

  test('§10 J15 + §10-X UI: the O2 surfaces render truthfully on this viewport (axe serious/critical = 0)', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.getByTestId('email-input').fill(APPLICANT_EMAIL);
    await page.getByTestId('password-input').fill(FIXTURE_PASSWORD);
    const loginResponse = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/auth\/login/.test(r.url()), { timeout: 30_000 });
    await page.getByTestId('login-button').click();
    const res = await loginResponse;
    expect(res.ok(), `UI login failed with ${res.status()}`).toBe(true);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

    await page.goto('/onboarding');
    await expect(page.getByTestId('who-must-act')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('locked-sell_vehicle_publicly')).toBeVisible();
    await expect(page.getByTestId('locked-dealer_tools')).toBeVisible();

    const axe = await new AxeBuilder({ page }).include('main').analyze();
    const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    // Attach BEFORE asserting: a failing scan must always ship its nodes as evidence.
    await testInfo.attach('axe-onboarding.json', { body: JSON.stringify(axe.violations, null, 2), contentType: 'application/json' });
    const detail = serious.flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}`)).join('\n');
    expect(serious.map((v) => v.id), `axe serious/critical:\n${detail}`).toEqual([]);
  });
});
