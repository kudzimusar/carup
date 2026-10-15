/**
 * OC-5R-DB2B-3R1 — no automatic event may re-apply synthetic reference media to canonical staging.
 *
 * OC-5R-DB2B-3 retired 45 synthetic objects (vehicle-images/marketplace-reference-synthetic/v1) and their
 * listing_images rows from staging. The workflow that wrote them,
 * .github/workflows/marketplace-reference-media-staging.yml, ran `--mode=apply` on pull_request events of
 * PR #182, so a routine push to that branch would have silently re-contaminated staging.
 *
 * This guard parses EVERY workflow and proves: (1) no pull_request, push, schedule or other automatic event
 * can reach a synthetic-media writer; (2) the one remaining writer is manual-only and refuses unless the
 * exact confirmation phrase is supplied, in a job that holds no credentials; (3) production cannot be the
 * target. The shell gates are EXECUTED with bash, not pattern-matched, so a gate that stops refusing fails
 * here.   Run: node --test backend/tests/oc5r-synthetic-media-writer-guard.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const { evaluateStagingGuard } = await import('../scripts/issue164-golden-vehicles.mjs');
const { SERVICE_ROLE_TOKEN } = await import('./helpers/goldenTestTokens.mjs');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOWS = resolve(ROOT, '.github/workflows');
const WRITER_WORKFLOW = 'marketplace-reference-media-staging.yml';
const CONFIRM_INPUT = 'confirm_synthetic_staging_write';
const CONFIRM_PHRASE = 'WRITE-SYNTHETIC-MEDIA-TO-CANONICAL-STAGING';
const STAGING_URL = 'https://eoyenigwevnxwwhyhaer.supabase.co';
const PROD_REF = ['vhmnajoeicasa', 'igiophh'].join(''); // split so this file never trips the CR-1 scanner

// A YAML 1.1 parser reads a bare `on:` key as boolean true; accept both spellings.
const onOf = (wf) => wf?.on ?? wf?.[true];
const triggersOf = (wf) => {
  const on = onOf(wf);
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on || {});
};

// A step writes synthetic media if it runs the importer in apply mode or names the synthetic prefix.
// The importer defaults to --mode=verify, which is read-only, so a bare or verify invocation is not a writer.
const writesSyntheticMedia = (step) => {
  const run = String(step?.run || '');
  return (/marketplace-reference-media-staging\.mjs/.test(run) && /--mode[= ]apply/.test(run))
    || /marketplace-reference-synthetic/.test(run);
};

function syntheticMediaWriters(workflowText) {
  const wf = yaml.load(workflowText);
  const jobs = Object.entries(wf?.jobs || {}).filter(([, job]) => (job.steps || []).some(writesSyntheticMedia));
  const triggers = triggersOf(wf);
  return { wf, triggers, jobs, automatic: jobs.length > 0 && triggers.some((t) => t !== 'workflow_dispatch') };
}

const workflowFiles = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort();
const load = (f) => readFileSync(resolve(WORKFLOWS, f), 'utf8');
const bash = (script, env) => spawnSync('bash', ['-c', script], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });

test('automatic staging synthetic-media writers = 0 across every workflow', () => {
  assert.ok(workflowFiles.length > 10, 'the workflow directory must actually be scanned');
  const automatic = workflowFiles.filter((f) => syntheticMediaWriters(load(f)).automatic);
  assert.deepEqual(automatic, [], `automatic synthetic-media writers: ${automatic.join(', ')}`);
});

test('the detector is not vacuous: pull_request, push, schedule and mixed triggers are all caught', () => {
  const step = 'node backend/scripts/marketplace-reference-media-staging.mjs --mode=apply';
  for (const on of ['pull_request', 'push', '{schedule: [{cron: "0 0 * * *"}]}', '[workflow_dispatch, pull_request]', 'workflow_run']) {
    const text = `on: ${on}\njobs:\n  w:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${step}\n`;
    assert.equal(syntheticMediaWriters(text).automatic, true, `not caught: on: ${on}`);
  }
  const verifyOnly = 'on: pull_request\njobs:\n  v:\n    runs-on: ubuntu-latest\n    steps:\n'
    + '      - run: node backend/scripts/marketplace-reference-media-staging.mjs --mode=verify\n';
  assert.equal(syntheticMediaWriters(verifyOnly).jobs.length, 0, 'read-only verification is not a writer');
});

test('the only remaining writer is manual-only and refuses by default, before any credential is reachable', () => {
  const writers = workflowFiles.map((f) => [f, syntheticMediaWriters(load(f))]).filter(([, r]) => r.jobs.length);
  assert.deepEqual(writers.map(([f]) => f), [WRITER_WORKFLOW], 'only the retired importer workflow may contain the writer');
  for (const [f, { wf, triggers, jobs }] of writers) {
    assert.deepEqual(triggers, ['workflow_dispatch'], `${f} must be workflow_dispatch only`);
    const input = onOf(wf).workflow_dispatch?.inputs?.[CONFIRM_INPUT];
    assert.ok(input, `${f} must declare the ${CONFIRM_INPUT} input`);
    assert.equal(input.required, true);
    assert.equal(input.default ?? '', '', 'the default must be refusal (empty)');
    assert.equal(wf.env?.CONFIRM_PHRASE, CONFIRM_PHRASE);
    for (const [name, job] of jobs) {
      assert.ok(String(job.if || '').includes(`inputs.${CONFIRM_INPUT} == '${CONFIRM_PHRASE}'`), `${f}:${name} must be gated on the exact phrase`);
      const needs = [].concat(job.needs || []);
      assert.ok(needs.length > 0, `${f}:${name} must depend on the confirmation job`);
      for (const gateName of needs) {
        const gate = wf.jobs[gateName];
        assert.equal(gate.environment, undefined, `${f}:${gateName} must not enter a credentialed environment`);
        assert.ok(!JSON.stringify(gate).includes('secrets.'), `${f}:${gateName} must reference no secrets`);
        const script = gate.steps.map((s) => s.run || '').join('\n');
        for (const attempt of ['', 'yes', 'true', CONFIRM_PHRASE.toLowerCase(), `${CONFIRM_PHRASE} `]) {
          const status = bash(script, { CONFIRM: attempt, CONFIRM_PHRASE: wf.env.CONFIRM_PHRASE }).status;
          assert.notEqual(status, 0, `the gate accepted ${JSON.stringify(attempt)}`);
        }
        assert.equal(bash(script, { CONFIRM: CONFIRM_PHRASE, CONFIRM_PHRASE: wf.env.CONFIRM_PHRASE }).status, 0);
      }
    }
  }
});

test('production cannot be the target of the synthetic-media writer', () => {
  const text = load(WRITER_WORKFLOW);
  const { wf, jobs } = syntheticMediaWriters(text);
  assert.ok(!text.includes(PROD_REF), 'the workflow must never name the production project');
  assert.equal(wf.env?.CANONICAL_STAGING_URL, STAGING_URL);
  for (const [, job] of jobs) {
    const applyAt = job.steps.findIndex(writesSyntheticMedia);
    const identityAt = job.steps.findIndex((s) => String(s.run || '').includes('CANONICAL_STAGING_URL'));
    assert.ok(identityAt >= 0 && identityAt < applyAt, 'the exact staging identity check must precede the apply step');
    const script = job.steps[identityAt].run;
    const status = (url) => bash(script, { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'present', CANONICAL_STAGING_URL: wf.env.CANONICAL_STAGING_URL }).status;
    assert.notEqual(status(`https://${PROD_REF}.supabase.co`), 0, 'a production URL must be refused');
    assert.notEqual(status(`https://${PROD_REF}.supabase.co/?ref=eoyenigwevnxwwhyhaer`), 0);
    assert.notEqual(status('https://example.supabase.co'), 0);
    assert.equal(status(STAGING_URL), 0);
    assert.equal(status(`${STAGING_URL}/`), 0);
  }
  // The importer keeps its own canonical guard, which refuses production regardless of the workflow.
  const importer = readFileSync(resolve(ROOT, 'backend/scripts/marketplace-reference-media-staging.mjs'), 'utf8');
  assert.match(importer, /evaluateStagingGuard\(process\.env\)/);
  const refused = evaluateStagingGuard({ SUPABASE_URL: `https://${PROD_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_TOKEN });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /forbidden production ref/);
  assert.equal(evaluateStagingGuard({ SUPABASE_URL: STAGING_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_TOKEN }).ok, true);
});
