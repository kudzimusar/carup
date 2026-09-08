#!/usr/bin/env node
/**
 * The one-time staging-UAT bootstrap.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Every shard used to rotate all 11 synthetic identities itself: three pg connections, three
 * transactions, 33 identity writes and 3 scrypt derivations per aggregate run — duplicated
 * infrastructure work that added no product coverage. Worse, it made a database connection a
 * PRECONDITION of every shard, so when the shared staging pooler saturated, all three shards died
 * with ECHECKOUTTIMEOUT before running a single test.
 *
 * Now the identities are set ONCE, here, from a protected staging-only secret. Each shard derives
 * the same value from that same secret and makes no database connection at all. Nothing is
 * transmitted between jobs.
 *
 * ── What it refuses ────────────────────────────────────────────────────────
 * Each refusal is NAMED, because a refusal nobody can distinguish is not a gate:
 *   missing-password · missing-database-url · unparseable-database-url · wrong-staging-project ·
 *   non-staging-identity · missing-staging-identity
 *
 * ── Staging identity is PROVED, not assumed ────────────────────────────────
 * The old check was `dbUrl.includes(expectedRef)` — which passes if the ref happens to occur in the
 * PASSWORD of a completely different database. This parses the URL and requires the ref to name the
 * connection's role or host, and then requires at the database itself that all 11 rows exist and
 * that every touched email is `@carup-staging.test`. A production database has none of them, so the
 * transaction cannot commit against one.
 */
import crypto from 'node:crypto';
import pg from 'pg';
import { pathToFileURL } from 'node:url';

/** The five original UAT identities, plus the ones the additive Trade OS specs need. */
export const STAGING_UAT_IDENTITIES = [
  ['uat.buyer@carup-staging.test', 'owner'],
  ['uat.seller@carup-staging.test', 'dealer'],
  ['uat.reviewer@carup-staging.test', 'admin'],
  ['uat.tenant-admin@carup-staging.test', 'admin'],
  ['uat.outsider@carup-staging.test', 'owner'],
  ['tradeos.operator@carup-staging.test', 'owner'],
  ['tradeos.outsider@carup-staging.test', 'owner'],
  ['tradeos.participant.a@carup-staging.test', 'owner'],
  ['tradeos.participant.b@carup-staging.test', 'owner'],
  ['tradeos.rfq-buyer@carup-staging.test', 'owner'],
  ['tradeos.rfq-supplier@carup-staging.test', 'dealer'],
];

/** The env var each identity's password is exported as, in the same order. */
export const STAGING_UAT_PASSWORD_ENV_NAMES = [
  'STAGING_UAT_BUYER_PASSWORD',
  'STAGING_UAT_SELLER_PASSWORD',
  'STAGING_UAT_REVIEWER_PASSWORD',
  'STAGING_UAT_TENANT_ADMIN_PASSWORD',
  'STAGING_UAT_OUTSIDER_PASSWORD',
  'TRADEOS_UAT_OPERATOR_PASSWORD',
  'TRADEOS_UAT_OUTSIDER_PASSWORD',
  'TRADEOS_UAT_PARTICIPANT_A_PASSWORD',
  'TRADEOS_UAT_PARTICIPANT_B_PASSWORD',
  'TRADEOS_RFQ_BUYER_PASSWORD',
  'TRADEOS_RFQ_SUPPLIER_PASSWORD',
];

export class BootstrapRefusal extends Error {
  constructor(reason, detail) {
    super(`${reason}: ${detail}`);
    this.reason = reason;
  }
}

/**
 * Prove the connection names the approved staging project.
 *
 * A substring test over the whole URL is not proof — the ref could appear anywhere, including in a
 * password. The ref must name the ROLE (Supabase's pooler role is `postgres.<ref>`) or the HOST
 * (`db.<ref>.supabase.co`).
 */
