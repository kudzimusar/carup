/**
 * ISSUE #101 — PRODUCTION REACHABILITY PROBE #2 (READ-ONLY ONLY).
 *
 * Probe #1 (run 31749657530) established DB AUTHORIZATION: which roles hold which
 * privileges, and — combined with RLS state and pg_policy — which commands
 * PostgreSQL would permit. It did NOT establish REACHABILITY: whether anything on
 * the internet can actually invoke those commands.
 *
 * Authorization is not exploitability. This probe collects the missing evidence
 * needed to separate:
 *   A DB_AUTHZ_EFFECTIVE     PostgreSQL would permit the command for the role
 *   B API_REACHABLE          the PostgREST/API surface can invoke it
 *   C INDIRECTLY_REACHABLE   an RPC / SECURITY DEFINER bridge can invoke it
 *   D DIRECT_SQL_REACHABLE   a direct database session can assume the role
 *
 * Specifically it answers what probe #1 could not: role state (BYPASSRLS, LOGIN,
 * INHERIT, memberships), table ownership, per-policy roles/commands/expressions,
 * connect/usage/SET ROLE paths, full view internals (security_invoker,
 * security_barrier, is_updatable, rules, INSTEAD OF triggers, base relations and
 * their RLS/owner), the sequence inventory with real ACLs, and — for all
 * API-executable functions — language, volatility, dynamic SQL, and whether a body
 * can mutate data, execute DDL, or issue TRUNCATE (an indirect privilege bridge).
 *
 * SAFETY — identical guarantees to probe #1, and no apply mode exists here either:
 *   · no MODE input, no phrase gate, no DDL/DML code path;
 *   · BEGIN READ ONLY, asserted from the server, bounded statement_timeout, ROLLBACK;
 *   · catalog metadata only — zero application-row reads;
 *   · production identity asserted, staging identity refused, before connecting;
 *   · secrets never printed; identity checks yield booleans.
 *
 * CREDENTIAL HYGIENE: function bodies are inspected for classification. A body is
 * NEVER emitted verbatim. If a body appears to embed a credential, the finding is
 * REPORTED as a boolean flag with the function name only, and the text is redacted.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const STATEMENT_TIMEOUT = '30s';

/** Roles whose state decides the reachability answer. */
export const FOCUS_ROLES = ['anon', 'authenticated', 'authenticator', 'service_role', 'postgres'];

export const FOCUS_VIEWS = [
  'communication_inbox_threads',
  'evidence_sources_public',
  'source_verification_coverage_public',
];

export const REQUIRED_SECTIONS = [
  'ROLE_STATE',
  'ROLE_MEMBERSHIPS',
  'CONNECTIVITY',
  'TABLE_STATE',
  'POLICY_DETAIL',
  'VIEW_STATE',
  'SEQUENCE_STATE',
  'FUNCTION_REACHABILITY',
  'API_EXPOSURE',
  'ROLE_MEMBERSHIP_COMPLETENESS',
];

/**
 * The ONLY PostgREST settings this probe may read. PostgREST also supports
 * pgrst.jwt_secret and pgrst.db_uri; reading pgrst.* wholesale would print a
 * production secret into CI logs. This list is exhaustive by design: it names the
 * current in-database schema-exposure key and the documented backward-compatible
 * singular form, and nothing else.
 */
export const PGRST_SCHEMA_KEYS = ['pgrst.db_schemas', 'pgrst.db_schema'];

/** Parse an exposed-schema setting value into a schema list, or null if unusable. */
export function parseExposedSchemas(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split(',').map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean);
  return parts.length ? parts : null;
}

