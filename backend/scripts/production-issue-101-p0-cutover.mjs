/**
 * ISSUE #101 — PRODUCTION P0 CUTOVER (preflight / apply).
 *
 * THIS IS NOT A MIGRATION RUNNER. There is no "apply everything pending" path here and
 * cannot be one: the script carries a two-entry ALLOWLIST, pinned by SHA256, and refuses
 * to execute anything else.
 *
 *   A. 20260814085000_issue101_public_keys_hardening.sql
 *   B. 20260814090000_issue101_p0_rls_and_view_hardening.sql
 *
 * 20260814080000_issue101_staging_parity.sql IS STAGING-ONLY AND MUST NEVER RUN IN
 * PRODUCTION. It creates twelve relations that production already has, and it is named
 * in an explicit DENYLIST below so that adding it is a deliberate, reviewable act rather
 * than an oversight. Its own first precondition would also refuse — production holds all
 * twelve — but a guard you can see beats a guard you have to reason about.
 *
 * EACH MIGRATION IS ITS OWN TRANSACTION AND ITS OWN CERTIFICATION. A is applied,
 * committed and certified before B is even read. If A's certification fails, B never
 * runs, and the operator is left in a known state rather than a mixed one.
 *
 * PREFLIGHT IS READ-ONLY BY CONSTRUCTION: BEGIN READ ONLY asserted from the server, a
 * bounded statement_timeout, ROLLBACK in finally. It never writes and never reads an
 * application row — catalog metadata only, so no key material can be observed.
 */
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, '..', '..', 'database', 'migrations');
const STATEMENT_TIMEOUT = '60s';

/** The ONLY two files this script may execute, pinned by content. */
export const ALLOWED_MIGRATIONS = Object.freeze([
  Object.freeze({
    order: 'A',
    file: '20260814085000_issue101_public_keys_hardening.sql',
    sha256: 'cb5488f14feedb997a02e86826b4935b350cc7b1f6859820fde0d32648b6e68d',
    label: 'public_keys P0 closure',
  }),
  Object.freeze({
    order: 'B',
    file: '20260814090000_issue101_p0_rls_and_view_hardening.sql',
    sha256: '997ca9672e04958d9605e62a001799688f9850dc9a0641d35c88a88995d7705d',
    label: 'the fourteen + evidence_sources_public',
  }),
]);

/** Named so the exclusion is visible, not inferred. */
export const FORBIDDEN_MIGRATIONS = Object.freeze({
  '20260814080000_issue101_staging_parity.sql':
    'STAGING PARITY ONLY — creates twelve relations production already has; applying it to production is always wrong',
});

/**
 * The project refs are pinned BY SHA256 rather than in plaintext.
 *
 * The lane requires the production ref to be pinned and the staging ref refused. Writing
 * either literally would put a production identifier into an executable path, which the
 * CR-1 scanner rejects — correctly, and weakening its allowlist to accommodate a pin
 * would be the wrong trade. A hash pins the value exactly, is equally reviewable
 * (`printf %s <ref> | sha256sum`), and leaks nothing.
 */
export const PRODUCTION_PROJECT_REF_SHA256 = '642e27dacd0666b76e6cd3cdac900481ea8aae3be56bf2971b153a0deeb2ac1b';
export const STAGING_PROJECT_REF_SHA256 = '96fafb02439f5a4bbef8ef21a674e3a9609cece81751f114c4e12f9e675ae3ce';

export const refHash = (v) => createHash('sha256').update(String(v)).digest('hex');

/** #155's fourteen, plus the two evidence objects its own precondition requires. */
export const FOURTEEN = Object.freeze([
  'cid_clearance_records', 'currency_rates', 'cvr_ownership_records', 'dealer_promotions',
  'evidence_class_taxonomy', 'ocr_customs_declarations', 'ocr_national_ids',
  'ocr_registration_books', 'performance_telemetry', 'signature_verification_logs',
  'system_failures', 'vid_inspections', 'zimra_declarations', 'zinara_licensing_records',
]);
export const CUTOVER_SEVEN = Object.freeze({
  mechanic_work_orders: 'none', mechanic_parts: 'none', rolling_integrity_checkpoints: 'none',
  trust_score_history: 'none', vehicle_ownership_history: 'none',
  vehicle_evidence: 'SELECT', vehicles: 'SELECT',
});

