/**
 * RX-02 D6 — ordinary pull-request CI must never write to SHARED staging.
 *
 * diaspora-phases-3-7-validation › staging-integration used to run on almost every pull request into main
 * (any PR touching backend/**, web/** or database/migrations/**) with the repository secret
 * DIASPORA_STAGING_DATABASE_URL, inserting and then deleting synthetic rows on shared staging. The suite now
 * runs only from diaspora-staging-integration.yml: workflow_dispatch on refs/heads/main, behind the staging
 * environment, for the exact main head that was approved.
 *
 * These checks read the PARSED workflow YAML (not comment-stripped text), so secrets referenced through
 * `secrets.X`, `secrets['X']`, `toJSON(secrets)`, dynamic `secrets[...]` or `secrets: inherit` are all seen.
 * They pin the governed workflow's exact guard, step order and fail-closed behaviour, and they ratchet every
 * (workflow, job, secret) triple that an ungated start can reach, so that the list can only shrink.
 *
 * Gated means a person starts the run: `workflow_dispatch`, or a push to the protected `main` branch. Everything
 * else is ungated — pull requests, comments, reviews, pushes to other branches, and `schedule` (it runs on its
 * own). A `workflow_call` workflow is not a gate either: it runs whenever a caller does, so it is reachable when
 * any reachable workflow calls it (followed transitively, cycle-safe). A call that cannot be resolved to a file
 * in this directory, or that hands secrets to a workflow outside this repository, fails the suite.
 *
 * Limits: this is a guard against accidental regression, not against a malicious pull request (which could
 * edit this test). Repository-scoped secrets stay readable by any same-repository workflow until the Owner moves
 * them into the branch-restricted `staging` environment (RX-02 D6, A4).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = path.resolve(__dirname, '../../.github/workflows');
const PR_WORKFLOW = 'diaspora-phases-3-7-validation.yml';
const STAGING_WORKFLOW = 'diaspora-staging-integration.yml';
const STAGING_SUITE_DIR = 'backend/tests/staging/'; // the directory; staging-runtime-parity.test.js is unrelated
const STAGING_SECRET = 'DIASPORA_STAGING_DATABASE_URL';
const EXACT_GUARD = "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'";
const AUTH_RE = String.raw`auth_re='^https://github\.com/kudzimusar/carup/(issues|pull)/[0-9]+#(issuecomment|discussion_r)-?[0-9]+$'`;
const SHA_RE = "sha_re='^[0-9a-f]{40}$'";

/** The only event a person must start. Pushes to protected `main` are handled in startsUngated(). */
const HUMAN_STARTED_EVENTS = new Set(['workflow_dispatch']);
/** A local reusable-workflow call: `uses: ./.github/workflows/<file>.yml` (no ref, no expression). */
const LOCAL_CALL = /^\.\/\.github\/workflows\/([A-Za-z0-9._-]+\.ya?ml)$/;

/**
 * (workflow, job, secret) triples reachable from an ungated event on main at f269ec03, minus the D6 triple this
 * change removes. Each is held today only by a PR-number/branch pin, a base-branch filter or a narrow path filter.
 * Job granularity means a NEW job in an already-listed file cannot quietly reuse that file's secret. This is a
 * ratchet, not an approval: the set may only shrink (follow-up D6-B and the Owner's A4 secret move).
 */
