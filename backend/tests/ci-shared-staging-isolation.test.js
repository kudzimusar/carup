/**
 * RX-02 D6 — ordinary pull-request CI must never write to SHARED staging.
 *
 * diaspora-phases-3-7-validation › staging-integration used to run on almost every pull request into main
 * (any PR touching backend/**, web/** or database/migrations/**) with the repository secret
 * DIASPORA_STAGING_DATABASE_URL, inserting and then deleting synthetic rows on shared staging. The suite now
 * runs only from diaspora-staging-integration.yml: workflow_dispatch on refs/heads/main, behind the staging
 * environment. These checks parse the workflow YAML and fail if that containment regresses, and they ratchet
 * the pre-existing pull-request workflows that still name a secret so that no new one can appear.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = path.resolve(__dirname, '../../.github/workflows');
const PR_WORKFLOW = 'diaspora-phases-3-7-validation.yml';
const STAGING_WORKFLOW = 'diaspora-staging-integration.yml';
const STAGING_SUITE = 'backend/tests/staging/diaspora-staging-integration.test.js';
const PR_EVENTS = new Set(['pull_request', 'pull_request_target']);

/**
 * Pull-request-startable workflows on main at f269ec03 that already name a secret other than GITHUB_TOKEN.
 * Each is held today only by a PR-number/branch pin, a base-branch filter or a narrow path filter. This is a
 * ratchet, not an approval: the list may only shrink (CARUP-PAY-05 Checkpoint A removes all of them).
 */
const LEGACY_PR_WORKFLOWS_WITH_SECRETS = new Set([
  'communication-command-center-ci.yml',
  'diaspora-deployed-staging-uat.yml',
  'marketplace-reference-media-staging.yml',
  'operations-serena-staging-uat.yml',
  'seller-exact-head-staging-uat.yml',
  'seller-phase-d-account-diagnostic.yml',
  'seller-phase-e-staging.yml',
  'seller-registration-profile-staging.yml',
  'seller-s0-global-taxonomy-staging.yml',
  'seller-s3-location-visibility-staging.yml',
]);

function load(name) {
  const text = fs.readFileSync(path.join(WORKFLOWS_DIR, name), 'utf8');
  return { name, text, doc: yaml.load(text) };
}

function allWorkflows() {
  return fs.readdirSync(WORKFLOWS_DIR)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map(load);
}

/** The event names that can start a workflow, for every `on:` form (string, list or map). */
function events(doc) {
  const on = doc.on ?? doc[true]; // YAML 1.1 parsers read a bare `on` key as boolean true
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on ?? {});
}

/** Secret names referenced anywhere in the file, ignoring comments. */
function secretNames(text) {
  const code = text.replace(/(^|\s)#.*$/gm, '$1');
  return [...new Set([...code.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))]
    .filter((secret) => secret !== 'GITHUB_TOKEN');
}

function environmentName(job) {
  return typeof job.environment === 'string' ? job.environment : job.environment?.name;
}

test('the pull-request workflow keeps its ordinary verification jobs', () => {
  const { doc } = load(PR_WORKFLOW);
  assert.ok(events(doc).includes('pull_request'), 'diaspora-phases-3-7-validation still runs on pull requests');
  assert.ok(doc.jobs['backend-and-build'], 'backend-and-build job is kept');
  assert.ok(doc.jobs.playwright, 'playwright job is kept');
});

test('the pull-request workflow holds no secret, no environment and no shared-staging suite', () => {
  const { doc, text } = load(PR_WORKFLOW);
  assert.equal(doc.jobs['staging-integration'], undefined, 'staging-integration must not run from a pull-request workflow');
  assert.deepEqual(secretNames(text), [], 'a pull-request-startable workflow must not reference any secret');
  for (const [id, job] of Object.entries(doc.jobs)) {
    assert.equal(job.environment, undefined, `job ${id} must not name a deployment environment`);
  }
  assert.ok(!text.includes(STAGING_SUITE), 'the shared-staging suite must not be invoked from a pull-request workflow');
  assert.equal(doc.permissions?.contents, 'read', 'the pull-request workflow token is read-only');
});

test('the shared-staging suite runs only from the governed dispatch workflow', () => {
  const runners = allWorkflows().filter(({ text }) => text.includes(STAGING_SUITE)).map(({ name }) => name);
  assert.deepEqual(runners, [STAGING_WORKFLOW]);
});

test('the governed workflow is workflow_dispatch only, on main only, behind the staging environment', () => {
  const { doc, text } = load(STAGING_WORKFLOW);
  assert.deepEqual(events(doc), ['workflow_dispatch'], 'no pull_request, push, schedule or other trigger');
  const inputs = doc.on.workflow_dispatch.inputs;
  assert.equal(inputs.authorization_ref.required, true);
  assert.equal(inputs.expected_sha.required, true);
  assert.equal(doc.permissions?.contents, 'read');

  const jobIds = Object.keys(doc.jobs);
  assert.deepEqual(jobIds, ['staging-integration']);
  const job = doc.jobs['staging-integration'];
  const guard = String(job.if ?? '').replace(/\s+/g, ' ');
  assert.match(guard, /github\.event_name == 'workflow_dispatch'/, 'event guard');
  assert.match(guard, /github\.ref == 'refs\/heads\/main'/, 'protected-main ref guard');
  assert.ok(!/\|\|/.test(guard), 'the guard must not be widened with an alternative');
  assert.equal(environmentName(job), 'staging', 'required-reviewer staging environment');

  const checkout = job.steps.find((step) => String(step.uses ?? '').startsWith('actions/checkout@'));
  assert.ok(checkout, 'checks out the repository');
  assert.equal(checkout.with?.ref, undefined, 'tests the dispatched main commit, not an arbitrary input ref');
  assert.match(text, /\[ "\$EXPECTED_SHA" != "\$DISPATCHED_SHA" \]/, 'expected_sha must equal the dispatched main head');

  const secretSteps = job.steps.filter((step) => JSON.stringify(step).includes('secrets.'));
  assert.equal(secretSteps.length, 1, 'exactly one step receives a secret');
  assert.deepEqual(secretNames(text), ['DIASPORA_STAGING_DATABASE_URL']);
});

test('no new pull-request workflow can reach a secret (ratchet over the pre-existing set)', () => {
  const exposed = allWorkflows()
    .filter(({ doc }) => events(doc).some((event) => PR_EVENTS.has(event)))
    .filter(({ text }) => secretNames(text).length > 0)
    .map(({ name }) => name);
  assert.ok(!exposed.includes(PR_WORKFLOW));
  const added = exposed.filter((name) => !LEGACY_PR_WORKFLOWS_WITH_SECRETS.has(name));
  assert.deepEqual(added, [], 'a pull-request-startable workflow newly references a secret');
});

test('no workflow is started by pull_request_target or workflow_run', () => {
  const risky = allWorkflows()
    .filter(({ doc }) => events(doc).some((event) => event === 'pull_request_target' || event === 'workflow_run'))
    .map(({ name }) => name);
  assert.deepEqual(risky, []);
});
