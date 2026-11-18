/**
 * VC-03 — Vercel is RELEASE-ONLY. This contract reads every workflow in .github/workflows and proves:
 *
 *   1. No job reachable from pull_request / push / schedule (or any other automatic event) writes a
 *      Vercel deployment, holds a Vercel credential, resolves a branch-preview pairing, waits on a
 *      `-git-` preview host, or calls the staging release workflow. Normal CI = 0 Vercel deployments.
 *   2. Exactly one workflow — staging-exact-head-release.yml — runs a Vercel deploy command, and it is
 *      reachable only by workflow_dispatch / workflow_call.
 *   3. That workflow deploys ONLY to the two STAGING projects (carup-staging, carup-backend-staging)
 *      and names the production projects only to refuse them.
 *   4. It proves the frontend AND both staging backend hosts serve the exact requested SHA, and every
 *      job that certifies against the stable staging aliases depends on it — so a deployed run can
 *      never certify whatever staging happens to be serving.
 *   5. Release provenance cannot silently disappear when Git deployments are off: the frontend build
 *      and the backend both honour CARUP_BUILD_SHA.
 *
 * Reading YAML (not grepping text) matters: what makes a job PR-reachable is the combination of the
 * workflow's triggers, the job's `if`, and its `needs` chain.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOWS = path.join(ROOT, '.github/workflows');
const RELEASE = 'staging-exact-head-release.yml';

const STAGING = {
  frontend: 'prj_auYmL5hA2ppWA15jdTK4GAdy3AYm', // carup-staging
  backend: 'prj_ddsVeXDxxHxyMAaZxX4v5ORya27W', // carup-backend-staging
};
const PRODUCTION = [
  'prj_518KPBlNsFYOkumK979jdNPKjxE4', // carup
  'prj_jIkUnLnMI8p0suVcOIsTd7xlbN75', // carup-backend
];

const AUTOMATIC = new Set([
  'pull_request', 'pull_request_target', 'push', 'schedule', 'merge_group',
  'workflow_run', 'deployment', 'deployment_status', 'release', 'issue_comment',
]);
const DEPLOY = /\bvercel(?:@[\w.-]+)?\s+(?:deploy|--prod|alias|promote|rollback|redeploy|build)\b|npx\s+(?:--yes\s+)?vercel\b/i;
const STABLE_STAGING_HOST = /https:\/\/(?:staging\.carup\.dev|api-staging\.carup\.dev|carup-staging\.vercel\.app|carup-backend-staging\.vercel\.app)/;

function loadAll() {
  return readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((file) => {
      const raw = readFileSync(path.join(WORKFLOWS, file), 'utf8');
      const doc = yaml.load(raw);
      const on = doc.on ?? doc[true]; // YAML 1.1 reads a bare `on` key as boolean true
      const triggers = new Set(typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on || {}));
      return { file, raw, doc, triggers };
    });
}

/** The events that can actually run a job: workflow triggers, narrowed by its `if` and its `needs` chain. */
function jobEvents(wf, jobName, seen = new Set()) {
  if (seen.has(jobName)) return new Set();
  seen.add(jobName);
  const job = wf.doc.jobs[jobName];
  let events = new Set(wf.triggers);
  const cond = String(job.if ?? '');
  const only = [...cond.matchAll(/github\.event_name\s*==\s*'([a-z_]+)'/g)].map((m) => m[1]);
  if (only.length && !/\|\|/.test(cond)) events = new Set([...events].filter((e) => only.includes(e)));
  // A job whose needed jobs cannot run on an event cannot run on it either, unless it opts into always().
  const needs = [].concat(job.needs ?? []);
  if (needs.length && !/always\(\)|failure\(\)|cancelled\(\)/.test(cond)) {
    for (const need of needs) {
      const upstream = jobEvents(wf, need, new Set(seen));
      events = new Set([...events].filter((e) => upstream.has(e)));
    }
  }
  return events;
}

const automaticJobs = (wf) => Object.keys(wf.doc.jobs || {})
  .filter((name) => [...jobEvents(wf, name)].some((e) => AUTOMATIC.has(e)));

const all = loadAll();

