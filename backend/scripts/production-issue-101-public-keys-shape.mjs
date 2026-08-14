/**
 * ISSUE #101 — public_keys DEPENDENCY SHAPE PROBE (READ-ONLY, ONE RELATION).
 *
 * WHY. The staging-parity work must recreate the eleven #155 targets to production's
 * measured shape. One of production's ten foreign keys is
 *
 *     signature_verification_logs.public_key_id -> public.public_keys(id) ON DELETE CASCADE
 *
 * and public_keys does NOT exist on staging. Omitting that FK was rejected: staging must
 * preserve the production constraint. So the dependency has to be created too, and its
 * shape must be MEASURED rather than taken from history — the same rule that produced
 * this whole probe family.
 *
 * SCOPE IS EXACTLY ONE RELATION: public.public_keys.
 *
 * public_keys is a DEPENDENCY-ONLY parity object. It is NOT joining #155's fourteen-table
 * remediation target set, and this probe deliberately does not measure the other tables
 * that scripts/deploy-hardening-schema.js happens to create alongside it.
 *
 * REUSE, NOT REINVENTION. Every category is collected by the same
 * collectSchemaShape()/assertComplete() machinery proven for the eleven in run
 * 31770747669 — identity/owner, RLS and FORCE RLS, columns with full
 * type/domain/identity/generated/default detail, PK/UNIQUE/CHECK/EXCLUDE, foreign keys,
 * indexes with constraint-backing classification, policies, exact ACL with
 * grantor/grantee/privilege_type/is_grantable, owned sequence definitions, attached
 * triggers only, and custom type/domain dependencies. Passing a different target set is
 * the only difference.
 *
 * SAFETY, identical to the parent probe: no apply mode, no DDL/DML, BEGIN READ ONLY
 * asserted from the server, bounded statement_timeout, ROLLBACK in finally, no SET ROLE,
 * no function invocation, no application-row reads, no sequence-value reads, production
 * identity asserted and staging refused before connecting, secrets never printed.
 *
 * SECURITY NOTE ON THE OUTPUT. public_keys holds cryptographic key material and
 * historically a private_key_pem column. This probe reads CATALOG METADATA ONLY — column
 * NAMES and types, never column VALUES. No key, no row, no fragment of either is read or
 * emitted.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

import {
  REQUIRED_SECTIONS,
  ProbeError,
  assertProductionIdentity,
  assertComplete,
  collectSchemaShape,
  sanitizeError,
} from './production-issue-101-schema-shape.mjs';

const STATEMENT_TIMEOUT = '30s';

/** The ONLY relation this probe may inspect. */
export const DEPENDENCY_TABLES = ['public_keys'];

/** Re-exported so the workflow-pin test can assert the shared contract is reused. */
export { REQUIRED_SECTIONS, assertProductionIdentity, assertComplete, sanitizeError, ProbeError };

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

function tlsConfig() {
  const supplied = process.env.PRODUCTION_CA_CERT;
  if (supplied && supplied.includes('BEGIN CERTIFICATE')) {
    console.log('TLS: verifying against the supplied PRODUCTION_CA_CERT trust anchor.');
    return { rejectUnauthorized: true, ca: supplied };
  }
  try {
    const bundled = readFileSync(fileURLToPath(new URL('../../database/certs/supabase-prod-ca-2021.crt', import.meta.url)), 'utf8');
    if (bundled.includes('BEGIN CERTIFICATE')) {
      console.log('TLS: verifying against the bundled Supabase Root 2021 CA (database/certs/).');
      return { rejectUnauthorized: true, ca: bundled };
    }
  } catch { /* fall through */ }
  console.log('TLS: bundled anchor unavailable; verifying against system roots.');
  return { rejectUnauthorized: true };
}

