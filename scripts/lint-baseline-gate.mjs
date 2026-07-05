#!/usr/bin/env node
/**
 * Baseline-aware lint regression gate.
 *
 * `main` carries historical lint debt, so `eslint .` cannot be a zero-error blocking gate.
 * This gate instead lints BOTH the base branch and the PR head and FAILS only on NET-NEW
 * findings — any new error OR warning introduced by the PR. It does not disable rules, does
 * not mutate config, and does not swallow failures.
 *
 * Comparison key is STABLE across line shifts: relativePath + ruleId + severity (counted).
 * Net-new(key) = max(0, prCount - baseCount). Exit 1 if any net-new error or warning.
 *
 * Usage:  node scripts/lint-baseline-gate.mjs [baseRef]
 *   baseRef defaults to env LINT_BASE_REF or 'origin/main'.
 *
 * Full-repo lint stays available as advisory inventory (printed, never blocking here).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const baseRef = process.argv[2] || process.env.LINT_BASE_REF || 'origin/main';
const ESLINT = join(repoRoot, 'node_modules', 'eslint', 'bin', 'eslint.js');
const WEB_SUBDIR = 'web';

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

/** Run eslint over the web project at `webDir`, returning the parsed JSON result array. */
function lint(webDir) {
  let out = '';
  try {
    out = run('node', [ESLINT, '.', '--format', 'json'], { cwd: webDir, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    // eslint exits non-zero when it finds lint errors; the JSON report is still on stdout.
    out = e.stdout ? e.stdout.toString() : '';
  }
  if (!out.trim()) throw new Error(`eslint produced no JSON output for ${webDir}`);
  return JSON.parse(out);
}

/** Map of stable key -> count, plus relPath for reporting. key = relPath::ruleId::severity */
function countsByKey(results) {
  const counts = new Map();
  for (const f of results) {
    const idx = f.filePath.lastIndexOf(`/${WEB_SUBDIR}/`);
    const relPath = idx >= 0 ? f.filePath.slice(idx + 1) : f.filePath; // e.g. web/src/...
    for (const m of f.messages) {
      if (!m.ruleId) continue; // skip parser/syntax notes without a rule id
      const key = `${relPath}::${m.ruleId}::${m.severity}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

function totals(results) {
  let errors = 0; let warnings = 0;
  for (const f of results) { errors += f.errorCount || 0; warnings += f.warningCount || 0; }
  return { errors, warnings };
}

// --- PR (current tree) ---------------------------------------------------------------
const prResults = lint(join(repoRoot, WEB_SUBDIR));
const prCounts = countsByKey(prResults);
const prTotals = totals(prResults);

// --- Base branch (isolated worktree, shared node_modules) ----------------------------
run('git', ['-C', repoRoot, 'fetch', '--no-tags', '--depth', '1', 'origin',
  baseRef.replace(/^origin\//, '')], { stdio: 'ignore' });
const baseWt = mkdtempSync(join(tmpdir(), 'lint-base-'));
let baseCounts;
try {
  run('git', ['-C', repoRoot, 'worktree', 'add', '--detach', baseWt, baseRef], { stdio: 'ignore' });
  // Reuse the PR's installed dependencies (package.json is unchanged by the PR).
  for (const p of ['node_modules', join('backend', 'node_modules')]) {
    const target = join(repoRoot, p);
    const link = join(baseWt, p);
    if (existsSync(target) && !existsSync(link)) {
      try { symlinkSync(target, link); } catch { /* best effort */ }
    }
  }
  const baseResults = lint(join(baseWt, WEB_SUBDIR));
  baseCounts = countsByKey(baseResults);
} finally {
  try { run('git', ['-C', repoRoot, 'worktree', 'remove', '--force', baseWt], { stdio: 'ignore' }); } catch { /* noop */ }
  try { rmSync(baseWt, { recursive: true, force: true }); } catch { /* noop */ }
}

// --- Net-new comparison --------------------------------------------------------------
const newErrors = [];
const newWarnings = [];
for (const [key, prCount] of prCounts) {
  const baseCount = baseCounts.get(key) || 0;
  const delta = prCount - baseCount;
  if (delta > 0) {
    const severity = Number(key.split('::').pop());
    const entry = `${key}  (+${delta})`;
    if (severity === 2) newErrors.push(entry); else newWarnings.push(entry);
  }
}
const NET_NEW_ERRORS = newErrors.reduce((s, e) => s + Number(e.match(/\(\+(\d+)\)/)[1]), 0);
const NET_NEW_WARNINGS = newWarnings.reduce((s, e) => s + Number(e.match(/\(\+(\d+)\)/)[1]), 0);

console.log('── Lint baseline gate ───────────────────────────────────────');
console.log(`base ref: ${baseRef}`);
console.log(`advisory full-repo inventory (PR): errors=${prTotals.errors} warnings=${prTotals.warnings}`);
if (newErrors.length) { console.log('\nNEW ERRORS:'); newErrors.forEach((e) => console.log('  ' + e)); }
if (newWarnings.length) { console.log('\nNEW WARNINGS:'); newWarnings.forEach((e) => console.log('  ' + e)); }
console.log(`\nNET_NEW_ERRORS=${NET_NEW_ERRORS}`);
console.log(`NET_NEW_WARNINGS=${NET_NEW_WARNINGS}`);

if (NET_NEW_ERRORS > 0 || NET_NEW_WARNINGS > 0) {
  console.error('\n✖ Lint regression gate FAILED: the PR introduces new lint findings vs base.');
  process.exit(1);
}
console.log('\n✓ No new lint errors or warnings vs base.');