test('anti-vacuity: the contract reads the real workflow set, including automatic PR/push lanes', () => {
  assert.ok(all.length >= 40, `expected the full workflow set, read ${all.length}`);
  const automatic = all.filter((wf) => automaticJobs(wf).length > 0);
  assert.ok(automatic.length >= 15, `expected many PR/push-triggered workflows, found ${automatic.length}`);
  assert.ok(all.some((wf) => wf.file === RELEASE), 'the staging release workflow must exist');
});

test('normal PR / push / schedule CI writes ZERO Vercel deployments and holds no Vercel credential', () => {
  const offenders = [];
  for (const wf of all) {
    for (const name of automaticJobs(wf)) {
      const job = wf.doc.jobs[name];
      const text = JSON.stringify(job);
      const why = [];
      if (DEPLOY.test(text)) why.push('runs a Vercel deploy command');
      if (/VERCEL_TOKEN|VERCEL_ACCESS_TOKEN/.test(text)) why.push('holds a Vercel credential');
      if (/preview-(frontend|backend)-pairing\.json/.test(text)) why.push('resolves a branch-preview pairing');
      if (/-git-[a-z0-9-]+\.vercel\.app/.test(text)) why.push('targets a Vercel branch preview');
      if (/Wait for exact-head/i.test(text)) why.push('waits for a deployed exact-head runtime');
      if (job.uses && job.uses.includes(RELEASE)) why.push('calls the staging release workflow');
      if (why.length) offenders.push(`${wf.file} › ${name} (${[...jobEvents(wf, name)].join(',')}): ${why.join('; ')}`);
    }
  }
  assert.deepEqual(offenders, [], `PR/push-reachable jobs must be local-only:\n${offenders.join('\n')}`);
});

test('exactly one workflow can deploy, and it is reachable only by explicit dispatch / call', () => {
  const deployers = all.filter((wf) => DEPLOY.test(wf.raw)).map((wf) => wf.file);
  assert.deepEqual(deployers, [RELEASE]);
  const release = all.find((wf) => wf.file === RELEASE);
  assert.deepEqual([...release.triggers].sort(), ['workflow_call', 'workflow_dispatch']);
});

test('the release deploys ONLY to the staging projects; production projects are named only to be refused', () => {
  const release = all.find((wf) => wf.file === RELEASE);
  const job = release.doc.jobs.release;
  assert.equal(job.env.BACKEND_STAGING_PROJECT_ID, STAGING.backend);
  assert.equal(job.env.FRONTEND_STAGING_PROJECT_ID, STAGING.frontend);
  assert.deepEqual(job.env.FORBIDDEN_PRODUCTION_PROJECT_IDS.split(/\s+/).sort(), [...PRODUCTION].sort());

  const deploySteps = job.steps.filter((step) => DEPLOY.test(String(step.run ?? '')));
  assert.equal(deploySteps.length, 2, 'one backend and one frontend staging deploy');
  const targets = deploySteps.map((step) => step.env?.VERCEL_PROJECT_ID).sort();
  assert.deepEqual(targets, ['${{ env.BACKEND_STAGING_PROJECT_ID }}', '${{ env.FRONTEND_STAGING_PROJECT_ID }}'].sort());
  for (const step of deploySteps) {
    assert.match(String(step.if), /inputs\.deploy/, `${step.name}: a deploy must be explicitly requested`);
    assert.match(step.run, /--prod\b/, `${step.name}: deploys the STAGING project's production target (the stable staging aliases)`);
    assert.match(step.run, /CARUP_BUILD_SHA="\$CANDIDATE_SHA"/, `${step.name}: must stamp the candidate SHA`);
    assert.match(step.run, /FORBIDDEN_PRODUCTION_PROJECT_IDS/, `${step.name}: must re-refuse production in-step`);
    assert.doesNotMatch(step.run, /--scope\s+pay-pass-project/, 'the stale pay-pass-project scope is retired');
  }
  assert.ok(job.steps.some((s) => /Staging-only project guard/.test(s.name ?? '')), 'a guard step must run before any deploy');

  // Production project IDs appear nowhere else in any workflow.
  const leaks = [];
  for (const wf of all) {
    for (const id of PRODUCTION) {
      const count = wf.raw.split(id).length - 1;
      const allowed = wf.file === RELEASE ? 1 : 0;
      if (count > allowed) leaks.push(`${wf.file}: ${id} x${count}`);
    }
  }
  assert.deepEqual(leaks, []);
});

