/**
 * OC-5R-REL-01 — which Supabase project this runtime actually talks to, as a non-secret fact.
 *
 * A deployed preview's identity used to be provable only indirectly (the bundle's API origin, the
 * build SHA). Which DATABASE it reaches was inferred from configuration nobody could read — the
 * connection strings are sensitive variables. This reports the project REF each configured endpoint
 * points at, extracted by shape, and nothing else: never a URL, a host, a user name or a password.
 * A project ref is not a secret (it is the public Supabase API host), but a connection string is.
 *
 * `consistent` is true only when every configured endpoint names the same project — a runtime whose
 * REST client and Postgres pool point at different projects is the failure this exists to expose.
 */
const REF = '([a-z0-9]{20})';
const SUPABASE_HOST = new RegExp(`^${REF}\\.supabase\\.(?:co|in)$`);
const DIRECT_HOST = new RegExp(`^db\\.${REF}\\.supabase\\.(?:co|in)$`);
const POOLER_USER = new RegExp(`^[a-z_]+\\.${REF}$`);

export const POSTGRES_ENDPOINT_VARIABLES = Object.freeze([
  'DATABASE_URL',
  'SUPABASE_DB_URL',
  'DIRECT_URL',
  'POSTGRES_URL',
  'POSTGRES_URL_NON_POOLING',
  'POSTGRES_PRISMA_URL',
  'DIASPORA_STAGING_DATABASE_URL',
]);

function parse(value) {
  try { return new URL(String(value).trim()); } catch { return null; }
}

export function refFromSupabaseUrl(value) {
  const url = parse(value);
  return url ? (url.hostname.match(SUPABASE_HOST)?.[1] ?? null) : null;
}

export function refFromPostgresUrl(value) {
  const url = parse(value);
  if (!url) return null;
  let user = '';
  try { user = decodeURIComponent(url.username || ''); } catch { user = ''; }
  return user.match(POOLER_USER)?.[1] ?? url.hostname.match(DIRECT_HOST)?.[1] ?? null;
}

export function resolveDatabaseTarget(env = process.env) {
  const supabaseRef = env.SUPABASE_URL ? refFromSupabaseUrl(env.SUPABASE_URL) : null;
  const configured = POSTGRES_ENDPOINT_VARIABLES.filter((name) => env[name] && String(env[name]).trim());
  const postgresRefs = configured.map((name) => refFromPostgresUrl(env[name]));
  const known = [supabaseRef, ...postgresRefs].filter(Boolean);
  const distinct = [...new Set(known)];
  return {
    supabase_project_ref: supabaseRef,
    postgres_project_refs: [...new Set(postgresRefs.filter(Boolean))],
    // Configured endpoints whose ref could not be read by shape — counted, never shown.
    unrecognised_endpoints: postgresRefs.filter((ref) => !ref).length + (env.SUPABASE_URL && !supabaseRef ? 1 : 0),
    consistent: distinct.length === 1,
  };
}
