/**
 * OC-5R-REL-01 — which Supabase project this runtime actually talks to, as a non-secret fact.
 *
 * A deployed preview's identity used to be provable only indirectly (the bundle's API origin, the
 * build SHA). Which DATABASE it reaches was inferred from configuration nobody could read — the
 * connection strings are sensitive variables. This reports the project REF each configured endpoint
 * points at, extracted by shape, and nothing else: never a URL, a host, a user name or a password.
 * A project ref is not a secret (it is the public Supabase API host), but a connection string is.
 *
 * `consistent` is true only when EVERY configured endpoint is read and all name the same project — a
 * runtime whose REST client and Postgres pool point at different projects is the failure this exists
 * to expose, and an endpoint that cannot be read cannot be shown to agree. Unreadable endpoints are
 * reported by VARIABLE NAME only (never a value), so an operator knows which one to look at.
 *
 * Reading a connection string: the WHATWG URL parser rejects a password holding unencoded '#', '/',
 * '?' or '@', which real database passwords do. So the user and host are also read from the raw
 * string — up to the LAST '@' (a password with '@') and up to the FIRST '@' (a query string with '@')
 * — and a ref is accepted only when every reading that finds one agrees.
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

const decode = (value) => { try { return decodeURIComponent(value); } catch { return value; } };
const RAW_LAST_AT = /^[a-z][a-z0-9+.-]*:\/\/(.*)@([^@/?#]*)/is;
const RAW_FIRST_AT = /^[a-z][a-z0-9+.-]*:\/\/([^@]*)@([^@/?#]*)/i;

/** Every way of reading { user, host } out of a connection string. */
function readings(raw) {
  const out = [];
  const url = parse(raw);
  if (url) out.push({ user: decode(url.username || ''), host: url.hostname });
  for (const re of [RAW_LAST_AT, RAW_FIRST_AT]) {
    const m = raw.match(re);
    if (m) out.push({ user: decode(m[1].split(':')[0]), host: m[2].split(':')[0] });
  }
  return out;
}

export function refFromPostgresUrl(value) {
  const raw = String(value ?? '').trim();
  const refs = new Set(readings(raw)
    .map(({ user, host }) => user.match(POOLER_USER)?.[1] ?? String(host).toLowerCase().match(DIRECT_HOST)?.[1] ?? null)
    .filter(Boolean));
  return refs.size === 1 ? [...refs][0] : null;
}

export function resolveDatabaseTarget(env = process.env) {
  const supabaseRef = env.SUPABASE_URL ? refFromSupabaseUrl(env.SUPABASE_URL) : null;
  const configured = POSTGRES_ENDPOINT_VARIABLES.filter((name) => env[name] && String(env[name]).trim());
  const postgresRefs = configured.map((name) => refFromPostgresUrl(env[name]));
  const unrecognisedNames = [
    ...configured.filter((_, i) => !postgresRefs[i]),
    ...(env.SUPABASE_URL && !supabaseRef ? ['SUPABASE_URL'] : []),
  ];
  const distinct = [...new Set([supabaseRef, ...postgresRefs].filter(Boolean))];
  return {
    supabase_project_ref: supabaseRef,
    postgres_project_refs: [...new Set(postgresRefs.filter(Boolean))],
    // Configured endpoints whose ref could not be read by shape — counted and named, never shown.
    unrecognised_endpoints: unrecognisedNames.length,
    unrecognised_endpoint_names: unrecognisedNames,
    consistent: distinct.length === 1 && unrecognisedNames.length === 0,
  };
}
