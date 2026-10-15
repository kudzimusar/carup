import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  SCREENSHOTS, initialize, recordDevice, finalize, classifyExecution, writeUploadReceipt,
} from './native-owner-evidence.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/native-owner-evidence-attempts.json', import.meta.url), 'utf8'));
const cli = fileURLToPath(new URL('./native-owner-evidence.mjs', import.meta.url));
// Synthetic 1px PNGs exercise archive contracts, not native product acceptance.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6CVsAAAAASUVORK5CYII=', 'base64');
const envFor = (platform, attempt) => ({
  ...fixture.env,
  GITHUB_RUN_ATTEMPT: String(attempt),
  GITHUB_JOB: `${platform}-owner-evidence`,
  R4_EVIDENCE_PLATFORM: platform === 'ios' ? 'ios-simulator' : 'android-emulator',
});
async function temp(t) {
  const root = await mkdtemp(join(tmpdir(), 'native-evidence-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function prepare(out, env, names = SCREENSHOTS) {
  await initialize(out, env);
  await recordDevice(out, {
    R4_EVIDENCE_DEVICE: env.R4_EVIDENCE_PLATFORM === 'ios-simulator' ? 'iPhone 16 Pro' : 'Android SDK built for x86_64',
    R4_EVIDENCE_OS_API: env.R4_EVIDENCE_PLATFORM === 'ios-simulator' ? 'iOS 18.5' : 'Android API 35',
    R4_EVIDENCE_MAESTRO: '2.11.0',
    ...(env.R4_EVIDENCE_PLATFORM === 'ios-simulator' ? { R4_EVIDENCE_XCODE: 'Xcode 16.4 Build version 16F6' } : {}),
  });
  for (const name of names) await writeFile(join(out, name), png);
}
async function immutableFixtureUpload(store, name, out) {
  // Offline create-only transport: an existing artifact is never overwritten.
  const target = join(store, name);
  await mkdir(target);
  await cp(out, target, { recursive: true });
  return JSON.parse(await readFile(join(target, 'custody.json'), 'utf8'));
}

test('attempts 1 and 2 have exact distinct names, coexist and retain different custody', async (t) => {
  const root = await temp(t); const store = join(root, 'store'); await mkdir(store);
  const results = [];
  for (const attempt of [1, 2]) {
    const env = envFor('ios', attempt); const out = join(root, `attempt-${attempt}`);
    await prepare(out, env);
    results.push(await finalize(out, { ...env, R4_CAPTURE_OUTCOME: 'success' }));
    await immutableFixtureUpload(store, results.at(-1).artifact_name, out);
  }
  assert.equal(results[0].artifact_name, 'oc-native-r5-r4-ios-simulator-266c9c7608ab3476d188132ef4b3f6503c606830-run-38532894761-attempt-1-job-ios-owner-evidence-capture-success-candidate');
  assert.equal(results[1].artifact_name, 'oc-native-r5-r4-ios-simulator-266c9c7608ab3476d188132ef4b3f6503c606830-run-38532894761-attempt-2-job-ios-owner-evidence-capture-success-candidate');
  assert.notEqual(results[0].custody.execution_key, results[1].custody.execution_key);
  assert.deepEqual(results.map((r) => r.custody.github_run_attempt), ['1', '2']);
  assert.equal((await readdir(store)).length, 2);
  await assert.rejects(immutableFixtureUpload(store, results[0].artifact_name, join(root, 'attempt-2')), { code: 'EEXIST' });
  const original = JSON.parse(await readFile(join(store, results[0].artifact_name, 'custody.json'), 'utf8'));
  assert.equal(original.github_run_attempt, '1');
});

for (const platform of ['ios', 'android']) {
  test(`${platform} custody contains all required identity, device, tool and backend fields`, async (t) => {
    const root = await temp(t); const env = envFor(platform, 2); await prepare(root, env);
    const result = await finalize(root, { ...env, R4_CAPTURE_OUTCOME: 'success' });
    assert.equal(result.invalid, false);
    assert.equal(result.custody.evidence_classification, 'owner-evidence-candidate');
    const text = await readFile(join(root, 'custody.txt'), 'utf8');
    for (const key of ['task', 'candidate_sha', 'github_run_id', 'github_run_attempt', 'github_job', 'platform', 'device', 'os_api', 'tool_versions', 'backend_deployment', 'backend_sha', 'supabase_project', 'external_sends', 'auth_state']) {
      assert.match(text, new RegExp(`^${key}=.+$`, 'm'), key);
    }
    assert.equal(result.custody.backend_deployment, fixture.env.R4_BACKEND_DEPLOYMENT);
    assert.equal(result.custody.backend_sha, fixture.env.R4_BACKEND_SHA);
    const manifest = (await readFile(join(root, 'sha256.txt'), 'utf8')).trim().split('\n');
    assert.equal(manifest.length, 12);
    for (const row of manifest) {
      const [hash, name] = row.split('  ');
      assert.equal(hash, createHash('sha256').update(await readFile(join(root, name))).digest('hex'));
    }
    assert.ok(result.artifact_name.length < 256);
  });
}

test('failure fixture retains uploadable diagnostics and never becomes a successful candidate', async (t) => {
  const root = await temp(t); const out = join(root, 'evidence'); const env = envFor('ios', 1);
  await prepare(out, env, fixture.failure.screenshots);
  const capture = spawnSync(process.execPath, ['-e', `process.exit(${fixture.failure.capture_exit_code})`]);
  assert.equal(capture.status, 1);
  const output = join(root, 'outputs.txt');
  const finish = spawnSync(process.execPath, [cli, 'finalize'], {
    env: { ...process.env, ...env, R4_EVIDENCE_OUT: out, GITHUB_OUTPUT: output, R4_CAPTURE_OUTCOME: fixture.failure.capture_outcome }, encoding: 'utf8',
  });
  assert.equal(finish.status, 0, finish.stderr); // Diagnostic preparation does not mask the capture's failed step.
  const name = (await readFile(output, 'utf8')).trim().slice('artifact_name='.length);
  assert.match(name, /-attempt-1-job-ios-owner-evidence-capture-failure-diagnostic$/);
  const store = join(root, 'store'); await mkdir(store);
  const uploaded = await immutableFixtureUpload(store, name, out);
  assert.equal(uploaded.evidence_classification, fixture.failure.expected_classification);
  assert.equal(uploaded.capture_outcome, 'failure');
  assert.equal(uploaded.screenshot_count, 1);
  assert.match(await readFile(join(store, name, 'custody.txt'), 'utf8'), /^capture_outcome=failure$/m);
  assert.equal(capture.status === 0 && finish.status === 0, false, 'Uploadable diagnostics must not imply a successful job');
});

test('a capture skipped before device setup still has truthful diagnostic custody', async (t) => {
  const out = await temp(t); const env = envFor('android', 1); await initialize(out, env);
  const result = await finalize(out, { ...env, R4_CAPTURE_OUTCOME: 'skipped' });
  assert.equal(result.custody.evidence_classification, 'failed-capture-diagnostic');
  assert.equal(result.custody.screenshot_count, 0);
  assert.match(result.custody.device, /^unavailable/);
  assert.match(result.artifact_name, /capture-skipped-diagnostic$/);
});

test('success with missing screenshots fails closed but writes a diagnostic upload name', async (t) => {
  const out = await temp(t); const env = envFor('ios', 2); await prepare(out, env, SCREENSHOTS.slice(0, 1));
  const output = join(out, 'outputs.txt');
  const result = spawnSync(process.execPath, [cli, 'finalize'], {
    env: { ...process.env, ...env, R4_EVIDENCE_OUT: out, GITHUB_OUTPUT: output, R4_CAPTURE_OUTCOME: 'success' }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(await readFile(output, 'utf8'), /capture-success-diagnostic/);
  const custody = JSON.parse(await readFile(join(out, 'custody.json'), 'utf8'));
  assert.equal(custody.validation_outcome, 'failure');
  assert.equal(custody.evidence_classification, 'failed-capture-diagnostic');
});

test('stale attempt identity cannot certify even a complete image set', async (t) => {
  const out = await temp(t); await prepare(out, envFor('android', 1));
  const result = await finalize(out, { ...envFor('android', 2), R4_CAPTURE_OUTCOME: 'success' });
  assert.equal(result.invalid, true);
  assert.equal(result.custody.previous_identity.github_run_attempt, '1');
  assert.equal(result.custody.evidence_classification, 'failed-capture-diagnostic');
});

test('mixed backend custody cannot become a candidate', async (t) => {
  const out = await temp(t); const env = envFor('android', 2); await prepare(out, env);
  const result = await finalize(out, { ...env, R4_BACKEND_SHA: 'b'.repeat(40), R4_CAPTURE_OUTCOME: 'success' });
  assert.equal(result.invalid, true);
  assert.equal(result.custody.previous_identity.backend_sha, fixture.env.R4_BACKEND_SHA);
  assert.equal(result.custody.evidence_classification, 'failed-capture-diagnostic');
});

test('immutable archive identity distinguishes Android carry-forward from re-execution', async (t) => {
  const out = await temp(t); const env = envFor('android', 1); await prepare(out, env);
  const original = (await finalize(out, { ...env, R4_CAPTURE_OUTCOME: 'success' })).custody;
  const current = { ...original, github_run_attempt: '2', started_at: fixture.attempt_2.started_at };
  assert.equal(classifyExecution(original, current, fixture.attempt_2.android_carry_forward), 'carried-forward');
  assert.equal(classifyExecution(original, current, fixture.attempt_2.android_reexecution_fixture), 'prior-or-inconsistent-evidence');
  const rerun = { ...original, github_run_attempt: '2', execution_key: '38532894761/2/android-owner-evidence' };
  assert.equal(classifyExecution(rerun, current, fixture.attempt_2.android_reexecution_fixture), 'current-execution');
  assert.notEqual(original.execution_key, rerun.execution_key);
});

test('upload receipt binds the artifact digest outside the source archive, including failures', async (t) => {
  const out = await temp(t); const env = envFor('ios', 1); await prepare(out, env, fixture.failure.screenshots);
  const finished = await finalize(out, { ...env, R4_CAPTURE_OUTCOME: 'failure' });
  t.after(() => rm(`${out}-receipt`, { recursive: true, force: true }));
  const upload = { R4_UPLOAD_ARTIFACT_NAME: finished.artifact_name, R4_UPLOAD_ARTIFACT_ID: '1234', R4_UPLOAD_ARTIFACT_DIGEST: 'a'.repeat(64), R4_UPLOAD_ARTIFACT_URL: 'https://github.com/example/fixture/artifacts/1234' };
  const receipt = await writeUploadReceipt(out, upload);
  assert.equal(receipt.github_run_attempt, '1');
  assert.equal(receipt.artifact_digest, `sha256:${'a'.repeat(64)}`);
  assert.equal(receipt.evidence_classification, 'failed-capture-diagnostic');
  assert.equal((await readdir(out)).includes('artifact-receipt.json'), false);
  assert.equal(JSON.parse(await readFile(`${out}-receipt/artifact-receipt.json`, 'utf8')).artifact_id, '1234');
  await assert.rejects(writeUploadReceipt(out, { ...upload, R4_UPLOAD_ARTIFACT_NAME: 'unrelated-artifact' }), /Upload name/);
});

test('both workflow jobs preserve always-upload diagnostics and wire the tested contract', async () => {
  const workflow = await readFile(new URL('../workflows/oc-native-r5-r4-owner-evidence.yml', import.meta.url), 'utf8');
  const jobs = workflow.split(/^  (?:ios|android)-owner-evidence:\n/m).slice(1);
  assert.equal(jobs.length, 2);
  for (const [i, job] of jobs.entries()) {
    const platform = i === 0 ? 'ios' : 'android';
    assert.match(job, /run: node \.github\/scripts\/native-owner-evidence\.mjs init/);
    assert.match(job, /native-owner-evidence\.mjs" device/);
    assert.match(job, new RegExp(`id: finalize_${platform}\\n        if: always\\(\\)`));
    assert.match(job, new RegExp(`R4_CAPTURE_OUTCOME: \\$\\{\\{ steps.capture_${platform}\\.outcome \\}\\}`));
    assert.match(job, new RegExp(`id: upload_${platform}\\n        if: always\\(\\)`));
    assert.match(job, /overwrite: false/);
    assert.match(job, /-run-\{1\}-attempt-\{2\}-job-\{3\}-diagnostic-uninitialized/);
    assert.match(job, /github\.sha, github\.run_id, github\.run_attempt, github\.job/);
    assert.match(job, /native-owner-evidence\.mjs receipt/);
    assert.doesNotMatch(job, /continue-on-error:|overwrite: true/);
    assert.ok(job.indexOf('native-owner-evidence.mjs init') < job.indexOf('id: capture_'));
  }
  assert.match(workflow, /R4_BACKEND_DEPLOYMENT: dpl_9Q85zjgdKkVGBqXW8WB7aHV6HogC/);
  assert.match(workflow, /R4_BACKEND_SHA: 40621751d4b74c59324fe6601aa5ddbdc7769b08/);
  assert.match(workflow, /R4_EXTERNAL_SENDS: disabled/);
});
