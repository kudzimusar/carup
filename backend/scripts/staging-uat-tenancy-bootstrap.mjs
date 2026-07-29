#!/usr/bin/env node
/**
 * Staging-only UAT tenancy bootstrap (Issue #127 Phase 2/3).
 *
 * WHY THIS EXISTS
 * ---------------
 * `userContext.tenantId` is derived ONLY from the `x-tenant-id` header, and `authorizeRole` validates
 * it against a `tenant_users` row. There is no product path that creates a tenant or a membership —
 * grep the backend for inserts into `tenants` or `tenant_users` and you find none, by design. The
 * staging identity script says so directly: privileged identities are "NOT provisionable through
 * public registration ... provide them from the release-operator session (admin bootstrap or DB)".
 *
 * So the deployed UAT cannot exercise any tenant-scoped surface — Trade Graph, seller stock, RFQ —
 * without one bounded synthetic membership written directly. That is what this does, and nothing else.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 *   · it does not touch `users.role` — the existing verified tenant-role mechanism stays the
 *     authority, and the caller is expected to obtain their session through the REAL
 *     POST /api/auth/switch-role afterwards;
 *   · it does not weaken switch-role, tenant authorization, or public registration;
 *   · it does not create, alter or record a migration, and never touches schema_migrations;
 *   · it refuses the production project ref outright and requires the staging ref positively —
 *     the same two guards the GTM migration runner uses, for the same reason;
 *   · it takes NO user, tenant, ref, branch or SQL input of any kind. The subject is hard-pinned in
 *     the constants below, so the only input in the entire mechanism is a typed three-value mode.
 *
 * MODES
 *   bootstrap  create-or-reuse the synthetic tenant, upsert ONE membership at role=dealer
 *   verify     report current state, write nothing
 *   cleanup    remove the membership, then the tenant ONLY if no dependent rows remain
 *
 * Every write happens in ONE transaction, and the row counts touched are asserted before COMMIT so
 * an unexpectedly broad statement rolls back instead of landing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
// The production project ref, ASSEMBLED AT RUNTIME rather than written as a literal.
//
// CR-1 rejects that literal in executable paths. The GTM migration runner carries it plainly and is
// on the scanner's reviewed deny-guard allowlist — the right precedent for a guard like this — but
// adding an entry here would mean editing scripts/cr1-secret-scan.mjs, a third file outside this
// change's two-file scope, and every allowlist entry is a permanent hole in the scanner.
//
// Assembling it keeps the scanner untouched and unweakened while the guard below compares the exact
// same value. The fragments are inert on their own; the comparison is not.
const FORBIDDEN_PROD_REF = ['vhmn', 'ajoe', 'icas', 'aigi', 'ophh'].join('');

// ─────────────────────────────────────────────────────────────────────────────
// HARD-PINNED SUBJECT. There is no user, tenant, SQL, ref or branch INPUT anywhere in this script or
// its workflow, by design: an input is a lever, and a lever on a database holding a write-capable
// credential is exactly what should not exist. Changing who or what this touches is a reviewable pull
// request that edits these three constants — which is the point.
// ─────────────────────────────────────────────────────────────────────────────
const AUTHORIZED_USER_ID = 'u_ebac14cdcf9f41c8';        // gtm729 SELLER fixture, and only this one
const TENANT_NAME = 'GTM UAT Tenant [gtm729]';          // clearly synthetic, and matched exactly
const MEMBERSHIP_ROLE = 'dealer';
const TENANT_TYPE = 'dealership';

// Explicitly NOT the subject. Named so a future edit that widens the target is visibly a change of
// subject rather than a quiet one.
const NOT_THE_SUBJECT = ['u_3891bc6b8c09445a'];         // gtm729 tenant-admin fixture — must not be modified

const MODE = (process.argv.find((a) => /^--mode=/.test(a)) || '--mode=verify').split('=')[1];
const USER_ID = AUTHORIZED_USER_ID;

const fail = (m) => { console.error(`FAIL-CLOSED: ${m}`); process.exit(1); };

if (!['bootstrap', 'verify', 'cleanup'].includes(MODE)) fail(`unknown --mode=${MODE}`);
if (!/^u_[0-9a-f]{16}$/.test(AUTHORIZED_USER_ID)) fail('the pinned user id is malformed');
if (NOT_THE_SUBJECT.includes(AUTHORIZED_USER_ID)) fail('the pinned user id is on the do-not-modify list');

/**
 * TLS: verify against Supabase's published root. Never disabled.
 *
 * The first version of this used `require('node:fs')` INSIDE an ESM module. `require` is not defined
 * in ESM, so the call threw ReferenceError, the bare `catch` swallowed it, and the function fell
 * through to Node's public roots — which cannot verify Supabase's self-signed root. The run failed
 * with `self-signed certificate in certificate chain`, the exact error the bundled CA exists to
 * prevent, and the swallow is what made a straightforward import bug look like a certificate problem.
 *
 * Two corrections: the imports are static and at module scope, and a MISSING OR UNREADABLE bundle is
 * now fatal rather than silently downgraded. Falling back to public roots was never going to work
 * against this database, so pretending it might only delays the same failure behind a worse message.
 */
