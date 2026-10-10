/**
 * OC-5R-REL-01 — build provenance for a Git-less governed release.
 *
 * The CarUp Vercel projects have had no connected Git repository since OC-P0, so a governed preview is
 * a CLI upload of a clean worktree at the exact SHA and Vercel injects no VERCEL_GIT_* variables. The
 * deployer states the revision explicitly (CARUP_BUILD_SHA / CARUP_BUILD_REF, deployment-scoped). The
 * backend reports which source it used, and a runtime whose sources disagree reports NO revision.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { resolveBuildProvenance } = await import('../config/buildProvenance.js');
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

test('a CLI release states its revision and branch through the explicit build inputs', () => {
  const p = resolveBuildProvenance({ CARUP_BUILD_SHA: A, CARUP_BUILD_REF: 'fix/oc5r-real-runtime-source-closure', VERCEL_ENV: 'preview' });
  assert.equal(p.commit_sha, A);
  assert.equal(p.branch, 'fix/oc5r-real-runtime-source-closure');
  assert.equal(p.source, 'explicit_build_input');
  assert.equal(p.provenance_available, true);
});

test('a Git-sourced deployment keeps Vercel\'s own variables, and says so', () => {
  const p = resolveBuildProvenance({ VERCEL_GIT_COMMIT_SHA: A, VERCEL_GIT_COMMIT_REF: 'feat/x' });
  assert.deepEqual([p.commit_sha, p.branch, p.source], [A, 'feat/x', 'vercel_git']);
  assert.equal(resolveBuildProvenance({ VERCEL_GIT_COMMIT_SHA: A, CARUP_BUILD_SHA: A }).source, 'vercel_git', 'agreeing sources are fine');
});

test('two sources that disagree yield NO revision — the runtime cannot be certified against either', () => {
  const p = resolveBuildProvenance({ VERCEL_GIT_COMMIT_SHA: A, CARUP_BUILD_SHA: B });
  assert.equal(p.commit_sha, null);
  assert.equal(p.source, 'conflict');
  assert.equal(p.provenance_available, false);
});

test('a runtime with no source at all reports none', () => {
  const p = resolveBuildProvenance({});
  assert.deepEqual([p.commit_sha, p.source, p.provenance_available], [null, null, false]);
});
