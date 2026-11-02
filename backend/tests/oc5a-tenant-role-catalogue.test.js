/**
 * OC-5A P1-B — a tenant row is never platform authority.
 *
 * RC1 residual finding B: `resolveEffectiveRole` let a verified membership lend ANY of its role values
 * except 'admin' as the caller's effective role. A tenant row reading 'government', 'reviewer' or
 * 'finance' therefore admitted its holder to every route that lists that role — escrow release among
 * them. The rule is now the governed catalogue (backend/services/auth/tenantRoleCatalogue.js): a
 * membership lends only 'mechanic' or 'dealer'.
 *
 * Proven here:
 *   1. the full cross-product of platform role × tenant row × requested role, against an oracle that
 *      states the rule independently of the implementation;
 *   2. every role named in ANY backend route allow-list, derived from source (not hand-listed);
 *   3. through the real `authorizeRole` over HTTP, with forged role and tenant headers;
 *   4. `hasPlatformWideVehicleAuthority` reads the PLATFORM role;
 *   5. `optionalAuth` no longer turns an unverified x-tenant-id into context;
 *   6. the catalogue constraint on real PostgreSQL (PGlite): new rows refused, a pre-catalogue row left
 *      in place (NOT VALID) but lending nothing, idempotent, reversible.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ENV;
delete process.env.VERCEL_ENV;

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(here, '..');
const MIGRATION = path.resolve(BACKEND, '../database/migrations/20261004160000_oc5a_tenant_users_role_catalogue.sql');

const catalogue = await import('../services/auth/tenantRoleCatalogue.js');
const { resolveEffectiveRole, authorizeRole, authorizeSessionRole, optionalAuth } = await import('../middleware/authMiddleware.js');
const { hasPlatformWideVehicleAuthority } = await import('../middleware/vehicleObjectAuthority.js');
const { supabase } = await import('../db/supabase.js');
const { TENANT_ADMIN_ROLES } = await import('../services/diaspora/diasporaAuthorization.js');
const { BUSINESS_AUTHORITY_MEMBERSHIP_ROLES } = await import('../services/dealer/dealerListingAuthority.js');

const realFrom = supabase.from;
after(() => { supabase.from = realFrom; });

const PLATFORM_ROLES = ['owner', 'dealer', 'mechanic', 'insurance', 'government', 'bank', 'admin', 'member'];

/** Every role literal in any backend route allow-list, read from source. */
function allowListRoles() {
  const roles = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'tests') continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.js')) {
        const src = readFileSync(full, 'utf8');
        for (const m of src.matchAll(/authorize(?:Session)?Role\(\[([^\]]*)\]/g)) {
          for (const lit of m[1].matchAll(/'([a-z_]+)'/g)) roles.add(lit[1]);
        }
        for (const m of src.matchAll(/const [A-Z_]*ROLES\s*=\s*\[([^\]]*)\]/g)) {
          for (const lit of m[1].matchAll(/'([a-z_]+)'/g)) roles.add(lit[1]);
        }
      }
    }
  };
  walk(BACKEND);
  return [...roles].sort();
}

const ROUTE_ROLES = allowListRoles();
const TENANT_VALUES = [...new Set([...catalogue.TENANT_MEMBERSHIP_ROLES, ...catalogue.PROTECTED_PLATFORM_ROLES,
  ...catalogue.LEGACY_TENANT_ROLE_ALIASES, ...ROUTE_ROLES, 'buyer', 'Government', ' reviewer '])];

/** The rule, stated without the implementation: what the caller may act as. */
function oracle({ userRole, tenantRole, requestedRole }) {
  const n = (r) => (r == null ? null : String(r).toLowerCase() || null);
  const platform = n(userRole) || 'member';
  const requested = n(requestedRole);
  if (!requested) return platform;
  if (requested === platform) return platform;
  if (n(tenantRole) && requested === n(tenantRole) && (requested === 'mechanic' || requested === 'dealer')) return requested;
  return 'REFUSED';
}

