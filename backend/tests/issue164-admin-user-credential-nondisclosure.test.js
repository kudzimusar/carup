/**
 * Issue #164 — the admin user-management API must never disclose credential columns.
 *
 * Discovered during Phase 6 staging certification: GET /api/users/management (and three sibling
 * admin routes) did `.from('users').select('*')` and returned the raw rows, so an authenticated
 * admin received `password_hash` for every user. Role authorization was correct; the projection
 * was the defect. These routes are now pinned to an explicit allow-list that names only the
 * base-schema public user shape, so any credential/secret column added to `users` later stays
 * excluded by construction.
 *
 * This is a source-text guard: it reads adminRoutes.js and proves no user-returning handler uses a
 * `*` (or empty) projection, and that the allow-list names none of the known credential columns.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'routes', 'adminRoutes.js'),
  'utf8',
);

// Columns that must never reach a client through the admin user API.
const FORBIDDEN_COLUMNS = [
  'password_hash', 'password_reset_token', 'password_reset_expires',
  'reset_token', 'mfa_secret', 'totp_secret', 'recovery_codes', 'refresh_token',
];

test('the admin user allow-list exists and names no credential column', () => {
  const m = SRC.match(/const ADMIN_USER_COLUMNS\s*=\s*\n?\s*'([^']+)'/);
  assert.ok(m, 'ADMIN_USER_COLUMNS allow-list must be defined');
  const cols = m[1].split(',').map((c) => c.trim());
  assert.ok(cols.length >= 5, `allow-list looks too small: ${cols.join(', ')}`);
  for (const forbidden of FORBIDDEN_COLUMNS) {
    assert.ok(!cols.includes(forbidden), `allow-list must not include ${forbidden}`);
  }
  // The columns the frontend User console needs are present.
  for (const needed of ['id', 'email', 'role']) {
    assert.ok(cols.includes(needed), `allow-list must include ${needed}`);
  }
});

test('no user-returning admin handler uses a wildcard projection', () => {
  // Every `.from('users')` that is not a head/count must select the allow-list, never '*' or ().
  const lines = SRC.split('\n');
  const offenders = [];
  lines.forEach((line, i) => {
    if (!/\.from\('users'\)/.test(line)) return;
    // Look at this line plus the next few for the projection.
    const block = lines.slice(i, i + 4).join('\n');
    if (/count:\s*'exact'|head:\s*true/.test(block)) return; // count query returns no rows
    const projected = /\.select\(\s*ADMIN_USER_COLUMNS\s*\)/.test(block);
    const wildcard = /\.select\(\s*'\*'\s*\)|\.select\(\s*\)/.test(block);
    if (wildcard || !projected) {
      offenders.push(`line ${i + 1}: ${line.trim()}`);
    }
  });
  assert.deepEqual(
    offenders, [],
    `these users queries do not use the credential-safe allow-list:\n  ${offenders.join('\n  ')}`,
  );
});

test('the credential-disclosure rationale is documented so a future edit re-reads it', () => {
  assert.match(SRC, /password_hash/, 'the fix must name the column it excludes so the intent survives edits');
  assert.match(SRC, /allow-list|credential/i);
});