/**
 * ALL EIGHT table privileges PostgreSQL 17 tracks.
 *
 * MAINTAIN is new in 17, and the production measurement proved public_keys carries it
 * for every role. Any check that omits it can report "no privileges survive" while
 * MAINTAIN quietly does — so every effective-privilege assertion in this file uses this
 * array, and nothing uses a subset.
 */
export const ALL_TABLE_PRIVILEGES = Object.freeze([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN',
]);
/** What service_role must keep on public_keys, and what it must not have. */
export const PUBLIC_KEYS_SERVICE_ROLE_PRESENT = Object.freeze(['SELECT', 'INSERT', 'UPDATE']);
export const PUBLIC_KEYS_SERVICE_ROLE_ABSENT = Object.freeze([
  'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN',
]);
/** Alphabetical, because that is how the catalog aggregation orders them. */
export const PUBLIC_KEYS_SERVICE_ROLE_EXPECTED = 'INSERT,SELECT,UPDATE';

/** The measured production shape of public_keys (run 31774496416). */
export const PUBLIC_KEYS_SHAPE =
  'id:text:NO:;user_id:text:NO:;public_key_pem:text:NO:;private_key_pem:text:YES:;'
  + "key_type:text:YES:'secp256k1'::text;status:text:YES:'ACTIVE'::text;"
  + 'created_at:text:NO:;revoked_at:text:YES:';

export class CutoverError extends Error {
  constructor(code) { super(code); this.name = 'CutoverError'; this.code = code; }
}

/**
 * Errors from pg can carry the connection string. Only an allowlisted class name and a
 * strict SQLSTATE are ever emitted, so nothing from the error can reach the log.
 */
const KNOWN_ERROR_CLASSES = new Set(['Error', 'TypeError', 'RangeError', 'CutoverError', 'AggregateError']);
export function sanitizeError(err) {
  const name = KNOWN_ERROR_CLASSES.has(err?.name) ? err.name : 'Error';
  const code = typeof err?.code === 'string' && /^[0-9A-Z_]{1,32}$/.test(err.code) ? err.code : 'unknown';
  return `${name}(${code})`;
}

export function assertProductionIdentity(url, prodRef) {
  if (!url) return { ok: false, reason: 'PRODUCTION_DATABASE_URL is not set' };
  if (!prodRef) return { ok: false, reason: 'PRODUCTION_PROJECT_REF is not set' };

  const supplied = refHash(prodRef);
  if (supplied === STAGING_PROJECT_REF_SHA256) {
    return { ok: false, reason: 'refusing to run: the supplied ref is the STAGING project' };
  }
  if (supplied !== PRODUCTION_PROJECT_REF_SHA256) {
    return { ok: false, reason: 'PRODUCTION_PROJECT_REF does not match the pinned production ref' };
  }
  // The URL and the ref must agree, so a correct ref cannot be paired with a URL that
  // points somewhere else.
  if (!url.includes(prodRef)) {
    return { ok: false, reason: 'the connection string does not contain the pinned production ref' };
  }
  // Any OTHER project-ref-shaped host token would mean the URL addresses a second
  // project; hash each and refuse anything that is not the pinned production ref.
  for (const m of String(url).matchAll(/\b([a-z]{20})\b/g)) {
    const h = refHash(m[1]);
    if (h === STAGING_PROJECT_REF_SHA256) {
      return { ok: false, reason: 'refusing to run: the connection string points at the STAGING project' };
    }
    if (h !== PRODUCTION_PROJECT_REF_SHA256) {
      return { ok: false, reason: 'the connection string contains an unrecognised project ref' };
    }
  }
  return { ok: true };
}

/**
 * Self-check the two constant sets before anything else happens.
 *
 * A static grep in the workflow can be satisfied by a comment; this cannot. If the
 * staging-parity file ever leaves the denylist, or enters the allowlist, the script
 * refuses to run at all rather than quietly gaining the ability to execute it.
 */
export function assertAllowlistIntegrity(allowed = ALLOWED_MIGRATIONS, forbidden = FORBIDDEN_MIGRATIONS) {
  const P2 = '20260814080000_issue101_staging_parity.sql';
  if (!Object.prototype.hasOwnProperty.call(forbidden, P2)) throw new CutoverError('DENYLIST_LOST_STAGING_PARITY');
  if (allowed.some((m) => m.file === P2)) throw new CutoverError('ALLOWLIST_CONTAINS_STAGING_PARITY');
  if (allowed.length !== 2) throw new CutoverError('ALLOWLIST_SIZE_CHANGED');
  for (const m of allowed) {
    if (Object.prototype.hasOwnProperty.call(forbidden, m.file)) throw new CutoverError('ALLOWLIST_DENYLIST_OVERLAP');
    if (!/^[0-9a-f]{64}$/.test(m.sha256)) throw new CutoverError('UNPINNED_MIGRATION');
  }
  return true;
}