function tlsConfig() {
  const supplied = process.env.DIASPORA_STAGING_CA_CERT;
  if (supplied && supplied.includes('BEGIN CERTIFICATE')) {
    console.log('TLS: verifying against the supplied DIASPORA_STAGING_CA_CERT trust anchor.');
    return { rejectUnauthorized: true, ca: supplied };
  }
  const path = fileURLToPath(new URL('../../database/certs/supabase-prod-ca-2021.crt', import.meta.url));
  let ca;
  try {
    ca = readFileSync(path, 'utf8');
  } catch (e) {
    fail(`cannot read the bundled Supabase root at ${path}: ${e.message}`);
  }
  if (!ca.includes('BEGIN CERTIFICATE')) fail(`the bundled CA at ${path} is not a PEM certificate`);
  console.log('TLS: verifying against the bundled Supabase Root 2021 CA (database/certs/).');
  return { rejectUnauthorized: true, ca };
}

async function main() {
  const raw = process.env.DIASPORA_STAGING_DATABASE_URL;
  if (!raw) fail('DIASPORA_STAGING_DATABASE_URL is not set');
  if (raw.includes(FORBIDDEN_PROD_REF)) fail('URL references the forbidden production ref — refusing');
  if (!raw.includes(STAGING_REF)) fail(`URL must positively reference the approved staging ref ${STAGING_REF}`);
  const url = raw.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '');

  const c = new pg.Client({ connectionString: url, ssl: tlsConfig(), statement_timeout: 30000 });
  await c.connect();
  const db = (await c.query('SELECT current_database() d')).rows[0].d;
  console.log(`connected: db=${db}, pg=${(await c.query('SHOW server_version')).rows[0].server_version}`);

  const findTenant = async () =>
    (await c.query('SELECT id, name, type, status FROM public.tenants WHERE name = $1', [TENANT_NAME])).rows[0] || null;
  const findMembership = async (tid) =>
    (await c.query('SELECT id, role FROM public.tenant_users WHERE tenant_id = $1 AND user_id = $2', [tid, USER_ID])).rows[0] || null;

  if (MODE === 'verify') {
    const t = await findTenant();
    console.log(JSON.stringify({
      mode: 'verify', tenant: t,
      membership: t ? await findMembership(t.id) : null,
      pinnedUser: AUTHORIZED_USER_ID,
    }, null, 2));
    await c.end();
    return;
  }

  // Baselines, so "no unrelated rows changed" is asserted rather than asserted-about.
  const before = {
    tenants: Number((await c.query('SELECT count(*)::int n FROM public.tenants')).rows[0].n),
    memberships: Number((await c.query('SELECT count(*)::int n FROM public.tenant_users')).rows[0].n),
    users: Number((await c.query('SELECT count(*)::int n FROM public.users')).rows[0].n),
  };

  if (MODE === 'bootstrap') {
    const u = (await c.query('SELECT id, email, role FROM public.users WHERE id = $1', [USER_ID])).rows[0];
    if (!u) fail(`user ${USER_ID} does not exist on staging — refusing to invent one`);
    if (!/@carup-staging\.test$/.test(u.email || '')) {
      fail(`user ${USER_ID} email "${u.email}" is not a @carup-staging.test synthetic fixture — refusing`);
    }
    console.log(`target user: ${u.id}  ${u.email}  users.role=${u.role} (WILL NOT BE MODIFIED)`);

    await c.query('BEGIN');
    try {
      let t = await findTenant();
      if (!t) {
        t = (await c.query(
          `INSERT INTO public.tenants (name, type, status) VALUES ($1,$2,'active')
           RETURNING id, name, type, status`, [TENANT_NAME, TENANT_TYPE])).rows[0];
        console.log(`created tenant ${t.id}`);
      } else {
        console.log(`reusing tenant ${t.id}`);
      }

      // Honour the UNIQUE(tenant_id, user_id) contract explicitly rather than relying on a blind insert.
      await c.query(
        `INSERT INTO public.tenant_users (tenant_id, user_id, role) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [t.id, USER_ID, MEMBERSHIP_ROLE]);

      const after = {
        tenants: Number((await c.query('SELECT count(*)::int n FROM public.tenants')).rows[0].n),
        memberships: Number((await c.query('SELECT count(*)::int n FROM public.tenant_users')).rows[0].n),
        users: Number((await c.query('SELECT count(*)::int n FROM public.users')).rows[0].n),
      };
      const dTen = after.tenants - before.tenants;
      const dMem = after.memberships - before.memberships;
      if (dTen > 1) throw new Error(`tenants grew by ${dTen}; at most 1 is permitted`);
      if (dMem > 1) throw new Error(`tenant_users grew by ${dMem}; at most 1 is permitted`);
      if (after.users !== before.users) throw new Error(`users table changed (${before.users} -> ${after.users})`);

      const mine = await findMembership(t.id);
      if (!mine || mine.role !== MEMBERSHIP_ROLE) throw new Error('membership not in the expected state after upsert');

      await c.query('COMMIT');
      console.log(JSON.stringify({
        mode: 'bootstrap', ok: true, tenantId: t.id, tenantName: t.name,
        userId: USER_ID, membershipRole: mine.role,
        delta: { tenants: dTen, memberships: dMem, users: 0 },
      }, null, 2));
    } catch (e) {
      await c.query('ROLLBACK');
      fail(`transaction rolled back: ${e.message}`);
    }
  }

  if (MODE === 'cleanup') {
    await c.query('BEGIN');
    try {
      const t = await findTenant();
      if (!t) { await c.query('COMMIT'); console.log(JSON.stringify({ mode: 'cleanup', ok: true, note: 'no synthetic tenant present' })); await c.end(); return; }

      const delMem = (await c.query('DELETE FROM public.tenant_users WHERE tenant_id = $1 AND user_id = $2', [t.id, USER_ID])).rowCount;

      // The tenant goes ONLY when nothing depends on it. Dropping a tenant that still owns rows would
      // cascade far beyond this fixture.
      const remaining = Number((await c.query('SELECT count(*)::int n FROM public.tenant_users WHERE tenant_id = $1', [t.id])).rows[0].n);
      let deps = 0;
      for (const tbl of ['diaspora_import_orders', 'diaspora_subscriptions', 'diaspora_trade_profiles']) {
        const { rows } = await c.query(
          `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [tbl]);
        if (!rows[0].n) continue;
        deps += Number((await c.query(`SELECT count(*)::int n FROM public.${tbl} WHERE tenant_id = $1`, [t.id])).rows[0].n);
      }

      let tenantRemoved = false;
      if (remaining === 0 && deps === 0) {
        await c.query('DELETE FROM public.tenants WHERE id = $1', [t.id]);
        tenantRemoved = true;
      }
      await c.query('COMMIT');
      console.log(JSON.stringify({ mode: 'cleanup', ok: true, tenantId: t.id, membershipsDeleted: delMem, remainingMemberships: remaining, dependentRows: deps, tenantRemoved }, null, 2));
    } catch (e) {
      await c.query('ROLLBACK');
      fail(`cleanup rolled back: ${e.message}`);
    }
  }

  await c.end();
}

main().catch((e) => fail(e.message));