/** Heuristics used only to CLASSIFY a body; the body itself is never emitted. */
const MUTATION_RE = /\b(insert\s+into|update\s+\w|delete\s+from|truncate|merge\s+into)\b/i;
const DDL_RE = /\b(create|alter|drop)\s+(table|view|function|index|schema|policy|role|sequence)\b/i;
const TRUNCATE_RE = /\btruncate\b/i;
const DYNAMIC_RE = /\bexecute\s+(format\(|'|"|\w)/i;
const CREDENTIAL_RE = /(password\s*=|postgres:\/\/[^\s]*:[^\s]*@|service_role_key|secret\s*=\s*'|eyJ[A-Za-z0-9_-]{20,})/i;

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

export class ProbeError extends Error {
  constructor(code) { super(code); this.name = 'ProbeError'; this.code = code; }
}

const KNOWN_ERROR_CLASSES = new Set([
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'AggregateError', 'ProbeError', 'DatabaseError',
]);

export function sanitizeError(err) {
  const rawName = err && err.name != null ? String(err.name) : 'Error';
  const cls = KNOWN_ERROR_CLASSES.has(rawName) ? rawName : 'Error';
  const raw = err && err.code != null ? String(err.code) : '';
  const code = /^(?:[0-9A-Z]{5}|E[A-Z0-9_]{2,30}|[A-Z][A-Z0-9_]{2,31})$/.test(raw) ? raw : 'UNSPECIFIED';
  return `${cls}/${code}`;
}

export function assertProductionIdentity(url, prodRef) {
  if (!url) return { ok: false, reason: 'PRODUCTION_DATABASE_URL is not set.' };
  if (!prodRef || !/^[a-z0-9]{20}$/.test(prodRef)) {
    return { ok: false, reason: 'PRODUCTION_PROJECT_REF (20-char Supabase ref) is required.' };
  }
  if (prodRef === STAGING_REF) return { ok: false, reason: 'PRODUCTION_PROJECT_REF is the STAGING ref; refusing.' };
  if (!url.includes(prodRef)) return { ok: false, reason: 'connection string does not reference PRODUCTION_PROJECT_REF; refusing.' };
  if (url.includes(STAGING_REF)) return { ok: false, reason: 'connection string references the STAGING project; refusing.' };
  return { ok: true };
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

/**
 * Run a probe that may fail on roles without catalog access. Each runs on a
 * SAVEPOINT so a failure cannot poison the surrounding READ ONLY transaction and
 * mislabel every probe after it (25P02 cascade).
 */
/** Privileges held by one grantee in a decomposed ACL, or 'none'. */
function privsFor(acl, grantee) {
  const set = new Set((acl || []).filter((a) => a.grantee === grantee).map((a) => a.privilege));
  return set.size ? [...set].sort().join(',') : 'none';
}

async function optionalProbe(client, fn, onErr) {
  try { await client.query('SAVEPOINT p'); } catch { /* autocommit */ }
  try {
    await fn();
    try { await client.query('RELEASE SAVEPOINT p'); } catch { /* ignore */ }
  } catch (e) {
    try { await client.query('ROLLBACK TO SAVEPOINT p'); } catch { /* ignore */ }
    if (onErr) onErr(e);
  }
}

export async function collectReachability(client) {
  const s = {};

  // ---- D: can these roles even hold a session, and do they bypass RLS? -----
  const { rows: roles } = await client.query(`
    select r.rolname, r.rolsuper, r.rolbypassrls, r.rolcanlogin, r.rolinherit,
           r.rolreplication, r.rolconnlimit, (r.rolvaliduntil is not null) as has_valid_until
      from pg_roles r
     where r.rolname = any($1::text[]) or exists (
       select 1 from pg_policy p where r.oid = any(p.polroles))
     order by 1`, [FOCUS_ROLES]);
  s.ROLE_STATE = roles;

  // TRANSITIVE closure. One-hop pg_auth_members understates reachability: a role
  // two hops away still yields a SET ROLE path. Reported alongside pg_has_role
  // MEMBER semantics, which is PostgreSQL's own authority on the question.
  const { rows: members } = await client.query(`
    with recursive seed as (
      select oid, rolname from pg_roles where rolname = any($1::text[])
    ),
    closure(start_role, role_oid, depth, path) as (
      select s.rolname, s.oid, 0, array[s.rolname]::text[] from seed s
      union all
      select c.start_role, m.roleid, c.depth + 1, c.path || (m.roleid::regrole::text)
        from closure c
        join pg_auth_members m on m.member = c.role_oid
       -- No depth cap: the path guard already makes this cycle-safe, and an
       -- arbitrary cap would silently report a PARTIAL closure as complete.
       where not (m.roleid::regrole::text = any(c.path))
    )
    select c.start_role,
           c.role_oid::regrole::text as reachable_role,
           c.depth,
           c.path,
           r.rolinherit as reachable_role_inherits,
           r.rolbypassrls as reachable_role_bypassrls,
           r.rolsuper as reachable_role_super,
           pg_catalog.pg_has_role(c.start_role, c.role_oid, 'MEMBER') as pg_has_role_member,
           pg_catalog.pg_has_role(c.start_role, c.role_oid, 'USAGE')  as pg_has_role_usage
      from closure c join pg_roles r on r.oid = c.role_oid
     where c.depth > 0
     order by 1, 3, 2`, [FOCUS_ROLES]);
  s.ROLE_MEMBERSHIPS = members;

  // Completeness proof: pg_has_role is PostgreSQL's own authority. Any role it says
  // is reachable but for which the recursion materialised no path is flagged, so a
  // partial closure can never be presented as complete.
  const { rows: authoritative } = await client.query(`
    select s.rolname as start_role, r.rolname as reachable_role
      from (select rolname from pg_roles where rolname = any($1::text[])) s
      cross join pg_roles r
     where r.rolname <> s.rolname
       and pg_catalog.pg_has_role(s.rolname, r.oid, 'MEMBER')
     order by 1, 2`, [FOCUS_ROLES]);
  const materialised = new Set(members.map((m) => `${m.start_role}|${m.reachable_role}`));
  s.ROLE_MEMBERSHIP_COMPLETENESS = authoritative.map((a) => ({
    start_role: a.start_role,
    reachable_role: a.reachable_role,
    path_materialised: materialised.has(`${a.start_role}|${a.reachable_role}`),
  }));

  // CONNECT on the database, USAGE on public — the preconditions for D.
  const { rows: conn } = await client.query(`
    select r.rolname,
           pg_catalog.has_database_privilege(r.rolname, current_database(), 'CONNECT') as db_connect,
           pg_catalog.has_schema_privilege(r.rolname, 'public', 'USAGE')  as public_usage,
           pg_catalog.has_schema_privilege(r.rolname, 'public', 'CREATE') as public_create
      from pg_roles r where r.rolname = any($1::text[]) order by 1`, [FOCUS_ROLES]);
  s.CONNECTIVITY = conn;

  // (2) API exposure evidence — STRICT ALLOWLIST.
  //
  // SECURITY: PostgREST supports pgrst.jwt_secret, pgrst.db_uri and other secret
  // GUCs. Selecting pgrst.* wholesale would print a production JWT secret into the
  // Actions log. Only the in-database SCHEMA-EXPOSURE keys are ever read, and the
  // filter is applied IN SQL so a secret value never reaches Node at all.
  const apiExposure = {
    exposed_schemas: null,
    determinable: false,
    evidence_source: null,
    schema_setting_present: false,
    classification_rule: null,
  };

  await optionalProbe(client, async () => {
    const { rows } = await client.query(
      `select name, setting from pg_settings where name = any($1::text[]) order by 1`,
      [PGRST_SCHEMA_KEYS]);
    if (rows.length) {
      const parsed = parseExposedSchemas(rows[0].setting);
      if (parsed) {
        apiExposure.exposed_schemas = parsed;
        apiExposure.determinable = true;
        apiExposure.evidence_source = `pg_settings.${rows[0].name}`;
      }
      apiExposure.schema_setting_present = true;
    }
  }, () => {});

  if (!apiExposure.determinable) {
    await optionalProbe(client, async () => {
      // Filtered in SQL by exact key: only allowlisted schema settings are returned.
      const { rows } = await client.query(`
        select r.rolname as role, d.datname as database,
               array_agg(cfg order by cfg) as schema_settings
          from pg_db_role_setting s
          left join pg_roles r on r.oid = s.setrole
          left join pg_database d on d.oid = s.setdatabase
          cross join lateral unnest(coalesce(s.setconfig, '{}'::text[])) as cfg
         where split_part(cfg, '=', 1) = any($1::text[])
         group by 1, 2
         order by 1, 2`, [PGRST_SCHEMA_KEYS]);
      if (rows.length) {
        apiExposure.schema_setting_present = true;
        const first = rows[0].schema_settings[0];
        const parsed = parseExposedSchemas(first.slice(first.indexOf('=') + 1));
        if (parsed) {
          apiExposure.exposed_schemas = parsed;
          apiExposure.determinable = true;
          apiExposure.evidence_source =
            `pg_db_role_setting role=${rows[0].role ?? '(all roles)'} key=${first.split('=')[0]}`;
        }
      }
    }, () => {});
  }

  // determinable is TRUE only when an actual exposed-schema value was obtained AND
  // parsed. No other PostgREST artefact may promote it.
  apiExposure.classification_rule = apiExposure.determinable
    ? 'exposed-schema configuration was read and parsed; API_REACHABLE may be asserted only for the schemas listed in exposed_schemas'
    : 'exposed-schema configuration NOT readable from SQL — every function stays DB_CALLABLE_IF_SCHEMA_EXPOSED and API_REACHABLE must never be asserted; an out-of-band OpenAPI/API census is required';
  s.API_EXPOSURE = [apiExposure];

  // ---- table state incl. OWNER (probe #1 did not collect ownership) --------
  const { rows: tables } = await client.query(`
    select c.relname as table_name, c.relkind,
           pg_get_userbyid(c.relowner) as owner,
           c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
           (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policy_count
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p')
     order by 1`);
  s.TABLE_STATE = tables;

  const { rows: policies } = await client.query(`
    select c.relname as table_name, p.polname as policy, p.polcmd as command,
           p.polpermissive as permissive,
           coalesce((select array_agg(r.rolname::text order by r.rolname)
                       from pg_roles r where r.oid = any(p.polroles)), array['PUBLIC']) as roles,
           pg_get_expr(p.polqual, p.polrelid) as using_expr,
           pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expr
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' order by 1, 2`);
  s.POLICY_DETAIL = policies;

  // ---- view internals: the evidence probe #1 lacked -----------------------
  const { rows: views } = await client.query(`
    select c.relname as view_name, c.relkind,
           pg_get_userbyid(c.relowner) as owner, c.reloptions,
           coalesce(c.reloptions::text[] @> array['security_invoker=true'], false) as security_invoker,
           coalesce(c.reloptions::text[] @> array['security_barrier=true'], false) as security_barrier,
           v.is_updatable, v.is_insertable_into,
           v.is_trigger_updatable, v.is_trigger_insertable_into, v.is_trigger_deletable,
           (select count(*) from pg_rewrite w where w.ev_class = c.oid and w.rulename <> '_RETURN')::int as extra_rules,
           -- TRIGGER_TYPE_INSTEAD = 1<<6 = 64. Counting every non-internal trigger
           -- conflates ordinary triggers with the INSTEAD OF triggers that actually
           -- make a view writable.
           (select count(*) from pg_trigger t
             where t.tgrelid = c.oid and not t.tgisinternal and (t.tgtype & 64) <> 0)::int as instead_of_triggers,
           -- Mutually exclusive with instead_of_triggers by construction.
           (select count(*) from pg_trigger t
             where t.tgrelid = c.oid and not t.tgisinternal and (t.tgtype & 64) = 0)::int as ordinary_triggers,
           coalesce((select jsonb_agg(jsonb_build_object(
                       'name', t.tgname,
                       'instead_of', (t.tgtype & 64) <> 0,
                       'function', t.tgfoid::regprocedure::text))
                       from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal),
                    '[]'::jsonb) as triggers
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join information_schema.views v on v.table_schema = n.nspname and v.table_name = c.relname
     where n.nspname = 'public' and c.relkind in ('v','m')
     order by 1`);

  // Base relations each view depends on, with their RLS/owner.
  // Dependencies across ALL schemas — a view reaching auth.*, storage.* or any other
  // schema is precisely the bypass shape worth knowing about, and filtering to public
  // would have hidden it.
  const { rows: deps } = await client.query(`
    select dependent.relname as view_name,
           dn.nspname        as view_schema,
           bn.nspname        as base_schema,
           base.relname      as base_relation,
           base.relkind      as base_relkind,
           pg_get_userbyid(base.relowner) as base_owner,
           base.relrowsecurity as base_rls_enabled,
           base.relforcerowsecurity as base_rls_forced,
           (select count(*) from pg_policy p where p.polrelid = base.oid)::int as base_policy_count
      from pg_depend d
      join pg_rewrite w   on w.oid = d.objid
      join pg_class dependent on dependent.oid = w.ev_class
      join pg_namespace dn on dn.oid = dependent.relnamespace
      join pg_class base  on base.oid = d.refobjid
      join pg_namespace bn on bn.oid = base.relnamespace
     where d.classid = 'pg_rewrite'::regclass
       and d.refclassid = 'pg_class'::regclass
       and dependent.relkind in ('v','m')
       and base.oid <> dependent.oid
     group by 1,2,3,4,5,6,7,8,9
     order by 1,3,4`);

  const depsByView = new Map();
  for (const d of deps) {
    if (!depsByView.has(d.view_name)) depsByView.set(d.view_name, []);
    depsByView.get(d.view_name).push(d);
  }
  s.VIEW_STATE = views.map((v) => ({
    ...v,
    focus: FOCUS_VIEWS.includes(v.view_name),
    base_relations: depsByView.get(v.view_name) || [],
  }));

  // ---- sequences: EXACT ACL decomposition -------------------------------
  //
  // (1) PUBLIC is a PSEUDO-GRANTEE, not a role in pg_roles. Passing the literal
  // 'public' to has_sequence_privilege / has_function_privilege is not a sound way
  // to measure a PUBLIC grant. This decomposes the real ACL with aclexplode(), where
  // grantee = 0 IS PUBLIC, and falls back to acldefault() when the ACL column is
  // NULL — because a NULL acl does NOT mean "no privileges", it means "the built-in
  // default applies", and that default differs per object type.
  const { rows: seqs } = await client.query(`
    select c.relname as sequence_name,
           pg_get_userbyid(c.relowner) as owner,
           (c.relacl is null) as acl_is_default,
           coalesce((
             select jsonb_agg(distinct jsonb_build_object(
                      'grantee', case when a.grantee = 0 then 'PUBLIC'
                                      else a.grantee::regrole::text end,
                      'privilege', a.privilege_type))
               from aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) a
           ), '[]'::jsonb) as acl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S'
     order by 1`);

  const seqOwned = new Map();
  await optionalProbe(client, async () => {
    const { rows } = await client.query(`
      select c.relname as sequence_name, dc.relname || '.' || a.attname as owned_by
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_depend dep on dep.objid = c.oid and dep.deptype in ('a','i')
        join pg_class dc on dc.oid = dep.refobjid
        join pg_attribute a on a.attrelid = dep.refobjid and a.attnum = dep.refobjsubid
       where n.nspname = 'public' and c.relkind = 'S'`);
    for (const r of rows) seqOwned.set(r.sequence_name, r.owned_by);
  }, () => {});

  s.SEQUENCE_STATE = seqs.map((q) => ({
    sequence_name: q.sequence_name,
    owner: q.owner,
    acl_is_default: q.acl_is_default,
    owned_by: seqOwned.get(q.sequence_name) ?? null,
    anon: privsFor(q.acl, 'anon'),
    authenticated: privsFor(q.acl, 'authenticated'),
    PUBLIC: privsFor(q.acl, 'PUBLIC'),
    service_role: privsFor(q.acl, 'service_role'),
    acl_raw: q.acl,
  }));

  // ---- function reachability: the indirect-bridge question ----------------
  const { rows: fns } = await client.query(`
    select p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as args,
           pg_get_userbyid(p.proowner) as owner,
           p.prosecdef as security_definer,
           l.lanname as language,
           p.provolatile as volatility,
           p.proconfig,
           (select x from unnest(coalesce(p.proconfig, array[]::text[])) x where x like 'search_path=%' limit 1) as search_path,
           -- EXACT ACL decomposition. grantee = 0 IS PUBLIC (a pseudo-grantee, not a
           -- pg_roles entry). acldefault('f', owner) matters enormously here: when
           -- proacl IS NULL PostgreSQL's BUILT-IN DEFAULT GRANTS EXECUTE TO PUBLIC,
           -- so such a function is callable by every role — and revoking anon /
           -- authenticated would not change that.
           (p.proacl is null) as acl_is_default,
           coalesce((
             select jsonb_agg(distinct jsonb_build_object(
                      'grantee', case when a.grantee = 0 then 'PUBLIC'
                                      else a.grantee::regrole::text end,
                      'privilege', a.privilege_type))
               from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           ), '[]'::jsonb) as acl,
           -- has_function_privilege is retained ONLY for named roles, where it
           -- correctly folds in PUBLIC grants and role inheritance. It is never used
           -- for the pseudo-grantee.
           pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') as effective_anon,
           pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') as effective_authenticated,
           pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') as effective_service_role,
           p.prorettype::regtype::text as returns,
           coalesce(p.prosrc, '') as body
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      left join pg_language l on l.oid = p.prolang
     where n.nspname = 'public'
     order by 1, 2`);

  // (5) EVIDENCE, NOT PROOF. Lexical body matching can establish PRESENCE of a
  // mutating/DDL/TRUNCATE construct; it can NEVER establish ABSENCE of an indirect
  // bridge, because dynamic SQL, callee functions and operator/trigger paths are not
  // visible to a regex. Every field below is named as evidence, and any function with
  // dynamic SQL or an unresolved callee is marked absence_not_proven.
  const fnNames = new Set(fns.map((f) => f.function_name));

  s.FUNCTION_REACHABILITY = fns.map((f) => {
    const body = f.body || '';
    const publicExec = privsFor(f.acl, 'PUBLIC') !== 'none';
    // Deterministic call evidence: which other functions in this schema does the body
    // name? Resolved callees are reported; dynamic SQL means the callee set is OPEN.
    const callees = [...fnNames].filter((n) =>
      n !== f.function_name && new RegExp(`\\b${n.replace(/[^\w]/g, '')}\\s*\\(`).test(body));
    const dynamic = DYNAMIC_RE.test(body);
    return {
      function: f.function_name,
      args: f.args,
      owner: f.owner,
      security_definer: f.security_definer,
      language: f.language,
      volatility: f.volatility === 'i' ? 'immutable' : f.volatility === 's' ? 'stable' : 'volatile',
      returns: f.returns,
      search_path: f.search_path ?? null,
      is_trigger_function: f.returns === 'trigger',
      acl_is_default: f.acl_is_default,
      acl: f.acl,
      // (7) PUBLIC EXECUTE is tracked explicitly and separately: revoking anon /
      // authenticated does NOT remove a privilege inherited through PUBLIC.
      public_execute: publicExec,
      public_execute_source: publicExec ? (f.acl_is_default ? 'acldefault (proacl IS NULL)' : 'explicit GRANT TO PUBLIC') : null,
      effective_execute_roles: ['anon', 'authenticated', 'service_role'].filter((r) => f[`effective_${r}`]),
      // (2) DB-callability only. API reachability is NOT asserted here.
      db_callable_by_api_roles: !!(f.effective_anon || f.effective_authenticated || publicExec),
      mutation_evidence: MUTATION_RE.test(body),
      ddl_evidence: DDL_RE.test(body),
      truncate_evidence: TRUNCATE_RE.test(body),
      dynamic_sql_evidence: dynamic,
      resolved_callees: callees,
      absence_not_proven: dynamic || callees.length > 0,
      body_length: body.length,
      credential_suspected_REDACTED: CREDENTIAL_RE.test(body),
    };
  }).map((f) => ({
    ...f,
    // CANDIDATE, not verdict: API-callable in DB terms, not a trigger function, and
    // carrying either privileged execution rights or evidence of privileged effect.
    // A false here means "no evidence found", never "proven safe" — see absence_not_proven.
    indirect_bridge_candidate: f.db_callable_by_api_roles && !f.is_trigger_function &&
      (f.security_definer || f.mutation_evidence || f.truncate_evidence || f.ddl_evidence || f.absence_not_proven),
    reachability_classification: f.db_callable_by_api_roles
      ? 'DB_CALLABLE_IF_SCHEMA_EXPOSED'
      : 'NOT_DB_CALLABLE_BY_API_ROLES',
  }));

  s.TOTALS = {
    roles_examined: s.ROLE_STATE.length,
    roles_with_bypassrls: s.ROLE_STATE.filter((r) => r.rolbypassrls).length,
    roles_with_login: s.ROLE_STATE.filter((r) => r.rolcanlogin).length,
    tables: s.TABLE_STATE.length,
    table_owners: [...new Set(s.TABLE_STATE.map((t) => t.owner))].length,
    policies: s.POLICY_DETAIL.length,
    views: s.VIEW_STATE.length,
    views_updatable: s.VIEW_STATE.filter((v) => v.is_updatable === 'YES').length,
    views_with_instead_of_triggers: s.VIEW_STATE.filter((v) => v.instead_of_triggers > 0).length,
    views_with_cross_schema_deps: s.VIEW_STATE.filter((v) => (v.base_relations || []).some((b) => b.base_schema !== 'public')).length,
    views_with_extra_rules: s.VIEW_STATE.filter((v) => v.extra_rules > 0).length,
    sequences: s.SEQUENCE_STATE.length,
    sequences_anon_update: s.SEQUENCE_STATE.filter((q) => (q.anon || '').includes('UPDATE')).length,
    sequences_public_grant: s.SEQUENCE_STATE.filter((q) => (q.PUBLIC || 'none') !== 'none').length,
    sequences_acl_default: s.SEQUENCE_STATE.filter((q) => q.acl_is_default).length,
    api_exposure_determinable: s.API_EXPOSURE[0].determinable,
    role_paths_materialised: s.ROLE_MEMBERSHIP_COMPLETENESS.filter((x) => x.path_materialised).length,
    role_paths_unmaterialised: s.ROLE_MEMBERSHIP_COMPLETENESS.filter((x) => !x.path_materialised).length,
    views_with_ordinary_triggers: s.VIEW_STATE.filter((v) => v.ordinary_triggers > 0).length,
    functions: s.FUNCTION_REACHABILITY.length,
    functions_db_callable_by_api_roles: s.FUNCTION_REACHABILITY.filter((f) => f.db_callable_by_api_roles).length,
    functions_public_execute: s.FUNCTION_REACHABILITY.filter((f) => f.public_execute).length,
    functions_public_execute_via_acldefault: s.FUNCTION_REACHABILITY.filter((f) => f.public_execute && f.acl_is_default).length,
    functions_absence_not_proven: s.FUNCTION_REACHABILITY.filter((f) => f.absence_not_proven).length,
    functions_trigger: s.FUNCTION_REACHABILITY.filter((f) => f.is_trigger_function).length,
    indirect_bridge_candidates: s.FUNCTION_REACHABILITY.filter((f) => f.indirect_bridge_candidate).length,
    functions_credential_suspected: s.FUNCTION_REACHABILITY.filter((f) => f.credential_suspected_REDACTED).length,
  };
  return s;
}

export function assertComplete(s) {
  const missing = REQUIRED_SECTIONS.filter((k) => !(k in s));
  if (missing.length) return { ok: false, reason: `missing section(s): ${missing.join(', ')}` };
  const notArray = REQUIRED_SECTIONS.filter((k) => !Array.isArray(s[k]));
  if (notArray.length) return { ok: false, reason: `section(s) not arrays: ${notArray.join(', ')}` };
  if (!s.TOTALS || typeof s.TOTALS.tables !== 'number') return { ok: false, reason: 'TOTALS malformed' };
  if (s.TOTALS.tables <= 0) return { ok: false, reason: 'zero tables observed — probe did not see a real schema' };
  if (s.ROLE_STATE.length === 0) return { ok: false, reason: 'no role state collected — reachability is undecidable' };
  const seen = new Set(s.VIEW_STATE.filter((v) => v.focus).map((v) => v.view_name));
  const missingViews = FOCUS_VIEWS.filter((v) => !seen.has(v));
  if (missingViews.length) return { ok: false, reason: `focus view(s) not inventoried: ${missingViews.join(', ')}` };
  return { ok: true };
}

function report(s) {
  const L = console.log;
  L('');
  L('══ ROLE_STATE (decides DIRECT_SQL_REACHABLE and RLS bypass) ══');
  for (const r of s.ROLE_STATE) {
    L(`   ${r.rolname}: super=${r.rolsuper} bypassrls=${r.rolbypassrls} canlogin=${r.rolcanlogin} inherit=${r.rolinherit}`);
  }
  L('');
  L('══ ROLE_MEMBERSHIPS (SET ROLE / privilege inheritance paths) ══');
  for (const m of s.ROLE_MEMBERSHIPS) {
    L(`   ${m.start_role} -> ${m.reachable_role} depth=${m.depth} path=${(m.path || []).join('>')} member=${m.pg_has_role_member} bypassrls=${m.reachable_role_bypassrls}`);
  }
  L(`   count = ${s.ROLE_MEMBERSHIPS.length}`);
  const unmat = s.ROLE_MEMBERSHIP_COMPLETENESS.filter((x) => !x.path_materialised);
  L(`   completeness: ${s.ROLE_MEMBERSHIP_COMPLETENESS.length - unmat.length}/${s.ROLE_MEMBERSHIP_COMPLETENESS.length} pg_has_role edges materialised`);
  for (const u of unmat) L(`   ::warning:: reachable per pg_has_role but NO path materialised: ${u.start_role} -> ${u.reachable_role}`);
  L('');
  L('══ CONNECTIVITY ══');
  for (const c of s.CONNECTIVITY) L(`   ${c.rolname}: db_connect=${c.db_connect} public_usage=${c.public_usage} public_create=${c.public_create}`);
  L('');
  L('══ TABLE_STATE (owner + RLS) ══');
  const owners = {};
  for (const t of s.TABLE_STATE) owners[t.owner] = (owners[t.owner] || 0) + 1;
  for (const [o, n] of Object.entries(owners)) L(`   owner ${o}: ${n} tables`);
  L(`   count = ${s.TABLE_STATE.length}`);
  L('');
  L('══ VIEW_STATE (focus views in full) ══');
  for (const v of s.VIEW_STATE.filter((x) => x.focus)) {
    L(`   ${v.view_name}: kind=${v.relkind} owner=${v.owner} security_invoker=${v.security_invoker} security_barrier=${v.security_barrier}`);
    L(`      is_updatable=${v.is_updatable} is_insertable_into=${v.is_insertable_into} trigger_updatable=${v.is_trigger_updatable}`);
    L(`      extra_rules=${v.extra_rules} instead_of_triggers=${v.instead_of_triggers} ordinary_triggers=${v.ordinary_triggers}`);
    for (const b of v.base_relations) {
      L(`      base ${b.base_schema}.${b.base_relation} (${b.base_relkind}): owner=${b.base_owner} rls=${b.base_rls_enabled} forced=${b.base_rls_forced} policies=${b.base_policy_count}`);
    }
  }
  L('');
  L('══ SEQUENCE_STATE ══');
  L(`   sequences=${s.TOTALS.sequences} anon_update=${s.TOTALS.sequences_anon_update}`);
  for (const q of s.SEQUENCE_STATE.filter((x) => (x.anon || '').includes('UPDATE')).slice(0, 40)) {
    L(`   ${q.sequence_name} owned_by=${q.owned_by ?? '-'} anon=[${q.anon}] auth=[${q.authenticated}] PUBLIC=[${q.PUBLIC}] acl_default=${q.acl_is_default}`);
  }
  L('');
  L('══ API_EXPOSURE (decides whether API_REACHABLE may be asserted at all) ══');
  L(`   exposed_schemas=${JSON.stringify(s.API_EXPOSURE[0].exposed_schemas)}`);
  L(`   determinable=${s.API_EXPOSURE[0].determinable} evidence_source=${s.API_EXPOSURE[0].evidence_source ?? 'none'}`);
  L(`   schema_setting_present=${s.API_EXPOSURE[0].schema_setting_present}`);
  L(`   rule: ${s.API_EXPOSURE[0].classification_rule}`);
  L('');
  L('══ FUNCTION_REACHABILITY (DB-callable by API roles — NOT proof of API reach) ══');
  for (const f of s.FUNCTION_REACHABILITY.filter((x) => x.db_callable_by_api_roles)) {
    L(`   ${f.function}(${f.args}) secdef=${f.security_definer} lang=${f.language} returns=${f.returns} trigger_fn=${f.is_trigger_function}`);
    L(`      effective_exec=${f.effective_execute_roles.join(',') || 'none'} PUBLIC_execute=${f.public_execute}${f.public_execute_source ? ' via ' + f.public_execute_source : ''}`);
    L(`      search_path=${f.search_path ?? 'UNPINNED'} volatility=${f.volatility} class=${f.reachability_classification}`);
    L(`      evidence: mutation=${f.mutation_evidence} truncate=${f.truncate_evidence} ddl=${f.ddl_evidence} dynamic_sql=${f.dynamic_sql_evidence} callees=[${f.resolved_callees.join(',')}]`);
    L(`      absence_not_proven=${f.absence_not_proven}  BRIDGE_CANDIDATE=${f.indirect_bridge_candidate}`);
    if (f.credential_suspected_REDACTED) L('      ::warning:: credential-like text detected in body — REDACTED, not emitted');
  }
  L('');
  L('══ TOTALS ══');
  for (const [k, v] of Object.entries(s.TOTALS)) L(`   ${k} = ${v}`);
}

async function main() {
  const url = process.env.PRODUCTION_DATABASE_URL;
  const prodRef = process.env.PRODUCTION_PROJECT_REF;
  const identity = assertProductionIdentity(url, prodRef);
  if (!identity.ok) fail(identity.reason);
  console.log('Production identity asserted (ref matched; staging ref refused). Credentials are never printed.');

  const client = new pg.Client({ connectionString: url, ssl: tlsConfig(), application_name: 'issue-101-reachability' });
  await client.connect();
  console.log('Connected (mode=reachability, READ ONLY).');

  let s;
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    const { rows: ro } = await client.query('show transaction_read_only');
    if (ro[0]?.transaction_read_only !== 'on') throw new ProbeError('TRANSACTION_NOT_READ_ONLY');
    console.log(`Server confirms transaction_read_only=${ro[0].transaction_read_only}; statement_timeout=${STATEMENT_TIMEOUT}.`);
    s = await collectReachability(client);
  } finally {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    await client.end();
  }

  const complete = assertComplete(s);
  if (!complete.ok) fail(`REACHABILITY PROBE INCOMPLETE — ${complete.reason}`);

  report(s);
  console.log('');
  console.log('ISSUE_101_REACHABILITY_JSON_BEGIN');
  console.log(JSON.stringify(s, null, 2));
  console.log('ISSUE_101_REACHABILITY_JSON_END');
  console.log('');
  console.log('REACHABILITY PROBE COMPLETE — nothing was written. Catalog metadata only; no application rows were read; no function body was emitted.');
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => fail(`reachability probe failed (sanitized): ${sanitizeError(err)}`));
}
