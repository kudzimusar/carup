/**
 * ISSUE #101 — PRODUCTION SECURITY INVENTORY PROBE (READ-ONLY ONLY).
 *
 * Purpose: produce, as a reviewable CI receipt, the complete production security
 * census Issue #101 acceptance criterion 1 requires — the census that no existing
 * tooling can produce. The publication-gate preflight reports RLS + grants for
 * seven tables only and never touches pg_policy, pg_default_acl, prosecdef,
 * information_schema.views or routine_privileges.
 *
 * THERE IS NO APPLY MODE. There is no MODE input, no authorization phrase, and no
 * code path in this file that executes DDL or DML. The single database session is
 * opened with BEGIN READ ONLY, that state is asserted from the server before any
 * inventory query runs, and the transaction is closed with ROLLBACK. A write would
 * be refused by PostgreSQL itself (25006 read_only_sql_transaction) even if one
 * were somehow constructed.
 *
 * CATALOG METADATA ONLY. Every query reads pg_catalog / information_schema. No
 * application row is selected, counted or emitted. The only counts produced are
 * counts OF CATALOG OBJECTS (how many tables have RLS off, etc.).
 *
 * SECRET DISCIPLINE. The connection string, the project ref and every environment
 * secret are never printed, logged, interpolated into output, or included in the
 * JSON receipt. Identity is proved by substring checks whose RESULT is a boolean.
 *
 * IDENTITY, fail-closed (mirrors backend/scripts/production-apply-publication-gate.mjs):
 *   · PRODUCTION_PROJECT_REF must be present and a 20-char Supabase ref;
 *   · it must not be the staging ref;
 *   · the connection string must positively contain it;
 *   · the connection string must not contain the staging ref;
 *   · TLS verification is ON, anchored on PRODUCTION_CA_CERT when supplied else the
 *     Supabase root bundled at database/certs/.
 * Any failure exits non-zero BEFORE a connection is attempted.
 *
 * OUTPUT: a section-labelled human-readable log plus one machine-readable JSON
 * block between ISSUE_101_INVENTORY_JSON_BEGIN/END. Every required section must be
 * populated or the run FAILS — a partial inventory must never read as a complete one.
 *
 * NOTE ON LABELLING: the RLS section is deliberately titled
 * "PRODUCTION CATALOG EQUIVALENT — rls_disabled_in_public". It is derived from
 * pg_class.relrowsecurity, not from Supabase's advisor API, and must never be
 * presented as literal get_advisors output.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer'; // refused if present in the URL
const STATEMENT_TIMEOUT = '30s';

/** The five tables Issue #101 escalation named; probed for existence + full posture. */
export const P0_TABLES = [
  'security_events',
  'public_keys',
  'stolen_vehicles',
  'kyc_profiles',
  'tenant_api_keys',
];

/** Hardened by the publication-gate cutover (apply run 31703872197); probed for regression. */
export const CUTOVER_SEVEN = [
  'mechanic_work_orders',
  'mechanic_parts',
  'rolling_integrity_checkpoints',
  'trust_score_history',
  'vehicle_ownership_history',
  'vehicle_evidence',
  'vehicles',
];

/** Expected post-cutover posture, used to flag regression. */
export const CUTOVER_EXPECTED = {
  mechanic_work_orders: 'none',
  mechanic_parts: 'none',
  rolling_integrity_checkpoints: 'none',
  trust_score_history: 'none',
  vehicle_ownership_history: 'none',
  vehicle_evidence: 'SELECT',
  vehicles: 'SELECT',
};

export const TABLE_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
export const API_ROLES = ['anon', 'authenticated', 'public', 'service_role'];

/** Every section the receipt must contain. A missing or unpopulated one fails the run. */
export const REQUIRED_SECTIONS = [
  'RLS_DISABLED_IN_PUBLIC',
  'ANON_AUTH_TABLE_GRANTS',
  'TRUNCATE_EXPOSURE',
  'POLICIES',
  'DEFAULT_ACL',
  'SECURITY_DEFINER_VIEWS',
  'SECURITY_DEFINER_FUNCTIONS',
  'VIEW_SECURITY_INVOKER_POSTURE',
  'FUNCTION_SEARCH_PATH',
  'FUNCTION_EXECUTE_GRANTS',
  'P0_TABLE_POSTURE',
  'CUTOVER_SEVEN_REGRESSION',
];

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

