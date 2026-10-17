/**
 * The certification gate's own gate.
 *
 * `Diaspora Deployed Staging UAT` was pinned to `head_ref == 'claude/diaspora-phases-8-10-production-program'`
 * with URLs from a different Vercel project. It could not run on any current branch, so it reported
 * `skipped` on every PR — a green tick for a gate that had certified nothing since that branch died.
 *
 * These tests exist because a refusal nobody can break is not a gate. Each rule is violated on
 * purpose and the NAMED refusal is asserted, with positive controls throughout: a rule that refuses
 * everything would pass a matrix of refusals while certifying nothing, which is exactly the state
 * this replaces.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REFUSALS, resolvePair, verifyProvenance } from '../../scripts/ci/resolve-governed-preview-pair.mjs';

const BRANCH = 'feat/trade-os-client-demo-convergence';
const SHA = '9ce19115172cf739bf0ed338a2cb26a2c4d4231e';
const FE = 'https://carup-staging-git-feat-trade-os-client-demo-convergence-11-11.vercel.app';
const BE = 'https://carup-backend-staging-git-feat-trade-os-client-dem-dbf311-11-11.vercel.app';

const pairs = (over = {}) => ({
  branch: BRANCH,
  sha: SHA,
  frontendPairs: { [BRANCH]: FE },
  backendPairs: { [BRANCH]: BE },
  ...over,
});

const said = (over = {}) => ({
  sha: SHA,
  frontend: FE,
  backend: BE,
  provenance: { commit_sha: SHA, unpaired: false, api_base_url: BE },
  health: { status: 'UP', build: { commit_sha: SHA, deployment_id: 'dpl_x' } },
  ...over,
});

// ── Resolution ─────────────────────────────────────────────────────────────

test('CI gate: POSITIVE CONTROL — the current Trade OS branch resolves', () => {
  const r = resolvePair(pairs());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.frontend, FE);
  assert.equal(r.backend, BE);
});

test('CI gate: the branch is read from the manifests, not hardcoded', () => {
  // The whole point. Any governed branch resolves; the gate knows nothing about which branch it is.
  const other = 'feat/some-future-lane';
  const r = resolvePair(pairs({
    branch: other,
    frontendPairs: { [other]: 'https://carup-staging-git-feat-some-future-lane-11-11.vercel.app' },
    backendPairs: { [other]: 'https://carup-backend-staging-git-feat-some-future-l-abc123-11-11.vercel.app' },
  }));
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('CI gate: an UNGOVERNED branch is refused, not silently skipped', () => {
  // The old failure mode. A branch nobody paired must fail loudly rather than report success.
  const r = resolvePair(pairs({ branch: 'claude/diaspora-phases-8-10-production-program' }));
  assert.equal(r.ok, false);
  assert.equal(r.refusal, 'UNGOVERNED_BRANCH');
  assert.match(r.reason, /rather than hardcoding a URL in the workflow/);
});

test('CI gate: half a pair is not a pair', () => {
  assert.equal(resolvePair(pairs({ backendPairs: {} })).refusal, 'UNGOVERNED_BRANCH');
  assert.equal(resolvePair(pairs({ frontendPairs: {} })).refusal, 'UNGOVERNED_BRANCH');
});

test('CI gate: a PRODUCTION origin is refused on either side', () => {
  for (const host of ['https://carup.co.zw', 'https://www.carup.co.zw', 'https://carup-production.vercel.app']) {
    assert.equal(resolvePair(pairs({ frontendPairs: { [BRANCH]: host } })).refusal, 'PRODUCTION_ORIGIN', host);
    assert.equal(resolvePair(pairs({ backendPairs: { [BRANCH]: host } })).refusal, 'PRODUCTION_ORIGIN', host);
  }
});

test('CI gate: the STABLE staging alias is refused — it serves whatever was last promoted', () => {
  // Not production, but not this candidate either. Certifying against it proves nothing, which is
  // the precise failure `preview-backend-pairing.json` was created to stop.
  assert.equal(resolvePair(pairs({ frontendPairs: { [BRANCH]: 'https://carup-staging.vercel.app' } })).refusal, 'PRODUCTION_ORIGIN');
  assert.equal(resolvePair(pairs({ backendPairs: { [BRANCH]: 'https://carup-backend-staging.vercel.app' } })).refusal, 'PRODUCTION_ORIGIN');
});

test('CI gate: the staging database must be the approved project', () => {
  const r = resolvePair(pairs({ stagingDbUrl: 'postgresql://user:pw@db.SOMEOTHERPROJECT.supabase.co:5432/postgres', expectedProjectRef: 'eoyenigwevnxwwhyhaer' }));
  assert.equal(r.refusal, 'WRONG_STAGING_PROJECT');
  // POSITIVE CONTROL: the approved one passes.
  const ok = resolvePair(pairs({ stagingDbUrl: 'postgresql://user:pw@db.eoyenigwevnxwwhyhaer.supabase.co:5432/postgres', expectedProjectRef: 'eoyenigwevnxwwhyhaer' }));
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test('CI gate: a gate that needs no database is not blocked on one', () => {
  assert.equal(resolvePair(pairs({ expectedProjectRef: 'eoyenigwevnxwwhyhaer' })).ok, true);
});

test('CI gate: no branch and no SHA are each their own refusal', () => {
  assert.equal(resolvePair(pairs({ branch: '' })).refusal, 'NO_BRANCH');
  assert.equal(resolvePair(pairs({ sha: '' })).refusal, 'NO_SHA');
});

// ── Provenance — the stale-pairing refusals ────────────────────────────────

test('CI gate: POSITIVE CONTROL — a correctly paired candidate verifies', () => {
  const v = verifyProvenance(said());
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.deployment_id, 'dpl_x');
});

test('CI gate: a STALE FRONTEND is refused, and the refusal names both commits', () => {
  const v = verifyProvenance(said({ provenance: { commit_sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', unpaired: false, api_base_url: BE } }));
  assert.equal(v.refusal, 'FRONTEND_STALE');
  assert.equal(v.serving, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  assert.equal(v.expected, SHA);
});

test('CI gate: a STALE BACKEND is refused', () => {
  const v = verifyProvenance(said({ health: { status: 'UP', build: { commit_sha: 'deadbeef' } } }));
  assert.equal(v.refusal, 'BACKEND_STALE');
  assert.equal(v.serving, 'deadbeef');
});

test('CI gate: an UNPAIRED frontend is refused even when it serves the right commit', () => {
  // The Issue #164 defect: the preview fell back to the shared staging backend, so every
  // backend-dependent step measured main's contract while appearing to certify the candidate.
  const v = verifyProvenance(said({ provenance: { commit_sha: SHA, unpaired: true, api_base_url: BE } }));
  assert.equal(v.refusal, 'UNPAIRED');
});

test('CI gate: a missing `unpaired` field is refused — absence is not false', () => {
  const v = verifyProvenance(said({ provenance: { commit_sha: SHA, api_base_url: BE } }));
  assert.equal(v.refusal, 'UNPAIRED');
});

test('CI gate: the right commit reached through the WRONG backend is refused', () => {
  // Both deployments can serve the candidate SHA and still not be this branch's pair — another
  // branch built from the same commit would do it.
  const v = verifyProvenance(said({
    provenance: { commit_sha: SHA, unpaired: false, api_base_url: 'https://carup-backend-staging-git-some-other-branch-11-11.vercel.app' },
  }));
  assert.equal(v.refusal, 'PAIR_MISMATCH');
  assert.equal(v.paired_to, BE);
});

test('CI gate: a trailing slash is not a mismatch', () => {
  assert.equal(verifyProvenance(said({ provenance: { commit_sha: SHA, unpaired: false, api_base_url: `${BE}/` } })).ok, true);
});

test('CI gate: an unreachable deployment is refused, never assumed healthy', () => {
  assert.equal(verifyProvenance(said({ provenance: null })).refusal, 'FRONTEND_UNREACHABLE');
  assert.equal(verifyProvenance(said({ health: null })).refusal, 'BACKEND_UNREACHABLE');
  assert.equal(verifyProvenance(said({ health: { status: 'DOWN', build: { commit_sha: SHA } } })).refusal, 'BACKEND_UNREACHABLE');
});

test('CI gate: every refusal carries a human reason', () => {
  for (const [name, reason] of Object.entries(REFUSALS)) {
    assert.ok(reason && reason.length > 20, `${name} has no usable reason`);
  }
});

// ── The workflow actually uses it ──────────────────────────────────────────

test('CI gate: the workflow is no longer pinned to a dead branch', () => {
  const wf = readFileSync('.github/workflows/diaspora-deployed-staging-uat.yml', 'utf8');
  // Scanned with COMMENT LINES REMOVED. The file's header deliberately names the dead branch and the
  // wrong project in prose, because why this was rewritten is the most useful thing in it — and an
  // assertion that a comment can satisfy is not an assertion. Only executable YAML is scanned.
  const yaml = wf.replace(/^\s*#.*$/gm, '');
  assert.ok(!/claude\/diaspora-phases-8-10-production-program/.test(yaml),
    'the workflow is still pinned to the dead branch');
  assert.ok(!/pay-pass-project/.test(yaml),
    'the workflow still carries another Vercel project\'s hardcoded URLs');
  assert.ok(!/^\s*STAGING_WEB_URL:\s*https/m.test(yaml), 'the frontend URL is still hardcoded');
  assert.ok(!/^\s*STAGING_API_URL:\s*https/m.test(yaml), 'the backend URL is still hardcoded');
  // …and there is no job-level `if:` pinning it to one branch again.
  assert.ok(!/^\s*if:\s*github\.head_ref\s*==/m.test(yaml), 'the job is pinned to a single branch again');
  assert.match(yaml, /resolve-governed-preview-pair\.mjs/, 'the workflow does not use the governed resolver');
  // The header prose IS required, so the next reader knows why the shape is what it is.
  assert.match(wf, /reported `skipped`/, 'the rewrite no longer records why it happened');
});

test('CI gate: the Trade OS branch is governed in BOTH manifests', () => {
  const fe = JSON.parse(readFileSync('web/preview-frontend-pairing.json', 'utf8')).branches || {};
  const be = JSON.parse(readFileSync('web/preview-backend-pairing.json', 'utf8')).branches || {};
  assert.ok(fe[BRANCH], 'the Trade OS branch has no governed frontend preview');
  assert.ok(be[BRANCH], 'the Trade OS branch has no governed backend preview');
  // …and the gate would therefore actually run on it.
  assert.equal(resolvePair({ branch: BRANCH, sha: SHA, frontendPairs: fe, backendPairs: be }).ok, true);
});

// ── Liveness is not provenance ─────────────────────────────────────────────
// `/api/health` returns `status: 'UP'` whenever the PROCESS is up, and reports the database in a
// separate field this check used to ignore. On 2026-09-08 the paired backend served exactly the
// payload below for hours while PostgREST could not start.

/** The real payload from the paired staging backend at 12:21 UTC, 2026-09-08. */
const HEALTH_WITH_DEAD_DATABASE = {
  status: 'UP',
  build: { commit_sha: SHA, commit_sha_short: SHA.slice(0, 8), deployment_id: 'dpl_9JrWrmUHDVTVT7zNu4yu88AWoW5c' },
  supabase: { status: 'unhealthy', outboxBacklog: 0 },
};