test('the catalogue: lendable ⊂ membership, and lendable ∩ protected = ∅ (adding a protected role to the lendable set fails here by name)', () => {
  assert.deepEqual([...catalogue.TENANT_MEMBERSHIP_ROLES], ['admin', 'mechanic', 'dealer', 'member']);
  assert.deepEqual([...catalogue.LENDABLE_TENANT_ROLES], ['mechanic', 'dealer']);
  for (const role of catalogue.LENDABLE_TENANT_ROLES) {
    assert.ok(catalogue.TENANT_MEMBERSHIP_ROLES.includes(role), `${role} must be a catalogue membership value`);
    assert.ok(!catalogue.PROTECTED_PLATFORM_ROLES.includes(role), `${role} is lendable AND protected — contradiction`);
  }
  for (const role of ['admin', 'platform_admin', 'super_admin', 'government', 'reviewer', 'government_reviewer', 'finance', 'bank', 'insurance', 'compliance']) {
    assert.ok(catalogue.PROTECTED_PLATFORM_ROLES.includes(role), `${role} must be named protected`);
    assert.equal(catalogue.isLendableTenantRole(role), false, `${role} must never be lendable`);
  }
});

test('cross-product: platform role × tenant row × requested role — the implementation agrees with the oracle on every combination', () => {
  let combinations = 0;
  let refusals = 0;
  for (const userRole of PLATFORM_ROLES) {
    for (const tenantRole of [null, ...TENANT_VALUES]) {
      for (const requestedRole of [null, ...TENANT_VALUES]) {
        combinations += 1;
        const expected = oracle({ userRole, tenantRole, requestedRole });
        let actual;
        try {
          actual = resolveEffectiveRole({ userRole, tenantRole, requestedRole });
        } catch (error) {
          assert.equal(error.statusCode, 403, 'a refusal is a 403, never a 500');
          actual = 'REFUSED';
          refusals += 1;
        }
        assert.equal(actual, expected, `platform=${userRole} tenant=${tenantRole} requested=${requestedRole}`);
        // The invariant the moderator named, stated directly: a protected role is only ever the
        // caller's own PLATFORM role.
        if (actual !== 'REFUSED' && catalogue.PROTECTED_PLATFORM_ROLES.includes(actual)) {
          assert.equal(actual, userRole, `protected '${actual}' came from a tenant row`);
        }
      }
    }
  }
  assert.ok(combinations > 5000, `the product must be wide (was ${combinations})`);
  assert.ok(refusals > 0);
});

test('every role in every backend allow-list: a tenant row of that value lends it ONLY if it is mechanic or dealer (derived from source)', () => {
  assert.ok(ROUTE_ROLES.length >= 12, `allow-list scan found too few roles: ${ROUTE_ROLES}`);
  for (const role of ['reviewer', 'government_reviewer', 'finance', 'buyer', 'platform_admin', 'super_admin']) {
    assert.ok(ROUTE_ROLES.includes(role), `${role} is in a route allow-list today — the scan must see it`);
  }
  for (const role of ROUTE_ROLES) {
    const attempt = () => resolveEffectiveRole({ userRole: 'owner', tenantRole: role, requestedRole: role });
    if (role === 'owner') { assert.equal(attempt(), 'owner'); continue; }
    if (catalogue.isLendableTenantRole(role)) assert.equal(attempt(), role);
    else assert.throws(attempt, /not verified for this user context/, `a tenant row '${role}' must lend nothing`);
  }
});

test('tenant-scoped authority sets stay inside catalogue ∪ declared legacy aliases (no free-form value creeps in)', () => {
  const governed = new Set([...catalogue.TENANT_MEMBERSHIP_ROLES, ...catalogue.LEGACY_TENANT_ROLE_ALIASES]);
  for (const [name, set] of [['diaspora TENANT_ADMIN_ROLES', TENANT_ADMIN_ROLES], ['dealer BUSINESS_AUTHORITY_MEMBERSHIP_ROLES', BUSINESS_AUTHORITY_MEMBERSHIP_ROLES]]) {
    for (const role of set) assert.ok(governed.has(role), `${name} holds '${role}', outside the governed catalogue`);
  }
  for (const alias of catalogue.LEGACY_TENANT_ROLE_ALIASES) assert.equal(catalogue.isLendableTenantRole(alias), false);
});

