/**
 * Issue #164 — public.vehicle_listing_summaries removal, permanent guard.
 *
 * The table is a dormant SECOND declaration of the public listing contract, carrying its own
 * duty_cleared / cid_clear / passport_verified / plate_verified / trust_score columns and a public
 * read policy. Issue #164 exists because CarUp had several competing sources of vehicle truth, so
 * the risk is not the empty table — it is a future writer populating it and republishing an
 * unreconciled second set of trust claims.
 *
 * SQL cannot check condition 4 of the product-owner decision ("no application references"), so it
 * lives here. This suite fails the build if any code path starts querying the relation, before or
 * after the drop migration runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TABLE = 'vehicle_listing_summaries';
const MIGRATION = '20260818100000_issue164_drop_dead_vehicle_listing_summaries.sql';

/** Source trees where a live reference would mean the table is still in use. */
const CODE_ROOTS = ['backend', 'web/src', 'shared', 'mobile'];
const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'tests', '__tests__']);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    let stats;
    try { stats = statSync(full); } catch { continue; }
    if (stats.isDirectory()) walk(full, out);
    else if (CODE_EXTENSIONS.has(path.extname(entry))) out.push(full);
  }
  return out;
}

const codeFiles = CODE_ROOTS.flatMap(root => walk(path.join(REPO_ROOT, root)));

test('the scan actually reaches the source tree, so a clean result means something', () => {
  assert.ok(codeFiles.length > 300, `expected to scan the codebase, found only ${codeFiles.length} files`);
});

test('no application code queries the dead listing-summary table', () => {
  // Table ACCESS is what matters: .from('vehicle_listing_summaries'), a raw SQL statement naming
  // it, or an ORM model bound to it. A bare mention inside a longer identifier is handled below.
  const accessPatterns = [
    new RegExp(`\\.from\\(\\s*['"\`]${TABLE}['"\`]`),
    new RegExp(`\\b(?:from|into|update|join)\\s+(?:public\\.)?${TABLE}\\b`, 'i'),
    new RegExp(`\\brpc\\(\\s*['"\`][^'"\`]*${TABLE}`),
  ];

  const offenders = [];
  for (const file of codeFiles) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes(TABLE)) continue;
    for (const pattern of accessPatterns) {
      if (pattern.test(source)) {
        offenders.push(path.relative(REPO_ROOT, file));
        break;
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these files query ${TABLE}, which the drop migration assumes nothing does: ${offenders.join(', ')}`,
  );
});

/**
 * Every file allowed to name the dead table, and why. Pinned by exact set equality so a mention
 * in a NEW file fails here and gets read by a human, rather than passing the access-pattern scan
 * above because its particular shape happened not to match.
 */
const ALLOWED_MENTIONS = {
  // Holds the STRING 'vehicle_listing_summaries_refresh' in SUMMARY_FACTS — a trust-fact
  // permission label, not a relation. Dropping the table cannot break it.
  'backend/services/trustGovernance/trustPermissionService.js': /['"`]vehicle_listing_summaries_refresh['"`]/,
  // Read-only preflight that reports whether the drop would be permitted. It is authorised to
  // inspect the relation precisely so a refusal is discovered before a deploy, not during one.
  'backend/scripts/issue164-drop-listing-summaries-preflight.mjs': /READ-ONLY/,
};

test('every file that names the dead table is an allowed, non-application mention', () => {
  const mentions = codeFiles
    .filter(file => readFileSync(file, 'utf8').includes(TABLE))
    .map(file => path.relative(REPO_ROOT, file))
    .sort();

  assert.deepEqual(
    mentions,
    Object.keys(ALLOWED_MENTIONS).sort(),
    'a new mention of the dead table appeared; confirm it is not application table access before allowing it',
  );

  for (const [file, marker] of Object.entries(ALLOWED_MENTIONS)) {
    assert.match(
      readFileSync(path.join(REPO_ROOT, file), 'utf8'),
      marker,
      `${file} no longer matches the reason it was allowed to mention the table`,
    );
  }
});

test('the preflight only ever reads, and can never drop', () => {
  const preflight = readFileSync(
    path.join(REPO_ROOT, 'backend/scripts/issue164-drop-listing-summaries-preflight.mjs'), 'utf8');

  for (const forbidden of [/\bDROP\s+TABLE\b/i, /\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i, /\bALTER\s+TABLE\b/i]) {
    assert.ok(!forbidden.test(preflight), `the preflight must not contain ${forbidden}`);
  }
  // Positive identification of the target, not merely "not production".
  assert.match(preflight, /does not positively identify staging/,
    'an unrecognised database must be BLOCKED, never assumed safe');
});

// ---------------------------------------------------------------------------
// The migration must stay fail-closed. Each assertion below is a condition of the
// product-owner decision; relaxing any one of them turns a refusal into a deletion.
// ---------------------------------------------------------------------------

const migrationSrc = readFileSync(path.join(REPO_ROOT, 'database', 'migrations', MIGRATION), 'utf8');

/** Executable SQL only — the header explains WHY CASCADE is forbidden, and must not trip the check. */
const migrationSql = migrationSrc.replace(/^\s*--.*$/gm, '');

test('the drop never uses CASCADE', () => {
  assert.ok(!/CASCADE/i.test(migrationSql), 'CASCADE would silently remove an unanticipated dependent');
  assert.match(migrationSql, /DROP TABLE public\.vehicle_listing_summaries'/, 'the drop must be plain (RESTRICT)');
});

test('the migration refuses when the table holds any row', () => {
  assert.match(migrationSrc, /SELECT count\(\*\) FROM public\.vehicle_listing_summaries/,
    'the row check must COUNT, not read a planner estimate that can be stale');
  assert.match(migrationSrc, /v_rows <> 0[\s\S]{0,220}RAISE EXCEPTION/,
    'a non-zero row count must abort, because data is not this migration to discard');
});

test('the migration refuses on dependent views, inbound foreign keys or routines', () => {
  for (const [guard, marker] of [
    ['dependent views', /v_views IS NOT NULL[\s\S]{0,200}RAISE EXCEPTION/],
    ['inbound foreign keys', /v_inbound_fks IS NOT NULL[\s\S]{0,200}RAISE EXCEPTION/],
    ['routines', /v_functions IS NOT NULL[\s\S]{0,200}RAISE EXCEPTION/],
  ]) {
    assert.match(migrationSrc, marker, `the ${guard} guard must RAISE, not warn`);
  }
});

test('an absent table is a no-op rather than an error', () => {
  // A fresh database never had the table, and a re-run finds it gone; neither is a failure.
  assert.match(migrationSrc, /IF v_oid IS NULL THEN[\s\S]{0,200}RETURN;/,
    'the migration must be idempotent across fresh, applied and re-applied databases');
});

test('the migration proves the table is gone before reporting success', () => {
  assert.match(migrationSrc, /postcondition failed[\s\S]{0,80}still exists/,
    'a silent no-op must not be reported as a successful drop');
});

test('the down migration is deliberately non-executable', () => {
  const down = migrationSrc.slice(migrationSrc.indexOf('-- +migrate Down'));
  assert.ok(!/DROP\s+TABLE|CREATE\s+TABLE/i.test(down),
    'recreating the table would restore the competing listing contract this removes');
});
