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
  // Serial: tablet waits for chromium, mobile waits for tablet.
  assert.match(wf, /tablet:[\s\S]{0,200}needs: chromium/);
  assert.match(wf, /mobile:[\s\S]{0,200}needs: tablet/);
  // The aggregate depends on all three.
  assert.match(wf, /needs: \[chromium, tablet, mobile\]/);

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