const LEGACY_UNGATED_SECRET_TRIPLES = new Set([
  'communication-command-center-ci.yml::communication-staging::DIASPORA_STAGING_DATABASE_URL',
  'communication-command-center-ci.yml::communication-staging-deploy::VERCEL_TOKEN',
  'communication-command-center-ci.yml::communication-staging-deploy::VERCEL_ACCESS_TOKEN',
  'diaspora-deployed-staging-uat.yml::deployed-staging-uat::DIASPORA_STAGING_DATABASE_URL',
  'marketplace-reference-media-staging.yml::apply-and-verify::STAGING_SUPABASE_URL',
  'marketplace-reference-media-staging.yml::apply-and-verify::STAGING_SUPABASE_SERVICE_ROLE_KEY',
  'marketplace-reference-media-staging.yml::apply-and-verify::STAGING_SUPABASE_ANON_KEY',
  'operations-serena-staging-uat.yml::serena-operations-uat::DIASPORA_STAGING_DATABASE_URL',
  'operations-serena-staging-uat.yml::serena-operations-uat::SUPABASE_URL',
  'operations-serena-staging-uat.yml::serena-operations-uat::SUPABASE_SERVICE_ROLE_KEY',
  'seller-baseline-visual-audit.yml::capture-baseline::DIASPORA_STAGING_DATABASE_URL',
  'seller-exact-head-staging-uat.yml::golden-dynamic-seller::DIASPORA_STAGING_DATABASE_URL',
  'seller-media-lifecycle-staging-uat.yml::seller-media-lifecycle::DIASPORA_STAGING_DATABASE_URL',
  'seller-phase-d-account-diagnostic.yml::account-diagnostic::DIASPORA_STAGING_DATABASE_URL',
  'seller-phase-e-staging.yml::phase-e-staging::DIASPORA_STAGING_DATABASE_URL',
  'seller-registration-profile-staging.yml::preflight-apply-verify::DIASPORA_STAGING_DATABASE_URL',
  'seller-registration-profile-staging.yml::preflight-apply-verify::DIASPORA_STAGING_CA_CERT',
  'seller-s0-global-taxonomy-staging.yml::preflight-apply-verify::DIASPORA_STAGING_DATABASE_URL',
  'seller-s0-global-taxonomy-staging.yml::preflight-apply-verify::DIASPORA_STAGING_CA_CERT',
  'seller-s3-location-visibility-staging.yml::preflight-apply-verify::DIASPORA_STAGING_DATABASE_URL',
  'seller-s3-location-visibility-staging.yml::preflight-apply-verify::DIASPORA_STAGING_CA_CERT',
]);

/**
 * Scheduled triples on main at f269ec03, made visible (not added) when `schedule` stopped counting as a gate
 * (PR #275 review 5910435110). Listed separately so the baseline is never widened silently. The job declares
 * `environment: staging`, and on 2026-11-15 its scheduled runs were waiting for or cancelled at that environment's
 * review; neither secret name exists at repository or `staging` environment scope (names-only readback). The test
 * does not rely on either fact. Like the set above, this may only shrink.
 */
const LEGACY_SCHEDULED_SECRET_TRIPLES = new Set([
  'diaspora-scheduler-dispatch.yml::dispatch::DIASPORA_API_BASE_URL',
  'diaspora-scheduler-dispatch.yml::dispatch::DIASPORA_SCHEDULER_SECRET',
]);

function load(name, dir = WORKFLOWS_DIR) {
  const text = fs.readFileSync(path.join(dir, name), 'utf8');
  return { name, text, doc: yaml.load(text) };
}

function allWorkflows(dir = WORKFLOWS_DIR) {
  return fs.readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => load(name, dir));
}

/** The `on:` block as {event: config}, for every form (string, list or map). YAML 1.1 may read `on` as true. */
function onMap(doc) {
  const on = doc.on ?? doc[true];
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((event) => [event, null]));
  return on ?? {};
}

/** True when some trigger other than a person or a push to protected main can start the workflow by itself. */
function startsUngated(doc) {
  return Object.entries(onMap(doc)).some(([event, config]) => {
    if (HUMAN_STARTED_EVENTS.has(event)) return false;
    if (event === 'workflow_call') return false; // reachable only through a caller: see reachableFromUngated()
    if (event === 'push') {
      const branches = config?.branches;
      const mainOnly = Array.isArray(branches) && branches.length > 0 && branches.every((branch) => branch === 'main');
      return !mainOnly || Boolean(config?.tags) || Boolean(config?.['branches-ignore']);
    }
    return true; // pull_request*, schedule, issue_comment, merge_group, ... and any event added later
  });
}