/**
 * Identity gate. Returns the validated connection string; never prints it.
 * Exported for tests so the guard can be exercised without a database.
 */
export function assertProductionIdentity(url, prodRef) {
  if (!url) return { ok: false, reason: 'PRODUCTION_DATABASE_URL is not set.' };
  if (!prodRef || !/^[a-z0-9]{20}$/.test(prodRef)) {
    return { ok: false, reason: 'PRODUCTION_PROJECT_REF (20-char Supabase ref) is required.' };
  }
  if (prodRef === STAGING_REF) {
    return { ok: false, reason: 'PRODUCTION_PROJECT_REF is the STAGING ref; refusing.' };
  }
  if (!url.includes(prodRef)) {
    return { ok: false, reason: 'connection string does not reference PRODUCTION_PROJECT_REF; refusing.' };
  }
  if (url.includes(STAGING_REF)) {
    return { ok: false, reason: 'connection string references the STAGING project; refusing.' };
  }
  return { ok: true };
}

function tlsConfig() {
  const supplied = process.env.PRODUCTION_CA_CERT;
  if (supplied && supplied.includes('BEGIN CERTIFICATE')) {
    console.log('TLS: verifying against the supplied PRODUCTION_CA_CERT trust anchor.');
    return { rejectUnauthorized: true, ca: supplied };
  }
  try {
    const bundled = readFileSync(
      fileURLToPath(new URL('../../database/certs/supabase-prod-ca-2021.crt', import.meta.url)),
      'utf8',
    );
    if (bundled.includes('BEGIN CERTIFICATE')) {
      console.log('TLS: verifying against the bundled Supabase Root 2021 CA (database/certs/).');
      return { rejectUnauthorized: true, ca: bundled };
    }
  } catch { /* fall through */ }
  console.log('TLS: bundled anchor unavailable; verifying against system roots.');
  return { rejectUnauthorized: true };
}

/** Privilege probe for one role across TABLE_PRIVS, as a comma string or 'none'. */
function privExpr(role, alias = 'c.oid') {
  const list = TABLE_PRIVS.map((p) => `'${p}'`).join(',');
  return `coalesce((select string_agg(pr, ',' order by pr) from unnest(array[${list}]) pr
            where pg_catalog.has_table_privilege('${role}', ${alias}, pr)), 'none')`;
}

