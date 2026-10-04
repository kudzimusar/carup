#!/usr/bin/env node
/**
 * The aggregate gate.
 *
 * Three green viewports are only a pass if they certified THE SAME THING. Each shard writes what it
 * resolved — branch, SHA, frontend, backend, `unpaired`, staging project — and this compares them.
 *
 * Without it, three shards could each be green against a different candidate: a deployment can move
 * between shards, and the whole point of the pairing repair is that a gate never certifies something
 * other than the candidate it claims to.
 *
 * Usage: node scripts/ci/assert-staging-shards-agree.mjs <dir-of-pairing-records> chromium tablet mobile
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [dir, ...required] = process.argv.slice(2);
if (!dir || !required.length) {
  console.error('usage: assert-staging-shards-agree.mjs <dir> <project> [<project>…]');
  process.exit(2);
}

/** Artifacts download into per-artifact subdirectories; find every record wherever it landed. */
function findRecords(root) {
  const found = [];
  const walk = (p) => {
    for (const entry of readdirSync(p)) {
      const full = join(p, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.json')) found.push(full);
    }
  };
  try { walk(root); } catch { /* reported below as missing */ }
  return found;
}

const records = findRecords(dir).map((f) => {
  try { return { file: f, ...JSON.parse(readFileSync(f, 'utf8')) }; } catch { return null; }
}).filter(Boolean);

const byProject = new Map();
for (const r of records) if (r.project) byProject.set(r.project, r);

let failed = 0;
const fail = (msg) => { console.error(`AGGREGATE FAILED: ${msg}`); failed += 1; };

// 1. Every required shard must have reported. A missing shard is not a pass.
for (const project of required) {
  if (!byProject.has(project)) fail(`no pairing record from the "${project}" shard — it did not run, or did not certify`);
}
if (failed) { console.error(`\n${failed} problem(s).`); process.exit(1); }

// 2. …and they must all have certified the SAME candidate against the SAME pairing.
const reference = byProject.get(required[0]);
for (const key of ['branch', 'sha', 'frontend', 'backend', 'staging_project_ref']) {
  const values = new Set(required.map((p) => JSON.stringify(byProject.get(p)[key] ?? null)));
  if (values.size !== 1) {
    fail(`shards disagree on "${key}": ${required.map((p) => `${p}=${byProject.get(p)[key]}`).join(' · ')}`);
  }
}

// 3. Nothing may have run unpaired.
for (const project of required) {
  if (byProject.get(project).unpaired !== false) fail(`the "${project}" shard ran with unpaired=${byProject.get(project).unpaired}`);
}

if (failed) { console.error(`\n${failed} problem(s).`); process.exit(1); }

console.log(JSON.stringify({
  aggregate: 'ok',
  projects: required,
  sha: reference.sha,
  branch: reference.branch,
  frontend: reference.frontend,
  backend: reference.backend,
  staging_project_ref: reference.staging_project_ref,
  unpaired: false,
}, null, 2));
