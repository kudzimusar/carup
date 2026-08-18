#!/usr/bin/env node
/**
 * Staging runtime revision parity guard.
 *
 * CarUp's staging environment serves TWO operational runtimes:
 *
 *   api-staging.carup.dev             — webhooks and API (what certification talks to)
 *   carup-backend-staging.vercel.app  — the pg_cron worker's target (what actually SENDS Email)
 *
 * They drifted during Email 1.0 and produced a real defect: the API runtime had the marketing
 * unsubscribe control while the sending runtime did not, so a governed marketing message reached a
 * human inbox with no way to unsubscribe. Certifying against one runtime proves nothing about the
 * other, and nothing detected the gap — a person reading the delivered Email did.
 *
 * This asserts both runtimes report the same build revision before Email/Communications work may be
 * treated as exact-head certified.
 *
 * Usage:
 *   node scripts/assert-staging-runtime-parity.mjs                 # both runtimes must agree
 *   node scripts/assert-staging-runtime-parity.mjs <expected-sha>   # ...and match this revision
 *
 * Exits non-zero and prints the disagreement on drift. Fails closed: a runtime that cannot state its
 * revision is a failure, never a pass.
 */

import { assertRuntimeRevisionParity } from '../backend/config/buildProvenance.js';

const RUNTIMES = [
  { name: 'api-staging.carup.dev', url: 'https://api-staging.carup.dev/api/health' },
  { name: 'carup-backend-staging.vercel.app (cron sender)', url: 'https://carup-backend-staging.vercel.app/api/health' },
];

const TIMEOUT_MS = 20_000;

async function probe(runtime) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(runtime.url, { signal: controller.signal });
    if (!response.ok) return { ...runtime, error: `HTTP ${response.status}` };
    const body = await response.json();
    return { ...runtime, provenance: body?.build || null };
  } catch (error) {
    return { ...runtime, error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timer);
  }
}

const expectedSha = process.argv[2] || process.env.EXPECTED_SHA || null;
const results = await Promise.all(RUNTIMES.map(probe));
const verdict = assertRuntimeRevisionParity(results, expectedSha);

console.log('Staging runtime revision parity');
for (const r of results) {
  const sha = r.provenance?.commit_sha_short || null;
  console.log(`  ${r.name.padEnd(46)} ${sha ? `sha=${sha}` : `UNAVAILABLE (${r.error || 'no provenance'})`}`);
}
if (expectedSha) console.log(`  expected revision${' '.repeat(29)} ${String(expectedSha).slice(0, 8)}`);

if (verdict.pass) {
  console.log(`\nSTAGING_RUNTIME_REVISION_PARITY=PASS (${String(verdict.revision).slice(0, 8)})`);
  process.exit(0);
}

console.error('\nSTAGING_RUNTIME_REVISION_PARITY=FAIL');
for (const problem of verdict.problems) console.error(`  - ${problem}`);
console.error(
  '\nBoth staging runtimes must be built from the same revision before Email/Communications work'
  + '\ncan be treated as exact-head certified. Deploy the intended revision to BOTH, then re-run.',
);
process.exit(1);