export async function collectInventory(client) {
  const sections = {};

  // Which API roles actually exist — has_table_privilege raises on an unknown role.
  const { rows: roleRows } = await client.query(
    `select rolname from pg_roles where rolname = any($1::text[])`, [API_ROLES.filter((r) => r !== 'public')],
  );
  const presentRoles = new Set(roleRows.map((r) => r.rolname));
  presentRoles.add('public'); // PUBLIC is a pseudo-role and is always addressable
  sections.ROLES_PRESENT = [...presentRoles].sort();

  const roleCols = [...presentRoles]
    .map((r) => `${privExpr(r)} as "${r}"`)
    .join(',\n           ');

  // ---- tables: RLS posture + full grant matrix -----------------------------
  const { rows: tables } = await client.query(`
    select c.relname as table_name,
           c.relrowsecurity as rls_enabled,
           c.relforcerowsecurity as rls_forced,
           (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policy_count,
           ${roleCols}
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p')
     order by 1`);

  sections.RLS_DISABLED_IN_PUBLIC = tables
    .filter((t) => !t.rls_enabled)
    .map((t) => ({ table: t.table_name, rls_enabled: false, policy_count: t.policy_count }));

  const writePrivs = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];
  const hasWrite = (v) => typeof v === 'string' && writePrivs.some((p) => v.split(',').includes(p));

  sections.ANON_AUTH_TABLE_GRANTS = tables
    .filter((t) => hasWrite(t.anon) || hasWrite(t.authenticated) || hasWrite(t.public))
    .map((t) => ({
      table: t.table_name,
      rls_enabled: t.rls_enabled,
      policy_count: t.policy_count,
      anon: t.anon ?? 'none',
      authenticated: t.authenticated ?? 'none',
      public: t.public ?? 'none',
      service_role: t.service_role ?? 'none',
    }));

  sections.TRUNCATE_EXPOSURE = tables
    .filter((t) => [t.anon, t.authenticated, t.public].some((v) => typeof v === 'string' && v.split(',').includes('TRUNCATE')))
    .map((t) => ({
      table: t.table_name,
      rls_enabled: t.rls_enabled,
      policy_count: t.policy_count,
      truncate_roles: ['anon', 'authenticated', 'public']
        .filter((r) => typeof t[r] === 'string' && t[r].split(',').includes('TRUNCATE')),
    }));

  // ---- policies ------------------------------------------------------------
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
     where n.nspname = 'public'
     order by 1, 2`);
  sections.POLICIES = policies;

  // ---- default ACL (the root-cause amplifier) ------------------------------
  const { rows: defacl } = await client.query(`
    select pg_get_userbyid(d.defaclrole) as grantor,
           coalesce(n.nspname, '(all schemas)') as schema,
           d.defaclobjtype as object_type,
           d.defaclacl::text[] as acl
      from pg_default_acl d
      left join pg_namespace n on n.oid = d.defaclnamespace
     order by 1, 2, 3`);
  sections.DEFAULT_ACL = defacl;

  // ---- views: ownership, security_invoker, grants --------------------------
  const { rows: views } = await client.query(`
    select c.relname as view_name,
           c.relkind as kind,
           pg_get_userbyid(c.relowner) as owner,
           c.reloptions,
           coalesce(c.reloptions::text[] @> array['security_invoker=true'], false) as security_invoker,
           ${roleCols}
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v','m')
     order by 1`);

  sections.VIEW_SECURITY_INVOKER_POSTURE = views.map((v) => ({
    view: v.view_name,
    kind: v.kind === 'm' ? 'materialized' : 'view',
    owner: v.owner,
    security_invoker: v.security_invoker,
    reloptions: v.reloptions,
    anon: v.anon ?? 'none',
    authenticated: v.authenticated ?? 'none',
    public: v.public ?? 'none',
  }));

  // A view without security_invoker executes with its OWNER's rights and can
  // therefore bypass RLS on its base tables — the SECURITY DEFINER view class.
  sections.SECURITY_DEFINER_VIEWS = sections.VIEW_SECURITY_INVOKER_POSTURE
    .filter((v) => !v.security_invoker)
    .map((v) => ({
      view: v.view,
      owner: v.owner,
      anon: v.anon,
      authenticated: v.authenticated,
      public: v.public,
      note: 'no security_invoker: executes with owner rights, bypasses RLS on base tables',
    }));

  // ---- functions: secdef, owner, search_path, EXECUTE exposure -------------
  const execCols = [...presentRoles]
    .map((r) => `coalesce(pg_catalog.has_function_privilege('${r}', p.oid, 'EXECUTE'), false) as "exec_${r}"`)
    .join(',\n           ');

  const { rows: functions } = await client.query(`
    select p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as args,
           pg_get_userbyid(p.proowner) as owner,
           p.prosecdef as security_definer,
           p.proconfig,
           (select x from unnest(coalesce(p.proconfig, array[]::text[])) x
             where x like 'search_path=%' limit 1) as search_path,
           ${execCols}
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
     order by 1, 2`);

  const execRolesOf = (f) => [...presentRoles].filter((r) => f[`exec_${r}`]);

  sections.SECURITY_DEFINER_FUNCTIONS = functions
    .filter((f) => f.security_definer)
    .map((f) => ({
      function: f.function_name,
      args: f.args,
      owner: f.owner,
      search_path: f.search_path ?? null,
      search_path_pinned: !!f.search_path,
      execute_roles: execRolesOf(f),
    }));

  sections.FUNCTION_SEARCH_PATH = functions.map((f) => ({
    function: f.function_name,
    args: f.args,
    security_definer: f.security_definer,
    search_path: f.search_path ?? null,
    search_path_pinned: !!f.search_path,
  }));

  sections.FUNCTION_EXECUTE_GRANTS = functions
    .map((f) => ({
      function: f.function_name,
      args: f.args,
      security_definer: f.security_definer,
      execute_roles: execRolesOf(f).filter((r) => r !== 'service_role'),
    }))
    .filter((f) => f.execute_roles.length > 0);

  // ---- P0 tables -----------------------------------------------------------
  const byName = new Map(tables.map((t) => [t.table_name, t]));
  sections.P0_TABLE_POSTURE = P0_TABLES.map((name) => {
    const t = byName.get(name);
    if (!t) return { table: name, exists: false };
    return {
      table: name,
      exists: true,
      rls_enabled: t.rls_enabled,
      rls_forced: t.rls_forced,
      policy_count: t.policy_count,
      anon: t.anon ?? 'none',
      authenticated: t.authenticated ?? 'none',
      public: t.public ?? 'none',
      service_role: t.service_role ?? 'none',
    };
  });

  // ---- cutover-seven regression -------------------------------------------
  sections.CUTOVER_SEVEN_REGRESSION = CUTOVER_SEVEN.map((name) => {
    const t = byName.get(name);
    if (!t) return { table: name, exists: false, regressed: true, reason: 'table missing' };
    const expected = CUTOVER_EXPECTED[name];
    const anon = t.anon ?? 'none';
    const auth = t.authenticated ?? 'none';
    const matches = anon === expected && auth === expected;
    return {
      table: name,
      exists: true,
      rls_enabled: t.rls_enabled,
      anon,
      authenticated: auth,
      expected,
      regressed: !t.rls_enabled || !matches,
    };
  });

  // ---- deterministic totals ------------------------------------------------
  sections.TOTALS = {
    public_tables: tables.length,
    rls_enabled: tables.filter((t) => t.rls_enabled).length,
    rls_disabled: sections.RLS_DISABLED_IN_PUBLIC.length,
    rls_enabled_no_policy: tables.filter((t) => t.rls_enabled && t.policy_count === 0).length,
    api_writable_tables: sections.ANON_AUTH_TABLE_GRANTS.length,
    truncate_exposed_tables: sections.TRUNCATE_EXPOSURE.length,
    policies: policies.length,
    default_acl_entries: defacl.length,
    views: sections.VIEW_SECURITY_INVOKER_POSTURE.length,
    security_definer_views: sections.SECURITY_DEFINER_VIEWS.length,
    functions: functions.length,
    security_definer_functions: sections.SECURITY_DEFINER_FUNCTIONS.length,
    security_definer_unpinned_search_path:
      sections.SECURITY_DEFINER_FUNCTIONS.filter((f) => !f.search_path_pinned).length,
    functions_executable_by_api_roles: sections.FUNCTION_EXECUTE_GRANTS.length,
    p0_tables_present: sections.P0_TABLE_POSTURE.filter((t) => t.exists).length,
    cutover_seven_regressed: sections.CUTOVER_SEVEN_REGRESSION.filter((t) => t.regressed).length,
  };

  return sections;
}

/**
 * Fail-closed completeness gate: a partial inventory must never read as complete.
 * Exported for tests.
 */
export function assertInventoryComplete(sections) {
  const missing = REQUIRED_SECTIONS.filter((s) => !(s in sections));
  if (missing.length) {
    return { ok: false, reason: `inventory is missing required section(s): ${missing.join(', ')}` };
  }
  const nonArray = REQUIRED_SECTIONS.filter((s) => !Array.isArray(sections[s]));
  if (nonArray.length) {
    return { ok: false, reason: `section(s) are not arrays: ${nonArray.join(', ')}` };
  }
  if (!sections.TOTALS || typeof sections.TOTALS.public_tables !== 'number') {
    return { ok: false, reason: 'TOTALS is missing or malformed' };
  }
  if (sections.TOTALS.public_tables <= 0) {
    return { ok: false, reason: 'zero public tables inventoried — the probe did not observe a real schema' };
  }
  if (sections.P0_TABLE_POSTURE.length !== P0_TABLES.length) {
    return { ok: false, reason: 'P0_TABLE_POSTURE did not cover every P0 table' };
  }
  if (sections.CUTOVER_SEVEN_REGRESSION.length !== CUTOVER_SEVEN.length) {
    return { ok: false, reason: 'CUTOVER_SEVEN_REGRESSION did not cover all seven cutover tables' };
  }
  return { ok: true };
}

function report(sections) {
  const line = (s) => console.log(s);
  line('');
  line('══ PRODUCTION CATALOG EQUIVALENT — rls_disabled_in_public ══');
  line('   (derived from pg_class.relrowsecurity — NOT literal Supabase get_advisors output)');
  for (const t of sections.RLS_DISABLED_IN_PUBLIC) line(`   rls=OFF  ${t.table}  policies=${t.policy_count}`);
  line(`   count = ${sections.RLS_DISABLED_IN_PUBLIC.length}`);

  line('');
  line('══ ANON_AUTH_TABLE_GRANTS (tables granting anon/authenticated/PUBLIC a write) ══');
  for (const t of sections.ANON_AUTH_TABLE_GRANTS) {
    line(`   ${t.table}  rls=${t.rls_enabled ? 'on' : 'OFF'} policies=${t.policy_count} anon=[${t.anon}] authenticated=[${t.authenticated}] public=[${t.public}]`);
  }
  line(`   count = ${sections.ANON_AUTH_TABLE_GRANTS.length}`);

  line('');
  line('══ TRUNCATE_EXPOSURE (TRUNCATE is NOT filtered by RLS) ══');
  for (const t of sections.TRUNCATE_EXPOSURE) {
    line(`   ${t.table}  rls=${t.rls_enabled ? 'on' : 'OFF'} policies=${t.policy_count} truncate_roles=${t.truncate_roles.join(',')}`);
  }
  line(`   count = ${sections.TRUNCATE_EXPOSURE.length}`);

  line('');
  line('══ POLICIES ══');
  for (const p of sections.POLICIES) {
    line(`   ${p.table_name}.${p.policy} cmd=${p.command} permissive=${p.permissive} roles=${(p.roles || []).join('|')}`);
    line(`      USING      ${p.using_expr ?? '(none)'}`);
    line(`      WITH CHECK ${p.with_check_expr ?? '(none)'}`);
  }
  line(`   count = ${sections.POLICIES.length}`);

  line('');
  line('══ DEFAULT_ACL ══');
  for (const d of sections.DEFAULT_ACL) {
    line(`   grantor=${d.grantor} schema=${d.schema} objtype=${d.object_type} acl=${JSON.stringify(d.acl)}`);
  }
  line(`   count = ${sections.DEFAULT_ACL.length}`);

  line('');
  line('══ SECURITY_DEFINER_VIEWS ══');
  for (const v of sections.SECURITY_DEFINER_VIEWS) {
    line(`   ${v.view}  owner=${v.owner} anon=[${v.anon}] authenticated=[${v.authenticated}]`);
  }
  line(`   count = ${sections.SECURITY_DEFINER_VIEWS.length}`);

  line('');
  line('══ VIEW_SECURITY_INVOKER_POSTURE ══');
  for (const v of sections.VIEW_SECURITY_INVOKER_POSTURE) {
    line(`   ${v.view} (${v.kind}) owner=${v.owner} security_invoker=${v.security_invoker} anon=[${v.anon}]`);
  }
  line(`   count = ${sections.VIEW_SECURITY_INVOKER_POSTURE.length}`);

  line('');
  line('══ SECURITY_DEFINER_FUNCTIONS ══');
  for (const f of sections.SECURITY_DEFINER_FUNCTIONS) {
    line(`   ${f.function}(${f.args}) owner=${f.owner} search_path=${f.search_path ?? 'UNPINNED'} execute=${f.execute_roles.join(',') || 'none'}`);
  }
  line(`   count = ${sections.SECURITY_DEFINER_FUNCTIONS.length}`);

  line('');
  line('══ FUNCTION_SEARCH_PATH (unpinned only) ══');
  for (const f of sections.FUNCTION_SEARCH_PATH.filter((x) => !x.search_path_pinned)) {
    line(`   ${f.function}(${f.args}) security_definer=${f.security_definer} search_path=UNPINNED`);
  }
  line(`   unpinned = ${sections.FUNCTION_SEARCH_PATH.filter((x) => !x.search_path_pinned).length} of ${sections.FUNCTION_SEARCH_PATH.length}`);

  line('');
  line('══ FUNCTION_EXECUTE_GRANTS (anon/authenticated/PUBLIC) ══');
  for (const f of sections.FUNCTION_EXECUTE_GRANTS) {
    line(`   ${f.function}(${f.args}) security_definer=${f.security_definer} execute=${f.execute_roles.join(',')}`);
  }
  line(`   count = ${sections.FUNCTION_EXECUTE_GRANTS.length}`);

  line('');
  line('══ P0_TABLE_POSTURE ══');
  for (const t of sections.P0_TABLE_POSTURE) {
    line(t.exists
      ? `   ${t.table}  EXISTS rls=${t.rls_enabled ? 'on' : 'OFF'} policies=${t.policy_count} anon=[${t.anon}] authenticated=[${t.authenticated}]`
      : `   ${t.table}  ABSENT in production`);
  }

  line('');
  line('══ CUTOVER_SEVEN_REGRESSION ══');
  for (const t of sections.CUTOVER_SEVEN_REGRESSION) {
    line(`   ${t.table}  ${t.regressed ? 'REGRESSED' : 'ok'}  rls=${t.rls_enabled ? 'on' : 'OFF'} anon=[${t.anon}] expected=[${t.expected}]`);
  }
  line(`   regressed = ${sections.TOTALS.cutover_seven_regressed}`);

  line('');
  line('══ TOTALS ══');
  for (const [k, v] of Object.entries(sections.TOTALS)) line(`   ${k} = ${v}`);
}

async function main() {
  const url = process.env.PRODUCTION_DATABASE_URL;
  const prodRef = process.env.PRODUCTION_PROJECT_REF;

  const identity = assertProductionIdentity(url, prodRef);
  if (!identity.ok) fail(identity.reason);
  console.log('Production identity asserted (ref matched; staging ref refused). Credentials are never printed.');

  const client = new pg.Client({ connectionString: url, ssl: tlsConfig(), application_name: 'issue-101-inventory' });
  await client.connect();
  console.log('Connected (mode=inventory, READ ONLY).');

  let sections;
  try {
    // Structurally read-only session. A write is refused by PostgreSQL (25006).
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);

    const { rows: ro } = await client.query('show transaction_read_only');
    const readOnly = ro[0]?.transaction_read_only;
    if (readOnly !== 'on') {
      fail(`transaction is not READ ONLY (transaction_read_only=${readOnly}); refusing to proceed.`);
    }
    console.log(`Server confirms transaction_read_only=${readOnly}; statement_timeout=${STATEMENT_TIMEOUT}.`);

    sections = await collectInventory(client);
  } finally {
    // Close the transaction even though nothing could have been written.
    try { await client.query('ROLLBACK'); } catch { /* connection already closed */ }
    await client.end();
  }

  const complete = assertInventoryComplete(sections);
  if (!complete.ok) fail(`INVENTORY INCOMPLETE — ${complete.reason}`);

  report(sections);

  console.log('');
  console.log('ISSUE_101_INVENTORY_JSON_BEGIN');
  console.log(JSON.stringify(sections, null, 2));
  console.log('ISSUE_101_INVENTORY_JSON_END');
  console.log('');
  console.log('INVENTORY COMPLETE — nothing was written. Catalog metadata only; no application rows were read.');
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => {
    // Never echo the connection string or any secret in an error path.
    fail(`inventory failed: ${err.code ? `${err.code} ` : ''}${err.message}`);
  });
}
