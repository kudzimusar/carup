/**
 * OC-5E GMO-0 — who may create, change or end a garage membership.
 *
 * Until OC-5E this lineage had NO product writer of `tenant_users`: memberships only ever came from
 * seed data and staging fixtures. GMO adds exactly four, each one database function behind one
 * service, each re-checking its own authority under a lock:
 *
 *   activate_garage_application   the founding admin of an approved application        (GMO-4)
 *   accept_garage_invitation      the invited, verified person, into an active garage  (GMO-6)
 *   remove_garage_member          an admin removing someone, never the last admin      (GMO-7)
 *   change_garage_member_role     an admin re-roling someone, never the last admin     (GMO-7)
 *
 * A membership confers authority (the active-tenant verifier reads it on every request), so a new
 * writer anywhere else — a service that inserts a row, a migration that grants one — is a new way
 * to mint operators. This enumerates every write and fails on one nobody listed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = fileURLToPath(new URL('..', import.meta.url));
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const MIGRATIONS = join(REPO, 'database/migrations');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'tests') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(m?js)$/.test(entry)) out.push(full);
  }
  return out;
}

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const stripSqlComments = (sql) => sql.replace(/--.*$/gm, '');

test('GMO-0: no backend code writes a membership directly — every write is one of the four functions', () => {
  const writers = [];
  for (const file of walk(BACKEND)) {
    const text = stripComments(readFileSync(file, 'utf8'));
    // A supabase chain, OR raw SQL inside JS (scripts that talk to PostgreSQL directly).
    const chain = /from\(\s*'tenant_users'\s*\)[\s\S]{0,160}?\.(insert|update|upsert|delete)\(/.test(text);
    const rawSql = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(public\.)?tenant_users\b/i.test(text);
    if (chain || rawSql) writers.push(relative(REPO, file));
  }
  assert.deepEqual(writers.sort(), [
    // Staging UAT tooling that seeds a dealership fixture — not product code, never mounted.
    'backend/scripts/staging-uat-tenancy-bootstrap.mjs',
  ], 'a membership written outside the four GMO functions is a new way to mint operators');
});

test('GMO-0: in the schema, exactly the seed and the four GMO functions write memberships', () => {
  const writers = [];
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
    const up = stripSqlComments(readFileSync(join(MIGRATIONS, file), 'utf8').split('-- +migrate Down')[0]);
    if (/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(public\.)?tenant_users\b/i.test(up)) writers.push(file);
  }
  assert.deepEqual(writers.sort(), [
    '002_multi_tenant_and_auth_schema.sql', // the original seed: an admin of a dealership — no garage authority
    '20261004190100_gmo4_garage_business_activation.sql',
    '20261004190200_gmo6_garage_invitations.sql',
    '20261004190300_gmo7_garage_membership_guard.sql',
  ]);
});

test('GMO-0: each membership function is called by its own service and nowhere else', () => {
  const OWNERS = {
    activate_garage_application: 'backend/services/garageOnboarding/garageActivationService.js',
    accept_garage_invitation: 'backend/services/garageOnboarding/garageInvitationService.js',
    remove_garage_member: 'backend/services/garageOnboarding/garageMembershipService.js',
    change_garage_member_role: 'backend/services/garageOnboarding/garageMembershipService.js',
  };
  const callers = Object.fromEntries(Object.keys(OWNERS).map((fn) => [fn, []]));
  for (const file of walk(BACKEND)) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const fn of Object.keys(OWNERS)) {
      if (new RegExp(`rpc\\(\\s*'${fn}'`).test(text)) callers[fn].push(relative(REPO, file));
    }
  }
  for (const [fn, owner] of Object.entries(OWNERS)) {
    assert.deepEqual(callers[fn], [owner], `${fn} must be called only by ${owner}`);
  }
});
