/**
 * Entitlement queries must only name columns the real tables actually have (Issue #127).
 *
 * `resolvePlanEntitlements` filtered `.is('deleted_at', null)` on `diaspora_subscription_plans`, a
 * table that has no such column. PostgREST compiles that straight into SQL, Postgres raises 42703,
 * and the service's error branch was an empty `if` — so nothing threw, nothing logged, and every
 * catalog read silently fell through to the hardcoded config. The `source: 'db'` branch was dead
 * code in production while the service header documented the opposite.
 *
 * WHY THE MOCK COULD NOT CATCH IT
 * ------------------------------
 * `mockSupabase`'s `.is(col, null)` matches rows whose value is nullish, and a column absent from a
 * row object reads as `undefined`. So the mock returned the seeded plan exactly where PostgREST
 * returns a 400 — and the suite's own fixtures set `deleted_at: null` explicitly, giving the dead
 * branch a shape the real table can never produce.
 *
 * This test reads the MIGRATIONS rather than the mock. It is deliberately static: a column that does
 * not exist is a fact about the schema, and checking it needs no database and no fixtures, so it runs
 * on every commit instead of only when someone points the service at real Postgres.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../database/migrations/', import.meta.url));
const SERVICE = fileURLToPath(new URL('../services/diaspora/diasporaEntitlementService.js', import.meta.url));

const service = readFileSync(SERVICE, 'utf8');

/** Union of every column any migration gives a table: CREATE TABLE body plus later ADD COLUMNs. */
function columnsOf(table) {
  const cols = new Set();
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${MIGRATIONS_DIR}${file}`, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*--.*$/gm, '');

    const create = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?"?${table}"?\\s*\\(`, 'i');
    const m = create.exec(sql);
    if (m) {
      // Walk to the matching close paren so nested type/constraint parens do not end the body early.
      let depth = 0;
      let end = -1;
      for (let i = m.index + m[0].length - 1; i < sql.length; i += 1) {
        if (sql[i] === '(') depth += 1;
        else if (sql[i] === ')') { depth -= 1; if (depth === 0) { end = i; break; } }
      }
      const body = sql.slice(m.index + m[0].length, end);
      // Split on top-level commas only.
      let d = 0;
      let cur = '';
      const parts = [];
      for (const ch of body) {
        if (ch === '(') d += 1;
        else if (ch === ')') d -= 1;
        if (ch === ',' && d === 0) { parts.push(cur); cur = ''; } else cur += ch;
      }
      parts.push(cur);
      for (const p of parts) {
        const name = p.trim().split(/\s+/)[0]?.replace(/"/g, '');
        if (!name) continue;
        if (/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE|LIKE)$/i.test(name)) continue;
        cols.add(name.toLowerCase());
      }
    }

    const addRe = new RegExp(`ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:public\\.)?"?${table}"?[\\s\\S]*?ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?([a-z0-9_]+)"?`, 'gi');
    for (const a of sql.matchAll(addRe)) cols.add(a[1].toLowerCase());
  }
  return cols;
}

/** Column names the service filters on for a given `.from(TABLE)` chain. */
function filteredColumns(source, tableConst) {
  const start = source.indexOf(`.from(${tableConst})`);
  if (start === -1) return null;
  // The chain ends at the terminal call that executes it.
  const rest = source.slice(start);
  const end = rest.search(/\.(maybeSingle|single|then)\(/);
  const chain = end === -1 ? rest.slice(0, 600) : rest.slice(0, end);
  const cols = new Set();
  for (const m of chain.matchAll(/\.(?:eq|neq|is|gt|gte|lt|lte|in|like|ilike|contains)\(\s*'([a-z0-9_]+)'/g)) {
    cols.add(m[1].toLowerCase());
  }
  for (const m of chain.matchAll(/\.order\(\s*'([a-z0-9_]+)'/g)) cols.add(m[1].toLowerCase());
  return cols;
}

describe('entitlement catalog queries match the real schema', () => {
  test('the column extractor works on a table we know (positive control)', () => {
    const cols = columnsOf('diaspora_subscription_plans');
    assert.ok(cols.size > 0, 'no columns parsed — every assertion below would pass vacuously');
    for (const known of ['plan_key', 'entitlements', 'is_active', 'tier']) {
      assert.ok(cols.has(known), `extractor missed the known column ${known}; parsed: ${[...cols].join(', ')}`);
    }
  });

  test('diaspora_subscription_plans genuinely has NO deleted_at column', () => {
    // The premise of this whole file. If a migration ever adds it, this fails and the guard below
    // should be revisited rather than silently kept.
    const cols = columnsOf('diaspora_subscription_plans');
    assert.equal(
      cols.has('deleted_at'),
      false,
      'diaspora_subscription_plans now HAS deleted_at — update resolvePlanEntitlements and this test together',
    );
  });

  test('resolvePlanEntitlements filters only on columns that exist', () => {
    const filtered = filteredColumns(service, 'PLANS_TABLE');
    assert.notEqual(filtered, null, 'could not find the .from(PLANS_TABLE) chain — was the constant renamed?');
    assert.ok(filtered.size > 0, 'no filters parsed from the chain — the check would pass vacuously');

    const cols = columnsOf('diaspora_subscription_plans');
    for (const c of filtered) {
      assert.ok(
        cols.has(c),
        `resolvePlanEntitlements filters on "${c}", which diaspora_subscription_plans does not have. ` +
          'PostgREST turns that into a 42703 and the service swallows it, so every catalog read ' +
          `silently falls back to config. Real columns: ${[...cols].sort().join(', ')}`,
      );
    }
  });

  test('a genuine catalog fault is logged rather than silently swallowed', () => {
    // Falling back to config on a DB fault is correct — a catalog outage must not deny a paying
    // tenant their plan. Doing it invisibly is what let a permanent 42703 run unnoticed.
    const start = service.indexOf('async function resolvePlanEntitlements');
    const body = service.slice(start, start + 2000);
    assert.match(
      body,
      /console\.(warn|error)/,
      'the catalog-read error path emits nothing; a permanent failure would be invisible again',
    );
    assert.match(body, /PGRST116/, 'the "no rows" case should still be treated as ordinary, not logged as a fault');
  });
});
