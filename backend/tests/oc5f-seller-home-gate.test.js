/**
 * OC-5F slice F — spec 48 (Seller Home, Communications and the commerce lifecycle) and its gate.
 *
 * Spec 48 drives deployed staging, which OC-5 does not deploy, so it has never run. Its isolation,
 * and the one rule that makes its Communications test unsafe to run, are what can be proved here,
 * in seconds, on every push:
 *
 *   · the aggregate Diaspora gates run playwright.staging.config.ts's testMatch WHOLE, so spec 48 is
 *     not in it — it has its own config, the staging harness narrowed to spec 48 alone;
 *   · the workflow proves the governed preview pair before any identity is written, runs each
 *     viewport as that run's OWN Seller, runs only spec 48's config, and always sweeps;
 *   · the reserved automation marker spec 48 writes is exactly the one the product hides from
 *     ordinary discovery and the preview `fixture_scope` reveals (asserted on the product's code);
 *   · Phase Q stays `fixme` until owner decision D, and its inquiry can never carry a phone: a
 *     phone with the default preference binds the buyer's WhatsApp, where the Seller's reply goes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { filterVisibleVehicles } from '../services/marketplace/listingSummaryService.js';
import { goldenSellerIdentity, goldenSellerIdentitiesForRun } from '../../scripts/ci/golden-seller-identity.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(`${ROOT}${path}`, 'utf8');

const SPEC = '48-seller-home-comms-lifecycle-staging.spec.ts';
const SPEC_SOURCE = read(`tests/agents/${SPEC}`);
const WORKFLOW = yaml.load(read('.github/workflows/seller-home-lifecycle-staging-uat.yml'));
const PROJECTS = ['chromium', 'tablet-chromium', 'mobile-chromium'];

/** The `testMatch: /…/` literal of a Playwright config, as a RegExp. */
function testMatchOf(path) {
  const literal = /testMatch:\s*\/(.+)\/,\s*$/m.exec(read(path));
  assert.ok(literal, `${path} declares no testMatch literal`);
  return new RegExp(literal[1]);
}

const steps = () => WORKFLOW.jobs['seller-home-lifecycle'].steps;
const stepIndex = (pattern) => steps().findIndex((step) => pattern.test(`${step.name || ''}\n${step.run || ''}`));

test('the shared staging testMatch never matches spec 48: the aggregate gates run it whole', () => {
  const shared = testMatchOf('playwright.staging.config.ts');
  assert.ok(shared.test('38-seller-staging-browser-golden.spec.ts'), 'extraction sanity: the shared pattern still matches spec 38');
  assert.equal(shared.test(SPEC), false, 'spec 48 would join every aggregate Diaspora run');
  // Why it matters: these gates name no spec, so whatever the pattern matches, they run.
  for (const gate of ['diaspora-deployed-staging-shard.yml', 'diaspora-canonical-staging-uat.yml']) {
    assert.match(read(`.github/workflows/${gate}`), /npx playwright test --config=playwright\.staging\.config\.ts(?! tests\/)/);
  }
});

test('spec 48 has its own config: the staging harness unchanged, narrowed to spec 48 alone', () => {
  const source = read('playwright.staging.seller-home.config.ts');
  assert.match(source, /import staging from '\.\/playwright\.staging\.config'/);
  assert.match(source, /\.\.\.staging,/, 'globalSetup, projects, timeouts and retries come from the staging harness');
  const own = testMatchOf('playwright.staging.seller-home.config.ts');
  const agents = readdirSync(`${ROOT}tests/agents`).filter((file) => file.endsWith('.ts'));
  assert.deepEqual(agents.filter((file) => own.test(file)), [SPEC]);
});

test('the gate: the governed pair before any identity write, then this run\'s Sellers, then spec 48 per viewport, then a sweep', () => {
  const job = WORKFLOW.jobs['seller-home-lifecycle'];
  assert.equal(job.env.STAGING_RUN_ID, 'seller-${{ github.run_id }}-${{ github.run_attempt }}');
  assert.equal(job.env.EXPECTED_STAGING_PROJECT_REF, 'eoyenigwevnxwwhyhaer');

  const pair = stepIndex(/resolve-governed-preview-pair\.mjs/);
  const provision = stepIndex(/bootstrap-staging-uat-identities\.mjs/);
  const sweep = stepIndex(/Retire anything this run left in commerce/);
  assert.ok(pair >= 0 && provision > pair, 'no identity is written before the preview pair is proved');
  assert.ok(sweep > provision);

  for (const project of PROJECTS) {
    const index = stepIndex(new RegExp(`--project=${project}$`, 'm'));
    assert.ok(index > provision, `${project} runs after provisioning`);
    const { run, if: condition } = steps()[index];
    assert.match(run, new RegExp(`golden-seller-identity\\.mjs "\\$STAGING_RUN_ID" ${project}\\)"\\n`), `${project} runs as its OWN Seller`);
    assert.match(run, new RegExp(`--config=playwright\\.staging\\.seller-home\\.config\\.ts --project=${project}$`, 'm'));
    assert.match(condition, /steps\.provision\.outcome == 'success'/);
    assert.match(condition, /!cancelled\(\)/, 'a desktop failure does not hide tablet and mobile');
  }

  const text = read('.github/workflows/seller-home-lifecycle-staging-uat.yml');
  assert.doesNotMatch(text, /--config=playwright\.staging\.config\.ts/, 'the gate runs spec 48\'s own config only');
  assert.doesNotMatch(text, /randomBytes/, 'no shared identity is rotated to a random password underneath another gate');
  assert.match(steps()[sweep].if, /always\(\)/);
  assert.match(steps()[sweep].run, /startsWith\('JTHL'\)/);
  assert.match(SPEC_SOURCE, /return `JTHL\$\{family\}\$\{projectToken\}\$\{runToken\}`;/, 'the sweep and the spec agree on the VIN family');

  assert.match(WORKFLOW.concurrency.group, /^staging-preview-/);
  assert.equal(WORKFLOW.concurrency['cancel-in-progress'], false);
});