export function assertApprovedStagingConnection(rawUrl, expectedRef) {
  if (!rawUrl) throw new BootstrapRefusal('missing-database-url', 'DIASPORA_STAGING_DATABASE_URL is not configured');
  if (!expectedRef) throw new BootstrapRefusal('wrong-staging-project', 'EXPECTED_STAGING_PROJECT_REF is not configured');
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BootstrapRefusal('unparseable-database-url', 'the staging database URL is not a URL');
  }
  const role = decodeURIComponent(parsed.username || '');
  const host = parsed.hostname || '';
  const roleNamesRef = role === expectedRef || role.split('.').includes(expectedRef);
  const hostNamesRef = host.split('.').includes(expectedRef);
  if (!roleNamesRef && !hostNamesRef) {
    // Never echo the URL: it carries a password.
    throw new BootstrapRefusal(
      'wrong-staging-project',
      `neither the role nor the host names the approved project ${expectedRef} (host=${host})`,
    );
  }
  return { role, host };
}

/** Every identity this bootstrap will write must be a staging-only address. */
export function assertStagingOnlyIdentities(identities) {
  for (const [email] of identities) {
    if (!/@carup-staging\.test$/.test(email)) {
      throw new BootstrapRefusal('non-staging-identity', `refusing to write a non-staging identity: ${email}`);
    }
  }
  return true;
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key)));
  });
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

/**
 * Strip any sslmode query param: it would override the explicit ssl config below and make pg verify
 * Supabase's self-signed chain, failing the connection from CI runners.
 */
export function cleanConnectionString(rawUrl) {
  return rawUrl.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '');
}

async function connectWithRetry(connectionString, attempts = 6) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      // Release on EVERY path — a failed connect that skips end() leaks the very resource that is
      // exhausted, which is precisely how the saturation incident compounded itself.
      await client.end().catch(() => {});
      const transient = /ECHECKOUTTIMEOUT|ETIMEDOUT|ECONNRESET|Connection terminated|too many clients/i
        .test(String(error && error.message));
      if (!transient || attempt === attempts) throw error;
      const waitMs = Math.min(2000 * 2 ** (attempt - 1), 30000);
      console.log(`staging pooler busy (attempt ${attempt}/${attempts}); retrying in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

export async function bootstrapIdentities({ databaseUrl, expectedRef, password, identities = STAGING_UAT_IDENTITIES, connect = connectWithRetry }) {
  if (!password) throw new BootstrapRefusal('missing-password', 'STAGING_UAT_PASSWORD is not configured');
  const connection = assertApprovedStagingConnection(databaseUrl, expectedRef);
  assertStagingOnlyIdentities(identities);

  const passwordHash = await hashPassword(password);
  const client = await connect(cleanConnectionString(databaseUrl));
  try {
    await client.query('BEGIN');
    for (const [email, role] of identities) {
      const result = await client.query(
        'update public.users set password_hash = $1, role = $2 where email = $3 returning id',
        [passwordHash, role, email],
      );
      // All-or-nothing. A production database holds none of these rows, so it cannot commit.
      if (result.rowCount !== 1) {
        throw new BootstrapRefusal('missing-staging-identity', `expected exactly 1 row for ${email}, got ${result.rowCount}`);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
  return { identities: identities.length, connection, printed: false };
}

// `file://${argv[1]}` is NOT equivalent to import.meta.url: the latter is percent-encoded, so any
// path containing a space silently made this false — the script would load, run nothing and exit 0.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    const result = await bootstrapIdentities({
      databaseUrl: process.env.DIASPORA_STAGING_DATABASE_URL || '',
      expectedRef: process.env.EXPECTED_STAGING_PROJECT_REF || '',
      password: process.env.STAGING_UAT_PASSWORD || '',
    });
    console.log(
      `${result.identities} staging-only UAT identities were provisioned once for this aggregate run, ` +
      `role-verified, without printing credentials (host=${result.connection.host}).`,
    );
  } catch (error) {
    console.error(`::error::staging-uat bootstrap refused — ${error.reason || 'error'}: ${error.message}`);
    process.exit(1);
  }
}