/** Every job-level reusable-workflow call: { workflow, job, uses, target } (target = local file name or null). */
function callEdges(workflows) {
  return workflows.flatMap(({ name, doc }) => Object.entries(doc.jobs ?? {})
    .filter(([, job]) => job && job.uses !== undefined)
    .map(([id, job]) => ({ workflow: name, job: id, uses: String(job.uses), target: LOCAL_CALL.exec(String(job.uses))?.[1] ?? null })));
}

/** Workflows an ungated start can run, directly or through any chain of local reusable-workflow calls. */
function reachableFromUngated(workflows) {
  const names = new Set(workflows.map(({ name }) => name));
  const edges = callEdges(workflows);
  const reached = new Set(workflows.filter(({ doc }) => startsUngated(doc)).map(({ name }) => name));
  const queue = [...reached];
  while (queue.length > 0) { // each workflow enters the queue at most once, so call cycles terminate
    const from = queue.shift();
    for (const { target } of edges.filter((edge) => edge.workflow === from)) {
      if (target && names.has(target) && !reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
    }
  }
  return reached;
}

/**
 * The secret-consumer ratchet for one workflow directory:
 *  - added: (workflow, job, secret) triples reachable from an ungated start that no baseline lists;
 *  - unresolved: calls that fail closed — a local call to a file that does not exist, or any call whose target is
 *    not a local file (another repository, a ref or an expression) while the calling job hands it secrets.
 */
function secretReachability(dir = WORKFLOWS_DIR) {
  const workflows = allWorkflows(dir);
  const reached = reachableFromUngated(workflows);
  const names = new Set(workflows.map(({ name }) => name));
  const triples = workflows
    .filter(({ name }) => reached.has(name))
    .flatMap(({ name, doc }) => {
      const { jobs, ...workflowLevel } = doc;
      return [
        ...[...secretRefs(workflowLevel)].map((secret) => `${name}::(workflow)::${secret}`),
        ...Object.entries(jobs ?? {}).flatMap(([id, job]) => [...secretRefs(job)].map((secret) => `${name}::${id}::${secret}`)),
      ];
    });
  const added = triples.filter((triple) => !LEGACY_UNGATED_SECRET_TRIPLES.has(triple) && !LEGACY_SCHEDULED_SECRET_TRIPLES.has(triple));
  const jobsByWorkflow = new Map(workflows.map(({ name, doc }) => [name, doc.jobs ?? {}]));
  const unresolved = callEdges(workflows)
    .filter(({ workflow, job, uses, target }) => (target ? !names.has(target)
      : uses.startsWith('./') || secretRefs(jobsByWorkflow.get(workflow)[job]).size > 0))
    .map(({ workflow, job, uses }) => `${workflow}::${job} -> ${uses}`);
  return { triples, added, unresolved };
}

/** Every secret a parsed workflow node can reach. Wildcards: *ALL* (toJSON), *DYNAMIC* (secrets[expr]), *INHERIT*. */
function secretRefs(node, out = new Set(), key = null) {
  if (typeof node === 'string') {
    for (const m of node.matchAll(/secrets\.([A-Za-z0-9_-]+)/g)) out.add(m[1]);
    for (const m of node.matchAll(/secrets\[\s*['"]([A-Za-z0-9_-]+)['"]\s*\]/g)) out.add(m[1]);
    if (/toJSON\(\s*secrets\s*\)/.test(node)) out.add('*ALL*');
    if (/secrets\[\s*(?!['"])/.test(node)) out.add('*DYNAMIC*');
    if (key === 'secrets' && node === 'inherit') out.add('*INHERIT*');
  } else if (Array.isArray(node)) {
    for (const item of node) secretRefs(item, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) secretRefs(v, out, k);
  }
  out.delete('GITHUB_TOKEN');
  return out;
}

function environmentName(job) {
  return typeof job.environment === 'string' ? job.environment : job.environment?.name;
}

const normalise = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

test('the pull-request workflow keeps its ordinary verification jobs', () => {
  const { doc } = load(PR_WORKFLOW);
  assert.ok('pull_request' in onMap(doc), 'diaspora-phases-3-7-validation still runs on pull requests');
  assert.ok(doc.jobs['backend-and-build'], 'backend-and-build job is kept');
  assert.ok(doc.jobs.playwright, 'playwright job is kept');
});

test('the pull-request workflow holds no secret, no environment, no reusable call and no shared-staging suite', () => {
  const { doc, text } = load(PR_WORKFLOW);
  assert.equal(doc.jobs['staging-integration'], undefined, 'staging-integration must not run from a pull-request workflow');
  assert.deepEqual([...secretRefs(doc)], [], 'a pull-request-startable workflow must not reach any secret');
  for (const [id, job] of Object.entries(doc.jobs)) {
    assert.equal(job.environment, undefined, `job ${id} must not name a deployment environment`);
    assert.equal(job.uses, undefined, `job ${id} must not call a reusable workflow`);
  }
  assert.ok(!text.includes(STAGING_SUITE_DIR), 'the shared-staging suite must not be invoked from a pull-request workflow');
  assert.deepEqual(doc.permissions, { contents: 'read' }, 'the pull-request workflow token is read-only');
});

test('the shared-staging suite runs only from the governed dispatch workflow', () => {
  const runners = allWorkflows().filter(({ text }) => text.includes(STAGING_SUITE_DIR)).map(({ name }) => name);
  assert.deepEqual(runners, [STAGING_WORKFLOW]);
});

test('the governed workflow: dispatch only, exact main guard, staging environment, fail-closed steps', () => {
  const { doc } = load(STAGING_WORKFLOW);
  const on = onMap(doc);
  assert.deepEqual(Object.keys(on), ['workflow_dispatch'], 'no pull_request, push, schedule, workflow_call or other trigger');
  assert.equal(on.workflow_dispatch.inputs.authorization_ref.required, true);
  assert.equal(on.workflow_dispatch.inputs.expected_sha.required, true);
  assert.deepEqual(doc.permissions, { contents: 'read' });
  assert.deepEqual([...secretRefs(doc)], [STAGING_SECRET], 'the workflow reaches exactly one secret');

  assert.deepEqual(Object.keys(doc.jobs), ['staging-integration']);
  const job = doc.jobs['staging-integration'];
  assert.equal(normalise(job.if), EXACT_GUARD, 'the job guard is exactly the protected-main dispatch guard');
  assert.equal(environmentName(job), 'staging', 'required-reviewer staging environment');
  assert.equal(job.uses, undefined, 'no reusable workflow');
  assert.ok(!JSON.stringify(job).includes('continue-on-error'), 'no step or job may continue after an error');

  const steps = job.steps;
  for (const step of steps) assert.equal(step.if, undefined, `step "${step.name ?? step.uses}" must not carry its own condition`);
  for (const step of steps) {
    const run = String(step.run ?? '');
    assert.ok(!/\bexit\s+0\b/.test(run), `step "${step.name ?? step.uses}" must not exit successfully early`);
    assert.ok(!/git\s+(checkout|fetch|switch|reset)\b/.test(run), `step "${step.name ?? step.uses}" must not move the checkout`);
  }

  const [guard, checkout, assertMain] = steps;
  assert.match(String(guard.name), /^Refuse a malformed audit reference/, 'the input guard is the first step');
  assert.equal(guard.shell, 'bash');
  assert.equal(guard.env.AUTHORIZATION_REF, '${{ inputs.authorization_ref }}');
  assert.equal(guard.env.EXPECTED_SHA, '${{ inputs.expected_sha }}');
  assert.equal(guard.env.DISPATCHED_SHA, '${{ github.sha }}', 'the dispatched head comes from github.sha, never an input');
  assert.ok(guard.run.includes('set -euo pipefail'));
  assert.ok(guard.run.includes(AUTH_RE), 'authorization_ref is matched as a whole string');
  assert.ok(guard.run.includes('[[ ! "$AUTHORIZATION_REF" =~ $auth_re ]]'));
  assert.ok(guard.run.includes(SHA_RE) && guard.run.includes('[[ ! "$EXPECTED_SHA" =~ $sha_re ]]'), 'expected_sha must be a full SHA');
  assert.ok(guard.run.includes('[ "$EXPECTED_SHA" != "$DISPATCHED_SHA" ]'), 'expected_sha must equal the dispatched main head');
  assert.equal((guard.run.match(/\bexit 1\b/g) || []).length, 3, 'each refusal exits 1');

  assert.match(String(checkout.uses), /^actions\/checkout@/, 'checkout is the second step');
  assert.equal(checkout.with?.ref, undefined, 'tests the dispatched main commit, not an input ref');
  assert.equal(checkout.with?.['persist-credentials'], false);

  assert.equal(assertMain.shell, 'bash');
  assert.equal(assertMain.env.EXPECTED_SHA, '${{ inputs.expected_sha }}');
  assert.ok(assertMain.run.includes('set -euo pipefail'));
  assert.ok(assertMain.run.includes('git rev-parse HEAD'), 'asserts the checked-out commit');
  assert.ok(assertMain.run.includes('git ls-remote') && assertMain.run.includes('refs/heads/main'), 'asserts main has not moved');

  const secretSteps = steps.filter((step) => secretRefs(step).size > 0);
  assert.equal(secretSteps.length, 1, 'exactly one step receives a secret');
  assert.equal(secretSteps[0], steps[steps.length - 1], 'the secret is given only to the last step');
  assert.deepEqual([...secretRefs(secretSteps[0])], [STAGING_SECRET]);
  assert.ok(secretSteps[0].run.includes('exit 1'), 'a missing secret fails the run instead of skipping it');
});

test('no new ungated workflow or job can reach a secret (ratchet over (workflow, job, secret) triples)', () => {
  const { triples, added, unresolved } = secretReachability();
  assert.ok(!triples.some((triple) => triple.startsWith(`${PR_WORKFLOW}::`)), 'the D6 pull-request workflow reaches no secret');
  assert.ok(!triples.some((triple) => triple.startsWith(`${STAGING_WORKFLOW}::`)), 'the governed workflow is reachable only by dispatch');
  assert.deepEqual(added, [], 'an ungated workflow or job newly reaches a secret');
  assert.deepEqual(unresolved, [], 'a reusable-workflow call cannot be resolved, or hands secrets outside this repository');
});

test('no workflow is started by pull_request_target or workflow_run', () => {
  const risky = allWorkflows()
    .filter(({ doc }) => Object.keys(onMap(doc)).some((event) => event === 'pull_request_target' || event === 'workflow_run'))
    .map(({ name }) => name);
  assert.deepEqual(risky, []);
});

/**
 * Mutation fixtures: copy the real workflow directory to a temporary directory, add one unsafe change and run the
 * same ratchet. Each unsafe change must be reported; the unmodified copy must report nothing. No network, no
 * credentials, no staging access.
 */
function withFixture(files, check) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd6-ratchet-'));
  try {
    for (const name of fs.readdirSync(WORKFLOWS_DIR)) fs.copyFileSync(path.join(WORKFLOWS_DIR, name), path.join(dir, name));
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    return check(secretReachability(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const PR_CALLER = (callee, secretsBlock) => `name: zz caller
on:
  pull_request:
jobs:
  call:
    uses: ./.github/workflows/${callee}
${secretsBlock}`;

const REUSABLE = (body) => `name: zz reusable
on:
  workflow_call:
${body}`;

const READS_STAGING_DB = `    runs-on: ubuntu-24.04
    steps:
      - run: psql "$DB" -c 'select 1'
        env:
          DB: \${{ secrets.DIASPORA_STAGING_DATABASE_URL }}`;

test('mutation fixtures: the unmodified copy and secret-free calls report nothing (positive controls)', () => {
  withFixture({}, ({ added, unresolved }) => {
    assert.deepEqual(added, []);
    assert.deepEqual(unresolved, []);
  });
  withFixture({
    'zz-caller.yml': PR_CALLER('zz-reusable.yml', ''),
    'zz-reusable.yml': REUSABLE(`jobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm test`),
  }, ({ added, unresolved }) => {
    assert.deepEqual(added, [], 'a pull-request workflow calling a secret-free reusable workflow is not reported');
    assert.deepEqual(unresolved, []);
  });
});

test('mutation 1: a new scheduled workflow that reads the staging database secret is rejected', () => {
  withFixture({
    'zz-nightly.yml': `name: zz nightly\non:\n  schedule:\n    - cron: '0 3 * * *'\njobs:\n  nightly:\n${READS_STAGING_DB}`,
  }, ({ added }) => assert.deepEqual(added, ['zz-nightly.yml::nightly::DIASPORA_STAGING_DATABASE_URL']));
});

test('mutation 2: a pull-request caller handing `secrets: inherit` to a secret-reading reusable workflow is rejected', () => {
  withFixture({
    'zz-caller.yml': PR_CALLER('zz-reusable.yml', '    secrets: inherit'),
    'zz-reusable.yml': REUSABLE(`jobs:\n  write:\n${READS_STAGING_DB}`),
  }, ({ added }) => assert.deepEqual(added.sort(), [
    'zz-caller.yml::call::*INHERIT*',
    'zz-reusable.yml::write::DIASPORA_STAGING_DATABASE_URL',
  ]));
});

test('mutation 3: a pull-request caller mapping a secret explicitly into a reusable workflow is rejected', () => {
  withFixture({
    'zz-caller.yml': PR_CALLER('zz-reusable.yml', '    secrets:\n      db: ${{ secrets.DIASPORA_STAGING_DATABASE_URL }}'),
    'zz-reusable.yml': REUSABLE(`    secrets:\n      db:\n        required: true\njobs:\n  write:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: psql "$DB" -c 'select 1'\n        env:\n          DB: \${{ secrets.db }}`),
  }, ({ added }) => assert.deepEqual(added.sort(), [
    'zz-caller.yml::call::DIASPORA_STAGING_DATABASE_URL',
    'zz-reusable.yml::write::db',
  ]));
});

test('mutation 4: a transitive reusable chain that reaches a secret is rejected, and a call cycle terminates', () => {
  withFixture({
    'zz-caller.yml': PR_CALLER('zz-a.yml', '    secrets: inherit'),
    'zz-a.yml': REUSABLE(`jobs:\n  hop:\n    uses: ./.github/workflows/zz-b.yml\n    secrets: inherit`),
    'zz-b.yml': REUSABLE(`jobs:\n  back:\n    uses: ./.github/workflows/zz-a.yml\n  write:\n${READS_STAGING_DB}`),
  }, ({ added }) => assert.ok(added.includes('zz-b.yml::write::DIASPORA_STAGING_DATABASE_URL'),
    `the secret two calls away is reported (got ${JSON.stringify(added)})`));
});

test('mutation 5: a new secret-bearing job inside an already-listed workflow is rejected', () => {
  const name = 'seller-phase-e-staging.yml';
  const doc = yaml.load(fs.readFileSync(path.join(WORKFLOWS_DIR, name), 'utf8'));
  doc.jobs['zz-extra'] = { 'runs-on': 'ubuntu-24.04', steps: [{ run: 'true', env: { DB: '${{ secrets.DIASPORA_STAGING_DATABASE_URL }}' } }] };
  withFixture({ [name]: yaml.dump(doc) }, ({ added }) => assert.deepEqual(added, [`${name}::zz-extra::DIASPORA_STAGING_DATABASE_URL`]));
});

test('fail closed: an unresolvable local call, or secrets handed to a workflow outside this repository', () => {
  withFixture({ 'zz-caller.yml': PR_CALLER('zz-missing.yml', '') }, ({ unresolved }) => {
    assert.deepEqual(unresolved, ['zz-caller.yml::call -> ./.github/workflows/zz-missing.yml']);
  });
  withFixture({
    'zz-dispatch.yml': `name: zz remote\non:\n  workflow_dispatch:\njobs:\n  call:\n    uses: some-org/some-repo/.github/workflows/x.yml@v1\n    secrets: inherit`,
  }, ({ unresolved }) => assert.deepEqual(unresolved, ['zz-dispatch.yml::call -> some-org/some-repo/.github/workflows/x.yml@v1']));
});
