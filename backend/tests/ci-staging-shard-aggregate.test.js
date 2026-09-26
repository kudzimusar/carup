/**
 * The aggregate gate, and the scheduling lock.
 *
 * Sharding the deployed-staging gate is only safe if the aggregate is stricter than the shards. Three
 * green viewports are not a pass on their own: they have to have certified the SAME candidate against
 * the SAME pairing, and all three must have run.
 *
 * These are the tripwires for that, plus the cross-workflow lock that stops two staging gates
 * colliding on one preview backend.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';

const SCRIPT = 'scripts/ci/assert-staging-shards-agree.mjs';
const PROJECTS = ['chromium', 'tablet-chromium', 'mobile-chromium'];

const record = (project, over = {}) => ({
  branch: 'feat/trade-os-client-demo-convergence',
  sha: '1daca48f0000000000000000000000000000abcd',
  frontend: 'https://carup-staging-git-feat-trade-os-client-demo-convergence-11-11.vercel.app',
  backend: 'https://carup-backend-staging-git-feat-trade-os-client-dem-dbf311-11-11.vercel.app',
  api_base_url: 'https://carup-backend-staging-git-feat-trade-os-client-dem-dbf311-11-11.vercel.app',
  unpaired: false,
  deployment_id: 'dpl_x',
  staging_project_ref: 'eoyenigwevnxwwhyhaer',
  project,
  ...over,
});

function aggregate(records) {
  const dir = mkdtempSync(join(tmpdir(), 'shards-'));
  for (const r of records) {
    // Artifacts land in per-artifact subdirectories; mirror that shape.
    const sub = join(dir, `staging-pairing-${r.project}`);
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'staging-pairing.json'), JSON.stringify(r));
  }
  try {
    execFileSync('node', [SCRIPT, dir, ...PROJECTS], { stdio: 'pipe' });
    return { ok: true, output: '' };
  } catch (err) {
    return { ok: false, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

test('AGGREGATE: three shards certifying the same candidate pass — the positive control', () => {
  const r = aggregate(PROJECTS.map((p) => record(p)));
  assert.equal(r.ok, true, r.output);
});

test('AGGREGATE: a MISSING shard fails — one green viewport is not enough', () => {
  // Tripwire 11: mobile never reported.
  const r = aggregate([record('chromium'), record('tablet-chromium')]);
  assert.equal(r.ok, false);
  assert.match(r.output, /no pairing record from the "mobile-chromium" shard/);
});

test('AGGREGATE: shards on DIFFERENT SHAs fail — a deployment that moved is not one candidate', () => {
  // Tripwire 12.
  const r = aggregate([
    record('chromium'),
    record('tablet-chromium', { sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }),
    record('mobile-chromium'),
  ]);
  assert.equal(r.ok, false);
  assert.match(r.output, /shards disagree on "sha"/);
});

test('AGGREGATE: shards on different BACKENDS fail', () => {
  const r = aggregate([
    record('chromium'),
    record('tablet-chromium'),
    record('mobile-chromium', { backend: 'https://carup-backend-staging-git-some-other-branch-11-11.vercel.app' }),
  ]);
  assert.equal(r.ok, false);
  assert.match(r.output, /shards disagree on "backend"/);
});

test('AGGREGATE: a shard that ran UNPAIRED fails', () => {
  const r = aggregate([
    record('chromium'),
    record('tablet-chromium', { unpaired: true }),
    record('mobile-chromium'),
  ]);
  assert.equal(r.ok, false);
  assert.match(r.output, /ran with unpaired=true/);
});

test('AGGREGATE: a shard against the wrong staging project fails', () => {
  const r = aggregate([
    record('chromium'),
    record('tablet-chromium'),
    record('mobile-chromium', { staging_project_ref: 'someotherproject' }),
  ]);
  assert.equal(r.ok, false);
  assert.match(r.output, /shards disagree on "staging_project_ref"/);
});

// ── The scheduling lock ────────────────────────────────────────────────────

const LOCKED_WORKFLOWS = [
  'diaspora-deployed-staging-uat',
  'marketplace-reference-regression',
  'seller-exact-head-staging-uat',
  'seller-phase-e-staging',
  'seller-media-lifecycle-staging-uat',
  'operations-serena-staging-uat',
  'diaspora-canonical-staging-uat',
];

test('SCHEDULING: every preview-backend consumer shares ONE concurrency group', () => {
  // Tripwire 13. Two staging gates on one preview backend rate-limited each other into real 429s.
  for (const name of LOCKED_WORKFLOWS) {
    const wf = readFileSync(`.github/workflows/${name}.yml`, 'utf8');
    assert.match(wf, /group: staging-preview-\$\{\{ github\.event\.pull_request\.head\.ref \|\| github\.ref_name \}\}/,
      `${name} is not in the shared staging preview lock`);
  }
});

test('SCHEDULING: the lock QUEUES rather than cancelling — a certification never kills another', () => {
  for (const name of LOCKED_WORKFLOWS) {
    const wf = readFileSync(`.github/workflows/${name}.yml`, 'utf8');
    const group = wf.slice(wf.indexOf('group: staging-preview-'));
    assert.match(group.slice(0, 200), /cancel-in-progress: false/,
      `${name} may cancel an in-flight staging certification`);
  }
});

test('SCHEDULING: the key is the PREVIEW identity, so independent branches still run in parallel', () => {
  // A constant key would serialise every branch in the repository against a preview it does not
  // share. The key is the branch, which is what owns the preview deployment.
  const wf = readFileSync('.github/workflows/diaspora-deployed-staging-uat.yml', 'utf8');
  assert.ok(!/group: staging-preview\s*$/m.test(wf), 'the lock key is constant across branches');
  assert.match(wf, /staging-preview-\$\{\{ github\.event\.pull_request\.head\.ref/);
});

test('SCHEDULING: ordinary unit/lint/build CI is NOT serialised by the staging lock', () => {
  // Only preview-backend consumers belong in the lock.
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.ok(!/staging-preview-/.test(ci), 'ordinary CI was pulled into the staging lock');
});

// ── The shards are shards, not a narrowing ─────────────────────────────────

test('SHARDS: all three projects are invoked, serially, from one testMatch contract', () => {
  const wf = readFileSync('.github/workflows/diaspora-deployed-staging-uat.yml', 'utf8');
  for (const p of PROJECTS) assert.ok(wf.includes(`project: ${p}`), `${p} shard is missing`);
  // Serial, and every shard downstream of the one-time bootstrap. Parsed, not regex-scraped: the
  // previous assertion matched the literal text `needs: chromium` and went red the moment the same
  // dependency was expressed as a list — it was pinning the SPELLING, not the ordering.
  const jobs = yaml.load(wf).jobs;
  const needs = (job) => [].concat(jobs[job].needs ?? []);
  assert.deepEqual(needs('chromium'), ['bootstrap']);
  assert.ok(needs('tablet').includes('chromium'), 'tablet must wait for chromium');
  assert.ok(needs('mobile').includes('tablet'), 'mobile must wait for tablet');
  assert.deepEqual(needs('aggregate').sort(), ['bootstrap', 'chromium', 'mobile', 'tablet']);

  const shard = readFileSync('.github/workflows/diaspora-deployed-staging-shard.yml', 'utf8');
  // Scanned with COMMENT LINES REMOVED. The shard's prose explains that the `testMatch` contract is
  // untouched, and an assertion a comment can fail is as useless as one a comment can satisfy.
  const shardYaml = shard.replace(/^\s*#.*$/gm, '');
  // One project per shard, and the spec set is never narrowed. Scoped to the PLAYWRIGHT INVOCATION:
  // the file legitimately contains a shell `grep` for the bundle hash and the word `testMatch` in a
  // comment, and a ban that trips on those is a ban about the wrong thing.
  const invocation = shardYaml.split('\n').find((l) => l.includes('npx playwright test')) || '';
  assert.ok(invocation, 'the shard does not invoke playwright');
  assert.match(invocation, /--project=\$\{\{ inputs\.project \}\}/);
  assert.ok(!/--grep|--shard=|--last-failed|testMatch=/.test(invocation),
    `a shard narrows the spec set: ${invocation.trim()}`);
  // Each shard re-proves the pairing, so a deployment that moves between shards fails.
  assert.match(shardYaml, /resolve-governed-preview-pair\.mjs/);
  assert.match(shard, /TRADEOS_WORKER_SECRET is not configured/);
});

test('SHARDS: the 35-minute ceiling is unchanged', () => {
  const shard = readFileSync('.github/workflows/diaspora-deployed-staging-shard.yml', 'utf8');
  assert.match(shard, /timeout-minutes: 35/);
});


// ── The one-time bootstrap ─────────────────────────────────────────────────
// Its whole point is that a shard needs NO database. A test that only checked the bootstrap exists
// would still pass if a shard quietly reacquired one.

test('BOOTSTRAP: identities are provisioned ONCE, before any shard runs', () => {
  const wf = yaml.load(readFileSync('.github/workflows/diaspora-deployed-staging-uat.yml', 'utf8'));
  const bootstrap = wf.jobs.bootstrap;
  assert.ok(bootstrap, 'there is no bootstrap job');
  const steps = bootstrap.steps.map((s) => `${s.name ?? ''} ${s.run ?? ''} ${s.uses ?? ''}`).join('\n');
  assert.match(steps, /resolve-governed-preview-pair\.mjs/, 'the bootstrap must prove the governed pair');
  assert.match(steps, /bootstrap-staging-uat-identities\.mjs/, 'the bootstrap must provision the identities');
  // Before ANY of that: refuse a database that cannot serve the run. A gate that starts against a
  // throttled instance produces 148 failures that name nothing.
  assert.match(steps, /assert-staging-capacity\.mjs/, 'the bootstrap must prove the database can serve the run');
  const capacityAt = steps.indexOf('assert-staging-capacity.mjs');
  const provisionAt = steps.indexOf('bootstrap-staging-uat-identities.mjs');
  assert.ok(capacityAt < provisionAt, 'the capacity guard must run BEFORE anything writes to the database');
  assert.match(steps, /staging_run_id=\$run_id" >> "\$GITHUB_OUTPUT"/,
    'the bootstrap must publish the aggregate run identifier');
  // `marketplaceRoutes.js` only honours a fixture_scope matching ^seller-[0-9]+-[0-9]+$ on a preview
  // deployment; any other prefix silently hides the Seller automation listings and spec 38 becomes
  // unpassable. So the identifier's SHAPE is a contract, not a naming preference.
  assert.match(steps, /run_id="seller-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}"/,
    'the run identifier does not match the fixture_scope contract');
});

test('BOOTSTRAP: NO shard opens a database connection', () => {
  const shard = readFileSync('.github/workflows/diaspora-deployed-staging-shard.yml', 'utf8');
  assert.ok(!/new pg\.Client/.test(shard), 'a shard opened a database client again');
  assert.ok(!/DIASPORA_STAGING_DATABASE_URL: \$\{\{/.test(shard),
    'a shard was given the staging database URL again — that dependency is what killed all three');
});

test('BOOTSTRAP: no plaintext credential is passed between jobs', () => {
  const wf = yaml.load(readFileSync('.github/workflows/diaspora-deployed-staging-uat.yml', 'utf8'));
  const outputs = JSON.stringify(wf.jobs.bootstrap.outputs ?? {});
  assert.ok(!/PASSWORD|SECRET|password|secret/.test(outputs),
    `a credential is exposed through a job output: ${outputs}`);
  // The identifier is the ONLY thing that crosses the job boundary.
  assert.deepEqual(Object.keys(wf.jobs.bootstrap.outputs ?? {}), ['staging_run_id']);
});

test('BOOTSTRAP: all three shards certify the SAME run identifier, from one source', () => {
  const wf = yaml.load(readFileSync('.github/workflows/diaspora-deployed-staging-uat.yml', 'utf8'));
  const ids = PROJECTS.map((p) => {
    const job = Object.values(wf.jobs).find((j) => j.with && j.with.project === p);
    return job.with.staging_run_id;
  });
  assert.equal(new Set(ids).size, 1, `shards disagree on the run identifier: ${ids.join(' · ')}`);
  assert.match(ids[0], /needs\.bootstrap\.outputs\.staging_run_id/);
});

test('BOOTSTRAP: a failed bootstrap stops the shards rather than failing them meaninglessly', () => {
  const wf = yaml.load(readFileSync('.github/workflows/diaspora-deployed-staging-uat.yml', 'utf8'));
  for (const job of ['tablet', 'mobile']) {
    // These deliberately still run when the PREVIOUS SHARD failed, so one run classifies every
    // viewport. But with no identities provisioned they would fail for a reason that says nothing
    // about the product.
    assert.match(String(wf.jobs[job].if), /needs\.bootstrap\.result == 'success'/,
      `${job} would run without a successful bootstrap`);
  }
});
