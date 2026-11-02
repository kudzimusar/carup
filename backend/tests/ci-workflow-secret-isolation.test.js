/**
 * CARUP-PAY-05-LR01 Checkpoint A — no pull-request event may reach a shared-environment secret.
 *
 * Opening a same-repository pull request used to run `diaspora-phases-3-7-validation`'s staging-integration
 * job, which writes (then deletes) rows on SHARED staging: 54 of 54 Payments pull-request runs did so between
 * 2026-10-29 and 2026-11-02. The policy below makes that structurally impossible — a workflow a pull request can
 * start holds no secret at all — and keeps every shared-data credential behind workflow_dispatch plus a
 * required-reviewer environment. These tests lock the repository's workflows to the policy and prove each rule
 * catches the shape that caused (or could cause) the defect.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RULES,
  parseWorkflow,
  loadWorkflows,
  evaluate,
  prEventReach,
  pushReach,
  githubPatternToRegExp,
  matchesFilters,
  dispatchOnlyGuard,
} from '../../scripts/ci/workflow-secret-isolation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOWS = path.join(ROOT, '.github/workflows');

const wf = (file, source) => parseWorkflow(`.github/workflows/${file}`, source);
const set = (...parsed) => new Map(parsed.map((p) => [p.file, p]));
const rulesOf = (workflows) => evaluate(workflows).violations.map((v) => v.rule).sort();

// ── The repository itself ─────────────────────────────────────────────────────────────────────────────────

test('every workflow in the repository satisfies the secret-isolation policy', () => {
  const { violations } = evaluate(loadWorkflows(WORKFLOWS));
  assert.deepEqual(violations.map((v) => `${v.rule} ${v.file}${v.job ? `#${v.job}` : ''}: ${v.detail}`), []);
});

test('no job that any pull-request event can start can read a secret or a protected environment', () => {
  const reach = prEventReach(loadWorkflows(WORKFLOWS));
  assert.ok(reach.jobs.length > 0, 'the dry run found no pull-request jobs at all — it is not looking');
  const exposed = reach.jobs.filter((j) => j.secrets.length || j.inherits || j.dynamic || j.environment);
  assert.deepEqual(exposed.map((j) => `${j.file}#${j.job}`), []);
});

test('the staging workflows a Payments pull request used to start are no longer pull-request triggered', () => {
  const workflows = loadWorkflows(WORKFLOWS);
  const formerlyReachable = [
    'diaspora-phases-3-7-validation.yml#staging-integration',
    'diaspora-deployed-staging-uat.yml#bootstrap',
    'seller-home-lifecycle-staging-uat.yml#seller-home-lifecycle',
  ];
  const reach = prEventReach(workflows).jobs.map((j) => `${path.basename(j.file)}#${j.job}`);
  for (const job of formerlyReachable) assert.ok(!reach.includes(job), `${job} is still reachable by a pull request`);
  // The staging integration still exists — as a governed, dispatch-only, reviewer-approved operation.
  const governed = workflows.get('.github/workflows/diaspora-staging-integration.yml');
  assert.ok(governed, 'the governed staging-integration workflow is missing');
  assert.deepEqual(Object.keys(governed.triggers), ['workflow_dispatch']);
  const job = governed.jobs.find((j) => j.id === 'staging-integration');
  assert.equal(job.environment, 'staging');
  assert.ok(dispatchOnlyGuard(job.if), 'the governed job must also refuse any non-dispatch event');
  assert.ok(governed.triggers.workflow_dispatch.inputs.authorization_ref.required, 'authorization_ref must be required');
  assert.ok(governed.triggers.workflow_dispatch.inputs.expected_sha.required, 'expected_sha must be required');
});

test('pushing a Payments branch reaches no shared-data credential', () => {
  const workflows = loadWorkflows(WORKFLOWS);
  for (const branch of [
    'feat/carup-pay-04-garage-payments',
    'feat/carup-pay-05-zimbabwe-collections-mobile-money',
    'feat/carup-pay-06-anything',
  ]) {
    assert.deepEqual(pushReach(workflows, branch).filter((j) => j.sharedSecrets.length), [], branch);
  }
});

// ── Each rule catches the shape it exists for ─────────────────────────────────────────────────────────────

test('the original defect: a pull_request workflow whose job reads the staging database URL', () => {
  const bad = wf('diaspora.yml', `
on:
  pull_request:
    paths: ['backend/**']
jobs:
  staging-integration:
    runs-on: ubuntu-latest
    steps:
      - run: node --test backend/tests/staging/x.test.js
        env:
          STAGING_DATABASE_URL: \${{ secrets.DIASPORA_STAGING_DATABASE_URL }}
`);
  assert.deepEqual(rulesOf(set(bad)), [RULES.PR_SECRET, RULES.SHARED_REACH]);
});

test('a pull-request job pinned to one PR number still holds the secret — structure, not expressions, decides', () => {
  const bad = wf('pinned.yml', `
on: [pull_request, push]
jobs:
  staging:
    if: github.event_name == 'pull_request' && github.event.pull_request.number == 148
    runs-on: ubuntu-latest
    steps:
      - run: echo
        env: { DATABASE_URL: "\${{ secrets.DIASPORA_STAGING_DATABASE_URL }}" }
`);
  assert.ok(rulesOf(set(bad)).includes(RULES.PR_SECRET));
});

test('a label-gated pull_request workflow is still a pull_request workflow', () => {
  const bad = wf('labelled.yml', `
on:
  pull_request:
    types: [labeled]
jobs:
  proof:
    if: github.event.label.name == 'run-proof'
    runs-on: ubuntu-latest
    env:
      STAGING_UAT_PASSWORD: \${{ secrets.STAGING_UAT_PASSWORD }}
    steps: [{ run: echo }]
`);
  assert.ok(rulesOf(set(bad)).includes(RULES.PR_SECRET));
});

test('a pull-request job that names a protected environment is refused even without a secrets reference', () => {
  const bad = wf('env.yml', `
on: pull_request
jobs:
  bootstrap:
    runs-on: ubuntu-latest
    environment: staging
    steps: [{ run: echo }]
`);
  assert.deepEqual(rulesOf(set(bad)), [RULES.PR_SECRET]);
});

test('workflow-level env secrets, dynamic secret access and toJSON(secrets) are all secret access', () => {
  const levels = [
    `env:\n  X: \${{ secrets.ANY_TOKEN }}\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps: [{ run: echo }]\n`,
    `jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n        env: { X: "\${{ secrets[format('{0}_URL', 'DB')] }}" }\n`,
    `jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo '\${{ toJSON(secrets) }}'\n`,
  ];
  for (const body of levels) {
    assert.deepEqual(rulesOf(set(wf('l.yml', `on: pull_request\n${body}`))), [RULES.PR_SECRET], body);
  }
});

test('a pull-request workflow may not call a reusable workflow that inherits secrets or names an environment', () => {
  const caller = wf('caller.yml', `
on: pull_request
jobs:
  shard:
    uses: ./.github/workflows/shard.yml
    with: { project: chromium }
`);
  const inheritingCaller = wf('caller2.yml', `
on: pull_request
jobs:
  shard:
    uses: ./.github/workflows/plain.yml
    secrets: inherit
`);
  const shard = wf('shard.yml', `
on: workflow_call
jobs:
  run:
    runs-on: ubuntu-latest
    environment: staging
    steps: [{ run: echo }]
`);
  const plain = wf('plain.yml', `
on: workflow_call
jobs:
  run:
    runs-on: ubuntu-latest
    steps: [{ run: echo }]
`);
  assert.ok(rulesOf(set(caller, shard)).includes(RULES.PR_SECRET), 'called workflow names an environment');
  assert.ok(rulesOf(set(inheritingCaller, plain)).includes(RULES.PR_SECRET), 'secrets: inherit');
  const remote = wf('remote.yml', `
on: pull_request
jobs:
  r:
    uses: some-org/some-repo/.github/workflows/x.yml@v1
`);
  assert.ok(rulesOf(set(remote)).includes(RULES.PR_SECRET), 'remote reusable workflows cannot be verified');
});

test('pull_request_target and workflow_run are refused outright; issue_comment is a pull-request context', () => {
  assert.deepEqual(rulesOf(set(wf('t.yml', `on: pull_request_target\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps: [{ run: echo }]\n`))),
    [RULES.PRIVILEGED]);
  assert.deepEqual(rulesOf(set(wf('r.yml', `on:\n  workflow_run:\n    workflows: [CI]\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps: [{ run: echo }]\n`))),
    [RULES.PRIVILEGED]);
  const comment = wf('c.yml', `on: issue_comment\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo \${{ secrets.VERCEL_TOKEN }}\n`);
  assert.deepEqual(rulesOf(set(comment)), [RULES.PR_SECRET]);
});

test('a pull-request workflow that uses only GITHUB_TOKEN is allowed', () => {
  const ok = wf('ok.yml', `
on: pull_request
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: gh pr view
        env: { GH_TOKEN: "\${{ secrets.GITHUB_TOKEN }}" }
`);
  assert.deepEqual(rulesOf(set(ok)), []);
});

test('a shared-data credential must be unreachable by push unless the job is dispatch-only', () => {
  const pushed = wf('p.yml', `
on:
  push:
    branches: [some-integration-branch]
  workflow_dispatch: {}
jobs:
  audit:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - run: echo
        env: { DB: "\${{ secrets.DIASPORA_STAGING_DATABASE_URL }}" }
`);
  assert.deepEqual(rulesOf(set(pushed)), [RULES.SHARED_REACH]);

  const guarded = wf('g.yml', `
on:
  push:
    branches: ['**']
  workflow_dispatch: {}
jobs:
  stage4:
    if: github.event_name == 'workflow_dispatch' && github.event.inputs.run == 'true'
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - run: echo
        env: { DB: "\${{ secrets.DIASPORA_STAGING_DATABASE_URL }}" }
`);
  assert.deepEqual(rulesOf(set(guarded)), []);

  const disjunction = wf('d.yml', `
on: [push, workflow_dispatch]
jobs:
  a:
    if: github.event_name == 'workflow_dispatch' || github.event_name == 'push'
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - run: echo
        env: { DB: "\${{ secrets.DIASPORA_STAGING_DATABASE_URL }}" }
`);
  assert.deepEqual(rulesOf(set(disjunction)), [RULES.SHARED_REACH]);
});

test('a dispatch-only shared-data job needs the matching required-reviewer environment', () => {
  const job = (secret, env) => wf('x.yml', `
on: workflow_dispatch
jobs:
  apply:
    runs-on: ubuntu-latest
${env ? `    environment: ${env}\n` : ''}    steps:
      - run: echo
        env: { V: "\${{ secrets.${secret} }}" }
`);
  assert.deepEqual(rulesOf(set(job('DIASPORA_STAGING_DATABASE_URL'))), [RULES.SHARED_APPROVAL]);
  assert.deepEqual(rulesOf(set(job('DIASPORA_STAGING_DATABASE_URL', 'staging'))), []);
  assert.deepEqual(rulesOf(set(job('DIASPORA_STAGING_DATABASE_URL', 'production'))), [RULES.SHARED_APPROVAL]);
  assert.deepEqual(rulesOf(set(job('PRODUCTION_DATABASE_URL', 'Production'))), []);
  assert.deepEqual(rulesOf(set(job('PRODUCTION_DATABASE_URL', 'staging'))), [RULES.SHARED_APPROVAL]);
  assert.deepEqual(rulesOf(set(job('STAGING_SUPABASE_SERVICE_ROLE_KEY', '{ name: staging }'))), []);
});

test('scheduled shared-data jobs run only from the default branch and are not push- or pull-request reachable', () => {
  const scheduled = wf('s.yml', `
on:
  schedule: [{ cron: '*/15 * * * *' }]
  workflow_dispatch: {}
jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - run: echo
        env: { S: "\${{ secrets.DIASPORA_SCHEDULER_SECRET }}" }
`);
  assert.deepEqual(rulesOf(set(scheduled)), []);
});

// ── The pieces the dry run is built from ──────────────────────────────────────────────────────────────────

test('GitHub filter patterns: * stops at /, ** crosses it, ? and + quantify the previous character, [] is a class', () => {
  const m = (p, s) => githubPatternToRegExp(p).test(s);
  assert.ok(m('feat/oc5*', 'feat/oc5r-x'));
  assert.ok(!m('feat/oc5*', 'feat/carup-pay-05-zimbabwe'));
  assert.ok(!m('feat/*', 'feat/a/b'));
  assert.ok(m('feat/**', 'feat/a/b'));
  assert.ok(m('**', 'anything/at/all'));
  assert.ok(m('docs/*.md', 'docs/a.md') && !m('docs/*.md', 'docs/x/a.md'));
  assert.ok(m('v1.?', 'v1') && m('v1.?', 'v1.') && !m('v1.?', 'v1x'));
  assert.ok(m('a+b', 'aaab') && !m('a+b', 'b'));
  assert.ok(m('release/v[12]', 'release/v2') && !m('release/v[12]', 'release/v3'));
  assert.ok(m('main', 'main') && !m('main', 'mainline'));
});

test('include/exclude filter lists follow GitHub order semantics with ! negation', () => {
  assert.ok(matchesFilters(['feat/**', '!feat/carup-pay-*'], 'feat/other'));
  assert.ok(!matchesFilters(['feat/**', '!feat/carup-pay-*'], 'feat/carup-pay-05-x'));
  assert.ok(matchesFilters(['feat/**', '!feat/carup-pay-*', 'feat/carup-pay-05-x'], 'feat/carup-pay-05-x'));
  assert.ok(!matchesFilters(['main'], 'feat/x'));
});

test('dispatch-only guards: only a top-level workflow_dispatch conjunct counts', () => {
  assert.ok(dispatchOnlyGuard("github.event_name == 'workflow_dispatch'"));
  assert.ok(dispatchOnlyGuard("${{ github.event_name == 'workflow_dispatch' && inputs.x == 'y' }}"));
  assert.ok(dispatchOnlyGuard("(github.event_name == 'workflow_dispatch' &&\n github.ref == 'refs/heads/main' &&\n github.actor == 'kudzimusar')"));
  assert.ok(dispatchOnlyGuard("'workflow_dispatch' == github.event_name && always()"));
  assert.ok(!dispatchOnlyGuard(null));
  assert.ok(!dispatchOnlyGuard("github.event_name == 'workflow_dispatch' || github.event_name == 'push'"));
  assert.ok(!dispatchOnlyGuard("!(github.event_name == 'workflow_dispatch')"));
  assert.ok(!dispatchOnlyGuard("github.event_name != 'workflow_dispatch'"));
  assert.ok(!dispatchOnlyGuard("(github.event_name == 'workflow_dispatch' || true) && always()"));
  assert.ok(!dispatchOnlyGuard("github.event_name == 'workflow_dispatch && x'"));
});

// ── Gaps found by mutating the policy module (each test kills one surviving mutant) ───────────────────────

test('a top-level || defeats a dispatch conjunct: (dispatch && x) || push is not dispatch-only', () => {
  assert.ok(!dispatchOnlyGuard("github.event_name == 'workflow_dispatch' && inputs.x == 'y' || github.event_name == 'push'"));
  assert.ok(dispatchOnlyGuard("github.event_name == 'workflow_dispatch' && (inputs.x == 'y' || inputs.z == 'w')"));
});

test('any *_DATABASE_URL secret is a shared-data credential, not only the staging-named ones', () => {
  const pushed = wf('legacy.yml', `
