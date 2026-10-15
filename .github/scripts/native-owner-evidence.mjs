import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCREENSHOTS = [
  '01-home-shell-header.png', '02-profile-account.png', '03-buy-active.png',
  '04-all-filters-open.png', '05-multiple-trust-filters.png',
  '06-filtered-results-count-chips.png', '07-clear-all-unfiltered.png',
  '08-zero-results.png', '09-trade-gateway.png', '10-verify.png',
  '11-sell.png', '12-notifications-inbox.png',
];
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const UNAVAILABLE = 'unavailable (device capture not initialized)';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const line = (value) => String(value).replace(/[\r\n]/g, ' ');

export function identityFromEnv(env) {
  const required = (key, pattern = /\S/) => {
    const value = env[key] || '';
    if (!pattern.test(value)) throw new Error(`Missing or invalid ${key}`);
    return value;
  };
  return {
    task: 'OC-NATIVE-LR1-R5-R4',
    candidate_sha: required('GITHUB_SHA', /^[a-f0-9]{40}$/),
    github_run_id: required('GITHUB_RUN_ID', /^[1-9][0-9]*$/),
    github_run_attempt: required('GITHUB_RUN_ATTEMPT', /^[1-9][0-9]*$/),
    github_job: required('GITHUB_JOB', /^[A-Za-z0-9_-]+$/),
    platform: required('R4_EVIDENCE_PLATFORM', /^(ios-simulator|android-emulator)$/),
    backend_deployment: required('R4_BACKEND_DEPLOYMENT'),
    backend_sha: required('R4_BACKEND_SHA', /^[a-f0-9]{40}$/),
    backend_url: required('EXPO_PUBLIC_API_URL'),
    supabase_project: required('R4_SUPABASE_PROJECT'),
    external_sends: required('R4_EXTERNAL_SENDS', /^disabled$/),
    auth_state: 'anonymous; unavailable Trade/Inbox states are truthful',
  };
}

export function artifactName(custody) {
  return `oc-native-r5-r4-${custody.platform}-${custody.candidate_sha}`
    + `-run-${custody.github_run_id}-attempt-${custody.github_run_attempt}`
    + `-job-${custody.github_job}-capture-${custody.capture_outcome}`
    + `-${custody.evidence_classification === 'owner-evidence-candidate' ? 'candidate' : 'diagnostic'}`;
}

async function saveCustody(out, custody) {
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'custody.json'), `${JSON.stringify(custody, null, 2)}\n`);
  const fields = [
    ...Object.entries(custody).filter(([, value]) => typeof value !== 'object'),
    ['tool_versions', JSON.stringify(custody.tool_versions)],
    ['validation_errors', JSON.stringify(custody.validation_errors || [])],
  ];
  await writeFile(join(out, 'custody.txt'), fields.map(([key, value]) => `${key}=${line(value)}`).join('\n') + '\n');
}

export async function initialize(out, env) {
  const identity = identityFromEnv(env);
  const custody = {
    ...identity,
    execution_key: `${identity.github_run_id}/${identity.github_run_attempt}/${identity.github_job}`,
    initialized_at: new Date().toISOString(),
    device: UNAVAILABLE,
    os_api: UNAVAILABLE,
    tool_versions: { node: process.version, maestro: 'unavailable (tool setup not completed)' },
    capture_outcome: 'not-started',
    evidence_classification: 'incomplete-diagnostic',
    screenshot_count: 0,
  };
  await saveCustody(out, custody);
  return custody;
}

export async function recordDevice(out, env) {
  const custody = JSON.parse(await readFile(join(out, 'custody.json'), 'utf8'));
  custody.device = env.R4_EVIDENCE_DEVICE || UNAVAILABLE;
  custody.os_api = env.R4_EVIDENCE_OS_API || UNAVAILABLE;
  custody.tool_versions.maestro = env.R4_EVIDENCE_MAESTRO || 'unavailable';
  if (env.R4_EVIDENCE_XCODE) custody.tool_versions.xcode = env.R4_EVIDENCE_XCODE;
  await saveCustody(out, custody);
  return custody;
}