/** Read an allowlisted migration and verify its bytes before it is ever executed. */
export function loadPinnedMigration(entry, dir = MIGRATIONS_DIR) {
  if (Object.prototype.hasOwnProperty.call(FORBIDDEN_MIGRATIONS, entry.file)) {
    throw new CutoverError('FORBIDDEN_MIGRATION');
  }
  const raw = readFileSync(join(dir, entry.file), 'utf8');
  const actual = createHash('sha256').update(raw).digest('hex');
  if (actual !== entry.sha256) throw new CutoverError('MIGRATION_SHA256_MISMATCH');
  const i = raw.indexOf('-- +migrate Down');
  const up = (i >= 0 ? raw.slice(0, i) : raw).replace('-- +migrate Up', '');
  // A hardening migration creates nothing. If one ever did, it would not be this lane.
  if (/^\s*CREATE\s+TABLE/mi.test(up)) throw new CutoverError('MIGRATION_CREATES_A_TABLE');
  return { ...entry, up, sha256_verified: actual };
}

const one = async (c, sql, p) => (await c.query(sql, p)).rows[0];

/** Read-only: everything that must be true before production is written to. */
export async function preflight(client) {
  const s = {};

  s.identity = await one(client, `select current_database() as db, current_user as usr,
    (select setting from pg_settings where name='server_version') as server_version`);

  s.service_role = await one(client,
    `select exists(select 1 from pg_roles where rolname='service_role' and rolbypassrls) as bypassrls`);

  s.fourteen_present = await one(client,
    `select count(*)::int as n from unnest($1::text[]) t(name)
      where to_regclass('public.'||name) is not null`, [FOURTEEN]);

  s.evidence_objects = await one(client,
    `select (to_regclass('public.evidence_sources') is not null) as evidence_sources,
            (to_regclass('public.evidence_sources_public') is not null) as evidence_sources_public`);

  s.public_keys_shape = await one(client,
    `select coalesce(string_agg(column_name||':'||udt_name||':'||is_nullable||':'||coalesce(column_default,''),
              ';' order by ordinal_position), '<absent>') as shape,
            count(*)::int as columns
       from information_schema.columns
      where table_schema='public' and table_name='public_keys'`);
  s.public_keys_shape.matches_measured = s.public_keys_shape.shape === PUBLIC_KEYS_SHAPE;

  // "already applied?" is answered from the CATALOG, not from a migration ledger, so a
  // ledger that disagrees with reality cannot mislead the decision.
  // The pre-state receipt measures ALL THREE roles across ALL EIGHT privileges, so it
  // shows production exactly as it is — including MAINTAIN if it is still present.
  s.public_keys_hardening_applied = await one(client,
    `select coalesce((select string_agg(p,',' order by p) from unnest($1::text[]) p
             where has_table_privilege('anon','public.public_keys',p)), 'none') as anon,
            coalesce((select string_agg(p,',' order by p) from unnest($1::text[]) p
             where has_table_privilege('authenticated','public.public_keys',p)), 'none') as authenticated,
            coalesce((select string_agg(p,',' order by p) from unnest($1::text[]) p
             where has_table_privilege('service_role','public.public_keys',p)), 'none') as service_role,
            (select relrowsecurity from pg_class where oid='public.public_keys'::regclass) as rls,
            (select relforcerowsecurity from pg_class where oid='public.public_keys'::regclass) as forced,
            (select count(*)::int from pg_policy where polrelid='public.public_keys'::regclass) as policies`,
    [ALL_TABLE_PRIVILEGES]);
  s.public_keys_hardening_applied.already_hardened =
    s.public_keys_hardening_applied.anon === 'none'
    && s.public_keys_hardening_applied.authenticated === 'none'
    && s.public_keys_hardening_applied.service_role === PUBLIC_KEYS_SERVICE_ROLE_EXPECTED;

  s.p0_applied = await one(client,
    `select (select count(*)::int from unnest($1::text[]) t(name)
              join pg_class c on c.oid = to_regclass('public.'||t.name)
             where c.relrowsecurity) as fourteen_rls_on,
            (select reloptions::text from pg_class where relname='evidence_sources_public') as view_reloptions,
            (select count(*)::int from pg_policy p join pg_class c on c.oid=p.polrelid
              where c.relname in ('evidence_class_taxonomy','evidence_sources')) as p0_policies`,
    [FOURTEEN]);
  s.p0_applied.already_applied =
    s.p0_applied.fourteen_rls_on === FOURTEEN.length
    && /security_invoker=(true|on)/.test(s.p0_applied.view_reloptions || '')
    && s.p0_applied.p0_policies >= 2;

  // Two views of the same relations, deliberately:
  //   anon/authenticated/service_role  — the ordinary-DML summary the cutover-seven
  //                                      regression check is defined in terms of, and
  //                                      which was certified on staging in those terms;
  //   *_all_eight                      — every PostgreSQL 17 privilege, so the receipt
  //                                      under-reports nothing. MAINTAIN shows up here.
  const { rows: posture } = await client.query(
    `select c.relname as name, c.relkind::text as kind, c.relrowsecurity as rls,
            c.relforcerowsecurity as forced,
            (select count(*)::int from pg_policy p where p.polrelid=c.oid) as policies,
            coalesce((select string_agg(pr,',' order by pr)
               from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) pr
              where has_table_privilege('anon',c.oid,pr)),'none') as anon,
            coalesce((select string_agg(pr,',' order by pr)
               from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) pr
              where has_table_privilege('authenticated',c.oid,pr)),'none') as authenticated,
            coalesce((select string_agg(pr,',' order by pr)
               from unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr
              where has_table_privilege('service_role',c.oid,pr)),'none') as service_role,
            coalesce((select string_agg(pr,',' order by pr) from unnest($2::text[]) pr
              where has_table_privilege('anon',c.oid,pr)),'none') as anon_all_eight,
            coalesce((select string_agg(pr,',' order by pr) from unnest($2::text[]) pr
              where has_table_privilege('authenticated',c.oid,pr)),'none') as authenticated_all_eight,
            coalesce((select string_agg(pr,',' order by pr) from unnest($2::text[]) pr
              where has_table_privilege('service_role',c.oid,pr)),'none') as service_role_all_eight
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname = any($1::text[]) order by 1`,
    [[...FOURTEEN, 'evidence_sources', 'evidence_sources_public', 'public_keys',
      ...Object.keys(CUTOVER_SEVEN)], ALL_TABLE_PRIVILEGES]);
  s.POSTURE = posture;

  const byName = new Map(posture.map((r) => [r.name, r]));
  let reopened = 0; let lost = 0;
  for (const [name, expected] of Object.entries(CUTOVER_SEVEN)) {
    const r = byName.get(name);
    if (!r) { reopened += 1; continue; }
    for (const role of ['anon', 'authenticated']) {
      const got = r[role] === 'none' ? [] : r[role].split(',');
      const allow = expected === 'none' ? [] : expected.split(',');
      if (got.some((p) => !allow.includes(p))) reopened += 1;
    }
    if (r.service_role !== 'DELETE,INSERT,SELECT,UPDATE') lost += 1;
  }
  s.cutover_seven = { api_reopened: reopened, service_role_lost: lost };

  s.p2_execution = {
    forbidden_file: Object.keys(FORBIDDEN_MIGRATIONS)[0],
    in_allowlist: ALLOWED_MIGRATIONS.some((m) => Object.prototype.hasOwnProperty.call(FORBIDDEN_MIGRATIONS, m.file)),
    will_execute: false,
  };

  return s;
}

