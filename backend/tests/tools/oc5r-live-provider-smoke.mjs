#!/usr/bin/env node
/**
 * OC-5R-PROV-01 D2 — CLI for the governed live-provider smoke. See liveProviderSmoke.mjs.
 *
 *   node backend/tests/tools/oc5r-live-provider-smoke.mjs --provider <gemma|ecb|resend|telegram|meta_whatsapp> --out <dir>
 *
 * Asserts the checkout is EXPECTED_HEAD_SHA when that is set (the workflow always sets it), writes
 * <out>/<provider>.json, prints the status line only, and exits 0 (succeeded), 2 (not configured)
 * or 1 (failed / refused).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runSmoke, exitCodeFor } from './liveProviderSmoke.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

const provider = arg('provider');
const outDir = arg('out') || 'smoke';
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (process.env.EXPECTED_HEAD_SHA && process.env.EXPECTED_HEAD_SHA !== head) {
  console.error(`refused: checkout ${head} is not EXPECTED_HEAD_SHA ${process.env.EXPECTED_HEAD_SHA}`);
  process.exit(1);
}
const run = process.env.GITHUB_RUN_ID
  ? {
    id: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT || null,
    workflow: process.env.GITHUB_WORKFLOW || null,
    ref: process.env.GITHUB_REF_NAME || null,
    event: process.env.GITHUB_EVENT_NAME || null,
  }
  : { id: null, environment: 'local' };

const evidence = await runSmoke(provider, { sha: head, run });
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, `${provider}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`[live-provider-smoke] ${provider}: ${evidence.status} — ${evidence.result}`);
process.exit(exitCodeFor(evidence));
