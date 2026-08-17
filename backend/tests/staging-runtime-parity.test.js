import assert from 'node:assert/strict';
import test from 'node:test';

import { assertRuntimeRevisionParity, resolveBuildProvenance } from '../config/buildProvenance.js';

/**
 * Guard against the drift that physically shipped a defect: CarUp staging serves two runtimes —
 * api-staging.carup.dev (certification target) and carup-backend-staging.vercel.app (the cron
 * worker's target, which actually sends Email). They diverged, and a governed marketing message
 * reached a human inbox with no unsubscribe control because the SENDING runtime was older.
 */

const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const runtime = (name, sha) => ({ name, provenance: resolveBuildProvenance({ VERCEL_GIT_COMMIT_SHA: sha }) });

test('build provenance reports the revision a runtime was built from', () => {
  const p = resolveBuildProvenance({ VERCEL_GIT_COMMIT_SHA: SHA_A, VERCEL_GIT_COMMIT_REF: 'feat/x', VERCEL_ENV: 'production' });
  assert.equal(p.commit_sha, SHA_A);
  assert.equal(p.commit_sha_short, SHA_A.slice(0, 8));
  assert.equal(p.branch, 'feat/x');
  assert.equal(p.provenance_available, true);
});

test('a runtime that cannot state its revision is reported as unavailable, not assumed current', () => {
  const p = resolveBuildProvenance({});
  assert.equal(p.commit_sha, null);
  assert.equal(p.provenance_available, false);
});

test('matching revisions across both runtimes PASS', () => {
  const verdict = assertRuntimeRevisionParity([
    runtime('api-staging', SHA_A),
    runtime('cron-sender', SHA_A),
  ]);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.revision, SHA_A);
  assert.deepEqual(verdict.problems, []);
});

test('DRIFT between the API runtime and the sending runtime FAILS loudly', () => {
  // This is the exact condition that shipped a marketing Email with no unsubscribe control.
  const verdict = assertRuntimeRevisionParity([
    runtime('api-staging', SHA_A),
    runtime('cron-sender', SHA_B),
  ]);
  assert.equal(verdict.pass, false);
  assert.equal(verdict.revision, null);
  assert.equal(verdict.problems.length, 1);
  assert.match(verdict.problems[0], /disagree on revision/);
  assert.match(verdict.problems[0], /api-staging=aaaaaaaa/);
  assert.match(verdict.problems[0], /cron-sender=bbbbbbbb/);
});

test('agreement on the WRONG revision still fails when an expected revision is given', () => {
  // Both runtimes consistent with each other but stale relative to the certified head is still a
  // certification lie — "exact-head PASS" must mean exact head.
  const verdict = assertRuntimeRevisionParity(
    [runtime('api-staging', SHA_A), runtime('cron-sender', SHA_A)],
    SHA_B,
  );
  assert.equal(verdict.pass, false);
  assert.equal(verdict.problems.length, 2, 'both runtimes must be named as stale');
  assert.ok(verdict.problems.every((p) => /expected bbbbbbbb/.test(p)));
});

test('fails CLOSED when a runtime is unreachable or silent about its revision', () => {
  // Unknown provenance must never read as agreement — that is precisely the blind spot the guard
  // exists to remove.
  const unreachable = assertRuntimeRevisionParity([
    runtime('api-staging', SHA_A),
    { name: 'cron-sender', error: 'timeout' },
  ]);
  assert.equal(unreachable.pass, false);
  assert.match(unreachable.problems[0], /unreachable or no provenance/);

  const silent = assertRuntimeRevisionParity([
    runtime('api-staging', SHA_A),
    { name: 'cron-sender', provenance: resolveBuildProvenance({}) },
  ]);
  assert.equal(silent.pass, false);
  assert.match(silent.problems[0], /reports no commit sha/);
});

test('an empty runtime list is a failure, not a vacuous pass', () => {
  assert.equal(assertRuntimeRevisionParity([]).pass, false);
});
