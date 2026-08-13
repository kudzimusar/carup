/**
 * Guards for the Issue #101 inventory WORKFLOW wrapper.
 *
 * Separate from the probe's own suite because of the two-commit pinning pattern:
 * the diagnostic (Commit A) is authored and reviewed BEFORE this wrapper exists,
 * so the wrapper can hard-pin an immutable, already-known SHA. These tests prove
 * the wrapper cannot widen what that pinned code is allowed to do.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.resolve(__dirname, '../../.github/workflows/issue-101-production-security-inventory.yml');
const wf = fs.readFileSync(WORKFLOW, 'utf8');
const withoutComments = wf.replace(/#.*$/gm, '');

test('the workflow is workflow_dispatch only', () => {
  assert.match(wf, /workflow_dispatch:/);
  assert.ok(!/^\s*(push|pull_request|schedule|repository_dispatch):/m.test(withoutComments),
    'must not trigger on push/PR/schedule/repository_dispatch');
});

test('the workflow pins and ASSERTS an immutable candidate SHA', () => {
  const env = /CANDIDATE_SHA:\s*([0-9a-f]{40})/.exec(withoutComments);
  assert.ok(env, 'CANDIDATE_SHA must be a full 40-char SHA');
  const ref = /ref:\s*([0-9a-f]{40})/.exec(withoutComments);
  assert.ok(ref, 'checkout must pin a full 40-char ref');
  assert.equal(ref[1], env[1], 'checkout ref and CANDIDATE_SHA must be the same commit');
  assert.match(wf, /git rev-parse HEAD/);
  assert.match(wf, /expected the pinned candidate/i);
});

test('the pinned SHA is an ancestor-authored commit, not this one (two-commit pattern)', () => {
  // The wrapper must not attempt to pin its own (unknowable) SHA.
  const env = /CANDIDATE_SHA:\s*([0-9a-f]{40})/.exec(withoutComments)[1];
  assert.equal(env.length, 40);
  assert.ok(/^[0-9a-f]{40}$/.test(env), 'must be a concrete SHA, never a ref name or expression');
  assert.ok(!/\$\{\{/.test(/ref:\s*\S+/.exec(withoutComments)[0]), 'the checkout ref must not be an expression');
});

test('the workflow enforces production identity controls', () => {
  assert.match(withoutComments, /environment:\s*production/i);
  assert.match(withoutComments, /github\.actor\s*==\s*'kudzimusar'/);
  assert.match(withoutComments, /github\.triggering_actor\s*==\s*'kudzimusar'/);
  assert.match(withoutComments, /github\.ref\s*==\s*'refs\/heads\/main'/);
  assert.match(withoutComments, /PRODUCTION_DATABASE_URL/);
  assert.match(withoutComments, /PRODUCTION_PROJECT_REF/);
});

test('the workflow fails closed when production secrets are absent', () => {
  assert.match(wf, /must be configured on the production environment; cannot run/);
});

test('the workflow exposes NO mode input and no phrase gate', () => {
  assert.ok(!/^\s*mode:/m.test(withoutComments), 'must not expose a mode input');
  assert.ok(!/authorization/i.test(withoutComments), 'must not expose a phrase gate');
  assert.ok(!/\bapply\b/i.test(withoutComments), 'no apply path may exist outside comments');
  assert.ok(!/^\s*inputs:/m.test(withoutComments), 'the dispatch takes no inputs at all');
});

test('the workflow requests only read permissions', () => {
  assert.match(withoutComments, /permissions:\s*\n\s*contents:\s*read/);
});

test('the workflow re-verifies the pinned diagnostic has no mutation path', () => {
  assert.match(wf, /contains a mutating statement; refusing to run/);
  assert.match(wf, /does not open a READ ONLY transaction; refusing to run/);
});

test('the workflow runs the inventory probe and nothing else', () => {
  const runs = [...wf.matchAll(/run:\s*node\s+(\S+)/g)].map((m) => m[1]);
  assert.deepEqual(runs, ['backend/scripts/production-issue-101-inventory.mjs']);
});

test('the pinned candidate exists in git history', () => {
  const sha = /CANDIDATE_SHA:\s*([0-9a-f]{40})/.exec(withoutComments)[1];
  const out = execFileSync('git', ['cat-file', '-t', sha], {
    cwd: path.resolve(__dirname, '../..'), encoding: 'utf8',
  }).trim();
  assert.equal(out, 'commit', 'CANDIDATE_SHA must name a real commit');
});