test('the release proves the frontend AND both staging backend hosts serve the exact candidate before success', () => {
  const release = all.find((wf) => wf.file === RELEASE);
  const job = release.doc.jobs.release;
  assert.equal(job.env.STAGING_WEB_URL, 'https://staging.carup.dev');
  assert.deepEqual(job.env.STAGING_API_ORIGINS.split(/\s+/).sort(),
    ['https://api-staging.carup.dev', 'https://carup-backend-staging.vercel.app']);
  const verify = job.steps.find((s) => /Verify every staging runtime/.test(s.name ?? ''));
  assert.ok(verify, 'verification step present');
  assert.equal(verify.if, undefined, 'verification is unconditional: it runs for deploy and verify-only releases');
  for (const needle of [
    "build?.commit_sha === expected", 'provenance_available === true', "status === 'UP'",
    'carup-provenance.json', 'frontend?.commit_sha === expected', 'unpaired === false',
    'apiOrigins.every', 'process.exit(1)',
  ]) assert.ok(verify.run.includes(needle), `verification must check: ${needle}`);
  const validate = job.steps.find((s) => /Validate the requested candidate/.test(s.name ?? ''));
  assert.match(validate.run, /\[0-9a-f\]\{40\}/, 'only a full 40-character SHA is accepted');
  assert.equal(release.doc.on.workflow_call.outputs.candidate_sha.value, '${{ jobs.release.outputs.candidate_sha }}');
});

test('every job that certifies against the stable staging aliases depends on the exact-head release', () => {
  const ungated = [];
  let certifying = 0;
  for (const wf of all) {
    if (wf.file === RELEASE) continue;
    for (const [name, job] of Object.entries(wf.doc.jobs || {})) {
      if (job.uses) continue;
      if (!STABLE_STAGING_HOST.test(JSON.stringify(job))) continue;
      certifying += 1;
      const releaseJobs = Object.entries(wf.doc.jobs).filter(([, j]) => j.uses?.includes(RELEASE)).map(([n]) => n);
      const needs = [].concat(job.needs ?? []);
      const gated = needs.some((n) => releaseJobs.includes(n));
      const shaFromRelease = /needs\.[\w-]+\.outputs\.candidate_sha/.test(JSON.stringify(job));
      if (!gated || !shaFromRelease) ungated.push(`${wf.file} › ${name}`);
      for (const e of jobEvents(wf, name)) {
        if (AUTOMATIC.has(e)) ungated.push(`${wf.file} › ${name} runs on ${e}`);
      }
    }
  }
  assert.ok(certifying >= 7, `anti-vacuity: expected the deployed certification lanes, found ${certifying}`);
  assert.deepEqual(ungated, [], `deployed certification must need staging-release and use its verified SHA:\n${ungated.join('\n')}`);
});

test('the Marketplace PR lane stays local: local Vite + localhost Playwright, no staging host', () => {
  const wf = all.find((w) => w.file === 'marketplace-reference-regression.yml');
  const local = wf.doc.jobs['reference-regression'];
  const text = JSON.stringify(local);
  assert.ok(jobEvents(wf, 'reference-regression').has('pull_request'));
  assert.match(text, /PLAYWRIGHT_BASE_URL":"http:\/\/127\.0\.0\.1:5173/);
  assert.doesNotMatch(text, STABLE_STAGING_HOST);
  assert.doesNotMatch(text, /vercel\.app/);
  const cert = wf.doc.jobs['staging-certification'];
  assert.deepEqual([...jobEvents(wf, 'staging-certification')], ['workflow_dispatch']);
  assert.match(JSON.stringify(cert), /marketplace-staging-certification\.spec\.ts/);
});

test('release provenance survives disabled Git deployments: frontend and backend both honour CARUP_BUILD_SHA', () => {
  const vite = readFileSync(path.join(ROOT, 'web/vite.config.ts'), 'utf8');
  assert.match(vite, /VITE_COMMIT_SHA\s*=\s*process\.env\.VERCEL_GIT_COMMIT_SHA\s*\|\|\s*process\.env\.CARUP_BUILD_SHA/);
  const backend = readFileSync(path.join(ROOT, 'backend/config/buildProvenance.js'), 'utf8');
  assert.match(backend, /env\.VERCEL_GIT_COMMIT_SHA\s*\|\|\s*env\.GITHUB_SHA\s*\|\|\s*env\.CARUP_BUILD_SHA/);
});
