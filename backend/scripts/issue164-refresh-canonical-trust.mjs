#!/usr/bin/env node
/**
 * Issue #164 — materialize the canonical Trust position.
 *
 * WHY THIS EXISTS. Every public surface now reads the canonical cache and nothing recomputes on
 * read, which is what makes one VIN yield one score everywhere. The consequence is that a vehicle
 * has no published score until something WRITES that cache. Evidence review refreshes a vehicle as
 * its facts change (vehiclesRoutes evidence verify/reject), but existing vehicles were scored
 * before the canonical model existed and carry an unversioned legacy number that is correctly
 * refused. This script is the backfill, and the periodic re-materializer.
 *
 * It is a WRITER, so it is guarded like one:
 *   - the target must positively identify canonical staging; "not production" is not sufficient;
 *   - --dry-run reports what would be written without writing;
 *   - it writes ONLY through refreshCanonicalTrust, the single canonical writer, so every score it
 *     lands is stamped with the rules and instant that produced it.
 *
 * It never fabricates: a vehicle whose decision is not a stamped, current-version evaluation is
 * reported as skipped, and its cache is left empty rather than filled with a plausible number.
 *
 * Usage:
 *   DIASPORA_STAGING_DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node backend/scripts/issue164-refresh-canonical-trust.mjs [--dry-run] [--limit=N] [--vin=VIN]
 *
 * Exit codes: 0 completed · 1 completed with failures · 2 BLOCKED (target not identified)
 */
import pg from 'pg';
import { refreshCanonicalTrust } from '../services/trustDecision/canonicalTrustService.js';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const FORBIDDEN_PROD_REF = ['vhmn', 'ajoe', 'icas', 'aigi', 'ophh'].join('');

const blocked = (message) => { console.error(`BLOCKED: ${message}`); process.exit(2); };
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const dryRun = process.argv.includes('--dry-run');

export function assertCanonicalStaging(env = process.env) {
  const dbUrl = env.DIASPORA_STAGING_DATABASE_URL;
  const supabaseUrl = env.SUPABASE_URL;

  if (!dbUrl && !supabaseUrl) {
    blocked('neither DIASPORA_STAGING_DATABASE_URL nor SUPABASE_URL is set');
  }

  const setVars = [
    ['DIASPORA_STAGING_DATABASE_URL', dbUrl],
    ['SUPABASE_URL', supabaseUrl],
  ].filter(([, val]) => Boolean(val));

  for (const [name, value] of setVars) {
    if (value.includes(FORBIDDEN_PROD_REF)) {
      blocked(`${name} references the forbidden production project`);
    }
    if (!value.includes(STAGING_REF)) {
      blocked(`${name} does not positively identify canonical staging ${STAGING_REF}`);
    }
  }
}

export function createPgSupabaseAdapter(pgClient) {
  return {
    from(table) {
      let state = { table, selectCols: '*', whereFilters: [], orderCol: null, orderAsc: true, limitNum: null, patch: null };
      const chain = {
        select(cols) { state.selectCols = cols; return chain; },
        eq(col, val) { state.whereFilters.push({ col, val, op: 'eq' }); return chain; },
        gt(col, val) { state.whereFilters.push({ col, val, op: 'gt' }); return chain; },
        in(col, vals) { state.whereFilters.push({ col, vals, op: 'in' }); return chain; },
        order(col, opts = {}) { state.orderCol = col; state.orderAsc = opts.ascending ?? true; return chain; },
        limit(num) { state.limitNum = num; return chain; },
        async maybeSingle() {
          const res = await chain.execute();
          return { data: res.data?.[0] || null, error: res.error };
        },
        async single() {
          const res = await chain.execute();
          if (!res.data || !res.data.length) return { data: null, error: { message: 'Row not found' } };
          return { data: res.data[0], error: null };
        },
        update(patch) { state.patch = patch; return chain; },
        then(resolve, reject) {
          chain.execute().then(resolve, reject);
        },
        async execute() {
          try {
            if (state.patch) {
              const keys = Object.keys(state.patch);
              const setSql = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
              const params = keys.map((k) => state.patch[k]);
              let whereSql = '';
              let idx = keys.length + 1;
              for (const f of state.whereFilters) {
                whereSql += whereSql ? ' AND ' : ' WHERE ';
                if (f.op === 'gt') {
                  whereSql += `"${f.col}" > $${idx++}`;
                  params.push(f.val);
                } else if (f.op === 'in') {
                  whereSql += `"${f.col}" = ANY($${idx++})`;
                  params.push(f.vals);
                } else {
                  whereSql += `"${f.col}" = $${idx++}`;
                  params.push(f.val);
                }
              }
              const sql = `UPDATE public."${state.table}" SET ${setSql}${whereSql} RETURNING *`;
              const res = await pgClient.query(sql, params);
              return { data: res.rows, error: null };
            } else {
              let whereSql = '';
              let idx = 1;
              const params = [];
              for (const f of state.whereFilters) {
                whereSql += whereSql ? ' AND ' : ' WHERE ';
                if (f.op === 'in') {
                  whereSql += `"${f.col}" = ANY($${idx++})`;
                  params.push(f.vals);
                } else if (f.op === 'gt') {
                  whereSql += `"${f.col}" > $${idx++}`;
                  params.push(f.val);
                } else {
                  whereSql += `"${f.col}" = $${idx++}`;
                  params.push(f.val);
                }
              }
              let sql = `SELECT ${state.selectCols} FROM public."${state.table}"${whereSql}`;
              if (state.orderCol) sql += ` ORDER BY "${state.orderCol}" ${state.orderAsc ? 'ASC' : 'DESC'}`;
              if (state.limitNum) sql += ` LIMIT ${state.limitNum}`;
              const res = await pgClient.query(sql, params);
              return { data: res.rows, error: null };
            }
          } catch (err) {
            return { data: null, error: err };
          }
        }
      };
      return chain;
    }
  };
}

