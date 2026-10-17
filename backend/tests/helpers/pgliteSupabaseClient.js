/**
 * CA-K3-AUTH-03 — a supabase-js-shaped client over a PGlite database, executing every statement AS `service_role`, the role the backend
 * uses in production. It exists so the service tests run the REAL governed SQL and the REAL repository primitives (revokeSessionsForUser,
 * logAuditEvent, resolveCorporateMembership) end to end, instead of injecting collaborators that could hide a path that is dead by
 * construction. Direct DML on a Corporate table through this client fails exactly as it does on Supabase: service_role holds none.
 *
 * Supported surface = what the code under test actually calls: rpc, from().select/insert/update + eq/in/limit/order +
 * single/maybeSingle + abortSignal. Everything else throws, so a new call shape cannot silently pass through a stub.
 */
import { OWNER, asRole, rpc as rpcAsServiceRole } from './corporateGovernanceDb.js';

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (name) => { if (!IDENT.test(name)) throw new Error(`unsafe identifier ${name}`); return name; };

/** Test-only audit tables with the shape logAuditEvent writes (the production tables belong to other migrations). */
export const AUDIT_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS trust_audit_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, event_type TEXT NOT NULL, vin TEXT, vehicle_id TEXT, trust_fact TEXT,
    previous_value JSONB, new_value JSONB, actor_user_id TEXT, actor_role TEXT, actor_tenant_id TEXT, actor_type TEXT,
    source_dashboard TEXT, source_route TEXT, evidence_ids TEXT[], partsentry_log_ids TEXT[], registry_verification_id TEXT,
    safepay_transaction_id TEXT, reason TEXT, decision_notes TEXT, request_id TEXT, ip_address TEXT, user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS organization_audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id TEXT REFERENCES organizations(id), user_id TEXT REFERENCES users(id),
    action TEXT, resource TEXT, details TEXT, timestamp TEXT, ip_address TEXT);`;

const queues = new WeakMap();
function serialise(db, task) {
  const previous = queues.get(db) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(db, next.catch(() => {}));
  return next;
}

// PostgREST reports a RAISE's DETAIL/HINT as `details`/`hint`; the authority entry points put the per-capability denials in DETAIL.
const toError = (e) => ({ code: e?.code ?? 'P0001', message: String(e?.message ?? e), details: e?.detail ?? null, hint: e?.hint ?? null });

/**
 * @param options.faults a Set of `<op>:<table>` strings ('update:user_sessions', 'insert:trust_audit_events', 'select:user_sessions')
 *                       that fail with a database-style error — to prove fail-closed behaviour of the code under test
 * @param options.beforeRpc async hook(name, params) run before the procedure — to inject a race (e.g. a re-login)
 */
export function createServiceClient(db, { faults = new Set(), beforeRpc = null } = {}) {
  const calls = { rpc: [], from: [] };
  const client = {
    calls,
    faults,
    set beforeRpc(fn) { beforeRpc = fn; },
    async rpc(name, params) {
      calls.rpc.push({ name, params });
      return serialise(db, async () => {
        if (beforeRpc) await beforeRpc(name, params);
        try { return { data: await rpcAsServiceRole(db, ident(name), params), error: null }; } catch (e) { return { data: null, error: toError(e) }; }
      });
    },
    from(table) {
      ident(table);
      calls.from.push(table);
      return new Query(db, table, faults);
    },
  };
  return client;
}

class Query {
  constructor(db, table, faults) {
    Object.assign(this, { db, table, faults, op: 'select', columns: '*', filters: [], payload: null, limitN: null, orderBy: null, mode: 'many', returning: false });
  }
  select(columns = '*') { if (this.op === 'select') this.columns = columns; else this.returning = columns; return this; }
  insert(row) { this.op = 'insert'; this.payload = row; return this; }
  update(patch) { this.op = 'update'; this.payload = patch; return this; }
  eq(column, value) { this.filters.push({ column: ident(column), kind: 'eq', value }); return this; }
  in(column, values) { this.filters.push({ column: ident(column), kind: 'in', value: values }); return this; }
  limit(n) { this.limitN = n; return this; }
  order(column, { ascending = true } = {}) { this.orderBy = `${ident(column)} ${ascending ? 'ASC' : 'DESC'}`; return this; }
  abortSignal() { return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  then(resolve, reject) { return this.run().then(resolve, reject); }

  async run() {
    const { db, table, op } = this;
    if (this.faults.has(`${op}:${table}`)) return { data: null, error: { code: 'XX000', message: `injected fault ${op}:${table}`, details: null, hint: null } };
    const values = [];
    const where = this.filters.length === 0 ? '' : ` WHERE ${this.filters.map((f) => {
      if (f.kind === 'in') { values.push(f.value); return `${f.column} = ANY($${values.length})`; }
      values.push(f.value); return `${f.column} = $${values.length}`;
    }).join(' AND ')}`;
    const cols = (c) => (c === '*' ? '*' : String(c).split(',').map((x) => ident(x.trim())).join(', '));
    let sql;
    if (op === 'select') {
      sql = `SELECT ${cols(this.columns)} FROM public.${table}${where}${this.orderBy ? ` ORDER BY ${this.orderBy}` : ''}${this.limitN ? ` LIMIT ${Number(this.limitN)}` : ''}`;
    } else if (op === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const keys = Object.keys(rows[0]).map(ident);
      const tuples = rows.map((row) => `(${keys.map((k) => { values.push(row[k]); return `$${values.length}`; }).join(', ')})`);
      sql = `INSERT INTO public.${table} (${keys.join(', ')}) VALUES ${tuples.join(', ')}${this.returning ? ` RETURNING ${cols(this.returning)}` : ''}`;
    } else if (op === 'update') {
      const keys = Object.keys(this.payload).map(ident);
      const sets = keys.map((k) => { values.push(this.payload[k]); return `${k} = $${values.length}`; });
      sql = `UPDATE public.${table} SET ${sets.join(', ')}${where}${this.returning ? ` RETURNING ${cols(this.returning)}` : ''}`;
    } else throw new Error(`unsupported operation ${op}`);

    return serialise(db, async () => {
      try {
        const rows = (await asRole(db, 'service_role', () => db.query(sql, values))).rows;
        if (this.mode === 'single') return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null } };
        if (this.mode === 'maybe') return rows.length <= 1 ? { data: rows[0] ?? null, error: null } : { data: null, error: { code: 'PGRST116', message: 'multiple rows returned', details: null, hint: null } };
        return { data: op === 'select' || this.returning ? rows : null, error: null };
      } catch (e) {
        return { data: null, error: toError(e) };
      }
    });
  }
}

/** Create the audit tables as the migration owner (test infrastructure, not part of the migrations under test). */
export async function installAuditTables(db) {
  await db.exec(`SET ROLE ${OWNER}`);
  await db.exec(AUDIT_TABLES_SQL);
}