export async function finalize(out, env) {
  const current = identityFromEnv(env);
  let custody;
  try {
    custody = JSON.parse(await readFile(join(out, 'custody.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    custody = await initialize(out, env);
  }
  const errors = [];
  for (const key of Object.keys(current)) {
    if (custody[key] !== current[key]) errors.push(`Stale evidence identity: ${key}`);
  }
  if (errors.length) {
    custody.previous_identity = Object.fromEntries(Object.keys(current).map((key) => [key, custody[key]]));
    Object.assign(custody, current);
    custody.execution_key = `${current.github_run_id}/${current.github_run_attempt}/${current.github_job}`;
  }
  const outcome = env.R4_CAPTURE_OUTCOME;
  if (!['success', 'failure', 'cancelled', 'skipped'].includes(outcome)) errors.push('Invalid capture step outcome');
  custody.capture_outcome = ['success', 'failure', 'cancelled', 'skipped'].includes(outcome) ? outcome : 'unknown';
  const names = (await readdir(out, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
    .map((entry) => entry.name).sort();
  const manifest = [];
  for (const name of names) {
    const bytes = await readFile(join(out, name));
    if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) errors.push(`Invalid PNG: ${name}`);
    manifest.push(`${digest(bytes)}  ${name}`);
  }
  await writeFile(join(out, 'sha256.txt'), manifest.length ? `${manifest.join('\n')}\n` : '');
  if (outcome === 'success') {
    if (JSON.stringify(names) !== JSON.stringify([...SCREENSHOTS].sort())) errors.push('Expected exactly the 12 owner screenshots');
    if (custody.device === UNAVAILABLE || custody.os_api === UNAVAILABLE) errors.push('Device/OS custody is unavailable');
    const osPattern = current.platform === 'ios-simulator' ? /^iOS [0-9]+(?:\.[0-9]+)+$/ : /^Android API [0-9]+$/;
    if (!osPattern.test(custody.os_api)) errors.push('Invalid OS/API custody');
    if (!custody.tool_versions.maestro || custody.tool_versions.maestro.startsWith('unavailable')) errors.push('Maestro version is unavailable');
    if (current.platform === 'ios-simulator' && !custody.tool_versions.xcode) errors.push('Xcode version is unavailable');
  }
  custody.screenshot_count = names.length;
  custody.validation_errors = errors;
  custody.validation_outcome = errors.length ? 'failure' : 'success';
  custody.evidence_classification = outcome === 'success' && !errors.length
    ? 'owner-evidence-candidate' : 'failed-capture-diagnostic';
  custody.finalized_at = new Date().toISOString();
  await saveCustody(out, custody);
  return { custody, artifact_name: artifactName(custody), invalid: errors.length > 0 };
}

// Read the immutable archive identity, not a newer attempt label on a carried job row.
export function classifyExecution(custody, current, catalogJob) {
  if (custody.candidate_sha !== current.candidate_sha || custody.github_run_id !== current.github_run_id
      || custody.github_job !== current.github_job) return 'unrelated';
  const sourceAttempt = Number(custody.github_run_attempt);
  const currentAttempt = Number(current.github_run_attempt);
  if (sourceAttempt === currentAttempt && catalogJob.started_at >= current.started_at) return 'current-execution';
  if (sourceAttempt < currentAttempt && catalogJob.started_at < current.started_at
      && catalogJob.completed_at && catalogJob.completed_at < current.started_at) return 'carried-forward';
  return 'prior-or-inconsistent-evidence';
}

export async function writeUploadReceipt(out, env) {
  const custody = JSON.parse(await readFile(join(out, 'custody.json'), 'utf8'));
  if (env.R4_UPLOAD_ARTIFACT_NAME !== artifactName(custody)) throw new Error('Upload name does not match finalized custody');
  if (!/^[1-9][0-9]*$/.test(env.R4_UPLOAD_ARTIFACT_ID || '')
      || !/^[a-f0-9]{64}$/.test(env.R4_UPLOAD_ARTIFACT_DIGEST || '')) throw new Error('Invalid upload artifact ID/digest');
  const receipt = {
    ...custody,
    artifact_name: artifactName(custody),
    artifact_id: env.R4_UPLOAD_ARTIFACT_ID,
    artifact_digest: `sha256:${env.R4_UPLOAD_ARTIFACT_DIGEST}`,
    artifact_url: env.R4_UPLOAD_ARTIFACT_URL,
    receipt_created_at: new Date().toISOString(),
    final_job_conclusion: 'must be independently checked after job completion',
  };
  const folder = `${out}-receipt`;
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'artifact-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

async function main() {
  const out = process.env.R4_EVIDENCE_OUT || join(process.env.RUNNER_TEMP, 'r5-r4-owner-evidence');
  const command = process.argv[2];
  if (command === 'init') await initialize(out, process.env);
  else if (command === 'device') await recordDevice(out, process.env);
  else if (command === 'finalize') {
    const result = await finalize(out, process.env);
    if (process.env.GITHUB_OUTPUT) {
      await writeFile(process.env.GITHUB_OUTPUT, `artifact_name=${result.artifact_name}\n`, { flag: 'a' });
    }
    console.log(`${result.custody.evidence_classification}: ${result.artifact_name}`);
    if (result.invalid) process.exitCode = 1;
  } else if (command === 'receipt') await writeUploadReceipt(out, process.env);
  else throw new Error(`Unknown evidence command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