test('hasPlatformWideVehicleAuthority reads the PLATFORM role — a requested or lent role never grants platform-wide reach', () => {
  assert.equal(hasPlatformWideVehicleAuthority({ role: 'government', platformRole: 'owner', tenantRole: 'government' }), false);
  assert.equal(hasPlatformWideVehicleAuthority({ role: 'admin', platformRole: 'dealer' }), false);
  assert.equal(hasPlatformWideVehicleAuthority({ role: 'super_admin', platformRole: 'mechanic' }), false);
  assert.equal(hasPlatformWideVehicleAuthority({ role: 'mechanic', platformRole: 'admin' }), true, 'an admin acting as mechanic keeps platform authority');
  assert.equal(hasPlatformWideVehicleAuthority({ role: 'owner', platformRole: 'government' }), true);
  // A context the middleware did not build (no platformRole) falls back to its single role.
  assert.equal(hasPlatformWideVehicleAuthority({ role: 'admin' }), true);
  assert.equal(hasPlatformWideVehicleAuthority({ role: 'owner' }), false);
});

// ── HTTP, through the real middleware ────────────────────────────────────────────────────────────

/** A minimal supabase-js stand-in for the three tables authentication reads. */
function stubAuthTables({ users = {}, memberships = [], failTenantRead = false } = {}) {
  supabase.from = (table) => {
    const filters = {};
    const chain = {
      select() { return chain; },
      eq(column, value) { filters[column] = value; return chain; },
      single() { return Promise.resolve(resolveOne()); },
      maybeSingle() { return Promise.resolve(resolveOne(true)); },
    };
    function resolveOne(maybe = false) {
      if (table === 'users') {
        const user = users[filters.id];
        return user ? { data: user, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      }
      if (table === 'tenant_users') {
        if (failTenantRead) return { data: null, error: { message: 'connection reset' } };
        const row = memberships.find((m) => m.tenant_id === filters.tenant_id && m.user_id === filters.user_id);
        if (row) return { data: { role: row.role }, error: null };
        return maybe ? { data: null, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      }
      return { data: null, error: { message: `unexpected table ${table}` } };
    }
    return chain;
  };
}

async function serve(app, fn) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

const appWith = (...handlers) => {
  const app = express();
  app.get('/probe', ...handlers, (req, res) => res.json({ ctx: req.userContext ?? null }));
  return app;
};

const USERS = {
  'u-owner': { role: 'owner', is_verified: true },
  'u-dealer': { role: 'dealer', is_verified: true },
};
const MEMBERSHIPS = [
  { tenant_id: 'tenant-gov', user_id: 'u-owner', role: 'government' },       // pre-catalogue hostile row
  { tenant_id: 'tenant-rev', user_id: 'u-owner', role: 'reviewer' },         // pre-catalogue hostile row
  { tenant_id: 'tenant-fin', user_id: 'u-owner', role: 'finance' },          // pre-catalogue hostile row
  { tenant_id: 'tenant-garage', user_id: 'u-owner', role: 'mechanic' },
  { tenant_id: 'tenant-dealer', user_id: 'u-owner', role: 'admin' },
];

test('HTTP: a tenant row reading government / reviewer / finance admits nobody to a route that lists that role', async () => {
  stubAuthTables({ users: USERS, memberships: MEMBERSHIPS });
  for (const [tenant, role, guard] of [
    ['tenant-gov', 'government', authorizeRole(['government'])],
    ['tenant-rev', 'reviewer', authorizeSessionRole(['admin', 'reviewer'])], // escrow release's exact guard shape
    ['tenant-rev', 'reviewer', authorizeRole(['admin', 'government', 'reviewer'])],
    ['tenant-fin', 'finance', authorizeRole(['admin', 'finance', 'bank'])],
    ['tenant-dealer', 'admin', authorizeRole(['admin'])],
  ]) {
    await serve(appWith(guard), async (base) => {
      const res = await fetch(`${base}/probe`, { headers: { 'x-user-id': 'u-owner', 'x-tenant-id': tenant, 'x-stakeholder-role': role } });
      const body = await res.json();
      assert.ok([401, 403].includes(res.status), `${role} via ${tenant} must be refused, got ${res.status} ${JSON.stringify(body)}`);
      assert.equal(body.ctx, undefined, 'no user context reached the handler');
    });
  }
});

test('HTTP: the governed lend still works — a verified mechanic membership acts as mechanic, and keeps its platform role', async () => {
  stubAuthTables({ users: USERS, memberships: MEMBERSHIPS });
  await serve(appWith(authorizeRole(['mechanic'])), async (base) => {
    const res = await fetch(`${base}/probe`, { headers: { 'x-user-id': 'u-owner', 'x-tenant-id': 'tenant-garage', 'x-stakeholder-role': 'mechanic' } });
    assert.equal(res.status, 200);
    const { ctx } = await res.json();
    assert.equal(ctx.role, 'mechanic');
    assert.equal(ctx.platformRole, 'owner', 'the lent role never replaces the platform role');
    assert.equal(ctx.tenantId, 'tenant-garage');
  });
});

test('HTTP: forged headers — a role with no membership, a tenant with no membership, a membership of another tenant', async () => {
  stubAuthTables({ users: USERS, memberships: MEMBERSHIPS });
  const cases = [
    { 'x-user-id': 'u-dealer', 'x-stakeholder-role': 'mechanic' },                                   // role, no tenant
    { 'x-user-id': 'u-dealer', 'x-tenant-id': 'tenant-garage', 'x-stakeholder-role': 'mechanic' },     // not a member
    { 'x-user-id': 'u-owner', 'x-tenant-id': 'tenant-gov', 'x-stakeholder-role': 'mechanic' },         // member, but not a mechanic THERE
    { 'x-user-id': 'u-owner', 'x-stakeholder-role': 'admin' },
  ];
  for (const headers of cases) {
    await serve(appWith(authorizeRole(['mechanic', 'admin'])), async (base) => {
      const res = await fetch(`${base}/probe`, { headers });
      assert.equal(res.status, 403, JSON.stringify(headers));
    });
  }
});

test('optionalAuth: an unverified x-tenant-id is never context; a verified one is; a failed lookup is no tenant', async () => {
  stubAuthTables({ users: USERS, memberships: MEMBERSHIPS });
  await serve(appWith(optionalAuth()), async (base) => {
    const forged = await (await fetch(`${base}/probe`, { headers: { 'x-user-id': 'u-dealer', 'x-tenant-id': 'tenant-garage' } })).json();
    assert.equal(forged.ctx.tenantId, null, 'a tenant the caller does not belong to is not context');
    assert.equal(forged.ctx.role, 'dealer');
    const verified = await (await fetch(`${base}/probe`, { headers: { 'x-user-id': 'u-owner', 'x-tenant-id': 'tenant-garage' } })).json();
    assert.equal(verified.ctx.tenantId, 'tenant-garage');
    assert.equal(verified.ctx.tenantRole, 'mechanic');
    assert.equal(verified.ctx.role, 'owner', 'optionalAuth never lends a role');
  });
  stubAuthTables({ users: USERS, memberships: MEMBERSHIPS, failTenantRead: true });
  await serve(appWith(optionalAuth()), async (base) => {
    const res = await fetch(`${base}/probe`, { headers: { 'x-user-id': 'u-owner', 'x-tenant-id': 'tenant-garage' } });
    assert.equal(res.status, 200, 'optional auth never fails a public request');
    assert.equal((await res.json()).ctx.tenantId, null);
  });
});

// ── the constraint, on real PostgreSQL ───────────────────────────────────────────────────────────

test('migration (PGlite): new rows outside the catalogue are refused; a pre-catalogue row survives (NOT VALID); idempotent; reversible', async () => {
  const { createEvidenceHistoryDatabase } = await import('./helpers/pgliteLedgerHarness.js');
  const db = await createEvidenceHistoryDatabase();
  try {
    const sql = readFileSync(MIGRATION, 'utf8');
    const [up, down] = sql.split(/^-- \+migrate Down/m);
    await db.query(`INSERT INTO users (id, name, email, role, join_date) VALUES ('oc5a-u1', 'U', 'oc5a-u1@example.invalid', 'owner', '2026-01-01')`);
    const { rows: [{ id: tenant }] } = await db.query(`INSERT INTO tenants (name, type) VALUES ('Garage', 'garage') RETURNING id`);
    const { rows: [{ id: other }] } = await db.query(`INSERT INTO tenants (name, type) VALUES ('Desk', 'government') RETURNING id`);
    // The production state the constraint must tolerate: a row written before it existed.
    await db.query(`INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, 'oc5a-u1', 'reviewer')`, [other]);

    await db.exec(up);
    await db.exec(up); // idempotent: the DO block finds the constraint by name
    const { rows: constraints } = await db.query(`SELECT conname, convalidated FROM pg_constraint WHERE conname = 'tenant_users_role_catalogue'`);
    assert.deepEqual(constraints.map((c) => ({ ...c })), [{ conname: 'tenant_users_role_catalogue', convalidated: false }]);

    for (const role of ['government', 'reviewer', 'super_admin', 'finance', 'owner', 'manager', 'Mechanic']) {
      await assert.rejects(
        db.query(`INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, 'oc5a-u1', $2)`, [tenant, role]),
        (error) => error.code === '23514', `${role} must be refused by the catalogue`);
    }
    await assert.rejects(db.query(`UPDATE tenant_users SET role = 'government' WHERE tenant_id = $1`, [other]),
      (error) => error.code === '23514', 'an UPDATE is checked too');
    await db.query(`INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, 'oc5a-u1', 'mechanic')`, [tenant]);
    const { rows: survivors } = await db.query(`SELECT role FROM tenant_users WHERE user_id = 'oc5a-u1' ORDER BY role`);
    assert.deepEqual(survivors.map((r) => r.role), ['mechanic', 'reviewer'], 'the pre-catalogue row is left in place, not rewritten');

    await db.exec(down);
    const { rows: gone } = await db.query(`SELECT 1 FROM pg_constraint WHERE conname = 'tenant_users_role_catalogue'`);
    assert.equal(gone.length, 0);
    await db.exec(up);
    const { rows: back } = await db.query(`SELECT 1 FROM pg_constraint WHERE conname = 'tenant_users_role_catalogue'`);
    assert.equal(back.length, 1);
  } finally {
    await db.close();
  }
});

test('migration: an environment that already carries #209\'s validated constraint keeps it untouched (same name, no second CHECK)', async () => {
  const { createEvidenceHistoryDatabase } = await import('./helpers/pgliteLedgerHarness.js');
  const db = await createEvidenceHistoryDatabase();
  try {
    await db.exec(`ALTER TABLE tenant_users ADD CONSTRAINT tenant_users_role_catalogue CHECK (role IN ('admin', 'mechanic', 'dealer', 'member'))`);
    const [up] = readFileSync(MIGRATION, 'utf8').split(/^-- \+migrate Down/m);
    await db.exec(up);
    const { rows } = await db.query(`SELECT convalidated FROM pg_constraint WHERE conrelid = 'tenant_users'::regclass AND contype = 'c'`);
    assert.deepEqual(rows.map((r) => r.convalidated), [true], 'exactly one catalogue CHECK, still the validated one');
  } finally {
    await db.close();
  }
});