test('every Seller the workflow derives is one the bootstrap mints, and the one spec 48 demands', () => {
  const runId = 'seller-37255370913-2';
  const minted = goldenSellerIdentitiesForRun(runId).map((seller) => seller.email);
  const short = Object.fromEntries([...SPEC_SOURCE.matchAll(/^\s+'?([a-z-]+)'?: '(chromium|tablet|mobile)',$/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(short), PROJECTS);
  assert.match(SPEC_SOURCE,
    /const expected = `golden\.seller\.\$\{match!\[1\]\}-\$\{match!\[2\]\}-\$\{PROJECT_SHORT\[project\]\}@carup-staging\.test`;/);
  for (const project of PROJECTS) {
    const derived = goldenSellerIdentity(runId, project).email;
    assert.ok(minted.includes(derived));
    assert.equal(`golden.seller.37255370913-2-${short[project]}@carup-staging.test`, derived);
  }
});

test('spec 48 runs only as its own Seller, and checks that in every test', () => {
  const signIns = [...SPEC_SOURCE.matchAll(/signInViaUi\(page, '([A-Za-z]+)'\)/g)].map((m) => m[1]);
  assert.ok(signIns.length >= 2);
  assert.deepEqual([...new Set(signIns)], ['goldenSeller']);
  const tests = SPEC_SOURCE.match(/^\s+test(?:\.fixme)?\('/gm) || [];
  const guarded = SPEC_SOURCE.match(/^\s+requireOwnSeller\(testInfo\.project\.name\);$/gm) || [];
  assert.equal(tests.length, 2);
  assert.equal(guarded.length, tests.length);
});

test('the marker spec 48 writes is exactly what the product hides, and what the preview scope reveals', () => {
  assert.match(SPEC_SOURCE, /const AUTOMATION_MARKER = `Golden Dynamic Seller \$\{RUN_ID\}:`;/);
  assert.match(SPEC_SOURCE, /description: `\$\{AUTOMATION_MARKER\} /);

  const scope = 'seller-37255370913-2';
  const routes = read('backend/routes/marketplaceRoutes.js');
  assert.match(routes, /!\/\^seller-\[0-9\]\+-\[0-9\]\+\$\/\.test\(scope\)/, 'the route only honours seller-<run>-<attempt>');
  assert.ok(/^seller-[0-9]+-[0-9]+$/.test(scope));

  const listing = {
    vin: 'JTHLCCHR553709132',
    status: 'Available',
    publication_status: 'published',
    seller_description: `Golden Dynamic Seller ${scope}: OC-5F Home and lifecycle fixture (spec 48), staging only.`,
    owner_id: 'u_golden_37255370913_2_chromium',
  };
  const visible = (fixtureScope) => filterVisibleVehicles([listing], { showFixtures: false, fixtureScope }).length;
  assert.equal(visible(undefined), 0, 'ordinary discovery never shows it');
  assert.equal(visible(scope), 1, 'its own run scope reveals it');
  assert.equal(visible('seller-37255370913-1'), 0, 'another run\'s scope does not');
  assert.equal(filterVisibleVehicles([{ ...listing, status: 'Sold' }], { showFixtures: false, fixtureScope: scope }).length, 0,
    'a sold listing leaves even its own scope');
});

test('Phase Q stays fixme until owner decision D, and its inquiry can never carry a phone', () => {
  assert.match(SPEC_SOURCE, /^\s+test\.fixme\('Q: /m);
  assert.doesNotMatch(SPEC_SOURCE, /^\s+test\('Q: /m);
  assert.doesNotMatch(SPEC_SOURCE, /marketplace-inquiry-phone'\)\.fill\(/, 'a phone binds the buyer\'s WhatsApp');
  assert.match(SPEC_SOURCE, /getByTestId\('marketplace-inquiry-phone'\), 'the inquiry must carry no phone'\)\.toHaveValue\(''\)/);
  assert.match(SPEC_SOURCE, /chooseFromSelect\(page, page\.getByTestId\('marketplace-inquiry-preferred-contact'\), \/\^Email\$\/\)/);
  assert.match(SPEC_SOURCE, /@example\.test`\);/, 'a reserved, undeliverable address');
});
