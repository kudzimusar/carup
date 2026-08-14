/**
 * Guards for the Issue #101 Data API surface WORKFLOW wrapper.
 *
 * The wrapper must not be able to widen what the pinned probe may do — and for an
 * HTTP probe the dangerous widenings are different from the SQL lanes: a mutating
 * method, an RPC invocation, or a row fetch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.resolve(__dirname, '../../.github/workflows/issue-101-production-data-api-surface.yml');
const wf = fs.readFileSync(WORKFLOW, 'utf8');
const noComments = wf.replace(/#.*$/gm, '');

test('the workflow is workflow_dispatch only, with no inputs', () => {
  assert.match(wf, /workflow_dispatch:/);
  assert.ok(!/^\s*(push|pull_request|schedule|repository_dispatch):/m.test(noComments));
  assert.ok(!/^\s*inputs:/m.test(noComments), 'the dispatch takes no inputs');
});

test('the workflow pins and ASSERTS an immutable candidate SHA', () => {
  const env = /CANDIDATE_SHA:\s*([0-9a-f]{40})/.exec(noComments);
  const ref = /ref:\s*([0-9a-f]{40})/.exec(noComments);
  assert.ok(env && ref);
  assert.equal(ref[1], env[1]);
  assert.match(wf, /git rev-parse HEAD/);
  assert.match(wf, /expected the pinned candidate/i);
});

test('the workflow enforces production identity controls', () => {
  assert.match(noComments, /environment:\s*production/i);
  assert.match(noComments, /github\.actor\s*==\s*'kudzimusar'/);
  assert.match(noComments, /github\.triggering_actor\s*==\s*'kudzimusar'/);
  assert.match(noComments, /github\.ref\s*==\s*'refs\/heads\/main'/);
  assert.match(noComments, /PRODUCTION_PROJECT_REF/);
  assert.match(noComments, /permissions:\s*\n\s*contents:\s*read/);
});

test('the wrapper never supplies a database URL or an arbitrary API URL', () => {
  assert.ok(!/PRODUCTION_DATABASE_URL/.test(wf), 'this probe must not receive a DB connection string');
  assert.ok(!/PRODUCTION_DATA_API_URL/.test(wf), 'the origin is derived from the ref, not supplied');
});

test('the pre-run guard refuses mutating methods, RPC invocation and row fetches', () => {
  assert.match(wf, /contains a mutating HTTP method; refusing to run/);
  assert.match(wf, /would invoke an RPC; refusing to run/);
  assert.match(wf, /would request application rows; refusing to run/);
  assert.match(wf, /does not pin GET as its only method; refusing to run/);
});

test('a missing Data API key is a WARNING that yields INDETERMINATE, not an error', () => {
  assert.match(wf, /PRODUCTION_DATA_API_METADATA_KEY is not configured/);
  assert.match(wf, /INDETERMINATE and stop/);
  assert.match(wf, /intended fail-closed behaviour, not an error/);
});

test('the workflow runs the surface probe and nothing else', () => {
  const runs = [...wf.matchAll(/run:\s*node\s+(\S+)/g)].map((m) => m[1]);
  assert.deepEqual(runs, ['backend/scripts/production-data-api-surface.mjs']);
});

test('the pinned candidate exists and carries the safety properties', () => {
  const sha = /CANDIDATE_SHA:\s*([0-9a-f]{40})/.exec(noComments)[1];
  const cwd = path.resolve(__dirname, '../..');
  assert.equal(execFileSync('git', ['cat-file', '-t', sha], { cwd, encoding: 'utf8' }).trim(), 'commit');
  const blob = execFileSync('git', ['show', `${sha}:backend/scripts/production-data-api-surface.mjs`], { cwd, encoding: 'utf8' });
  assert.match(blob, /ALLOWED_HTTP_METHOD = 'GET'/, 'pinned probe must pin GET');
  assert.match(blob, /DATA_API_SURFACE = INDETERMINATE/, 'pinned probe must fail closed');
  assert.match(blob, /ADVERTISED != EXPLOITABLE/, 'pinned probe must carry the caveat');
  assert.ok(!/method:\s*['"`](POST|PATCH|PUT|DELETE)/.test(blob), 'pinned probe must have no mutating method');
  assert.ok(!/select=|limit=|offset=/.test(blob), 'pinned probe must not request rows');
  assert.match(blob, /METADATA_KEY_ENV = 'PRODUCTION_DATA_API_METADATA_KEY'/, 'pinned probe must use the elevated metadata key name');
  assert.ok(!/Authorization: \`Bearer/.test(blob), 'pinned probe must never bearer-frame the key');
  assert.match(blob, /SCHEMA_ADVERTISED/, 'pinned probe must use the layered evidence taxonomy');
  assert.match(blob, /FROZEN_DB_AUTHORIZATION/, 'pinned probe must combine the frozen layer-2 evidence');
});

test('the pin does not name any earlier Issue #101 probe', () => {
  const sha = /CANDIDATE_SHA:\s*([0-9a-f]{40})/.exec(noComments)[1];
  for (const earlier of [
    '008e1f4987d598258296753fe8f45090edd05cfc', // inventory probe
    'ea6b65650e913d30dfa25389ab64cdcfeb5a3768', // reachability probe
    'fe51f5b66ab8c3e40e3cbf2ea379cc24a545b2e7',
    'f1e515c71f6303354c5d75ccb001ed122f0418ce',
    '23c31397c200c08168b01c6d4ad649294265752c', // pre-review surface candidate
  ]) assert.notEqual(sha, earlier, 'this workflow must pin the Data API surface probe');
});