on:
  push:
    branches: [main]
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo
        env: { DB: "\${{ secrets.LEGACY_DATABASE_URL }}" }
`);
  assert.deepEqual(rulesOf(set(pushed)), [RULES.SHARED_REACH]);
});

test('a reusable workflow holding staging credentials is reachable by its callers\' events', () => {
  const caller = wf('caller-push.yml', `
on:
  push:
    branches: [integration/x]
jobs:
  call:
    uses: ./.github/workflows/staging-callee.yml
    secrets: inherit
`);
  const callee = wf('staging-callee.yml', `
on: workflow_call
jobs:
  write:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - run: echo
        env: { DB: "\${{ secrets.DIASPORA_STAGING_DATABASE_URL }}" }
`);
  const violations = evaluate(set(caller, callee)).violations;
  assert.ok(violations.some((v) => v.rule === RULES.SHARED_REACH && v.file.endsWith('staging-callee.yml') && /push/.test(v.detail)),
    JSON.stringify(violations));
  // Dispatch-only callers keep it governed.
  const dispatchCaller = wf('caller-push.yml', `
on: workflow_dispatch
jobs:
  call:
    uses: ./.github/workflows/staging-callee.yml
    secrets: inherit
`);
  assert.deepEqual(rulesOf(set(dispatchCaller, callee)), []);
});

test('the push dry run honours branch filters and skips dispatch-only jobs', () => {
  const workflows = set(wf('seller-int.yml', `
