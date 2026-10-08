/**
 * OC-5R-REL-03A — fail-closed, read-only PostgreSQL custody helpers.
 *
 * Target identity is proven from the connection URL itself BEFORE pg is imported or a socket opens.
 * Callers receive only a guarded query function inside BEGIN READ ONLY; they cannot COMMIT or obtain
 * the raw pg client from this module.
 */

export const OC5R_STAGING_PROJECT_REF = 'eoyenigwevnxwwhyhaer';
export const OC5R_PRODUCTION_PROJECT_REF = 'vhmnajoeicasaigiophh';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const FORBIDDEN_SQL = /\b(insert|update|delete|upsert|merge|alter|drop|create|truncate|grant|revoke|copy|call|do|vacuum|refresh|reindex|cluster|comment|listen|notify|lock)\b/i;

function parseConnectionUrl(connectionString) {
  if (!connectionString) throw new Error('Database URL is required; target identity cannot be proven.');
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('Database URL is invalid; target identity cannot be proven.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`Unsupported database protocol ${url.protocol}; PostgreSQL is required.`);
  }
  return url;
}

export function identifyDatabaseTarget(connectionString, options = {}) {
  const url = parseConnectionUrl(connectionString);
  const username = decodeURIComponent(url.username || '');
  const host = String(url.hostname || '').toLowerCase();
  const pathname = decodeURIComponent(url.pathname || '').replace(/^\//, '');
  const identityText = `${username}@${host}`;

  if (identityText.includes(OC5R_PRODUCTION_PROJECT_REF)) {
    return { kind: 'production', projectRef: OC5R_PRODUCTION_PROJECT_REF };
  }
  if (identityText.includes(OC5R_STAGING_PROJECT_REF)) {
    return { kind: 'staging', projectRef: OC5R_STAGING_PROJECT_REF };
  }

  const allowLocalTest = options.allowLocalTest === true;
  if (allowLocalTest && LOCAL_HOSTS.has(host) && /^oc5r_rel03_test(?:$|_)/.test(pathname)) {
    return { kind: 'local_test', projectRef: 'local-disposable-test' };
  }
  return { kind: 'unknown', projectRef: null };
}

export function assertApprovedDatabaseTarget(connectionString, options = {}) {
  const target = identifyDatabaseTarget(connectionString, options);
  if (target.kind === 'production') {
    throw new Error(`PRODUCTION FORBIDDEN: refusing Supabase project ${OC5R_PRODUCTION_PROJECT_REF}.`);
  }
  if (target.kind === 'staging') return target;
  if (target.kind === 'local_test') return target;
  throw new Error('UNKNOWN DATABASE TARGET: refusing to connect because the approved staging project cannot be proven from the connection information.');
}

export function assertReadOnlySql(sql) {
  const source = String(sql || '').trim();
  if (!source) throw new Error('Empty SQL is refused.');
  if (!/^(select|with)\b/i.test(source)) {
    throw new Error('REL-03 observation tooling accepts SELECT/WITH statements only.');
  }
  if (FORBIDDEN_SQL.test(source)) {
    throw new Error('REL-03 observation tooling refused a mutating or operational SQL verb.');
  }
  const withoutTrailing = source.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    throw new Error('Multiple SQL statements are refused.');
  }
  return source;
}

export function makeGuardedQuery(rawClient) {
  return async function queryReadOnly(sql, params = []) {
    const source = assertReadOnlySql(sql);
    return rawClient.query(source, params);
  };
}

export async function withReadOnlyDatabase(connectionString, callback, options = {}) {
  const target = assertApprovedDatabaseTarget(connectionString, options);
  const { default: pg } = await import('pg');
  const cleaned = connectionString
    .replace(/([?&])sslmode=[^&]*&?/i, '$1')
    .replace(/[?&]$/, '');
  const ssl = target.kind === 'staging' ? { rejectUnauthorized: false } : undefined;
  const client = new pg.Client({ connectionString: cleaned, ...(ssl ? { ssl } : {}) });

  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '20s'");
    const result = await callback({
      target,
      query: makeGuardedQuery(client),
    });
    await client.query('ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