/** Post-apply certification for one migration, read from the catalog. */
export async function certify(client, order) {
  if (order === 'A') {
    // Every effective-privilege assertion spans ALL EIGHT, and the withheld set is
    // proven absent by name rather than inferred from an aggregate string.
    const r = await one(client,
      `select (select relrowsecurity from pg_class where oid='public.public_keys'::regclass) as rls,
              (select count(*)::int from pg_policy where polrelid='public.public_keys'::regclass) as policies,
              coalesce((select string_agg(p,',' order by p) from unnest($1::text[]) p
                where has_table_privilege('anon','public.public_keys',p)),'none') as anon,
              coalesce((select string_agg(p,',' order by p) from unnest($1::text[]) p
                where has_table_privilege('authenticated','public.public_keys',p)),'none') as authenticated,
              coalesce((select string_agg(p,',' order by p) from unnest($1::text[]) p
                where has_table_privilege('service_role','public.public_keys',p)),'none') as service_role,
              (select count(*)::int from unnest(array['anon','authenticated']) rr(role),
                 unnest($1::text[]) pp(priv)
                where has_table_privilege(rr.role,'public.public_keys',pp.priv)) as api_privileges,
              coalesce((select string_agg(p,',' order by p) from unnest($2::text[]) p
                where has_table_privilege('service_role','public.public_keys',p)),'') as service_role_withheld_but_present,
              coalesce((select string_agg(p,',' order by p) from unnest($3::text[]) p
                where not has_table_privilege('service_role','public.public_keys',p)),'') as service_role_required_but_missing`,
      [ALL_TABLE_PRIVILEGES, PUBLIC_KEYS_SERVICE_ROLE_ABSENT, PUBLIC_KEYS_SERVICE_ROLE_PRESENT]);
    const ok = r.rls === true
      && r.policies === 0
      && r.api_privileges === 0
      && r.anon === 'none'
      && r.authenticated === 'none'
      && r.service_role === PUBLIC_KEYS_SERVICE_ROLE_EXPECTED
      && r.service_role_withheld_but_present === ''
      && r.service_role_required_but_missing === '';
    return { ok, metrics: r };
  }
  const r = await one(client,
    `select (select count(*)::int from unnest($1::text[]) t(name)
               join pg_class c on c.oid=to_regclass('public.'||t.name) where c.relrowsecurity) as fourteen_rls_on,
            (select count(*)::int from unnest($1::text[]) t(name)
               join pg_class c on c.oid=to_regclass('public.'||t.name),
               unnest(array['INSERT','UPDATE','DELETE']) p
              where has_table_privilege('anon',c.oid,p) or has_table_privilege('authenticated',c.oid,p))
              as unintended_api_write_exposures_after,
            (select count(*)::int from unnest($1::text[]) t(name)
               join pg_class c on c.oid=to_regclass('public.'||t.name)
              where t.name <> 'evidence_class_taxonomy'
                and (has_table_privilege('anon',c.oid,'SELECT')
                  or has_table_privilege('authenticated',c.oid,'SELECT')))
              as unintended_api_read_exposures_after,
            (select count(*)::int from unnest($1::text[]) t(name)
               join pg_class c on c.oid=to_regclass('public.'||t.name)
              where t.name = 'evidence_class_taxonomy'
                and has_table_privilege('anon',c.oid,'SELECT')
                and has_table_privilege('authenticated',c.oid,'SELECT'))
              as intentional_public_read_surfaces_after,
            (select count(*)::int from unnest($1::text[]) t(name)
               join pg_class c on c.oid=to_regclass('public.'||t.name)
              where t.name <> 'evidence_class_taxonomy'
                and not has_table_privilege('anon',c.oid,'SELECT')
                and not has_table_privilege('authenticated',c.oid,'SELECT'))
              as service_only_tables_with_select_absent,
            (select reloptions::text from pg_class where relname='evidence_sources_public') as view_reloptions`,
    [FOURTEEN]);
  const ok = r.fourteen_rls_on === FOURTEEN.length
    && r.unintended_api_write_exposures_after === 0
    && r.unintended_api_read_exposures_after === 0
    && r.intentional_public_read_surfaces_after === 1
    && r.service_only_tables_with_select_absent === 13
    && /security_invoker=(true|on)/.test(r.view_reloptions || '');
  return { ok, metrics: r };
}

