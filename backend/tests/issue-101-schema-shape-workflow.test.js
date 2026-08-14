/** Guards for the Issue #101 schema-shape WORKFLOW wrapper. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.resolve(__dirname, '../../.github/workflows/issue-101-production-schema-shape.yml');
const wf = fs.readFileSync(WORKFLOW, 'utf8');
const noComments = wf.replace(/#.*$/gm, '');

test('dispatch-only, no inputs, read-only permissions', () => {
  assert.match(wf, /workflow_dispatch:/);
  assert.ok(!/^\s*(push|pull_request|schedule|repository_dispatch):/m.test(noComments));
  assert.ok(!/^\s*inputs:/m.test(noComments));
  assert.match(noComments, /permissions:\s*\n\s*contents:\s*read/);
});

test('the pin is present, asserted, and identical in env and checkout', () => {
  const env = /CANDIDATE_SHA:\s*([0-9a-f]{40})/.exec(noComments);
  const ref = /ref:\s*([0-9a-f]{40})/.exec(noComments);
  assert.ok(env && ref);
  assert.equal(ref[1], env[1]);
  assert.match(wf, /git rev-parse HEAD/);
  assert.match(wf, /expected the pinned candidate/i);
});

test('production identity controls are enforced', () => {
  assert.match(noComments, /environment:\s*production/i);
  assert.match(noComments, /github\.actor\s*==\s*'kudzimusar'/);
  assert.match(noComments, /github\.triggering_actor\s*==\s*'kudzimusar'/);
  assert.match(noComments, /github\.ref\s*==\s*'refs\/heads\/main'/);
  assert.match(noComments, /PRODUCTION_DATABASE_URL/);
  assert.match(noComments, /PRODUCTION_PROJECT_REF/);
});

test('no apply mode or phrase gate is exposed', () => {
  assert.ok(!/^\s*mode:/m.test(noComments));
  assert.ok(!/authorization/i.test(noComments));
  assert.ok(!/\bapply\b/i.test(noComments));
});

test('the pre-run guard refuses mutation, SET ROLE and scope creep', () => {
  assert.match(wf, /contains a mutating statement; refusing to run/);
  assert.match(wf, /does not open a READ ONLY transaction; refusing to run/);
  assert.match(wf, /references an out-of-scope relation; refusing to run/);
  assert.match(wf, /SET ROLE/);
  assert.match(wf, /administrative_overrides/);
});

test('it runs the schema-shape probe and nothing else', () => {
  const runs = [...wf.matchAll(/run:\s*node\s+(\S+)/g)].map((m) => m[1]);
  assert.deepEqual(runs, ['backend/scripts/production-issue-101-schema-shape.mjs']);
});

test('the pinned commit exists and carries the scoped probe', () => {
  const sha = /CANDIDATE_SHA:\s*([0-9a-f]{40})/.exec(noComments)[1];
  const cwd = path.resolve(__dirname, '../..');
  assert.equal(execFileSync('git', ['cat-file', '-t', sha], { cwd, encoding: 'utf8' }).trim(), 'commit');
  const blob = execFileSync('git', ['show', `${sha}:backend/scripts/production-issue-101-schema-shape.mjs`], { cwd, encoding: 'utf8' });
  assert.match(blob, /TARGET_TABLES/);
  assert.match(blob, /BEGIN READ ONLY/);
  assert.match(blob, /out-of-scope relation/);
  assert.ok(!/administrative_overrides/.test(blob), 'pinned probe must not reference the out-of-scope table');
  assert.ok(!/\bGRANT\b|\bREVOKE\b/.test(blob.replace(/^\s*(\*|\/\/).*$/gm, '')), 'pinned probe must contain no grant statements');
});

test('the pin names no earlier Issue #101 probe', () => {
  const sha = /CANDIDATE_SHA:\s*([0-9a-f]{40})/.exec(noComments)[1];
  for (const earlier of [
    '008e1f4987d598258296753fe8f45090edd05cfc',
    'ea6b65650e913d30dfa25389ab64cdcfeb5a3768',
    'c39d2119627e1f33638f1eb9b5890cdc497a3762',
  ]) assert.notEqual(sha, earlier);
});