function report(s) {
  const L = console.log;
  const t = s.TABLE_IDENTITY[0];
  L('');
  L('══ TABLE_IDENTITY ══');
  L(t.exists
    ? `   public_keys EXISTS kind=${t.relkind} owner=${t.owner} rls=${t.rls_enabled} forced=${t.rls_forced}`
    : '   public_keys ABSENT in production');
  L('');
  L('══ COLUMNS (names and types only — no value is ever read) ══');
  for (const c of s.COLUMNS) {
    L(`   ${String(c.ordinal_position).padStart(2)} ${c.column_name.padEnd(28)} ${c.udt_schema}.${c.udt_name.padEnd(14)} null=${c.is_nullable} default=${c.column_default ?? '-'} identity=${c.is_identity} generated=${c.is_generated}`);
  }
  L(`   count = ${s.COLUMNS.length}`);
  L('');
  L('══ CONSTRAINTS ══');
  for (const c of s.CONSTRAINTS) L(`   ${c.constraint_name} [${c.constraint_type}] backing_index=${c.backing_index ?? '-'} ${c.definition}`);
  L('');
  L('══ FOREIGN_KEYS ══');
  for (const f of s.FOREIGN_KEYS) L(`   ${f.constraint_name} -> ${f.referenced_schema}.${f.referenced_table}(${(f.referenced_columns || []).join(',')}) on_delete=${f.on_delete} on_update=${f.on_update}`);
  L(`   count = ${s.FOREIGN_KEYS.length}`);
  L('');
  L('══ INDEXES ══');
  for (const i of s.INDEXES) L(`   [${i.constraint_backed ? 'constraint-backed by ' + i.backing_for_constraint : 'independent'}] ${i.definition}`);
  L('');
  L('══ POLICIES ══');
  for (const p of s.POLICIES) L(`   ${p.policy} cmd=${p.command} roles=${(p.roles || []).join('|')} using=${p.using_expr ?? '-'}`);
  L(`   count = ${s.POLICIES.length}`);
  L('');
  L('══ RELATION_ACL (exact: grantor, grantee, privilege_type, is_grantable) ══');
  for (const a of s.RELATION_ACL) L(`   acl_default=${a.acl_is_default} ${JSON.stringify(a.acl)}`);
  L('');
  L('══ SEQUENCE_DEFINITIONS ══');
  for (const d of s.SEQUENCE_DEFINITIONS) {
    L(`   ${d.sequence_schema}.${d.sequence_name} owns ${d.owning_table}.${d.owning_column} type=${d.data_type} start=${d.seqstart} increment=${d.seqincrement} min=${d.seqmin} max=${d.seqmax} cache=${d.seqcache} cycle=${d.seqcycle}`);
  }
  L(`   count = ${s.SEQUENCE_DEFINITIONS.length}`);
  L('');
  L('══ TRIGGERS (attached to public_keys only) ══');
  for (const x of s.TRIGGERS) L(`   ${x.trigger_name} fn=${x.function_signature} enabled=${x.enabled}`);
  L(`   count = ${s.TRIGGERS.length}`);
  L('');
  L('══ CUSTOM_TYPE_DEPENDENCIES ══');
  for (const c of s.CUSTOM_TYPE_DEPENDENCIES) L(`   ${c.column_name} udt=${c.udt_schema}.${c.udt_name} domain=${c.domain_schema ?? '-'}.${c.domain_name ?? '-'}`);
  L(`   count = ${s.CUSTOM_TYPE_DEPENDENCIES.length}`);
  L('');
  L('══ TOTALS ══');
  for (const [k, v] of Object.entries(s.TOTALS)) L(`   ${k} = ${Array.isArray(v) ? JSON.stringify(v) : v}`);
}

async function main() {
  const url = process.env.PRODUCTION_DATABASE_URL;
  const prodRef = process.env.PRODUCTION_PROJECT_REF;
  const identity = assertProductionIdentity(url, prodRef);
  if (!identity.ok) fail(identity.reason);
  console.log('Production identity asserted (ref matched; staging ref refused). Credentials are never printed.');
  console.log('Scope: public_keys ONLY — a dependency-only parity object, not an Issue #101 remediation target.');

  const client = new pg.Client({ connectionString: url, ssl: tlsConfig(), application_name: 'issue-101-public-keys-shape' });
  await client.connect();
  console.log('Connected (mode=public-keys-shape, READ ONLY).');

  let s;
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    const { rows: ro } = await client.query('show transaction_read_only');
    if (ro[0]?.transaction_read_only !== 'on') throw new ProbeError('TRANSACTION_NOT_READ_ONLY');
    console.log(`Server confirms transaction_read_only=${ro[0].transaction_read_only}; statement_timeout=${STATEMENT_TIMEOUT}.`);
    s = await collectSchemaShape(client, DEPENDENCY_TABLES);
  } finally {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    await client.end();
  }

  const complete = assertComplete(s, DEPENDENCY_TABLES);
  if (!complete.ok) fail(`PUBLIC_KEYS SHAPE PROBE INCOMPLETE — ${complete.reason}`);

  report(s);
  console.log('');
  console.log('ISSUE_101_PUBLIC_KEYS_SHAPE_JSON_BEGIN');
  console.log(JSON.stringify(s, null, 2));
  console.log('ISSUE_101_PUBLIC_KEYS_SHAPE_JSON_END');
  console.log('');
  console.log('PUBLIC_KEYS SHAPE PROBE COMPLETE — nothing was written. Catalog metadata only; no application rows, no key material, and no function was invoked.');
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => fail(`public_keys shape probe failed (sanitized): ${sanitizeError(err)}`));
}