on:
  push:
    branches: [integration/vehicle-passport-v16-cert]
  workflow_dispatch: {}
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - run: echo
        env: { DB: "\${{ secrets.DIASPORA_STAGING_DATABASE_URL }}" }
  guarded:
    if: github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - run: echo
        env: { DB: "\${{ secrets.DIASPORA_STAGING_DATABASE_URL }}" }
`));
  assert.deepEqual(pushReach(workflows, 'feat/carup-pay-05-zimbabwe-collections-mobile-money'), []);
  const reached = pushReach(workflows, 'integration/vehicle-passport-v16-cert');
  assert.deepEqual(reached.map((j) => [j.job, j.sharedSecrets]), [['audit', ['DIASPORA_STAGING_DATABASE_URL']]]);
});

test('the pull-request dry run follows a local reusable workflow into its jobs', () => {
  const workflows = set(
    wf('pr-caller.yml', `
on: pull_request
jobs:
  shard:
    uses: ./.github/workflows/gated-shard.yml
`),
    wf('gated-shard.yml', `
on: workflow_call
jobs:
  run:
    runs-on: ubuntu-latest
    environment: staging
    steps: [{ run: echo }]
`),
  );
  const reach = prEventReach(workflows).jobs;
  const inner = reach.find((j) => j.file.endsWith('gated-shard.yml') && j.job === 'run');
  assert.ok(inner, JSON.stringify(reach));
  assert.equal(inner.environment, 'staging');
  assert.deepEqual(inner.via, ['.github/workflows/gated-shard.yml']);
});