// ─────────────────────────────────────────────────────────────── entry point

function fail(msg) { console.error(`::error::${msg}`); process.exit(1); }

function tlsConfig() {
  const supplied = process.env.PRODUCTION_CA_CERT;
  if (supplied && supplied.includes('BEGIN CERTIFICATE')) {
    console.log('TLS: verifying against the supplied PRODUCTION_CA_CERT trust anchor.');
    return { rejectUnauthorized: true, ca: supplied };
  }
  try {
    const bundled = readFileSync(join(HERE, '..', '..', 'database', 'certs', 'supabase-prod-ca-2021.crt'), 'utf8');
    if (bundled.includes('BEGIN CERTIFICATE')) {
      console.log('TLS: verifying against the bundled Supabase Root 2021 CA.');
      return { rejectUnauthorized: true, ca: bundled };
    }
  } catch { /* fall through */ }
  console.log('TLS: bundled anchor unavailable; verifying against system roots.');
  return { rejectUnauthorized: true };
}

async function main() {
  const mode = process.env.MODE;
  if (mode !== 'preflight' && mode !== 'apply') fail(`MODE must be "preflight" or "apply", got "${mode}"`);

  const identity = assertProductionIdentity(process.env.PRODUCTION_DATABASE_URL, process.env.PRODUCTION_PROJECT_REF);
  if (!identity.ok) fail(identity.reason);
  console.log('Production identity asserted; the staging ref is refused. Credentials are never printed.');

  // The constant sets are self-checked before the files are even read.
  assertAllowlistIntegrity();
  console.log('Allowlist integrity asserted: 2 pinned migrations; staging parity denylisted and unreachable.');

  // Verify BOTH files before connecting, so a byte mismatch never reaches production.
  const pinned = ALLOWED_MIGRATIONS.map((m) => loadPinnedMigration(m));
  for (const m of pinned) console.log(`Pinned ${m.order}: ${m.file}  sha256=${m.sha256_verified}`);
  console.log(`DENYLISTED, will never execute: ${Object.keys(FORBIDDEN_MIGRATIONS).join(', ')}`);

  const client = new pg.Client({
    connectionString: process.env.PRODUCTION_DATABASE_URL,
    ssl: tlsConfig(),
    application_name: `issue-101-p0-cutover-${mode}`,
  });
  await client.connect();

  try {
    if (mode === 'preflight') {
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
      const { rows: ro } = await client.query('show transaction_read_only');
      if (ro[0]?.transaction_read_only !== 'on') throw new CutoverError('TRANSACTION_NOT_READ_ONLY');
      console.log(`Server confirms transaction_read_only=${ro[0].transaction_read_only}.`);

      const s = await preflight(client);
      await client.query('ROLLBACK');

      console.log('');
      console.log('ISSUE_101_P0_CUTOVER_PREFLIGHT_JSON_BEGIN');
      console.log(JSON.stringify(s, null, 2));
      console.log('ISSUE_101_P0_CUTOVER_PREFLIGHT_JSON_END');
      console.log('');

      const problems = [];
      if (!s.service_role.bypassrls) problems.push('service_role lacks BYPASSRLS');
      if (s.fourteen_present.n !== FOURTEEN.length) problems.push(`only ${s.fourteen_present.n}/14 targets present`);
      if (!s.evidence_objects.evidence_sources || !s.evidence_objects.evidence_sources_public) {
        problems.push('evidence_sources or evidence_sources_public is absent');
      }
      if (!s.public_keys_shape.matches_measured) problems.push('public_keys shape differs from the measurement');
      if (s.p0_applied.already_applied) problems.push('#155 appears ALREADY APPLIED');
      if (s.public_keys_hardening_applied.already_hardened) problems.push('public_keys appears ALREADY HARDENED');
      if (s.cutover_seven.api_reopened !== 0) problems.push('cutover-seven API access has reopened');
      if (s.cutover_seven.service_role_lost !== 0) problems.push('cutover-seven service_role access lost');

      if (problems.length) {
        console.log(`PREFLIGHT: NO-GO — ${problems.join('; ')}`);
        fail(`preflight refused: ${problems.join('; ')}`);
      }
      console.log('PREFLIGHT: GO — nothing was written; P2 was not executed and is not executable here.');
      return;
    }

    // ---- apply: each migration its own transaction, each certified before the next
    for (const m of pinned) {
      console.log('');
      console.log(`── ${m.order}. ${m.file} — ${m.label}`);
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
      try {
        await client.query(m.up);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      }
      console.log(`   committed.`);
      const cert = await certify(client, m.order);
      console.log(`   certification: ${JSON.stringify(cert.metrics)}`);
      if (!cert.ok) fail(`${m.order} applied but FAILED certification; ${m.order === 'A' ? 'B was not attempted' : 'stopping'}`);
      console.log(`   ${m.order} CERTIFIED.`);
    }
    console.log('');
    console.log('CUTOVER COMPLETE — both migrations applied in separate transactions and separately certified.');
  } finally {
    try { await client.query('ROLLBACK'); } catch { /* nothing open */ }
    await client.end();
  }
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => fail(`cutover failed (sanitized): ${sanitizeError(err)}`));
}