test('a backend serving the RIGHT commit with a DEAD database is refused', () => {
  const v = verifyProvenance(said({ health: HEALTH_WITH_DEAD_DATABASE }));
  assert.equal(v.ok, false);
  assert.equal(v.refusal, 'BACKEND_DATABASE_UNHEALTHY');
  assert.equal(v.database_status, 'unhealthy');
});

test('…and every OTHER provenance check passes on that same payload', () => {
  // This is the whole point: the deployment is genuinely the candidate. Commit, pairing and
  // liveness of the process are all correct — so nothing except a database check can catch it, and
  // the specs would have run against a dead database and failed as a wall of ~30s timeouts.
  const { supabase, ...withoutDatabaseField } = HEALTH_WITH_DEAD_DATABASE;
  const v = verifyProvenance(said({ health: withoutDatabaseField }));
  assert.equal(v.ok, true, 'the deployment really is the candidate — only the database is dead');
});

test('a healthy database passes', () => {
  const v = verifyProvenance(said({ health: { ...HEALTH_WITH_DEAD_DATABASE, supabase: { status: 'healthy', outboxBacklog: 0 } } }));
  assert.equal(v.ok, true);
});

test('a backend that does not report its database at all is not blocked', () => {
  // Not every backend in this repo's history returns the field. Absent is unknown, not unhealthy —
  // inventing a refusal for silence would fail deployments that were never in scope.
  const { supabase, ...withoutDatabaseField } = HEALTH_WITH_DEAD_DATABASE;
  assert.equal(verifyProvenance(said({ health: withoutDatabaseField })).ok, true);
});

test('the refusal explains WHY provenance was not enough', () => {
  assert.match(REFUSALS.BACKEND_DATABASE_UNHEALTHY, /provenance and liveness are different/i);
});
