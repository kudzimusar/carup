/**
 * OC-5R-REL-02 B/C/D — the deployed-UAT harness corrections hold the PRODUCT contract, not a
 * convenient one.
 *
 * The REL-01 deployed gates failed on four defects that were not REL-01's. Three were in the harness's
 * view of CarUp's navigation and organisation model and are corrected here WITHOUT changing the product:
 *
 *   B  spec 41 counted `aria-current` across BOTH navigation systems; its contract is exactly one active
 *      SIDEBAR destination. (The compact bar truthfully marks its own and is hidden by CSS above 1024px.)
 *   C  spec 45 assumed an operator was already inside their organisation after login. OC-5D's contract is
 *      authoritative: login never selects one; the person explicitly chooses it, one tap even with a single
 *      membership. The spec now asks through the real prompt/switcher — never by writing localStorage,
 *      setting a tenant header, or calling the active-tenant endpoint itself.
 *   D  spec 38's tablet tap failed because Playwright's auto-scroll cannot settle under the app's global
 *      smooth scrolling between a sticky header and a fixed bottom bar. The control is explicitly scrolled
 *      clear of both bars and tapped NORMALLY — never forced, and the bars are never touched.
 *
 * What these tests refuse is the easy way out: a weakened assertion, a bypass of the real UI, a forced
 * click. They run offline against the harness sources and the pure geometry decision.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const SPEC_38 = read('tests/agents/38-seller-staging-browser-golden.spec.ts');
const SPEC_41 = read('tests/agents/41-seller-phase-e-staging.spec.ts');
const SPEC_45 = read('tests/agents/45-trade-os-container-demo-staging.spec.ts');
const SPEC_48 = read('tests/agents/48-seller-home-comms-lifecycle-staging.spec.ts');
const HELPERS = read('tests/agents/staging-helpers.ts');
const SAFE_TAP = read('tests/agents/safe-tap.ts');
const SWITCHER = read('web/src/components/layout/OrganisationSwitcher.tsx');

const { clearBand, assessClearance, clearanceFailure } = await import(
  new URL('../../tests/agents/safe-tap-geometry.mjs', import.meta.url).href
);

/** The code between two markers (inclusive start, exclusive end), so a rule is checked where it lives. */
function between(source, start, end) {
  const i = source.indexOf(start);
  assert.ok(i >= 0, `marker not found: ${start}`);
  const j = source.indexOf(end, i + start.length);
  assert.ok(j > i, `end marker not found after: ${start}`);
  return source.slice(i, j);
}

// ── A (REL-02): the Seller lifecycle assertion is preserved, not weakened ──────────────────────────
test('A — spec 48 still asserts the visible Vehicle Passport, unweakened', () => {
  assert.ok(
    SPEC_48.includes("await expect(page.locator('body')).toContainText(/Vehicle Passport|Passport/i);"),
    'the Passport assertion must be exactly the one the moderator froze',
  );
});