export async function getClient(env = process.env) {
  assertCanonicalStaging(env);

  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const { supabase } = await import('../db/supabase.js');
    return { client: supabase, close: async () => {} };
  }
  const dbUrl = env.DIASPORA_STAGING_DATABASE_URL;
  if (!dbUrl) blocked('neither SUPABASE_SERVICE_ROLE_KEY nor DIASPORA_STAGING_DATABASE_URL is set');

  let parsed;
  try { parsed = new URL(dbUrl); } catch { blocked('invalid DIASPORA_STAGING_DATABASE_URL'); }
  for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) parsed.searchParams.delete(k);

  const sslOpts = env.DIASPORA_STAGING_CA_CERT
    ? { ca: env.DIASPORA_STAGING_CA_CERT, rejectUnauthorized: true }
    : { rejectUnauthorized: false };

  const pgClient = new pg.Client({ connectionString: parsed.toString(), ssl: sslOpts });
  await pgClient.connect();
  return { client: createPgSupabaseAdapter(pgClient), close: async () => pgClient.end() };
}

export async function runTrustRefresh(client, opts = {}) {
  const { singleVin = null, dryRun = false, batchSize = 200, limit = Infinity } = opts;
  const summary = { target: STAGING_REF, dryRun, considered: 0, written: 0, skipped: 0, failed: 0, skips: {} };

  if (singleVin) {
    summary.considered = 1;
    try {
      const result = await refreshCanonicalTrust(singleVin, { client, dryRun });
      if (result.written || (dryRun && result.patch)) summary.written += 1;
      else {
        summary.skipped += 1;
        const reason = result.reason || 'unknown';
        summary.skips[reason] = (summary.skips[reason] || 0) + 1;
      }
    } catch (err) {
      summary.failed += 1;
      console.error(`  refresh failed for ${singleVin}: ${err.message}`);
    }
    return summary;
  }

  let lastVin = null;
  let hasMore = true;

  while (hasMore && summary.considered < limit) {
    const fetchSize = Math.min(batchSize, limit - summary.considered);
    let query = client.from('vehicles').select('vin').order('vin', { ascending: true }).limit(fetchSize);
    if (lastVin) {
      query = query.gt('vin', lastVin);
    }

    const { data, error } = await query;
    if (error) blocked(`could not read vehicles page: ${error.message}`);

    const pageVins = (data || []).map((row) => row.vin).filter((v) => typeof v === 'string' && v.trim().length > 0);
    if (pageVins.length === 0) {
      hasMore = false;
      break;
    }

    for (const vin of pageVins) {
      if (summary.considered >= limit) break;
      summary.considered += 1;
      try {
        const result = await refreshCanonicalTrust(vin, { client, dryRun });
        if (result.written || (dryRun && result.patch)) summary.written += 1;
        else {
          summary.skipped += 1;
          const reason = result.reason || 'unknown';
          summary.skips[reason] = (summary.skips[reason] || 0) + 1;
        }
      } catch (err) {
        summary.failed += 1;
        console.error(`  refresh failed for ${vin}: ${err.message}`);
      }
    }

    lastVin = pageVins[pageVins.length - 1];
    if (pageVins.length < fetchSize || summary.considered >= limit) {
      hasMore = false;
    }
  }

  return summary;
}

async function main() {
  assertCanonicalStaging();

  const { client, close } = await getClient();
  try {
    const singleVin = arg('vin');
    const limitArg = arg('limit');
    const limit = limitArg ? Number(limitArg) : Infinity;
    const batchSize = Number(arg('batch-size')) || 200;

    const summary = await runTrustRefresh(client, { singleVin, dryRun, batchSize, limit });
    console.log(JSON.stringify(summary, null, 2));
    return summary.failed ? 1 : 0;
  } finally {
    await close();
  }
}

if (process.argv[1] && process.argv[1].endsWith('issue164-refresh-canonical-trust.mjs')) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(`BLOCKED: ${err.message}`);
    process.exit(2);
  });
}