// ── B: the navigation contract is the SIDEBAR's ────────────────────────────────────────────────────
test('B — spec 41 never counts aria-current across both navigation systems again', () => {
  assert.ok(!/page\.locator\(\s*['"]nav a\[aria-current="page"\]['"]\s*\)/.test(SPEC_41), 'the unscoped global count is the defect');
});

test('B — spec 41 asserts exactly ONE active sidebar destination, and WHICH one, on both routes', () => {
  assert.match(SPEC_41, /page\.locator\('aside > nav a\[aria-current="page"\]'\)/, 'scoped to the sidebar: the <aside>\'s own <nav>');
  const helper = between(SPEC_41, 'async function expectOneActiveSidebarDestination', 'async function clearIdentity');
  assert.match(helper, /toHaveCount\(1\)/);
  assert.match(helper, /toHaveAttribute\('href', href\)/, 'the single active link must be the current route, not merely any link');
  for (const route of ['/dashboard/garage', '/dashboard/evidence']) {
    assert.ok(SPEC_41.includes(`expectOneActiveSidebarDestination(page, '${route}')`), `${route} must be checked`);
  }
  // …and it still runs across all three viewports, as the brief requires.
  for (const v of ["name: 'desktop'", "name: 'tablet'", "name: 'mobile'"]) assert.ok(SPEC_41.includes(v), `viewport ${v} dropped`);
});

test('B — the product is NOT changed to make the harness pass: both navs keep their own aria-current', () => {
  const sidebar = read('web/src/components/layout/DashboardLayout.tsx');
  const compact = read('web/src/components/layout/CompactBottomNav.tsx');
  assert.match(sidebar, /aria-current=\{isActive \? 'page' : undefined\}/);
  assert.match(compact, /aria-current=\{active \? 'page' : undefined\}/);
});

// ── C: the organisation is chosen through the real UI ──────────────────────────────────────────────
test('C — the helper drives only the real prompt/switcher and waits on the product\'s own request', () => {
  const helper = between(HELPERS, 'export async function ensureActingForOrganisation', 'function readSavedPassword');
  assert.match(helper, /getByTestId\('organisation-badge'\)/);
  assert.match(helper, /getByTestId\('organisation-prompt'\)/);
  assert.match(helper, /Act for \.\*/, 'clicks the real "Act for …" control');
  assert.match(helper, /request\(\)\.method\(\) === 'PUT'/);
  assert.match(helper, /\/api\/auth\/active-tenant/, 'observes the product\'s own PUT on the wire');
  assert.match(helper, /response\.ok\(\)/, 'the selection must have been accepted');
  assert.match(helper, /toHaveAttribute\('aria-label', actingForName/, 'proves the new context in the UI');
  assert.match(helper, /toHaveCount\(0\)/, 'the prompt must be gone once an organisation is chosen');
});

test('C — the helper bypasses nothing: no storage writes, no tenant header, no direct endpoint call', () => {
  const helper = between(HELPERS, 'export async function ensureActingForOrganisation', 'function readSavedPassword');
  for (const forbidden of [
    /localStorage/, /sessionStorage/, /x-tenant-id/i, /setExtraHTTPHeaders/, /page\.route\(/, /request\.(put|post|get|fetch)\(/,
    /force:\s*true/, /addInitScript/, /\.evaluate\([^)]*(?:localStorage|sessionStorage)/,
  ]) {
    assert.ok(!forbidden.test(helper), `the helper must not use ${forbidden}`);
  }
});

test('C — the helper matches strings the PRODUCT actually renders', () => {
  assert.match(SWITCHER, /data-testid="organisation-badge"/);
  assert.match(SWITCHER, /data-testid="organisation-prompt"/);
  assert.match(SWITCHER, /aria-label=\{`Acting for \$\{label\}\. Change organisation`\}/);
  assert.match(SWITCHER, /Act for \{displayName\(m\)\}/);
  assert.match(SWITCHER, /method: 'PUT'|selectActiveTenant/);
});

test('C — spec 45 enters every operator and outsider session through explicit organisation selection', () => {
  assert.ok(!/await signIn\(page, 'operator'\)/.test(SPEC_45), 'a bare operator sign-in assumes an implicit organisation');
  assert.ok(!/await signIn\(page, 'outsider'\)/.test(SPEC_45), 'a bare outsider sign-in would make the tenant-isolation denial trivial');
  assert.match(SPEC_45, /operator: \/Hikari Co-Load\/i/);
  assert.match(SPEC_45, /outsider: \/Rival Freight\/i/);
  assert.ok((SPEC_45.match(/signInActingFor\(page, 'operator'\)/g) || []).length >= 8, 'every operator journey, including the responsive one');
  const wrapper = between(SPEC_45, 'async function signInActingFor', '\nstagingTest');
  assert.match(wrapper, /await signIn\(page, role\)/, 'it still signs in through the real login form first');
  assert.match(wrapper, /ensureActingForOrganisation\(page, organisation\)/);
});

test('C — spec 45 keeps its tenant assertions: the identity header and the create section are still required', () => {
  assert.ok(SPEC_45.includes("await expect(page.getByTestId('tradeos-identity-org')).toContainText('Hikari Co-Load');"));
  assert.ok(SPEC_45.includes("await expect(page.getByTestId('diaspora-container-create-section')).toBeVisible();"));
  assert.ok(SPEC_45.includes('expect(approveRes.status()).toBe(403);'), 'the rival-tenant 403 must remain');
  assert.ok(!SPEC_45.includes('localStorage.setItem'), 'no localStorage manipulation');
});

// ── D: the tap is explicit, measured and normal ────────────────────────────────────────────────────
test('D — geometry: the clear band is between the sticky header and the bottom bar', () => {
  assert.deepEqual(clearBand({ viewportHeight: 1180, header: { top: 0, bottom: 65 }, nav: { top: 1111, bottom: 1180 } }), { from: 65, to: 1111 });
  // desktop: the compact bar is display:none — a zero-height rect — and does not constrain the band
  assert.deepEqual(clearBand({ viewportHeight: 720, header: { top: 0, bottom: 65 }, nav: { top: 0, bottom: 0 } }), { from: 65, to: 720 });
  assert.deepEqual(clearBand({ viewportHeight: 720, header: null, nav: null }), { from: 0, to: 720 });
});

test('D — geometry: the gate\'s failing positions are NOT clear, the reproduced clear position is', () => {
  const bars = { viewportHeight: 1180, header: { top: 0, bottom: 65 }, nav: { top: 1111, bottom: 1180 } };
  // Playwright's 'end' alignment: the control at the very bottom edge, under the compact bar (scrollY 18)
  const underNav = assessClearance({ ...bars, cta: { top: 1136, bottom: 1180 } });
  assert.equal(underNav.clear, false);
  assert.equal(underNav.overlapWithNav, 69);
  assert.match(clearanceFailure(underNav), /under the compact bottom bar/);
  // Playwright's 'start' alignment: the control at the very top edge, under the sticky header (scrollY 1154)
  const underHeader = assessClearance({ ...bars, cta: { top: 0, bottom: 44 } });
  assert.equal(underHeader.clear, false);
  assert.equal(underHeader.overlapWithHeader, 65);
  assert.match(clearanceFailure(underHeader), /under the sticky header/);
  // the initial resting position: below the fold AND behind the bar
  const rest = assessClearance({ ...bars, cta: { top: 1154, bottom: 1198 } });
  assert.equal(rest.clear, false);
  assert.ok(rest.offscreen > 0);
  // one user-equivalent scroll to the middle: scrollY 586, control 568–612
  const centred = assessClearance({ ...bars, cta: { top: 568, bottom: 612 } });
  assert.equal(centred.clear, true);
  assert.equal(clearanceFailure(centred), '');
});

test('D — geometry: the band edges are inclusive, one pixel inside either bar is not clear', () => {
  const bars = { viewportHeight: 1180, header: { top: 0, bottom: 65 }, nav: { top: 1111, bottom: 1180 } };
  assert.equal(assessClearance({ ...bars, cta: { top: 65, bottom: 109 } }).clear, true);
  assert.equal(assessClearance({ ...bars, cta: { top: 64, bottom: 108 } }).clear, false);
  assert.equal(assessClearance({ ...bars, cta: { top: 1067, bottom: 1111 } }).clear, true);
  assert.equal(assessClearance({ ...bars, cta: { top: 1068, bottom: 1112 } }).clear, false);
});

test('D — the helper scrolls to the middle with an instant scroll, measures, then taps NORMALLY', () => {
  assert.match(SAFE_TAP, /scrollIntoView\(\{ block: 'center', inline: 'nearest', behavior: 'instant' \}\)/);
  assert.match(SAFE_TAP, /waitForScrollToSettle\(page\)/);
  assert.match(SAFE_TAP, /assessClearance\(/);
  assert.match(SAFE_TAP, /expect\(assessment\.clear/, 'a control that cannot be cleared FAILS the test, loudly');
  assert.match(SAFE_TAP, /centreHitTarget/);
  assert.match(SAFE_TAP, /expect\(m\.centreHitTarget, `\$\{label\}: something is on top of the control's centre`\)\.toBe\('the control'\);/, 'what is on top of the control\'s centre must be the control itself');
  assert.match(SAFE_TAP, /await target\.click\(\);/);
  const order = ['scrollIntoView', 'waitForScrollToSettle(page)', 'assessClearance(', 'await target.click();'].map((m) => SAFE_TAP.indexOf(m, SAFE_TAP.indexOf('export async function tapClearOfBars')));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'scroll → settle → measure → tap, in that order');
});

test('D — the helper never forces, hides or alters either bar, and never moves test pixels', () => {
  const code = SAFE_TAP.slice(SAFE_TAP.indexOf("import { expect"), SAFE_TAP.length);
  for (const forbidden of [
    /force:\s*true/, /pointer-events/i, /pointerEvents/, /setViewportSize/, /\.style\./, /display\s*=\s*['"]none/,
    /\.remove\(\)/, /dispatchEvent/, /click\(\{[^}]*force/, /addStyleTag/, /hidden\s*=/, /visibility/,
  ]) {
    assert.ok(!forbidden.test(code), `safe-tap must not use ${forbidden}`);
  }
});

test('D — spec 38 taps BOTH listing-page controls through the helper, with its assertions intact', () => {
  assert.match(SPEC_38, /import \{ tapClearOfBars \} from '\.\/safe-tap'/);
  assert.match(SPEC_38, /tapClearOfBars\(page, page\.getByTestId\('marketplace-inquiry-open'\)\.first\(\), testInfo, 'ask-about-vehicle'\)/);
  assert.match(SPEC_38, /tapClearOfBars\(page, inspectionTrigger, testInfo, 'request-inspection'\)/);
  assert.ok(!/inspectionTrigger\.click\(/.test(SPEC_38), 'the plain click was the defect');
  assert.ok(!/force:\s*true/.test(SPEC_38), 'no forced events');
  // the assertions around the taps are unchanged
  assert.ok(SPEC_38.includes("await expect(page.getByTestId('marketplace-inquiry-modal')).toBeVisible();"));
  assert.ok(SPEC_38.includes("expect([200, 201]).toContain(inquiryResponse.status());"));
  // the compact bar is still in the product, unchanged in authority
  const nav = read('web/src/components/layout/CompactBottomNav.tsx');
  assert.match(nav, /fixed inset-x-0 bottom-0 z-50/);
  assert.ok(!/pointer-events-none/.test(nav), 'the compact bar must not be made click-through');
});

// ── J: D7 is executed UNCHANGED, last, and its answers are recorded ────────────────────────────────
test('J — D7\'s assertions are exactly the original ones (relocated, not weakened)', () => {
  for (const line of [
    "expect(process.env.TRADEOS_WORKER_SECRET, 'TRADEOS_WORKER_SECRET must be set — D7 cannot be proven without draining the candidate runtime').toBeTruthy();",
    "expect(process.env.TRADEOS_WORKER_SECRET, 'TRADEOS_WORKER_SECRET must be set').toBeTruthy();",
    "rows.some((n: { notification_type?: string }) => n.notification_type === 'container_booking')",
    "await expect(page.getByText(/Container booking RES-/i).first()).toBeVisible({ timeout: 15_000 });",
    "headers: { 'x-session-token': token, 'x-tenant-id': 'c0106a0e-1a11-4a6a-9e01-000000000a01' },",
  ]) assert.ok(SPEC_45.includes(line), `D7 line missing or changed: ${line.slice(0, 80)}`);
  assert.equal((SPEC_45.match(/\}, \{ timeout: 45_000, intervals: \[2_000\] \}\)\.toBe\('present'\);/g) || []).length, 2, 'both D7 polls still require "present"');
  assert.ok(!/toBe\('absent'\)/.test(SPEC_45));
});

test('J — D7 sits LAST in the serial chain, so a D7 failure cannot hide the D7-independent journeys', () => {
  const titles = [...SPEC_45.matchAll(/^  stagingTest\('([^']+)'/gm)].map((m) => m[1]);
  assert.ok(/D7 direction/.test(titles.at(-1)) && /\(D7\)$/.test(titles.at(-2)), 'the two D7 tests are the final two');
  assert.equal(titles.findIndex((t) => /D7/.test(t)), titles.length - 2, 'no D7 test earlier in the chain');
  const independent = ['cross-tenant denial', 'December container', 'order passport carries', 'HARD GEOMETRY GATE', 'full-page visual evidence', 'responsive: participant', 'responsive: operator'];
  for (const name of independent) assert.ok(titles.slice(0, -2).some((t) => t.includes(name)), `${name} must run before D7`);
  assert.ok(!SPEC_45.includes('has activity/communication state'), 'the earlier participant test no longer carries D7');
  assert.match(SPEC_45, /stagingTest\.describe\.configure\(\{ mode: 'serial' \}\)/, 'the chain is still serial (the journeys share state)');
});

test('J — the candidate drain\'s answers are recorded, never swallowed, with only TRADEOS_WORKER_SECRET', () => {
  const drain = between(SPEC_45, 'async function drainOutbox', 'async function attachDrainEvidence');
  assert.match(drain, /process\.env\.TRADEOS_WORKER_SECRET/);
  assert.ok(!/process\.env\.(COMMUNICATION_WORKER_SECRET|CRON_SECRET)|\['(COMMUNICATION_WORKER_SECRET|CRON_SECRET)'\]/.test(SPEC_45 + HELPERS), 'no other backend secret is read by the harness');
  assert.match(drain, /\/internal\/events\/process/);
  assert.match(drain, /authorization: `Bearer \$\{secret\}`/);
  assert.match(drain, /drainResponses\.push\(\{ at: new Date\(\)\.toISOString\(\), status: response\.status\(\)/);
  assert.match(drain, /transport_error/);
  const evidence = between(SPEC_45, 'async function attachDrainEvidence', 'async function sessionToken');
  assert.match(evidence, /d7-drain-responses\.json/);
  assert.match(evidence, /console\.log\(`\[spec45\] \/internal\/events\/process answered/);
  assert.equal((SPEC_45.match(/await attachDrainEvidence\(testInfo\);/g) || []).length, 2, 'both D7 tests attach the evidence even when they fail');
  assert.ok(!/\.catch\(\(\) => undefined\);\s*\n\}/.test(drain), 'the drain no longer swallows its answer');
});

// ── C/J: the sweep's time ceiling is lifted for the two long tests ONLY, and nothing else is loosened ─
test('C — the multi-viewport geometry sweep and the visual-evidence capture set explicit test timeouts', () => {
  const geometry = between(SPEC_45, "stagingTest('HARD GEOMETRY GATE", "stagingTest('full-page visual evidence");
  assert.match(geometry, /stagingTest\.setTimeout\(240_000\);/, 'seven viewports + a real organisation selection need more than the 90 s default');
  const visual = between(SPEC_45, "stagingTest('full-page visual evidence", "stagingTest('responsive: participant journey state");
  assert.match(visual, /stagingTest\.setTimeout\(180_000\);/);
  // the sweep still asserts every overflow axis at every width
  for (const axis of ['geometry.doc', 'geometry.body', 'geometry.workspace']) assert.ok(geometry.includes(`expect(${axis},`), `${axis} overflow is still asserted`);
  assert.ok(geometry.includes('[[393, 852], [820, 1180], [1024, 768], [1280, 800], [1366, 768], [1440, 900], [1536, 864]]'), 'all seven widths are still swept');
});

test('C — the staging Playwright config keeps its strict defaults (no retries, 90 s suite ceiling, 15 s expect, 20 s action)', () => {
  const config = read('playwright.staging.config.ts');
  assert.match(config, /timeout:\s*90_000,/);
  assert.match(config, /expect:\s*\{\s*timeout:\s*15_000\s*\}/);
  assert.match(config, /retries:\s*0,/, 'a flaky retry must never mask a real defect');
  assert.match(config, /actionTimeout:\s*20_000/);
  assert.match(config, /workers:\s*1,/);
});
